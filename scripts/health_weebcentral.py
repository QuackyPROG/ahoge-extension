#!/usr/bin/env python3
from __future__ import annotations

import html as html_lib
import re
import urllib.parse

import healthcheck as legacy


SERIES_LINK = re.compile(
    r'''<a\b[^>]*href=["']([^"']*/series/([^/"']+)/([^/?#"']+)[^"']*)["'][^>]*>([\s\S]*?)</a>''',
    re.I,
)
TAG = re.compile(r"<[^>]+>")


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(TAG.sub(" ", value))).strip()


def search_url(base: str, *, text: str, sort: str, offset: int = 0) -> str:
    fields = [
        ("text", text),
        ("sort", sort),
        ("order", "Descending"),
        ("official", "Any"),
        ("anime", "Any"),
        ("adult", "Any"),
        ("limit", "32"),
        ("offset", str(offset)),
        ("display_mode", "Full Display"),
    ]
    return base.rstrip("/") + "/search/data?" + urllib.parse.urlencode(fields)


def absolute(base: str, value: str) -> str:
    value = html_lib.unescape(value).strip()
    return urllib.parse.urljoin(base.rstrip("/") + "/", value)


def list_series(base: str, body: str) -> list[dict[str, str]]:
    output: list[dict[str, str]] = []
    seen: set[str] = set()
    for match in SERIES_LINK.finditer(body):
        href, series_id, slug, inner = match.groups()
        if series_id in seen:
            continue
        no_class_divs = re.findall(r'''<div(?![^>]*\bclass\s*=)[^>]*>([\s\S]*?)</div>''', inner, re.I)
        title = next((clean(value) for value in reversed(no_class_divs) if clean(value)), "")
        if not title:
            title_match = re.search(r'''\btitle\s*=\s*["']([^"']+)["']''', match.group(0), re.I)
            title = clean(title_match.group(1)) if title_match else slug.replace("-", " ").title()
        if not title:
            continue
        seen.add(series_id)
        output.append({"id": series_id, "slug": slug, "title": title, "url": absolute(base, href)})
    return output


def labelled_block(body: str, label: str) -> str | None:
    match = re.search(
        rf'''(<li\b[^>]*>[\s\S]*?<strong\b[^>]*>[^<]*{re.escape(label)}[^<]*</strong>[\s\S]*?</li>)''',
        body,
        re.I,
    )
    return match.group(1) if match else None


def check(entry: dict, client: legacy.HttpClient) -> list[str]:
    base = entry["baseUrl"].rstrip("/")
    checks: list[str] = []

    popular_html = client.text(search_url(base, text="", sort="Popularity"))
    popular = list_series(base, popular_html)
    legacy.require(bool(popular), "WeebCentral popular returned no series")
    checks.append("popular")

    latest_html = client.text(search_url(base, text="", sort="Latest Updates"))
    latest = list_series(base, latest_html)
    legacy.require(bool(latest), "WeebCentral latest returned no series")
    checks.append("latest")

    sample_pool: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in popular + latest:
        if item["id"] not in seen:
            seen.add(item["id"])
            sample_pool.append(item)

    probe = sample_pool[0]
    search_html = client.text(search_url(base, text=legacy.first_word(probe["title"]), sort="Best Match"))
    legacy.require(bool(list_series(base, search_html)), "WeebCentral search returned no series")
    checks.append("search")

    readable_series: dict[str, str] | None = None
    readable_chapter: str | None = None
    detail_html: str | None = None
    chapter_html: str | None = None

    for series in sample_pool[:8]:
        current_detail = client.text(series["url"])
        title_match = re.search(r"<h1\b[^>]*>([\s\S]*?)</h1>", current_detail, re.I)
        if not title_match or not clean(title_match.group(1)):
            continue

        full_list_url = f"{base}/series/{series['id']}/full-chapter-list"
        current_chapters = client.text(full_list_url)
        anchors = re.findall(r'''<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)</a>''', current_chapters, re.I)
        candidate = None
        for href, inner in anchors:
            if not re.search(r'''<span\b[^>]*class=["'][^"']*flex[^"']*["']''', inner, re.I):
                continue
            title = re.search(r'''<span\b[^>]*class=["'][^"']*flex[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)</span>''', inner, re.I)
            if title and clean(title.group(1)):
                candidate = absolute(base, href)
                break
        if candidate:
            readable_series = series
            readable_chapter = candidate
            detail_html = current_detail
            chapter_html = current_chapters
            break

    legacy.require(readable_series is not None and readable_chapter is not None, "WeebCentral sampled series exposed no readable chapter metadata")
    legacy.require(detail_html is not None and chapter_html is not None, "WeebCentral detail/chapter metadata missing")

    legacy.require(re.search(r"<h1\b[^>]*>[\s\S]*?</h1>", detail_html, re.I) is not None, "WeebCentral detail missing title")
    legacy.require(labelled_block(detail_html, "Status") is not None or labelled_block(detail_html, "Description") is not None, "WeebCentral detail shape not recognized")
    checks.append("detail")

    legacy.require(re.search(r'''<time\b[^>]*datetime=["'][^"']+["']''', chapter_html, re.I) is not None or "full-chapter-list" not in chapter_html.lower(), "WeebCentral chapter list shape not recognized")
    checks.append("chapters")

    image_url = readable_chapter.rstrip("/") + "/images?" + urllib.parse.urlencode({
        "is_prev": "False",
        "reading_style": "long_strip",
    })
    image_html = client.text(image_url)
    scroll_section = re.search(
        r'''<section\b[^>]*x-data=["'][^"']*scroll[^"']*["'][^>]*>([\s\S]*?)</section>''',
        image_html,
        re.I,
    )
    scope = scroll_section.group(1) if scroll_section else image_html
    images = re.findall(r'''<img\b[^>]*src=["']([^"']+)["']''', scope, re.I)
    images = [absolute(base, item) for item in images if item and not item.lower().startswith("data:image")]
    legacy.require(bool(images), "WeebCentral page metadata empty")
    checks.append("pages")

    return checks
