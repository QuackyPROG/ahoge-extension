# Ahoge Host API — runtime version 1

A published script (`dist/<id>.js`) is plain JavaScript evaluated once per source in a
fresh global context (JavaScriptCore on iOS, `node:vm` in this repo).

This file plus `runtime/host-api-conformance.json` are the complete contract. The Node
implementation (`runtime/html.mjs`, `http.mjs`, `host.mjs`) and the Swift host (SwiftSoup +
URLSession) must both pass every conformance case and vector.

**Rule for every item below:** where Node and Jsoup differ, Node is made to match Jsoup. Where
matching is impractical, the feature is forbidden here, and Node throws on it so porters notice.

## Script rules

- Syntax is ES2019 at most. **No `?.` and no `??`**, no class fields, no top-level `await`.
- Do not use `instanceof` on values returned by the host (arrays from `select`, `Response`
  objects, errors). The host lives in a different realm than the script, so use `Array.isArray`.
  (`instanceof CloudflareError` is the one supported exception: it is a script-visible global.)
- No `URL`, `URLSearchParams`, `fetch`, `setTimeout`, `setInterval`, `TextEncoder`, `TextDecoder`
  or DOM exist. Use the helpers in `templates/_common.js`.
- Do not string-compare the output of `html()` (see "html()" below).
- Do not use the forbidden selectors (see "Forbidden selectors").

## Globals the script may use

Only ECMAScript built-ins (`JSON`, `Date`, `Math`, `RegExp`, `Promise`, `encodeURIComponent`, …)
plus the host objects below.

Top-level evaluation of the script is limited to **5 seconds** (synchronous work only; awaiting
inside source methods is not part of it). Each call of a source method has a **30 second**
default timeout (`Source call <name> timed out after 30000 ms`).

### `http`

    http.get(url, { headers })            -> Promise<Response>
    http.post(url, { headers, body })     -> Promise<Response>
    Response = { status: number, url: string, headers: { [lowercaseName]: string }, body: string }

**Request**

- `body` is `undefined`/`null` (no body), a string, or a flat object. Anything else is `String()`-ed.
- A string body is sent as its **UTF-8 bytes with no `Content-Type` header**, unless the caller
  sets one. (Platform fetch/URLSession APIs may add `text/plain` to string bodies; the host must
  send bytes and must not add one.)
- An object body is form-encoded (`encodeForm`) and sent as UTF-8 bytes with
  `Content-Type: application/x-www-form-urlencoded` unless the caller set `Content-Type`.
- `encodeForm(object)`: `encodeURIComponent(key) + "=" + encodeURIComponent(String(value))` for
  each own enumerable entry in insertion order, joined by `&`. Spaces become `%20` (never `+`).
  `A-Z a-z 0-9 - _ . ! ~ * ' ( )` stay literal; everything else is percent-encoded as UTF-8 bytes
  with uppercase hex. **Swift's own percent-encoding character sets differ from this**, so
  implement this exact set; vectors are in the conformance file under `http.encodeForm`.
- Header names are matched case-insensitively. The host sets
  `User-Agent: DEFAULT_USER_AGENT` unless the caller sets a `User-Agent`; a source may override it
  per request (MangaDex does).
- `DEFAULT_USER_AGENT` is exactly:

      Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1

**Response**

- Redirects are followed; `url` is the final URL.
- Non-2xx statuses resolve normally. Network failure rejects with `Error`.
- **Header names are lowercased.** Duplicate headers are joined with `", "` in received order,
  **except `set-cookie`, whose values are joined with `"\n"`** (a cookie's `Expires` contains a
  comma, so `", "` would be ambiguous).
- **The body is always decoded as UTF-8**, ignoring any `charset` in `Content-Type` and any meta
  tag. Invalid byte sequences become U+FFFD. A leading UTF-8 BOM is removed.
- If `status` is 403 or 503 **and** (the `cf-mitigated` header equals `challenge` **or** the body
  contains `<title>Just a moment...</title>`), the promise rejects with `CloudflareError` whose
  `url` property is the request URL. Vectors: `http.isCloudflareChallenge`.

**Cookies**

- The host keeps an in-memory cookie jar for the life of the runtime (one per loaded source
  script; nothing is persisted across runs).
- For each response, every `Set-Cookie` header is stored under the host of the response's final
  URL. A `Set-Cookie` is `name=value` (split at the first `=`, both trimmed; an entry with no `=`
  or an empty name is ignored) followed by `;`-separated attributes, names case-insensitive.
