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
USER_AGENT = "Ahoge-SourceHealth/2.0 (+https://github.com/QuackyPROG/ahoge-extension)"


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

    def request(self, url: str, *, method: str = "GET", body: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[bytes, str]:
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
                    content_type = response.headers.get("Content-Type", "").lower()
                    return data, content_type
            except urllib.error.HTTPError as exc:
                body_preview = exc.read(4096).decode("utf-8", errors="ignore").lower()
                if exc.code in {403, 429} or (exc.code == 503 and any(token in body_preview for token in ("cloudflare", "challenge", "captcha"))):
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
    if query:
        value += "?" + urllib.parse.urlencode(query)
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise HealthError(message)


def first_word(value: str) -> str:
    match = re.search(r"[A-Za-z0-9]{3,}", value)
    return match.group(0) if match else "manga"


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
        chapter_html = client.text(urllib.parse.urljoin(base + "/", path))
        if "cdn.asurascans.com/asura-images/chapters/" in chapter_html:
            found_pages = True
            break
    require(found_pages, "Asura free page metadata not found in sampled chapters")
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
    except Exception as exc:  # fail closed, but keep report generation alive
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
