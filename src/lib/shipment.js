// Export shipments: carton arithmetic, totals and the pre-flight check. Pure functions, no database access.

const r1 = (n) => Math.round(n * 10 + 1e-9) / 10;
const r2 = (n) => Math.round(n * 100 + 1e-9) / 100;
export const MIN_SHELF_MONTHS = 12;

// Boxes are numbered in line order. A line makes full cartons and, if the quantity does not divide evenly, one part carton.
// The part carton's weights default to the full carton's weights in proportion (typed values win).
export function packLines(lines) {
  let next = 1; const rows = []; let boxes = 0, net = 0, gross = 0;
  lines.forEach((l, i) => {
    const q = Number(l.qty) || 0, ppc = Number(l.pcs_per_carton) || 0;
    if (!q) return;
    if (!ppc) { rows.push({ line: i, unknown: true, qty: q }); return; }
    const full = Math.floor(q / ppc), rem = q % ppc;
    const n1 = Number(l.net_kg), g1 = Number(l.gross_kg);
    if (full) {
      const from = next, to = next + full - 1; next += full;
      const n = r1(full * (n1 || 0)), g = r1(full * (g1 || 0));
      rows.push({ line: i, from, to, boxes: full, perBox: ppc, qty: full * ppc, netPerBox: n1 || null, grossPerBox: g1 || null, net: n, gross: g });
      boxes += full; net += n; gross += g;
    }
    if (rem) {
      const pn = l.partial_net !== "" && l.partial_net != null ? Number(l.partial_net) : n1 ? r1((n1 * rem) / ppc) : 0;
      const pg = l.partial_gross !== "" && l.partial_gross != null ? Number(l.partial_gross) : g1 ? r1((g1 * rem) / ppc) : 0;
      rows.push({ line: i, from: next, to: next, boxes: 1, perBox: rem, qty: rem, netPerBox: pn, grossPerBox: pg, net: pn, gross: pg, part: true });
      next += 1; boxes += 1; net += pn; gross += pg;
    }
  });
  return { rows, boxes, net: r1(net), gross: r1(gross) };
}

export const lineAmount = (l) => r2((Number(l.qty) || 0) * (Number(l.rate) || 0));
export const totals = (lines) => ({ qty: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0), amount: r2(lines.reduce((s, l) => s + lineAmount(l), 0)) });

export const monthsBetween = (a, b) => { if (!a || !b) return null; const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number); return (yb - ya) * 12 + (mb - ma); };

// ctx: { firm, party, country (rule row), batchState (batch_id -> state), today (YYYY-MM-DD), allShipments (other shipments, for the invoice-number check) }
export function preflight(s, lines, ctx) {
  const out = []; const err = (t) => out.push({ level: "error", text: t }); const warn = (t) => out.push({ level: "warn", text: t });
  const f = ctx.firm, p = ctx.party;
  if (!f) err("Choose the exporting firm."); else {
    if (!f.iec) err(`${f.name}: IEC is not entered.`); if (!f.gstin) err(`${f.name}: GSTIN is not entered.`);
    if (!f.signatory_name) err(`${f.name}: signatory name is not entered.`);
    if (!(f.bank || {}).account) err(`${f.name}: bank account number is not entered.`);
    if (!(f.bank || {}).ifsc) err(`${f.name}: bank IFSC is not entered.`);
    if (!(f.lut || {}).no) warn(`${f.name}: LUT number is not entered (needed for invoices without IGST).`);
  }
  if (!p) err("Choose the buyer / consignee."); else {
    (ctx.country?.party_ids || []).forEach((k) => { if (!(p.ids || {})[k]) err(`${p.name}: ${k} is not entered.`); });
    if (!p.address) err(`${p.name}: address is not entered.`);
    if (p.usual_firm && f && p.usual_firm !== f.id) warn(`${p.name} usually buys from ${p.usual_firm}, but this shipment is under ${f.id}.`);
  }
  if (!s.invoice_no) err("Type the invoice number."); else if ((ctx.others || []).some((o) => o.firm_id === s.firm_id && String(o.invoice_no || "").toLowerCase() === s.invoice_no.toLowerCase())) err(`Invoice number ${s.invoice_no} is already used by another shipment of this firm.`);
  if (!s.invoice_date) err("Enter the invoice date."); else if (s.invoice_date > ctx.today) warn("The invoice date is in the future.");
  if (s.currency !== "INR" && !Number(s.exchange_rate)) err(`Type the exchange rate (₹ per ${s.currency}) for the day.`);
  if (!s.final_destination && !s.entry_point) warn("Route is empty: enter the entry point or port and the final destination.");
  const pr = ctx.party?.roles || [];
  if (lines.some((l) => l.brand_owner) && !s.brand_owner_id) warn("A product belongs to another company's brand but no brand owner is chosen.");
  if (!lines.length || lines.every((l) => !Number(l.qty))) err("Add at least one product with a quantity.");
  const seen = new Set();
  lines.forEach((l, i) => {
    const n = `Line ${i + 1} ${l.name || ""}`.trim();
    if (!l.name) { err(`Line ${i + 1}: choose the product.`); return; }
    if (!Number(l.qty)) err(`${n}: quantity is empty.`);
    if (!l.hsn) err(`${n}: HSN code is missing.`);
    if (l.rate === "" || l.rate == null) err(`${n}: rate is missing.`); else if (Number(l.rate) <= 0) warn(`${n}: rate is zero. For free samples use 0.01.`);
    if (!Number(l.pcs_per_carton) || !Number(l.net_kg) || !Number(l.gross_kg)) err(`${n}: carton data (pieces, net and gross weight) is missing.`);
    else if (Number(l.gross_kg) < Number(l.net_kg)) err(`${n}: gross weight is less than net weight.`);
    if (l.product_hsn && l.hsn && l.product_hsn !== l.hsn) warn(`${n}: HSN ${l.hsn} differs from the product master (${l.product_hsn}).`);
    if (!l.batch_no) err(`${n}: choose or type the batch.`);
    else {
      const k = `${l.name}|${l.batch_no}`.toUpperCase(); if (seen.has(k)) warn(`${n}: batch ${l.batch_no} is listed twice.`); seen.add(k);
      if (!l.mfg || !l.exp) err(`${n}: batch ${l.batch_no} has no manufacturing or expiry date.`);
      else {
        if (l.exp < ctx.today.slice(0, 7) + "-01") err(`${n}: batch ${l.batch_no} has already expired.`);
        else { const m = monthsBetween(ctx.today.slice(0, 7), l.exp.slice(0, 7)); if (m != null && m < MIN_SHELF_MONTHS) warn(`${n}: only ${m} months of shelf life are left on batch ${l.batch_no}.`); }
        if (l.mfg > ctx.today) warn(`${n}: batch ${l.batch_no} shows a manufacturing date in the future.`);
      }
      if (l.batch_id) { const st = ctx.batchState?.[l.batch_id]; if (st && st !== "released") err(`${n}: batch ${l.batch_no} is not released by QC (${st.replace("_", " ")}).`); else if (!st && ctx.batchState) warn(`${n}: no QC release found for batch ${l.batch_no}.`); }
      else warn(`${n}: batch ${l.batch_no} was typed by hand, so QC release was not checked.`);
    }
  });
  const pk = packLines(lines);
  if (pk.rows.some((r) => r.part)) out.push({ level: "info", text: `${pk.rows.filter((r) => r.part).length} part carton(s) will be made. Check their weights below.` });
  return out;
}
