/* Test-only raster generator. It receives text and dimensions, never reads files. */
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

#include <stdio.h>
#include <stdlib.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 4) return 2;
    const size_t width = (size_t)strtoull(argv[1], NULL, 10);
    const size_t height = (size_t)strtoull(argv[2], NULL, 10);
    if (width == 0 || height == 0 || width > 3000 || height > 3000) return 2;
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, width * 4, space,
      kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(space);
    if (context == NULL) return 3;
    CGContextSetRGBFillColor(context, 1, 1, 1, 1);
    CGContextFillRect(context, CGRectMake(0, 0, width, height));

    NSString *text = [NSString stringWithUTF8String:argv[3]];
    if (text.length != 0) {
      CTFontRef font = CTFontCreateWithName(CFSTR("Helvetica-Bold"), 76, NULL);
      CGColorRef black = CGColorCreateGenericGray(0, 1);
      NSDictionary *attributes = @{
        (__bridge id)kCTFontAttributeName: (__bridge id)font,
        (__bridge id)kCTForegroundColorAttributeName: (__bridge id)black,
      };
      NSAttributedString *attributed = [[NSAttributedString alloc] initWithString:text attributes:attributes];
      CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)attributed);
      CGContextSetTextPosition(context, 24, height / 2);
      CTLineDraw(line, context);
      CFRelease(line);
      CFRelease(black);
      CFRelease(font);
    }

    CGImageRef image = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    NSMutableData *data = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data,
      CFSTR("public.png"), 1, NULL);
    if (image == NULL || destination == NULL) return 3;
    CGImageDestinationAddImage(destination, image, NULL);
    const BOOL complete = CGImageDestinationFinalize(destination);
    CFRelease(destination);
    CGImageRelease(image);
    if (!complete) return 3;
    return fwrite(data.bytes, 1, data.length, stdout) == data.length ? 0 : 3;
  }
}
