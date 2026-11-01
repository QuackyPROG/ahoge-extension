# Ahoge Extensions

JavaScript manga sources for [Ahoge](https://github.com/QuackyPROG/ahoge), an iOS reader modeled on Mihon.

Add this repository in Ahoge → Browse → Extensions → Repositories:

    https://raw.githubusercontent.com/QuackyPROG/ahoge-extension/repo/index.json

Sources are ported from [keiyoushi/extensions-source](https://github.com/keiyoushi/extensions-source)
(Apache-2.0). Host API: [docs/HOST_API.md](docs/HOST_API.md).

## Develop

    npm install
    npm test
    npm run build      # writes out/index.json, out/dist, out/icons
    npm run check      # live health check against the real sites

## Add a source

1. `sources/<lang>/<name>/meta.json` and `source.js` (see existing sources).
2. Optional icon: `node scripts/fetch-icon.mjs src/<lang>/<name> sources/<lang>/<name>/icon.png`
3. `npm test && npm run build && node scripts/check.mjs --dir out --only <id>`
4. Bump `version` in `meta.json` whenever `source.js`, its template, or `templates/_common.js` changes.

## Health status

The daily health check runs every source against the live site from GitHub Actions and records
`health.status` in `index.json`:

| Status | Meaning | Issue |
| --- | --- | --- |
| `ok` | popular → details → chapters → pages all returned data. | Closed if one was open. |
| `broken` | A step failed or returned nothing. | `[broken] <id>` opened. |
| `unverified` | The site answered GitHub's servers with a Cloudflare challenge. Datacenter IPs are often challenged while phones are not, so the source may work fine on a device. | Never opened; an open one is closed. |
| `unknown` | Not checked since this script version was published. | — |
