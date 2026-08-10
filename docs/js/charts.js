// Small SVG chart builders. Deliberately dependency-free: the volumes here are
// tiny (a dozen months, a dozen categories) so there's nothing a charting
// library would buy us that's worth a bundle and a build step.
//
// Mark specs follow one house style throughout: 2px lines, >=8px end markers
// with a 2px surface ring, 4px rounded data-ends on bars, hairline gridlines,
// and labels that never wear the series color.
const Charts = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const fmt = new Intl.NumberFormat("en-US");

  function node(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // Round a max up to a clean axis bound. The ladder is deliberately fine
  // (not just 1/2/5) so a peak of 754 gets an 800 axis rather than 1,000 -
  // coarse rounding leaves the tallest mark stranded in empty headroom.
  const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

  function niceMax(value) {
    if (!(value > 0)) return 10;
    const pow = Math.pow(10, Math.floor(Math.log10(value)));
    const frac = value / pow;
    return (NICE_STEPS.find((s) => frac <= s) ?? 10) * pow;
  }

  function axisTicks(max, count = 4) {
    const out = [];
    for (let i = 0; i <= count; i++) out.push((max / count) * i);
    return out;
  }

  // Rounded-top bar: 4px radius on the data-end, square at the baseline.
  function barPath(x, baselineY, width, height, radius = 4) {
    const r = Math.max(0, Math.min(radius, height, width / 2));
    const top = baselineY - height;
    return `M${x} ${top + r}a${r} ${r} 0 0 1 ${r} ${-r}h${width - 2 * r}` +
           `a${r} ${r} 0 0 1 ${r} ${r}v${height - r}h${-width}Z`;
  }

  function positionTip(tip, host, xRatio, yRatio) {
    const box = host.getBoundingClientRect();
    tip.style.left = `${Math.min(0.88, Math.max(0.12, xRatio)) * box.width}px`;
    tip.style.top = `${yRatio * box.height - 10}px`;
    tip.style.opacity = "1";
  }

  function hideTip(tip) { tip.style.opacity = "0"; }

  /**
   * Multi-series line chart over a shared category axis.
   * data:   [{ label, sublabel, <seriesKey>: number, ... }]
   * series: [{ key, color, label }]
   */
  function lineChart(host, tip, { data, series }) {
    const tooltip = tip || host.querySelector(".tooltip");
    host.querySelectorAll("svg").forEach((s) => s.remove());
    if (!data.length) return;

    const W = 700, H = 208, padL = 40, padR = 52, padT = 14, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const rawMax = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
    const max = niceMax(rawMax);
    const x = (i) => (data.length === 1 ? padL + plotW / 2 : padL + (plotW / (data.length - 1)) * i);
    const y = (v) => padT + plotH - (v / max) * plotH;

    const svg = node("svg", {
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": `${series.map((s) => s.label).join(" and ")} by month`,
    });

    const defs = node("defs");
    series.forEach((s, i) => {
      const g = node("linearGradient", { id: `snap-grad-${i}`, x1: 0, y1: 0, x2: 0, y2: 1 });
      g.appendChild(node("stop", { offset: "0%", "stop-color": s.color, "stop-opacity": 0.22 }));
      g.appendChild(node("stop", { offset: "100%", "stop-color": s.color, "stop-opacity": 0 }));
      defs.appendChild(g);
    });
    svg.appendChild(defs);

    axisTicks(max).forEach((t) => {
      svg.appendChild(node("line", {
        x1: padL, x2: W - padR, y1: y(t), y2: y(t),
        class: t === 0 ? "baseline" : "gridline",
      }));
      const label = node("text", { x: padL - 8, y: y(t) + 4, "text-anchor": "end", class: "tick" });
      label.textContent = fmt.format(Math.round(t));
      svg.appendChild(label);
    });

    series.forEach((s, si) => {
      const pts = data.map((d, i) => [x(i), y(d[s.key] || 0)]);

      if (pts.length > 1) {
        const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
        const area = `${line} L${pts.at(-1)[0].toFixed(1)} ${padT + plotH} L${pts[0][0].toFixed(1)} ${padT + plotH}Z`;
        svg.appendChild(node("path", { d: area, fill: `url(#snap-grad-${si})` }));
        svg.appendChild(node("path", {
          d: line, fill: "none", stroke: s.color, "stroke-width": 2,
          "stroke-linejoin": "round", "stroke-linecap": "round",
        }));
      }

      // End marker carries a 2px surface ring so overlapping series stay legible.
      const last = pts.at(-1);
      svg.appendChild(node("circle", {
        cx: last[0], cy: last[1], r: 4.5,
        fill: s.color, stroke: "var(--surface)", "stroke-width": 2,
      }));
      const endLabel = node("text", { x: last[0] + 10, y: last[1] + 4, class: "dlabel" });
      endLabel.textContent = fmt.format(data.at(-1)[s.key] || 0);
      svg.appendChild(endLabel);
    });

    // Label the peak of the leading series only - sparing direct labels.
    const lead = series[0];
    let peak = 0;
    data.forEach((d, i) => { if ((d[lead.key] || 0) > (data[peak][lead.key] || 0)) peak = i; });
    if (peak !== data.length - 1 && (data[peak][lead.key] || 0) > 0) {
      const pk = node("text", { x: x(peak), y: y(data[peak][lead.key]) - 10, "text-anchor": "middle", class: "dlabel" });
      pk.textContent = fmt.format(data[peak][lead.key]);
      svg.appendChild(pk);
    }

    const crosshair = node("line", {
      y1: padT, y2: padT + plotH, stroke: "var(--hair-2)", "stroke-width": 1, opacity: 0,
    });
    svg.appendChild(crosshair);

    const band = data.length === 1 ? plotW : plotW / (data.length - 1);
    data.forEach((d, i) => {
      const label = node("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "tick-strong" });
      label.textContent = d.label;
      svg.appendChild(label);

      const hit = node("rect", {
        x: x(i) - band / 2, y: padT, width: band, height: plotH, fill: "transparent",
      });
      const showTip = () => {
        crosshair.setAttribute("x1", x(i));
        crosshair.setAttribute("x2", x(i));
        crosshair.setAttribute("opacity", 1);
        tooltip.innerHTML =
          `<div class="tt-t">${d.sublabel || d.label}</div>` +
          series.map((s) =>
            `<div class="tt-r"><span class="swatch" style="background:${s.color}"></span>` +
            `${s.label} <b>${fmt.format(d[s.key] || 0)}</b></div>`).join("");
        positionTip(tooltip, host, x(i) / W, y(d[lead.key] || 0) / H);
      };
      hit.addEventListener("mouseenter", showTip);
      hit.addEventListener("mouseleave", () => {
        hideTip(tooltip);
        crosshair.setAttribute("opacity", 0);
      });
      svg.appendChild(hit);
    });

    host.insertBefore(svg, tooltip);
  }

  /**
   * Horizontal bar rows with the category name in a left gutter.
   * rows: [{ name, value, color, meta }]
   */
  function barRows(host, tip, { rows, gutter = 306 }) {
    const tooltip = tip || host.querySelector(".tooltip");
    host.querySelectorAll("svg").forEach((s) => s.remove());
    if (!rows.length) return;

    const rowH = 23, padR = 44, padT = 6;
    const W = 700, H = padT + rowH * rows.length + 22;
    const plotW = W - gutter - padR;
    const max = niceMax(Math.max(1, ...rows.map((r) => r.value)));

    const svg = node("svg", {
      viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Flags by mapped committee category",
    });

    [0, max / 2, max].forEach((t) => {
      const gx = gutter + (t / max) * plotW;
      svg.appendChild(node("line", {
        x1: gx, x2: gx, y1: padT, y2: padT + rowH * rows.length,
        class: t === 0 ? "baseline" : "gridline",
      }));
      const label = node("text", { x: gx, y: H - 6, "text-anchor": "middle", class: "tick" });
      label.textContent = fmt.format(Math.round(t));
      svg.appendChild(label);
    });

    rows.forEach((r, i) => {
      const cy = padT + rowH * i + rowH / 2;

      const name = node("text", {
        x: gutter - 12, y: cy + 4, "text-anchor": "end",
        class: r.value ? "tick-strong" : "tick",
      });
      name.textContent = r.name;
      svg.appendChild(name);

      const barH = 11, w = (r.value / max) * plotW;
      if (w > 0) {
        const rr = Math.min(4, w / 2);
        svg.appendChild(node("path", {
          d: `M${gutter} ${cy - barH / 2}h${w - rr}a${rr} ${rr} 0 0 1 ${rr} ${rr}` +
             `v${barH - 2 * rr}a${rr} ${rr} 0 0 1 ${-rr} ${rr}h${-(w - rr)}Z`,
          fill: r.color,
        }));
        const val = node("text", { x: gutter + w + 9, y: cy + 4, class: "dlabel" });
        val.textContent = fmt.format(r.value);
        svg.appendChild(val);
      } else {
        svg.appendChild(node("rect", {
          x: gutter, y: cy - 1.5, width: plotW, height: 3, rx: 1.5, fill: "var(--grid)",
        }));
      }

      const hit = node("rect", { x: 0, y: padT + rowH * i, width: W, height: rowH, fill: "transparent" });
      hit.addEventListener("mouseenter", () => {
        tooltip.innerHTML =
          `<div class="tt-t">${r.name}</div>` +
          `<div class="tt-r">Flags <b>${fmt.format(r.value)}</b></div>` +
          (r.meta ? `<div class="tt-r">${r.meta}</div>` : "");
        positionTip(tooltip, host, (gutter + Math.max(w, 40)) / W, (padT + rowH * i) / H);
      });
      hit.addEventListener("mouseleave", () => hideTip(tooltip));
      svg.appendChild(hit);
    });

    host.insertBefore(svg, tooltip);
  }

  /**
   * Proportional segmented track. segments: [{ value, color, label }]
   * A 2px surface gap separates neighbours (from the .track flex gap).
   */
  function track(el, segments) {
    const total = segments.reduce((a, s) => a + s.value, 0);
    el.replaceChildren();
    segments.forEach((s) => {
      if (!s.value) return;
      const seg = document.createElement("i");
      seg.style.flex = `${s.value} 1 0`;
      seg.style.background = s.color;
      seg.title = `${s.label}: ${fmt.format(s.value)} (${Math.round((s.value / total) * 100)}%)`;
      el.appendChild(seg);
    });
  }

  return { lineChart, barRows, track, niceMax };
})();
