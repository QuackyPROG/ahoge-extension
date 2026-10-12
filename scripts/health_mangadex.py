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


def check(entry: dict, client: legacy.HttpClient) -> list[str]:
    api = entry["apiUrl"].rstrip("/")
    language = str(entry.get("overrides", {}).get("translatedLanguage", entry.get("language", "en")))
    checks: list[str] = []

    popular = client.json(api_url(api, "/manga", browse_fields(language, "followedCount")))
    popular_data = require_collection(popular, "MangaDex popular returned no manga")
    manga = popular_data[0]
    manga_id = manga.get("id")
    attributes = manga.get("attributes") if isinstance(manga.get("attributes"), dict) else {}
    title = localized(attributes.get("title"), language)
    legacy.require(isinstance(manga_id, str) and bool(manga_id), "MangaDex popular manga missing UUID")
    legacy.require(bool(title), "MangaDex popular manga missing localized title")
    checks.append("popular")

    latest = client.json(api_url(api, "/manga", browse_fields(language, "latestUploadedChapter")))
    require_collection(latest, "MangaDex latest returned no manga")
    checks.append("latest")

    search_fields = browse_fields(language, "relevance")
    search_fields.append(("title", legacy.first_word(str(title))))
    search = client.json(api_url(api, "/manga", search_fields))
    require_collection(search, "MangaDex search returned no manga")
    checks.append("search")

    detail = client.json(api_url(api, f"/manga/{manga_id}", [
        ("includes[]", "cover_art"),
        ("includes[]", "author"),
        ("includes[]", "artist"),
    ]))
    legacy.require(isinstance(detail, dict) and isinstance(detail.get("data"), dict), "MangaDex detail did not parse")
    detail_attributes = detail["data"].get("attributes")
    legacy.require(isinstance(detail_attributes, dict) and bool(localized(detail_attributes.get("title"), language)), "MangaDex detail missing title")
    checks.append("detail")

    chapter_payload = client.json(api_url(api, f"/manga/{manga_id}/feed", [
        ("translatedLanguage[]", language),
        ("order[volume]", "desc"),
        ("order[chapter]", "desc"),
        ("includeFuturePublishAt", "0"),
        ("includeExternalUrl", "0"),
        ("includeEmptyPages", "0"),
        ("limit", "25"),
        ("offset", "0"),
    ]))
    chapters = require_collection(chapter_payload, "MangaDex chapter feed empty")
    checks.append("chapters")

    readable = None
    for chapter in chapters:
        attrs = chapter.get("attributes")
        if not isinstance(attrs, dict):
            continue
        if attrs.get("externalUrl") is not None:
            continue
        if isinstance(attrs.get("pages"), int) and attrs.get("pages", 0) <= 0:
            continue
        if isinstance(chapter.get("id"), str) and chapter["id"]:
            readable = chapter
            break
    legacy.require(readable is not None, "MangaDex feed has no readable chapter metadata to validate")

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
