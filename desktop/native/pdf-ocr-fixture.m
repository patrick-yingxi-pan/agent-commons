/* Test-only generator for image-only PDF scans; no text objects are written. */
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static CGImageRef scannedPage(NSString *text, size_t width, size_t height) {
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef bitmap = CGBitmapContextCreate(NULL, width, height, 8, width * 4, space,
    kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (bitmap == NULL) return NULL;
  CGContextSetRGBFillColor(bitmap, 1, 1, 1, 1);
  CGContextFillRect(bitmap, CGRectMake(0, 0, width, height));
  if (text.length != 0) {
    CTFontRef font = CTFontCreateWithName(CFSTR("Helvetica-Bold"), 22, NULL);
    CGColorRef black = CGColorCreateGenericGray(0, 1);
    NSDictionary *attributes = @{
      (__bridge id)kCTFontAttributeName: (__bridge id)font,
      (__bridge id)kCTForegroundColorAttributeName: (__bridge id)black,
    };
    NSAttributedString *attributed = [[NSAttributedString alloc] initWithString:text attributes:attributes];
    CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)attributed);
    CGContextSetTextPosition(bitmap, 90, height / 2);
    CTLineDraw(line, bitmap);
    CFRelease(line);
    CFRelease(black);
    CFRelease(font);
  }
  CGImageRef image = CGBitmapContextCreateImage(bitmap);
  CGContextRelease(bitmap);
  return image;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    const char *mode = argv[1];
    const BOOL protectedPDF = strcmp(mode, "protected") == 0;
    const BOOL blank = strcmp(mode, "blank") == 0 || strcmp(mode, "protected") == 0 || strcmp(mode, "pages101") == 0;
    const size_t pageCount = strcmp(mode, "pages101") == 0 ? 101 : 2;
    if (!blank && strcmp(mode, "scanned") != 0) return 2;

    NSMutableData *data = [NSMutableData data];
    CGDataConsumerRef consumer = CGDataConsumerCreateWithCFData((__bridge CFMutableDataRef)data);
    if (consumer == NULL) return 3;
    CGRect mediaBox = CGRectMake(0, 0, 612, 792);
    NSDictionary *options = protectedPDF ? @{
      (__bridge id)kCGPDFContextOwnerPassword: @"fixture-owner-password",
      (__bridge id)kCGPDFContextAllowsCopying: @NO,
      (__bridge id)kCGPDFContextEncryptionKeyLength: @128,
    } : @{};
    CGContextRef pdf = CGPDFContextCreate(consumer, &mediaBox, (__bridge CFDictionaryRef)options);
    CGDataConsumerRelease(consumer);
    if (pdf == NULL) return 3;
    for (size_t index = 0; index < pageCount; index++) {
      @autoreleasepool {
        const CGRect pageBox = index == 0 ? CGRectMake(0, 0, 612, 792) : CGRectMake(0, 0, 595.28, 841.89);
        CGContextBeginPage(pdf, &pageBox);
        if (!blank) {
          NSString *text = index == 0 ? @"Scan Alpha 427" : @"Scan Bravo 813";
          const size_t imageWidth = index == 0 ? 1275 : 1240;
          const size_t imageHeight = index == 0 ? 1650 : 1754;
          CGImageRef image = scannedPage(text, imageWidth, imageHeight);
          if (image == NULL) { CGContextRelease(pdf); return 3; }
          CGContextDrawImage(pdf, pageBox, image);
          CGImageRelease(image);
        }
        CGContextEndPage(pdf);
      }
    }
    CGPDFContextClose(pdf);
    CGContextRelease(pdf);
    return fwrite(data.bytes, 1, data.length, stdout) == data.length ? 0 : 3;
  }
}
