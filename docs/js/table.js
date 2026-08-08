// Generic sortable table renderer. Data volumes here are small (low
// thousands of rows at most), so everything sorts/filters client-side with
// no pagination library needed.
const TableRenderer = (() => {
  function renderHead(headEl, columns, sortKey, sortDir, onSort) {
    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.label;
      if (col.sortable) {
        if (col.key === sortKey) {
          const arrow = document.createElement("span");
          arrow.className = "sort-arrow";
          arrow.textContent = sortDir === "asc" ? "▲" : "▼";
          th.appendChild(arrow);
        }
        th.addEventListener("click", () => onSort(col.key));
      }
      tr.appendChild(th);
    });
    headEl.replaceChildren(tr);
  }

  function renderBody(bodyEl, columns, rows, onRowClick) {
    const frag = document.createDocumentFragment();
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      columns.forEach((col) => {
        const td = document.createElement("td");
        const content = col.render(row);
        if (content instanceof Node) {
          td.appendChild(content);
        } else {
          td.textContent = content;
        }
        tr.appendChild(td);
      });
      if (onRowClick) {
        tr.addEventListener("click", () => onRowClick(row));
      }
      frag.appendChild(tr);
    });
    bodyEl.replaceChildren(frag);
  }

  function sortRows(rows, columns, sortKey, sortDir) {
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const sorted = [...rows].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }

  return { renderHead, renderBody, sortRows };
})();
