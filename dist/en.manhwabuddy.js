var source = null;
const META = {"id":"en.manhwabuddy","name":"ManhwaBuddy","lang":"en","version":"1.0.0","nsfw":true,"baseUrl":"https://manhwabuddy.com","template":"yiimanga","upstream":"src/en/manhwabuddy"};
// Helpers available to every source. Plain functions: no URL/fetch exist in the host.

function pathOf(url) {
  const match = String(url).match(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]+([^?#]*)/i);
  if (!match) return String(url).replace(/[?#].*$/, "");
  return match[1] || "/";
}

function query(pairs) {
  return pairs.map(([k, v]) => k + "=" + encodeURIComponent(String(v))).join("&");
}

function parseStatus(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(?:not|in|un)\s*(?:completed?|finished)\b/.test(t)) return "ongoing";
  if (/\b(?:completed?|finished|concluded|ended|end)\b/.test(t)) return "completed";
  if (/\b(?:on.?going|publishing|releasing|en curso|em andamento)\b/.test(t)) return "ongoing";
  if (/\b(?:hiatus|on.?hold|paused)\b/.test(t)) return "hiatus";
  if (/\b(?:cancel(?:l?ed)?|dropped|discontinued)\b/.test(t)) return "cancelled";
  return "unknown";
}

const UNIT_MS = {
  second: 1000, sec: 1000, minute: 60000, min: 60000, hour: 3600000, hr: 3600000,
  day: 86400000, week: 604800000, month: 2592000000, year: 31536000000,
};

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

// Midnight UTC for a calendar date, or null if the date does not exist (e.g. Feb 30).
function utcDate(year, month, day) {
  const ms = Date.UTC(year, month, day);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day ? ms : null;
}

// Relative ("2 days ago", "an hour ago", "yesterday") and absolute dates. Absolute formats are
// parsed explicitly (never via Date.parse on free text) so results match across engines:
// YYYY-MM-DD[Thh:mm[:ss[.fff]][Z|+hh:mm]], "Mon D, YYYY", "D Month YYYY", MM/DD/YYYY (US order).
// A time without an offset is treated as UTC.
function parseDate(text, now) {
  const t = String(text || "").trim().toLowerCase();
  const current = now === undefined ? Date.now() : now;
  if (!t) return null;
  if (t === "today" || t === "just now") return current;
  if (t === "yesterday") return current - UNIT_MS.day;
  const rel = t.match(/(\d+|an?)\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?\s*ago/);
  if (rel) return current - (/^\d/.test(rel[1]) ? Number(rel[1]) : 1) * UNIT_MS[rel[2]];
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) {
    if (m[4] === undefined) return utcDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    let zone = m[8] === undefined ? "Z" : m[8].toUpperCase();
    if (/^[+-]\d{4}$/.test(zone)) zone = zone.slice(0, 3) + ":" + zone.slice(3);
    const iso = m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + (m[6] || "00") + (m[7] || "") + zone;
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? null : parsed;
  }
  m = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && m[1] in MONTHS) return utcDate(Number(m[3]), MONTHS[m[1]], Number(m[2]));
  m = t.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/);
  if (m && m[2] in MONTHS) return utcDate(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return utcDate(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return null;
}

function chapterNumber(name) {
  const text = String(name || "");
  const tagged = text.match(/(?:chapter|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i);
  if (tagged) return Number(tagged[1]);
  const any = text.match(/\d+(?:\.\d+)?/);
  return any ? Number(any[0]) : -1;
}

function imageUrl(element) {
  if (!element) return "";
  for (const name of ["data-src", "data-lazy-src", "data-cfsrc", "src"]) {
    if (!element.attr(name).trim()) continue; // absUrl of an empty attribute is the base url
    const value = element.absUrl(name);
    if (value && !/^\s*data:/i.test(value)) return value.trim();
  }
  return "";
}

function unique(values) {
  const seen = new Set();
  return values.filter((v) => {
    const key = String(v).toLowerCase();
    if (!v || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureOk(response) {
  if (response.status >= 400) throw new Error("HTTP " + response.status + " for " + response.url);
  return response;
}

// Yiimanga theme (ManhwaBuddy, Hentai20). Port of keiyoushi lib-multisrc/yiimanga (Apache-2.0).
function Yiimanga(config) {
  const c = Object.assign(
    {
      searchParam: "s",
      popularPath: null, // catalogue route the site sorts with ?order=views; null falls back to latest
    },
    config,
  );
  const base = c.baseUrl.replace(/\/$/, "");
  const headers = { Referer: base + "/" };

  async function getDocument(url) {
    const res = ensureOk(await http.get(url, { headers }));
    return html.parse(res.body, res.url);
  }

  function listing(doc) {
    const manga = doc
      .select(".latest-list .latest-item, .list .list-item")
      .map((el) => {
        const link = el.selectFirst(".latest-right a:has(h3), .latest-right a:has(h4), .item-title a");
        if (!link) return null;
        return { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(el.selectFirst(".latest-left img, .item-img img")) };
      })
      .filter(Boolean);
    return { manga, hasNextPage: Boolean(doc.selectFirst("#pagination li.next a")) };
  }

  const latest = async (page) => listing(await getDocument(base + "/page/" + page + "/"));

  // "06 Oct 2026", "12 Oct 26", or "Oct 26" (month and two-digit year).
  function yiiDate(text) {
    const m = String(text || "").trim().match(/^(?:(\d{1,2})\s+)?([A-Za-z]{3,})\.?\s+(\d{2,4})$/);
    if (!m) return parseDate(text);
    const year = m[3].length === 2 ? "20" + m[3] : m[3];
    return parseDate((m[1] || "1") + " " + m[2] + " " + year);
  }

  // Info rows: <li><h5>Author(s)</h5><a>…</a></li> and the Madara-like variants.
  function info(doc, labels) {
    for (const row of doc.select(".main-info-list li, .post-content_item, .info-item")) {
      const heading = row.selectFirst("h5, .summary-heading, span.sh");
      if (!heading) continue;
      const label = heading.text().replace(/\s*[:-]\s*$/, "");
      if (labels.indexOf(label) === -1) continue;
      const links = row.select("a").map((a) => a.ownText() || a.text()).filter(Boolean);
      const text = row.text().slice(heading.text().length).replace(/^\s*[:-]?\s*/, "");
      return { links, text };
    }
    return null;
  }
  const names = (row) => (row ? (row.links.length ? row.links.join(", ") : row.text) : "");

  let genreCache = null;
  async function filters() {
    if (!genreCache) {
      try {
        const doc = await getDocument(base + "/");
        const seen = new Set();
        genreCache = doc
          .select(".genre-list a, a.item-nav[href*=/genre/], a.item-nav-mb[href*=/genre/]")
          .map((a) => {
            const m = a.absUrl("href").match(/\/genre\/([^/?#]+)/);
            return m ? { value: m[1], label: a.text() } : null;
          })
          .filter((g) => g && g.label && !seen.has(g.value) && seen.add(g.value))
          .sort((x, y) => x.label.localeCompare(y.label));
      } catch (e) {
        // Genres are fetched again next time.
      }
    }
    if (!genreCache || !genreCache.length) return [];
    return [
      { type: "header", name: "Ignored when searching by text" },
      { type: "select", key: "genre", name: "Genre", options: [{ value: "", label: "All" }].concat(genreCache) },
    ];
  }

  return {
    async popular(page) {
      if (!c.popularPath) return latest(page);
      return listing(await getDocument(base + "/" + c.popularPath + "/page/" + page + "/?order=views"));
    },
    latest,
    filters,

    async search(q, page, f) {
      if (q) return listing(await getDocument(base + "/search/?" + query([[c.searchParam, q], ["page", page]])));
      const genre = f && f.genre;
      if (!genre) return latest(page);
      return listing(await getDocument(base + "/genre/" + genre + "/page/" + page + "/"));
    },

    async details(url) {
      const doc = await getDocument(base + url);
      const titleEl = doc.selectFirst("h1.main-info-title, .post-title h1, .manga-detail .info h1");
      if (!titleEl) throw new Error("Manga title not found on " + url);
      const block = doc.selectFirst(".short-desc-content, .dsct, .description-summary");
      let description = "";
      if (block) {
        const parts = block.select("p, li").map((e) => e.text()).filter(Boolean);
        description = parts.length ? parts.join("\n\n") : block.text();
      }
      const alt = info(doc, ["Alternative"]);
      if (alt && alt.text) description += (description ? "\n\n" : "") + "Alternative names: " + alt.text;
      const status = info(doc, ["Status", "Estado"]);
      const genres = info(doc, ["Genres", "Genre(s)", "Géneros"]);
      return {
        title: titleEl.text(),
        cover: imageUrl(doc.selectFirst("img.img-cover, .summary_image img, .manga-detail .poster img")),
        author: names(info(doc, ["Author(s)", "Author", "Autores"])),
        artist: names(info(doc, ["Artist(s)", "Artist", "Artistas"])),
        description,
        genres: genres ? unique(genres.links.length ? genres.links : genres.text.split(",").map((s) => s.trim())) : [],
        status: parseStatus(status ? status.text : ""),
      };
    },

    async chapters(url) {
      const doc = await getDocument(base + url);
      return doc
        .select("ul.chapter-list li, ul.row-content-chapter li, .list-items li.item")
        .map((li) => {
          const a = li.selectFirst("a[href]");
          if (!a) return null;
          const nameEl = li.selectFirst(".chapter-name, .item a > span:first-child");
          const timeEl = li.selectFirst(".ct-update, .chapter-time, .item a > span:nth-child(2)");
          const name = nameEl ? nameEl.text() : a.text();
          return { url: pathOf(a.absUrl("href")), name, number: chapterNumber(name), date: timeEl ? yiiDate(timeEl.text()) : null, scanlator: null };
        })
        .filter(Boolean);
    },

    async pages(url) {
      const doc = await getDocument(base + url);
      return doc
        .select(".reading-content img, .read-content img")
        .map((img) => imageUrl(img))
        .filter(Boolean)
        .map((u) => ({ url: u, headers }));
    },
  };
}

const yii = Yiimanga({ baseUrl: META.baseUrl });

// The site has no sortable catalogue; its homepage carousel is the popular list.
yii.popular = async () => {
  const res = ensureOk(await http.get(META.baseUrl + "/", { headers: { Referer: META.baseUrl + "/" } }));
  const doc = html.parse(res.body, res.url);
  const manga = doc
    .select(".item-move")
    .map((el) => {
      const link = el.selectFirst(".name a");
      return link ? { url: pathOf(link.absUrl("href")), title: link.text(), cover: imageUrl(el.selectFirst("img")) } : null;
    })
    .filter(Boolean);
  return { manga, hasNextPage: false };
};

source = yii;
