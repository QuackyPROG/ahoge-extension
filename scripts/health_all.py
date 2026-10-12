#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import healthcheck as legacy
import health_mangathemesia as themesia
import health_mangadex as mangadex
import health_weebcentral as weebcentral

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "sources.json"
DEFAULT_STATUS_PATH = ROOT / "health" / "status.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise legacy.HealthError(message)


def post_form(client: legacy.HttpClient, target: str, fields: list[tuple[str, str]], referer: str) -> str:
    body = urllib.parse.urlencode(fields).encode()
    return client.text(
        target,
        method="POST",
        body=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": referer,
            "Accept": "text/html,*/*;q=0.8",
        },
    )


def madara_slugs(html: str, manga_path: str) -> list[str]:
    escaped = re.escape(manga_path.strip("/"))
    found = re.findall(
        rf'href=["\'](?:https?://[^/"\']+)?/{escaped}/([^"\'?#/]+)/?["\']',
        html,
        flags=re.I,
    )
    return list(dict.fromkeys(urllib.parse.unquote(value) for value in found if value))


def madara_archive(entry: dict, client: legacy.HttpClient, *, query: str | None, sort_key: str | None) -> str:
    base = entry["baseUrl"].rstrip("/")
    overrides = entry.get("overrides", {})
    manga_path = str(overrides.get("mangaPath", "manga")).strip("/")
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
    if bool(overrides.get("filterNonMangaItems", True)):
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
    return post_form(client, f"{base}/wp-admin/admin-ajax.php", fields, f"{base}/{manga_path}/")


