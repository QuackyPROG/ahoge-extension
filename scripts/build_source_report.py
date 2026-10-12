#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES_PATH = ROOT / "catalog" / "candidates.json"
CATALOG_PATH = ROOT / "catalog" / "sources.json"
REPORT_PATH = ROOT / "Docs" / "source-catalog-report.md"
SCORE_KEYS = ("popularity", "engineFit", "upstreamActivity", "liveHealth", "coverage", "penalty")

RUNTIME_ROWS = [
    ("natsuId", "natsuId", None, "Yes", "Yes", "Live health"),
    ("asuraScans", "asuraScans", None, "Yes", "Yes", "Live health"),
    ("mangaBox", "mangaBox", "mangabox", "Yes", "Yes", "Live health"),
    ("api / ezmanhwa", "api", "ezmanhwa", "Yes", "Yes", "Live health"),
    ("api / heancms", "api", "heancms", "Yes", "Yes", "Live health"),
    ("api / mangadex", "api", "mangadex", "Yes", "Yes", "Live health"),
    ("api / weebcentral", "api", "weebcentral", "Yes", "Yes", "Live health"),
    ("madara", "madara", None, "Yes", "Yes", "Live health"),
    ("mangaThemesia", "mangaThemesia", None, "Yes", "Yes", "Live health"),
    ("fmReader", "fmReader", None, "No", "No", "No"),
    ("foolSlide", "foolSlide", None, "No", "No", "No"),
]


def load_candidates() -> list[dict]:
    payload = json.loads(CANDIDATES_PATH.read_text(encoding="utf-8"))
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or len(candidates) != 50:
        raise ValueError("catalog/candidates.json must contain exactly 50 evaluated candidates")

    seen: set[str] = set()
    for candidate in candidates:
        name = candidate.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("candidate name is required")
        if name in seen:
            raise ValueError(f"duplicate candidate: {name}")
        seen.add(name)

        scores = candidate.get("scores")
        if not isinstance(scores, dict) or set(scores) != set(SCORE_KEYS):
            raise ValueError(f"{name}: scores must contain exactly {SCORE_KEYS}")
        total = sum(int(scores[key]) for key in SCORE_KEYS)
        if candidate.get("score") != total:
            raise ValueError(f"{name}: score {candidate.get('score')} does not match computed total {total}")
        if candidate.get("decision") == "include" and candidate.get("health") != "healthy":
            raise ValueError(f"{name}: include decision requires healthy live status")
    return candidates


def load_catalog() -> list[dict]:
    payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    sources = payload.get("sources")
    if not isinstance(sources, list):
        raise ValueError("catalog/sources.json must contain a sources array")
    return [source for source in sources if isinstance(source, dict)]


def runtime_count(sources: list[dict], engine: str, adapter: str | None) -> str:
    matching = [
        source for source in sources
        if source.get("engine") == engine
        and (adapter is None or source.get("adapter") == adapter)
    ]
    healthy = [source for source in matching if source.get("enabled") is True]
    if not matching:
        return "0 tracked"
    return f"{len(matching)} tracked / {len(healthy)} enabled"


