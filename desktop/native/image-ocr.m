/*
 * Stdin-only, bounded PNG text recognition for the desktop image review flow.
 * This helper accepts no path, URL, language, or Vision options from callers.
 */
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
  kMaximumInputBytes = 3 * 1024 * 1024,
  kMaximumDimension = 2000,
  kMaximumTextBytes = 64 * 1024
};

static void writeJson(NSDictionary<NSString *, id> *payload) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&error];
  if (data == nil || error != nil) {
    static const char fallback[] = "{\"status\":\"unavailable\"}\n";
    (void)fwrite(fallback, 1, sizeof(fallback) - 1, stdout);
    return;
  }
  (void)fwrite(data.bytes, 1, data.length, stdout);
  (void)fwrite("\n", 1, 1, stdout);
}

static void writeStatus(NSString *status) {
  writeJson(@{ @"status": status });
}

static BOOL readInput(uint8_t **bytesOut, size_t *lengthOut) {
  const size_t capacity = (size_t)kMaximumInputBytes + 1;
  uint8_t *bytes = malloc(capacity);
  if (bytes == NULL) return NO;

  size_t length = 0;
  while (length < capacity) {
    const size_t count = fread(bytes + length, 1, capacity - length, stdin);
    length += count;
    if (count == 0) {
      if (ferror(stdin)) {
        free(bytes);
        return NO;
      }
      break;
    }
  }

  *bytesOut = bytes;
  *lengthOut = length;
  return YES;
}

static BOOL pngDimensions(CGImageSourceRef source, size_t *widthOut, size_t *heightOut) {
  CFStringRef type = source == NULL ? NULL : CGImageSourceGetType(source);
  if (type == NULL || CFStringCompare(type, CFSTR("public.png"), 0) != kCFCompareEqualTo ||
      CGImageSourceGetCount(source) != 1 || CGImageSourceGetStatus(source) != kCGImageStatusComplete) return NO;

  CFDictionaryRef properties = CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
  if (properties == NULL) return NO;
  CFTypeRef widthValue = CFDictionaryGetValue(properties, kCGImagePropertyPixelWidth);
  CFTypeRef heightValue = CFDictionaryGetValue(properties, kCGImagePropertyPixelHeight);
  long long width = 0;
  long long height = 0;
  const BOOL valid = widthValue != NULL && heightValue != NULL &&
    CFGetTypeID(widthValue) == CFNumberGetTypeID() && CFGetTypeID(heightValue) == CFNumberGetTypeID() &&
    CFNumberGetValue((CFNumberRef)widthValue, kCFNumberLongLongType, &width) &&
    CFNumberGetValue((CFNumberRef)heightValue, kCFNumberLongLongType, &height) &&
    width >= 1 && width <= kMaximumDimension && height >= 1 && height <= kMaximumDimension;
  CFRelease(properties);
  if (!valid) return NO;
  *widthOut = (size_t)width;
  *heightOut = (size_t)height;
  return YES;
}

static uint32_t readBigEndian32(const uint8_t *bytes) {
  return ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) |
    ((uint32_t)bytes[2] << 8) | (uint32_t)bytes[3];
}

static uint32_t pngCrc32(const uint8_t *bytes, size_t length) {
  uint32_t crc = 0xffffffffU;
  for (size_t index = 0; index < length; index++) {
    crc ^= bytes[index];
    for (unsigned bit = 0; bit < 8; bit++) {
      crc = (crc >> 1) ^ ((crc & 1U) ? 0xedb88320U : 0U);
    }
  }
  return crc ^ 0xffffffffU;
}

