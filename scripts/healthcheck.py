#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "sources.json"
DEFAULT_STATUS_PATH = ROOT / "health" / "status.json"
USER_AGENT = "Ahoge-SourceHealth/2.1 (+https://github.com/QuackyPROG/ahoge-extension)"


class HealthError(RuntimeError):
    pass


class BlockedError(HealthError):
    pass


@dataclass
class HttpClient:
    timeout: int = 15
    retries: int = 2
    min_interval: float = 0.4

    def __post_init__(self) -> None:
        self._last_request: dict[str, float] = {}

    def _throttle(self, url: str) -> None:
        host = urllib.parse.urlparse(url).netloc
        now = time.monotonic()
        remaining = self.min_interval - (now - self._last_request.get(host, 0.0))
        if remaining > 0:
            time.sleep(remaining)
        self._last_request[host] = time.monotonic()

    def request(
        self,
        url: str,
        *,
        method: str = "GET",
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[bytes, str]:
        last_error: Exception | None = None
        merged_headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        if headers:
            merged_headers.update(headers)

        for attempt in range(self.retries + 1):
            self._throttle(url)
            request = urllib.request.Request(url, data=body, headers=merged_headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    data = response.read(2_500_000)
                    return data, response.headers.get("Content-Type", "").lower()
            except urllib.error.HTTPError as exc:
                preview = exc.read(4096).decode("utf-8", errors="ignore").lower()
                if exc.code in {403, 429} or (
                    exc.code == 503 and any(token in preview for token in ("cloudflare", "challenge", "captcha"))
                ):
                    raise BlockedError(f"HTTP {exc.code} from {url}") from exc
                last_error = HealthError(f"HTTP {exc.code} from {url}")
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_error = exc
            if attempt < self.retries:
                time.sleep(1.5 * (attempt + 1))
        raise HealthError(f"request failed for {url}: {last_error}")

    def text(self, url: str, **kwargs: Any) -> str:
        data, _ = self.request(url, **kwargs)
        return data.decode("utf-8", errors="replace")

    def json(self, url: str, **kwargs: Any) -> Any:
        data, content_type = self.request(url, **kwargs)
        if "json" not in content_type and not data.lstrip().startswith((b"{", b"[")):
            raise HealthError(f"expected JSON from {url}, got {content_type or 'unknown content type'}")
        try:
            return json.loads(data)
        except json.JSONDecodeError as exc:
            raise HealthError(f"invalid JSON from {url}: {exc}") from exc


def url(base: str, path: str, query: dict[str, str] | None = None) -> str:
    value = base.rstrip("/") + "/" + path.lstrip("/")
    return value + ("?" + urllib.parse.urlencode(query) if query else "")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise HealthError(message)


def first_word(value: str) -> str:
    match = re.search(r"[A-Za-z0-9]{3,}", value)
    return match.group(0) if match else "manga"


def form_body(fields: list[tuple[str, str]]) -> bytes:
    return urllib.parse.urlencode(fields).encode()


def check_ezmanhwa(entry: dict, client: HttpClient) -> list[str]:
    api = entry["apiUrl"].rstrip("/")
    checks: list[str] = []
    client.text(entry["baseUrl"])
    checks.append("homepage")
    listing = client.json(url(api, "/series", {"page": "1", "perPage": "3", "sort": "latest"}))
    data = listing.get("data") if isinstance(listing, dict) else None
    require(isinstance(data, list) and data, "EZManhwa latest returned no series")
    series = data[0]
    slug = series.get("slug")
    title = series.get("title") or slug
    require(isinstance(slug, str) and slug, "EZManhwa series missing slug")
    checks.append("latest")
    search = client.json(url(api, "/series/search", {"page": "1", "perPage": "3", "q": first_word(str(title))}))
    require(isinstance(search, dict) and isinstance(search.get("data"), list), "EZManhwa search did not parse")
    checks.append("search")
    detail = client.json(url(api, f"/series/{slug}"))
    require(isinstance(detail, dict), "EZManhwa detail did not parse")
    checks.append("detail")
    chapters = client.json(url(api, f"/series/{slug}/chapters", {"page": "1", "perPage": "10", "sort": "desc"}))
    chapter_data = chapters.get("data") if isinstance(chapters, dict) else None
    require(isinstance(chapter_data, list) and chapter_data, "EZManhwa chapter list empty")
    checks.append("chapters")
    free = next((item for item in chapter_data if not item.get("requiresPurchase") and isinstance(item.get("slug"), str)), None)
    require(free is not None, "EZManhwa has no free chapter metadata to validate")
    page_meta = client.json(url(api, f"/series/{slug}/chapters/{free['slug']}"))
    images = page_meta.get("images") if isinstance(page_meta, dict) else None
    require(isinstance(images, list) and images, "EZManhwa page metadata empty")
    checks.append("pages")
    return checks


def check_heancms(entry: dict, client: HttpClient) -> list[str]:
    api = entry["apiUrl"].rstrip("/")
    checks: list[str] = []
    client.text(entry["baseUrl"])
    checks.append("homepage")
    common = {
        "query_string": "",
        "status": "All",
        "order": entry.get("overrides", {}).get("latestSortOrder", "desc"),
        "orderBy": "latest",
        "series_type": "Comic",
        "page": "1",
        "perPage": "3",
        "tags_ids": "[]",
        "adult": "true",
    }
    listing = client.json(url(api, "/query", common))
    data = listing.get("data") if isinstance(listing, dict) else None
    require(isinstance(data, list) and data, "HeanCMS latest returned no series")
    series = data[0]
    slug = series.get("series_slug") or series.get("slug")
    series_id = series.get("id")
    title = series.get("title") or slug
    require(isinstance(slug, str) and slug and isinstance(series_id, int), "HeanCMS series identity missing")
    checks.append("latest")
    search_query = dict(common)
    search_query["query_string"] = first_word(str(title))
    search = client.json(url(api, "/query", search_query))
    require(isinstance(search, dict) and isinstance(search.get("data"), list), "HeanCMS search did not parse")
    checks.append("search")
    detail = client.json(url(api, f"/series/{slug}"))
    require(isinstance(detail, dict), "HeanCMS detail did not parse")
    checks.append("detail")
    chapters = client.json(url(api, "/chapter/query", {"page": "1", "perPage": "20", "series_id": str(series_id)}))
    chapter_data = chapters.get("data") if isinstance(chapters, dict) else None
    require(isinstance(chapter_data, list) and chapter_data, "HeanCMS chapter list empty")
    checks.append("chapters")
    free = next((item for item in chapter_data if int(item.get("price") or 0) == 0 and isinstance(item.get("chapter_slug"), str)), None)
    require(free is not None, "HeanCMS has no free chapter metadata to validate")
    page_meta = client.json(url(api, f"/chapter/{slug}/{free['chapter_slug']}"))
    chapter = page_meta.get("chapter") if isinstance(page_meta, dict) else None
    chapter_data_obj = chapter.get("chapter_data") if isinstance(chapter, dict) else None
    images = chapter_data_obj.get("images") if isinstance(chapter_data_obj, dict) else None
    require(isinstance(images, list) and images, "HeanCMS page metadata empty")
    checks.append("pages")
    return checks


def manga_slugs_from_html(html: str) -> list[str]:
    found = re.findall(r'href=["\'](?:https?://[^/"\']+)?/manga/([^"\'?#/]+)', html, flags=re.I)
    return list(dict.fromkeys(found))


def check_mangabox(entry: dict, client: HttpClient) -> list[str]:
    base = entry["baseUrl"].rstrip("/")
    checks: list[str] = []
    listing_html = client.text(url(base, "/manga-list/hot-manga", {"page": "1"}))
    slugs = manga_slugs_from_html(listing_html)
    require(slugs, "MangaBox popular page produced no manga slugs")
    slug = slugs[0]
    checks.extend(["homepage", "popular"])
    search_html = client.text(url(base, f"/search/story/{urllib.parse.quote(slug.split('-')[0])}", {"page": "1"}))
    require(manga_slugs_from_html(search_html), "MangaBox search produced no manga slugs")
    checks.append("search")
    detail_html = client.text(url(base, f"/manga/{slug}"))
    require("<h1" in detail_html.lower() or "og:title" in detail_html.lower(), "MangaBox detail did not parse")
    checks.append("detail")
    chapters = client.json(url(base, f"/api/manga/{slug}/chapters", {"limit": "-1"}))
    data = chapters.get("data") if isinstance(chapters, dict) else None
    items = data.get("chapters") if isinstance(data, dict) else None
    require(chapters.get("success") is not False and isinstance(items, list) and items, "MangaBox chapter list empty")
    checks.append("chapters")
    chapter_slug = next((item.get("chapter_slug") for item in items if isinstance(item.get("chapter_slug"), str)), None)
    require(chapter_slug, "MangaBox chapter slug missing")
    chapter_html = client.text(url(base, f"/manga/{slug}/{chapter_slug}"))
    has_js_pages = bool(re.search(r"chapterImages\s*=\s*\[", chapter_html, flags=re.I))
    has_reader_images = bool(re.search(r'<img[^>]+(?:data-src|src)=["\']https?://', chapter_html, flags=re.I))
    require(has_js_pages or has_reader_images, "MangaBox page metadata empty")
    checks.append("pages")
    return checks


def check_natsuid(entry: dict, client: HttpClient) -> list[str]:
    base = entry["baseUrl"].rstrip("/")
    checks: list[str] = []
    listing = client.json(url(base, "/wp-json/wp/v2/manga", {"per_page": "3", "page": "1", "_embed": ""}))
    require(isinstance(listing, list) and listing, "NatsuId manga API returned no entries")
    manga = listing[0]
    manga_id = manga.get("id")
    slug = manga.get("slug")
    title_obj = manga.get("title")
    title = title_obj.get("rendered") if isinstance(title_obj, dict) else slug
    require(isinstance(manga_id, int) and isinstance(slug, str) and slug, "NatsuId manga identity missing")
    checks.extend(["homepage", "latest"])
    detail = client.json(url(base, f"/wp-json/wp/v2/manga/{manga_id}", {"_embed": ""}))
    require(isinstance(detail, dict) and detail.get("id") == manga_id, "NatsuId detail did not parse")
    checks.append("detail")
    nonce_html = client.text(url(base, "/wp-admin/admin-ajax.php", {"type": "search_form", "action": "get_nonce"}))
    nonce_match = re.search(r'name=["\']search_nonce["\'][^>]*value=["\']([^"\']+)', nonce_html, flags=re.I)
    require(nonce_match is not None, "NatsuId search nonce missing")
    boundary = "AhogeHealthBoundary"
    fields = {
        "nonce": nonce_match.group(1), "inclusion": "OR", "exclusion": "OR", "page": "1",
        "genre": "[]", "genre_exclude": "[]", "author": "[]", "artist": "[]", "project": "0",
        "type": "[]", "order": "desc", "orderby": "popular", "query": first_word(str(title)),
    }
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n".encode())
    chunks.append(f"--{boundary}--\r\n".encode())
    search_html = client.text(
        url(base, "/wp-admin/admin-ajax.php", {"action": "advanced_search"}),
        method="POST",
        body=b"".join(chunks),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Referer": base + "/"},
    )
    require(re.search(r'/manga/[^"\']+', search_html), "NatsuId search produced no manga links")
    checks.append("search")
    page_override = entry.get("overrides", {}).get("chapterListPageOverride", 999)
    chapter_html = client.text(url(base, "/wp-admin/admin-ajax.php", {"manga_id": str(manga_id), "page": str(page_override), "action": "chapter_list"}))
    hrefs = re.findall(r'<a[^>]*href=["\']([^"\']+)["\'][^>]*>[\s\S]*?<time', chapter_html, flags=re.I)
    require(hrefs, "NatsuId chapter list empty")
    checks.append("chapters")
    chapter_url = urllib.parse.urljoin(base + "/", hrefs[0])
    reader_html = client.text(chapter_url)
    images = re.findall(r'<img[^>]+src=["\']([^"\']+)', reader_html, flags=re.I)
    likely = [value for value in images if re.search(r'\.(?:webp|jpe?g|png)(?:\?|$)', value, flags=re.I)]
    require(len(likely) >= 2, "NatsuId page metadata empty")
    checks.append("pages")
    return checks


def check_asura(entry: dict, client: HttpClient) -> list[str]:
    base = entry["baseUrl"].rstrip("/")
    api = entry["apiUrl"].rstrip("/")
    checks: list[str] = []
    client.text(base)
    checks.append("homepage")
    listing = client.json(url(api, "/series", {"offset": "0", "limit": "10", "sort": "latest", "order": "desc"}))
    data = listing.get("data") if isinstance(listing, dict) else None
    require(isinstance(data, list) and data, "Asura API returned no series")
    series = data[0]
    title = series.get("title") or "manga"
    public_path = series.get("public_url") or series.get("publicUrl") or ""
    public_slug = urllib.parse.urlparse(public_path).path.rstrip("/").split("/")[-1] if public_path else series.get("slug")
    require(isinstance(public_slug, str) and public_slug, "Asura public slug missing")
    checks.append("latest")
    search = client.json(url(api, "/series", {"offset": "0", "limit": "10", "sort": "latest", "order": "desc", "search": first_word(str(title))}))
    require(isinstance(search, dict) and isinstance(search.get("data"), list), "Asura search did not parse")
    checks.append("search")
    detail_html = client.text(url(base, f"/comics/{public_slug}"))
    require("<h1" in detail_html.lower() or "og:title" in detail_html.lower(), "Asura detail did not parse")
    checks.append("detail")
    chapter_paths = list(dict.fromkeys(re.findall(r'href=["\'](/comics/[^"\']+/chapter/[0-9]+(?:\.[0-9]+)?)["\']', detail_html, flags=re.I)))
    require(chapter_paths, "Asura chapter list empty")
    checks.append("chapters")
    found_pages = False
    for path in chapter_paths[:4]:
        if "cdn.asurascans.com/asura-images/chapters/" in client.text(urllib.parse.urljoin(base + "/", path)):
            found_pages = True
            break
    require(found_pages, "Asura free page metadata not found in sampled chapters")
    checks.append("pages")
    return checks


def madara_archive_items(html: str, manga_path: str) -> list[tuple[str, str]]:
    path = re.escape(manga_path.strip("/"))
    pattern = rf'<[^>]+class=["\'][^"\']*post-title[^"\']*["\'][^>]*>[\s\S]*?<a[^>]+href=["\']([^"\']*/{path}/([^"\'?#/]+)/?[^"\']*)["\'][^>]*>([\s\S]*?)</a>'
    items: list[tuple[str, str]] = []
    seen: set[str] = set()
    for _, slug, title_html in re.findall(pattern, html, flags=re.I):
        title = re.sub(r"<[^>]+>", " ", title_html)
        title = re.sub(r"\s+", " ", title).strip()
        if slug and title and slug not in seen:
            seen.add(slug)
            items.append((slug, title))
    return items


def madara_browse(entry: dict, client: HttpClient, *, query: str | None = None, sort_key: str | None = None) -> str:
    base = entry["baseUrl"].rstrip("/")
    overrides = entry.get("overrides", {})
    manga_path = overrides.get("mangaPath", "manga")
    fields: list[tuple[str, str]] = [
        ("action", "madara_load_more"),
        ("page", "0"),
        ("template", "madara-core/content/content-archive"),
        ("vars[paged]", "1"),
        ("vars[template]", "archive"),
        ("vars[posts_per_page]", "25"),
        ("vars[post_type]", "wp-manga"),
        ("vars[post_status]", "publish"),
        ("vars[manga_archives_item_layout]", "big_thumbnail"),
    ]
    if overrides.get("filterNonMangaItems", True):
        fields.extend([
            ("vars[meta_query][0][key]", "_wp_manga_chapter_type"),
            ("vars[meta_query][0][value]", "manga"),
        ])
    if query:
        fields.append(("vars[s]", query))
    if sort_key:
        fields.extend([
            ("vars[orderby]", "meta_value_num"),
            ("vars[meta_key]", sort_key),
            ("vars[order]", "DESC"),
        ])
    return client.text(
        url(base, "/wp-admin/admin-ajax.php"),
        method="POST",
        body=form_body(fields),
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{base}/{manga_path}/",
        },
    )


def madara_post_id(html: str) -> str | None:
    patterns = [
        r'id=["\']manga-chapters-holder[^"\']*["\'][^>]+data-id=["\']([0-9]+)',
        r'data-id=["\']([0-9]+)["\'][^>]+id=["\']manga-chapters-holder',
        r'id=["\']manga-chapters-holder-([0-9]+)',
        r'class=["\'][^"\']*rating-post-id[^"\']*["\'][^>]+value=["\']([0-9]+)',
        r'data-post=["\']([0-9]+)',
        r'rel=["\']shortlink["\'][^>]+href=["\'][^"\']*\?p=([0-9]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.I | re.S)
        if match:
            return match.group(1)
    return None


def madara_chapter_links(html: str) -> list[str]:
    blocks = re.findall(r'<li[^>]+class=["\'][^"\']*wp-manga-chapter[^"\']*["\'][^>]*>([\s\S]*?)</li>', html, flags=re.I)
    links: list[str] = []
    for block in blocks:
        match = re.search(r'<a[^>]+href=["\']([^"\']+)', block, flags=re.I)
        if match and match.group(1) not in links:
            links.append(match.group(1))
    return links


def madara_has_page_metadata(html: str) -> bool:
    if "chapter-protector-data" in html.lower():
        raise HealthError("Madara chapter uses unsupported protector markup")
    scope_match = re.search(r'class=["\'][^"\']*reading-content[^"\']*["\']', html, flags=re.I)
    scope = html[scope_match.start():] if scope_match else html
    tags = re.findall(r'<img\b[^>]*>', scope, flags=re.I)
    for tag in tags:
        for attr in ("data-src", "data-lazy-src", "data-lzl-src", "data-cfsrc", "data-manga-src", "src"):
            match = re.search(rf'\b{re.escape(attr)}\s*=\s*["\']([^"\']+)', tag, flags=re.I)
            if not match:
                continue
            value = match.group(1).lower()
            if value.startswith("data:image") or any(token in value for token in ("logo", "avatar", "banner", "favicon", "/ads/")):
                continue
            if "wp-content/uploads" in value or re.search(r'\.(?:webp|jpe?g|png)(?:\?|$)', value):
                return True
    return False


def check_madara(entry: dict, client: HttpClient) -> list[str]:
    base = entry["baseUrl"].rstrip("/")
    overrides = entry.get("overrides", {})
    manga_path = overrides.get("mangaPath", "manga")
    chapter_mode = overrides.get("chapterMode", "mangaPage")
    checks: list[str] = []

    client.text(f"{base}/{manga_path}/")
    checks.append("homepage")
    popular_html = madara_browse(entry, client, sort_key="_wp_manga_views")
    items = madara_archive_items(popular_html, manga_path)
    require(items, "Madara popular AJAX returned no parseable manga")
    slug, title = items[0]
    checks.append("popular")

    search_html = madara_browse(entry, client, query=first_word(title))
    require(madara_archive_items(search_html, manga_path), "Madara search AJAX returned no parseable manga")
    checks.append("search")

    detail_url = f"{base}/{manga_path}/{urllib.parse.quote(slug)}/"
    detail_html = client.text(detail_url)
    require("chapter-protector-data" not in detail_html.lower(), "Madara detail uses unsupported protector markup")
    require(
        re.search(r'class=["\'][^"\']*post-title[^"\']*["\'][\s\S]{0,800}<h[13]', detail_html, flags=re.I)
        or "og:title" in detail_html.lower(),
        "Madara detail did not parse",
    )
    checks.append("detail")

    if chapter_mode == "mangaPage":
        chapter_html = detail_html
    elif chapter_mode == "adminAjax":
        post_id = madara_post_id(detail_html)
        require(post_id is not None, "Madara adminAjax post ID missing")
        chapter_html = client.text(
            url(base, "/wp-admin/admin-ajax.php"),
            method="POST",
            body=form_body([("action", "manga_get_chapters"), ("manga", post_id)]),
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": detail_url,
            },
        )
    elif chapter_mode == "mangaAjax":
        chapter_html = client.text(
            f"{base}/{manga_path}/{urllib.parse.quote(slug)}/ajax/chapters/",
            method="POST",
            body=b"",
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": detail_url,
            },
        )
    else:
        raise HealthError(f"unsupported Madara chapterMode {chapter_mode}")

    require("chapter-protector-data" not in chapter_html.lower(), "Madara chapter list uses unsupported protector markup")
    chapter_links = madara_chapter_links(chapter_html)
    require(chapter_links, "Madara chapter list empty")
    checks.append("chapters")

    pages_ok = False
    for href in chapter_links[:4]:
        chapter_url = urllib.parse.urljoin(base + "/", href)
        if madara_has_page_metadata(client.text(chapter_url)):
            pages_ok = True
            break
    require(pages_ok, "Madara page metadata not found in sampled chapters")
    checks.append("pages")
    return checks


