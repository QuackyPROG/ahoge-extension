// Flame Comics (Next.js). Reads the site's /_next/data routes, keyed by a build id that changes on every deploy.
// Port of keiyoushi src/en/flamecomics (Apache-2.0).
const BASE = META.baseUrl;
const CDN = "https://cdn.flamecomics.xyz/uploads/images/series/";
const HEADERS = { Referer: BASE + "/" };
let buildId = null;

async function loadBuildId() {
  const res = ensureOk(await http.get(BASE + "/", { headers: HEADERS }));
  const script = html.parse(res.body, res.url).selectFirst("script#__NEXT_DATA__");
  const id = script ? JSON.parse(script.data()).buildId : null;
  if (!id) throw new Error("Flame Comics build id not found");
  return id;
}

async function nextData(path) {
  if (!buildId) buildId = await loadBuildId();
  let res = await http.get(BASE + "/_next/data/" + buildId + path, { headers: HEADERS });
  if (res.status === 404) {
    // The site was redeployed since the build id was read.
    buildId = await loadBuildId();
    res = await http.get(BASE + "/_next/data/" + buildId + path, { headers: HEADERS });
  }
  return JSON.parse(ensureOk(res).body).pageProps;
}

function stub(s) {
  if (s.series_id == null) return null;
  return { url: "/series/" + s.series_id, title: s.title, cover: CDN + s.series_id + "/" + s.cover + "?" + s.last_edit };
}

const normalize = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, "");
const browseSeries = async () => (await nextData("/browse.json")).series || [];

const STATUS = { ongoing: "ongoing", dropped: "cancelled", hiatus: "hiatus", completed: "completed" };
const seriesId = (url) => pathOf(url).split("/").filter(Boolean)[1];

source = {
  async popular() {
    const all = (await browseSeries()).slice().sort((a, b) => (a.popularityRank || 1e9) - (b.popularityRank || 1e9));
    return { manga: all.map(stub).filter(Boolean), hasNextPage: false };
  },

  async latest() {
    const all = (await nextData("/latest.json")).allSeries || [];
    return { manga: all.map(stub).filter(Boolean), hasNextPage: false };
  },

  // The site has no search endpoint; it filters its full catalogue client side.
  async search(q) {
    const needle = normalize(q);
    const all = await browseSeries();
    return { manga: all.filter((s) => normalize(s.title).indexOf(needle) !== -1).map(stub).filter(Boolean), hasNextPage: false };
  },

  async details(url) {
    const id = seriesId(url);
    const s = (await nextData("/series/" + id + ".json?id=" + id)).series;
    let description = s.description ? html.parse("<div>" + s.description + "</div>", BASE).text() : "";
    const alt = (s.altTitles || []).map((t) => String(t).trim()).filter(Boolean);
    if (alt.length) description += (description ? "\n\n" : "") + "Alternative names:\n" + alt.map((t) => "- " + t).join("\n");
    return {
      title: s.title,
      cover: CDN + id + "/" + s.cover + "?" + s.last_edit,
      author: (s.author || []).join(", "),
      artist: (s.artist || []).join(", "),
      description,
      genres: unique([s.type].concat(s.tags || [])),
      status: STATUS[String(s.status || "").toLowerCase()] || "unknown",
    };
  },

  async chapters(url) {
    const id = seriesId(url);
    const chapters = (await nextData("/series/" + id + ".json?id=" + id)).chapters || [];
    return chapters.map((c) => {
      const n = String(Number(c.chapter));
      return {
        url: "/series/" + c.series_id + "/" + c.token,
        name: "Chapter " + n + (c.title ? " - " + c.title : ""),
        number: Number(c.chapter),
        date: c.release_date ? c.release_date * 1000 : null,
        scanlator: null,
      };
    });
  },

  async pages(url) {
    const parts = pathOf(url).split("/").filter(Boolean);
    const id = parts[1];
    const token = parts[2];
    const chapter = (await nextData("/series/" + id + "/" + token + ".json?" + query([["id", id], ["token", token]]))).chapter;
    const images = chapter.images || {};
    return Object.keys(images).map((k) => ({
      url: CDN + chapter.series_id + "/" + chapter.token + "/" + encodeURIComponent(images[k].name) + "?" + chapter.release_date,
      headers: HEADERS,
    }));
  },
};
