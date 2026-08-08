// Trade/flag detail modal.
const Detail = (() => {
  let dialogEl, bodyEl;

  function init() {
    dialogEl = document.getElementById("detail-modal");
    bodyEl = document.getElementById("modal-body");
    dialogEl.addEventListener("click", (e) => {
      if (e.target === dialogEl) dialogEl.close();
    });
  }

  function fieldRow(dt, dd) {
    return `<dt>${dt}</dt><dd>${dd ?? "&mdash;"}</dd>`;
  }

  function show(row) {
    const raw = row.raw;
    const secUrl = row.ticker
      ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(row.ticker)}&type=10-K&dateb=&owner=include&count=40`
      : null;

    let html = `<button class="modal-close" id="modal-close-btn" aria-label="Close">&times;</button>`;
    html += `<h2>${row.senatorName}</h2>`;
    html += `<div class="senator-sub">${partyLabel(row.party)} - ${row.state || ""}</div>`;

    const grid = [];
    grid.push(fieldRow("Ticker", row.ticker ? `<span class="ticker">${row.ticker}</span>` : "Unclassified"));
    grid.push(fieldRow("Asset", raw.asset_name));
    if (row.kind === "flag") {
      grid.push(fieldRow("Committee", `${row.committeeName} (${raw.committee_role})`));
      grid.push(fieldRow("Matched category", raw.matched_category));
      grid.push(fieldRow("SIC", raw.sic_description ? `${raw.sic_description} (${raw.sic})` : raw.sic));
      grid.push(fieldRow("Match confidence", `<span class="confidence-${raw.mapping_confidence}">${raw.mapping_confidence}</span>`));
    } else {
      grid.push(fieldRow("Transaction type", raw.transaction_type));
      grid.push(fieldRow("Industry match", row.matchedCategory ? `Yes - ${row.matchedCategory}` : "No match / not evaluated"));
    }
    grid.push(fieldRow("Transaction date", raw.transaction_date));
    grid.push(fieldRow("Disclosure date", raw.disclosure_date));
    grid.push(fieldRow("Amount range", raw.amount_range));

    html += `<dl class="detail-grid">${grid.join("")}</dl>`;

    if (row.kind === "flag") {
      html += `<div class="rationale-box">${raw.rationale}</div>`;
    }

    const links = [];
    if (raw.report_url) {
      links.push(`<a href="${raw.report_url}" target="_blank" rel="noopener">View original PTR filing &rarr;</a>`);
    }
    if (secUrl) {
      links.push(`<a href="${secUrl}" target="_blank" rel="noopener">Company on SEC EDGAR &rarr;</a>`);
    }
    if (links.length) {
      html += `<div class="modal-links">${links.join("")}</div>`;
    }

    bodyEl.innerHTML = html;
    document.getElementById("modal-close-btn").addEventListener("click", () => dialogEl.close());
    dialogEl.showModal();
  }

  function partyLabel(code) {
    return { D: "Democrat", R: "Republican", I: "Independent" }[code] || code || "";
  }

  return { init, show };
})();
