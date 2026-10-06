#define _DARWIN_C_SOURCE
#include <errno.h>
#include <dirent.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_RELATIVE_BYTES (64U * 1024U)
#define MAX_COMPONENTS 256U
#define MAX_READ_BYTES (16U * 1024U * 1024U)
#define MAX_HEADER_BYTES 512U
#define MAX_SAFE_INTEGER UINT64_C(9007199254740991)

enum result { RESULT_FILE, RESULT_MISSING, RESULT_UNSUPPORTED, RESULT_UNREADABLE, RESULT_TOO_LARGE, RESULT_CHANGED };

struct directory_step {
  int fd;
  int parent_fd;
  char *name;
  struct stat opened;
};

static int same_identity(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}

static int same_file_version(const struct stat *left, const struct stat *right) {
  return same_identity(left, right) && left->st_mode == right->st_mode && left->st_size == right->st_size &&
    left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec &&
    left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec &&
    left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec &&
    left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
}

static int same_directory_version(const struct stat *left, const struct stat *right) {
  return same_identity(left, right) && left->st_mode == right->st_mode && left->st_size == right->st_size &&
    left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec &&
    left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec &&
    left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec &&
    left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
}

static int parse_u64(const char *text, uint64_t *value) {
  if (!text || !*text) return 0;
  for (const unsigned char *cursor = (const unsigned char *)text; *cursor; ++cursor) {
    if (*cursor < '0' || *cursor > '9') return 0;
  }
  errno = 0;
  char *end = NULL;
  unsigned long long parsed = strtoull(text, &end, 10);
  if (errno || !end || *end) return 0;
  *value = (uint64_t)parsed;
  return 1;
}

static int parse_maximum(const char *text, int *metadata_only, uint64_t *maximum) {
  if (strcmp(text, "meta") == 0) {
    *metadata_only = 1;
    *maximum = 0;
    return 1;
  }
  *metadata_only = 0;
  if (!parse_u64(text, maximum) || *maximum > MAX_READ_BYTES) return 0;
  return 1;
}

static int valid_relative_path(const char *path, size_t *component_count) {
  size_t length = strlen(path);
  if (!length || length > MAX_RELATIVE_BYTES || path[0] == '/') return 0;
  size_t count = 0;
  const char *component = path;
  for (const unsigned char *cursor = (const unsigned char *)path;; ++cursor) {
    unsigned char byte = *cursor;
    if (byte != '\0' && (byte == '\\' || byte < 0x20 || byte == 0x7f)) return 0;
    if (byte == '/' || byte == '\0') {
      size_t component_length = (size_t)((const char *)cursor - component);
      if (!component_length || (component_length == 1 && component[0] == '.') ||
          (component_length == 2 && component[0] == '.' && component[1] == '.')) return 0;
      if (++count > MAX_COMPONENTS) return 0;
      if (byte == '\0') break;
      component = (const char *)cursor + 1;
    }
  }
  *component_count = count;
  return 1;
}

static char *copy_component(const char *start, size_t length) {
  char *copy = malloc(length + 1);
  if (!copy) return NULL;
  memcpy(copy, start, length);
  copy[length] = '\0';
  return copy;
}

static void file_version(const struct stat *info, char *output, size_t capacity) {
  (void)snprintf(output, capacity, "%ju:%ju:%ju:%jd:%jd:%jd:%jd:%jd",
    (uintmax_t)info->st_dev, (uintmax_t)info->st_ino, (uintmax_t)info->st_mode,
    (intmax_t)info->st_size, (intmax_t)info->st_mtimespec.tv_sec,
    (intmax_t)info->st_mtimespec.tv_nsec, (intmax_t)info->st_ctimespec.tv_sec,
    (intmax_t)info->st_ctimespec.tv_nsec);
}

static enum result classify_errno(int error) {
  if (error == ENOENT) return RESULT_MISSING;
  if (error == EACCES || error == EPERM || error == EIO) return RESULT_UNREADABLE;
  if (error == ELOOP || error == ENOTDIR || error == EISDIR || error == ENXIO) return RESULT_UNSUPPORTED;
  return RESULT_UNREADABLE;
}

