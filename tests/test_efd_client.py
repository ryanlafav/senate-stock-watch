import json
from datetime import date

import pytest
import requests_mock

from conftest import FIXTURES_DIR
from lib import efd_client

BASE = "https://efdsearch.senate.gov"

HOME_HTML = """
<form action="" method="POST" id="agreement_form">
  <input type="checkbox" id="agree_statement" value="1" name="prohibition_agreement" />
  <input type="hidden" name="csrfmiddlewaretoken" value="testtoken123" />
</form>
"""

SEARCH_PAGE_HTML = "<div id='search_options'><form id='searchForm'></form></div>"


def _efd():
    return efd_client.start_session(
        base_url=BASE,
        user_agent="test-agent",
        request_delay_seconds=0,
        max_requests=1000,
    )


def test_start_session_extracts_csrf_and_posts_agreement():
    with requests_mock.Mocker() as m:
        m.get(f"{BASE}/search/home/", text=HOME_HTML)
        m.post(
            f"{BASE}/search/home/",
            text=SEARCH_PAGE_HTML,
            cookies={"csrftoken": "abc123"},
        )
        efd = _efd()
        assert m.request_history[1].method == "POST"
        posted_body = m.request_history[1].text
        assert "prohibition_agreement=1" in posted_body
        assert "csrfmiddlewaretoken=testtoken123" in posted_body


def test_start_session_raises_if_csrf_missing():
    with requests_mock.Mocker() as m:
        m.get(f"{BASE}/search/home/", text="<html>no form here</html>")
        with pytest.raises(efd_client.EfdSiteStructureError):
            _efd()


def test_start_session_raises_if_agreement_post_lands_wrong_page():
    with requests_mock.Mocker() as m:
        m.get(f"{BASE}/search/home/", text=HOME_HTML)
        m.post(f"{BASE}/search/home/", text="<html>error page</html>")
        with pytest.raises(efd_client.EfdSiteStructureError):
            _efd()


def _session_with_cookie(csrftoken="abc123"):
    # requests_mock's fake transport doesn't feed Set-Cookie response headers
    # back into session.cookies the way a real HTTP response does (verified
    # against the live site with curl - production cookie handling is fine),
    # so the cookie is set directly here rather than round-tripped through a
    # mocked Set-Cookie header.
    with requests_mock.Mocker() as m:
        m.get(f"{BASE}/search/home/", text=HOME_HTML)
        m.post(f"{BASE}/search/home/", text=SEARCH_PAGE_HTML)
        efd = _efd()
    efd.session.cookies.set("csrftoken", csrftoken, domain="efdsearch.senate.gov")
    return efd


def test_search_ptr_filings_parses_real_captured_response():
    efd = _session_with_cookie()
    fixture = json.loads((FIXTURES_DIR / "efd_search_results.json").read_text())
    # This fixture is a single real page: recordsTotal=25 but only 10 rows
    # were captured. Use a page_length bigger than recordsTotal so the loop
    # makes exactly one request and stops (matches production's page_length
    # of 100, comfortably larger than a typical PTR search window's results).
    with requests_mock.Mocker() as m:
        m.post(f"{BASE}/search/report/data/", json=fixture)
        rows = efd_client.search_ptr_filings(
            efd,
            submitted_start_date=date(2026, 7, 1),
            submitted_end_date=date(2026, 8, 8),
            ptr_report_type=11,
            page_length=100,
        )
    assert len(rows) == 10
    armstrong = rows[0]
    assert armstrong.first_name == "Alan"
    assert armstrong.last_name == "Armstrong"
    assert armstrong.report_kind == "ptr"
    assert armstrong.report_uuid == "fda235b3-bad7-4637-8fa1-053f354d929c"

    blumenthal = rows[1]
    assert blumenthal.report_kind == "paper"

    # real captured data has a "Moran,  " last name (trailing comma+whitespace
    # artifact from eFD itself) - the raw value survives as-is here; it's
    # name_match.normalize() downstream that strips punctuation for joining.
    moran = next(r for r in rows if r.first_name == "Jerry")
    assert moran.last_name.strip() == "Moran,"


def test_search_ptr_filings_paginates_until_exhausted():
    efd = _session_with_cookie()
    page1 = {
        "draw": 1,
        "recordsTotal": 7,
        "recordsFiltered": 7,
        "data": [
            ["A", "One", "One, A", f'<a href="/search/view/ptr/{"1"*8}-0000-0000-0000-000000000001/">PTR</a>', "01/01/2026"]
            for _ in range(5)
        ],
    }
    page2 = {
        "draw": 2,
        "recordsTotal": 7,
        "recordsFiltered": 7,
        "data": [
            ["B", "Two", "Two, B", f'<a href="/search/view/ptr/{"2"*8}-0000-0000-0000-00000000000{i}/">PTR</a>', "01/01/2026"]
            for i in range(2)
        ],
    }
    with requests_mock.Mocker() as m:
        m.post(f"{BASE}/search/report/data/", [{"json": page1}, {"json": page2}])
        rows = efd_client.search_ptr_filings(
            efd,
            submitted_start_date=date(2026, 1, 1),
            submitted_end_date=date(2026, 1, 2),
            ptr_report_type=11,
            page_length=5,
        )
    assert len(rows) == 7


def test_search_ptr_filings_raises_on_missing_keys():
    efd = _session_with_cookie()
    with requests_mock.Mocker() as m:
        m.post(f"{BASE}/search/report/data/", json={"draw": 1, "data": []})
        with pytest.raises(efd_client.EfdSiteStructureError):
            efd_client.search_ptr_filings(
                efd,
                submitted_start_date=date(2026, 1, 1),
                submitted_end_date=date(2026, 1, 2),
                ptr_report_type=11,
                page_length=10,
            )


def test_fetch_report_detail_parses_real_ptr_table():
    efd = _session_with_cookie()
    html = (FIXTURES_DIR / "efd_ptr_report_sample.html").read_text()
    with requests_mock.Mocker() as m:
        m.get(f"{BASE}/search/view/ptr/fake/", text=html)
        detail = efd_client.fetch_report_detail(efd, "/search/view/ptr/fake/")
    assert detail.parsed_ok is True
    assert len(detail.transactions) == 8
    first = detail.transactions[0]
    assert first.ticker == "UHS"
    assert first.transaction_type == "Purchase"
    assert first.amount_range == "$1,001 - $15,000"
    assert first.amount_range_min == 1001
    assert first.amount_range_max == 15000

    # a row with no ticker link ("--") must become None, not the string "--"
    no_ticker_rows = [t for t in detail.transactions if t.asset_name.startswith("Recruit Holdings")]
    assert no_ticker_rows and no_ticker_rows[0].ticker is None


def test_fetch_report_detail_flags_paper_filing_as_unparsed():
    efd = _session_with_cookie()
    html = (FIXTURES_DIR / "efd_paper_report_sample.html").read_text()
    with requests_mock.Mocker() as m:
        m.get(f"{BASE}/search/view/paper/fake/", text=html)
        detail = efd_client.fetch_report_detail(efd, "/search/view/paper/fake/")
    assert detail.parsed_ok is False
    assert detail.transactions == []


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("$1,001 - $15,000", (1001, 15000)),
        ("$5,000,001 - $25,000,000", (5000001, 25000000)),
        ("Over $50,000,000", (50000000, None)),
        ("", (None, None)),
    ],
)
def test_parse_amount_range(raw, expected):
    assert efd_client.parse_amount_range(raw) == expected