- Only these attributes are honored:
  - `Domain=d` (a leading `.` is dropped, lowercased): the cookie applies to host `d` and all its
    subdomains. It is ignored entirely if the response host is neither `d` nor a subdomain of `d`.
    Without `Domain` the cookie is host-only (exact host match, no subdomains).
  - `Max-Age=n` (integer): `n <= 0` deletes the cookie; a positive value is ignored (no expiry
    during the runtime). `Max-Age` takes precedence over `Expires`.
  - `Expires=date`: without `Max-Age`, a date in the past deletes the cookie. A date that cannot
    be parsed is ignored. Future dates are ignored (no expiry during the runtime).
  - `Path`, `Secure`, `HttpOnly`, `SameSite` and the port are ignored.
- A cookie is identified by (host-only or domain, domain, name); a later `Set-Cookie` with the same
  identity replaces the value; deletion removes that identity (a `Domain` deletion does not remove
  the host-only cookie of the same name).
- Before each request, unless the caller set a `Cookie` header, the host sends
  `Cookie: name=value; name=value` containing every matching cookie for the request URL's host, in
  insertion order. Nothing is sent when none match.
- Cookies set on intermediate redirect responses **may not be captured** (the platform's fetch
  follows redirects internally). Do not rely on them. The `Cookie` header is computed once from the
  original request URL.

### `html.parse(body, baseUrl) -> Element` (the document root)

Jsoup semantics. The document is parsed as a full HTML document (html/head/body are created).
`<noscript>` is parsed with scripting **disabled**: its children are real elements, selectable
and visible to `text()`.

`baseUrl` is the parse base. If the document contains an element matching `base[href]`, the
**first** one in document order replaces the base: `base = WHATWG-resolve(thatHref, baseUrl)`
(ignored if it cannot be resolved). This base applies to the whole document.

`select`, `selectFirst`, `text`, `ownText`, `data`, `html`, `attr`, `absUrl`, `tagName` are the
only methods. Elements are plain objects; do not compare them with `===`.

| Method | Behavior |
| --- | --- |
| `select(css)` | Array of matching elements **including the element itself** if it matches, then descendants, in document order (also for comma selectors). Throws on forbidden selectors. |
| `selectFirst(css)` | First of `select(css)` or `null`. Throws on forbidden selectors. |
| `text()` | See "text()". |
| `ownText()` | See "ownText()". |
| `data()` | See "data()". |
| `html()` | Inner HTML, not pretty-printed (see "html()"). |
| `attr(name)` | Attribute value or `""`. See "attr()". |
| `absUrl(name)` | See "absUrl()". |
| `tagName()` | Lowercase tag name; `"#root"` for the document root. |

#### Whitespace

The whitespace set is exactly **space U+0020, tab U+0009, LF U+000A, CR U+000D, FF U+000C and
NBSP U+00A0** (so `&nbsp;` collapses, as in Jsoup). Do **not** use a regex `\s` or a
library "trim": those also match U+2000–U+200A (e.g. U+2003 em space), U+2028, U+3000, U+FEFF and
others, which must stay untouched. "Collapse" replaces every maximal run of whitespace-set
characters by one U+0020; "trim" removes whitespace-set characters from both ends.

#### text()

Output is built left to right, then trimmed:

1. A text node appends its data with whitespace collapsed; a leading whitespace run is dropped
   when the output so far already ends with a space.
2. An element in `BLOCK_TAGS` first appends one space, if the output so far is non-empty and does
   not already end with a space. After its children, if its next sibling is a text node and the
   output does not end with a space, it appends one space.
3. Inline elements append nothing around their content: `<span>a</span><span>b</span>` is `ab`.
4. `<script>`, `<style>` and comments contribute nothing.

`BLOCK_TAGS` (exact list; `br` is included, so `a<br>b` is `a b`):

    address, article, aside, blockquote, br, dd, div, dl, dt, fieldset, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, tbody, td, tfoot, th, thead, tr, ul

Because of the next-sibling rule, `<p>a</p><span>b</span>` is `ab` while `<p>a</p>b` is `a b`.

#### ownText()

Only the element's direct children: text nodes are appended collapsed (as in `text()` step 1);
a direct `<br>` child appends one space if the output does not already end with one. Then trim.
`<p>a<br>b</p>` gives `a b`. Other child elements contribute nothing.

#### data()

Walk the element and all its descendants in document order. Concatenate, with no separators, the
raw text of every `<script>` and `<style>` element (including the element itself if it is one)
and the data of every comment node (the text between `<!--` and `-->`).

#### attr()

`attr(name)`: look up `name` **lowercased** (attribute names are case-insensitive; parsed names are
lowercase). If the attribute exists and is non-empty, return it. Otherwise, if `name` starts with
the literal lowercase prefix `abs:`, return `absUrl(name.slice(4))`. Otherwise `""`.
So `attr("abs:href")` equals `absUrl("href")`.

#### absUrl()