def render(candidates: list[dict], sources: list[dict]) -> str:
    enabled = [source for source in sources if source.get("enabled") is True]
    disabled = [source for source in sources if source.get("enabled") is not True]
    enabled_names = ", ".join(source.get("name", source.get("sourceId", "unknown")) for source in enabled)

    lines = [
        "# Source Catalog Report",
        "",
        "> Generated from `catalog/candidates.json` and the canonical `catalog/sources.json`. Scores are engineering prioritization inputs, not traffic measurements. The health gate overrides score: an untested, blocked, broken, or unsupported source cannot be enabled.",
        "",
        "## Current result",
        "",
        "- **50 candidates evaluated/triaged**.",
        f"- **{len(enabled)} enabled sources in the public index**: {enabled_names}.",
        f"- **{len(disabled)} additional cataloged sources are tracked but disabled** after health failures/blocks or compatibility review.",
        "- Sources outside the canonical catalog remain investigation candidates until they have a bounded native runtime and current live-health evidence.",
        "- Tier-4 candidates that require browser challenges, signing, or image descrambling remain intentionally excluded.",
        "",
        "## Engine/runtime matrix",
        "",
        "| Engine family | Runtime exists | Manifest supported | Tested | Catalog status |",
        "|---|---:|---:|---:|---:|",
    ]
    for label, engine, adapter, runtime_exists, manifest_supported, tested in RUNTIME_ROWS:
        lines.append(
            f"| {label} | {runtime_exists} | {manifest_supported} | {tested} | "
            f"{runtime_count(sources, engine, adapter)} |"
        )

    lines.extend([
        "",
        "## Scoring",
        "",
        "`score = popularity + engineFit + upstreamActivity + liveHealth + coverage + penalty`",
        "",
        "- Popularity: `0–30` prioritization proxy. It is not claimed traffic/usage telemetry.",
        "- Engine fit: `0–25`; already executable shared runtimes score highest.",
        "- Upstream activity: `0–20`; current reviewed modules score above unverified seeds.",
        "- Live health: `0–15`; only end-to-end current validation gets 15.",
        "- Coverage: `0–10`; rewards useful language/catalog diversity.",
        "- Penalty: negative score for blocking, failure, challenge solving, signing, descrambling, or comparable maintenance risk.",
        "",
        "## Candidate decisions",
        "",
        "| Source | Score | Engine | Maintenance tier | Health | Decision | Evidence | Reason |",
        "|---|---:|---|---:|---|---|---|---|",
    ])
    for candidate in candidates:
        reason = candidate["reason"].replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| {candidate['name']} | {candidate['score']} | {candidate['engine']} | "
            f"{candidate['maintenanceTier']} | {candidate['health']} | {candidate['decision']} | "
            f"{candidate['evidence']} | {reason} |"
        )

    lines.extend([
        "",
        "## Implementation order",
        "",
        "1. Keep every enabled source behind the strict scheduled health gate; do not preserve a source in the public index merely because it worked previously.",
        "2. Continue adding Madara/MangaThemesia sites only when their current markup fits the bounded common runtimes and passes end-to-end health.",
        "3. FMReader remains deferred: the current upstream family is small and its active sites require substantial source-specific behavior, so it does not currently justify a broad shared runtime.",
        "4. MangaDex and WeebCentral now have dedicated bounded native adapters. Evaluate the remaining Tier-2 bespoke candidates such as Kagane and Atsumaru individually rather than adding generic remote scripting.",
        "5. Keep MangaFire and Comix out until there is a deliberate decision to own challenge/VRF or image-descrambling maintenance.",
        "",
        "## Evidence notes",
        "",
        "- `health-verified` means the source was exercised by `scripts/health_all.py` through browse/search/detail/chapter/page-metadata parsing without downloading chapter image payloads.",
        "- `upstream-reviewed` means current upstream implementation characteristics were inspected at the tracked Keiyoushi revision.",
        "- `family-reviewed` means the current upstream module was identified as a member of the named reusable family, but source-specific live behavior has not been proven by the current Ahoge health gate.",
        "- `seed-triage` and `triage` are intentionally weaker. They remain investigation candidates and must not be treated as working sources.",
        "",
        "## Why popular sources are sometimes excluded",
        "",
        "Popularity does not override maintenance cost or health. MangaFire is a concrete example: current upstream includes VRF signing and browser/OpenCV challenge solving, so it is Tier 4 despite high popularity. Comix includes image descrambling, which also makes it Tier 4. Manganato/Mangakakalot score well on popularity and engine fit, but the current CI environment has returned HTTP 403, so they remain disabled.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the curated source evaluation report")
    parser.add_argument("--check", action="store_true", help="fail if Docs/source-catalog-report.md is stale")
    args = parser.parse_args()
    expected = render(load_candidates(), load_catalog())
    if args.check:
        actual = REPORT_PATH.read_text(encoding="utf-8") if REPORT_PATH.exists() else None
        if actual != expected:
            print("Docs/source-catalog-report.md is stale; run python3 scripts/build_source_report.py")
            return 1
        print("Source catalog report is current (50 candidates).")
        return 0

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(expected, encoding="utf-8")
    print("Generated Docs/source-catalog-report.md for 50 candidates.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
