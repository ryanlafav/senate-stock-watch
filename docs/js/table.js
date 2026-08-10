// Generic sortable table renderer. Data volumes here are small (low
// thousands of rows at most), so everything sorts/filters client-side with
// no pagination library needed.
const TableRenderer = (() => {
  function renderHead(headEl, columns, sortKey, sortDir, onSort) {
    const tr = document.createElement("tr");
    columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.label;
      if (col.className) th.className = col.className;
      if (col.sortable) {
        th.dataset.sortable = "true";
        th.setAttribute("role", "button");
        th.setAttribute("tabindex", "0");
        th.setAttribute(
          "aria-sort",
          col.key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none"
        );
        if (col.key === sortKey) {
          const arrow = document.createElement("span");
          arrow.className = "sort-arrow";
          arrow.textContent = sortDir === "asc" ? "▲" : "▼";
          th.appendChild(arrow);
        }
        th.addEventListener("click", () => onSort(col.key));
        th.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSort(col.key);
          }
        });
      }
      tr.appendChild(th);
    });
    headEl.replaceChildren(tr);
  }

  function renderBody(bodyEl, columns, rows, onRowClick) {
    const frag = document.createDocumentFragment();
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      columns.forEach((col) => {
        const td = document.createElement("td");
        if (col.className) td.className = col.className;
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
        tr.addEventListener("keydown", (e) => {
          if (e.key === "Enter") onRowClick(row);
        });
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
