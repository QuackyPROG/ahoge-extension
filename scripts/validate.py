#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    import jsonschema
except ImportError as exc:
    raise SystemExit("jsonschema is required: python3 -m pip install jsonschema") from exc

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schema" / "source.schema.json"
SOURCES_DIR = ROOT / "sources"
INDEX_PATH = ROOT / "index.json"
SUPPORTED_ENGINES = {"asuraScans", "api", "mangaBox"}
SUPPORTED_API_ADAPTERS = {"ezmanhwa", "heancms"}


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path.relative_to(ROOT)}: malformed JSON: {exc}") from exc


def validate_https_url(value: str, label: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"{label}: must be an absolute https URL")


def validate_runtime(package: dict, origin: str) -> None:
    for source in package["sources"]:
        engine = source["engine"]
        if engine not in SUPPORTED_ENGINES:
            raise ValueError(f"{origin}: unsupported engine {engine!r}")
        validate_https_url(source["baseUrl"], f"{origin}:{source['id']}.baseUrl")
        if "apiUrl" in source:
            validate_https_url(source["apiUrl"], f"{origin}:{source['id']}.apiUrl")

        adapter = source.get("adapter")
        if engine == "api" and adapter not in SUPPORTED_API_ADAPTERS:
            raise ValueError(f"{origin}:{source['id']}: unsupported API adapter {adapter!r}")
        if engine == "mangaBox" and adapter != "mangabox":
            raise ValueError(f"{origin}:{source['id']}: mangaBox requires adapter 'mangabox'")
        if engine == "asuraScans" and not source.get("apiUrl"):
            raise ValueError(f"{origin}:{source['id']}: asuraScans requires apiUrl")


def main() -> int:
    schema = load_json(SCHEMA_PATH)
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())

    manifests: dict[str, dict] = {}
    package_ids: set[str] = set()
    source_ids: set[str] = set()

    files = sorted(SOURCES_DIR.glob("*.json"))
    if not files:
        raise ValueError("sources/: no source manifests found")

    for path in files:
        package = load_json(path)
        errors = sorted(validator.iter_errors(package), key=lambda e: list(e.path))
        if errors:
            rendered = "; ".join(f"{list(e.path)}: {e.message}" for e in errors)
            raise ValueError(f"{path.relative_to(ROOT)}: schema validation failed: {rendered}")
        validate_runtime(package, str(path.relative_to(ROOT)))

        pkg = package["pkg"]
        if pkg in package_ids:
            raise ValueError(f"duplicate package id: {pkg}")
        package_ids.add(pkg)
        manifests[pkg] = package

        for source in package["sources"]:
            source_id = source["id"]
            if source_id in source_ids:
                raise ValueError(f"duplicate source id: {source_id}")
            source_ids.add(source_id)

    index = load_json(INDEX_PATH)
    if not isinstance(index, dict) or not isinstance(index.get("packages"), list):
        raise ValueError("index.json: expected object with a packages array")

    indexed: dict[str, dict] = {}
    indexed_source_ids: set[str] = set()
    for package in index["packages"]:
        errors = sorted(validator.iter_errors(package), key=lambda e: list(e.path))
        if errors:
            rendered = "; ".join(f"{list(e.path)}: {e.message}" for e in errors)
            raise ValueError(f"index.json: schema validation failed: {rendered}")
        validate_runtime(package, "index.json")
        pkg = package["pkg"]
        if pkg in indexed:
            raise ValueError(f"index.json: duplicate package id: {pkg}")
        indexed[pkg] = package
        for source in package["sources"]:
            sid = source["id"]
            if sid in indexed_source_ids:
                raise ValueError(f"index.json: duplicate source id: {sid}")
            indexed_source_ids.add(sid)

    if set(indexed) != set(manifests):
        missing = sorted(set(manifests) - set(indexed))
        extra = sorted(set(indexed) - set(manifests))
        raise ValueError(f"index consistency failure: missing={missing}, extra={extra}")

    for pkg, manifest in manifests.items():
        if indexed[pkg] != manifest:
            raise ValueError(f"index consistency failure: package {pkg} differs from canonical sources manifest")

    print(f"Validated {len(manifests)} packages and {len(source_ids)} source IDs.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
