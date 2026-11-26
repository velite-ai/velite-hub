// Velite Hub, Trademarks: third-party brands grouped party by party. Pure functions (no imports) so they can be tested with node.

const squash = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
// "Cream 100 G" and "CREAM 100G" are the same product written twice
const key = (s) => squash(s).replace(/(\d)\s+(?=(G|GM|ML|KG|L|MG)\b)/g, "$1");

// The Velite products that carry this brand name in their name (spellings that differ only in case, spacing or "100 G" / "100G" count once).
export function productsForBrand(brand, productNames) {
  const b = squash(brand);
  if (!b) return [];
  const pad = ` ${b} `;
  const seen = new Map();
  for (const n of productNames || []) {
    if (!` ${squash(n)} `.includes(pad)) continue;
    const k = key(n);
    if (!seen.has(k)) seen.set(k, String(n).trim());
  }
  return [...seen.values()].sort((x, y) => x.localeCompare(y));
}

// Registered / Opposed / Applied / Not registered / To confirm, from the status written in the record.
export function statusGroup(status) {
  const s = String(status || "");
  if (s === "Registered" || s === "Renewal Due") return "Registered";
  if (s === "Opposed" || s === "Objected") return "Opposed";
  if (s === "Filed" || s === "Applied / Filed") return "Applied";
  if (s === "Client To Confirm") return "To confirm";
  return "Not registered"; // Not Applied, Filing Needed, Search Pending, anything else
}
export const GROUP_ORDER = ["Registered", "Applied", "Opposed", "Not registered", "To confirm"];
export const GROUP_TONE = { Registered: "green", Applied: "blue", Opposed: "red", "Not registered": "amber", "To confirm": "cyan" };

export const hasUndertaking = (t) => !!(t && (t.undertaking_name || t.undertaking_date));

// One entry per party, A to Z: its brands, the status counts, the undertaking counts and the Velite products.
// productNames = names of all Velite products, or null when this login cannot see them (then the stored list on the record is shown).
export function groupByParty(rows, productNames) {
  const known = productNames != null;
  const map = new Map();
  for (const t of rows || []) {
    const name = String(t.client || "").trim() || "(no client name)";
    const k = name.toUpperCase().replace(/\s+/g, " ");
    if (!map.has(k)) map.set(k, { client: name, contact: "", brands: [], status: {}, undertaking: { available: 0, notAvailable: 0 }, products: [] });
    const p = map.get(k);
    if (!p.contact && t.contact) p.contact = t.contact;
    const g = statusGroup(t.status);
    const found = known ? productsForBrand(t.brand, productNames) : (t.products || []).filter((x) => squash(x) !== "VELITE");
    const has = hasUndertaking(t);
    p.brands.push({ ...t, group: g, velite: found, hasUndertaking: has });
    p.status[g] = (p.status[g] || 0) + 1;
    p.undertaking[has ? "available" : "notAvailable"]++;
    for (const x of found) if (!p.products.some((y) => key(y) === key(x))) p.products.push(x);
  }
  const out = [...map.values()];
  for (const p of out) { p.products.sort((a, b) => a.localeCompare(b)); p.brands.sort((a, b) => String(a.brand).localeCompare(String(b.brand))); }
  return out.sort((a, b) => a.client.localeCompare(b.client));
}
