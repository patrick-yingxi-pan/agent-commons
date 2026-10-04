/* Read-only macOS profile admission. The parent supplies only its already
 * opened, no-follow directory as fd 3; no path, mutation or recursive access. */
#include <errno.h>
#include <fcntl.h>
#include <membership.h>
#include <stdio.h>
#include <string.h>
#include <sys/acl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <uuid/uuid.h>

static int private_mode(const struct stat *info) {
  return S_ISDIR(info->st_mode) && info->st_uid == geteuid() &&
    (info->st_mode & 07777) == 0700;
}

int main(int argc, char **argv) {
  (void)argv;
  struct stat before, after;
  if (argc != 1 || fstat(3, &before) != 0) return 3;
  if (!private_mode(&before)) return 2;
  /* acl_get_fd_np conflates an absent ACL with read failure. Query presence
   * only after a successful descriptor-bound extended stat instead. */
  filesec_t security = filesec_init();
  if (security == NULL) return 3;
  int present = -1;
  acl_t acl = NULL;
  int inspected = fstatx_np(3, &before, security) == 0 &&
    filesec_query_property(security, FILESEC_ACL, &present) == 0 &&
    (present == 0 || (filesec_get_property(security, FILESEC_ACL, &acl) == 0 && acl != NULL));
  filesec_free(security);
  if (!inspected) return 3;
  if (!private_mode(&before)) { if (acl != NULL) acl_free(acl); return 2; }
  int result = 3;
  if (present == 0) { result = 0; goto done; }
  if (acl_valid(acl) != 0) goto done;
  acl_entry_t entry;
  uuid_t owner;
  int owner_known = 0;
  for (int index = 0; index <= ACL_MAX_ENTRIES; index++) {
    errno = 0;
    if (acl_get_entry(acl, index == 0 ? ACL_FIRST_ENTRY : ACL_NEXT_ENTRY, &entry) != 0) {
      /* Darwin reports EINVAL at end-of-list, after acl_valid above. */
      if (errno == EINVAL) result = 0;
      break;
    }
    if (index == ACL_MAX_ENTRIES) break;
    acl_tag_t tag;
    if (acl_get_tag_type(entry, &tag) != 0) break;
    // Denials cannot widen access; owner-only allows add no other principal.
    if (tag == ACL_EXTENDED_DENY) continue;
    if (tag != ACL_EXTENDED_ALLOW) break;
    if (!owner_known) {
      if (mbr_uid_to_uuid(geteuid(), owner) != 0) break;
      owner_known = 1;
    }
    uuid_t *principal = acl_get_qualifier(entry);
    if (principal == NULL) break;
    int same_owner = uuid_compare(*principal, owner) == 0;
    if (acl_free(principal) != 0) break;
    if (!same_owner) { result = 2; break; }
  }
done:
  if (acl != NULL && acl_free(acl) != 0) return 3;
  if (result != 0) return result;
  if (fstat(3, &after) != 0 || !private_mode(&after) ||
      before.st_dev != after.st_dev || before.st_ino != after.st_ino ||
      before.st_ctimespec.tv_sec != after.st_ctimespec.tv_sec ||
      before.st_ctimespec.tv_nsec != after.st_ctimespec.tv_nsec) return 3;
  puts("private");
  return 0;
}
