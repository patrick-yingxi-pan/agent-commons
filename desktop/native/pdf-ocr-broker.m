/* Unsandboxed byte transport only. Never link a PDF/image parser here. */
#import "pdf-ocr-peer.h"
#include <stdio.h>
#include <stdlib.h>

static void finish(NSData *data) {
  static const char fallback[] = "{\"status\":\"unavailable\"}";
  if (data && data.length > 0 && data.length <= 64 * 1024 * 6 + 1024) (void)fwrite(data.bytes, 1, data.length, stdout);
  else (void)fwrite(fallback, 1, sizeof(fallback) - 1, stdout);
  (void)fwrite("\n", 1, 1, stdout);
  exit(0);
}

static void status(NSString *value) {
  finish([NSJSONSerialization dataWithJSONObject:@{ @"status": value } options:0 error:NULL]);
}

int main(int argc, const char *argv[]) {
  (void)argv;
  @autoreleasepool {
    if (argc != 1) { status(@"invalid"); return 0; }
    // The host also owns a deadline; this watchdog prevents a stranded broker
    // if its caller disappears without closing stdin or reading stdout.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC), dispatch_get_global_queue(0, 0), ^{ _exit(1); });
    const size_t capacity = 8 * 1024 * 1024 + 1;
    void *bytes = malloc(capacity);
    if (!bytes) { status(@"unavailable"); return 0; }
    size_t length = 0;
    while (length < capacity) {
      size_t count = fread((uint8_t *)bytes + length, 1, capacity - length, stdin);
      length += count;
      if (count == 0) break;
    }
    if (ferror(stdin)) { free(bytes); status(@"unavailable"); return 0; }
    if (length == capacity) { free(bytes); status(@"too-large"); return 0; }
    NSData *input = [NSData dataWithBytesNoCopy:bytes length:length freeWhenDone:YES];
    NSURL *serviceURL = [NSBundle.mainBundle.bundleURL URLByAppendingPathComponent:
      [@"Contents/XPCServices/" stringByAppendingString:AC_PDF_OCR_SERVICE_BUNDLE]];
    NSString *requirement = ACPeerRequirement(serviceURL, AC_PDF_OCR_SERVICE_ID);
    if (!requirement) { status(@"unavailable"); return 0; }
    NSXPCConnection *connection = [[NSXPCConnection alloc] initWithServiceName:AC_PDF_OCR_SERVICE_ID];
    [connection setCodeSigningRequirement:requirement];
    connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(ACPdfOcrService)];
    connection.invalidationHandler = ^{ _exit(1); };
    connection.interruptionHandler = ^{ _exit(1); };
    [connection resume];
    [[connection remoteObjectProxyWithErrorHandler:^(__unused NSError *error) { _exit(1); }]
      recognize:input reply:^(NSData *data) { finish(data); }];
    [[NSRunLoop currentRunLoop] run];
  }
  return 1;
}
