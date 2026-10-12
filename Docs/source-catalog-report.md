# Source Catalog Report

> Generated from `catalog/candidates.json`. Scores are engineering prioritization inputs, not traffic measurements. The health gate overrides score: an untested, blocked, broken, or unsupported source cannot be enabled.

## Current result

- **50 candidates evaluated/triaged**.
- **6 enabled and live-health verified**: Asura Scans, QiScans, Omega Scans, Kiryuu, Natsu, Rawkuma.
- **6 tracked but disabled** after current health failures/blocks.
- **12 family-reviewed deferred candidates** that become cheap once shared runtimes are implemented.
- **4 high-value bespoke candidates** deferred until shared families are covered.
- **2 Tier-4 candidates rejected for now** because current upstream requires descrambling or challenge/signing logic.
- Remaining candidates stay in investigation/triage rather than being published without evidence.

## Engine/runtime matrix

| Engine family | Runtime exists | Manifest supported | Tested | Candidate source count |
|---|---:|---:|---:|---:|
| natsuId | Yes | Yes | Live health | 4 tracked / 3 healthy |
| asuraScans | Yes | Yes | Live health | 1 / 1 healthy |
| mangaBox | Yes | Yes | Live health | 3 / 0 healthy (CI blocked) |
| api / ezmanhwa | Yes | Yes | Live health | 2 / 1 healthy |
| api / heancms | Yes | Yes | Live health | 2 / 1 healthy |
| madara | No | Classifier/planned only | No | high leverage; next-runtime candidate |
| mangaThemesia | No | Classifier/planned only | No | multiple current upstream candidates |
| fmReader | No | Classifier/planned only | No | 4 family-reviewed candidates |
| foolSlide | No | Classifier/planned only | No | not yet shortlisted |

## Scoring

`score = popularity + engineFit + upstreamActivity + liveHealth + coverage + penalty`

- Popularity: `0–30` prioritization proxy. It is not claimed traffic/usage telemetry.
- Engine fit: `0–25`; already executable shared runtimes score highest.
- Upstream activity: `0–20`; current reviewed modules score above unverified seeds.
- Live health: `0–15`; only end-to-end current validation gets 15.
- Coverage: `0–10`; rewards useful language/catalog diversity.
- Penalty: negative score for blocking, failure, challenge solving, signing, descrambling, or comparable maintenance risk.

## Candidate decisions

