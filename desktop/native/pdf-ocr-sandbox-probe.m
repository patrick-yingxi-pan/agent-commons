/* Test-only alternate engine; excluded from every package. It exercises the
 * unchanged broker, peer authentication and service sandbox/lifetime. */
#import <Foundation/Foundation.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <errno.h>
#include <stdio.h>
#include <unistd.h>

NSDictionary *ACRecognizePdf(NSData *input) {
  NSDictionary *probe = [NSJSONSerialization JSONObjectWithData:input options:0 error:NULL];
  if ([probe[@"wait"] boolValue]) {
    // A deliberately uncooperative decoder must die with its authenticated
    // broker even though it never returns or calls a cancellation callback.
    for (;;) pause();
  }
  NSString *path = probe[@"path"];
  FILE *file = fopen(path.fileSystemRepresentation, "r");
  const int fileError = errno;
  if (file) fclose(file);
  FILE *written = fopen([path stringByAppendingString:@".write"].fileSystemRepresentation, "w");
  const int writeError = errno;
  if (written) fclose(written);
  int socketFD = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in address = { .sin_len = sizeof(address), .sin_family = AF_INET,
    .sin_port = htons([probe[@"port"] unsignedShortValue]) };
  inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
  const int connected = connect(socketFD, (struct sockaddr *)&address, sizeof(address));
  const int networkError = errno;
  close(socketFD);
  NSData *json = [NSJSONSerialization dataWithJSONObject:@{ @"pid": @(getpid()),
    @"fileOpened": @((BOOL)(file != NULL)), @"fileError": @(fileError),
    @"fileWritten": @((BOOL)(written != NULL)), @"writeError": @(writeError),
    @"connected": @((BOOL)(connected == 0)), @"networkError": @(networkError) } options:0 error:NULL];
  return @{ @"status": @"ready", @"pages": @1, @"textPages": @1,
    @"text": [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] };
}
