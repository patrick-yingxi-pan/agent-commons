/* One client, one bounded request, no user-file or network sandbox grants. */
#import "pdf-ocr-peer.h"
#include <stdlib.h>
#include <unistd.h>

@interface ACPdfOcrWorker : NSObject <NSXPCListenerDelegate, ACPdfOcrService>
@property(nonatomic) BOOL connected;
@property(nonatomic) BOOL requested;
@property(nonatomic, strong) NSXPCConnection *connection;
@end

@implementation ACPdfOcrWorker
- (void)recognize:(NSData *)input reply:(void (^)(NSData *))reply {
  @synchronized (self) {
    if (self.requested) { [self.connection invalidate]; return; }
    self.requested = YES;
  }
  // Parsing never blocks the XPC invalidation callback. Client death therefore
  // terminates a busy parser, not merely its eventual result callback.
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      NSDictionary *result = input.length > 8 * 1024 * 1024 ? @{ @"status": @"too-large" } : ACRecognizePdf(input);
      NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
      if (!data || data.length > 64 * 1024 * 6 + 1024) data = [@"{\"status\":\"unavailable\"}" dataUsingEncoding:NSUTF8StringEncoding];
      reply(data);
      // Keep the reply alive until the broker exits; its connection owns this
      // service lifetime. The independent watchdog bounds even a stuck peer.
    }
  });
}
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
  (void)listener;
  if (self.connected || connection.effectiveUserIdentifier != geteuid()) return NO;
  NSString *requirement = ACBrokerRequirement();
  if (!requirement) return NO;
  [connection setCodeSigningRequirement:requirement];
  connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(ACPdfOcrService)];
  connection.exportedObject = self;
  connection.invalidationHandler = ^{ _exit(0); };
  connection.interruptionHandler = ^{ _exit(0); };
  self.connected = YES;
  self.connection = connection;
  [connection resume];
  return YES;
}
@end

int main(void) {
  @autoreleasepool {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC), dispatch_get_global_queue(0, 0), ^{ _exit(1); });
    ACPdfOcrWorker *worker = [ACPdfOcrWorker new];
    NSXPCListener *listener = [NSXPCListener serviceListener];
    listener.delegate = worker;
    [listener resume];
  }
  return 1;
}
