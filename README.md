# Ahoge Extensions

Maintained source definitions for the Ahoge iOS manga reader. This repository is configuration-only: native source runtimes live in `QuackyPROG/ahoge`, while this repository owns remotely updateable source identities, URLs, adapters, overrides, health metadata, and generated repository output.

## Install

In Ahoge, open **Browse / Sources → Source Repositories** and add:

```text
https://raw.githubusercontent.com/QuackyPROG/ahoge-extension/main/index.json
```

That URL has not changed. Users install the repository once; ordinary source-domain/API/configuration updates can then ship through this repository without an Ahoge rebuild when the installed app already contains the required runtime.

## Current catalog

- **12 tracked source identities** in the canonical catalog.
- **6 enabled sources**.
- **6/6 enabled sources healthy** in the latest committed end-to-end health snapshot.
- **6 tracked but disabled** because current health validation is blocked, degraded, or broken.
- **50 candidates evaluated/triaged** in `Docs/source-catalog-report.md`.

| Source | Engine | Lang | Health | Last verified | State |
|---|---|---|---|---|---|
| Asura Scans | `asuraScans` | en | healthy | 2026-10-12 | enabled |
| QiScans | `api/ezmanhwa` | en | healthy | 2026-10-12 | enabled |
| Omega Scans | `api/heancms` | en | healthy | 2026-10-12 | enabled |
| Kiryuu | `natsuId` | id | healthy | 2026-10-12 | enabled |
| Natsu | `natsuId` | id | healthy | 2026-10-12 | enabled |
| Rawkuma | `natsuId` | ja | healthy | 2026-10-12 | enabled |
| Manganato / NatoManga | `mangaBox` | en | blocked (HTTP 403 in CI) | 2026-10-12 | disabled |
| Mangabat | `mangaBox` | en | blocked (HTTP 403 in CI) | 2026-10-12 | disabled |
| Mangakakalot | `mangaBox` | en | blocked (HTTP 403 in CI) | 2026-10-12 | disabled |
| EZmanga | `api/ezmanhwa` | en | degraded (no free sampled page metadata) | 2026-10-12 | disabled |
| Ikiru | `natsuId` | id | broken (current manga endpoint HTTP 404) | 2026-10-12 | disabled |
| Lua Scans | `api/heancms` | en | blocked (HTTP 403 in CI) | 2026-10-12 | disabled |

`health/status.json` is a committed passing snapshot for the enabled set. Scheduled health runs publish machine-readable artifacts and only raise/update an issue when meaningful failures occur; they do not create a daily timestamp commit.

## Architecture

The source system is deliberately split into two layers:

1. **Native runtimes in Ahoge** implement reusable HTTP/parser behavior.
2. **Declarative source configuration here** supplies stable identity, domains, API URLs, rate limits, mirrors, adapters, and bounded source-specific overrides.

The currently executable runtime combinations are:

- `asuraScans`
- `natsuId`
- `mangaBox` + `mangabox`
- `api` + `ezmanhwa`
- `api` + `heancms`

Enums/classifiers for families such as `madara`, `mangaThemesia`, `fmReader`, and `foolSlide` exist in the app, but those are not treated as working runtimes until Swift implementations actually exist and pass tests/health validation. The candidate report uses that distinction when choosing the next engine family.

Remote manifests are untrusted data. The schemas only permit constrained values such as HTTPS URLs, known engine/adapter combinations, bounded request rates, mirrors, and known overrides. They do **not** support arbitrary JavaScript, shell commands, Swift evaluation, Android extension execution, or other remote executable code.

## Canonical data and generated output

`catalog/sources.json` is the canonical source catalog. Do not manually maintain duplicate source metadata in `sources/*.json` or `index.json`.

```text
.
├── catalog/
│   ├── sources.json          # canonical tracked source definitions
│   └── candidates.json       # 50-candidate scoring/evidence set
├── Docs/
│   └── source-catalog-report.md
├── health/
│   └── status.json
├── schema/
│   ├── catalog.schema.json
│   └── source.schema.json
├── sources/                  # generated enabled source packages only
├── scripts/
│   ├── build_index.py
│   ├── build_source_report.py
│   ├── healthcheck.py
│   ├── sync_upstreams.py
│   └── validate.py
├── index.json                # generated install surface
└── UPSTREAMS.md
```

