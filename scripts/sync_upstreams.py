#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "catalog" / "sources.json"
DEFAULT_REPORT = ROOT / "upstream" / "report.json"
USER_AGENT = "Ahoge-UpstreamSync/2.0 (+https://github.com/QuackyPROG/ahoge-extension)"


class UpstreamError(RuntimeError):
    pass


def github_json(path: str) -> Any:
    request = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": USER_AGENT,
            **({"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"} if os.environ.get("GITHUB_TOKEN") else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise UpstreamError(f"GitHub resource not found: {path}") from exc
        raise UpstreamError(f"GitHub API returned HTTP {exc.code}: {path}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise UpstreamError(f"GitHub API request failed: {path}: {exc}") from exc


def raw_text(repository: str, path: str, ref: str = "main") -> str:
    quoted = "/".join(urllib.parse.quote(part) for part in path.split("/"))
    request = urllib.request.Request(
        f"https://raw.githubusercontent.com/{repository}/{ref}/{quoted}",
        headers={"User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read(1_500_000).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise UpstreamError(f"upstream file missing: {repository}/{path}@{ref}") from exc
        raise UpstreamError(f"upstream file HTTP {exc.code}: {repository}/{path}@{ref}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise UpstreamError(f"upstream file request failed: {repository}/{path}: {exc}") from exc


def parse_gradle(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    match = re.search(r'\bname\s*=\s*"([^"]+)"', text)
    if match:
        result["name"] = match.group(1)
    match = re.search(r'\bversionCode\s*=\s*(\d+)', text)
    if match:
        result["versionCode"] = int(match.group(1))
    match = re.search(r'\btheme\s*=\s*"([^"]+)"', text)
    if match:
        result["family"] = match.group(1)

    mirror_block = re.search(r'baseUrl\s*\{[\s\S]*?mirrors\s*\(([\s\S]*?)\)[\s\S]*?\}', text)
    if mirror_block:
        mirrors = re.findall(r'"(https://[^"]+)"', mirror_block.group(1))
        if mirrors:
            result["baseUrl"] = mirrors[0].rstrip("/")
            result["mirrors"] = [value.rstrip("/") for value in mirrors[1:]]
    else:
        match = re.search(r'\bbaseUrl\s*=\s*"(https://[^"]+)"', text)
        if match:
            result["baseUrl"] = match.group(1).rstrip("/")
            result["mirrors"] = []
    return result


def latest_path_revision(repository: str, module_path: str) -> str:
    encoded_path = urllib.parse.quote(module_path, safe="")
    commits = github_json(f"/repos/{repository}/commits?path={encoded_path}&per_page=1")
    if not isinstance(commits, list) or not commits or not isinstance(commits[0], dict) or not commits[0].get("sha"):
        raise UpstreamError(f"no upstream commit found for {repository}/{module_path}")
    return str(commits[0]["sha"])


def normalize_family(value: str | None) -> str | None:
    if not value:
        return None
    return value.lower().replace("-", "").replace("_", "")


def expected_family(entry: dict[str, Any]) -> str:
    upstream = str(entry["upstream"]["family"])
    return normalize_family(upstream) or upstream


def bump_patch(version: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(.*)", version)
    if not match:
        return version
    return f"{match.group(1)}.{match.group(2)}.{int(match.group(3)) + 1}"


def inspect(entry: dict[str, Any]) -> dict[str, Any]:
    upstream = entry["upstream"]
    repository = upstream["repository"]
    module_path = upstream["path"]
    gradle_path = f"{module_path.rstrip('/')}/build.gradle.kts"
    gradle = raw_text(repository, gradle_path)
    metadata = parse_gradle(gradle)
    revision = latest_path_revision(repository, module_path)

    changes: list[dict[str, Any]] = []
    severity = "none"

    upstream_family = normalize_family(metadata.get("family"))
    tracked_family = expected_family(entry)
    if upstream_family and upstream_family != tracked_family:
        changes.append({
            "field": "family",
            "old": upstream["family"],
            "new": metadata["family"],
            "risk": "high",
        })
        severity = "high"

    upstream_base = metadata.get("baseUrl")
    if upstream_base and upstream_base != entry["baseUrl"].rstrip("/"):
        changes.append({"field": "baseUrl", "old": entry["baseUrl"], "new": upstream_base, "risk": "low"})
        if severity == "none": severity = "low"

    upstream_mirrors = metadata.get("mirrors")
    if isinstance(upstream_mirrors, list) and upstream_mirrors != [value.rstrip("/") for value in entry.get("mirrors", [])]:
        changes.append({"field": "mirrors", "old": entry.get("mirrors", []), "new": upstream_mirrors, "risk": "low"})
        if severity == "none": severity = "low"

    upstream_name = metadata.get("name")
    if upstream_name and upstream_name != entry["name"]:
        changes.append({"field": "upstreamName", "old": entry["name"], "new": upstream_name, "risk": "low"})
        if severity == "none": severity = "low"

    tracked_revision = upstream.get("revision")
    if revision != tracked_revision:
        code_change_risk = "medium" if not changes else "metadata"
        changes.append({"field": "revision", "old": tracked_revision, "new": revision, "risk": code_change_risk})
        if severity == "none": severity = "medium"

    return {
        "sourceId": entry["sourceId"],
        "name": entry["name"],
        "repository": repository,
        "path": module_path,
        "enabled": entry["enabled"],
        "severity": severity,
        "changes": changes,
        "upstream": {**metadata, "revision": revision},
    }


def apply_low_risk(catalog: dict[str, Any], reports: list[dict[str, Any]]) -> int:
    by_id = {entry["sourceId"]: entry for entry in catalog["sources"]}
    changed = 0
    for report in reports:
        if report["severity"] != "low":
            continue
        entry = by_id[report["sourceId"]]
        applied = False
        for change in report["changes"]:
            if change["risk"] != "low":
                continue
            if change["field"] == "baseUrl":
                entry["baseUrl"] = change["new"]
                applied = True
            elif change["field"] == "mirrors":
                entry["mirrors"] = change["new"]
                applied = True
            elif change["field"] == "upstreamName":
                # Display/source identity stays stable. Track renames in notes instead of silently renaming Ahoge sources.
                note = f"Upstream currently calls this source {change['new']}."
                if note not in entry.get("notes", ""):
                    entry["notes"] = (entry.get("notes", "").rstrip() + " " + note).strip()
                applied = True
        if applied:
            entry["upstream"]["revision"] = report["upstream"]["revision"]
            entry["version"] = bump_patch(entry["version"])
            changed += 1
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect only curated Ahoge source modules for upstream drift")
    parser.add_argument("--source", action="append", default=[], help="source ID to inspect; may be repeated")
    parser.add_argument("--apply-low-risk", action="store_true", help="apply domain/mirror/name metadata changes to the catalog")
    parser.add_argument("--output", default=str(DEFAULT_REPORT.relative_to(ROOT)))
    args = parser.parse_args()

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    selected = set(args.source)
    entries = [entry for entry in catalog["sources"] if not selected or entry["sourceId"] in selected]
    missing = selected - {entry["sourceId"] for entry in entries}
    if missing:
        raise SystemExit(f"Unknown source IDs: {sorted(missing)}")

    reports: list[dict[str, Any]] = []
    for entry in entries:
        try:
            report = inspect(entry)
        except UpstreamError as exc:
            report = {
                "sourceId": entry["sourceId"],
                "name": entry["name"],
                "repository": entry["upstream"]["repository"],
                "path": entry["upstream"]["path"],
                "enabled": entry["enabled"],
                "severity": "high",
                "changes": [{"field": "upstream", "old": "tracked", "new": "unavailable", "risk": "high", "error": str(exc)}],
                "upstream": {},
            }
        reports.append(report)
        print(f"{entry['sourceId']}: {report['severity']} ({len(report['changes'])} change(s))")

    applied = apply_low_risk(catalog, reports) if args.apply_low_risk else 0
    if applied:
        CATALOG_PATH.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Applied low-risk changes to {applied} catalog entr{'y' if applied == 1 else 'ies'}.")

    output_path = ROOT / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 1,
        "checkedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "appliedLowRisk": applied,
        "sources": reports,
    }
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Non-zero only for high-risk/unavailable upstreams. Medium changes are review-required but expected.
    return 2 if any(report["severity"] == "high" for report in reports) else 0


if __name__ == "__main__":
    raise SystemExit(main())
