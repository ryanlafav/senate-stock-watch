"""Client for efdsearch.senate.gov - the official Senate financial disclosure
search system where Periodic Transaction Reports (PTRs) are filed.

Verified empirically against the live site on 2026-08-08 (see README for how
to re-verify if this ever breaks):

  1. GET  /search/home/            -> page has a ToS form:
         <form id="agreement_form" method="POST">
           <input type="checkbox" name="prohibition_agreement" value="1">
           <input type="hidden" name="csrfmiddlewaretoken" value="...">
         </form>
  2. POST /search/home/ with prohibition_agreement=1 + the csrf token
         -> 302 redirect to /search/, session cookie now authorizes searches.
  3. POST /search/report/data/ (JSON, DataTables server-side protocol) with:
         report_types="[11]"   (11 = PTR)
         filer_types="[]"
         submitted_start_date, submitted_end_date  ("MM/DD/YYYY 00:00:00")
         candidate_state, senator_state, office_id, first_name, last_name = ""
         plus draw/start/length/columns[...]/order[...]
         Header X-CSRFToken: <csrftoken cookie value>
     -> {"draw":.., "recordsTotal":.., "recordsFiltered":.., "data": [[first,
         last, display_label, "<a href='/search/view/ptr/<uuid>/'>...</a>",
         "MM/DD/YYYY"], ...]}
  4. GET the report detail URL. Structured ("ptr") reports have a
     <table class="table table-striped"> with transaction rows. Scanned/paper
     reports (URL contains "/view/paper/") have NO <table> at all - just an
     embedded PDF - and must be recorded as parsed_ok=False rather than
     crashing or being silently dropped.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from bs4 import BeautifulSoup

from .http_utils import RateLimiter, RequestBudget, make_session

BASE_URL_DEFAULT = "https://efdsearch.senate.gov"

_REPORT_LINK_RE = re.compile(
    r'href="(?P<path>/search/view/(?P<kind>ptr|paper|annual)/(?P<uuid>[0-9a-f-]+)/)"[^>]*>(?P<label>[^<]*)</a>'
)


class EfdSiteStructureError(RuntimeError):
    """Raised when the site's HTML no longer matches our assumptions.

    Callers treat this as fatal: abort the run, do not commit partial/garbage
    data, surface the error clearly.
    """


@dataclass
class EfdSession:
    session: Any
    base_url: str
    rate_limiter: RateLimiter
    budget: RequestBudget

    def _get(self, path: str, **kwargs):
        self.budget.consume()
        self.rate_limiter.wait()
        return self.session.get(f"{self.base_url}{path}", timeout=30, **kwargs)

    def _post(self, path: str, **kwargs):
        self.budget.consume()
        self.rate_limiter.wait()
        return self.session.post(f"{self.base_url}{path}", timeout=30, **kwargs)


def start_session(
    *, base_url: str, user_agent: str, request_delay_seconds: float, max_requests: int
) -> EfdSession:
    raw_session = make_session(user_agent)
    efd = EfdSession(
        session=raw_session,
        base_url=base_url,
        rate_limiter=RateLimiter(request_delay_seconds),
        budget=RequestBudget(max_requests),
    )

    home_resp = efd._get("/search/home/")
    home_resp.raise_for_status()
    csrf_match = re.search(
        r'name="csrfmiddlewaretoken"\s+value="([^"]+)"', home_resp.text
    )
    if not csrf_match:
        raise EfdSiteStructureError(
            "Could not find csrfmiddlewaretoken on /search/home/ - the ToS "
            "form structure may have changed."
        )
    if 'name="prohibition_agreement"' not in home_resp.text:
        raise EfdSiteStructureError(
            "Could not find the prohibition_agreement checkbox on "
            "/search/home/ - the ToS form structure may have changed."
        )
    csrf_token = csrf_match.group(1)

    agree_resp = efd._post(
        "/search/home/",
        data={
            "prohibition_agreement": "1",
            "csrfmiddlewaretoken": csrf_token,
        },
        headers={"Referer": f"{base_url}/search/home/"},
        allow_redirects=True,
    )
    agree_resp.raise_for_status()
    if "search_options" not in agree_resp.text and "searchForm" not in agree_resp.text:
        raise EfdSiteStructureError(
            "ToS acknowledgment did not land on the expected search page - "
            "the agreement flow may have changed."
        )

    return efd


@dataclass
class FilingRow:
    first_name: str
    last_name: str
    display_label: str
    report_kind: str  # "ptr" | "paper" | "annual"
    report_uuid: str
    report_url_path: str
    filed_date: str  # as shown on eFD, MM/DD/YYYY


def _parse_link_cell(cell_html: str) -> tuple[str, str, str, str] | None:
    m = _REPORT_LINK_RE.search(cell_html)
    if not m:
        return None
    return m.group("kind"), m.group("uuid"), m.group("path"), m.group("label")


def search_ptr_filings(
    efd: EfdSession,
    *,
    submitted_start_date: date,
    submitted_end_date: date,
    ptr_report_type: int,
    page_length: int,
) -> list[FilingRow]:
    csrf_token = efd.session.cookies.get("csrftoken")
    if not csrf_token:
        raise EfdSiteStructureError(
            "No csrftoken cookie present after starting the session."
        )

    rows: list[FilingRow] = []
    start = 0
    draw = 1
    records_total: int | None = None

    while True:
        payload = {
            "draw": str(draw),
            "start": str(start),
            "length": str(page_length),
            "search[value]": "",
            "order[0][column]": "1",
            "order[0][dir]": "asc",
            "report_types": f"[{ptr_report_type}]",
            "filer_types": "[]",
            "submitted_start_date": submitted_start_date.strftime("%m/%d/%Y 00:00:00"),
            "submitted_end_date": submitted_end_date.strftime("%m/%d/%Y 00:00:00"),
            "candidate_state": "",
            "senator_state": "",
            "office_id": "",
            "first_name": "",
            "last_name": "",
        }
        for i in range(5):
            payload[f"columns[{i}][data]"] = str(i)

        resp = efd._post(
            "/search/report/data/",
            data=payload,
            headers={
                "X-CSRFToken": csrf_token,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{efd.base_url}/search/",
            },
        )
        resp.raise_for_status()
        try:
            body = resp.json()
        except ValueError as e:
            raise EfdSiteStructureError(
                f"/search/report/data/ did not return JSON: {e}"
            ) from e

        for key in ("draw", "recordsTotal", "recordsFiltered", "data"):
            if key not in body:
                raise EfdSiteStructureError(
                    f"/search/report/data/ response missing expected key '{key}' "
                    "- the DataTables response shape may have changed."
                )

        if records_total is None:
            records_total = body["recordsTotal"]

        page_rows = body["data"]
        for raw_row in page_rows:
            if len(raw_row) != 5:
                raise EfdSiteStructureError(
                    f"Expected 5 columns per filing row, got {len(raw_row)}: {raw_row!r}"
                )
            first_name, last_name, display_label, link_cell, filed_date = raw_row
            parsed_link = _parse_link_cell(link_cell)
            if parsed_link is None:
                # Some rows may link to non-ptr/paper/annual detail views we
                # don't recognize yet; skip but don't crash the whole run.
                continue
            kind, uuid_, path, _label = parsed_link
            rows.append(
                FilingRow(
                    first_name=first_name.strip(),
                    last_name=last_name.strip(),
                    display_label=display_label.strip(),
                    report_kind=kind,
                    report_uuid=uuid_,
                    report_url_path=path,
                    filed_date=filed_date.strip(),
                )
            )

        start += page_length
        draw += 1
        if start >= records_total or not page_rows:
            break

    return rows


AMOUNT_RANGE_RE = re.compile(
    r"\$?([\d,]+)\s*-\s*\$?([\d,]+)|Over\s+\$?([\d,]+)|\$?([\d,]+)\s+or\s+less"
)


def parse_amount_range(raw: str) -> tuple[int | None, int | None]:
    if not raw:
        return None, None
    raw = raw.strip()
    m = AMOUNT_RANGE_RE.search(raw)
    if not m:
        return None, None
    if m.group(1) and m.group(2):
        return int(m.group(1).replace(",", "")), int(m.group(2).replace(",", ""))
    if m.group(3):
        return int(m.group(3).replace(",", "")), None
    if m.group(4):
        return None, int(m.group(4).replace(",", ""))
    return None, None


@dataclass
class ParsedTransaction:
    row_index: str
    transaction_date: str
    owner: str
    ticker: str | None
    asset_name: str
    asset_type: str
    transaction_type: str
    amount_range: str
    amount_range_min: int | None
    amount_range_max: int | None
    comment: str


@dataclass
class ReportDetail:
    parsed_ok: bool
    transactions: list[ParsedTransaction] = field(default_factory=list)


def fetch_report_detail(efd: EfdSession, report_url_path: str) -> ReportDetail:
    resp = efd._get(report_url_path)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    table = soup.find("table", class_="table")
    if table is None:
        # Scanned/handwritten ("paper") PTRs render as an embedded PDF with no
        # transaction table - this is expected for some filings, not an error.
        return ReportDetail(parsed_ok=False)

    tbody = table.find("tbody")
    if tbody is None:
        return ReportDetail(parsed_ok=False)

    transactions: list[ParsedTransaction] = []
    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) != 9:
            # Unexpected row shape - don't guess, surface as unparsed.
            return ReportDetail(parsed_ok=False)
        row_index = cells[0].get_text(strip=True)
        transaction_date = cells[1].get_text(strip=True)
        owner = cells[2].get_text(strip=True)
        ticker_link = cells[3].find("a")
        ticker_text = ticker_link.get_text(strip=True) if ticker_link else None
        ticker = ticker_text if ticker_text and ticker_text != "--" else None
        asset_name = re.sub(r"\s+", " ", cells[4].get_text(" ", strip=True))
        asset_type = cells[5].get_text(strip=True)
        transaction_type = cells[6].get_text(strip=True)
        amount_range = cells[7].get_text(strip=True)
        comment = cells[8].get_text(strip=True)
        if comment == "--":
            comment = ""
        amt_min, amt_max = parse_amount_range(amount_range)
        transactions.append(
            ParsedTransaction(
                row_index=row_index,
                transaction_date=transaction_date,
                owner=owner,
                ticker=ticker,
                asset_name=asset_name,
                asset_type=asset_type,
                transaction_type=transaction_type,
                amount_range=amount_range,
                amount_range_min=amt_min,
                amount_range_max=amt_max,
                comment=comment,
            )
        )

    return ReportDetail(parsed_ok=True, transactions=transactions)
