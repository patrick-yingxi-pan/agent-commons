#import <Foundation/Foundation.h>

#define AC_PDF_OCR_BROKER_ID @"com.agentcommons.desktop.pdf-ocr.broker"
#define AC_PDF_OCR_SERVICE_ID @"com.agentcommons.desktop.pdf-ocr.service"
#define AC_PDF_OCR_SERVICE_BUNDLE @"com.agentcommons.desktop.pdf-ocr.service.xpc"

@protocol ACPdfOcrService
- (void)recognize:(NSData *)input reply:(void (^)(NSData *))reply;
@end

// Authenticates the sealed expected bundle and pins the XPC peer's signature.
// Developer ID peers must have the same team; ad-hoc builds pin exact cdhashes.
NSString *ACPeerRequirement(NSURL *peerURL, NSString *expectedIdentifier);
NSString *ACBrokerRequirement(void);
NSDictionary *ACRecognizePdf(NSData *data);
