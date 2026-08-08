// Central app state: current view, filters, sort, and the render loop that
// ties data.js / filters.js / table.js / detail.js together.
const App = (() => {
  const state = {
    view: "flagged",
    filters: { committee: "", party: "", state: "", search: "", highConfidenceOnly: false },
    sortKey: "disclosureDate",
    sortDir: "desc",
    membersById: new Map(),
    committeesById: new Map(),
    flaggedRows: null,
    allTradeRows: null,
  };

  function partyBadge(party) {
    const span = document.createElement("span");
    span.className = `badge badge-${party || "I"}`;
    span.textContent = party || "?";
    return span;
  }

  function senatorCell(row) {
    const div = document.createElement("div");
    div.className = "senator-cell";
    const name = document.createElement("span");
    name.className = "senator-name";
    name.textContent = row.senatorName;
    const sub = document.createElement("span");
    sub.className = "senator-sub";
    sub.appendChild(partyBadge(row.party));
    sub.append(` ${row.state || ""}`);
    div.append(name, sub);
    return div;
  }

  function tickerCell(row) {
    const div = document.createElement("div");
    const t = document.createElement("div");
    t.className = "ticker";
    t.textContent = row.ticker || "Unclassified";
    const sub = document.createElement("div");
    sub.className = "senator-sub";
    sub.textContent = row.raw.asset_name || "";
    div.append(t, sub);
    return div;
  }

  function recencyLabel(days) {
    if (days == null) return "";
    if (days === 0) return "today";
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
  }

  const FLAGGED_COLUMNS = [
    { key: "senatorName", label: "Senator", sortable: true, sortValue: (r) => r.senatorName, render: senatorCell },
    { key: "committeeName", label: "Committee", sortable: true, sortValue: (r) => r.committeeName, render: (r) => r.committeeName },
    { key: "ticker", label: "Ticker / Asset", sortable: true, sortValue: (r) => r.ticker || "", render: tickerCell },
    {
      key: "matchedCategory",
      label: "Matched Category",
      sortable: true,
      sortValue: (r) => r.matchedCategory,
      render: (r) => {
        const span = document.createElement("span");
        span.innerHTML = `${r.matchedCategory} <span class="confidence-${r.confidence}">(${r.confidence})</span>`;
        return span;
      },
    },
    { key: "transactionDate", label: "Transaction Date", sortable: true, sortValue: (r) => r.raw.transaction_date || "", render: (r) => r.raw.transaction_date || "—" },
    { key: "disclosureDate", label: "Disclosure Date", sortable: true, sortValue: (r) => r.raw.disclosure_date || "", render: (r) => r.raw.disclosure_date || "—" },
    { key: "amountRange", label: "Amount", sortable: true, sortValue: (r) => r.raw.amount_range_min ?? 0, render: (r) => r.raw.amount_range || "—" },
    {
      key: "daysSinceDisclosure",
      label: "Disclosed",
      sortable: true,
      sortValue: (r) => r.raw.days_since_disclosure,
      render: (r) => {
        const span = document.createElement("span");
        span.className = "recency-chip";
        span.textContent = recencyLabel(r.raw.days_since_disclosure);
        return span;
      },
    },
  ];

  const ALL_TRADES_COLUMNS = [
    { key: "senatorName", label: "Senator", sortable: true, sortValue: (r) => r.senatorName, render: senatorCell },
    { key: "ticker", label: "Ticker / Asset", sortable: true, sortValue: (r) => r.ticker || "", render: tickerCell },
    {
      key: "transactionType",
      label: "Type",
      sortable: true,
      sortValue: (r) => r.raw.transaction_type || "",
      render: (r) => {
        const isPurchase = (r.raw.transaction_type || "").startsWith("Purchase");
        const span = document.createElement("span");
        span.className = `chip ${isPurchase ? "chip-purchase" : "chip-sale"}`;
        span.textContent = r.raw.transaction_type || (r.raw.parsed_ok ? "—" : "Unparsed filing");
        return span;
      },
    },
    { key: "transactionDate", label: "Transaction Date", sortable: true, sortValue: (r) => r.raw.transaction_date || "", render: (r) => r.raw.transaction_date || "—" },
    { key: "disclosureDate", label: "Disclosure Date", sortable: true, sortValue: (r) => r.raw.disclosure_date || "", render: (r) => r.raw.disclosure_date || "—" },
    { key: "amountRange", label: "Amount", sortable: true, sortValue: (r) => r.raw.amount_range_min ?? 0, render: (r) => r.raw.amount_range || "—" },
    {
      key: "matchedCategory",
      label: "Industry Match",
      sortable: true,
      sortValue: (r) => r.matchedCategory || "",
      render: (r) => (r.matchedCategory ? `Matched: ${r.matchedCategory}` : "—"),
    },
  ];

  function normalizeFlag(flag) {
    return {
      kind: "flag",
      raw: flag,
      senatorName: flag.senator_name,
      party: flag.party,
      state: flag.state,
      ticker: flag.ticker,
      committeeId: flag.committee_id,
      committeeName: flag.committee_name,
      matchedCategory: flag.matched_category,
      confidence: flag.mapping_confidence,
    };
  }

  function normalizeTrade(trade, membersById, flagsByTradeId) {
    const member = membersById.get(trade.bioguide_id);
    const matchingFlags = flagsByTradeId.get(trade.trade_id) || [];
    return {
      kind: "trade",
      raw: trade,
      senatorName: member ? member.official_full_name : trade.senator_name_raw,
      party: member ? member.party : null,
      state: member ? member.state : null,
      ticker: trade.ticker,
      committeeId: matchingFlags[0]?.committee_id || "",
      matchedCategory: matchingFlags.map((f) => f.matched_category).join(", ") || "",
      confidence: matchingFlags[0]?.mapping_confidence || "",
    };
  }

  async function ensureFlaggedRows() {
    if (state.flaggedRows) return state.flaggedRows;
    const flagsDoc = await DataStore.flags();
    state.flaggedRows = flagsDoc.flags.map(normalizeFlag);
    return state.flaggedRows;
  }

  async function ensureAllTradeRows() {
    if (state.allTradeRows) return state.allTradeRows;
    const [tradesDoc, flagsDoc] = await Promise.all([DataStore.trades(), DataStore.flags()]);
    const flagsByTradeId = new Map();
    flagsDoc.flags.forEach((f) => {
      if (!flagsByTradeId.has(f.trade_id)) flagsByTradeId.set(f.trade_id, []);
      flagsByTradeId.get(f.trade_id).push(f);
    });
    state.allTradeRows = tradesDoc.trades.map((t) => normalizeTrade(t, state.membersById, flagsByTradeId));
    return state.allTradeRows;
  }

  function committeeOptionsFromFlags(rows) {
    const seen = new Map();
    rows.forEach((r) => {
      if (r.committeeId) seen.set(r.committeeId, r.committeeName);
    });
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }

  function stateOptions() {
    const states = new Set([...state.membersById.values()].map((m) => m.state).filter(Boolean));
    return [...states].sort().map((s) => ({ value: s, label: s }));
  }

  async function render() {
    const headEl = document.getElementById("table-head");
    const bodyEl = document.getElementById("table-body");
    const emptyEl = document.getElementById("empty-state");
    const errorEl = document.getElementById("error-state");
    const countEl = document.getElementById("result-count");
    const committeeSelect = document.getElementById("filter-committee");
    const confidenceCheckbox = document.getElementById("filter-confidence");

    errorEl.hidden = true;
    emptyEl.hidden = true;

    let rows, columns;
    try {
      if (state.view === "flagged") {
        rows = await ensureFlaggedRows();
        columns = FLAGGED_COLUMNS;
        committeeSelect.hidden = false;
        confidenceCheckbox.closest(".filter-checkbox").hidden = false;
        Filters.buildSelectOptions(committeeSelect, committeeOptionsFromFlags(rows), "All committees");
      } else {
        rows = await ensureAllTradeRows();
        columns = ALL_TRADES_COLUMNS;
        committeeSelect.hidden = true;
        confidenceCheckbox.closest(".filter-checkbox").hidden = true;
      }
    } catch (err) {
      console.error(err);
      document.getElementById("data-table").hidden = true;
      errorEl.hidden = false;
      errorEl.textContent = "Couldn't load data. Try refreshing the page - if this keeps happening, the site may be mid-update.";
      return;
    }
    document.getElementById("data-table").hidden = false;

    const filtered = Filters.apply(rows, state.filters);
    const sorted = TableRenderer.sortRows(filtered, columns, state.sortKey, state.sortDir);

    countEl.textContent = `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} shown`;

    if (sorted.length === 0) {
      bodyEl.replaceChildren();
      headEl.replaceChildren();
      TableRenderer.renderHead(headEl, columns, state.sortKey, state.sortDir, onSort);
      emptyEl.hidden = false;
      emptyEl.textContent =
        state.view === "flagged" && rows.length === 0
          ? "No flagged trades yet - either nothing has matched, or the data hasn't run its first refresh."
          : "No rows match the current filters.";
      return;
    }

    TableRenderer.renderHead(headEl, columns, state.sortKey, state.sortDir, onSort);
    TableRenderer.renderBody(bodyEl, columns, sorted, (row) => Detail.show(row));
  }

  function onSort(key) {
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = "desc";
    }
    render();
  }

  function setView(view) {
    state.view = view;
    document.getElementById("tab-flagged").classList.toggle("active", view === "flagged");
    document.getElementById("tab-flagged").setAttribute("aria-selected", view === "flagged");
    document.getElementById("tab-all").classList.toggle("active", view === "all");
    document.getElementById("tab-all").setAttribute("aria-selected", view === "all");
    render();
  }

  function wireFilterControls() {
    document.getElementById("filter-committee").addEventListener("change", (e) => {
      state.filters.committee = e.target.value;
      render();
    });
    document.getElementById("filter-party").addEventListener("change", (e) => {
      state.filters.party = e.target.value;
      render();
    });
    document.getElementById("filter-state").addEventListener("change", (e) => {
      state.filters.state = e.target.value;
      render();
    });
    document.getElementById("filter-confidence").addEventListener("change", (e) => {
      state.filters.highConfidenceOnly = e.target.checked;
      render();
    });
    let searchDebounce;
    document.getElementById("filter-search").addEventListener("input", (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.filters.search = e.target.value;
        render();
      }, 150);
    });
    document.getElementById("tab-flagged").addEventListener("click", () => setView("flagged"));
    document.getElementById("tab-all").addEventListener("click", () => setView("all"));
  }

  function formatRelativeTime(isoString) {
    if (!isoString) return "never";
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffHours = Math.round(diffMs / 3_600_000);
    if (diffHours < 1) return "just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d ago`;
  }

  async function renderMetaRow() {
    const metaRow = document.getElementById("meta-row");
    try {
      const meta = await DataStore.meta();
      metaRow.innerHTML = `
        <span><span class="dot"></span>Trades checked ${formatRelativeTime(meta.last_trades_refresh_utc)}</span>
        <span>Roster last verified ${formatRelativeTime(meta.last_roster_refresh_utc)}</span>
        <span>${meta.counts.flags_total} flags across ${meta.counts.trades_total.toLocaleString()} disclosed trades</span>
      `;
    } catch (err) {
      metaRow.textContent = "Could not load status.";
    }
  }

  async function init() {
    Detail.init();
    wireFilterControls();
    renderMetaRow();

    try {
      const membersDoc = await DataStore.members();
      membersDoc.members.forEach((m) => state.membersById.set(m.bioguide_id, m));
      Filters.buildSelectOptions(document.getElementById("filter-state"), stateOptions(), "All states");
    } catch (err) {
      console.error("Failed to load members.json", err);
    }

    render();
  }

  return { init };
})();
