// Batch Detail (production batch coding): rules and the one-time reader for the old "Batch Detail" Google Sheet.
import { makeReaders, todayISO } from "./qc";

export const KINDS = { other: "Other than tubes", tube: "Tubes only" };
export const MARKETS = ["Nepal", "Yemen", "Export", "Philippines"];

// A batch number compared loosely: capitals, dashes and leading zeros do not matter ("V-001A" = "v001a", "003" = "3").
export const normBatch = (b) => String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^([a-z]*)0+(?=\d)/, "$1");
// "V-001A" -> "V-001" (the mother batch number without its letter)
export const groupOf = (b) => String(b || "").trim().replace(/([0-9])[A-Za-z]$/, "$1");
export const letterOf = (b) => { const m = String(b || "").trim().match(/[0-9]([A-Za-z])$/); return m ? m[1].toUpperCase() : null; };
export const monthKeyOf = (iso) => (iso ? iso.slice(0, 7) : null);

export { expiryFor, shelfOf, lastShelfMonths, uspFor, parsePack, packFromName, lastPack, packText } from "./batchCalc";

// "(1000pc)", "85kg (4250pcs)", "(100kg)3333pcs", "200kg(6666pcs)" -> batch size, unit and pieces; also gives the text with them removed
export function parseQty(text) {
  let t = String(text || ""); let size = null, unit = null, pieces = null;
  const num = (s) => Number(String(s).replace(/,/g, ""));
  let m = t.match(/\(?\s*(\d+(?:\.\d+)?)\s*(kg|ltrs?|lits?|litres?|liters?|lt)\s*\)?\s*\(?\s*([\d,]+)\s*(?:pcs?|pieces)\s*\)?/i);
  if (m) { size = num(m[1]); unit = /^k/i.test(m[2]) ? "kg" : "ltr"; pieces = num(m[3]); t = t.replace(m[0], " "); }
  else if ((m = t.match(/\(?\s*([\d,]+)\s*(?:pcs?|pieces)\s*\)?/i))) { pieces = num(m[1]); t = t.replace(m[0], " "); }
  if (size == null && (m = t.match(/\(\s*(\d+(?:\.\d+)?)\s*(kg|ltrs?|lits?|litres?|liters?)\s*\)/i))) { size = num(m[1]); unit = /^k/i.test(m[2]) ? "kg" : "ltr"; t = t.replace(m[0], " "); }
  return { size, unit, pieces, rest: t.replace(/\s+/g, " ").replace(/[\s\-–:,.]+$/, "").trim() };
}
export function detectMarket(text) {
  const t = String(text || "").toLowerCase();
  if (/nepal|npr/.test(t)) return "Nepal"; if (/yemen/.test(t)) return "Yemen"; if (/\bphp\b|philip/.test(t)) return "Philippines"; if (/export/.test(t)) return "Export";
  return null;
}

