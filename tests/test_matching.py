import importlib.util
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"


def _load_generate_flags():
    spec = importlib.util.spec_from_file_location(
        "generate_flags", SCRIPTS_DIR / "04_generate_flags.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_match_sic_prefix():
    gf = _load_generate_flags()
    assert gf._match_sic("6021", ["60", "61"]) is True
    assert gf._match_sic("3812", ["60", "61"]) is False


def test_match_keywords_case_insensitive():
    gf = _load_generate_flags()
    assert gf._match_keywords("JPMorgan Chase Bank Common Stock", ["bank"]) is True
    assert gf._match_keywords("Apple Inc Common Stock", ["bank"]) is False
    assert gf._match_keywords("", ["bank"]) is False


CONFIG = {
    "flagging": {"lookback_days": 45, "included_transaction_types": ["Purchase"]},
}


def _write_data_dir(tmp_path, *, trades, sic_cache, committee_membership, members, committees):
    data_dir = tmp_path / "docs" / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "trades.json").write_text(json.dumps({"trades": trades}))
    (data_dir / "sic_cache.json").write_text(json.dumps({"tickers": sic_cache}))
    (data_dir / "committee_membership.json").write_text(
        json.dumps({"memberships": committee_membership})
    )
    (data_dir / "members.json").write_text(json.dumps({"members": members}))
    (data_dir / "committees.json").write_text(json.dumps({"committees": committees}))
    return data_dir


@pytest.fixture
def gf(tmp_path, monkeypatch):
    module = _load_generate_flags()
    monkeypatch.setattr(module, "DATA_DIR", tmp_path / "docs" / "data")
    return module


MEMBER = {
    "bioguide_id": "W000817",
    "official_full_name": "Elizabeth Warren",
    "party": "D",
    "state": "MA",
}
COMMITTEE = {"committee_id": "SSBK", "name": "Committee on Banking, Housing, and Urban Affairs"}
MEMBERSHIP = {"committee_id": "SSBK", "bioguide_id": "W000817", "rank": 1, "title": "Ranking Member"}
JPM_SIC = {"found": True, "sic": "6021", "sic_description": "National Commercial Banks"}


def _trade(**overrides):
    base = {
        "trade_id": "t1",
        "bioguide_id": "W000817",
        "parsed_ok": True,
        "transaction_type": "Purchase",
        "ticker": "JPM",
        "asset_name": "JPMorgan Chase & Co Common Stock",
        "transaction_date": "2026-07-01",
        "disclosure_date": date.today().isoformat(),
        "amount_range": "$1,001 - $15,000",
    }
    base.update(overrides)
    return base


def test_flags_a_purchase_in_committee_jurisdiction(gf, tmp_path):
    _write_data_dir(
        tmp_path,
        trades=[_trade()],
        sic_cache={"JPM": JPM_SIC},
        committee_membership=[MEMBERSHIP],
        members=[MEMBER],
        committees=[COMMITTEE],
    )
    stats = gf.run(CONFIG)
    assert stats["flags_total"] == 1
    flags = json.loads((tmp_path / "docs" / "data" / "flags.json").read_text())["flags"]
    assert flags[0]["ticker"] == "JPM"
    assert flags[0]["committee_id"] == "SSBK"
    assert flags[0]["mapping_confidence"] in {"high", "medium"}


def test_flag_carries_report_url_back_to_the_filing(gf, tmp_path):
    url = "https://efdsearch.senate.gov/search/view/ptr/abc-123/"
    _write_data_dir(
        tmp_path,
        trades=[_trade(report_url=url)],
        sic_cache={"JPM": JPM_SIC},
        committee_membership=[MEMBERSHIP],
        members=[MEMBER],
        committees=[COMMITTEE],
    )
    gf.run(CONFIG)
    flags = json.loads((tmp_path / "docs" / "data" / "flags.json").read_text())["flags"]
    assert flags[0]["report_url"] == url


