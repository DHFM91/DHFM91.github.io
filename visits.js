/* Private visit counter for davidfeuling.com.
   Every page loads this with:  <script src="/visits.js" async></script>
   A page counts once per browser tab session (reloads don't add up).
   Counts are kept for today, this week, this month and lifetime,
   using New York time. Typing ttttt on the main page downloads an
   Excel (.xlsx) report of every page's counts with a bar chart. */
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

  // The free counter service refuses big bursts ("429 Too Many Requests"),
  // so lookups go out a few at a time, each one gives up after a few seconds,
  // and refused ones wait and retry. 404 = that counter was never hit = 0.
  // Anything that still fails comes back null (a blank cell), never a fake 0.
  const CONCURRENCY = 4, TIMEOUT_MS = 8000, RETRIES = 3;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const getCount = async k => {
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const r = await fetch(`${API}/get/${NS}/${k}`, { signal: ctl.signal });
        if (r.status === 404) return 0;
        if (r.ok) return (await r.json()).value || 0;
        if (r.status !== 429 && r.status < 500) return null;
      } catch {
        // timed out or network error: fall through and retry
      } finally { clearTimeout(timer); }
      if (attempt < RETRIES) await sleep(1000 * 2 ** attempt + Math.random() * 500);
    }
    return null;
  };

  const pages = () => {
    const set = new Set(["home", ...EXTRA_PAGES]);
    document.querySelectorAll("a[href]").forEach(a => {
      const u = new URL(a.href, location.href);
      if (u.origin === location.origin && u.pathname !== "/") set.add(slugOf(u.pathname));
    });
    return [...set];
  };

  const COLS = ["Today", "This week", "This month", "Lifetime"];

  const gather = async (onProgress = () => {}) => {
    const t = nyDate();
    const periods = [dayKey(t), weekKey(t), monthKey(t), "all"];
    const list = pages();
    const jobs = [];
    for (const s of list) for (const p of periods) jobs.push(key(s, p));
    const vals = {};
    let next = 0, done = 0;
    onProgress(0, jobs.length);
    const worker = async () => {
      while (next < jobs.length) {
        const k = jobs[next++];
        vals[k] = await getCount(k);
        onProgress(++done, jobs.length);
        await sleep(150);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const rows = list.map(s => [s, ...periods.map(p => vals[key(s, p)])]);
    const wk = isoWeek(t);
    return { t, wk, rows, failed: rows.some(r => r.includes(null)) };
  };

  /* ---- tiny .xlsx writer (uncompressed zip, one sheet, one bar chart) ---- */
  const CRC = (() => {
    const tb = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; }
    return b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = tb[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  })();
  const zip = files => {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    const d = new Date();
    const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, text] of files) {
      const nm = enc.encode(name), data = enc.encode(text), crc = CRC(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(10, dosT, true); h.setUint16(12, dosD, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(h.buffer, nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(12, dosT, true); c.setUint16(14, dosD, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true);
      c.setUint32(42, off, true);
      central.push(c.buffer, nm);
      off += 30 + nm.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };

  const xmlEsc = v => String(v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const colL = i => String.fromCharCode(65 + i);

  const buildXlsx = ({ t, wk, rows, failed }) => {
    const now = new Date().toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
    const HEAD = 6, first = HEAD + 1, last = HEAD + rows.length, tot = last + 1;
    const str = (r, c, v, s = 0) => `<c r="${colL(c)}${r}" t="inlineStr"${s ? ` s="${s}"` : ""}><is><t>${xmlEsc(v)}</t></is></c>`;
    const num = (r, c, v, s = 0) => v === null ? "" : `<c r="${colL(c)}${r}"${s ? ` s="${s}"` : ""}><v>${v}</v></c>`;
    const sheetRows = [
      `<row r="1">${str(1, 0, "davidfeuling.com visit counts", 1)}</row>`,
      `<row r="2">${str(2, 0, `Generated ${now} (New York time). Counting started ${STARTED}.`)}</row>`,
      `<row r="3">${str(3, 0, `Today = ${t.y}-${pad(t.m)}-${pad(t.d)}. Weeks run Monday-Sunday (this is week ${wk.w} of ${wk.y}).`)}</row>`,
      `<row r="4">${str(4, 0, "A visit = one page load per browser tab session; reloads in the same tab aren't counted again.")}</row>`,
      failed ? `<row r="5">${str(5, 0, "Blank cells = the counter service didn't answer; try again later.")}</row>` : "",
      `<row r="${HEAD}">${["Page", ...COLS].map((h, c) => str(HEAD, c, h, 2)).join("")}</row>`,
      ...rows.map((r, i) => `<row r="${first + i}">${str(first + i, 0, r[0])}${r.slice(1).map((v, c) => num(first + i, c + 1, v)).join("")}</row>`),
      `<row r="${tot}">${str(tot, 0, "TOTAL", 2)}${COLS.map((_, c) =>
        `<c r="${colL(c + 1)}${tot}" s="2"><f>SUM(${colL(c + 1)}${first}:${colL(c + 1)}${last})</f><v>${rows.reduce((a, r) => a + (r[c + 1] || 0), 0)}</v></c>`).join("")}</row>`,
    ].join("");
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${HEAD}" topLeftCell="A${first}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="5" width="12" customWidth="1"/></cols>
<sheetData>${sheetRows}</sheetData><drawing r:id="rId1"/></worksheet>`;

    // chart: horizontal bars of This week / This month / Lifetime per page
    const series = [[2, "This week", "8FB8DE"], [3, "This month", "4A7FB0"], [4, "Lifetime", "26425E"]];
    const cat = `<c:cat><c:strRef><c:f>Visits!$A$${first}:$A$${last}</c:f><c:strCache><c:ptCount val="${rows.length}"/>${rows.map((r, i) => `<c:pt idx="${i}"><c:v>${xmlEsc(r[0])}</c:v></c:pt>`).join("")}</c:strCache></c:strRef></c:cat>`;
    const ser = series.map(([c, name, color], i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>
<c:tx><c:strRef><c:f>Visits!$${colL(c)}$${HEAD}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${cat}
<c:val><c:numRef><c:f>Visits!$${colL(c)}$${first}:$${colL(c)}$${last}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${rows.length}"/>${rows.map((r, j) => r[c] === null ? "" : `<c:pt idx="${j}"><c:v>${r[c]}</c:v></c:pt>`).join("")}</c:numCache></c:numRef></c:val></c:ser>`).join("");
    const chart = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Visits by page</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}
<c:gapWidth val="60"/><c:axId val="111"/><c:axId val="222"/></c:barChart>
<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:numFmt formatCode="0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="111"/><c:crosses val="max"/><c:crossBetween val="between"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
    const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
<xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${HEAD - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.max(HEAD + 22, tot + 2)}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Visits chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
    const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const rels = items => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;
    return zip([
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`],
      ["_rels/.rels", rels([["rId1", `${R}/officeDocument`, "xl/workbook.xml"]])],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets><sheet name="Visits" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", rels([["rId1", `${R}/worksheet`, "worksheets/sheet1.xml"], ["rId2", `${R}/styles`, "styles.xml"]])],
      ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
      ["xl/worksheets/sheet1.xml", sheet],
      ["xl/worksheets/_rels/sheet1.xml.rels", rels([["rId1", `${R}/drawing`, "../drawings/drawing1.xml"]])],
      ["xl/drawings/drawing1.xml", drawing],
      ["xl/drawings/_rels/drawing1.xml.rels", rels([["rId1", `${R}/chart`, "../charts/chart1.xml"]])],
      ["xl/charts/chart1.xml", chart],
    ]);
  };

  const download = (blob, name) => {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
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
    let keepNote = false;
    try {
      const t = nyDate();
      const data = await gather((d, n) => { note.textContent = `Preparing visit report… ${d}/${n}`; });
      download(buildXlsx(data), `davidfeuling-visits-${t.y}-${pad(t.m)}-${pad(t.d)}.xlsx`);
      if (data.failed) {
        note.textContent = "Report downloaded, but the counter service skipped some cells (left blank). Try again in a few minutes.";
        keepNote = true;
      }
    } catch (err) {
      note.textContent = "Visit report failed: " + (err && err.message || err);
      keepNote = true;
    } finally {
      busy = false;
      if (keepNote) setTimeout(() => note.remove(), 8000); else note.remove();
    }
  });
})();
