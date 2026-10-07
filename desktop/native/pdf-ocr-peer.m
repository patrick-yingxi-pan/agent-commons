#import "pdf-ocr-peer.h"
#import <Security/Security.h>

static NSDictionary *signature(NSURL *url, SecStaticCodeRef *codeOut) {
  SecStaticCodeRef code = NULL;
  if (SecStaticCodeCreateWithPath((__bridge CFURLRef)url, kSecCSDefaultFlags, &code) != errSecSuccess) return nil;
  if (SecStaticCodeCheckValidity(code, kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode, NULL) != errSecSuccess) {
    CFRelease(code); return nil;
  }
  CFDictionaryRef info = NULL;
  if (SecCodeCopySigningInformation(code, kSecCSSigningInformation, &info) != errSecSuccess) {
    CFRelease(code); return nil;
  }
  *codeOut = code;
  return CFBridgingRelease(info);
}

NSString *ACBrokerRequirement(void) {
  // The service sandbox intentionally cannot read its parent app directory.
  // Its own sealed identity therefore supplies the production trust anchor.
  SecStaticCodeRef ownCode = NULL;
  NSDictionary *own = signature(NSBundle.mainBundle.bundleURL, &ownCode);
  if (!own) return nil;
  NSString *team = own[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
  NSString *result = nil;
  if (team.length > 0) {
    NSString *const developerID = @"anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists";
    SecRequirementRef anchor = NULL;
    NSRegularExpression *teamPattern = [NSRegularExpression regularExpressionWithPattern:@"\\A[A-Z0-9]{10}\\z" options:0 error:NULL];
    if ([teamPattern numberOfMatchesInString:team options:0 range:NSMakeRange(0, team.length)] == 1 &&
        SecRequirementCreateWithString((__bridge CFStringRef)developerID, kSecCSDefaultFlags, &anchor) == errSecSuccess &&
        SecStaticCodeCheckValidity(ownCode, kSecCSStrictValidate, anchor) == errSecSuccess) {
      result = [NSString stringWithFormat:@"%@ and certificate leaf[subject.OU] = \"%@\" and identifier \"%@\"", developerID, team, AC_PDF_OCR_BROKER_ID];
    }
    if (anchor) CFRelease(anchor);
  } else if ([own[(__bridge NSString *)kSecCodeInfoFlags] unsignedIntValue] & kSecCodeSignatureAdhoc) {
    // Local unsigned builds still pin the exact standalone transport cdhash.
    // That transport is signed before this service, avoiding circular seals.
    // This branch is never available to a Developer ID signed service.
    NSString *requirement = NSBundle.mainBundle.infoDictionary[@"ACPdfOcrAdHocBrokerRequirement"];
    NSRegularExpression *hashPattern = [NSRegularExpression regularExpressionWithPattern:@"\\Acdhash H\"[a-f0-9]{40}\"\\z" options:0 error:NULL];
    if ([requirement isKindOfClass:NSString.class] &&
        [hashPattern numberOfMatchesInString:requirement options:0 range:NSMakeRange(0, requirement.length)] == 1) result = requirement;
  }
  CFRelease(ownCode);
  return result;
}

NSString *ACPeerRequirement(NSURL *peerURL, NSString *expectedIdentifier) {
  SecStaticCodeRef ownCode = NULL, peerCode = NULL;
  NSDictionary *own = signature(NSBundle.mainBundle.bundleURL, &ownCode);
  NSDictionary *peer = signature(peerURL, &peerCode);
  NSString *result = nil;
  if (own && peer && [peer[(__bridge NSString *)kSecCodeInfoIdentifier] isEqual:expectedIdentifier]) {
    NSString *ownTeam = own[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
    NSString *peerTeam = peer[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
    const BOOL bothAdHoc = !ownTeam && !peerTeam &&
      ([own[(__bridge NSString *)kSecCodeInfoFlags] unsignedIntValue] & kSecCodeSignatureAdhoc) &&
      ([peer[(__bridge NSString *)kSecCodeInfoFlags] unsignedIntValue] & kSecCodeSignatureAdhoc);
    if (bothAdHoc || (ownTeam.length > 0 && [ownTeam isEqual:peerTeam])) {
      SecRequirementRef requirement = NULL;
      if (SecCodeCopyDesignatedRequirement(peerCode, kSecCSDefaultFlags, &requirement) == errSecSuccess) {
        CFStringRef text = NULL;
        if (SecRequirementCopyString(requirement, kSecCSDefaultFlags, &text) == errSecSuccess) result = CFBridgingRelease(text);
        CFRelease(requirement);
      }
    }
  }
  if (ownCode) CFRelease(ownCode);
  if (peerCode) CFRelease(peerCode);
  return result;
}
