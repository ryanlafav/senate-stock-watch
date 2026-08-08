#!/usr/bin/env python3
"""Orchestrator CLI for the data pipeline.

    python scripts/run_pipeline.py --mode trades   # frequent: new PTRs + SIC + flags
    python scripts/run_pipeline.py --mode roster    # infrequent: full legislator/committee resync + flags

Exits non-zero (and writes nothing further) the moment any stage fails, so a
partial/bad run never gets committed by the calling GitHub Actions workflow -
whatever was already on disk from the last successful run stays live on
GitHub Pages.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent


def _load_module(filename: str):
    """Numeric-prefixed filenames (01_x.py) aren't valid `import` targets, so
    load them by file path instead."""
    spec = importlib.util.spec_from_file_location(filename[:-3], SCRIPTS_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["roster", "trades"], required=True)
    args = parser.parse_args()

    fetch_legislators = _load_module("01_fetch_legislators.py")
    scrape_efd_trades = _load_module("02_scrape_efd_trades.py")
    classify_tickers_sec = _load_module("03_classify_tickers_sec.py")
    generate_flags = _load_module("04_generate_flags.py")

    config = fetch_legislators.load_config()

    roster_generated_at = None
    trades_generated_at = None

    if args.mode == "roster":
        print("== Step 1: fetch legislators/committees/membership ==")
        try:
            stats = fetch_legislators.run(config)
        except fetch_legislators.RosterFetchError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1
        roster_generated_at = stats["generated_at"]
        print(
            f"  {stats['members']} members, {stats['committees']} committees, "
            f"{stats['committee_memberships']} memberships"
        )

    elif args.mode == "trades":
        print("== Step 2: scrape new eFD PTR filings ==")
        try:
            trades_stats = scrape_efd_trades.run(config)
        except (
            scrape_efd_trades.TradeScrapeError,
            scrape_efd_trades.efd_client.EfdSiteStructureError,
        ) as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1
        trades_generated_at = trades_stats["generated_at"]
        print(
            f"  {trades_stats['new_reports']} new reports, "
            f"{trades_stats['new_trades']} new trade rows, "
            f"{trades_stats['unparsed_reports']} unparsed"
        )
        if trades_stats["unmatched_filer_names"]:
            print(f"  Unmatched filer names: {trades_stats['unmatched_filer_names']}")

        print("== Step 3: classify tickers via SEC EDGAR ==")
        sec_stats = classify_tickers_sec.run(config)
        print(
            f"  {sec_stats['tickers_looked_up']} looked up, "
            f"{sec_stats['tickers_found']} classified total"
        )

    print("== Step 4: generate flags + meta ==")
    extra_warnings = []
    if args.mode == "trades" and trades_stats.get("unmatched_filer_names"):
        extra_warnings = [
            f"Unmatched eFD filer name: '{n}' (add to config/name_overrides.yaml)"
            for n in trades_stats["unmatched_filer_names"]
        ]
    flag_stats = generate_flags.run(
        config,
        roster_generated_at=roster_generated_at,
        trades_generated_at=trades_generated_at,
        extra_warnings=extra_warnings,
    )
    print(f"  {flag_stats['flags_total']} flags")
    for w in flag_stats["warnings"]:
        print(f"  WARNING: {w}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
