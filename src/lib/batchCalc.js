// Batch Detail calculations (no imports, so they can be tested on their own).
// ── shelf life and unit sale price ───────────────────────────────────────────
// "Best before 24 months from the month of manufacturing": made in 10/26 -> expires 09/28, so the expiry month is mfg + (months - 1).
export function expiryFor(mfg, months) {
  const n = Number(months); if (!mfg || !Number.isFinite(n) || n < 1) return "";
  const y = +mfg.slice(0, 4), m = +mfg.slice(5, 7) - 1 + (n - 1);
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
}
// the shelf life in months that an mfg / exp pair stands for (the other way round); null when it makes no sense
export function shelfOf(mfg, exp) {
  if (!mfg || !exp) return null; const n = (+exp.slice(0, 4) - +mfg.slice(0, 4)) * 12 + (+exp.slice(5, 7) - +mfg.slice(5, 7)) + 1;
  return n >= 3 && n <= 72 ? n : null;
}
const normProd = (s) => String(s || "").toUpperCase().replace(/(\d)\s*(GMS?|GRAMS?)\b/g, "$1G").replace(/[^A-Z0-9]/g, "");
// the months typed (or implied) on the latest earlier batch of the same product and firm
export function lastShelfMonths(rows, firm, product, excludeId) {
  const key = normProd(product); if (!key) return null;
  const list = rows.filter((r) => r.id !== excludeId && !r.deleted_at && r.firm_id === firm && normProd(r.product_name) === key)
    .sort((a, b) => (b.mfg || "").localeCompare(a.mfg || "") || (b.created_at || "").localeCompare(a.created_at || ""));
  for (const r of list) { const n = r.shelf_months || shelfOf(r.mfg, r.exp); if (n) return n; }
  return null;
}
// unit sale price = MRP divided by the pack size (30 ml, 50 g, 100 ...), two decimals; null if either is missing
export function uspFor(mrp, packSize) {
  const price = Number(mrp); const m = String(packSize || "").match(/(\d+(?:\.\d+)?)/); const size = m ? Number(m[1]) : 0;
  if (mrp === "" || mrp == null || !Number.isFinite(price) || !size) return null;
  return Math.round((price / size) * 100) / 100;
}


// ── pack size: number and unit (g or ml) ─────────────────────────────────────
// "30", "30 ml", "50G", "100 GM" -> { num: "30", unit: "ml" }; the unit is "" when the text has none
export function parsePack(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]*)/); if (!m) return null; const u = m[2].toLowerCase();
  return { num: m[1], unit: /^(ml|mls|millilit\w*|ltr|l)$/.test(u) ? "ml" : /^(g|gm|gms|gr|gram|grams)$/.test(u) ? "g" : "" };
}
// "AZELUX AZ SERUM 30ML" -> { num: "30", unit: "ml" }; "SOLOLITE NANO GEL 50 GM" -> { num: "50", unit: "g" }
export function packFromName(name) {
  const all = [...String(name || "").matchAll(/(\d+(?:\.\d+)?)\s*(ML|GMS?|G)\b/gi)]; const m = all[all.length - 1]; if (!m) return null;
  return { num: m[1], unit: /^ml$/i.test(m[2]) ? "ml" : "g" };
}
// the pack size of the latest earlier batch of the same product and firm (unit from the product name when the old value has none)
export function lastPack(rows, firm, product, excludeId) {
  const key = normProd(product); if (!key) return null;
  const list = rows.filter((r) => r.id !== excludeId && !r.deleted_at && r.firm_id === firm && normProd(r.product_name) === key && r.pack_size)
    .sort((a, b) => (b.mfg || "").localeCompare(a.mfg || "") || (b.created_at || "").localeCompare(a.created_at || ""));
  for (const r of list) { const p = parsePack(r.pack_size); if (p) return { num: p.num, unit: p.unit || packFromName(r.product_name)?.unit || "" }; }
  return null;
}
export const packText = (num, unit) => (String(num || "").trim() ? `${String(num).trim()} ${unit || "ml"}` : null);

// ── the next batch number ────────────────────────────────────────────────────
// Velite Pharmaceuticals (VP): V-001 for "other", 001 for tubes; the number restarts every calendar year.
// Velite Healthcare (VH): a running number that carries on across the years: H + first two letters or digits of the product + "-" + number
// (HSK-1275, HN1-1262) for "other", and a plain 3-digit number for tubes (558, after 999 it starts again at 001).
// The next number is the highest one among the batches of the latest two manufacturing months, plus one.
export function suggestBatchNo(rows, firm, kind, product, mfg) {
  const year = mfg ? +mfg.slice(0, 4) : new Date().getFullYear();
  const num = (b) => { const m = String(b || "").match(/(\d+)[A-Za-z]?$/); return m ? +m[1] : null; };
  const mine = rows.filter((r) => !r.deleted_at && r.firm_id === firm && r.kind === kind);
  if (firm === "VP") {
    const used = mine.filter((r) => r.series_year === year).map((r) => num(r.group_no || r.batch_no)).filter((n) => n != null);
    const next = (used.length ? Math.max(...used) : 0) + 1;
    return kind === "other" ? `V-${String(next).padStart(3, "0")}` : String(next).padStart(3, "0");
  }
  if (firm === "VH") {
    const withNo = mine.map((r) => ({ m: String(r.mfg || "").slice(0, 7), n: num(r.group_no || r.batch_no) })).filter((x) => x.m && x.n != null && x.n < 100000);
    if (!withNo.length) return "";
    const months = [...new Set(withNo.map((x) => x.m))].sort().reverse().slice(0, 2);
    let next = Math.max(...withNo.filter((x) => months.includes(x.m)).map((x) => x.n)) + 1;
    if (kind === "tube") { if (next > 999) next = 1; return String(next).padStart(3, "0"); }
    const prefix = String(product || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
    return prefix.length < 2 ? "" : `H${prefix}-${next}`;
  }
  return "";
}
