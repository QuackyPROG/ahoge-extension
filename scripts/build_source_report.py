#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES_PATH = ROOT / "catalog" / "candidates.json"
REPORT_PATH = ROOT / "Docs" / "source-catalog-report.md"

ENGINE_MATRIX = [
    ("natsuId", "Yes", "Yes", "Live health", "4 tracked / 3 healthy"),
    ("asuraScans", "Yes", "Yes", "Live health", "1 / 1 healthy"),
    ("mangaBox", "Yes", "Yes", "Live health", "3 / 0 healthy (CI blocked)"),
    ("api / ezmanhwa", "Yes", "Yes", "Live health", "2 / 1 healthy"),
    ("api / heancms", "Yes", "Yes", "Live health", "2 / 1 healthy"),
    ("madara", "No", "Classifier/planned only", "No", "high leverage; next-runtime candidate"),
    ("mangaThemesia", "No", "Classifier/planned only", "No", "multiple current upstream candidates"),
    ("fmReader", "No", "Classifier/planned only", "No", "4 family-reviewed candidates"),
    ("foolSlide", "No", "Classifier/planned only", "No", "not yet shortlisted"),
]
SCORE_KEYS = ("popularity", "engineFit", "upstreamActivity", "liveHealth", "coverage", "penalty")


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


def render(candidates: list[dict]) -> str:
    lines = [
        "# Source Catalog Report",
        "",
        "> Generated from `catalog/candidates.json`. Scores are engineering prioritization inputs, not traffic measurements. The health gate overrides score: an untested, blocked, broken, or unsupported source cannot be enabled.",
        "",
        "## Current result",
        "",
        "- **50 candidates evaluated/triaged**.",
        "- **6 enabled and live-health verified**: Asura Scans, QiScans, Omega Scans, Kiryuu, Natsu, Rawkuma.",
        "- **6 tracked but disabled** after current health failures/blocks.",
        "- **12 family-reviewed deferred candidates** that become cheap once shared runtimes are implemented.",
        "- **4 high-value bespoke candidates** deferred until shared families are covered.",
        "- **2 Tier-4 candidates rejected for now** because current upstream requires descrambling or challenge/signing logic.",
        "- Remaining candidates stay in investigation/triage rather than being published without evidence.",
        "",
        "## Engine/runtime matrix",
        "",
        "| Engine family | Runtime exists | Manifest supported | Tested | Candidate source count |",
        "|---|---:|---:|---:|---:|",
    ]
    for row in ENGINE_MATRIX:
        lines.append("| " + " | ".join(row) + " |")

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
        "1. Keep the six enabled sources behind daily health validation; do not republish blocked sources merely because their runtime still parses locally.",
        "2. Implement **Madara** next if source-specific review confirms enough healthy Tier-1 candidates; it offers the highest likely source-per-runtime leverage.",
        "3. Implement **MangaThemesia** after/alongside Madara, then **FMReader** for Japanese/raw coverage.",
        "4. Add a small number of Tier-2 bespoke APIs after shared-family coverage. MangaDex and WeebCentral are stronger candidates than Tier-4 browser/crypto sites.",
        "5. Keep MangaFire and Comix out until there is a deliberate decision to own challenge/VRF or image-descrambling maintenance.",
        "",
        "## Evidence notes",
        "",
        "- `health-verified` means the source was exercised by `scripts/healthcheck.py` through catalog/search/detail/chapter/page-metadata parsing without downloading chapter image payloads.",
        "- `upstream-reviewed` means current upstream implementation characteristics were inspected at the tracked Keiyoushi revision.",
        "- `family-reviewed` means the current upstream module was identified as a member of the named reusable family, but Ahoge cannot live-test it until that runtime exists.",
        "- `seed-triage` and `triage` are intentionally weaker. They remain investigation candidates and must not be treated as working sources.",
        "",
        "## Why popular sources are sometimes excluded",
        "",
        "Popularity does not override maintenance cost or health. MangaFire is a concrete example: current upstream includes VRF signing and browser/OpenCV challenge solving, so it is Tier 4 despite high popularity. Comix includes image descrambling, which also makes it Tier 4. Manganato/Mangakakalot score well on popularity and engine fit, but the current CI environment receives HTTP 403, so they remain disabled.",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the curated source evaluation report")
    parser.add_argument("--check", action="store_true", help="fail if Docs/source-catalog-report.md is stale")
    args = parser.parse_args()
    expected = render(load_candidates())
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
