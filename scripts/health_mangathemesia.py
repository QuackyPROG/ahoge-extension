#!/usr/bin/env python3
from __future__ import annotations

"""Health-check the same bounded MangaThemesia common subset Ahoge executes natively."""

import re
import urllib.parse

import healthcheck as legacy


def require(condition: bool, message: str) -> None:
    if not condition:
        raise legacy.HealthError(message)


def absolute_url(base: str, value: str) -> str:
    return urllib.parse.urljoin(base.rstrip("/") + "/", value.strip())


def list_url(base: str, manga_path: str, *, page: int = 1, order: str | None = None, query: str = "") -> str:
    params: list[tuple[str, str]] = [("page", str(max(page, 1)))]
    if query:
        params.append(("title", query))
    if order:
        params.append(("order", order))
    return f"{base.rstrip('/')}/{manga_path.strip('/')}/?{urllib.parse.urlencode(params)}"


def manga_slugs(html: str, base: str, manga_path: str) -> list[str]:
    path_name = manga_path.strip("/")
    output: list[str] = []
    seen: set[str] = set()
    for href in re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\']', html, flags=re.I):
        resolved = absolute_url(base, href)
        parsed = urllib.parse.urlparse(resolved)
        parts = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
        try:
            index = parts.index(path_name)
        except ValueError:
            continue
        if len(parts) != index + 2:
            continue
        slug = parts[index + 1]
        if slug and slug not in seen:
            seen.add(slug)
            output.append(slug)
    return output


def detail_title(html: str) -> str | None:
    patterns = [
        r'<(?:h1|h2|h3)[^>]*class=["\'][^"\']*entry-title[^"\']*["\'][^>]*>([\s\S]*?)</(?:h1|h2|h3)>',
        r'<[^>]+class=["\'][^"\']*ts-breadcrumb[^"\']*["\'][^>]*>[\s\S]*<li[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)</span>',
        r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.I)
        if not match:
            continue
        value = re.sub(r'<[^>]+>', ' ', match.group(1))
        value = re.sub(r'\s+', ' ', value).strip()
        if value:
            return value
    return None


def looks_like_chapter_block(block: str) -> bool:
    lowered = block.lower()
    return any(token in lowered for token in ("chapternum", "chapterdate", "chbox", "eph-num", "lch"))


def chapter_urls(html: str, base: str) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    base_host = urllib.parse.urlparse(base).hostname
    blocks = re.findall(r'(<li\b[^>]*>[\s\S]*?</li>)', html, flags=re.I)
    for block in blocks:
        if not looks_like_chapter_block(block):
            continue
        match = re.search(r'<a\b[^>]*href=["\']([^"\']+)["\']', block, flags=re.I)
        if not match:
            continue
        resolved = absolute_url(base, match.group(1))
        if urllib.parse.urlparse(resolved).hostname != base_host:
            continue
        if resolved not in seen:
            seen.add(resolved)
            output.append(resolved)
    return output


def reader_images(html: str, chapter_url: str) -> list[str]:
    marker = re.search(r'readerarea', html, flags=re.I)
    if not marker:
        return []
    scope = html[marker.start():]
    tags = re.findall(r'<img\b[^>]*>', scope, flags=re.I)
    output: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        raw: str | None = None
        for attr in ("data-src", "data-lazy-src", "data-lzl-src", "data-cfsrc", "src"):
            match = re.search(rf'\b{re.escape(attr)}\s*=\s*["\']([^"\']+)', tag, flags=re.I)
            if match:
                raw = match.group(1).strip()
                break
        if not raw:
            continue
        resolved = absolute_url(chapter_url, raw)
        lowered = resolved.lower()
        if lowered.startswith("data:image"):
            continue
        if any(token in lowered for token in ("logo", "avatar", "banner", "favicon")):
            continue
        if resolved not in seen:
            seen.add(resolved)
            output.append(resolved)
    return output


def check(entry: dict, client: legacy.HttpClient) -> list[str]:
    base = entry["baseUrl"].rstrip("/")
    overrides = entry.get("overrides", {})
    manga_path = str(overrides.get("mangaPath", "manga")).strip("/")
    checks: list[str] = []

    client.text(base)
    checks.append("homepage")

    popular_html = client.text(list_url(base, manga_path, order="popular"))
    popular_slugs = manga_slugs(popular_html, base, manga_path)
    require(bool(popular_slugs), "MangaThemesia popular page produced no manga slugs")
    slug = popular_slugs[0]
    checks.append("popular")

    latest_html = client.text(list_url(base, manga_path, order="update"))
    require(bool(manga_slugs(latest_html, base, manga_path)), "MangaThemesia latest page produced no manga slugs")
    checks.append("latest")

    detail_url = f"{base}/{manga_path}/{urllib.parse.quote(slug)}/"
    detail_html = client.text(detail_url)
    title = detail_title(detail_html)
    require(bool(title), "MangaThemesia detail did not expose a title")
    checks.append("detail")

    search_html = client.text(list_url(base, manga_path, query=legacy.first_word(title or slug)))
    require(bool(manga_slugs(search_html, base, manga_path)), "MangaThemesia search produced no manga slugs")
    checks.append("search")

    chapters = chapter_urls(detail_html, base)
    require(bool(chapters), "MangaThemesia chapter list empty")
    checks.append("chapters")

    pages_found = False
    for chapter_url in chapters[:4]:
        chapter_html = client.text(chapter_url)
        if reader_images(chapter_html, chapter_url):
            pages_found = True
            break
    require(pages_found, "MangaThemesia page metadata empty in sampled chapters")
    checks.append("pages")
    return checks