static BOOL validPngFraming(const uint8_t *bytes, size_t length) {
  static const uint8_t signature[] = { 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a };
  static const uint8_t headerType[] = { 'I', 'H', 'D', 'R' };
  static const uint8_t paletteType[] = { 'P', 'L', 'T', 'E' };
  static const uint8_t dataType[] = { 'I', 'D', 'A', 'T' };
  static const uint8_t endType[] = { 'I', 'E', 'N', 'D' };
  if (length < sizeof(signature) || memcmp(bytes, signature, sizeof(signature)) != 0) return NO;
  size_t offset = sizeof(signature);
  BOOL sawHeader = NO;
  BOOL sawPalette = NO;
  BOOL sawData = NO;
  BOOL dataClosed = NO;
  uint32_t seenAncillary = 0;
  while (offset < length) {
    if (length - offset < 12) return NO;
    const uint32_t chunkLength = readBigEndian32(bytes + offset);
    if ((size_t)chunkLength > length - offset - 12) return NO;
    const uint8_t *type = bytes + offset + 4;
    const size_t checksumOffset = offset + 8 + (size_t)chunkLength;
    const uint32_t expectedCrc = readBigEndian32(bytes + checksumOffset);
    if (pngCrc32(type, (size_t)chunkLength + 4) != expectedCrc) return NO;
    if (!sawHeader) {
      if (memcmp(type, headerType, sizeof(headerType)) != 0 || chunkLength != 13) return NO;
      sawHeader = YES;
    } else if (memcmp(type, headerType, sizeof(headerType)) == 0) return NO;
    const BOOL isData = memcmp(type, dataType, sizeof(dataType)) == 0;
    const BOOL isEnd = memcmp(type, endType, sizeof(endType)) == 0;
    if (isData) {
      if (dataClosed || !sawHeader) return NO;
      sawData = YES;
    } else if (sawData && !isEnd) {
      dataClosed = YES;
    }
    if (memcmp(type, paletteType, sizeof(paletteType)) == 0) {
      if (sawPalette || sawData || chunkLength < 3 || chunkLength > 768 || chunkLength % 3 != 0) return NO;
      sawPalette = YES;
    } else if (memcmp(type, (const uint8_t[]){ 's', 'R', 'G', 'B' }, 4) == 0) {
      if (chunkLength != 1 || sawData || (seenAncillary & (1U << 0)) != 0) return NO;
      seenAncillary |= 1U << 0;
    } else if (memcmp(type, (const uint8_t[]){ 'e', 'X', 'I', 'f' }, 4) == 0) {
      if (chunkLength > 65536 || sawData || (seenAncillary & (1U << 1)) != 0) return NO;
      seenAncillary |= 1U << 1;
    } else if (memcmp(type, (const uint8_t[]){ 'g', 'A', 'M', 'A' }, 4) == 0) {
      if (chunkLength != 4 || sawData || (seenAncillary & (1U << 2)) != 0) return NO;
      seenAncillary |= 1U << 2;
    } else if (memcmp(type, (const uint8_t[]){ 'c', 'H', 'R', 'M' }, 4) == 0) {
      if (chunkLength != 32 || sawData || (seenAncillary & (1U << 3)) != 0) return NO;
      seenAncillary |= 1U << 3;
    } else if (memcmp(type, (const uint8_t[]){ 'p', 'H', 'Y', 's' }, 4) == 0) {
      if (chunkLength != 9 || sawData || (seenAncillary & (1U << 4)) != 0) return NO;
      seenAncillary |= 1U << 4;
    } else if (memcmp(type, (const uint8_t[]){ 's', 'B', 'I', 'T' }, 4) == 0) {
      if (chunkLength < 1 || chunkLength > 4 || sawData || (seenAncillary & (1U << 5)) != 0) return NO;
      seenAncillary |= 1U << 5;
    } else if (memcmp(type, (const uint8_t[]){ 'b', 'K', 'G', 'D' }, 4) == 0) {
      if (chunkLength < 1 || chunkLength > 6 || sawData || (seenAncillary & (1U << 6)) != 0) return NO;
      seenAncillary |= 1U << 6;
    } else if (memcmp(type, (const uint8_t[]){ 't', 'R', 'N', 'S' }, 4) == 0) {
      if (chunkLength > 768 || sawData || (seenAncillary & (1U << 7)) != 0) return NO;
      seenAncillary |= 1U << 7;
    } else if (!isData && !isEnd && memcmp(type, headerType, sizeof(headerType)) != 0) {
      /* Unknown ancillary chunks may be compressed metadata; critical unknowns
       * and APNG animation chunks are likewise outside this still-image input. */
      return NO;
    }
    offset = checksumOffset + 4;
    if (isEnd) return chunkLength == 0 && sawHeader && sawData && offset == length;
  }
  return NO;
}

static void recognize(const uint8_t *bytes, size_t length) {
  if (!validPngFraming(bytes, length)) {
    writeStatus(@"invalid");
    return;
  }

  @try {
    NSData *data = [NSData dataWithBytes:bytes length:length];
    CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
    if (source == NULL) {
      writeStatus(@"invalid");
      return;
    }

    size_t width = 0;
    size_t height = 0;
    if (!pngDimensions(source, &width, &height)) {
      CFRelease(source);
      writeStatus(@"invalid");
      return;
    }

    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    const BOOL completeFrame = CGImageSourceGetStatusAtIndex(source, 0) == kCGImageStatusComplete;
    CFRelease(source);
    if (image == NULL || !completeFrame || CGImageGetWidth(image) != width || CGImageGetHeight(image) != height) {
      if (image != NULL) CGImageRelease(image);
      writeStatus(@"invalid");
      return;
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.revision = VNRecognizeTextRequestRevision3;
    request.automaticallyDetectsLanguage = YES;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    NSError *error = nil;
    const BOOL completed = [handler performRequests:@[ request ] error:&error];
    CGImageRelease(image);
    if (!completed || error != nil) {
      writeStatus(@"unavailable");
      return;
    }

    NSMutableString *text = [NSMutableString string];
    NSUInteger textBytes = 0;
    NSCharacterSet *nonWhitespace = NSCharacterSet.whitespaceAndNewlineCharacterSet.invertedSet;
    for (VNRecognizedTextObservation *observation in request.results ?: @[]) {
      VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
      if (candidate == nil || candidate.string.length == 0 ||
          [candidate.string rangeOfCharacterFromSet:nonWhitespace].location == NSNotFound) continue;
      const NSUInteger lineBytes = [candidate.string lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
      const NSUInteger separatorBytes = text.length == 0 ? 0 : 1;
      if (lineBytes == 0 || lineBytes > kMaximumTextBytes - separatorBytes ||
          textBytes > kMaximumTextBytes - lineBytes - separatorBytes) {
        writeStatus(@"too-large");
        return;
      }
      if (separatorBytes != 0) [text appendString:@"\n"];
      [text appendString:candidate.string];
      textBytes += separatorBytes + lineBytes;
    }
    if (text.length == 0) {
      writeStatus(@"no-text");
      return;
    }
    writeJson(@{ @"status": @"ready", @"text": text });
  } @catch (__unused NSException *exception) {
    writeStatus(@"unavailable");
  }
}

int main(int argc, const char *argv[]) {
  (void)argv;
  @autoreleasepool {
    if (argc != 1) {
      writeStatus(@"invalid");
      return 0;
    }

    uint8_t *bytes = NULL;
    size_t length = 0;
    if (!readInput(&bytes, &length)) {
      writeStatus(@"unavailable");
      return 0;
    }
    if (length > kMaximumInputBytes) {
      free(bytes);
      writeStatus(@"too-large");
      return 0;
    }
    recognize(bytes, length);
    free(bytes);
  }
  return 0;
}