def test_jurisdiction_json_lists_mapped_and_excluded_committees(gf, tmp_path):
    _write_data_dir(
        tmp_path,
        trades=[],
        sic_cache={},
        committee_membership=[],
        members=[],
        committees=[COMMITTEE],
    )
    gf.run(CONFIG)
    doc = json.loads((tmp_path / "docs" / "data" / "jurisdiction.json").read_text())

    # Every mapped entry needs the fields the dashboard renders, and the two
    # groups must be disjoint - a committee is either matchable or excluded.
    assert doc["mapped"] and doc["excluded"]
    for entry in doc["mapped"]:
        assert entry["category"]
        assert entry["confidence"] in {"high", "medium", "low"}
    for entry in doc["excluded"]:
        assert entry["reason"], f"{entry['committee_id']} is excluded with no stated reason"

    mapped_ids = {m["committee_id"] for m in doc["mapped"]}
    excluded_ids = {m["committee_id"] for m in doc["excluded"]}
    assert not (mapped_ids & excluded_ids)

    # Committees present in committees.json get their official name, not the
    # short one carried in the YAML.
    banking = next(m for m in doc["mapped"] if m["committee_id"] == "SSBK")
    assert banking["committee_name"] == COMMITTEE["name"]


def test_sale_is_not_flagged(gf, tmp_path):
    _write_data_dir(
        tmp_path,
        trades=[_trade(transaction_type="Sale (Full)")],
        sic_cache={"JPM": JPM_SIC},
        committee_membership=[MEMBERSHIP],
        members=[MEMBER],
        committees=[COMMITTEE],
    )
    stats = gf.run(CONFIG)
    assert stats["flags_total"] == 0


def test_unrelated_committee_is_not_flagged(gf, tmp_path):
    membership = {**MEMBERSHIP, "committee_id": "SSAF"}  # Agriculture, not Banking
    _write_data_dir(
        tmp_path,
        trades=[_trade()],
        sic_cache={"JPM": JPM_SIC},
        committee_membership=[membership],
        members=[MEMBER],
        committees=[{"committee_id": "SSAF", "name": "Committee on Agriculture"}],
    )
    stats = gf.run(CONFIG)
    assert stats["flags_total"] == 0


def test_excluded_committee_never_flags(gf, tmp_path):
    # Judiciary (SSJU) is marked excluded_from_matching in the real config
    membership = {**MEMBERSHIP, "committee_id": "SSJU"}
    _write_data_dir(
        tmp_path,
        trades=[_trade()],
        sic_cache={"JPM": JPM_SIC},
        committee_membership=[membership],
        members=[MEMBER],
        committees=[{"committee_id": "SSJU", "name": "Committee on the Judiciary"}],
    )
    stats = gf.run(CONFIG)
    assert stats["flags_total"] == 0


def test_lookback_boundary_45_days_included_46_excluded(gf, tmp_path):
    old_45 = (date.today() - timedelta(days=45)).isoformat()
    old_46 = (date.today() - timedelta(days=46)).isoformat()
    _write_data_dir(
        tmp_path,
        trades=[
            _trade(trade_id="within", disclosure_date=old_45),
            _trade(trade_id="outside", disclosure_date=old_46),
        ],
        sic_cache={"JPM": JPM_SIC},
        committee_membership=[MEMBERSHIP],
        members=[MEMBER],
        committees=[COMMITTEE],
    )
    stats = gf.run(CONFIG)
    assert stats["flags_total"] == 1
    flags = json.loads((tmp_path / "docs" / "data" / "flags.json").read_text())["flags"]
    assert flags[0]["trade_id"] == "within"


def test_unclassified_ticker_is_not_flagged(gf, tmp_path):
    _write_data_dir(
        tmp_path,
        trades=[_trade()],
        sic_cache={"JPM": {"found": False, "reason": "not_in_sec_ticker_map"}},
        committee_membership=[MEMBERSHIP],
        members=[MEMBER],
        committees=[COMMITTEE],
    )
    stats = gf.run(CONFIG)
    assert stats["flags_total"] == 0


def test_unparsed_trade_is_not_flagged(gf, tmp_path):
    _write_data_dir(
        tmp_path,
        trades=[_trade(parsed_ok=False, ticker=None)],
        sic_cache={"JPM": JPM_SIC},
        committee_membership=[MEMBERSHIP],
        members=[MEMBER],
        committees=[COMMITTEE],
    )
    stats = gf.run(CONFIG)
    assert stats["flags_total"] == 0
