# Upstream references and attribution

Ahoge does **not** execute Android extensions, APKs, JARs, or Kotlin binaries. `keiyoushi/extensions-source` is used as a reference for current source metadata, multisrc-family classification, routes/API behavior, and maintenance activity.

The Keiyoushi repository was verified as Apache-2.0 at the initially tracked revision below. This file records the upstream modules used by the canonical Ahoge catalog. If native Swift runtime logic is later materially translated from an upstream implementation, preserve the applicable copyright/license notices in the Ahoge app repository as well.

Tracked initial revision: `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0`

| Ahoge source | Upstream repository | Upstream module/path | Family | License | Initial tracked revision |
|---|---|---|---|---|---|
| Asura Scans | `keiyoushi/extensions-source` | `src/en/asurascans` | custom | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| QiScans | `keiyoushi/extensions-source` | `src/en/qiscans` | ezmanhwa | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Omega Scans | `keiyoushi/extensions-source` | `src/en/omegascans` | heancms | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Manganato / NatoManga | `keiyoushi/extensions-source` | `src/en/manganelo` | mangabox | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Mangabat | `keiyoushi/extensions-source` | `src/en/mangabat` | mangabox | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Mangakakalot | `keiyoushi/extensions-source` | `src/en/mangakakalot` | mangabox | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| EZmanga | `keiyoushi/extensions-source` | `src/en/ezmanga` | ezmanhwa | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Kiryuu | `keiyoushi/extensions-source` | `src/id/kiryuu` | natsuid | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Natsu | `keiyoushi/extensions-source` | `src/id/natsu` | natsuid | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Ikiru | `keiyoushi/extensions-source` | `src/id/ikiru` | natsuid | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Rawkuma | `keiyoushi/extensions-source` | `src/ja/rawkuma` | natsuid | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |
| Lua Scans | `keiyoushi/extensions-source` | `src/en/luascans` | heancms | Apache-2.0 | `b5d2cd5c3d23a3408c7daa3eb807668aedfce3e0` |

## Additional implementation research

These modules were reviewed for prioritization but are **not** currently published by Ahoge:

| Candidate | Upstream path | Finding |
|---|---|---|
| WeebCentral | `src/en/weebcentral` | Custom `KeiSource`; candidate for a stable bespoke adapter. |
| MangaDex | `src/all/mangadex` | Dedicated API/CDN integration; candidate for a Tier-2 native API adapter. |
| Kagane | `src/all/kagane` | Custom `KeiSource`; requires a native adapter. |
| Atsumaru | `src/en/atsumaru` | Custom `KeiSource`; requires a native adapter. |
| Comix | `src/en/comix` | Contains image descrambling logic; treated as Tier 4. |
| MangaFire | `src/all/mangafire` | Uses VRF signing and browser/OpenCV challenge solving; treated as Tier 4. |

The canonical catalog and candidate report are the source of truth for enable/disable decisions. An upstream module being present does not imply it is compatible with Ahoge or currently healthy.