`absUrl(name)`: `""` if the attribute does not exist (name matched lowercased). Otherwise the
result is exactly the WHATWG URL Standard resolution `new URL(value, base).href` (leading and
trailing C0 control/space stripped, tab/CR/LF removed, spaces in paths become `%20`, dot segments
resolved, host lowercased, default ports dropped), and `""` if that fails. An attribute that exists
but is empty resolves to the base URL (without fragment). **Foundation's
`URL(string:relativeTo:)` is not equivalent** (it follows RFC 3986 / RFC 1808 rules, not WHATWG),
so implement WHATWG resolution or a port of it. Cases in the conformance file cover relative, root,
protocol-relative, `..`, query, fragment, space and `<base href>`.

#### html()

Returns the element's inner HTML **not pretty-printed**: no indentation or newlines are added
between block elements (`<div id=x><p>a</p><p>b</p></div>` → `<p>a</p><p>b</p>`). SwiftSoup needs
`outputSettings().prettyPrint(false)`. The exact serialization of entities (`&amp;`, `&nbsp;`,
`&lt;`), attribute quoting/ordering and void tags (`<br>` vs `<br />`) may differ between hosts, so
**scripts must not string-compare `html()` output**; re-parse it with `html.parse` instead.

#### CSS selectors

Standard CSS selectors, `:has()`, `:not()`, `:nth-child()`, `:first-child`, `:last-child`,
`:first-of-type`, `:last-of-type`, attribute selectors (`[a]`, `[a=b]`, `[a^=b]`, …), combinators
and comma lists. Two Jsoup pseudo-classes are supported:

- `:contains(text)` — element `text()` contains the argument, case-insensitively
- `:containsOwn(text)` — element `ownText()` contains the argument, case-insensitively

In both, the argument is collapsed and trimmed with the whitespace set above and lowercased before
comparing; the argument is written **unquoted**.

#### Forbidden selectors

