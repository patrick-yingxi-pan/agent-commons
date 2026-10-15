#include <errno.h>
#include <stdio.h>
#include <sys/types.h>
#include <sys/sysctl.h>

#if defined(__arm64__)
#define PROBE_ARCHITECTURE "arm64"
#elif defined(__x86_64__)
#define PROBE_ARCHITECTURE "x64"
#else
#error Unsupported macOS release architecture
#endif

int main(void) {
  int translated = -1;
  size_t size = sizeof(translated);
  if (sysctlbyname("sysctl.proc_translated", &translated, &size, NULL, 0) == -1) {
    // Apple documents ENOENT on systems without Rosetta translation support.
    // The caller admits this result only for an explicitly x86_64 probe.
    if (errno != ENOENT) {
      fprintf(stderr, "Translation inspection failed (errno %d).\n", errno);
      return 1;
    }
    printf("{\"architecture\":\"%s\",\"translation\":\"absent\"}\n", PROBE_ARCHITECTURE);
    return 0;
  }
  if (size != sizeof(translated) || (translated != 0 && translated != 1)) {
    fputs("Translation inspection returned an invalid result.\n", stderr);
    return 1;
  }
  printf("{\"architecture\":\"%s\",\"translation\":%d}\n", PROBE_ARCHITECTURE, translated);
  return 0;
}
