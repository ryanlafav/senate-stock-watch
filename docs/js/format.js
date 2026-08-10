// Formatting helpers shared by the dashboard and the table views, so a
// senator's initials or a committee's short name never render two different
// ways on the same page.
const Format = (() => {
  const numberFmt = new Intl.NumberFormat("en-US");

  const number = (v) => numberFmt.format(v ?? 0);

  // Filed amounts are ranges, never exact, so every total built from them is an
  // estimate. Callers are responsible for labelling it as one.
  function compactMoney(v) {
    if (!v) return "$0";
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
    return `$${Math.round(v)}`;
  }

  function midpoint(trade) {
    const lo = trade.amount_range_min ?? 0;
    const hi = trade.amount_range_max ?? lo;
    return (lo + hi) / 2;
  }

  function initials(name) {
    return (name || "?")
      .split(" ")
      .filter((w) => w.length > 1)
      .slice(0, 2)
      .map((w) => w[0])
      .join("");
  }

  // "Senate Committee on Health, Education, Labor, and Pensions" is three lines
  // in a table cell and adds nothing - the chamber is implied by the whole site.
  function shortCommittee(name) {
    return (name || "")
      .replace(/^(United States )?Senate (Select |Special )?Committee on (the )?/i, "")
      .replace(/^(United States )?Senate Caucus on /i, "")
      .replace(/^Senate Select Committee on /i, "");
  }

  function daysBetween(isoStart, isoEnd) {
    const ms = new Date(`${isoEnd}T00:00:00Z`) - new Date(`${isoStart}T00:00:00Z`);
    return Math.round(ms / 86_400_000);
  }

  return { number, compactMoney, midpoint, initials, shortCommittee, daysBetween };
})();
