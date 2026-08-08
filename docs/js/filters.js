// Filter bar logic. Operates on normalized row shapes built in app.js (both
// the Flagged and All Trades views expose the same senatorName/party/state/
// ticker/committeeId/confidence fields so one predicate works for both).
const Filters = (() => {
  function buildSelectOptions(selectEl, items, placeholderLabel) {
    const current = selectEl.value;
    const frag = document.createDocumentFragment();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = placeholderLabel;
    frag.appendChild(placeholder);
    items.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      frag.appendChild(opt);
    });
    selectEl.replaceChildren(frag);
    if (items.some((i) => i.value === current)) {
      selectEl.value = current;
    }
  }

  function apply(rows, filters) {
    const search = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.committee && row.committeeId !== filters.committee) return false;
      if (filters.party && row.party !== filters.party) return false;
      if (filters.state && row.state !== filters.state) return false;
      if (filters.highConfidenceOnly && row.confidence !== "high") return false;
      if (search) {
        const haystack = `${row.senatorName || ""} ${row.ticker || ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  return { buildSelectOptions, apply };
})();