| Source | Score | Engine | Maintenance tier | Health | Decision | Evidence | Reason |
|---|---:|---|---:|---|---|---|---|
| Asura Scans | 99 | asuraScans | 2 | healthy | include | health-verified | Current Ahoge runtime; end-to-end CI health passed. |
| QiScans | 90 | api/ezmanhwa | 1 | healthy | include | health-verified | Shared EZManhwa runtime; end-to-end CI health passed. |
| Omega Scans | 92 | api/heancms | 1 | healthy | include | health-verified | Shared HeanCMS runtime; end-to-end CI health passed. |
| Kiryuu | 89 | natsuId | 1 | healthy | include | health-verified | Shared NatsuId runtime with declarative chapter-page override; health passed. |
| Natsu | 82 | natsuId | 1 | healthy | include | health-verified | Shared NatsuId runtime; health passed after removing Kiryuu-specific hardcode. |
| Rawkuma | 88 | natsuId | 1 | healthy | include | health-verified | Shared NatsuId runtime adds Japanese/raw coverage; health passed. |
| Manganato / NatoManga | 62 | mangaBox | 1 | blocked | disable | health-verified | Existing stable Ahoge identity retained, but GitHub CI receives HTTP 403. |
| Mangabat | 51 | mangaBox | 1 | blocked | disable | health-verified | Shared MangaBox runtime fits, but CI search validation receives HTTP 403. |
| Mangakakalot | 62 | mangaBox | 1 | blocked | disable | health-verified | Shared MangaBox runtime fits, but current primary domain blocks CI with HTTP 403. |
| EZmanga | 57 | api/ezmanhwa | 1 | degraded | disable | health-verified | API parses, but live sample exposed no free chapter page metadata; fail closed. |
| Ikiru | 44 | natsuId | 1 | broken | disable | health-verified | Tracked WordPress manga endpoint returned HTTP 404 in live health validation. |
| Lua Scans | 48 | api/heancms | 1 | blocked | disable | health-verified | Runtime override is supported, but the site returns HTTP 403 to CI. |
| WeebCentral | 72 | custom/API | 2 | not-tested | defer | upstream-reviewed | High-value custom KeiSource. Good candidate for a stable bespoke Swift adapter; no current Ahoge runtime. |
| MangaDex | 75 | custom/API | 2 | not-tested | defer | upstream-reviewed | Stable public API/CDN shape, but needs a dedicated native adapter and DTO mappings. |
| Kagane | 67 | custom/API | 2 | not-tested | defer | upstream-reviewed | Current custom KeiSource; attractive bespoke API candidate once shared families are covered. |
| Atsumaru | 66 | custom/API | 2 | not-tested | defer | upstream-reviewed | Current custom KeiSource; mixed-content catalog and source-specific API logic need a native adapter. |
| Comix | 30 | custom/descrambler | 4 | unsupported | reject-now | upstream-reviewed | Current upstream contains image descrambling logic. High-maintenance native image pipeline, not a first-50 runtime target. |
| MangaFire | 28 | custom/VRF/challenge | 4 | unsupported | reject-now | upstream-reviewed | Current upstream uses VRF signing plus WebView/OpenCV challenge solving. Explicit Tier 4. |
| AllManga | 49 | custom/API | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| MangaPark | 49 | unresolved | 3 | not-tested | investigate | seed-triage | Seed is ambiguous against current upstream naming; do not bind an Ahoge identity until the intended site/module is verified. |
| MangaGo | 44 | custom | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| VyManga | 44 | custom | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| MangaTaro | 44 | custom | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| MangaDotNet | 40 | custom | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| Qtoon | 40 | custom | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| Toonly | 40 | custom | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| Project Suki | 40 | custom | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| ReadComicOnline | 40 | custom | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| Webtoon | 45 | custom/API | 3 | not-tested | investigate | seed-triage | Popular seed from the project brief, but no compatible Ahoge runtime has been verified in this phase. |
| MadaraDex | 57 | madara | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi madara source. High leverage once Ahoge implements the shared madara runtime. |
| Madara Scans | 60 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| Rackus | 54 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| Razure | 52 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| MangaTX | 62 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| Ngomik | 56 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| Noromax | 54 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| Omicaso | 54 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| RawLH | 55 | fmReader | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi fmReader source. High leverage once Ahoge implements the shared fmReader runtime. |
| RawInu | 53 | fmReader | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi fmReader source. High leverage once Ahoge implements the shared fmReader runtime. |
| MangaGun | 54 | fmReader | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi fmReader source. High leverage once Ahoge implements the shared fmReader runtime. |
| WeLoveMangaOne | 53 | fmReader | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi fmReader source. High leverage once Ahoge implements the shared fmReader runtime. |
| ComicK | 48 | custom/API | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |
| Bato.to | 49 | custom | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |
| MangaSee | 44 | custom | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |
| MangaLife | 44 | custom | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |
| MangaBuddy | 44 | custom | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |
| Reaper Scans | 44 | custom | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |
| Flame Comics | 40 | custom | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |
| Rizz Comics | 39 | custom | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |
| Temple Scan | 38 | custom | 3 | not-tested | investigate | triage | Useful catalog candidate, but current upstream module/family and live behavior still require verification before implementation. |

## Implementation order

1. Keep the six enabled sources behind daily health validation; do not republish blocked sources merely because their runtime still parses locally.
2. Implement **Madara** next if source-specific review confirms enough healthy Tier-1 candidates; it offers the highest likely source-per-runtime leverage.
3. Implement **MangaThemesia** after/alongside Madara, then **FMReader** for Japanese/raw coverage.
4. Add a small number of Tier-2 bespoke APIs after shared-family coverage. MangaDex and WeebCentral are stronger candidates than Tier-4 browser/crypto sites.
5. Keep MangaFire and Comix out until there is a deliberate decision to own challenge/VRF or image-descrambling maintenance.

## Evidence notes

- `health-verified` means the source was exercised by `scripts/healthcheck.py` through catalog/search/detail/chapter/page-metadata parsing without downloading chapter image payloads.
- `upstream-reviewed` means current upstream implementation characteristics were inspected at the tracked Keiyoushi revision.
- `family-reviewed` means the current upstream module was identified as a member of the named reusable family, but Ahoge cannot live-test it until that runtime exists.
- `seed-triage` and `triage` are intentionally weaker. They remain investigation candidates and must not be treated as working sources.

## Why popular sources are sometimes excluded

Popularity does not override maintenance cost or health. MangaFire is a concrete example: current upstream includes VRF signing and browser/OpenCV challenge solving, so it is Tier 4 despite high popularity. Comix includes image descrambling, which also makes it Tier 4. Manganato/Mangakakalot score well on popularity and engine fit, but the current CI environment receives HTTP 403, so they remain disabled.
