/* Shared mockup dataset.
 *
 * Everything under REAL is computed from the committed pipeline output in
 * docs/data/ as of the 2026-08-08 04:55 UTC run. Everything under PLACEHOLDER
 * is invented filler for design purposes and is rendered with the hatched
 * "placeholder" treatment plus a PLACEHOLDER badge everywhere it appears.
 */
const SNAP = {
  meta: {
    generated: "2026-08-08 04:55 UTC",
    lookbackDays: 45,
    members: 100,
    committees: 21,
    tradesTotal: 1129,
    flagsTotal: 28,
    tickersClassified: 389,
    tickersUnclassified: 38,
    sendersTrading: 16,
    estVolume: 57363063,
    mappedCategories: 13,
    excludedCommittees: 8,
    confidence: { high: 26, medium: 2 },
    traderParty: { R: 11, D: 5 },
  },

  // Monthly disclosure counts. May-Aug 2026 are real; the eight prior months
  // are placeholder backfill so the trend chart has a full 12-month axis.
  months: [
    { label: "Sep", year: 2025, disclosures: 182, flagged: 4, placeholder: true },
    { label: "Oct", year: 2025, disclosures: 214, flagged: 7, placeholder: true },
    { label: "Nov", year: 2025, disclosures: 168, flagged: 5, placeholder: true },
    { label: "Dec", year: 2025, disclosures: 196, flagged: 6, placeholder: true },
    { label: "Jan", year: 2026, disclosures: 305, flagged: 9, placeholder: true },
    { label: "Feb", year: 2026, disclosures: 244, flagged: 7, placeholder: true },
    { label: "Mar", year: 2026, disclosures: 278, flagged: 8, placeholder: true },
    { label: "Apr", year: 2026, disclosures: 322, flagged: 11, placeholder: true },
    { label: "May", year: 2026, disclosures: 58, flagged: 0, placeholder: false },
    { label: "Jun", year: 2026, disclosures: 121, flagged: 0, placeholder: false },
    { label: "Jul", year: 2026, disclosures: 754, flagged: 22, placeholder: false },
    { label: "Aug", year: 2026, disclosures: 196, flagged: 6, placeholder: false },
  ],

  // Estimated disclosed volume by month (midpoint of each reported range). Real.
  volumeByMonth: [
    { label: "May 2026", value: 9308028 },
    { label: "Jun 2026", value: 8012060 },
    { label: "Jul 2026", value: 29205376 },
    { label: "Aug 2026", value: 10837598 },
  ],

  // All 13 mapped committee->industry categories from
  // config/committee_industry_map.yaml. Flag counts are real.
  categories: [
    { name: "Health, Pharma, Biotech & Education", flags: 26, confidence: "high" },
    { name: "Commerce, Transportation & Technology", flags: 2, confidence: "medium" },
    { name: "Banking, Housing & Financial Services", flags: 0, confidence: "high" },
    { name: "Energy & Natural Resources", flags: 0, confidence: "high" },
    { name: "Defense & Aerospace", flags: 0, confidence: "high" },
    { name: "Agriculture & Food", flags: 0, confidence: "high" },
    { name: "Environment, Infrastructure & Utilities", flags: 0, confidence: "medium" },
    { name: "Health Insurance, Trade & Tax-Related Finance", flags: 0, confidence: "medium" },
    { name: "Homeland Security & Government Contracting", flags: 0, confidence: "medium" },
    { name: "Intelligence & Defense Contracting", flags: 0, confidence: "medium" },
    { name: "Veterans Health & Services", flags: 0, confidence: "medium" },
    { name: "Senior Health, Insurance & Long-Term Care", flags: 0, confidence: "medium" },
    { name: "Tribal Affairs & Gaming", flags: 0, confidence: "medium" },
  ],

  // Real: days between transaction date and disclosure date, all 1,126 trades
  // that carry both dates.
  lag: {
    median: 113,
    pctOverWindow: 79.0,
    buckets: [
      { label: "0-15 days", count: 32 },
      { label: "16-30 days", count: 140 },
      { label: "31-45 days", count: 64 },
      { label: "Over 45 days", count: 890 },
    ],
  },

  // Real: senators with at least one flag.
  flaggedSenators: [
    { name: "Alan Armstrong", party: "R", state: "OK", flags: 20, trades: 703, volume: 25026352, committee: "Health, Education, Labor & Pensions" },
    { name: "Tommy Tuberville", party: "R", state: "AL", flags: 6, trades: 188, volume: 5741094, committee: "Health, Education, Labor & Pensions" },
    { name: "Jerry Moran", party: "R", state: "KS", flags: 1, trades: 4, volume: 32001, committee: "Commerce, Science & Transportation" },
    { name: "Gary C. Peters", party: "D", state: "MI", flags: 1, trades: 3, volume: 24001, committee: "Commerce, Science & Transportation" },
  ],

  // Real: most-traded tickers across all 1,129 disclosed trades.
  topTickers: [
    { ticker: "CLF", name: "Cleveland-Cliffs Inc.", count: 16 },
    { ticker: "AAPL", name: "Apple Inc.", count: 13 },
    { ticker: "ADBE", name: "Adobe Inc.", count: 9 },
    { ticker: "MSFT", name: "Microsoft Corp.", count: 8 },
    { ticker: "INTC", name: "Intel Corp.", count: 8 },
    { ticker: "BRK.B", name: "Berkshire Hathaway", count: 6 },
    { ticker: "NVDA", name: "NVIDIA Corp.", count: 5 },
    { ticker: "GILD", name: "Gilead Sciences", count: 5 },
  ],

  // Real: the most recent flagged trades, newest disclosure first.
  flags: [
    { senator: "Tommy Tuberville", party: "R", state: "AL", ticker: "HUMA", asset: "Humacyte, Inc. - Common Stock", sic: "Biological Products", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2024-03-21", disclosed: "2026-08-05", amount: "$15,001 - $50,000", age: 3 },
    { senator: "Tommy Tuberville", party: "R", state: "AL", ticker: "GILD", asset: "Gilead Sciences Inc (Put, $70.00, exp. 11/15/2024)", sic: "Biological Products", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2024-05-10", disclosed: "2026-08-05", amount: "$1,001 - $15,000", age: 3 },
    { senator: "Tommy Tuberville", party: "R", state: "AL", ticker: "HUMA", asset: "Humacyte Inc", sic: "Biological Products", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2024-03-21", disclosed: "2026-08-05", amount: "$1,001 - $15,000", age: 3 },
    { senator: "Jerry Moran", party: "R", state: "KS", ticker: "GOOG", asset: "Alphabet Inc. - Class C Capital Stock", sic: "Services-Computer Programming, Data Processing", category: "Commerce, Transportation & Technology", committee: "Commerce, Science & Transportation", role: "Member", confidence: "medium", txn: "2026-06-23", disclosed: "2026-07-21", amount: "$1,001 - $15,000", age: 18 },
    { senator: "Alan Armstrong", party: "R", state: "OK", ticker: "SNY", asset: "Sanofi - American Depositary Shares", sic: "Pharmaceutical Preparations", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2026-03-30", disclosed: "2026-07-21", amount: "$15,001 - $50,000", age: 18 },
    { senator: "Alan Armstrong", party: "R", state: "OK", ticker: "NVO", asset: "Novo Nordisk A/S - ADR", sic: "Pharmaceutical Preparations", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2026-03-30", disclosed: "2026-07-21", amount: "$15,001 - $50,000", age: 18 },
    { senator: "Alan Armstrong", party: "R", state: "OK", ticker: "NVS", asset: "Novartis AG Common Stock", sic: "Pharmaceutical Preparations", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2026-03-31", disclosed: "2026-07-21", amount: "$1,001 - $15,000", age: 18 },
    { senator: "Alan Armstrong", party: "R", state: "OK", ticker: "AZN", asset: "AstraZeneca PLC Ordinary Shares", sic: "Pharmaceutical Preparations", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2026-03-31", disclosed: "2026-07-21", amount: "$1,001 - $15,000", age: 18 },
    { senator: "Alan Armstrong", party: "R", state: "OK", ticker: "TEVA", asset: "Teva Pharmaceutical Industries Ltd - ADS", sic: "Pharmaceutical Preparations", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2026-03-30", disclosed: "2026-07-21", amount: "$1,001 - $15,000", age: 18 },
    { senator: "Alan Armstrong", party: "R", state: "OK", ticker: "DGX", asset: "Quest Diagnostics Incorporated", sic: "Services-Medical Laboratories", category: "Health, Pharma, Biotech & Education", committee: "Health, Education, Labor & Pensions", role: "Member", confidence: "high", txn: "2026-03-30", disclosed: "2026-07-21", amount: "$1,001 - $15,000", age: 18 },
  ],

  // Placeholder only: features that do not exist in the pipeline yet.
  roadmap: [
    { title: "House of Representatives coverage", note: "House PTRs are scanned PDFs; blocked on an OCR parsing approach.", eta: "Not scheduled" },
    { title: "Email + RSS flag alerts", note: "Notify on new flags matching a saved filter.", eta: "Concept" },
    { title: "Senator profile pages", note: "Per-senator history, committee tenure, holdings timeline.", eta: "Concept" },
    { title: "Historical backfill to 2023", note: "Would fill the greyed months in the disclosure trend.", eta: "Concept" },
  ],
};