def run_source(entry: dict, client: HttpClient) -> tuple[str, list[str], str | None]:
    if not entry.get("enabled"):
        return "unsupported", [], "source disabled in canonical catalog"
    try:
        engine = entry["engine"]
        if engine == "mangaBox":
            checks = check_mangabox(entry, client)
        elif engine == "natsuId":
            checks = check_natsuid(entry, client)
        elif engine == "asuraScans":
            checks = check_asura(entry, client)
        elif engine == "madara":
            checks = check_madara(entry, client)
        elif engine == "api" and entry.get("adapter") == "ezmanhwa":
            checks = check_ezmanhwa(entry, client)
        elif engine == "api" and entry.get("adapter") == "heancms":
            checks = check_heancms(entry, client)
        else:
            return "unsupported", [], f"no health adapter for {engine}/{entry.get('adapter')}"
        return "healthy", checks, None
    except BlockedError as exc:
        return "blocked", [], str(exc)
    except HealthError as exc:
        return "broken", [], str(exc)
    except Exception as exc:
        return "broken", [], f"{type(exc).__name__}: {exc}"


def load_previous(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {item["sourceId"]: item for item in payload.get("sources", []) if isinstance(item, dict) and item.get("sourceId")}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate selected Ahoge sources without downloading chapter image payloads")
    parser.add_argument("--source", action="append", default=[], help="source ID to check; may be repeated")
    parser.add_argument("--include-disabled", action="store_true")
    parser.add_argument("--output", default=str(DEFAULT_STATUS_PATH.relative_to(ROOT)))
    parser.add_argument("--strict", action="store_true", help="return non-zero if any selected enabled source is not healthy")
    parser.add_argument("--timeout", type=int, default=15)
    args = parser.parse_args()

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    selected_ids = set(args.source)
    entries = [
        entry for entry in catalog["sources"]
        if (not selected_ids or entry["sourceId"] in selected_ids)
        and (args.include_disabled or entry.get("enabled"))
    ]
    if selected_ids - {entry["sourceId"] for entry in entries}:
        missing = sorted(selected_ids - {entry["sourceId"] for entry in entries})
        raise SystemExit(f"Unknown or excluded source IDs: {missing}")

    output_path = ROOT / args.output
    previous = load_previous(output_path)
    client = HttpClient(timeout=args.timeout)
    checked_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    results = []
    failed = False

    for entry in entries:
        status, checks, error = run_source(entry, client)
        previous_item = previous.get(entry["sourceId"], {})
        previous_failures = int(previous_item.get("consecutiveFailures", 0) or 0)
        consecutive = 0 if status == "healthy" else previous_failures + 1
        if entry.get("enabled") and status != "healthy":
            failed = True
        results.append({
            "sourceId": entry["sourceId"],
            "name": entry["name"],
            "engine": entry["engine"],
            "adapter": entry.get("adapter"),
            "language": entry["language"],
            "status": status,
            "checks": checks,
            "checkedAt": checked_at,
            "consecutiveFailures": consecutive,
            "error": error,
        })
        suffix = f" - {error}" if error else ""
        print(f"{entry['sourceId']}: {status}{suffix}")

    payload = {"schemaVersion": 1, "checkedAt": checked_at, "sources": results}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 1 if args.strict and failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