// The remarks of a mother batch (V-001A) often hold the child batches (V-001B, V-001C) as free text:
//   "CLOBISOL S LOTION 25ML (3000pc)\nB.NO.- V-001B\nMFG- 01/25 EXP- 12/26\nMRP- 132.00 /-"
// Returns the children found and the text that is left over.
export function parseChildren(remark, motherBatch) {
  const text = String(remark || "");
  const root = parseInt((String(motherBatch).match(/(\d+)[A-Za-z]?$/) || [])[1], 10);
  if (!text || !Number.isFinite(root)) return { children: [], leftover: text.trim() };
  const motherLetter = letterOf(motherBatch);
  const rx = /(?<![A-Za-z0-9])(?:V)?[-.\s]*\.?\s*(\d{2,4})([A-Za-z])(?![A-Za-z0-9])/g;
  const toks = [];
  for (let m; (m = rx.exec(text)); ) if (parseInt(m[1], 10) === root) toks.push({ start: m.index, end: m.index + m[0].length, letter: m[2].toUpperCase() });
  if (!toks.length) return { children: [], leftover: text.trim() };
  const mrpRx = /MRP[\s:\-.]*(?:Rs\.?)?\s*([\d,]+(?:\.\d+)?)(?:\s*\/-)?/gi;
  const mrps = []; for (let m; (m = mrpRx.exec(text)); ) mrps.push({ start: m.index, end: m.index + m[0].length, value: Number(m[1].replace(/,/g, "")) });
  const children = []; const used = []; let prevEnd = 0;
  toks.forEach((t, i) => {
    const nextStart = i + 1 < toks.length ? toks[i + 1].start : text.length;
    const mrp = mrps.find((x) => x.start >= t.end && x.start < nextStart);
    const entryEnd = mrp ? mrp.end : t.end;
    const pre = text.slice(prevEnd, t.start); const post = text.slice(t.end, entryEnd);
    used.push([prevEnd, entryEnd]); prevEnd = entryEnd;
    if (t.letter === motherLetter) return;                       // the mother's own line repeated in the remarks
    const mfg = (post.match(/mfg[\s:\-.]*(\d{1,2})\s*\/\s*(\d{2,4})/i) || []);
    const exp = (post.match(/exp[\s:\-.]*(\d{1,2})\s*\/\s*(\d{2,4})/i) || []);
    const ym = (mm, yy) => { if (!mm) return null; const y = yy.length === 2 ? 2000 + +yy : +yy; return `${y}-${String(+mm).padStart(2, "0")}-01`; };
    const q = parseQty(pre.replace(/B\.?\s*NO\.?|BNO|BATCH\s*NO\.?/gi, " "));
    const product = q.rest.replace(/^[\s\-–:,.]+/, "").replace(/\s*[-–:]\s*$/, "").trim();
    const prefix = String(motherBatch).replace(/\d+[A-Za-z]?$/, "");
    const digits = (String(motherBatch).match(/(\d+)[A-Za-z]?$/) || [])[1];
    children.push({ letter: t.letter, batch_no: `${prefix}${digits}${t.letter}`, product_name: product, pieces: q.pieces, batch_size: q.size, batch_size_unit: q.unit, mfg: ym(mfg[1], mfg[2] || ""), exp: ym(exp[1], exp[2] || ""), mrp: mrp ? mrp.value : null });
  });
  let left = text; used.slice().reverse().forEach(([a, b]) => { left = left.slice(0, a) + " " + left.slice(b); });
  return { children, leftover: left.replace(/\s+/g, " ").replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, "").trim() };
}