def madara_post_id(html: str) -> str | None:
    patterns = [
        r'id=["\']manga-chapters-holder[^"\']*["\'][^>]+data-id=["\']([0-9]+)["\']',
        r'data-id=["\']([0-9]+)["\'][^>]+id=["\']manga-chapters-holder[^"\']*["\']',
        r'id=["\']manga-chapters-holder-([0-9]+)["\']',
        r'class=["\'][^"\']*rating-post-id[^"\']*["\'][^>]+value=["\']([0-9]+)["\']',
        r'data-post=["\']([0-9]+)["\']',
        r'rel=["\']shortlink["\'][^>]+href=["\'][^"\']*\?p=([0-9]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.I | re.S)
        if match:
            return match.group(1)
    return None


def madara_chapter_hrefs(html: str, base: str) -> list[str]:
    blocks = re.findall(
        r'<li[^>]+class=["\'][^"\']*wp-manga-chapter[^"\']*["\'][^>]*>([\s\S]*?)</li>',
        html,
        flags=re.I,
    )
    values: list[str] = []
    for block in blocks:
        match = re.search(r'<a[^>]+href=["\']([^"\']+)["\']', block, flags=re.I)
        if match:
            values.append(urllib.parse.urljoin(base + "/", match.group(1)))
    return list(dict.fromkeys(values))


def madara_reader_images(html: str, chapter_url: str) -> list[str]:
    if "chapter-protector-data" in html.lower():
        raise legacy.HealthError("Madara chapter uses protector markup outside the supported common subset")

    scope = html
    marker = re.search(r'class=["\'][^"\']*reading-content[^"\']*["\']', html, flags=re.I)
    if marker:
        scope = html[marker.start():]
        for closing in ("</article>", "</main>"):
            end = scope.lower().find(closing)
            if end >= 0:
                scope = scope[:end]
                break

    tags = re.findall(r'<img\b[^>]*>', scope, flags=re.I)
    images: list[str] = []
    for tag in tags:
        value = None
        for attr in ("data-src", "data-lazy-src", "data-lzl-src", "data-cfsrc", "data-manga-src", "data-pagespeed-lazy-src", "src"):
            match = re.search(rf'\b{re.escape(attr)}\s*=\s*["\']([^"\']+)["\']', tag, flags=re.I)
            if match and match.group(1) and not match.group(1).startswith("data:image"):
                value = match.group(1).strip()
                break
        if not value:
            continue
        absolute = urllib.parse.urljoin(chapter_url, value.replace("\\/", "/"))
        lower = absolute.lower()
        if any(token in lower for token in ("logo", "avatar", "banner", "favicon", "/ads/")):
            continue
        if "wp-content/uploads" in lower or re.search(r'\.(?:webp|jpe?g|png)(?:\?|$)', lower):
            images.append(absolute)
    return list(dict.fromkeys(images))


def check_madara(entry: dict, client: legacy.HttpClient) -> list[str]:
    base = entry["baseUrl"].rstrip("/")
    overrides = entry.get("overrides", {})
    manga_path = str(overrides.get("mangaPath", "manga")).strip("/")
    chapter_mode = str(overrides.get("chapterMode", "mangaPage"))
    checks: list[str] = []

    client.text(base)
    checks.append("homepage")

    popular_html = madara_archive(entry, client, query=None, sort_key="_wp_manga_views")
    slugs = madara_slugs(popular_html, manga_path)
    require(bool(slugs), "Madara popular archive produced no manga slugs")
    slug = slugs[0]
    checks.append("popular")

    latest_html = madara_archive(entry, client, query=None, sort_key="_latest_update")
    require(bool(madara_slugs(latest_html, manga_path)), "Madara latest archive produced no manga slugs")
    checks.append("latest")

    search_html = madara_archive(entry, client, query=legacy.first_word(slug.replace("-", " ")), sort_key=None)
    require(bool(madara_slugs(search_html, manga_path)), "Madara search produced no manga slugs")
    checks.append("search")

    detail_url = f"{base}/{manga_path}/{urllib.parse.quote(slug)}/"
    detail_html = client.text(detail_url)
    require(
        bool(re.search(r'<h[13]\b', detail_html, flags=re.I) or re.search(r'property=["\']og:title["\']', detail_html, flags=re.I)),
        "Madara detail did not expose a title",
    )
    require("chapter-protector-data" not in detail_html.lower(), "Madara detail uses unsupported protector markup")
    checks.append("detail")

    if chapter_mode == "mangaPage":
        chapter_html = detail_html
    elif chapter_mode == "adminAjax":
        post_id = madara_post_id(detail_html)
        require(bool(post_id), "Madara adminAjax chapter mode could not resolve post ID")
        chapter_html = post_form(
            client,
            f"{base}/wp-admin/admin-ajax.php",
            [("action", "manga_get_chapters"), ("manga", str(post_id))],
            detail_url,
        )
    elif chapter_mode == "mangaAjax":
        chapter_html = post_form(client, f"{base}/{manga_path}/{slug}/ajax/chapters/", [], detail_url)
    else:
        raise legacy.HealthError(f"unsupported Madara chapterMode: {chapter_mode}")

    require("chapter-protector-data" not in chapter_html.lower(), "Madara chapter list uses unsupported protector markup")
    hrefs = madara_chapter_hrefs(chapter_html, base)
    require(bool(hrefs), "Madara chapter list empty")
    checks.append("chapters")

    pages_found = False
    for chapter_url in hrefs[:4]:
        reader_html = client.text(chapter_url)
        if madara_reader_images(reader_html, chapter_url):
            pages_found = True
            break
    require(pages_found, "Madara page metadata empty in sampled chapters")
    checks.append("pages")
    return checks


def run_source(entry: dict, client: legacy.HttpClient) -> tuple[str, list[str], str | None]:
    if not entry.get("enabled"):
        return "unsupported", [], "source disabled in canonical catalog"
    engine = entry.get("engine")
    adapter = entry.get("adapter")
    if engine == "api" and adapter == "mangadex":
        checker = mangadex.check
    elif engine == "api" and adapter == "weebcentral":
        checker = weebcentral.check
    elif engine == "madara":
        checker = check_madara
    elif engine == "mangaThemesia":
        checker = themesia.check
    else:
        return legacy.run_source(entry, client)
    try:
        checks = checker(entry, client)
        return "healthy", checks, None
    except legacy.BlockedError as exc:
        return "blocked", [], str(exc)
    except legacy.HealthError as exc:
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
    return {
        item["sourceId"]: item
        for item in payload.get("sources", [])
        if isinstance(item, dict) and item.get("sourceId")
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate all enabled Ahoge source runtimes without downloading chapter image payloads")
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
    known = {entry["sourceId"] for entry in catalog["sources"]}
    missing = selected_ids - known
    if missing:
        raise SystemExit(f"Unknown source IDs: {sorted(missing)}")

    output_path = ROOT / args.output
    previous = load_previous(output_path)
    client = legacy.HttpClient(timeout=args.timeout)
    checked_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    results: list[dict] = []
    failed = False

    for entry in entries:
        status, checks, error = run_source(entry, client)
        previous_failures = int(previous.get(entry["sourceId"], {}).get("consecutiveFailures", 0) or 0)
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

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps({"schemaVersion": 1, "checkedAt": checked_at, "sources": results}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return 1 if args.strict and failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
