/* Private visit counter for davidfeuling.com.
   Every page loads this with:  <script src="/visits.js" async></script>
   A page counts once per browser tab session (reloads don't add up).
   Counts are kept for today, this week, this month and lifetime,
   using New York time. Typing ttttt on the main page downloads a
   .txt report of every page's counts. */
(() => {
  const NS = "davidfeuling-com";
  const API = "https://abacus.jasoncameron.dev";
  const TZ = "America/New_York";
  const STARTED = "2026-11-15";

  // Extra pages that aren't cards on the main page can be listed here.
  const EXTRA_PAGES = [];

  const pad = n => String(n).padStart(2, "0");
  const nyDate = (t = Date.now()) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day };
  };
  const isoWeek = ({ y, m, d }) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    return { y: dt.getUTCFullYear(), w: Math.ceil(((dt - y0) / 864e5 + 1) / 7) };
  };
  const shift = ({ y, m, d }, days) => {
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  };
  const dayKey = t => `d${t.y}${pad(t.m)}${pad(t.d)}`;
  const weekKey = t => { const w = isoWeek(t); return `w${w.y}${pad(w.w)}`; };
  const monthKey = t => `m${t.y}${pad(t.m)}`;

  // "/" -> home, "/zippy/" -> zippy, "/a/b.html" -> a_b
  const slugOf = path => {
    const s = path.replace(/index\.html?$/i, "").replace(/\.html?$/i, "")
      .split("/").filter(Boolean).join("_").replace(/[^A-Za-z0-9_-]/g, "-").toLowerCase();
    return (s || "home").slice(0, 40);
  };
  const key = (slug, period) => `${slug}_${period}`;

  // ---- count this visit ----
  try {
    const slug = slugOf(location.pathname);
    const seen = "visit-counted:" + slug;
    let counted = false;
    try { counted = sessionStorage.getItem(seen) === "1"; } catch {}
    if (!counted && !/^(localhost|127\.)/.test(location.hostname)) {
      try { sessionStorage.setItem(seen, "1"); } catch {}
      const t = nyDate();
      for (const p of ["all", dayKey(t), weekKey(t), monthKey(t)])
        fetch(`${API}/hit/${NS}/${key(slug, p)}`, { mode: "cors", keepalive: true }).catch(() => {});
    }
  } catch {}

  // ---- ttttt report (main page only) ----
  if (slugOf(location.pathname) !== "home") return;

  const getCount = async k => {
    try {
      const r = await fetch(`${API}/get/${NS}/${k}`);
      if (!r.ok) return 0;
      return (await r.json()).value || 0;
    } catch { return null; }
  };

  const pages = () => {
    const set = new Set(["home", ...EXTRA_PAGES]);
    document.querySelectorAll("a[href]").forEach(a => {
      const u = new URL(a.href, location.href);
      if (u.origin === location.origin && u.pathname !== "/") set.add(slugOf(u.pathname));
    });
    return [...set];
  };

  const buildReport = async () => {
    const t = nyDate(), yd = shift(t, -1), lw = shift(t, -7);
    const lm = t.m === 1 ? { y: t.y - 1, m: 12, d: 1 } : { y: t.y, m: t.m - 1, d: 1 };
    const cols = [
      ["TODAY", dayKey(t)], ["YESTERDAY", dayKey(yd)],
      ["THIS WEEK", weekKey(t)], ["LAST WEEK", weekKey(lw)],
      ["THIS MONTH", monthKey(t)], ["LAST MONTH", monthKey(lm)],
      ["LIFETIME", "all"],
    ];
    const list = pages();
    const jobs = [];
    for (const s of list) for (const [, p] of cols) jobs.push([s, p]);
    const vals = {};
    for (let i = 0; i < jobs.length; i += 24) {
      const batch = jobs.slice(i, i + 24);
      const got = await Promise.all(batch.map(([s, p]) => getCount(key(s, p))));
      batch.forEach(([s, p], j) => (vals[key(s, p)] = got[j]));
    }
    const w = Math.max(8, ...list.map(s => s.length)) + 2;
    const cw = 12;
    const row = (name, cells) => name.padEnd(w) + cells.map(c => String(c).padStart(cw)).join("");
    const totals = cols.map(() => 0);
    let failed = false;
    const lines = list.map(s => row(s, cols.map(([, p], i) => {
      const v = vals[key(s, p)];
      if (v === null) { failed = true; return "?"; }
      totals[i] += v; return v;
    })));
    const now = new Date().toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
    const wk = isoWeek(t);
    return [
      "davidfeuling.com visit counts",
      `Generated ${now} (New York time). Counting started ${STARTED}.`,
      `Today = ${t.y}-${pad(t.m)}-${pad(t.d)}; weeks run Monday-Sunday (this is week ${wk.w} of ${wk.y}).`,
      "A visit = one page load per browser tab session; reloads in the same tab aren't counted again.",
      failed ? "? = the counter service didn't answer for that cell; try again later." : "",
      "",
      row("PAGE", cols.map(c => c[0])),
      "-".repeat(w + cw * cols.length),
      ...lines,
      "-".repeat(w + cw * cols.length),
      row("TOTAL", totals),
      "",
    ].filter((l, i) => l !== "" || i > 4).join("\r\n");
  };

  const download = (text, name) => {
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: name,
    });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  let buf = "", busy = false;
  document.addEventListener("keydown", async e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    buf = (buf + (e.key || "").toLowerCase()).slice(-5);
    if (buf !== "ttttt" || busy) return;
    buf = ""; busy = true;
    const note = Object.assign(document.createElement("div"), { textContent: "Preparing visit report\u2026" });
    note.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9999;padding:8px 12px;border-radius:8px;" +
      "background:#26222b;color:#fff;font:13px system-ui,sans-serif;opacity:.9";
    document.body.append(note);
    try {
      const t = nyDate();
      download(await buildReport(), `davidfeuling-visits-${t.y}-${pad(t.m)}-${pad(t.d)}.txt`);
    } finally { busy = false; note.remove(); }
  });
})();
