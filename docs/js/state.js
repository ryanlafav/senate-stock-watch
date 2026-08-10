// Central app state: current view, filters, sort, and the render loop that
// ties data.js / filters.js / table.js / dashboard.js / detail.js together.
//
// Three views share one shell: "dashboard" (derived aggregates) plus the two
// table views ("flagged" and "all"), which differ only in their row source and
// column set.
const App = (() => {
  const state = {
    view: "dashboard",
    filters: { committee: "", party: "", state: "", search: "", highConfidenceOnly: false },
    sortKey: "disclosureDate",
    sortDir: "desc",
    membersById: new Map(),
    flaggedRows: null,
    allTradeRows: null,
  };

  const fmt = new Intl.NumberFormat("en-US");

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const { initials, shortCommittee } = Format;

  /* ---------------------------------------------------------- renderers --- */

  function senatorCell(row) {
    const wrap = el("div", "senator-cell");
    wrap.appendChild(el("span", "av", initials(row.senatorName)));

    const text = el("div");
    text.appendChild(el("span", "senator-name", row.senatorName));
    const sub = el("span", "senator-sub");
    const badge = el("span", `badge badge-${row.party || "I"}`, row.party || "?");
    sub.append(badge, row.state || "");
    text.appendChild(sub);

    wrap.appendChild(text);
    return wrap;
  }

  function assetCell(row) {
    const wrap = el("div");
    wrap.appendChild(el("div", "ticker", row.ticker || "Unclassified"));
    const name = el("div", "cell-sub", row.raw.asset_name || "");
    name.title = row.raw.asset_name || "";
    wrap.appendChild(name);
    return wrap;
  }

  function committeeCell(row) {
    const wrap = el("div", "committee-cell");
    const name = el("div", null, shortCommittee(row.committeeName) || "—");
    name.title = row.committeeName || "";
    wrap.appendChild(name);
    wrap.appendChild(el("div", "cell-sub", row.raw.committee_role || ""));
    return wrap;
  }

  function disclosedCell(row) {
    const wrap = el("div");
    wrap.appendChild(el("div", "num", row.raw.disclosure_date || "—"));
    const days = row.raw.days_since_disclosure;
    if (days != null) {
      const ago = el("div", "cell-sub", days === 0 ? "today" : `${days}d ago`);
      ago.style.textAlign = "right";
      wrap.appendChild(ago);
    }
    return wrap;
  }

  function confidenceCell(row) {
    const level = row.confidence || "low";
    const cls = level === "high" ? "chip-crit" : level === "medium" ? "chip-warn" : "chip-mute";
    return el("span", `chip ${cls}`, level.charAt(0).toUpperCase() + level.slice(1));
  }

  const FLAGGED_COLUMNS = [
    { key: "senatorName", label: "Senator", sortable: true, sortValue: (r) => r.senatorName, render: senatorCell },
    { key: "ticker", label: "Asset", sortable: true, sortValue: (r) => r.ticker || "", render: assetCell },
    {
      key: "sic",
      label: "Industry (SIC)",
      sortable: true,
      sortValue: (r) => r.raw.sic_description || "",
      render: (r) => {
        const cell = el("div", "industry-cell", r.raw.sic_description || "—");
        cell.title = r.raw.sic ? `${r.raw.sic_description} (SIC ${r.raw.sic})` : "";
        return cell;
      },
    },
    { key: "committeeName", label: "Committee", sortable: true, sortValue: (r) => r.committeeName, render: committeeCell },
    {
      key: "amountRange",
      label: "Amount",
      className: "align-right num",
      sortable: true,
      sortValue: (r) => r.raw.amount_range_min ?? 0,
      render: (r) => r.raw.amount_range || "—",
    },
    {
      key: "transactionDate",
      label: "Traded",
      className: "align-right num muted",
      sortable: true,
      sortValue: (r) => r.raw.transaction_date || "",
      render: (r) => r.raw.transaction_date || "—",
    },
    {
      key: "disclosureDate",
      label: "Disclosed",
      className: "align-right",
      sortable: true,
      sortValue: (r) => r.raw.disclosure_date || "",
      render: disclosedCell,
    },
    { key: "confidence", label: "Match", sortable: true, sortValue: (r) => r.confidence || "", render: confidenceCell },
  ];

  const ALL_TRADES_COLUMNS = [
    { key: "senatorName", label: "Senator", sortable: true, sortValue: (r) => r.senatorName, render: senatorCell },
    { key: "ticker", label: "Asset", sortable: true, sortValue: (r) => r.ticker || "", render: assetCell },
    {
      key: "transactionType",
      label: "Type",
      sortable: true,
      sortValue: (r) => r.raw.transaction_type || "",
      render: (r) => {
        const type = r.raw.transaction_type;
        if (!type) return el("span", "chip chip-mute", r.raw.parsed_ok ? "—" : "Unparsed");
        const isPurchase = type.startsWith("Purchase");
        return el("span", `chip ${isPurchase ? "chip-purchase" : "chip-sale"}`, type);
      },
    },
    {
      key: "amountRange",
      label: "Amount",
      className: "align-right num",
      sortable: true,
      sortValue: (r) => r.raw.amount_range_min ?? 0,
      render: (r) => r.raw.amount_range || "—",
    },
    {
      key: "transactionDate",
      label: "Traded",
      className: "align-right num muted",
      sortable: true,
      sortValue: (r) => r.raw.transaction_date || "",
      render: (r) => r.raw.transaction_date || "—",
    },
    {
      key: "disclosureDate",
      label: "Disclosed",
      className: "align-right num",
      sortable: true,
      sortValue: (r) => r.raw.disclosure_date || "",
      render: (r) => r.raw.disclosure_date || "—",
    },
    {
      key: "matchedCategory",
      label: "Industry match",
      sortable: true,
      sortValue: (r) => r.matchedCategory || "",
      render: (r) => {
        if (!r.matchedCategory) return el("span", "muted", "—");
        return el("span", "chip chip-crit", r.matchedCategory);
      },
    },
  ];

  /* -------------------------------------------------------- row loading --- */

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
      committeeName: matchingFlags[0]?.committee_name || "",
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

  /* ------------------------------------------------------------- render --- */

  async function renderTable() {
    const headEl = document.getElementById("table-head");
    const bodyEl = document.getElementById("table-body");
    const emptyEl = document.getElementById("empty-state");
    const errorEl = document.getElementById("error-state");
    const loadingEl = document.getElementById("loading-state");
    const countEl = document.getElementById("result-count");
    const tableEl = document.getElementById("data-table");
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
      loadingEl.hidden = true;
      tableEl.hidden = true;
      errorEl.hidden = false;
      errorEl.textContent =
        "Couldn't load data. Try refreshing the page - if this keeps happening, the site may be mid-update.";
      return;
    }

    loadingEl.hidden = true;
    tableEl.hidden = false;

    const filtered = Filters.apply(rows, state.filters);
    const sorted = TableRenderer.sortRows(filtered, columns, state.sortKey, state.sortDir);

    countEl.textContent = `${fmt.format(filtered.length)} of ${fmt.format(rows.length)} shown`;
    TableRenderer.renderHead(headEl, columns, state.sortKey, state.sortDir, onSort);

    if (sorted.length === 0) {
      bodyEl.replaceChildren();
      emptyEl.hidden = false;
      emptyEl.textContent =
        state.view === "flagged" && rows.length === 0
          ? "No flagged trades yet - either nothing has matched, or the data hasn't run its first refresh."
          : "No rows match the current filters.";
      return;
    }

    TableRenderer.renderBody(bodyEl, columns, sorted, (row) => Detail.show(row));
  }

  async function render() {
    const isDashboard = state.view === "dashboard";
    document.getElementById("view-dashboard").hidden = !isDashboard;
    document.getElementById("view-table").hidden = isDashboard;

    if (isDashboard) {
      try {
        await Dashboard.render();
      } catch (err) {
        console.error("Failed to render dashboard", err);
        document.getElementById("dash-subtitle").textContent =
          "Couldn't load data. Try refreshing the page.";
      }
      return;
    }

    document.getElementById("table-title").textContent =
      state.view === "flagged" ? "Flagged Trades" : "All Trades";
    document.getElementById("table-subtitle").textContent =
      state.view === "flagged"
        ? "Click any row for the full match rationale and the original filing"
        : "Every disclosed transaction the scraper has parsed, flagged or not";

    await renderTable();
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

  const VIEWS = ["dashboard", "flagged", "all"];

  function viewFromHash() {
    const hash = location.hash.replace(/^#/, "");
    return VIEWS.includes(hash) ? hash : "dashboard";
  }

  function setView(view, { pushHash = true } = {}) {
    state.view = view;
    if (pushHash) {
      const target = view === "dashboard" ? " " : `#${view}`;
      if (location.hash !== `#${view}`) history.replaceState(null, "", target.trim() || location.pathname);
    }

    document.querySelectorAll(".rail-item[data-view]").forEach((btn) => {
      if (btn.dataset.view === view) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    document.querySelectorAll(".seg button[data-view]").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.dataset.view === view));
    });

    render();
  }

  // Called from the dashboard leaderboard: jump into the flagged table
  // pre-filtered to one senator.
  function showSenator(name) {
    state.filters.search = name;
    document.getElementById("filter-search").value = name;
    setView("flagged");
  }

  /* --------------------------------------------------------------- wire --- */

  function wireControls() {
    document.querySelectorAll(".rail-item[data-view], .seg button[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });

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

    const search = document.getElementById("filter-search");
    let searchDebounce;
    search.addEventListener("input", (e) => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.filters.search = e.target.value;
        // Searching from the dashboard is a request to see matching rows.
        if (state.view === "dashboard" && e.target.value.trim()) setView("flagged");
        else render();
      }, 150);
    });

    // "/" focuses search, matching the hint in the search box.
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== search && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        search.focus();
      }
    });

    window.addEventListener("hashchange", () => setView(viewFromHash(), { pushHash: false }));
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
      const refreshed = meta.last_trades_refresh_utc;
      const staleHours = refreshed ? (Date.now() - new Date(refreshed).getTime()) / 3_600_000 : Infinity;
      metaRow.className = `status-pill${staleHours > 24 ? " is-stale" : ""}`;
      metaRow.replaceChildren(
        el("span", "dot"),
        el("span", null, `Updated ${formatRelativeTime(refreshed)}`)
      );
      metaRow.title =
        `Trades checked ${formatRelativeTime(refreshed)} - ` +
        `roster verified ${formatRelativeTime(meta.last_roster_refresh_utc)}`;

      const badge = document.getElementById("nav-flag-count");
      badge.textContent = fmt.format(meta.counts.flags_total);
    } catch (err) {
      metaRow.className = "status-pill is-error";
      metaRow.replaceChildren(el("span", "dot"), el("span", null, "Status unavailable"));
    }
  }

  async function init() {
    Detail.init();
    wireControls();
    renderMetaRow();

    try {
      const membersDoc = await DataStore.members();
      membersDoc.members.forEach((m) => state.membersById.set(m.bioguide_id, m));
      Filters.buildSelectOptions(document.getElementById("filter-state"), stateOptions(), "All states");
    } catch (err) {
      console.error("Failed to load members.json", err);
    }

    setView(viewFromHash(), { pushHash: false });
  }

  return { init, showSenator };
})();
