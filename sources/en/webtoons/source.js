// WEBTOON (official, free episodes; English). Port of keiyoushi src/all/webtoons (Apache-2.0).
// A phone user agent is redirected to m.webtoons.com, whose pages differ, so www pages are requested as desktop.
const BASE = META.baseUrl;
const MOBILE = "https://m.webtoons.com";
const LANG = "en";
const HEADERS = {
  Referer: BASE + "/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Cookie: "ageGatePass=true; locale=" + LANG + "; needGDPR=false",
};

async function getDocument(url) {
  const res = ensureOk(await http.get(url, { headers: HEADERS }));
  return html.parse(res.body, res.url);
}

function listing(doc) {
  return doc
    .select(".webtoon_list li a")
    .map((a) => {
      const titleEl = a.selectFirst(".title");
      const href = a.absUrl("href");
      if (!titleEl || !href) return null;
      return { url: pathOf(href) + href.replace(/^[^?]*/, ""), title: titleEl.text(), cover: imageUrl(a.selectFirst("img")) };
    })
    .filter(Boolean);
}

const RANKINGS = ["trending", "popular", "originals", "canvas"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function filters() {
  return [
    {
      type: "select",
      key: "type",
      name: "Search in",
      options: [
        { value: "", label: "All" },
        { value: "originals", label: "Originals" },
        { value: "canvas", label: "Canvas" },
      ],
    },
  ];
}

// Manga urls keep the query string: "/en/<genre>/<slug>/list?title_no=123".
function param(url, name) {
  const m = String(url).match(new RegExp("[?&]" + name + "=([^&#]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

// "Season 2 Ep. 14", "Episode 3", "Ch. 7"; mini/bonus/special episodes get no number.
function episodeNumber(title) {
  const t = String(title);
  if (/mini|bonus|special/i.test(t)) return -1;
  const m = t.match(/(?:e(?:p(?:isode)?)?|ch(?:apter)?)\s*\.?\s*(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : -1;
}

source = {
  async popular(page) {
    const ranking = RANKINGS[page - 1];
    if (!ranking) return { manga: [], hasNextPage: false };
    const doc = await getDocument(BASE + "/" + LANG + "/ranking/" + ranking);
    return { manga: listing(doc), hasNextPage: page < RANKINGS.length };
  },

  // The originals released today, most recently updated first.
  async latest() {
    const day = DAYS[new Date().getUTCDay()];
    const doc = await getDocument(BASE + "/" + LANG + "/originals/" + day + "?sortOrder=UPDATE");
    return { manga: listing(doc), hasNextPage: false };
  },

  filters,

  async search(q, page, f) {
    const type = (f && f.type) || "";
    const pairs = [["keyword", q]];
    if (type && page > 1) pairs.push(["page", page]);
    const doc = await getDocument(BASE + "/" + LANG + "/search" + (type ? "/" + type : "") + "?" + query(pairs));
    return { manga: listing(doc), hasNextPage: Boolean(type) && Boolean(doc.selectFirst("a.pagination[aria-current=true] + a")) };
  },

  async details(url) {
    const doc = await getDocument(BASE + url);
    const titleEl = doc.selectFirst("h1.subj, h3.subj");
    if (!titleEl) throw new Error("Series title not found on " + url);
    const detail = doc.selectFirst(".detail_header .info");
    const aside = doc.selectFirst("#_asideDetail");
    const authors = detail ? detail.select(".author").map((a) => a.ownText() || a.text()) : [];
    const area = detail ? detail.selectFirst(".author_area") : null;
    const author = authors[0] || (area ? area.ownText() : "");
    const day = aside && aside.selectFirst("p.day_info") ? aside.selectFirst("p.day_info").text() : "";
    const og = doc.selectFirst("head meta[property=og:image]");
    const summary = aside ? aside.selectFirst("p.summary") : null;
    return {
      title: titleEl.text(),
      cover: og ? og.attr("content") : "",
      author,
      artist: authors[1] || author,
      description: summary ? summary.text() : "",
      genres: detail ? unique(detail.select(".genre").map((g) => g.text())) : [],
      status: /UP|EVERY/.test(day) ? "ongoing" : /END|COMPLETED/.test(day) ? "completed" : "unknown",
    };
  },

  async chapters(url) {
    const titleNo = param(url, "title_no") || param(url, "titleNo");
    if (!titleNo) throw new Error("No title number in " + url);
    const type = /\/canvas\/|\/challenge\//.test(url) ? "canvas" : "webtoon";
    let api = MOBILE + "/api/v1/" + type + "/" + titleNo + "/episodes?pageSize=99999";
    if (type === "canvas") api += "&readingLanguageCode=" + LANG;
    const res = ensureOk(await http.get(api, { headers: { Referer: MOBILE + "/" } }));
    const episodes = (JSON.parse(res.body).result || {}).episodeList || [];
    const numbered = episodes.filter((e) => episodeNumber(e.episodeTitle) !== -1).length;
    // Unnumbered titles (or mostly unnumbered ones) fall back to their position.
    const sequential = numbered * 2 < episodes.length;
    return episodes
      .map((e, i) => {
        const title = html.parse("<p>" + e.episodeTitle + "</p>", BASE).text();
        return {
          url: e.viewerLink,
          name: title + (e.hasBgm ? " ♫" : ""),
          number: sequential ? i + 1 : episodeNumber(e.episodeTitle) === -1 ? -1 : episodeNumber(e.episodeTitle),
          date: e.exposureDateMillis || null,
          scanlator: null,
        };
      })
      .reverse();
  },

  async pages(url) {
    const doc = await getDocument(BASE + url);
    return doc
      .select("div#_imageList > img")
      .map((img) => img.attr("data-url") || imageUrl(img))
      .filter(Boolean)
      .map((u) => ({ url: u, headers: { Referer: BASE + "/" } }));
  },
};
