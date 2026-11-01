import * as cheerio from "cheerio";

// Contract: docs/HOST_API.md ("html"). Jsoup semantics; where cheerio differs, this file adapts it.

export const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot",
  "th", "thead", "tr", "ul",
]);

// Whitespace set: space, tab, LF, CR, FF, NBSP. Deliberately not JS `\s` (which also matches U+2000..).
const WS = "[ \t\n\r\f\u00A0]";
const WS_RUN = new RegExp(`${WS}+`, "g");
const WS_EDGE = new RegExp(`^${WS}+|${WS}+$`, "g");
const isWs = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === " ";

const collapse = (s) => s.replace(WS_RUN, " ").replace(WS_EDGE, "");

// Appends `text` to `out` collapsing whitespace runs; a run directly after a trailing " " is dropped.
function appendNormalised(out, text) {
  let result = out;
  let lastWasWhite = result.endsWith(" ");
  for (const ch of text) {
    if (isWs(ch)) {
      if (!lastWasWhite) result += " ";
      lastWasWhite = true;
    } else {
      result += ch;
      lastWasWhite = false;
    }
  }
  return result;
}

function resolveUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

// Jsoup Element.text(): block elements (and br) add a separating space before them when something
// precedes; a block followed directly by a text node adds one after. Script/style/comments are skipped.
function nodeText(root) {
  let out = "";
  const walk = (n) => {
    if (n.type === "text") {
      out = appendNormalised(out, n.data);
      return;
    }
    if (n.type !== "tag" && n.type !== "root") return;
    const block = n.type === "tag" && BLOCK_TAGS.has(n.name);
    if (block && out.length > 0 && !out.endsWith(" ")) out += " ";
    for (const child of n.children ?? []) walk(child);
    if (block && n.next && n.next.type === "text" && !out.endsWith(" ")) out += " ";
  };
  walk(root);
  return collapse(out);
}

// Jsoup Element.ownText(): direct text children; a direct br adds a space.
function nodeOwnText(node) {
  let out = "";
  for (const child of node.children ?? []) {
    if (child.type === "text") out = appendNormalised(out, child.data);
    else if (child.type === "tag" && child.name === "br" && !out.endsWith(" ")) out += " ";
  }
  return collapse(out);
}

// Jsoup Element.data(): raw text of script/style plus comment data, all descendants, document order.
function nodeData(root) {
  let out = "";
  const walk = (n) => {
    if (n.type === "script" || n.type === "style") {
      for (const c of n.children ?? []) out += c.data ?? "";
    } else if (n.type === "comment") {
      out += n.data ?? "";
    } else {
      for (const c of n.children ?? []) walk(c);
    }
  };
  walk(root);
  return out;
}

// Jsoup semantics: case-insensitive match against normalized text() / ownText().
// Custom pseudos take precedence over css-select's built-in :contains.
const PSEUDOS = {
  contains: (elem, text) => nodeText(elem).toLowerCase().includes(collapse(String(text)).toLowerCase()),
  containsown: (elem, text) => nodeOwnText(elem).toLowerCase().includes(collapse(String(text)).toLowerCase()),
};

// Selector features Jsoup treats differently from cheerio (or does not have). The exact rule is in
// docs/HOST_API.md; the scan is over the raw selector string, case-insensitively, with no quote or
// escape awareness.
const FORBIDDEN = [
  [/:(?:eq|lt|gt)\(/i, "jQuery positional pseudo; use :nth-child()/:nth-of-type() or index the result array"],
  [/:(?:first|last|even|odd)(?![-A-Za-z0-9_])/i, "jQuery positional pseudo; use :first-child/:last-child/:nth-child() or index the result array"],
  [/:(?:matches|matchesown|matchestext|matcheswholetext|matcheswholeowntext|containsdata|containswholetext|containswholeowntext)\(/i, "Jsoup-only pseudo; filter in JavaScript instead"],
  [/:contains(?:own)?\(\s*["']/i, "quoted argument; write the text unquoted"],
];

export function assertSupportedSelector(css) {
  const text = String(css);
  for (const [pattern, reason] of FORBIDDEN) {
    const m = pattern.exec(text);
    if (m) throw new Error(`Unsupported selector: ${m[0]} (${reason})`);
  }
}

export class HtmlElement {
  constructor($, node, baseUrl) {
    this.$ = $;
    this.node = node;
    this.baseUrl = baseUrl;
  }

  #wrap(node) {
    return new HtmlElement(this.$, node, this.baseUrl);
  }

  select(css) {
    assertSupportedSelector(css);
    const self = this.$(this.node);
    const found = self.find(css).toArray();
    if (this.node.type !== "root" && self.is(css)) found.unshift(this.node);
    return found.map((n) => this.#wrap(n));
  }

  selectFirst(css) {
    return this.select(css)[0] ?? null;
  }

  text() {
    return nodeText(this.node);
  }

  ownText() {
    return nodeOwnText(this.node);
  }

  data() {
    return nodeData(this.node);
  }

  html() {
    return this.$(this.node).html() ?? "";
  }

  attr(name) {
    const key = String(name).toLowerCase();
    const value = this.node.attribs?.[key];
    if (value !== undefined && value !== "") return value;
    return String(name).startsWith("abs:") ? this.absUrl(String(name).slice(4)) : "";
  }

  absUrl(name) {
    const value = this.node.attribs?.[String(name).toLowerCase()];
    return value === undefined ? "" : resolveUrl(value, this.baseUrl);
  }

  tagName() {
    return this.node.type === "root" ? "#root" : this.node.name;
  }
}

export function parse(body, baseUrl) {
  const $ = cheerio.load(body, { pseudos: PSEUDOS, scriptingEnabled: false });
  let effectiveBase = baseUrl;
  const base = $("base[href]").first();
  if (base.length) {
    const resolved = resolveUrl(base.attr("href"), baseUrl);
    if (resolved) effectiveBase = resolved;
  }
  return new HtmlElement($, $.root().get(0), effectiveBase);
}
