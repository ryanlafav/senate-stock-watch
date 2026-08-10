#!/usr/bin/env python3
"""Match trades against committee_industry_map.yaml to produce flags.json, and
write meta.json (the run-stats/warnings/timestamps file the frontend reads
for its "last updated" indicator).

A trade is flagged when: it's a successfully-parsed Purchase, its ticker was
classified with a SIC code by SEC EDGAR, its disclosure is within
`lookback_days`, and the trading senator currently sits on a committee whose
curated mapping matches that SIC code (or, as a fallback, an asset-name
keyword). See config/committee_industry_map.yaml for why this mapping is the
central accuracy lever of the whole project.
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.io_utils import atomic_write_json, read_json  # noqa: E402
from lib.pipeline_config import (  # noqa: E402
    load_committee_industry_map,
    load_config,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"
PIPELINE_VERSION = "1.0.0"


def _match_sic(sic: str, sic_prefixes: list[str]) -> bool:
    return any(sic.startswith(p) for p in sic_prefixes)


def _match_keywords(asset_name: str, keywords: list[str]) -> bool:
    if not keywords or not asset_name:
        return False
    lowered = asset_name.lower()
    return any(kw.lower() in lowered for kw in keywords)


def _build_committee_map(raw_map: dict) -> dict[str, dict]:
    return {m["committee_id"]: m for m in raw_map["mappings"]}


def run(
    config: dict,
    *,
    roster_generated_at: str | None = None,
    trades_generated_at: str | None = None,
    extra_warnings: list[str] | None = None,
) -> dict:
    flag_cfg = config["flagging"]
    lookback_days = flag_cfg["lookback_days"]
    included_types = set(flag_cfg["included_transaction_types"])

    trades_doc = read_json(DATA_DIR / "trades.json", default={"trades": []})
    sic_doc = read_json(DATA_DIR / "sic_cache.json", default={"tickers": {}})
    committee_membership_doc = read_json(
        DATA_DIR / "committee_membership.json", default={"memberships": []}
    )
    members_doc = read_json(DATA_DIR / "members.json", default={"members": []})
    committees_doc = read_json(DATA_DIR / "committees.json", default={"committees": []})
    industry_map_raw = load_committee_industry_map()

    committee_map = _build_committee_map(industry_map_raw)
    committee_names = {c["committee_id"]: c["name"] for c in committees_doc["committees"]}
    members_by_id = {m["bioguide_id"]: m for m in members_doc["members"]}
    sic_by_ticker = sic_doc.get("tickers", {})

    committees_by_bioguide: dict[str, list[str]] = {}
    role_by_bioguide_committee: dict[tuple[str, str], str] = {}
    for mem in committee_membership_doc["memberships"]:
        committees_by_bioguide.setdefault(mem["bioguide_id"], []).append(mem["committee_id"])
        role_by_bioguide_committee[(mem["bioguide_id"], mem["committee_id"])] = (
            mem.get("title") or "Member"
        )

    unmapped_committees_seen: set[str] = set()
    today = date.today()
    flags: list[dict] = []

    for trade in trades_doc.get("trades", []):
        if not trade.get("parsed_ok"):
            continue
        if trade.get("transaction_type") not in included_types:
            continue
        ticker = trade.get("ticker")
        if not ticker:
            continue
        sic_info = sic_by_ticker.get(ticker)
        if not sic_info or not sic_info.get("found"):
            continue
        disclosure_date = trade.get("disclosure_date")
        if not disclosure_date:
            continue
        days_since = (today - datetime.strptime(disclosure_date, "%Y-%m-%d").date()).days
        if days_since > lookback_days or days_since < 0:
            continue

        bioguide_id = trade["bioguide_id"]
        member = members_by_id.get(bioguide_id)
        if member is None:
            continue

        sic = sic_info["sic"]
        sic_description = sic_info.get("sic_description")

        for committee_id in committees_by_bioguide.get(bioguide_id, []):
            mapping = committee_map.get(committee_id)
            if mapping is None:
                unmapped_committees_seen.add(committee_id)
                continue
            if mapping.get("excluded_from_matching"):
                continue

            sic_hit = _match_sic(sic, mapping.get("sic_prefixes", []))
            keyword_hit = _match_keywords(trade.get("asset_name", ""), mapping.get("keywords", []))
            if not (sic_hit or keyword_hit):
                continue

            committee_role = role_by_bioguide_committee.get((bioguide_id, committee_id), "Member")
            committee_name = committee_names.get(committee_id, mapping.get("committee_name", committee_id))
            match_basis = "SIC classification" if sic_hit else "asset-name keyword"

            rationale = (
                f"Senator {member['official_full_name']} sits on the {committee_name} "
                f"({committee_role}), which has jurisdiction mapped to "
                f"\"{mapping['category']}\". This purchase of {ticker} "
                f"({sic_description or 'industry unclassified'}) matched via "
                f"{match_basis} and was disclosed {days_since} day"
                f"{'s' if days_since != 1 else ''} ago, within the "
                f"{lookback_days}-day flagging window."
            )

            flags.append(
                {
                    "flag_id": f"flag-{trade['trade_id']}-{committee_id}",
                    "trade_id": trade["trade_id"],
                    # Carried through so a flag can link straight back to the
                    # filing it came from without also loading trades.json.
                    "report_url": trade.get("report_url"),
                    "bioguide_id": bioguide_id,
                    "senator_name": member["official_full_name"],
                    "party": member["party"],
                    "state": member["state"],
                    "committee_id": committee_id,
                    "committee_name": committee_name,
                    "committee_role": committee_role,
                    "ticker": ticker,
                    "asset_name": trade.get("asset_name"),
                    "sic": sic,
                    "sic_description": sic_description,
                    "matched_category": mapping["category"],
                    "match_basis": match_basis,
                    "mapping_confidence": mapping.get("confidence", "medium"),
                    "transaction_date": trade.get("transaction_date"),
                    "disclosure_date": disclosure_date,
                    "amount_range": trade.get("amount_range"),
                    "days_since_disclosure": days_since,
                    "rationale": rationale,
                }
            )

    flags.sort(key=lambda f: f["disclosure_date"], reverse=True)
    generated_at = datetime.now(timezone.utc).isoformat()

    atomic_write_json(
        DATA_DIR / "flags.json",
        {"generated_at": generated_at, "lookback_days": lookback_days, "flags": flags},
    )

    # The frontend renders every mapped category, including the ones with zero
    # flags - "this jurisdiction is mapped and currently clean" is a different
    # statement from "we never looked at it", and only the map knows the
    # difference. Excluded committees ship with their stated reason so the
    # methodology page can show why each one is out of scope.
    mapped = [
        {
            "committee_id": m["committee_id"],
            "committee_name": committee_names.get(m["committee_id"], m["committee_name"]),
            "category": m["category"],
            "confidence": m.get("confidence", "medium"),
        }
        for m in industry_map_raw["mappings"]
        if not m.get("excluded_from_matching")
    ]
    excluded = [
        {
            "committee_id": m["committee_id"],
            "committee_name": committee_names.get(m["committee_id"], m["committee_name"]),
            "reason": (m.get("exclusion_reason") or "").strip(),
        }
        for m in industry_map_raw["mappings"]
        if m.get("excluded_from_matching")
    ]
    atomic_write_json(
        DATA_DIR / "jurisdiction.json",
        {
            "generated_at": generated_at,
            "map_version": industry_map_raw.get("version"),
            "last_reviewed": industry_map_raw.get("last_reviewed"),
            "mapped": sorted(mapped, key=lambda m: m["category"]),
            "excluded": sorted(excluded, key=lambda m: m["committee_name"]),
        },
    )

    previous_meta = read_json(DATA_DIR / "meta.json", default={})
    resolved_roster_ts = roster_generated_at or previous_meta.get("last_roster_refresh_utc")
    resolved_trades_ts = trades_generated_at or previous_meta.get("last_trades_refresh_utc")

    warnings = list(extra_warnings or [])
    for cid in sorted(unmapped_committees_seen):
        warnings.append(
            f"Committee '{cid}' has active members but no entry in "
            "committee_industry_map.yaml (treated as excluded)."
        )

    meta = {
        "pipeline_version": PIPELINE_VERSION,
        "last_run_finished_utc": generated_at,
        "last_roster_refresh_utc": resolved_roster_ts,
        "last_trades_refresh_utc": resolved_trades_ts,
        "lookback_days": lookback_days,
        "counts": {
            "members": len(members_doc.get("members", [])),
            "committees": len(committees_doc.get("committees", [])),
            "trades_total": len(trades_doc.get("trades", [])),
            "flags_total": len(flags),
            "tickers_classified": sum(1 for v in sic_by_ticker.values() if v.get("found")),
            "tickers_unclassified": sum(1 for v in sic_by_ticker.values() if not v.get("found")),
        },
        "warnings": warnings,
        "sources": {
            "efd": "https://efdsearch.senate.gov/search/",
            "legislators": "https://github.com/unitedstates/congress-legislators",
            "sec": "https://www.sec.gov/",
        },
    }
    atomic_write_json(DATA_DIR / "meta.json", meta)

    return {"flags_total": len(flags), "generated_at": generated_at, "warnings": warnings}


def main() -> int:
    config = load_config()
    stats = run(config)
    print(f"Wrote {stats['flags_total']} flags.")
    for w in stats["warnings"]:
        print(f"WARNING: {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
