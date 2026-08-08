#!/usr/bin/env python3
"""Fetch current Senate roster + committee list + committee membership from
the unitedstates/congress-legislators open civic-data project.

Writes docs/data/members.json, committees.json, committee_membership.json.
This is the "roster" half of the pipeline (see run_pipeline.py --mode roster)
- it only changes when a new Congress is sworn in, a senator leaves/is
replaced mid-term, or committee assignments shift, so it's run far less often
than the trade scraper.
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.http_utils import RateLimiter, make_session  # noqa: E402
from lib.io_utils import atomic_write_json  # noqa: E402
from lib.pipeline_config import load_config  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"

_PARTY_LETTER = {
    "Democrat": "D",
    "Republican": "R",
    "Independent": "I",
}


def _fetch_yaml(session, rate_limiter: RateLimiter, url: str):
    rate_limiter.wait()
    resp = session.get(url, timeout=60)
    resp.raise_for_status()
    return yaml.safe_load(resp.text)


def _current_senate_term(legislator: dict, today: date) -> dict | None:
    terms = legislator.get("terms") or []
    for term in terms:
        if term.get("type") != "sen":
            continue
        start = _parse_date(term.get("start"))
        end = _parse_date(term.get("end"))
        if start and end and start <= today <= end:
            return term
    return None


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    return datetime.strptime(s, "%Y-%m-%d").date()


def build_members(legislators: list[dict], today: date) -> list[dict]:
    members = []
    for leg in legislators:
        term = _current_senate_term(leg, today)
        if term is None:
            continue
        bioguide_id = leg.get("id", {}).get("bioguide")
        name = leg.get("name", {})
        if not bioguide_id or not name.get("first") or not name.get("last"):
            continue
        party_raw = term.get("party", "")
        members.append(
            {
                "bioguide_id": bioguide_id,
                "first_name": name["first"],
                "last_name": name["last"],
                "official_full_name": name.get("official_full")
                or f"{name['first']} {name['last']}",
                "chamber": "senate",
                "party": _PARTY_LETTER.get(party_raw, (party_raw[:1] or "?")),
                "party_full": party_raw,
                "state": term.get("state"),
                "state_rank": term.get("state_rank"),
                "term_start": term.get("start"),
                "term_end": term.get("end"),
            }
        )
    members.sort(key=lambda m: (m["last_name"], m["first_name"]))
    return members


def build_committees(committees_raw: list[dict]) -> list[dict]:
    committees = []
    for c in committees_raw:
        if c.get("type") != "senate":
            continue
        committees.append(
            {
                "committee_id": c.get("thomas_id"),
                "name": c.get("name"),
                "chamber": "senate",
                "url": c.get("url"),
            }
        )
    committees.sort(key=lambda c: c["committee_id"] or "")
    return committees


def build_committee_membership(
    membership_raw: dict, senate_committee_ids: set[str]
) -> list[dict]:
    memberships = []
    for committee_id, members in membership_raw.items():
        if committee_id not in senate_committee_ids:
            continue
        for m in members:
            bioguide_id = m.get("bioguide")
            if not bioguide_id:
                continue
            memberships.append(
                {
                    "committee_id": committee_id,
                    "bioguide_id": bioguide_id,
                    "rank": m.get("rank"),
                    "title": m.get("title"),
                    "party": m.get("party"),
                }
            )
    memberships.sort(key=lambda m: (m["committee_id"], m["rank"] or 999))
    return memberships


class RosterFetchError(RuntimeError):
    pass


def run(config: dict) -> dict:
    """Fetch + write members/committees/committee_membership. Returns stats.

    Raises RosterFetchError (without writing anything) if the parsed roster
    looks structurally wrong, so run_pipeline.py can abort the whole run
    rather than commit a broken/empty roster.
    """
    legis_cfg = config["legislators"]
    base = legis_cfg["base_raw_url"]

    session = make_session(legis_cfg["user_agent"])
    rate_limiter = RateLimiter(0.5)

    legislators = _fetch_yaml(session, rate_limiter, f"{base}/legislators-current.yaml")
    committees_raw = _fetch_yaml(session, rate_limiter, f"{base}/committees-current.yaml")
    membership_raw = _fetch_yaml(
        session, rate_limiter, f"{base}/committee-membership-current.yaml"
    )

    today = date.today()
    members = build_members(legislators, today)
    committees = build_committees(committees_raw)
    senate_committee_ids = {c["committee_id"] for c in committees}
    committee_membership = build_committee_membership(membership_raw, senate_committee_ids)

    generated_at = datetime.now(timezone.utc).isoformat()

    if len(members) < 90 or len(members) > 110:
        raise RosterFetchError(
            f"parsed {len(members)} current senators, expected ~100 - "
            "congress-legislators schema may have changed."
        )
    if not committee_membership:
        raise RosterFetchError(
            "parsed 0 committee memberships for known Senate committee IDs."
        )

    atomic_write_json(
        DATA_DIR / "members.json",
        {
            "generated_at": generated_at,
            "source": f"{base}/legislators-current.yaml",
            "members": members,
        },
    )
    atomic_write_json(
        DATA_DIR / "committees.json",
        {
            "generated_at": generated_at,
            "source": f"{base}/committees-current.yaml",
            "committees": committees,
        },
    )
    atomic_write_json(
        DATA_DIR / "committee_membership.json",
        {
            "generated_at": generated_at,
            "source": f"{base}/committee-membership-current.yaml",
            "memberships": committee_membership,
        },
    )

    return {
        "members": len(members),
        "committees": len(committees),
        "committee_memberships": len(committee_membership),
        "generated_at": generated_at,
    }


def main() -> int:
    config = load_config()
    try:
        stats = run(config)
    except RosterFetchError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print(
        f"Wrote {stats['members']} members, {stats['committees']} committees, "
        f"{stats['committee_memberships']} committee memberships."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
