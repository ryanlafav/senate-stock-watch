// Dashboard view: every figure here is derived at render time from the same
// committed JSON the tables read. Nothing is hardcoded, so the dashboard can
// never drift from the data the pipeline actually produced.
const Dashboard = (() => {
  const fmt = new Intl.NumberFormat("en-US");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MAX_MONTHS = 12;

  let rendered = false;

  const { compactMoney, midpoint, initials, shortCommittee, daysBetween } = Format;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ------------------------------------------------------------ derive --- */

  function monthlySeries(trades, flags) {
    const disclosures = new Map();
    const flagged = new Map();

    trades.forEach((t) => {
      if (!t.disclosure_date) return;
      const key = t.disclosure_date.slice(0, 7);
      disclosures.set(key, (disclosures.get(key) || 0) + 1);
    });
    flags.forEach((f) => {
      if (!f.disclosure_date) return;
      const key = f.disclosure_date.slice(0, 7);
      flagged.set(key, (flagged.get(key) || 0) + 1);
    });

    return [...disclosures.keys()]
      .sort()
      .slice(-MAX_MONTHS)
      .map((key) => {
        const [year, month] = key.split("-");
        return {
          label: MONTHS[Number(month) - 1],
          sublabel: `${MONTHS[Number(month) - 1]} ${year}`,
          disclosures: disclosures.get(key) || 0,
          flagged: flagged.get(key) || 0,
        };
      });
  }

  function lagBuckets(trades, windowDays) {
    const buckets = [
      { label: `0-15 days`, color: "var(--good)", value: 0 },
      { label: `16-30 days`, color: "var(--warning)", value: 0 },
      { label: `31-${windowDays} days`, color: "var(--serious)", value: 0 },
      { label: `Over ${windowDays} days`, color: "var(--critical)", value: 0 },
    ];
    let total = 0;
    let late = 0;
    const lags = [];

    trades.forEach((t) => {
      if (!t.transaction_date || !t.disclosure_date) return;
      const lag = daysBetween(t.transaction_date, t.disclosure_date);
      if (!Number.isFinite(lag) || lag < 0) return;
      total += 1;
      lags.push(lag);
      if (lag <= 15) buckets[0].value += 1;
      else if (lag <= 30) buckets[1].value += 1;
      else if (lag <= windowDays) buckets[2].value += 1;
      else { buckets[3].value += 1; late += 1; }
    });

    lags.sort((a, b) => a - b);
    const median = lags.length ? lags[Math.floor(lags.length / 2)] : 0;
    return { buckets, total, late, median, onTime: total - late };
  }

  function categoryRows(jurisdiction, flags) {
    const counts = new Map();
    flags.forEach((f) => counts.set(f.matched_category, (counts.get(f.matched_category) || 0) + 1));
    return jurisdiction.mapped
      .map((m) => ({
        name: m.category,
        value: counts.get(m.category) || 0,
        confidence: m.confidence,
        committee: m.committee_name,
        color: m.confidence === "high" ? "var(--series-1)" : "var(--series-2)",
        meta: `${m.confidence}-confidence mapping`,
      }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }

  function senatorRollup(flags, trades) {
    const byId = new Map();
    flags.forEach((f) => {
      if (!byId.has(f.bioguide_id)) {
        byId.set(f.bioguide_id, {
          name: f.senator_name, party: f.party, state: f.state,
          committee: shortCommittee(f.committee_name),
          flags: 0, trades: 0, volume: 0,
        });
      }
      byId.get(f.bioguide_id).flags += 1;
    });
    trades.forEach((t) => {
      const row = byId.get(t.bioguide_id);
      if (!row) return;
      row.trades += 1;
      row.volume += midpoint(t);
    });
    return [...byId.values()].sort((a, b) => b.flags - a.flags || b.volume - a.volume);
  }

  /* ------------------------------------------------------------ render --- */

  function renderStatTiles(host, { meta, flags, trades, tradersCount, flaggedSenators, volume }) {
    const high = flags.filter((f) => f.mapping_confidence === "high").length;
    const recent = flags.filter((f) => (f.days_since_disclosure ?? 99) <= 7).length;
    const pctHigh = flags.length ? ((high / flags.length) * 100).toFixed(1) : "0.0";

    const tiles = [
      {
        icon: `<path d="M4 21V4"/><path d="M4 5h11l-1.6 3.5L15 12H4"/>`,
        stroke: "var(--series-2)",
        chip: recent ? { cls: "chip-crit", text: `+${recent} this week` } : { cls: "chip-mute", text: "none this week" },
        k: "Active flags",
        v: fmt.format(flags.length),
        d: `${meta.lookback_days}-day window`,
      },
      {
        icon: `<path d="M12 3 4 6.4v5.2c0 4.5 3.4 8.2 8 9.4 4.6-1.2 8-4.9 8-9.4V6.4Z"/><path d="m9 12 2 2 4-4"/>`,
        stroke: "var(--good)",
        chip: { cls: "chip-good", text: `${pctHigh}%` },
        k: "High-confidence matches",
        v: fmt.format(high),
        d: `${fmt.format(flags.length - high)} medium-confidence`,
      },
      {
        icon: `<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M22 20v-2a4 4 0 0 0-3-3.9"/>`,
        stroke: "var(--ink-2)",
        chip: { cls: "chip-mute", text: `of ${fmt.format(meta.counts.members)}` },
        k: "Senators who filed",
        v: fmt.format(tradersCount),
        d: `${flaggedSenators} currently flagged`,
      },
      {
        icon: `<path d="M12 2v4"/><path d="M12 22v-4"/><circle cx="12" cy="12" r="6"/>`,
        stroke: "var(--warning)",
        chip: { cls: "chip-mute", text: "midpoints" },
        k: "Est. disclosed volume",
        v: compactMoney(volume),
        d: `across ${fmt.format(trades.length)} transactions`,
      },
    ];

    host.replaceChildren();
    tiles.forEach((t) => {
      const card = el("section", "card stat");
      card.innerHTML =
        `<div class="row1">
           <span class="ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${t.stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg></span>
           <span class="chip ${t.chip.cls}">${t.chip.text}</span>
         </div>
         <div class="k">${t.k}</div>
         <div class="v">${t.v}</div>
         <div class="d">${t.d}</div>`;
      host.appendChild(card);
    });
  }

  function renderCategoryFeatures(host, rows) {
    const withFlags = rows.filter((r) => r.value > 0);
    const clear = rows.length - withFlags.length;
    const skins = ["teal", "violet", "steel"];
    const cards = withFlags.slice(0, 2).map((r, i) => ({
      skin: skins[i],
      title: r.name,
      tag: r.confidence === "high"
        ? `<span class="chip chip-good">High</span>`
        : `<span class="chip chip-warn">Medium</span>`,
      value: fmt.format(r.value),
      rk: "Committee",
      rv: shortCommittee(r.committee),
    }));

    cards.push({
      skin: "steel",
      title: withFlags.length ? "All other mapped categories" : "All mapped categories",
      tag: `<span class="chip chip-mute">Clear</span>`,
      value: "0",
      rk: "Categories",
      rv: `${clear} of ${rows.length}`,
    });

    host.replaceChildren();
    cards.forEach((c) => {
      const card = el("div", `feature ${c.skin}`);
      card.innerHTML =
        `<div class="fh">
           <span class="ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V4"/><path d="M4 5h11l-1.6 3.5L15 12H4"/></svg></span>
           <h3>${c.title}</h3>
           <span class="tag">${c.tag}</span>
         </div>
         <div class="body">
           <div><div class="k">Flags</div><div class="v">${c.value}</div></div>
           <div class="r"><div class="k">${c.rk}</div><div style="font-size:12px">${c.rv}</div></div>
         </div>`;
      host.appendChild(card);
    });
  }

  function renderLeaderboard(host, senators) {
    const skins = ["teal", "violet", "steel", "teal"];
    host.replaceChildren();

    if (!senators.length) {
      host.appendChild(el("p", "empty-state", "No senator currently has a flagged trade in the window."));
      return;
    }

    senators.slice(0, 4).forEach((s, i) => {
      const card = el("div", `lb feature ${skins[i]}`);
      card.innerHTML =
        `<div class="head">
           <span class="av">${initials(s.name)}</span>
           <span>
             <span class="nm">${s.name}</span>
             <span class="sub">${s.party}-${s.state}</span>
           </span>
           <span class="rank">#${i + 1}</span>
         </div>
         <div class="k">Flags in window</div>
         <div class="v">${fmt.format(s.flags)}</div>
         <div class="rows">
           <div><span>Committee</span><b>${s.committee}</b></div>
           <div><span>Trades filed</span><b>${fmt.format(s.trades)}</b></div>
           <div><span>Est. volume</span><b>${compactMoney(s.volume)}</b></div>
         </div>
         <button class="cta" type="button">View flagged trades</button>`;
      card.querySelector(".cta").addEventListener("click", () => App.showSenator(s.name));
      host.appendChild(card);
    });
  }

  function renderMeters({ lag, meta, jurisdiction }) {
    const windowDays = meta.lookback_days;
    const latePct = lag.total ? Math.round((lag.late / lag.total) * 100) : 0;

    document.getElementById("lag-sample").textContent = `${fmt.format(lag.total)} dated trades`;
    const verdict = document.getElementById("lag-verdict");
    verdict.textContent = latePct >= 50 ? "Late" : latePct >= 20 ? "Mixed" : "On time";
    verdict.className = `chip ${latePct >= 50 ? "chip-crit" : latePct >= 20 ? "chip-warn" : "chip-good"}`;

    Charts.track(document.getElementById("lag-track"), lag.buckets);
    document.getElementById("lag-foot").innerHTML =
      `<span>On time <b>${fmt.format(lag.onTime)}</b></span>` +
      `<span>Past ${windowDays}-day window <b>${fmt.format(lag.late)} (${latePct}%)</b></span>`;

    const classified = meta.counts.tickers_classified;
    const unclassified = meta.counts.tickers_unclassified;
    const totalTickers = classified + unclassified;
    const sicPct = totalTickers ? Math.round((classified / totalTickers) * 100) : 0;
    const sicVerdict = document.getElementById("sic-verdict");
    sicVerdict.textContent = sicPct >= 95 ? "Complete" : "Partial";
    sicVerdict.className = `chip ${sicPct >= 95 ? "chip-good" : "chip-warn"}`;
    Charts.track(document.getElementById("sic-track"), [
      { label: "Resolved by SEC", color: "var(--series-1)", value: classified },
      { label: "Unresolved", color: "var(--warning)", value: unclassified },
    ]);
    document.getElementById("sic-foot").innerHTML =
      `<span>Resolved by SEC <b>${fmt.format(classified)}</b></span>` +
      `<span>Unresolved <b>${fmt.format(unclassified)}</b></span>`;

    Charts.track(document.getElementById("map-track"), [
      { label: "Mapped", color: "var(--series-1)", value: jurisdiction.mapped.length },
      { label: "Excluded by design", color: "var(--ink-3)", value: jurisdiction.excluded.length },
    ]);
    document.getElementById("map-foot").innerHTML =
      `<span>Mapped <b>${fmt.format(jurisdiction.mapped.length)}</b></span>` +
      `<span>Excluded by design <b>${fmt.format(jurisdiction.excluded.length)}</b></span>`;

    document.getElementById("map-version").textContent =
      `map v${jurisdiction.map_version} - reviewed ${jurisdiction.last_reviewed}`;

    const lastRun = meta.last_run_finished_utc;
    document.getElementById("last-run").textContent = lastRun
      ? `${lastRun.slice(0, 10)} ${lastRun.slice(11, 16)} UTC`
      : "unknown";
  }

  /* -------------------------------------------------------------- entry --- */

  async function render() {
    if (rendered) return;

    const [meta, flagsDoc, tradesDoc, jurisdiction] = await Promise.all([
      DataStore.meta(),
      DataStore.flags(),
      DataStore.trades(),
      DataStore.jurisdiction(),
    ]);

    const flags = flagsDoc.flags;
    const trades = tradesDoc.trades;

    const traders = new Set(trades.map((t) => t.bioguide_id).filter(Boolean));
    const volume = trades.reduce((sum, t) => sum + midpoint(t), 0);
    const senators = senatorRollup(flags, trades);
    const months = monthlySeries(trades, flags);
    const lag = lagBuckets(trades, meta.lookback_days);
    const cats = categoryRows(jurisdiction, flags);

    // Hero
    const flagShare = trades.length ? ((flags.length / trades.length) * 100).toFixed(1) : "0.0";
    document.getElementById("hero-trades").textContent = fmt.format(trades.length);
    document.getElementById("hero-flag-share").textContent =
      `${fmt.format(flags.length)} flagged - ${flagShare}%`;

    document.getElementById("hero-sub").textContent =
      `From ${fmt.format(traders.size)} senators across ${months.length} month${months.length === 1 ? "" : "s"} of coverage.`;

    Charts.lineChart(document.getElementById("chart-flow"), document.getElementById("tt-flow"), {
      data: months,
      series: [
        { key: "disclosures", color: "var(--series-1)", label: "Disclosures" },
        { key: "flagged", color: "var(--series-2)", label: "Flagged" },
      ],
    });

    renderMeters({ lag, meta, jurisdiction });

    renderStatTiles(document.getElementById("stat-tiles"), {
      meta, flags, trades,
      tradersCount: traders.size,
      flaggedSenators: senators.length,
      volume,
    });

    document.getElementById("dash-subtitle").textContent =
      `Senate purchases inside a committee's mapped industry jurisdiction - ` +
      `median filing lag ${lag.median} days`;

    document.getElementById("cat-subtitle").textContent =
      `Flags across all ${cats.length} mapped categories`;
    renderCategoryFeatures(document.getElementById("cat-features"), cats);
    Charts.barRows(document.getElementById("chart-cats"), document.getElementById("tt-cats"), {
      rows: cats,
    });

    document.getElementById("leaderboard-sub").textContent =
      `Current ${meta.lookback_days}-day window`;
    renderLeaderboard(document.getElementById("leaderboard"), senators);

    rendered = true;
  }

  return { render };
})();