// ── the sheet ──────────────────────────────────────────────────────────────
const TABS = [
  { name: "VP_BATCH_CODING_OTHER_THAN_TUBE", firm: "VP", kind: "other", hdr: 2, c: { item: 1, mfg: 3, exp: 4, mrp: 5, batch: 6, rem: 7 } },
  { name: "VP_BATCH_CODING_TUBES", firm: "VP", kind: "tube", hdr: 2, c: { item: 1, mfg: 2, exp: 3, mrp: 4, batch: 5, rem: 6 } },
  { name: "VH_BATCH_CODING_OTHER_THAN_TUBE", firm: "VH", kind: "other", hdr: 2, c: { item: 1, pack: 2, mfg: 4, exp: 5, mrp: 6, usp: 7, batch: 8, rem: 9 } },
  { name: "VH_BATCH_CODING_TUBES", firm: "VH", kind: "tube", hdr: 2, c: { item: 1, pack: 2, mfg: 3, exp: 4, mrp: 5, usp: 6, batch: 7, rem: 8 } },
];
const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const numOf = (c) => { if (!c) return null; if (typeof c.v === "number") return c.v; const n = Number(String(c.w ?? c.v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function readBatchSheet(XLSX, buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellNF: true, cellText: true });
  const R = makeReaders(XLSX);
  const thisMonth = todayISO().slice(0, 7) + "-01";
  const out = []; const notes = [];
  for (const tab of TABS) {
    const key = wb.SheetNames.find((n) => n.trim() === tab.name);
    if (!key) { notes.push(`Tab "${tab.name}" not found`); continue; }
    const ws = wb.Sheets[key]; const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    for (let r = tab.hdr; r <= range.e.r; r++) {
      const cell = (c) => ws[XLSX.utils.encode_cell({ r, c })];
      const itemRaw = clean(cell(tab.c.item) && (cell(tab.c.item).w ?? cell(tab.c.item).v));
      if (!itemRaw) continue;
      const fl = [];
      const batch = clean(cell(tab.c.batch) && (cell(tab.c.batch).w ?? cell(tab.c.batch).v));
      if (!batch || /^[A-Za-z]*-?$/.test(batch)) continue;         // reserved serials with no product
      const mfg = R.month(cell(tab.c.mfg), fl, "Mfg"), exp = R.month(cell(tab.c.exp), fl, "Exp");
      const rem = String(cell(tab.c.rem) ? (cell(tab.c.rem).w ?? cell(tab.c.rem).v ?? "") : "").trim();
      const q = parseQty(itemRaw);
      const base = {
        firm_id: tab.firm, kind: tab.kind, product_name: q.rest || itemRaw, pack_size: tab.c.pack != null ? clean(cell(tab.c.pack) && (cell(tab.c.pack).w ?? cell(tab.c.pack).v)) || null : null,
        mfg, exp, mrp: numOf(cell(tab.c.mrp)), usp: tab.c.usp != null ? numOf(cell(tab.c.usp)) : null, batch_no: batch, group_no: groupOf(batch),
        series_year: mfg ? +mfg.slice(0, 4) : null, status: mfg && mfg > thisMonth ? "planned" : "made",
        batch_size: q.size, batch_size_unit: q.unit, pieces: q.pieces, entered_on: mfg && mfg < todayISO() ? mfg : todayISO(),
      };
      const { children, leftover } = parseChildren(rem, batch);
      const rq = parseQty(leftover);
      const mother = { ...base, child_letter: letterOf(batch), market: detectMarket(rem), remarks_original: rem || null, note: (rq.rest && !/^(nepal|yemen|npr|php|export)$/i.test(rq.rest) ? leftover : null) || null };
      if (rq.pieces != null && mother.pieces == null) mother.pieces = rq.pieces;
      if (rq.size != null && mother.batch_size == null) { mother.batch_size = rq.size; mother.batch_size_unit = rq.unit; }
      if (!mfg) fl.push("no manufacturing month"); else if (!exp) fl.push("no expiry month");
      if (mfg && exp && exp < mfg) fl.push("expiry before manufacturing");
      mother.import_flags = fl; mother.legacy_ref = `${tab.name}!${r + 1}`; mother.created_by_name = "Imported from the sheet";
      out.push(mother);
      children.forEach((ch) => {
        const cf = ["created from the remarks of " + batch];
        if (!ch.product_name) cf.push("product name not found in the remarks");
        if (ch.mrp == null) cf.push("MRP not found in the remarks");
        out.push({ ...base, product_name: ch.product_name || base.product_name, mfg: ch.mfg || mfg, exp: ch.exp || exp, mrp: ch.mrp, usp: null, batch_no: ch.batch_no, group_no: groupOf(batch), child_letter: ch.letter,
          series_year: (ch.mfg || mfg) ? +(ch.mfg || mfg).slice(0, 4) : null, status: base.status, batch_size: ch.batch_size, batch_size_unit: ch.batch_size_unit, pieces: ch.pieces,
          market: null, remarks_original: null, note: null, import_flags: cf, legacy_ref: `${tab.name}!${r + 1}#${ch.letter}`, created_by_name: "Imported from the sheet" });
      });
    }
  }
  // the same firm + number + year used twice
  const seen = new Map();
  for (const o of out) { const k = `${o.firm_id}|${o.kind}|${normBatch(o.batch_no)}|${o.series_year}`; if (seen.has(k)) { seen.get(k).import_flags.push("batch number appears twice in the same year"); o.import_flags.push("batch number appears twice in the same year"); } else seen.set(k, o); }
  // the product list: names seen in the batches, plus the sheet's own product tabs
  const products = new Map();
  const addP = (name, firm) => { const k = norm(name); if (!k) return; const p = products.get(k) || { name: clean(name), firms: new Set() }; if (firm) p.firms.add(firm); products.set(k, p); };
  const pn = wb.SheetNames.find((n) => n.trim() === "PRODUCT NAME");
  if (pn) { const ws = wb.Sheets[pn]; const rg = XLSX.utils.decode_range(ws["!ref"] || "A1:A1"); for (let r = 1; r <= rg.e.r; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 0 })]; if (c && c.v) addP(c.w ?? c.v, null); } }
  const sh = wb.SheetNames.find((n) => n.trim() === "Copy of Sheet3");
  if (sh) { const ws = wb.Sheets[sh]; const rg = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    for (let r = 1; r <= rg.e.r; r++) { const g = (c) => { const x = ws[XLSX.utils.encode_cell({ r, c })]; return x && x.v ? clean(x.w ?? x.v) : ""; };
      if (g(2)) addP(g(2), "VP"); if (g(5)) addP(g(5), "VH"); } }
  for (const o of out) addP(o.product_name, o.firm_id);
  const productRows = [...products.values()].map((p) => ({ name: p.name, firm_id: p.firms.size === 1 ? [...p.firms][0] : null })).sort((a, b) => a.name.localeCompare(b.name));
  for (const o of out) for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined) delete o[k];
  return { rows: out, products: productRows, notes };
}
