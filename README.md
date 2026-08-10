# SNAP - Senate trade flags

A free, static web app that flags US Senate stock purchases falling within the industry
jurisdiction of a committee the trading senator currently sits on.

A flag is a topical correlation worth a closer look, not an accusation of wrongdoing.
See [`docs/methodology.html`](docs/methodology.html) for the full writeup on how matching
works and its limitations.

## How it works

Everything here is free and serverless:

- **Data pipeline** (`scripts/`, Python): scrapes Senate Periodic Transaction Reports (PTRs)
  directly from [efdsearch.senate.gov](https://efdsearch.senate.gov/search/) (the Senate's own
  official disclosure system), pulls current committee assignments from
  [unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators),
  classifies each traded ticker's industry via [SEC EDGAR](https://www.sec.gov/), and matches
  trades against a hand-curated committee&rarr;industry mapping
  (`config/committee_industry_map.yaml`).
- **Storage**: flat JSON files committed into `docs/data/` - no database. `jurisdiction.json`
  publishes the committee→industry map itself, so the dashboard can show every mapped category
  including the ones currently at zero flags.
- **Automation**: two independent GitHub Actions workflows (see below) run the pipeline on a
  schedule and commit the results back to the repo.
- **Frontend** (`docs/`, plain HTML/CSS/JS, no build step): GitHub Pages serves `docs/` directly;
  the page fetches the committed JSON client-side. Three views share one shell - a derived
  dashboard (`#dashboard`), the flagged-trade table (`#flagged`) and every parsed trade
  (`#all`) - and every figure on the dashboard is computed at render time from the same JSON
  the tables read, so the two can never disagree.

Scope: **Senate only** for now. House disclosures are largely scanned/handwritten PDFs that can't
be reliably auto-parsed, so they're deliberately out of scope until a reliable parsing approach
(likely OCR-based) is validated.

## Two refresh modes

- `python scripts/run_pipeline.py --mode trades` - the frequent one. Scrapes new PTR filings,
  classifies any new tickers, regenerates flags. Runs every 6 hours via
  `.github/workflows/update-trades.yml`.
- `python scripts/run_pipeline.py --mode roster` - the infrequent one. Resyncs the full
  senator/committee/membership roster, then regenerates flags. Runs weekly via
  `.github/workflows/update-roster.yml`, and can be triggered manually (Actions tab &rarr; "Run
  workflow") right after a known committee reassignment instead of waiting for the schedule.

Both workflows: never commit on a failed run (last-known-good data stays live), never commit a
no-op diff, and share a `concurrency` group so they can't race each other.

## Running locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

# run the pipeline (hits live efdsearch.senate.gov / SEC EDGAR / GitHub)
python scripts/run_pipeline.py --mode roster   # first run: populates members/committees
python scripts/run_pipeline.py --mode trades   # then: scrapes trades + classifies + flags

# serve the frontend
python -m http.server 8000 --directory docs
# open http://localhost:8000/index.html
```

Run the test suite (fixture-based, no live network calls):

```bash
pytest tests/ -v
```

## Deploying

1. Push this repo to GitHub (public, since GitHub Pages + unlimited Actions minutes require it
   for a free account).
2. Settings &rarr; Pages &rarr; deploy from the `main` branch, `/docs` folder.
3. Settings &rarr; Actions &rarr; General &rarr; Workflow permissions &rarr; "Read and write
   permissions" (needed so the scheduled workflows can commit data back).
4. Trigger both workflows once manually (Actions tab &rarr; select workflow &rarr; "Run workflow")
   to populate `docs/data/` for the first time, then they run on their schedules automatically.

## The core accuracy artifact

There is no free, authoritative dataset mapping "Senate committee X has jurisdiction over
industry Y" - `config/committee_industry_map.yaml` is a hand-curated heuristic that fills that
gap. It's versioned like code: every mapping states its `confidence` (shown on every flag in the
UI), and committees whose jurisdiction is too broad or procedural to map onto any specific
industry (Appropriations, Budget, Judiciary, Rules, Small Business, and a few others) are marked
`excluded_from_matching` with a stated reason rather than force-fit. Changes to this file should
go through a PR with reasoning, same as code.

## Compliance notes

- **SEC EDGAR** requires a descriptive `User-Agent` header identifying the tool and a contact
  method (see `config/pipeline_config.yaml`); requests without one can be blocked. No API key is
  required.
- **efdsearch.senate.gov** requires acknowledging its terms of use (a checkbox on the search page,
  restricting use of the data to lawful, non-commercial, non-solicitation purposes - see the site
  itself for the exact legal text) before searches are allowed; `scripts/lib/efd_client.py`
  handles that acknowledgment programmatically as part of establishing a session. There is no
  `robots.txt` on the site (confirmed: `efdsearch.senate.gov/robots.txt` returns 404). The
  scraper is rate-limited (`efd.request_delay_seconds` in `config/pipeline_config.yaml`) and
  identifies itself via User-Agent.
- All three data sources (efdsearch.senate.gov, SEC EDGAR, unitedstates/congress-legislators) are
  public-record / open-data sources with no cost and no rate-limit-driven paywalls at the volumes
  this project uses.

## Repository layout

```
config/            Curated mappings + pipeline tuning (committee_industry_map.yaml is the key one)
scripts/            Data pipeline: lib/ (HTTP clients, parsing), 01-04 (pipeline steps), run_pipeline.py
docs/               GitHub Pages site: index.html, methodology.html, styles.css, js/, data/ (pipeline output)
tests/              Fixture-based pytest suite (fixtures captured from live sources on 2026-08-08)
.github/workflows/  update-trades.yml, update-roster.yml, tests.yml
```