`select` and `selectFirst` first run `assertSupportedSelector(css)` and throw
`Error("Unsupported selector: <reason>")` (message starts with exactly `Unsupported selector: `)
if the raw selector string matches **any** of these regular expressions, case-insensitively, with
no regard for quotes, escapes or brackets:

    :(eq|lt|gt)\(
    :(first|last|even|odd)(?![-A-Za-z0-9_])
    :(matches|matchesOwn|matchesText|matchesWholeText|matchesWholeOwnText|containsData|containsWholeText|containsWholeOwnText)\(
    :contains(Own)?\(\s*["']

That is: jQuery positionals (`:eq( :lt( :gt(`, and `:first :last :even :odd` when not followed by
`-` or a word character, so `:first-child` and `:last-of-type` are fine), Jsoup-only pseudos, and
quoted arguments to `:contains`/`:containsOwn`. Porters replace `:eq(n)` with
`:nth-child()`/`:nth-of-type()` or by indexing the result array; replace `:matches(re)` by
filtering in JavaScript.

### Other

- `console.log(...args)` — debug log (arguments joined by a space after `String()`).
- `atob(string)`, `btoa(string)` — Latin-1 base64 with the WHATWG semantics. **JavaScriptCore has
  neither, so the Swift host must provide both.**
  - `atob` is forgiving-base64: remove ASCII whitespace (space, tab, LF, FF, CR); if the length is
    a multiple of 4, drop one or two trailing `=`; if the length mod 4 is 1, or any character is
    outside `A-Z a-z 0-9 + /`, throw an `Error` (name `InvalidCharacterError`). The result has one
    character (U+0000–U+00FF) per decoded byte.
  - `btoa` throws an `Error` (name `InvalidCharacterError`) if any character is above U+00FF;
    otherwise each character is one byte, encoded with standard padded base64.
- `CloudflareError` — class; `instanceof CloudflareError` works for errors thrown by `http`.

## Bundle layout

    var source = null;
    const META = { ...meta.json };
    <templates/_common.js>
    <templates/<template>.js>   (if meta.template is set)
    <sources/<lang>/<name>/source.js>   (assigns `source = …`)

## Source object

    source.popular(page)          -> { manga: MangaStub[], hasNextPage: boolean }
    source.latest(page)           -> same
    source.search(query, page, filters?) -> same
    source.details(mangaUrl)      -> { title, cover, author, artist, description, genres: string[], status }
    source.chapters(mangaUrl)     -> Chapter[]  (newest first)
    source.pages(chapterUrl)      -> Page[]
    source.filters()              -> Filter[]   (optional)

    MangaStub = { url, title, cover }
    Chapter   = { url, name, number (-1 if unknown), date (ms epoch or null), scanlator (string or null) }
    Page      = { url (absolute), headers: { [name]: string } }
    status    = "ongoing" | "completed" | "hiatus" | "cancelled" | "unknown"

`url` values for manga and chapters are site-relative paths (`/manga/foo/`). `page` starts at 1.
All methods may be `async`. Results are JSON-serialized by the host (`JSON.stringify` then parse;
an `undefined` result becomes `null`, `undefined` properties are dropped).

## Filters

`filters()` is optional. A source without it has no filters (both hosts treat it as `[]`), and
`search` is then always called with two arguments. A source with filters always gets a third
argument: an object with a value for every keyed filter, defaults filled in, even for a plain
text search. Query may be `""` (the user is browsing with filters only). `filters()` may fetch
(e.g. a tag list) and should cache its result.

    { type: "header",    name }
    { type: "separator" }
    { type: "text",      key, name }                              value: string ("" when empty)
    { type: "checkbox",  key, name, default?: boolean }           value: boolean
    { type: "tristate",  key, name }                              value: 0 ignore | 1 include | 2 exclude
    { type: "select",    key, name, options: Option[], default?: string }        value: option value
    { type: "sort",      key, name, options: Option[], default?: { value, ascending } }
                                                                  value: { value, ascending }
    { type: "group",     key, name, filters: (text | checkbox | tristate)[] }    value: { [childKey]: value }

    Option = { value: string, label: string }

Keys are unique within their list. `select` and `sort` default to the first option (sort:
descending). The app drops entry types it does not know, so new types can be added without a
runtime bump. `runtime/filters.mjs` validates a list and builds the default values;
`check.mjs` runs `search("", 1, defaults)` for every source that has filters.

When the user taps a genre on a manga page, the app turns on the first checkbox or tristate
whose `name` matches the genre (case-insensitive), so name tag filters exactly as `details`
names genres.

## Conformance

`runtime/host-api-conformance.json` holds:

- `baseUrl` — the default parse base for all cases.
- `ops` — the vocabulary of `op`, described below.
- `cases` — HTML cases: `{ name, html, select, op, arg?, root?, baseUrl?, expected }`.
- `http` — pure vectors: `encodeForm` (`{ input, expected }`) and `isCloudflareChallenge`
  (`{ status, headers, body, expected }`).

For a case, `doc = html.parse(case.html, case.baseUrl ?? file.baseUrl)`. Let `e` be
`doc.selectFirst(case.select)` or, if `"root": true`, the document root `doc` itself (then `select`
is ignored for method ops). A missing `e` is a failure.

| `op` | Result compared to `expected` |
| --- | --- |
| `count` | `doc.select(select).length` |
| `firstIsNull` | `doc.selectFirst(select) === null` |
| `selfSelectCount` | `e.select(arg).length` (`e` itself counts when it matches `arg`) |
| `attr` | `e.attr(arg)` |
| `absUrl` | `e.absUrl(arg)` |
| `throws` | `doc.select(select)` must throw an error whose message starts with `Unsupported selector: `; `expected` is `true` |
| `text`, `ownText`, `data`, `html`, `tagName` | the method of that name on `e` |

Both runtimes must pass every case and vector.

## Known differences

Uncertain or accepted deviations. Do not write scripts that depend on any of these.

- **Scoped descendant selectors.** For `el.select("div span")` where the `div` is an ancestor of
  `el` (outside `el`): cheerio does **not** match it; Jsoup's behavior differs between versions
  (newer versions stop the ancestor walk at the root, older ones and SwiftSoup may not). Always
  write selectors relative to `el`. Not covered by conformance.
- **Whitespace-preserving elements.** Jsoup keeps whitespace runs inside `<pre>`/`<textarea>` in
  `text()`; this contract collapses them everywhere.
- **Invisible characters.** Some Jsoup versions drop U+200B and U+00AD from `text()`; this
  contract keeps them. Java's `trim()` (used by Jsoup) also strips other control characters at the
  ends; this contract trims only the whitespace set.
- **Block elements outside `BLOCK_TAGS`.** Jsoup's internal block set is broader (for example
  `caption`, `details`, `center`, `body`). Only `BLOCK_TAGS` are guaranteed to separate text in
  `text()`.
- **Malformed HTML.** Node parses with parse5 (the HTML standard algorithm); Jsoup/SwiftSoup have
  their own tree builders. For example, a `<noscript>` inside `<head>` containing an `<img>`
  differs. Only well-formed markup (noscript inside `<body>`) is covered.
- **Cookies.** Intermediate redirect `Set-Cookie` headers may not be captured; `Path` and `Secure`
  are ignored; cookies are sent in insertion order.
- **Swift host: `set-cookie` header.** Foundation merges repeated `Set-Cookie` headers, so the Swift
  host rebuilds the `set-cookie` response header as one `name=value` per line (attributes dropped).
- **Swift host: top-level evaluation limit.** JavaScriptCore's public API has no execution time limit,
  so the 5 second top-level limit is not enforced on iOS (per-call timeouts are).
