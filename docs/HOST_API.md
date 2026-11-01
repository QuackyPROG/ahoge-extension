# Ahoge Host API — runtime version 1

A published script (`dist/<id>.js`) is plain JavaScript evaluated once per source in a
fresh global context (JavaScriptCore on iOS, `node:vm` in this repo).

## Globals the script may use

Only ECMAScript built-ins (`JSON`, `Date`, `Math`, `RegExp`, `Promise`, `encodeURIComponent`, …)
plus the host objects below. **There is no `URL`, `URLSearchParams`, `fetch`, `setTimeout`,
`TextEncoder` or DOM.** Use the helpers in `templates/_common.js`.

### `http`

    http.get(url, { headers })            -> Promise<Response>
    http.post(url, { headers, body })     -> Promise<Response>
    Response = { status: number, url: string, headers: { [lowercaseName]: string }, body: string }

- `body` may be a string (sent as-is) or a flat object (form-encoded with
  `application/x-www-form-urlencoded` unless the caller set `Content-Type`).
  Form encoding: `encodeURIComponent(key) + "=" + encodeURIComponent(String(value))` joined by `&`,
  in object key order, with `%20` for spaces.
- Redirects are followed; `url` is the final URL.
- The host sets `User-Agent` unless the caller sets one. Cookies persist per host app.
- Non-2xx statuses resolve normally. Network failure rejects with `Error`.
- If `status` is 403 or 503 **and** (`cf-mitigated: challenge` header is present **or** the
  body contains `<title>Just a moment...</title>`), the promise rejects with `CloudflareError`
  whose `url` property is the request URL.

### `html.parse(body, baseUrl) -> Element` (the document root)

Jsoup semantics:

| Method | Behavior |
| --- | --- |
| `select(css)` | Array of matching elements **including the element itself** if it matches, then descendants in document order. |
| `selectFirst(css)` | First of `select(css)` or `null`. |
| `text()` | All descendant text, whitespace collapsed to single spaces and trimmed; block elements (`p, div, br, li, h1–h6, tr, td, th, ul, ol, section, article, header, footer, table`) are separated by a space; `<script>`/`<style>` content excluded. |
| `ownText()` | Direct child text nodes only, collapsed and trimmed. |
| `data()` | Concatenated raw content of `<script>`/`<style>` children (and of the element itself if it is one). |
| `html()` | Inner HTML. |
| `attr(name)` | Attribute value or `""`. |
| `absUrl(name)` | Attribute resolved against `baseUrl`; `""` if missing or unresolvable. |
| `tagName()` | Lowercase tag name (`"#root"` for the document). |

CSS: standard CSS selectors, `:has()`, `:not()`, `:contains(text)` and `:containsOwn(text)`.
`:contains` matches the element's normalized `text()` and `:containsOwn` its `ownText()`, both
case-insensitively (Jsoup semantics). `:matches`/`:matchesOwn` are not supported.

### Other

- `console.log(...args)` — debug log.
- `atob(string)`, `btoa(string)` — Latin-1 base64.
- `CloudflareError` — class; `instanceof` works for errors thrown by `http`.

## Bundle layout

    var source = null;
    const META = { ...meta.json };
    <templates/_common.js>
    <templates/<template>.js>   (if meta.template is set)
    <sources/<lang>/<name>/source.js>   (assigns `source = …`)

## Source object

    source.popular(page)          -> { manga: MangaStub[], hasNextPage: boolean }
    source.latest(page)           -> same
    source.search(query, page)    -> same
    source.details(mangaUrl)      -> { title, cover, author, artist, description, genres: string[], status }
    source.chapters(mangaUrl)     -> Chapter[]  (newest first)
    source.pages(chapterUrl)      -> Page[]

    MangaStub = { url, title, cover }
    Chapter   = { url, name, number (-1 if unknown), date (ms epoch or null), scanlator (string or null) }
    Page      = { url (absolute), headers: { [name]: string } }
    status    = "ongoing" | "completed" | "hiatus" | "cancelled" | "unknown"

`url` values for manga and chapters are site-relative paths (`/manga/foo/`). `page` starts at 1.
All methods may be `async`. Results are JSON-serialized by the host. The host applies a 30 s
timeout per call.

## Conformance

`runtime/host-api-conformance.json` lists HTML + selector cases with expected output.
Both runtimes must pass every case.
