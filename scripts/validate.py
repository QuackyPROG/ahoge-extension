#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import jsonschema
except ImportError as exc:
    raise SystemExit("jsonschema is required: python3 -m pip install jsonschema") from exc

from build_index import desired_outputs

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "sources.json"
CATALOG_SCHEMA_PATH = ROOT / "schema" / "catalog.schema.json"
SOURCE_SCHEMA_PATH = ROOT / "schema" / "source.schema.json"
SOURCES_DIR = ROOT / "sources"
INDEX_PATH = ROOT / "index.json"

SUPPORTED_ENGINES = {"asuraScans", "api", "mangaBox", "natsuId", "madara"}
SUPPORTED_API_ADAPTERS = {"ezmanhwa", "heancms"}
ALLOWED_OVERRIDE_KEYS = {
    "chapterListPageOverride",
    "latestSortOrder",
    "mangaPath",
    "genrePath",
    "chapterMode",
    "dateFormat",
    "filterNonMangaItems",
}
MADARA_CHAPTER_MODES = {"mangaPage", "adminAjax", "mangaAjax"}
SAFE_PATH = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path.relative_to(ROOT)}: malformed JSON: {exc}") from exc


def validator_for(path: Path) -> jsonschema.Draft202012Validator:
    schema = load_json(path)
    return jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())


def validate_schema(value: object, validator: jsonschema.Draft202012Validator, origin: str) -> None:
    errors = sorted(validator.iter_errors(value), key=lambda error: list(error.path))
    if errors:
        rendered = "; ".join(f"{list(error.path)}: {error.message}" for error in errors)
        raise ValueError(f"{origin}: schema validation failed: {rendered}")


