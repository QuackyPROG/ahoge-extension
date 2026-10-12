# Source Catalog Report

> Generated from `catalog/candidates.json` and the canonical `catalog/sources.json`. Scores are engineering prioritization inputs, not traffic measurements. The health gate overrides score: an untested, blocked, broken, or unsupported source cannot be enabled.

## Current result

- **50 candidates evaluated/triaged**.
- **16 enabled sources in the public index**: Asura Scans, QiScans, Omega Scans, EZmanga, Kiryuu, Natsu, Rawkuma, S2Manga, Rackus, Ngomik, Noromax, NekoScans, LianScans, Scythe Scans, MangaDex, WeebCentral.
- **14 additional cataloged sources are tracked but disabled** after health failures/blocks or compatibility review.
- Sources outside the canonical catalog remain investigation candidates until they have a bounded native runtime and current live-health evidence.
- Tier-4 candidates that require browser challenges, signing, or image descrambling remain intentionally excluded.

## Engine/runtime matrix

| Engine family | Runtime exists | Manifest supported | Tested | Catalog status |
|---|---:|---:|---:|---:|
| natsuId | Yes | Yes | Live health | 4 tracked / 3 enabled |
| asuraScans | Yes | Yes | Live health | 1 tracked / 1 enabled |
| mangaBox | Yes | Yes | Live health | 3 tracked / 0 enabled |
| api / ezmanhwa | Yes | Yes | Live health | 2 tracked / 2 enabled |
| api / heancms | Yes | Yes | Live health | 2 tracked / 1 enabled |
| api / mangadex | Yes | Yes | Live health | 1 tracked / 1 enabled |
| api / weebcentral | Yes | Yes | Live health | 1 tracked / 1 enabled |
| madara | Yes | Yes | Live health | 6 tracked / 1 enabled |
| mangaThemesia | Yes | Yes | Live health | 10 tracked / 6 enabled |
| fmReader | No | No | No | 0 tracked |
| foolSlide | No | No | No | 0 tracked |

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
| EZmanga | 82 | api/ezmanhwa | 1 | healthy | include | health-verified | Shared EZManhwa runtime; complete Ahoge live-health validation passed on retest. |
| Ikiru | 44 | natsuId | 1 | broken | disable | health-verified | Tracked WordPress manga endpoint returned HTTP 404 in live health validation. |
| Lua Scans | 48 | api/heancms | 1 | blocked | disable | health-verified | Runtime override is supported, but the site returns HTTP 403 to CI. |
| WeebCentral | 100 | api/weebcentral | 2 | healthy | include | health-verified | Dedicated native public WeebCentral reading adapter; complete Ahoge live-health validation passed. |
| MangaDex | 100 | api/mangadex | 2 | healthy | include | health-verified | Dedicated native public MangaDex v5 API/MangaDex@Home adapter; complete Ahoge live-health validation passed. |
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
| Rackus | 80 | mangaThemesia | 1 | healthy | include | health-verified | Shared MangaThemesia common-subset runtime; complete Ahoge live-health validation passed. |
| Razure | 52 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| MangaTX | 62 | mangaThemesia | 1 | unsupported | defer-engine | family-reviewed | Current Keiyoushi mangaThemesia source. High leverage once Ahoge implements the shared mangaThemesia runtime. |
| Ngomik | 82 | mangaThemesia | 1 | healthy | include | health-verified | Shared MangaThemesia common-subset runtime; complete Ahoge live-health validation passed. |
| Noromax | 80 | mangaThemesia | 1 | healthy | include | health-verified | Shared MangaThemesia common-subset runtime; complete Ahoge live-health validation passed. |
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

1. Keep every enabled source behind the strict scheduled health gate; do not preserve a source in the public index merely because it worked previously.
2. Continue adding Madara/MangaThemesia sites only when their current markup fits the bounded common runtimes and passes end-to-end health.
3. FMReader remains deferred: the current upstream family is small and its active sites require substantial source-specific behavior, so it does not currently justify a broad shared runtime.
4. MangaDex and WeebCentral now have dedicated bounded native adapters. Evaluate the remaining Tier-2 bespoke candidates such as Kagane and Atsumaru individually rather than adding generic remote scripting.
5. Keep MangaFire and Comix out until there is a deliberate decision to own challenge/VRF or image-descrambling maintenance.

## Evidence notes

- `health-verified` means the source was exercised by `scripts/health_all.py` through browse/search/detail/chapter/page-metadata parsing without downloading chapter image payloads.
- `upstream-reviewed` means current upstream implementation characteristics were inspected at the tracked Keiyoushi revision.
- `family-reviewed` means the current upstream module was identified as a member of the named reusable family, but source-specific live behavior has not been proven by the current Ahoge health gate.
- `seed-triage` and `triage` are intentionally weaker. They remain investigation candidates and must not be treated as working sources.

## Why popular sources are sometimes excluded

Popularity does not override maintenance cost or health. MangaFire is a concrete example: current upstream includes VRF signing and browser/OpenCV challenge solving, so it is Tier 4 despite high popularity. Comix includes image descrambling, which also makes it Tier 4. Manganato/Mangakakalot score well on popularity and engine fit, but the current CI environment has returned HTTP 403, so they remain disabled.
