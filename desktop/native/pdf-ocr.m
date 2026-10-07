/*
 * Sandboxed scanned-PDF engine. Only the XPC service links this parser; the
 * byte broker never loads CoreGraphics or Vision. No paths or URLs are accepted.
 */
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

enum {
  kMaximumInputBytes = 8 * 1024 * 1024,
  kMaximumPages = 100,
  kMaximumEdge = 2000,
  kMaximumPixelsPerPage = kMaximumEdge * kMaximumEdge,
  kMaximumAggregatePixels = kMaximumPages * kMaximumPixelsPerPage,
  kMaximumTextBytes = 64 * 1024
};

static BOOL finitePositiveRect(CGRect rect) {
  return isfinite(rect.origin.x) && isfinite(rect.origin.y) &&
    isfinite(rect.size.width) && isfinite(rect.size.height) &&
    rect.size.width > 0 && rect.size.height > 0;
}

static NSString *recognizePage(CGPDFPageRef page, NSUInteger *pixelCountOut, BOOL *tooLargeOut) {
  *tooLargeOut = NO;
  CGRect crop = CGPDFPageGetBoxRect(page, kCGPDFCropBox);
  if (!finitePositiveRect(crop)) return nil;
  int rotation = CGPDFPageGetRotationAngle(page) % 360;
  if (rotation < 0) rotation += 360;
  if (rotation % 90 != 0) return nil;
  const BOOL quarterTurn = rotation == 90 || rotation == 270;
  const double widthPoints = quarterTurn ? crop.size.height : crop.size.width;
  const double heightPoints = quarterTurn ? crop.size.width : crop.size.height;
  const double maxPoints = fmax(widthPoints, heightPoints);
  /* Render at the helper's full resolution budget, including upscaling normal
   * point-sized pages. Ratios keep extreme but finite boxes from overflowing. */
  const size_t width = (size_t)fmax(1.0, ceil((widthPoints / maxPoints) * kMaximumEdge));
  const size_t height = (size_t)fmax(1.0, ceil((heightPoints / maxPoints) * kMaximumEdge));
  if (width > kMaximumEdge || height > kMaximumEdge || width > SIZE_MAX / height) return nil;
  const size_t pixels = width * height;
  if (pixels > kMaximumPixelsPerPage) return nil;
  *pixelCountOut = pixels;

  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  if (colorSpace == NULL) return nil;
  CGContextRef bitmap = CGBitmapContextCreate(NULL, width, height, 8, width * 4, colorSpace,
    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(colorSpace);
  if (bitmap == NULL) return nil;
  CGContextSetRGBFillColor(bitmap, 1, 1, 1, 1);
  CGContextFillRect(bitmap, CGRectMake(0, 0, width, height));
  const CGAffineTransform transform = CGPDFPageGetDrawingTransform(page, kCGPDFCropBox,
    CGRectMake(0, 0, width, height), 0, true);
  if (!isfinite(transform.a) || !isfinite(transform.b) || !isfinite(transform.c) ||
      !isfinite(transform.d) || !isfinite(transform.tx) || !isfinite(transform.ty)) {
    CGContextRelease(bitmap);
    return nil;
  }
  CGContextConcatCTM(bitmap, transform);
  CGContextDrawPDFPage(bitmap, page);
  CGImageRef image = CGBitmapContextCreateImage(bitmap);
  CGContextRelease(bitmap);
  if (image == NULL) return nil;

  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.revision = VNRecognizeTextRequestRevision3;
  request.automaticallyDetectsLanguage = YES;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
  NSError *error = nil;
  const BOOL completed = [handler performRequests:@[ request ] error:&error];
  CGImageRelease(image);
  if (!completed || error != nil) return nil;

  NSMutableString *text = [NSMutableString string];
  NSUInteger textBytes = 0;
  NSCharacterSet *nonWhitespace = NSCharacterSet.whitespaceAndNewlineCharacterSet.invertedSet;
  for (VNRecognizedTextObservation *observation in request.results ?: @[]) {
    VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
    if (candidate == nil || candidate.string.length == 0 ||
        [candidate.string rangeOfCharacterFromSet:nonWhitespace].location == NSNotFound) continue;
    const NSUInteger lineBytes = [candidate.string lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
    const NSUInteger separatorBytes = text.length == 0 ? 0 : 1;
    if (lineBytes > kMaximumTextBytes - separatorBytes ||
        textBytes > kMaximumTextBytes - lineBytes - separatorBytes) {
      *tooLargeOut = YES;
      return nil;
    }
    if (separatorBytes != 0) [text appendString:@"\n"];
    [text appendString:candidate.string];
    textBytes += separatorBytes + lineBytes;
  }
  return text;
}

NSDictionary *ACRecognizePdf(NSData *data) {
  const uint8_t *bytes = data.bytes;
  const size_t length = data.length;
  if (length > kMaximumInputBytes) return @{ @"status": @"too-large" };
  BOOL hasHeader = NO;
  const size_t lastStart = length < 1029 ? length - (length >= 5 ? 5 : length) : 1024;
  for (size_t start = 0; length >= 5 && start <= lastStart; start++) {
    if (bytes[start] == '%' && bytes[start + 1] == 'P' && bytes[start + 2] == 'D' &&
        bytes[start + 3] == 'F' && bytes[start + 4] == '-') { hasHeader = YES; break; }
  }
  if (!hasHeader) {
    return @{ @"status": @"invalid" };
  }
  @try {
    CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
    if (provider == NULL) return @{ @"status": @"invalid" };
    CGPDFDocumentRef document = CGPDFDocumentCreateWithProvider(provider);
    CGDataProviderRelease(provider);
    if (document == NULL) return @{ @"status": @"invalid" };
    if (CGPDFDocumentIsEncrypted(document) || !CGPDFDocumentIsUnlocked(document) || !CGPDFDocumentAllowsCopying(document)) {
      CGPDFDocumentRelease(document); return @{ @"status": @"protected" };
    }
    const size_t pageCount = CGPDFDocumentGetNumberOfPages(document);
    if (pageCount == 0) { CGPDFDocumentRelease(document); return @{ @"status": @"invalid" }; }
    if (pageCount > kMaximumPages) { CGPDFDocumentRelease(document); return @{ @"status": @"page-limit" }; }

    NSMutableString *wholeText = [NSMutableString string];
    NSUInteger textPages = 0;
    size_t aggregatePixels = 0;
    NSCharacterSet *nonWhitespace = NSCharacterSet.whitespaceAndNewlineCharacterSet.invertedSet;
    for (size_t index = 1; index <= pageCount; index++) {
      @autoreleasepool {
        CGPDFPageRef page = CGPDFDocumentGetPage(document, index);
        if (page == NULL) { CGPDFDocumentRelease(document); return @{ @"status": @"invalid" }; }
        NSUInteger pagePixels = 0;
        BOOL pageTooLarge = NO;
        NSString *pageText = recognizePage(page, &pagePixels, &pageTooLarge);
        if (pageText == nil) {
          CGPDFDocumentRelease(document);
          return @{ @"status": pageTooLarge ? @"too-large" : @"unavailable" };
        }
        if (pagePixels > kMaximumAggregatePixels - aggregatePixels) {
          CGPDFDocumentRelease(document); return @{ @"status": @"too-large" };
        }
        aggregatePixels += pagePixels;
        if ([pageText rangeOfCharacterFromSet:nonWhitespace].location == NSNotFound) continue;

        NSString *prefix = [NSString stringWithFormat:@"%@[Page %zu]\n", wholeText.length == 0 ? @"" : @"\n\n", index];
        const NSUInteger additionBytes = [prefix lengthOfBytesUsingEncoding:NSUTF8StringEncoding] +
          [pageText lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
        const NSUInteger currentBytes = [wholeText lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
        if (additionBytes > kMaximumTextBytes || currentBytes > kMaximumTextBytes - additionBytes) {
          CGPDFDocumentRelease(document); return @{ @"status": @"too-large" };
        }
        [wholeText appendString:prefix];
        [wholeText appendString:pageText];
        textPages++;
      }
    }
    CGPDFDocumentRelease(document);
    if (textPages == 0) return @{ @"status": @"no-text", @"pages": @(pageCount), @"textPages": @0 };
    return @{ @"status": @"ready", @"text": wholeText, @"pages": @(pageCount), @"textPages": @(textPages) };
  } @catch (__unused NSException *exception) {
    return @{ @"status": @"unavailable" };
  }
}