def validate_https_url(value: str, label: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{label}: must be an absolute https URL")
    if parsed.username or parsed.password:
        raise ValueError(f"{label}: embedded URL credentials are not allowed")
    if parsed.fragment:
        raise ValueError(f"{label}: URL fragments are not allowed")


def validate_runtime_source(source: dict, origin: str) -> None:
    engine = source["engine"]
    if engine not in SUPPORTED_ENGINES:
        raise ValueError(f"{origin}: unsupported engine {engine!r}")

    validate_https_url(source["baseUrl"], f"{origin}:{source['id']}.baseUrl")
    for mirror in source.get("mirrors", []):
        validate_https_url(mirror, f"{origin}:{source['id']}.mirrors")
    if "apiUrl" in source:
        validate_https_url(source["apiUrl"], f"{origin}:{source['id']}.apiUrl")

    adapter = source.get("adapter")
    if engine == "api" and adapter not in SUPPORTED_API_ADAPTERS:
        raise ValueError(f"{origin}:{source['id']}: unsupported API adapter {adapter!r}")
    if engine == "mangaBox" and adapter != "mangabox":
        raise ValueError(f"{origin}:{source['id']}: mangaBox requires adapter 'mangabox'")
    if engine == "asuraScans" and not source.get("apiUrl"):
        raise ValueError(f"{origin}:{source['id']}: asuraScans requires apiUrl")
    if engine in {"natsuId", "madara"} and adapter is not None:
        raise ValueError(f"{origin}:{source['id']}: {engine} does not use an adapter")

    overrides = source.get("overrides", {})
    unknown = sorted(set(overrides) - ALLOWED_OVERRIDE_KEYS)
    if unknown:
        raise ValueError(f"{origin}:{source['id']}: unknown override keys: {unknown}")

    if "chapterListPageOverride" in overrides:
        page = overrides["chapterListPageOverride"]
        if not isinstance(page, int) or isinstance(page, bool) or not (1 <= page <= 9999):
            raise ValueError(f"{origin}:{source['id']}: chapterListPageOverride must be an integer 1...9999")
    if "latestSortOrder" in overrides and overrides["latestSortOrder"] not in {"asc", "desc"}:
        raise ValueError(f"{origin}:{source['id']}: latestSortOrder must be 'asc' or 'desc'")

    madara_keys = {"mangaPath", "genrePath", "chapterMode", "dateFormat", "filterNonMangaItems"}
    if engine != "madara" and set(overrides) & madara_keys:
        raise ValueError(f"{origin}:{source['id']}: Madara overrides require engine 'madara'")
    if engine == "madara":
        for key in ("mangaPath", "genrePath"):
            if key in overrides and (not isinstance(overrides[key], str) or SAFE_PATH.fullmatch(overrides[key]) is None):
                raise ValueError(f"{origin}:{source['id']}: {key} must be a single safe path component")
        if "chapterMode" in overrides and overrides["chapterMode"] not in MADARA_CHAPTER_MODES:
            raise ValueError(f"{origin}:{source['id']}: unsupported Madara chapterMode {overrides['chapterMode']!r}")
        if "dateFormat" in overrides:
            value = overrides["dateFormat"]
            if not isinstance(value, str) or not (1 <= len(value) <= 40) or any(token in value for token in ("\n", "\r", "\x00")):
                raise ValueError(f"{origin}:{source['id']}: dateFormat must be a bounded plain string")
        if "filterNonMangaItems" in overrides and not isinstance(overrides["filterNonMangaItems"], bool):
            raise ValueError(f"{origin}:{source['id']}: filterNonMangaItems must be boolean")


def validate_catalog(catalog: dict, catalog_validator: jsonschema.Draft202012Validator) -> None:
    validate_schema(catalog, catalog_validator, "catalog/sources.json")
    package_ids: set[str] = set()
    source_ids: set[str] = set()

    for entry in catalog["sources"]:
        package_id = entry["packageId"]
        source_id = entry["sourceId"]
        if package_id in package_ids:
            raise ValueError(f"catalog/sources.json: duplicate package id: {package_id}")
        if source_id in source_ids:
            raise ValueError(f"catalog/sources.json: duplicate source id: {source_id}")
        package_ids.add(package_id)
        source_ids.add(source_id)

        public_shape = {
            "id": source_id,
            "engine": entry["engine"],
            "baseUrl": entry["baseUrl"],
            "adapter": entry.get("adapter"),
            "mirrors": entry.get("mirrors", []),
            "overrides": entry.get("overrides", {}),
        }
        if entry.get("apiUrl"):
            public_shape["apiUrl"] = entry["apiUrl"]
        validate_runtime_source(public_shape, "catalog/sources.json")

        if entry["enabled"] and entry["maintenanceTier"] > 3:
            raise ValueError(f"catalog/sources.json:{source_id}: Tier 4 sources must not be enabled by default")


def validate_generated(source_validator: jsonschema.Draft202012Validator) -> None:
    expected_outputs, generated_source_paths = desired_outputs()

    for path, expected in expected_outputs.items():
        if not path.exists():
            raise ValueError(f"generated file missing: {path.relative_to(ROOT)}")
        actual = path.read_text(encoding="utf-8")
        if actual != expected:
            raise ValueError(f"generated file stale: {path.relative_to(ROOT)}; run python3 scripts/build_index.py")

    stale = sorted(path for path in SOURCES_DIR.glob("*.json") if path not in generated_source_paths)
    if stale:
        names = [path.relative_to(ROOT).as_posix() for path in stale]
        raise ValueError(f"stale generated source manifests: {names}")

    package_ids: set[str] = set()
    source_ids: set[str] = set()
    for path in sorted(generated_source_paths):
        package = load_json(path)
        validate_schema(package, source_validator, str(path.relative_to(ROOT)))
        package_id = package["pkg"]
        if package_id in package_ids:
            raise ValueError(f"duplicate generated package id: {package_id}")
        package_ids.add(package_id)
        for source in package["sources"]:
            validate_runtime_source(source, str(path.relative_to(ROOT)))
            source_id = source["id"]
            if source_id in source_ids:
                raise ValueError(f"duplicate generated source id: {source_id}")
            source_ids.add(source_id)

    index = load_json(INDEX_PATH)
    if not isinstance(index, dict) or not isinstance(index.get("packages"), list):
        raise ValueError("index.json: expected object with a packages array")
    for package in index["packages"]:
        validate_schema(package, source_validator, "index.json")
        for source in package["sources"]:
            validate_runtime_source(source, "index.json")

    print(f"Validated catalog and {len(generated_source_paths)} enabled source packages.")


def main() -> int:
    catalog_validator = validator_for(CATALOG_SCHEMA_PATH)
    source_validator = validator_for(SOURCE_SCHEMA_PATH)
    catalog = load_json(CATALOG_PATH)
    validate_catalog(catalog, catalog_validator)
    validate_generated(source_validator)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
