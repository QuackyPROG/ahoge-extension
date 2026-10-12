#!/usr/bin/env python3
from __future__ import annotations

import urllib.parse

import healthcheck as legacy


def api_url(api: str, path: str, fields: list[tuple[str, str]] | None = None) -> str:
    target = api.rstrip("/") + "/" + path.lstrip("/")
    return target if not fields else target + "?" + urllib.parse.urlencode(fields)


def require_collection(payload: object, message: str) -> list[dict]:
    legacy.require(isinstance(payload, dict), message)
    data = payload.get("data")
    legacy.require(isinstance(data, list) and bool(data), message)
    return [item for item in data if isinstance(item, dict)]


def localized(values: object, language: str) -> str | None:
    if not isinstance(values, dict):
        return None
    value = values.get(language) or values.get("en")
    if isinstance(value, str) and value.strip():
        return value.strip()
    for candidate in values.values():
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def browse_fields(language: str, order_key: str) -> list[tuple[str, str]]:
    return [
        ("limit", "5"),
        ("offset", "0"),
        ("includes[]", "cover_art"),
        ("availableTranslatedLanguage[]", language),
        ("contentRating[]", "safe"),
        ("contentRating[]", "suggestive"),
        ("contentRating[]", "erotica"),
        (f"order[{order_key}]", "desc"),
    ]


def chapter_fields(language: str) -> list[tuple[str, str]]:
    return [
        ("translatedLanguage[]", language),
        ("order[volume]", "desc"),
        ("order[chapter]", "desc"),
        ("includeFuturePublishAt", "0"),
        ("includeExternalUrl", "0"),
        ("includeEmptyPages", "0"),
        ("limit", "25"),
        ("offset", "0"),
    ]


def readable_chapter(chapters: list[dict]) -> dict | None:
    for chapter in chapters:
        attrs = chapter.get("attributes")
        if not isinstance(attrs, dict):
            continue
        if attrs.get("externalUrl") is not None:
            continue
        if isinstance(attrs.get("pages"), int) and attrs.get("pages", 0) <= 0:
            continue
        if isinstance(chapter.get("id"), str) and chapter["id"]:
            return chapter
    return None


def check(entry: dict, client: legacy.HttpClient) -> list[str]:
    api = entry["apiUrl"].rstrip("/")
    language = str(entry.get("overrides", {}).get("translatedLanguage", entry.get("language", "en")))
    checks: list[str] = []

    popular = client.json(api_url(api, "/manga", browse_fields(language, "followedCount")))
    popular_data = require_collection(popular, "MangaDex popular returned no manga")
    checks.append("popular")

    latest = client.json(api_url(api, "/manga", browse_fields(language, "latestUploadedChapter")))
    latest_data = require_collection(latest, "MangaDex latest returned no manga")
    checks.append("latest")

    candidates: list[dict] = []
    seen_ids: set[str] = set()
    for manga in popular_data + latest_data:
        manga_id = manga.get("id")
        if isinstance(manga_id, str) and manga_id and manga_id not in seen_ids:
            seen_ids.add(manga_id)
            candidates.append(manga)

    titled = next((
        manga for manga in candidates
        if isinstance(manga.get("attributes"), dict)
        and localized(manga["attributes"].get("title"), language)
    ), None)
    legacy.require(titled is not None, "MangaDex browse results missing localized title metadata")
    title = localized(titled["attributes"].get("title"), language)

    search_fields = browse_fields(language, "relevance")
    search_fields.append(("title", legacy.first_word(str(title))))
    search = client.json(api_url(api, "/manga", search_fields))
    require_collection(search, "MangaDex search returned no manga")
    checks.append("search")

    chosen_manga: dict | None = None
    readable: dict | None = None
    for manga in candidates[:10]:
        manga_id = manga.get("id")
        if not isinstance(manga_id, str) or not manga_id:
            continue
        chapter_payload = client.json(api_url(api, f"/manga/{manga_id}/feed", chapter_fields(language)))
        data = chapter_payload.get("data") if isinstance(chapter_payload, dict) else None
        if not isinstance(data, list) or not data:
            continue
        chapter = readable_chapter([item for item in data if isinstance(item, dict)])
        if chapter is not None:
            chosen_manga = manga
            readable = chapter
            break

    legacy.require(chosen_manga is not None and readable is not None, "MangaDex sampled titles exposed no readable translated chapter metadata")
    checks.append("chapters")

    manga_id = chosen_manga["id"]
    detail = client.json(api_url(api, f"/manga/{manga_id}", [
        ("includes[]", "cover_art"),
        ("includes[]", "author"),
        ("includes[]", "artist"),
    ]))
    legacy.require(isinstance(detail, dict) and isinstance(detail.get("data"), dict), "MangaDex detail did not parse")
    detail_attributes = detail["data"].get("attributes")
    legacy.require(isinstance(detail_attributes, dict) and bool(localized(detail_attributes.get("title"), language)), "MangaDex detail missing title")
    checks.append("detail")

    at_home = client.json(api_url(api, f"/at-home/server/{readable['id']}"))
    legacy.require(isinstance(at_home, dict), "MangaDex@Home response did not parse")
    chapter_meta = at_home.get("chapter")
    legacy.require(isinstance(at_home.get("baseUrl"), str) and bool(at_home.get("baseUrl")), "MangaDex@Home missing base URL")
    legacy.require(isinstance(chapter_meta, dict), "MangaDex@Home missing chapter metadata")
    legacy.require(isinstance(chapter_meta.get("hash"), str) and bool(chapter_meta.get("hash")), "MangaDex@Home missing chapter hash")
    legacy.require(isinstance(chapter_meta.get("data"), list) and bool(chapter_meta.get("data")), "MangaDex@Home page metadata empty")
    checks.append("pages")

    tags = client.json(api_url(api, "/manga/tag"))
    tag_data = require_collection(tags, "MangaDex tag endpoint returned no tags")
    legacy.require(
        any(isinstance(item.get("attributes"), dict) and localized(item["attributes"].get("name"), language) for item in tag_data),
        "MangaDex tags missing localized names",
    )
    checks.append("genres")
    return checks