static int write_all(int descriptor, const void *buffer, size_t length) {
  const unsigned char *cursor = buffer;
  while (length) {
    ssize_t written = write(descriptor, cursor, length);
    if (written < 0) {
      if (errno == EINTR) continue;
      return 0;
    }
    if (written == 0) return 0;
    cursor += (size_t)written;
    length -= (size_t)written;
  }
  return 1;
}

static int emit_status(enum result result, const struct stat *info) {
  char version[256];
  char header[MAX_HEADER_BYTES];
  int length;
  switch (result) {
    case RESULT_MISSING: return write_all(STDOUT_FILENO, "M\n", 2);
    case RESULT_UNSUPPORTED: return write_all(STDOUT_FILENO, "U\n", 2);
    case RESULT_UNREADABLE: return write_all(STDOUT_FILENO, "R\n", 2);
    case RESULT_CHANGED: return write_all(STDOUT_FILENO, "C\n", 2);
    case RESULT_TOO_LARGE:
      file_version(info, version, sizeof(version));
      length = snprintf(header, sizeof(header), "T %jd %s\n", (intmax_t)info->st_size, version);
      break;
    case RESULT_FILE:
      file_version(info, version, sizeof(version));
      length = snprintf(header, sizeof(header), "F %jd %s\n", (intmax_t)info->st_size, version);
      break;
    default: return 0;
  }
  return length > 0 && (size_t)length < sizeof(header) && write_all(STDOUT_FILENO, header, (size_t)length);
}

