import * as cheerio from "cheerio";

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot",
  "th", "thead", "tr", "ul",
]);

const collapse = (s) => s.replace(/\s+/g, " ").trim();

function resolveUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function nodeText(root) {
  let out = "";
  const walk = (n) => {
    if (n.type === "text") {
      out += n.data;
      return;
    }
    if (n.type !== "tag" && n.type !== "root") return; // skips script, style, comment
    const block = BLOCK_TAGS.has(n.name);
    if (block) out += " ";
    for (const child of n.children ?? []) walk(child);
    if (block) out += " ";
  };
  walk(root);
  return collapse(out);
}

function nodeOwnText(node) {
  return collapse((node.children ?? []).filter((n) => n.type === "text").map((n) => n.data).join(""));
}

// Jsoup semantics: case-insensitive match against normalized text() / ownText().
// Custom pseudos take precedence over css-select's built-in :contains.
const PSEUDOS = {
  contains: (elem, text) => nodeText(elem).toLowerCase().includes(collapse(String(text)).toLowerCase()),
  containsown: (elem, text) => nodeOwnText(elem).toLowerCase().includes(collapse(String(text)).toLowerCase()),
};

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
    const nodes = this.node.type === "script" || this.node.type === "style" ? [this.node] : (this.node.children ?? []);
    return nodes
      .filter((n) => n.type === "script" || n.type === "style")
      .map((n) => (n.children ?? []).map((c) => c.data ?? "").join(""))
      .join("");
  }

  html() {
    return this.$(this.node).html() ?? "";
  }

  attr(name) {
    return this.node.attribs?.[name] ?? "";
  }

  absUrl(name) {
    const value = this.attr(name).trim();
    return value ? resolveUrl(value, this.baseUrl) : "";
  }

  tagName() {
    return this.node.type === "root" ? "#root" : this.node.name;
  }
}

export function parse(body, baseUrl) {
  const $ = cheerio.load(body, { pseudos: PSEUDOS });
  return new HtmlElement($, $.root().get(0), baseUrl);
}
