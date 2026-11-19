# Partner identity data

The registry reads these checked-in tables at startup. Name comparisons and domain admission therefore use the same data during onboarding, directory lookups, and background verification.

| File | Source and representation |
| --- | --- |
| `unicode17.txt` | Unicode 17.0.0. Each section header records the SHA-256 digest of the upstream bytes. The rows retain the code-point range and value for NFKC_CF from [DerivedNormalizationProps](https://www.unicode.org/Public/17.0.0/ucd/DerivedNormalizationProps.txt), prototypes from [confusables](https://www.unicode.org/Public/17.0.0/security/confusables.txt), assigned non-L classes from [DerivedBidiClass](https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedBidiClass.txt), and the [mirroring](https://www.unicode.org/Public/17.0.0/ucd/BidiMirroring.txt) and [bracket](https://www.unicode.org/Public/17.0.0/ucd/BidiBrackets.txt) properties. The [Unicode license](UNICODE-LICENSE.txt) applies. |
| `public-suffix-list.dat` | Pinned [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat), including ICANN and private rules. The header retains the release timestamp, source revision and [MPL 2.0 notice and license](MPL-2.0.txt). Comment-only lines after the header were removed. |

When updating the tables, review the upstream changes, test the pinned name and host vectors, and rebuild the directory index before serving changed match results. Active permissions continue to use the permanent partner ID, evidence revision, and exact ASCII domain.