static int validate_directory_chain(const char *root_path, int root_fd, struct stat root_info,
                                    struct directory_step *steps, size_t directory_count) {
  struct stat current;
  if (fstat(root_fd, &current) != 0 || !same_identity(&current, &root_info) || !S_ISDIR(current.st_mode)) return 0;
  for (size_t index = 1; index <= directory_count; ++index) {
    struct stat opened, bound;
    if (fstat(steps[index].fd, &opened) != 0 || fstatat(steps[index].parent_fd, steps[index].name, &bound,
          AT_SYMLINK_NOFOLLOW) != 0 || !S_ISDIR(bound.st_mode) || !same_identity(&opened, &steps[index].opened) ||
        !same_identity(&bound, &steps[index].opened)) return 0;
  }
  int reopened = open(root_path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (reopened < 0) return 0;
  int valid = fstat(reopened, &current) == 0 && same_identity(&current, &root_info) && S_ISDIR(current.st_mode);
  close(reopened);
  return valid;
}

static int validate_failed_leaf(const char *root_path, int root_fd, struct stat root_info,
                                struct directory_step *steps, size_t directory_count,
                                int parent_fd, const char *leaf, const struct stat *observed,
                                int expected_error) {
  if (!validate_directory_chain(root_path, root_fd, root_info, steps, directory_count)) return 0;
  struct stat current;
  if (fstatat(parent_fd, leaf, &current, AT_SYMLINK_NOFOLLOW) == 0) {
    return observed && same_file_version(observed, &current);
  }
  return !observed && errno == expected_error;
}

#ifdef AGENT_COMMONS_GIT_FILE_TEST_HOOKS
static void test_pause_before_open(void) {
  const char *ready = getenv("AGENT_COMMONS_GIT_FILE_TEST_READY");
  const char *release = getenv("AGENT_COMMONS_GIT_FILE_TEST_RELEASE");
  if (!ready || !release) return;
  int descriptor = open(ready, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (descriptor >= 0) close(descriptor);
  for (unsigned int attempt = 0; attempt < 10000; ++attempt) {
    if (access(release, F_OK) == 0) return;
    usleep(1000);
  }
}
#endif

static void close_directories(int root_fd, struct directory_step *steps, size_t directory_count) {
  for (size_t index = 1; index <= directory_count; ++index) {
    if (steps[index].fd >= 0) close(steps[index].fd);
    free(steps[index].name);
  }
  if (root_fd >= 0) close(root_fd);
}

static int is_shared_index_name(const char *name) {
  static const char prefix[] = "sharedindex.";
  size_t length = strlen(name);
  if (length != sizeof(prefix) - 1 + 40 && length != sizeof(prefix) - 1 + 64) return 0;
  if (strncmp(name, prefix, sizeof(prefix) - 1) != 0) return 0;
  for (const unsigned char *cursor = (const unsigned char *)name + sizeof(prefix) - 1; *cursor; ++cursor) {
    if (!((*cursor >= '0' && *cursor <= '9') || (*cursor >= 'a' && *cursor <= 'f'))) return 0;
  }
  return 1;
}

static int is_lower_hex(const char *text, size_t length) {
  for (size_t index = 0; index < length; ++index) {
    if (!((text[index] >= '0' && text[index] <= '9') || (text[index] >= 'a' && text[index] <= 'f'))) return 0;
  }
  return 1;
}

static int is_pack_index_name(const char *name) {
  size_t length = strlen(name);
  return (length == 49 || length == 73) && strncmp(name, "pack-", 5) == 0 &&
    strcmp(name + length - 4, ".idx") == 0 && is_lower_hex(name + 5, length - 9);
}

static int is_object_path(const char *path) {
  if (strncmp(path, "objects/", 8) != 0) return 0;
  const char *name = path + 8;
  size_t length = strlen(name);
  if ((length == 41 || length == 65) && name[2] == '/' && is_lower_hex(name, 2) &&
      is_lower_hex(name + 3, length - 3)) return 1;
  if (strncmp(name, "pack/", 5) != 0) return 0;
  name += 5;
  length -= 5;
  if (is_pack_index_name(name)) return 1;
  return (length == 50 || length == 74) && strncmp(name, "pack-", 5) == 0 &&
    strcmp(name + length - 5, ".pack") == 0 && is_lower_hex(name + 5, length - 10);
}

static int list_metadata_names(const char *root_path, const char *device_text, const char *inode_text, int packs) {
  uint64_t pinned_device, pinned_inode;
  if (!parse_u64(device_text, &pinned_device) || !parse_u64(inode_text, &pinned_inode)) return 64;
  int root_fd = open(root_path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root_fd < 0) {
    emit_status(errno == EACCES || errno == EPERM ? RESULT_UNREADABLE : RESULT_CHANGED, NULL);
    return 0;
  }
  struct stat root_info, after;
  if (fstat(root_fd, &root_info) != 0 || !S_ISDIR(root_info.st_mode) ||
      (uint64_t)root_info.st_dev != pinned_device || (uint64_t)root_info.st_ino != pinned_inode) {
    close(root_fd);
    emit_status(RESULT_CHANGED, NULL);
    return 0;
  }

  struct directory_step steps[3];
  memset(steps, 0, sizeof(steps));
  size_t directory_count = 0;
  int parent_fd = root_fd;
  const char *components[] = { "objects", "pack" };
  for (size_t index = 0; packs && index < 2; ++index) {
    const char *name = components[index];
    struct stat before, opened;
    enum result failure = RESULT_CHANGED;
    if (fstatat(parent_fd, name, &before, AT_SYMLINK_NOFOLLOW) != 0) {
      int error = errno;
      failure = validate_failed_leaf(root_path, root_fd, root_info, steps, directory_count,
        parent_fd, name, NULL, error) ? classify_errno(error) : RESULT_CHANGED;
    } else if (!S_ISDIR(before.st_mode)) {
      failure = validate_failed_leaf(root_path, root_fd, root_info, steps, directory_count,
        parent_fd, name, &before, 0) ? RESULT_UNSUPPORTED : RESULT_CHANGED;
    } else {
      int child_fd = openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      if (child_fd >= 0 && fstat(child_fd, &opened) == 0 && S_ISDIR(opened.st_mode) && same_identity(&before, &opened)) {
        char *copy = strdup(name);
        if (copy) {
          ++directory_count;
          steps[directory_count] = (struct directory_step){ child_fd, parent_fd, copy, opened };
          parent_fd = child_fd;
          continue;
        }
      }
      if (child_fd >= 0) close(child_fd);
    }
    close_directories(root_fd, steps, directory_count);
    emit_status(failure, NULL);
    return 0;
  }
  struct stat directory_info;
  if (fstat(parent_fd, &directory_info) != 0) {
    close_directories(root_fd, steps, directory_count);
    emit_status(RESULT_CHANGED, NULL);
    return 0;
  }
#ifdef AGENT_COMMONS_GIT_FILE_TEST_HOOKS
  test_pause_before_open();
#endif
  int scan_fd = dup(parent_fd);
  DIR *directory = scan_fd < 0 ? NULL : fdopendir(scan_fd);
  if (!directory) {
    if (scan_fd >= 0) close(scan_fd);
    close_directories(root_fd, steps, directory_count);
    emit_status(RESULT_UNREADABLE, NULL);
    return 0;
  }
  char *names[64];
  size_t match_count = 0;
  size_t visited_count = 0;
  int scan_error = 0;
  errno = 0;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    if (++visited_count > 512) { scan_error = 1; break; }
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
    if (!(packs ? is_pack_index_name(entry->d_name) : is_shared_index_name(entry->d_name))) continue;
    if (match_count >= 64) { scan_error = 1; break; }
    names[match_count] = strdup(entry->d_name);
    if (!names[match_count]) { scan_error = 1; break; }
    ++match_count;
    errno = 0;
  }
  if (errno != 0) scan_error = 1;
  closedir(directory);

  int stable = !scan_error && fstat(parent_fd, &after) == 0 && same_directory_version(&directory_info, &after) &&
    validate_directory_chain(root_path, root_fd, root_info, steps, directory_count);
  close_directories(root_fd, steps, directory_count);
  if (!stable) {
    for (size_t index = 0; index < match_count; ++index) free(names[index]);
    emit_status(RESULT_CHANGED, NULL);
    return 0;
  }

  char output[8192];
  int header_length = snprintf(output, sizeof(output), "L %zu\n", match_count);
  if (header_length < 0 || (size_t)header_length >= sizeof(output)) goto list_failure;
  size_t output_length = (size_t)header_length;
  for (size_t index = 0; index < match_count; ++index) {
    size_t name_length = strlen(names[index]);
    if (output_length + name_length + 1 >= sizeof(output)) goto list_failure;
    memcpy(output + output_length, names[index], name_length);
    output_length += name_length;
    output[output_length++] = '\n';
  }
  int write_succeeded = write_all(STDOUT_FILENO, output, output_length);
  for (size_t index = 0; index < match_count; ++index) free(names[index]);
  return write_succeeded ? 0 : 70;

list_failure:
  for (size_t index = 0; index < match_count; ++index) free(names[index]);
  emit_status(RESULT_CHANGED, NULL);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 5 && strcmp(argv[1], "--list-shared-indexes") == 0 && argv[2][0] == '/') {
    return list_metadata_names(argv[2], argv[3], argv[4], 0);
  }
  if (argc == 5 && strcmp(argv[1], "--list-pack-indexes") == 0 && argv[2][0] == '/') {
    return list_metadata_names(argv[2], argv[3], argv[4], 1);
  }
  int range_read = argc == 8 && strcmp(argv[1], "--read-range") == 0;
  if (range_read) { --argc; ++argv; }
  if (argc != (range_read ? 7 : 6) || argv[1][0] != '/') return 64;
  uint64_t pinned_device, pinned_inode, maximum, offset = 0;
  int metadata_only;
  size_t component_count;
  if (!parse_u64(argv[2], &pinned_device) || !parse_u64(argv[3], &pinned_inode) ||
      !parse_maximum(argv[range_read ? 6 : 5], &metadata_only, &maximum) ||
      !valid_relative_path(argv[4], &component_count)) return 64;
  if (range_read && (!is_object_path(argv[4]) || metadata_only || maximum == 0 ||
      !parse_u64(argv[5], &offset) || offset > MAX_SAFE_INTEGER || maximum > MAX_SAFE_INTEGER - offset)) return 64;

  int root_fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root_fd < 0) {
    int error = errno;
    emit_status(error == EACCES || error == EPERM ? RESULT_UNREADABLE : RESULT_CHANGED, NULL);
    return 0;
  }
  struct stat root_info;
  if (fstat(root_fd, &root_info) != 0 || !S_ISDIR(root_info.st_mode) ||
      (uint64_t)root_info.st_dev != pinned_device || (uint64_t)root_info.st_ino != pinned_inode) {
    close(root_fd);
    emit_status(RESULT_CHANGED, NULL);
    return 0;
  }

  struct directory_step steps[MAX_COMPONENTS + 1];
  memset(steps, 0, sizeof(steps));
  for (size_t index = 0; index <= MAX_COMPONENTS; ++index) steps[index].fd = -1;
  int parent_fd = root_fd;
  size_t directory_count = 0;
  const char *cursor = argv[4];
  char *leaf = NULL;
  enum result result = RESULT_CHANGED;

  for (size_t component_index = 0; component_index < component_count; ++component_index) {
    const char *slash = strchr(cursor, '/');
    size_t length = slash ? (size_t)(slash - cursor) : strlen(cursor);
    char *component = copy_component(cursor, length);
    if (!component) goto cleanup;
    if (!slash) {
      leaf = component;
      break;
    }
    struct stat before, opened;
    if (fstatat(parent_fd, component, &before, AT_SYMLINK_NOFOLLOW) != 0) {
      int error = errno;
      result = validate_failed_leaf(argv[1], root_fd, root_info, steps, directory_count,
                                    parent_fd, component, NULL, error)
        ? classify_errno(error) : RESULT_CHANGED;
      free(component);
      goto report;
    }
    if (!S_ISDIR(before.st_mode)) {
      result = validate_failed_leaf(argv[1], root_fd, root_info, steps, directory_count,
                                    parent_fd, component, &before, 0)
        ? RESULT_UNSUPPORTED : RESULT_CHANGED;
      free(component);
      goto report;
    }
    int child_fd = openat(parent_fd, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (child_fd < 0) {
      int error = errno;
      result = validate_failed_leaf(argv[1], root_fd, root_info, steps, directory_count,
                                    parent_fd, component, &before, 0)
        ? (error == ELOOP || error == ENOTDIR ? RESULT_UNSUPPORTED : classify_errno(error))
        : RESULT_CHANGED;
      free(component);
      goto report;
    }
    if (fstat(child_fd, &opened) != 0 || !S_ISDIR(opened.st_mode) || !same_identity(&before, &opened)) {
      close(child_fd);
      free(component);
      result = RESULT_CHANGED;
      goto report;
    }
    ++directory_count;
    steps[directory_count].fd = child_fd;
    steps[directory_count].parent_fd = parent_fd;
    steps[directory_count].name = component;
    steps[directory_count].opened = opened;
    parent_fd = child_fd;
    cursor = slash + 1;
  }
  if (!leaf) goto cleanup;

  struct stat before_file, file_info;
  if (fstatat(parent_fd, leaf, &before_file, AT_SYMLINK_NOFOLLOW) != 0) {
    int error = errno;
    result = validate_failed_leaf(argv[1], root_fd, root_info, steps, directory_count,
                                  parent_fd, leaf, NULL, error)
      ? classify_errno(error) : RESULT_CHANGED;
    goto report;
  }
  if (!S_ISREG(before_file.st_mode)) {
    result = validate_failed_leaf(argv[1], root_fd, root_info, steps, directory_count,
                                  parent_fd, leaf, &before_file, 0)
      ? RESULT_UNSUPPORTED : RESULT_CHANGED;
    goto report;
  }
#ifdef AGENT_COMMONS_GIT_FILE_TEST_HOOKS
  test_pause_before_open();
#endif
  int file_fd = openat(parent_fd, leaf, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
  if (file_fd < 0) {
    int error = errno;
    result = validate_failed_leaf(argv[1], root_fd, root_info, steps, directory_count,
                                  parent_fd, leaf, &before_file, 0)
      ? (error == ELOOP ? RESULT_UNSUPPORTED : classify_errno(error))
      : RESULT_CHANGED;
    goto report;
  }
  if (fstat(file_fd, &file_info) != 0 || !S_ISREG(file_info.st_mode) || !same_file_version(&before_file, &file_info)) {
    close(file_fd);
    result = RESULT_CHANGED;
    goto report;
  }
  if (file_info.st_size < 0 || (range_read && (uint64_t)file_info.st_size > MAX_SAFE_INTEGER)) {
    close(file_fd);
    result = RESULT_UNREADABLE;
    goto report;
  }
  if (range_read && offset + maximum > (uint64_t)file_info.st_size) {
    struct stat after_file, binding;
    int stable = fstat(file_fd, &after_file) == 0 && same_file_version(&file_info, &after_file) &&
      fstatat(parent_fd, leaf, &binding, AT_SYMLINK_NOFOLLOW) == 0 && same_file_version(&file_info, &binding) &&
      validate_directory_chain(argv[1], root_fd, root_info, steps, directory_count);
    close(file_fd);
    if (!stable) { result = RESULT_CHANGED; goto report; }
    char version[256], header[MAX_HEADER_BYTES];
    file_version(&file_info, version, sizeof(version));
    int count = snprintf(header, sizeof(header), "E %jd %s\n", (intmax_t)file_info.st_size, version);
    if (count <= 0 || (size_t)count >= sizeof(header) || !write_all(STDOUT_FILENO, header, (size_t)count)) goto cleanup;
    free(leaf);
    close_directories(root_fd, steps, directory_count);
    return 0;
  }
  if (!range_read && !metadata_only && (uint64_t)file_info.st_size > maximum) {
    struct stat binding;
    int stable = fstatat(parent_fd, leaf, &binding, AT_SYMLINK_NOFOLLOW) == 0 &&
      same_file_version(&file_info, &binding) && validate_directory_chain(argv[1], root_fd, root_info, steps, directory_count);
    close(file_fd);
    result = stable ? RESULT_TOO_LARGE : RESULT_CHANGED;
    goto report;
  }

  unsigned char *body = NULL;
  size_t body_length = 0;
  if (!metadata_only) {
    size_t capacity = (size_t)maximum + (range_read ? 0 : 1);
    body = malloc(capacity ? capacity : 1);
    if (!body) {
      close(file_fd);
      goto cleanup;
    }
    while (body_length < capacity) {
      ssize_t count = range_read
        ? pread(file_fd, body + body_length, capacity - body_length, (off_t)(offset + body_length))
        : read(file_fd, body + body_length, capacity - body_length);
      if (count < 0) {
        if (errno == EINTR) continue;
        free(body);
        struct stat after_file, binding;
        int stable = fstat(file_fd, &after_file) == 0 && same_file_version(&file_info, &after_file) &&
          fstatat(parent_fd, leaf, &binding, AT_SYMLINK_NOFOLLOW) == 0 && same_file_version(&file_info, &binding) &&
          validate_directory_chain(argv[1], root_fd, root_info, steps, directory_count);
        close(file_fd);
        result = stable ? RESULT_UNREADABLE : RESULT_CHANGED;
        goto report;
      }
      if (count == 0) break;
      body_length += (size_t)count;
    }
  }
  struct stat after_file, binding;
  int stable = fstat(file_fd, &after_file) == 0 && same_file_version(&file_info, &after_file) &&
    fstatat(parent_fd, leaf, &binding, AT_SYMLINK_NOFOLLOW) == 0 && same_file_version(&file_info, &binding) &&
    validate_directory_chain(argv[1], root_fd, root_info, steps, directory_count);
  close(file_fd);
  if (!stable || (!metadata_only && (body_length != (range_read ? (size_t)maximum : (size_t)file_info.st_size) || body_length > maximum))) {
    free(body);
    result = RESULT_CHANGED;
    goto report;
  }
  result = RESULT_FILE;
  int emitted;
  if (range_read) {
    char version[256], header[MAX_HEADER_BYTES];
    file_version(&file_info, version, sizeof(version));
    int count = snprintf(header, sizeof(header), "B %jd %" PRIu64 " %zu %s\n", (intmax_t)file_info.st_size, offset, body_length, version);
    emitted = count > 0 && (size_t)count < sizeof(header) && write_all(STDOUT_FILENO, header, (size_t)count);
  } else emitted = emit_status(result, &file_info);
  if (!emitted || (body_length && !write_all(STDOUT_FILENO, body, body_length))) {
    free(body);
    goto cleanup;
  }
  free(body);
  free(leaf);
  close_directories(root_fd, steps, directory_count);
  return 0;

report:
  emit_status(result, result == RESULT_TOO_LARGE ? &file_info : NULL);
  free(leaf);
  close_directories(root_fd, steps, directory_count);
  return 0;
cleanup:
  free(leaf);
  close_directories(root_fd, steps, directory_count);
  return 70;
}
