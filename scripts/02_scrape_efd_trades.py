#!/usr/bin/env python3
"""Scrape new Senate PTR filings from efdsearch.senate.gov and merge them into
docs/data/trades.json.

This is the highest-risk script in the pipeline since it depends on the exact
HTML/JSON shape of a live third-party site (see lib/efd_client.py for the
verified structure and lib.efd_client.EfdSiteStructureError for the fatal
error raised if that structure no longer matches). On any structural surprise
this aborts WITHOUT writing trades.json, so last-known-good data stays live.
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import efd_client, name_match  # noqa: E402
from lib.io_utils import atomic_write_json, read_json  # noqa: E402
from lib.pipeline_config import load_config, load_name_overrides  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"


class TradeScrapeError(RuntimeError):
    pass


def _parse_mdy(s: str) -> date:
    return datetime.strptime(s.strip(), "%m/%d/%Y").date()


def _determine_date_window(existing_trades: list[dict], cfg: dict) -> tuple[date, date]:
    today = date.today()
    overlap = timedelta(days=cfg["efd"]["overlap_days"])
    if not existing_trades:
        start = today - timedelta(days=cfg["efd"]["initial_backfill_days"])
        return start, today

    max_disclosure = max(
        datetime.strptime(t["disclosure_date"], "%Y-%m-%d").date()
        for t in existing_trades
        if t.get("disclosure_date")
    )
    return max_disclosure - overlap, today


def run(config: dict) -> dict:
    efd_cfg = config["efd"]
    guard_cfg = config["sanity_guard"]

    members_doc = read_json(DATA_DIR / "members.json")
    if not members_doc or not members_doc.get("members"):
        raise TradeScrapeError(
            "docs/data/members.json is missing or empty - run the roster "
            "refresh (--mode roster) at least once before scraping trades."
        )

    trades_doc = read_json(DATA_DIR / "trades.json", default={"trades": []})
    existing_trades = trades_doc.get("trades", [])
    existing_report_uuids = {t["report_id"] for t in existing_trades if t.get("report_id")}

    overrides = load_name_overrides()
    name_index = name_match.build_index(members_doc["members"], overrides)

    start_date, end_date = _determine_date_window(existing_trades, config)

    efd = efd_client.start_session(
        base_url=efd_cfg["base_url"],
        user_agent=efd_cfg["user_agent"],
        request_delay_seconds=efd_cfg["request_delay_seconds"],
        max_requests=efd_cfg["max_requests_per_run"],
    )

    filing_rows = efd_client.search_ptr_filings(
        efd,
        submitted_start_date=start_date,
        submitted_end_date=end_date,
        ptr_report_type=efd_cfg["ptr_report_type"],
        page_length=efd_cfg["page_length"],
    )

    window_days = (end_date - start_date).days
    if not filing_rows and window_days >= guard_cfg["min_days_of_history_before_zero_is_suspicious"]:
        raise TradeScrapeError(
            f"0 PTR filings found across a {window_days}-day window "
            f"({start_date} to {end_date}) - Senate recess doesn't last that "
            "long, so this looks like a site/parsing problem rather than a "
            "genuine lull. Aborting without writing."
        )

    new_reports = [r for r in filing_rows if r.report_uuid not in existing_report_uuids]

    new_trades: list[dict] = []
    unmatched_names: list[str] = []
    unparsed_reports = 0
    scraped_at = datetime.now(timezone.utc).isoformat()

    for row in new_reports:
        bioguide_id = name_match.match_filer(row.first_name, row.last_name, name_index)
        if bioguide_id is None:
            unmatched_names.append(f"{row.first_name} {row.last_name}")
            continue

        detail = efd_client.fetch_report_detail(efd, row.report_url_path)
        disclosure_date_iso = _parse_mdy(row.filed_date).isoformat()
        report_url = f"{efd_cfg['base_url']}{row.report_url_path}"

        if not detail.parsed_ok:
            unparsed_reports += 1
            new_trades.append(
                {
                    "trade_id": f"efd-{row.report_uuid}-unparsed",
                    "bioguide_id": bioguide_id,
                    "senator_name_raw": f"{row.first_name} {row.last_name}",
                    "report_id": row.report_uuid,
                    "report_url": report_url,
                    "filing_type": "PTR",
                    "chamber": "senate",
                    "transaction_date": None,
                    "disclosure_date": disclosure_date_iso,
                    "owner": None,
                    "ticker": None,
                    "asset_name": None,
                    "asset_type": None,
                    "transaction_type": None,
                    "amount_range": None,
                    "amount_range_min": None,
                    "amount_range_max": None,
                    "comment": None,
                    "parsed_ok": False,
                    "scraped_at": scraped_at,
                }
            )
            continue

        for txn in detail.transactions:
            try:
                txn_date_iso = _parse_mdy(txn.transaction_date).isoformat()
            except ValueError:
                txn_date_iso = None
            new_trades.append(
                {
                    "trade_id": f"efd-{row.report_uuid}-{txn.row_index}",
                    "bioguide_id": bioguide_id,
                    "senator_name_raw": f"{row.first_name} {row.last_name}",
                    "report_id": row.report_uuid,
                    "report_url": report_url,
                    "filing_type": "PTR",
                    "chamber": "senate",
                    "transaction_date": txn_date_iso,
                    "disclosure_date": disclosure_date_iso,
                    "owner": txn.owner,
                    "ticker": txn.ticker,
                    "asset_name": txn.asset_name,
                    "asset_type": txn.asset_type,
                    "transaction_type": txn.transaction_type,
                    "amount_range": txn.amount_range,
                    "amount_range_min": txn.amount_range_min,
                    "amount_range_max": txn.amount_range_max,
                    "comment": txn.comment,
                    "parsed_ok": True,
                    "scraped_at": scraped_at,
                }
            )

    merged_trades = existing_trades + new_trades
    atomic_write_json(
        DATA_DIR / "trades.json",
        {"generated_at": scraped_at, "trades": merged_trades},
    )

    return {
        "window_start": start_date.isoformat(),
        "window_end": end_date.isoformat(),
        "filings_seen": len(filing_rows),
        "new_reports": len(new_reports),
        "new_trades": len(new_trades),
        "unparsed_reports": unparsed_reports,
        "unmatched_filer_names": sorted(set(unmatched_names)),
        "requests_used": efd.budget.used,
        "trades_total": len(merged_trades),
        "generated_at": scraped_at,
    }


def main() -> int:
    config = load_config()
    try:
        stats = run(config)
    except (TradeScrapeError, efd_client.EfdSiteStructureError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print(
        f"Window {stats['window_start']}..{stats['window_end']}: "
        f"{stats['filings_seen']} filings seen, {stats['new_reports']} new "
        f"reports, {stats['new_trades']} new trade rows "
        f"({stats['unparsed_reports']} unparsed), "
        f"{len(stats['unmatched_filer_names'])} unmatched filer names."
    )
    if stats["unmatched_filer_names"]:
        print("Unmatched filer names:", stats["unmatched_filer_names"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
