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
