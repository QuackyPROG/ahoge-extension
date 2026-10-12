# Ahoge Extensions

Maintained source definitions for Ahoge. This repository is independent from the Ahoge iOS application: it contains source configuration and adapter selection, not application UI, reader code, persistence, or Xcode project files.

## Install

In Ahoge, open **Browse / Sources → Source Repositories** and add:

```text
https://raw.githubusercontent.com/QuackyPROG/ahoge-extension/main/index.json
```

That single repository URL exposes all maintained sources. Users should not need to install the individual files under `sources/`.

## Available sources

- Asura Scans — `asuraScans`
- QiScans — `api` + `ezmanhwa`
- Omega Scans — `api` + `heancms`
- Manganato / NatoManga — `mangaBox` + `mangabox`

## Repository layout

```text
.
├── index.json
├── schema/source.schema.json
├── sources/
│   ├── asurascans.json
│   ├── qiscans.json
│   ├── omegascans.json
│   └── manganato.json
└── scripts/validate.py
```

`index.json` is the install surface Ahoge consumes. The per-source files are the canonical maintained definitions and are validated against the same manifest contract.

## Manifest contract

Each package declares `name`, `pkg`, `lang`, `version`, `nsfw`, and one or more `sources`. Each source declares a stable `id`, display name/language, `baseUrl`, engine family, request rate, and NSFW value. Engine-specific fields such as `adapter` and `apiUrl` are required when the selected runtime needs them.

Supported runtime combinations in this repository are:

- `asuraScans`
- `api` with adapter `ezmanhwa`
- `api` with adapter `heancms`
- `mangaBox` with adapter `mangabox`

Configuration should live here rather than in the app. If a site changes domain or API endpoint but still uses a supported runtime, update the manifest and release it without rebuilding Ahoge.

## Adding or updating a source

1. Add or edit a JSON file under `sources/`.
2. Keep `pkg` and source `id` stable when changing configuration; changing them can break stored library/source associations.
3. Add the package to `index.json`.
4. Run `python3 scripts/validate.py`.
5. Open a pull request. CI validates JSON syntax, schema rules, URL fields, supported engines/adapters, duplicate package/source IDs, and index consistency.

Do not add copyrighted manga payloads, scraped chapter/page fixtures, or CI jobs that download manga content. Validation is configuration-only.

## Versioning and compatibility

Increment the package `version` when source configuration changes. A manifest change is compatible without an Ahoge release when it only changes configuration understood by an engine already compiled into the installed app.

A new Ahoge build is required for a new runtime engine, importer/schema behavior changes, or application feature changes.

## License

See [LICENSE](LICENSE). Source definitions migrated from `QuackyPROG/mihon-ios` preserve the applicable upstream licensing and attribution obligations.