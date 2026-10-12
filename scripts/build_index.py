#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "sources.json"
SOURCES_DIR = ROOT / "sources"
INDEX_PATH = ROOT / "index.json"


def load_catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def public_source(entry: dict) -> dict:
    source = {
        "id": entry["sourceId"],
        "name": entry["name"],
        "lang": entry["language"],
        "baseUrl": entry["baseUrl"],
        "engine": entry["engine"],
        "rateLimit": entry["rateLimit"],
        "nsfw": 0 if entry["contentRating"] == "SAFE" else 1,
        "contentRating": entry["contentRating"],
    }
    if entry.get("adapter"):
        source["adapter"] = entry["adapter"]
    if entry.get("apiUrl"):
        source["apiUrl"] = entry["apiUrl"]
    if entry.get("mirrors"):
        source["mirrors"] = entry["mirrors"]
    if entry.get("overrides"):
        source["overrides"] = entry["overrides"]
    return source


def public_package(entry: dict) -> dict:
    return {
        "name": entry["name"],
        "pkg": entry["packageId"],
        "lang": entry["language"],
        "version": entry["version"],
        "nsfw": 0 if entry["contentRating"] == "SAFE" else 1,
        "sources": [public_source(entry)],
    }


def render_json(value: object) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def desired_outputs() -> tuple[dict[Path, str], set[Path]]:
    catalog = load_catalog()
    enabled = [entry for entry in catalog["sources"] if entry.get("enabled") is True]
    enabled.sort(key=lambda entry: (-int(entry.get("priority", 0)), entry["packageId"]))

    outputs: dict[Path, str] = {}
    generated_source_paths: set[Path] = set()
    packages: list[dict] = []
    for entry in enabled:
        package = public_package(entry)
        packages.append(package)
        slug = entry["packageId"].split(".")[-1]
        path = SOURCES_DIR / f"{slug}.json"
        outputs[path] = render_json(package)
        generated_source_paths.add(path)

    outputs[INDEX_PATH] = render_json({"packages": packages})
    return outputs, generated_source_paths


def check() -> int:
    outputs, generated_source_paths = desired_outputs()
    mismatches: list[str] = []
    for path, expected in outputs.items():
        actual = path.read_text(encoding="utf-8") if path.exists() else None
        if actual != expected:
            mismatches.append(str(path.relative_to(ROOT)))

    stale = sorted(
        path.relative_to(ROOT).as_posix()
        for path in SOURCES_DIR.glob("*.json")
        if path not in generated_source_paths
    )
    if stale:
        mismatches.extend(f"stale:{path}" for path in stale)

    if mismatches:
        print("Generated output is stale:")
        for item in mismatches:
            print(f"  - {item}")
        print("Run: python3 scripts/build_index.py")
        return 1

    print(f"Generated files are current ({len(generated_source_paths)} enabled sources).")
    return 0


def write() -> int:
    outputs, generated_source_paths = desired_outputs()
    SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    for path in SOURCES_DIR.glob("*.json"):
        if path not in generated_source_paths:
            path.unlink()
    for path, content in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    print(f"Generated index.json and {len(generated_source_paths)} source manifests.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Ahoge source manifests and index.json from catalog/sources.json")
    parser.add_argument("--check", action="store_true", help="fail if committed generated files are stale")
    args = parser.parse_args()
    return check() if args.check else write()


if __name__ == "__main__":
    raise SystemExit(main())