Generate repository output with:

```bash
python3 scripts/build_index.py
python3 scripts/build_source_report.py
```

CI requires both generated outputs to match the canonical inputs exactly. Duplicate package IDs/source IDs, unsupported engine combinations, invalid URLs, unknown overrides, stale generated manifests, or hand-edited index drift fail validation.

## Health validation

Run all enabled sources:

```bash
python3 scripts/healthcheck.py --strict
```

The health checker validates, where the runtime supports it:

1. homepage/API response;
2. latest/popular listing parsing;
3. search parsing;
4. one manga-detail request;
5. chapter-list parsing;
6. chapter page-list **metadata** parsing.

It does not download/store chapter image payloads for CI. Requests use timeouts, retries, per-host throttling, and a dedicated user agent. Results distinguish `healthy`, `broken`, `blocked`, and `unsupported`; the catalog also records degraded/disabled decisions from manual review. An enabled source must pass current live health validation regardless of candidate score.

## Upstream synchronization

`scripts/sync_upstreams.py` monitors only selected/tracked modules. It currently detects:

- base URL and mirror changes;
- upstream source-name changes;
- multisrc-family changes;
- upstream module removal/unavailability;
- path revision changes indicating parser/code changes.

Low-risk domain/mirror metadata can be applied to a predictable `automation/upstream-sync` branch and PR after regeneration, validation, and live health checks. A code-only revision change remains review-required instead of pretending arbitrary Kotlin diffs are safe. Family switches or unavailable modules are high-risk and open/update a runtime-review issue rather than being silently marked healthy.

This repository never consumes APK/JAR/Kotlin binaries at runtime. Keiyoushi is an upstream reference, with attribution tracked in `UPSTREAMS.md`.

## GitHub Actions

- **PR validation**: schema validation, Python compile check, deterministic index/report checks, duplicate/runtime compatibility checks, and live health validation of enabled sources.
- **Scheduled health**: daily end-to-end checks with a machine-readable artifact and one maintained failure issue.
- **Scheduled upstream sync**: Monday/Wednesday/Friday drift scan with one predictable automation branch/PR for low-risk changes and review issues for high-risk changes.
- **Main/publish**: committed `index.json` is the raw repository consumed by Ahoge, so a validated merge makes the new catalog immediately available at the existing install URL.

## Adding or updating a source

1. Edit `catalog/sources.json`. Keep `packageId` and `sourceId` stable when domains/routes change.
2. Record upstream module/revision and maintenance tier. Update `UPSTREAMS.md` when attribution changes.
3. Run `python3 scripts/build_index.py`.
4. Run `python3 scripts/validate.py` and `python3 scripts/healthcheck.py --strict`.
5. If candidate decisions changed, update `catalog/candidates.json` and regenerate `Docs/source-catalog-report.md`.
6. Open a pull request and require both deterministic validation and live health CI to pass.

A source is not considered working merely because its JSON validates. Do not enable a source to hit a target count when health is blocked/broken or its runtime is not implemented.

## Compatibility

The existing Ahoge package/source IDs are preserved even when a source is disabled or its domain changes. In particular, the original source identities for Asura Scans, QiScans, Omega Scans, and Manganato remain stable.

A new Ahoge build is required only when a new runtime family/native capability is needed. Configuration changes understood by an existing runtime—domain, API endpoint, mirrors, request rate, or supported parser overrides—belong here.

## Next runtime work

The current candidate matrix points toward reusable families rather than 40+ bespoke parsers. The next implementation review should prioritize **Madara**, then **MangaThemesia** and **FMReader**, subject to source-specific health checks. Stable bespoke APIs such as MangaDex/WeebCentral can follow. Tier-4 sources that require browser challenges, custom signing, or image descrambling remain intentionally lower priority.

See `Docs/source-catalog-report.md` for the complete 50-candidate decision table and engineering rationale.

## License

See [LICENSE](LICENSE) and `UPSTREAMS.md`. Upstream reference code/configuration is subject to its original license and attribution requirements.
