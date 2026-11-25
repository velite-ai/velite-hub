// Export module helpers: reading a product data sheet (xlsx / csv) and comparing it with what is already stored.

export const FIRM_IDS = ["VH", "VI"];

const NUM = (v) => { const s = String(v ?? "").replace(/[, ]/g, "").trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const TXT = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s || null; };

// "AZELUX AZ SERUM 30 ML" and "Azelux az serum 30ml" are the same product
export const normName = (s) => String(s || "").toUpperCase()
  .replace(/(\d)\s*(GMS?|GRAMS?)\b/g, "$1G").replace(/(\d)\s*(ML|G|KG|L)\b/g, "$1$2").replace(/[^A-Z0-9]/g, "");

export const firmOf = (v) => {
  const s = String(v || "").toUpperCase();
  if (/\bVI\b|INDIA/.test(s)) return "VI";
  if (/\bVH\b|HEALTH/.test(s)) return "VH";
  return null;
};

// header text -> field. First matching rule wins, each column and each field only once.
const RULES = [
  ["firm", /^(firm|company|exporter)/],
  ["last_seen", /last seen/],
  ["rate", /^(last )?(export )?(rate|price)( seen)?( \(.*\))?$/],
  ["currency", /^(rate )?(currency|cur)$/],
  ["pcs", /(pieces|pcs|pack|qty|quantity).*(carton|box|case)|^(pieces|pcs) ?per/],
  ["net", /net.*(weight|wt)|^net/],
  ["gross", /gross.*(weight|wt)|^gross/],
  ["size", /(carton|box|case).*(size|dimension)|^dimension|^size/],
  ["hsn", /hsn/],
  ["shelf", /shelf|expiry|validity/],
  ["brand", /brand/],
  ["check", /please check|check|remark|note/],
  ["name", /^(product|item|description|name)/],
];

export function readProductSheet(XLSX, buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: "" });
    for (let h = 0; h < Math.min(rows.length, 15); h++) {
      const map = {}; const used = new Set();
      rows[h].forEach((cell, c) => {
        const t = String(cell).toLowerCase().trim(); if (!t) return;
        const hit = RULES.find(([f, re]) => !(f in map) && re.test(t)); if (hit && !used.has(c)) { map[hit[0]] = c; used.add(c); }
      });
      if (map.name != null && (map.hsn != null || map.pcs != null || map.rate != null)) {
        const out = [];
        for (let r = h + 1; r < rows.length; r++) {
          const g = (f) => (map[f] != null ? rows[r][map[f]] : "");
          const name = TXT(g("name")); if (!name) continue;
          out.push({ sheet: sn, line: r + 1, firm: firmOf(g("firm")), name, hsn: TXT(g("hsn"))?.replace(/\D/g, "") || null, pcs_per_carton: NUM(g("pcs")) != null ? Math.round(NUM(g("pcs"))) : null,
            net_kg: NUM(g("net")), gross_kg: NUM(g("gross")), carton_size: /\d\s*[xX×]\s*\d/.test(String(g("size"))) ? TXT(g("size")) : null, shelf_life_months: NUM(g("shelf")) != null ? Math.round(NUM(g("shelf"))) : null,
            brand_owner: TXT(g("brand")), check_note: TXT(g("check")), rate: NUM(g("rate")), currency: (TXT(g("currency")) || "").toUpperCase().slice(0, 3) || null,
            last_seen: /^\d{4}-\d{2}-\d{2}$/.test(String(g("last_seen")).trim()) ? String(g("last_seen")).trim() : null });
        }
        return { sheet: sn, rows: out, found: Object.keys(map) };
      }
    }
  }
  return { sheet: null, rows: [], found: [] };
}

const FIELDS = ["hsn", "pcs_per_carton", "net_kg", "gross_kg", "carton_size", "shelf_life_months", "brand_owner", "check_note", "last_seen"];
export const FIELD_LABEL = { hsn: "HSN", pcs_per_carton: "pieces per carton", net_kg: "net weight", gross_kg: "gross weight", carton_size: "carton size", shelf_life_months: "shelf life", brand_owner: "brand owner", check_note: "note", last_seen: "last seen" };

// Compare sheet rows with stored products. Sheet values win where the sheet has a value; blanks never erase anything.
export function planImport(sheetRows, existing, defaultFirm) {
  const by = new Map(existing.filter((p) => !p.deleted_at).map((p) => [`${p.firm_id}|${normName(p.name)}`, p]));
  const seen = new Set(); const plan = [];
  for (const r of sheetRows) {
    const firm = r.firm || defaultFirm; const key = `${firm}|${normName(r.name)}`;
    if (seen.has(key)) { plan.push({ kind: "dup", row: r, firm }); continue; } seen.add(key);
    const have = by.get(key);
    if (!have) { plan.push({ kind: "new", row: r, firm }); continue; }
    const diffs = FIELDS.filter((f) => r[f] != null && String(r[f]) !== String(have[f] ?? ""));
    plan.push({ kind: diffs.length || r.rate != null ? "change" : "same", row: r, firm, have, diffs });
  }
  return plan;
}
