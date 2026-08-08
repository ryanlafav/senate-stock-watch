import requests_mock

from lib import sec_client

TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_TEMPLATE = "https://data.sec.gov/submissions/CIK{cik10}.json"


def _client():
    return sec_client.make_client(user_agent="test-agent", request_delay_seconds=0)


def test_fetch_ticker_to_cik_uppercases_and_pads_cik():
    raw = {
        "0": {"cik_str": 1045810, "ticker": "nvda", "title": "NVIDIA CORP"},
        "1": {"cik_str": 19617, "ticker": "JPM", "title": "JPMORGAN CHASE & CO"},
    }
    with requests_mock.Mocker() as m:
        m.get(TICKER_MAP_URL, json=raw)
        result = sec_client.fetch_ticker_to_cik(_client(), TICKER_MAP_URL)
    assert result["NVDA"] == "0001045810"
    assert result["JPM"] == "0000019617"


def test_fetch_sic_for_cik_returns_classification():
    submissions = {
        "cik": "0000019617",
        "name": "JPMORGAN CHASE & CO",
        "sic": "6021",
        "sicDescription": "National Commercial Banks",
    }
    url = SUBMISSIONS_TEMPLATE.format(cik10="0000019617")
    with requests_mock.Mocker() as m:
        m.get(url, json=submissions)
        info = sec_client.fetch_sic_for_cik(_client(), SUBMISSIONS_TEMPLATE, "0000019617")
    assert info["sic"] == "6021"
    assert info["sic_description"] == "National Commercial Banks"
    assert info["company_name"] == "JPMORGAN CHASE & CO"


def test_fetch_sic_for_cik_handles_missing_sic():
    url = SUBMISSIONS_TEMPLATE.format(cik10="0000000001")
    with requests_mock.Mocker() as m:
        m.get(url, json={"cik": "0000000001", "name": "SHELL CO"})
        info = sec_client.fetch_sic_for_cik(_client(), SUBMISSIONS_TEMPLATE, "0000000001")
    assert info["sic"] is None
