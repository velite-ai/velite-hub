// Export audit: compares the shipment, the papers made from it and the outside documents attached to it,
// and checks them against the master data and the usual rules. Pure functions; every finding says what to fix.
import { packLines, totals, preflight, monthsBetween, MIN_SHELF_MONTHS } from "./shipment.js";
import { normName } from "./export.js";
import { KINDS, buildPaper, paperContext, kindOfCountryDoc, fingerprint, money } from "./exportDocs.js";

// Outside documents that can be attached to a shipment, and the facts worth typing from each (the audit compares them).
export const FACTS = {
  ref_no: "Number", doc_date: "Date", invoice_no: "Invoice number on it", value_inr: "Invoice / FOB value in rupees", packages: "Number of packages", iec: "IEC on it", gstin: "GSTIN on it", batch_no: "Batch number", mfg: "Mfg (month)", exp: "Exp (month)", valid_until: "Licence valid up to", products: "Products listed on it (one per line)",
};
export const ATTACH = [
  { k: "shipping_bill", label: "Shipping bill", match: /shipping bill/i, facts: ["ref_no", "doc_date", "invoice_no", "value_inr", "packages", "iec", "gstin"] },
  { k: "eway", label: "E-way bill", match: /e-way/i, facts: ["ref_no", "doc_date", "invoice_no", "value_inr", "gstin"] },
  { k: "einvoice", label: "E-invoice (IRN)", match: /e-invoice/i, facts: ["ref_no", "doc_date", "invoice_no", "value_inr", "gstin"] },
  { k: "truck_receipt", label: "Truck receipt / docket / builty", match: /truck|docket|builty|lorry/i, facts: ["ref_no", "doc_date", "packages"] },
  { k: "po", label: "Buyer's purchase order", match: /purchase order/i, facts: ["ref_no", "doc_date"] },
  { k: "coa", label: "COA", match: /\bcoa\b|analysis/i, facts: ["batch_no", "mfg", "exp"] },
  { k: "msds", label: "MSDS", match: /msds/i, facts: [] },
  { k: "non_dg", label: "Non-DG certificate", match: /non-?dg/i, facts: ["ref_no", "doc_date"] },
  { k: "fsc", label: "Free sale certificate", match: /free sale/i, facts: ["ref_no", "doc_date", "valid_until", "products"] },
  { k: "loa", label: "Letter of authority", match: /authority/i, facts: [] },
  { k: "ingredients", label: "Ingredient list", match: /ingredient/i, facts: [] },
  { k: "carton_text", label: "Brand-owner carton text", match: /carton text/i, facts: [] },
  { k: "other", label: "Other document", match: /^$/, facts: ["ref_no", "doc_date"] },
];
export const attachKind = (k) => ATTACH.find((a) => a.k === k) || ATTACH[ATTACH.length - 1];
export const attachOfCountryDoc = (name) => ATTACH.find((a) => a.k !== "other" && a.match.test(name)) || null;

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const fyOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : `${y - 1}-${String(y % 100).padStart(2, "0")}`; };
const same = (a, b) => String(a ?? "").replace(/[\s-]/g, "").toLowerCase() === String(b ?? "").replace(/[\s-]/g, "").toLowerCase();
const mon = (d) => (d ? d.slice(0, 7) : "");
const text = (p) => JSON.stringify(p.blocks).replace(/\\n/g, " ");

// the papers must show what the shipment says (guards against a wrong template or a stale copy)
export function crossCheckPapers(papers, s, lines, party, firm) {
  const out = []; const pk = packLines(lines); const tot = totals(lines);
  const need = (kind, what, str) => { const p = papers[kind]; if (p && str && !text(p).includes(String(str))) out.push({ level: "error", area: "Papers", text: `The ${p.title.toLowerCase()} does not show ${what} (${str}).` }); };
  ["invoice", "packing", "coo", "declaration"].forEach((k) => need(k, "the invoice number", s.invoice_no));
  ["invoice", "proforma", "coo"].forEach((k) => need(k, "the invoice value", money(tot.amount, s.currency)));
  need("packing", "the total boxes", `TOTAL BOXES: ${pk.boxes}`); need("coo", "the total boxes", `TOTAL NO OF BOXES: ${pk.boxes}`); need("invoice", "the number of cases", `Case: ${pk.boxes}`);
  need("packing", "the gross weight", `${pk.gross}`); need("coo", "the gross weight", `${pk.gross}kg`);
  lines.forEach((l) => {
    if (l.batch_no) ["invoice", "packing", "coo"].forEach((k) => need(k, "the batch number", l.batch_no));
    if (l.hsn) ["invoice", "packing", "declaration"].forEach((k) => need(k, "the HSN code", l.hsn));
  });
  if (party) ["invoice", "packing", "coo", "proforma"].forEach((k) => need(k, "the buyer's name", party.name));
  if (firm?.iec) ["invoice", "packing", "proforma"].forEach((k) => need(k, "the IEC", firm.iec));
  return out;
}

// Stage 1 (order received, proforma to be sent): only the proforma and what it prints are audited.
function proformaAudit(c, items, passed, add, group, tot) {
  const { s, lines, firm, party } = c;
  group("Firm", "IEC, GSTIN and bank details look valid", () => {
    if (!firm) return;
    if (firm.iec && !/^[A-Z0-9]{10}$/.test(firm.iec)) add("error", "Firm", `${firm.name}: IEC ${firm.iec} is not 10 letters or digits.`);
    const b = firm.bank || {}; if (b.ifsc && !IFSC.test(b.ifsc)) add("error", "Firm", `${firm.name}: IFSC ${b.ifsc} is not in the right format.`);
  });
  group("Buyer", "IDs are consistent", () => { if (party?.country === "Nepal") { const ids = party.ids || {}; if (ids.PAN && ids.EXIM && !ids.EXIM.startsWith(ids.PAN)) add("error", "Buyer", `${party.name}: EXIM ${ids.EXIM} does not start with the PAN ${ids.PAN}. One of them is wrong.`); } });
  group("Products", "HSN and prices", () => {
    lines.forEach((l, i) => {
      const n = `Line ${i + 1} ${l.name}`; const prod = (c.products || []).find((p) => p.id === l.product_id);
      if (l.hsn && !/^\d{8}$/.test(l.hsn)) add("warn", "Products", `${n}: HSN ${l.hsn} is not 8 digits.`);
      if (prod?.hsn && l.hsn && prod.hsn !== l.hsn) add("warn", "Products", `${n}: HSN ${l.hsn} differs from the product master (${prod.hsn}).`);
      const pr = (c.prices || []).filter((x) => x.product_id === l.product_id && x.currency === s.currency); const best = pr.filter((x) => x.party_id === s.party_id)[0] || pr.filter((x) => !x.party_id).sort((a, b) => (b.as_of || "").localeCompare(a.as_of || ""))[0];
      if (best && l.rate !== "" && l.rate != null && Math.abs(Number(l.rate) - Number(best.rate)) > 0.0049 && Number(l.rate) > 0.01) add("warn", "Products", `${n}: rate ${l.rate} differs from the price list (${best.rate}).`);
    });
  });
  const ctx = paperContext(s, lines, { firms: [firm].filter(Boolean), parties: [party, c.notify, c.brandOwner].filter(Boolean), agents: [] }, true, c.attachments || []);
  const pi = buildPaper("proforma", ctx);
  group("Papers", "the proforma shows the same numbers as the shipment", () => {
    const t = text(pi); const miss = (what, str) => { if (str && !t.includes(String(str))) add("error", "Papers", `The proforma does not show ${what} (${str}).`); };
    miss("the proforma number", s.proforma_no); miss("the total", money(tot.amount, s.currency)); if (party) miss("the buyer's name", party.name); if (firm?.iec) miss("the IEC", firm.iec);
    lines.forEach((l) => { if (l.hsn) miss("the HSN code", l.hsn); });
  });
  if (c.saved.proforma && c.saved.proforma.input_hash !== fingerprint(pi)) add("warn", "Papers", `The saved copy of Proforma invoice v${c.saved.proforma.version} no longer matches the order (it was changed afterwards). Print again so the saved copy is current.`);
  if (!(c.attachments || []).some((a) => a.kind === "po")) add("warn", "Order", "No copy of the buyer's order is saved with this shipment. Attach it under Outside documents (a proforma is made against the order).");
  add("info", "Next step", "When the buyer confirms and the goods are ready, change the status to “Preparing dispatch” to add batches, cartons, the invoice number and the other papers.");
  return { items, passed, errors: items.filter((i) => i.level === "error").length, warnings: items.filter((i) => i.level === "warn").length, papers: { proforma: pi } };
}

// ctx: { s, lines, firm, party, notify, brandOwner, country (rule row), d (masters), others (other shipments), attachments, saved (latest saved copy per kind), batchState, today, products, prices }
export function auditShipment(c) {
  const { s, lines, firm, party, country, attachments = [], saved = {}, today } = c; const items = []; const passed = [];
  const add = (level, area, textv) => items.push({ level, area, text: textv });
  const before = () => items.filter((i) => i.level === "error" || i.level === "warn").length;
  const group = (area, label, fn) => { const n = before(); fn(); if (before() === n) passed.push(`${area}: ${label}`); };
  const tot = totals(lines); const pk = packLines(lines);
  const invInr = s.currency === "INR" ? tot.amount : tot.amount * (Number(s.exchange_rate) || 0);
  const inv = s.invoice_date || today;

  // 1 · the shipment data itself (same checks as the shipment form)
  const pre = preflight(s, lines, { firm, party, country, others: c.others, batchState: c.batchState, today });
  pre.filter((i) => i.level !== "info").forEach((i) => add(i.level, "Shipment", i.text));
  if (!pre.some((i) => i.level !== "info")) passed.push("Shipment: all required details are filled in");

  if (s.status === "proforma") return proformaAudit(c, items, passed, add, group, tot);

  // 2 · master-data and format rules
  group("Firm", "IEC, GSTIN and bank details look valid", () => {
    if (!firm) return;
    if (firm.iec && !/^[A-Z0-9]{10}$/.test(firm.iec)) add("error", "Firm", `${firm.name}: IEC ${firm.iec} is not 10 letters or digits.`);
    if (firm.gstin && !GSTIN.test(firm.gstin)) add("error", "Firm", `${firm.name}: GSTIN ${firm.gstin} does not look like a valid GSTIN.`);
    if (firm.gstin && !firm.gstin.startsWith("03")) add("warn", "Firm", `${firm.name}: GSTIN starts with ${firm.gstin.slice(0, 2)}, not 03 (Punjab).`);
    const b = firm.bank || {}; if (b.ifsc && !IFSC.test(b.ifsc)) add("error", "Firm", `${firm.name}: IFSC ${b.ifsc} is not in the right format (4 letters, 0, 6 letters or digits).`);
    if (b.swift && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b.swift)) add("warn", "Firm", `${firm.name}: SWIFT code ${b.swift} looks wrong.`);
  });
  group("Buyer", "IDs are consistent", () => {
    if (!party) return; const ids = party.ids || {};
    if (party.country === "Nepal") {
      if (ids.PAN && !/^\d{9}$/.test(ids.PAN)) add("warn", "Buyer", `${party.name}: Nepal PAN should be 9 digits (${ids.PAN}).`);
      if (ids.EXIM && !/NP$/.test(ids.EXIM)) add("warn", "Buyer", `${party.name}: EXIM code ${ids.EXIM} should end with NP.`);
      if (ids.PAN && ids.EXIM && !ids.EXIM.startsWith(ids.PAN)) add("error", "Buyer", `${party.name}: EXIM ${ids.EXIM} does not start with the PAN ${ids.PAN}. One of them is wrong.`);
    }
  });
  group("Terms", "invoice number, dates, currency and LUT fit", () => {
    if (s.invoice_no) {
      const m = /^([A-Za-z]+)(\d+)$/.exec(s.invoice_no.trim());
      if (!m) add("warn", "Terms", `Invoice number ${s.invoice_no} does not follow the usual pattern (EX followed by digits).`);
      else {
        const mine = +m[2]; const peers = (c.others || []).filter((o) => o.firm_id === s.firm_id && o.invoice_no).map((o) => ({ ...o, m: /^([A-Za-z]+)(\d+)$/.exec(o.invoice_no.trim()) })).filter((o) => o.m && o.m[1].toUpperCase() === m[1].toUpperCase());
        const max = peers.reduce((a, o) => Math.max(a, +o.m[2]), 0);
        if (peers.length && mine < max) add("warn", "Terms", `Invoice number ${s.invoice_no} is lower than ${m[1].toUpperCase()}${max}, already used for this firm.`);
        else if (peers.length && mine > max + 1) add("info", "Terms", `Invoice numbers skip from ${m[1].toUpperCase()}${max} to ${s.invoice_no}.`);
        const prev = peers.filter((o) => +o.m[2] < mine).sort((a, b) => +b.m[2] - +a.m[2])[0];
        if (prev && prev.invoice_date && s.invoice_date && prev.invoice_date > s.invoice_date) add("warn", "Terms", `${prev.invoice_no} is dated ${prev.invoice_date} which is later than this invoice (${s.invoice_date}), though its number is lower.`);
      }
    }
    if (s.proforma_date && s.invoice_date && s.proforma_date > s.invoice_date) add("warn", "Terms", "The proforma is dated after the invoice.");
    if (s.po_date && s.invoice_date && s.po_date > s.invoice_date) add("error", "Terms", "The buyer's PO is dated after the invoice.");
    if (country && country.currency !== s.currency) add("warn", "Terms", `${country.country} shipments are usually in ${country.currency}, this one is in ${s.currency}.`);
    if (s.currency !== "INR" && Number(s.exchange_rate) && (s.exchange_rate < 50 || s.exchange_rate > 150)) add("warn", "Terms", `Exchange rate ${s.exchange_rate} looks unusual for ${s.currency}.`);
    const lut = firm?.lut || {}; if (lut.valid_for && s.invoice_date && lut.valid_for !== fyOf(s.invoice_date)) add("warn", "Terms", `The LUT is for ${lut.valid_for} but the invoice falls in ${fyOf(s.invoice_date)}.`);
  });
  group("Products", "HSN, prices, batches and shelf life", () => {
    lines.forEach((l, i) => {
      const n = `Line ${i + 1} ${l.name}`; const prod = (c.products || []).find((p) => p.id === l.product_id);
      if (l.hsn && !/^\d{8}$/.test(l.hsn)) add("warn", "Products", `${n}: HSN ${l.hsn} is not 8 digits.`);
      else if (l.hsn && !/^3[34]/.test(l.hsn)) add("warn", "Products", `${n}: HSN ${l.hsn} is not in chapter 33 or 34 (cosmetics and soaps). Check.`);
      if (prod?.hsn && l.hsn && prod.hsn !== l.hsn) add("warn", "Products", `${n}: HSN ${l.hsn} differs from the product master (${prod.hsn}).`);
      if (prod?.brand_owner && (!c.brandOwner || !String(c.brandOwner.name).toLowerCase().includes(String(prod.brand_owner).toLowerCase().split(" ")[0]))) add("warn", "Products", `${n}: belongs to the brand of ${prod.brand_owner}; the brand owner chosen on the shipment is ${c.brandOwner ? c.brandOwner.name : "none"}.`);
      const pr = (c.prices || []).filter((p) => p.product_id === l.product_id && p.currency === s.currency); const best = pr.filter((p) => p.party_id === s.party_id)[0] || pr.filter((p) => !p.party_id).sort((a, b) => (b.as_of || "").localeCompare(a.as_of || ""))[0];
      if (best && l.rate !== "" && l.rate != null && Math.abs(Number(l.rate) - Number(best.rate)) > 0.0049 && Number(l.rate) > 0.01) add("warn", "Products", `${n}: rate ${l.rate} differs from the price list (${best.rate}).`);
      if (!best && l.product_id && Number(l.rate) > 0.01) add("info", "Products", `${n}: no ${s.currency} price in the price list to compare with.`);
      if (l.exp && s.invoice_date) {
        if (mon(l.exp) < mon(s.invoice_date)) add("error", "Products", `${n}: batch ${l.batch_no} expires (${mon(l.exp)}) before the invoice date.`);
        else { const m = monthsBetween(mon(s.invoice_date), mon(l.exp)); if (m != null && m < MIN_SHELF_MONTHS) add("warn", "Products", `${n}: only ${m} months of shelf life at the invoice date.`); }
      }
      if (l.mfg && s.invoice_date && mon(l.mfg) > mon(s.invoice_date)) add("error", "Products", `${n}: batch ${l.batch_no} is made after the invoice date.`);
      if (l.mfg && l.exp) { const life = monthsBetween(mon(l.mfg), mon(l.exp)); if (life != null && (life < 12 || life > 60)) add("warn", "Products", `${n}: shelf life from mfg to exp is ${life} months. Check the dates.`); }
    });
  });

  // 3 · the papers against the shipment
  const ctx = paperContext(s, lines, { firms: [firm].filter(Boolean), parties: [party, c.notify, c.brandOwner].filter(Boolean), agents: [c.transporter, c.agent].filter(Boolean), products: c.products || [], countries: [country].filter(Boolean) }, true, c.attachments || [], c.formulas || {});
  const papers = Object.fromEntries(KINDS.map(([k]) => [k, buildPaper(k, ctx)]));
  group("Papers", "all papers show the same numbers as the shipment", () => { crossCheckPapers(papers, s, lines, party, firm).forEach((i) => add(i.level, i.area, i.text)); });
  const stale = []; KINDS.forEach(([k, label]) => { const sv = saved[k]; if (sv && papers[k] && sv.input_hash !== fingerprint(papers[k])) stale.push(`${label} v${sv.version}`); });
  if (stale.length) add("warn", "Papers", `The saved copy of ${stale.join(", ")} no longer matches the shipment (it was changed afterwards). Print again so the saved copy is current.`);
  else if (Object.keys(saved).length) passed.push("Papers: saved copies match the shipment");

  // letter of authority and ingredient list (Myanmar-type requirements)
  const needs = (re) => (country?.docs || []).some((d) => re.test(d));
  if (needs(/authori[sz]ation|letter of authority/i) && party) {
    const au = party.authority || {};
    if (!au.representative) add("error", "Letter of authority", `${party.name}: the authorised person is not entered (Parties → Letter of authority).`);
    if (!au.trademarks) add("warn", "Letter of authority", `${party.name}: the trademark(s) are not entered, so the letter will not name them.`);
    if (!au.valid_to) add("warn", "Letter of authority", `${party.name}: the letter's validity is not entered.`);
    else if (s.invoice_date && (au.valid_to < s.invoice_date.slice(0, 7) || (au.valid_from && au.valid_from > s.invoice_date.slice(0, 7)))) add("error", "Letter of authority", `The letter's validity (${au.valid_from || "…"} to ${au.valid_to}) does not cover the invoice date (${s.invoice_date}). Sign a new letter.`);
  }
  if (needs(/carton text|carton marking/i) && !c.brandOwner) add("warn", "Carton text", `${country.country} wants the brand owner's text on the cartons, but no brand owner is chosen on the shipment. The carton text will show Velite only.`);
  if (needs(/ingredient/i)) {
    lines.forEach((l, i) => {
      const prod = (c.products || []).find((p) => p.id === l.product_id); const n = `Line ${i + 1} ${l.name}`;
      if (!prod?.reg_product_id) { add("error", "Ingredient list", `${n}: not linked to a Regulatory product, so its ingredient list cannot be made (Products → Linked Regulatory product).`); return; }
      const fl = c.formulas?.[prod.reg_product_id];
      if (!fl) { add("warn", "Ingredient list", `${n}: the formula could not be loaded (it needs Regulatory access).`); return; }
      if (!fl.length) { add("error", "Ingredient list", `${n}: the Regulatory product has no formula yet.`); return; }
      const missing = fl.filter((x) => (x.pct == null || x.pct === "") && !x.pct_text); if (missing.length) add("warn", "Ingredient list", `${n}: no percentage for ${missing.length} of ${fl.length} ingredients.`);
      else { const sum = fl.reduce((a, x) => a + (x.pct != null && x.pct !== "" ? Number(x.pct) : 0), 0); if (!fl.some((x) => /q\.?s/i.test(x.pct_text || "")) && Math.abs(sum - 100) > 1.5) add("warn", "Ingredient list", `${n}: the percentages add up to ${Math.round(sum * 100) / 100}, not 100.`); }
    });
  }

  // 4 · papers the country needs
  const missing = [];
  (country?.docs || []).forEach((name) => {
    const k = kindOfCountryDoc(name); if (k) { if (!saved[k]) missing.push(name); return; }
    if (/e-invoice|e-way/i.test(name)) { const need = /e-way/i.test(name) ? ["eway"] : ["einvoice"]; if (/e-invoice and e-way/i.test(name)) need.push("eway"); need.forEach((kk) => { if (!attachments.some((a) => a.kind === kk)) missing.push(attachKind(kk).label); }); return; }
    const a = attachOfCountryDoc(name); if (a && !attachments.some((x) => x.kind === a.k)) missing.push(name);
  });
  if (missing.length) add("warn", "Papers needed", `Not yet prepared or attached: ${[...new Set(missing)].join("; ")}.`); else if (country?.docs?.length) passed.push("Papers needed: every paper on the country's list is prepared or attached");
  if (country?.label_rule) add("info", "Papers needed", `Carton marking rule for ${country.country}: ${country.label_rule}`);
  if ((country?.docs || []).some((d) => /coa/i.test(d))) lines.forEach((l) => { if (l.batch_no && !attachments.some((a) => a.kind === "coa" && same(a.facts?.batch_no, l.batch_no))) add("warn", "Papers needed", `No COA attached for batch ${l.batch_no} (${l.name}).`); });

  // 5 · outside documents against the shipment
  attachments.forEach((a) => {
    const f = a.facts || {}; const lab = `${attachKind(a.kind).label}${a.ref_no || f.ref_no ? ` ${a.ref_no || f.ref_no}` : ""}`; const e = (t) => add("error", "Outside documents", `${lab}: ${t}`); const w = (t) => add("warn", "Outside documents", `${lab}: ${t}`);
    const date = a.doc_date || f.doc_date;
    if (f.invoice_no && s.invoice_no && !same(f.invoice_no, s.invoice_no)) e(`shows invoice ${f.invoice_no} but this shipment is ${s.invoice_no}.`);
    if (f.value_inr !== undefined && f.value_inr !== "" && invInr && Math.abs(Number(f.value_inr) - invInr) > 1) e(`shows Rs. ${money(f.value_inr, "INR")} but the invoice value is Rs. ${money(invInr, "INR")}.`);
    if (f.packages !== undefined && f.packages !== "" && pk.boxes && Number(f.packages) !== pk.boxes) e(`shows ${f.packages} packages but the packing list has ${pk.boxes} boxes.`);
    if (f.iec && firm?.iec && !same(f.iec, firm.iec)) e(`shows IEC ${f.iec}, but ${firm.name} has ${firm.iec}.`);
    if (f.gstin && firm?.gstin && !same(f.gstin, firm.gstin)) e(`shows GSTIN ${f.gstin}, but ${firm.name} has ${firm.gstin}.`);
    if (date && s.invoice_date && ["shipping_bill", "eway", "einvoice"].includes(a.kind) && date < s.invoice_date) e(`is dated ${date}, before the invoice (${s.invoice_date}).`);
    if (a.kind === "eway" && (a.ref_no || f.ref_no) && s.eway_bill && !same(a.ref_no || f.ref_no, s.eway_bill)) w(`number differs from the e-way bill number on the shipment (${s.eway_bill}).`);
    if (a.kind === "truck_receipt" && (a.ref_no || f.ref_no) && s.gr_no && !same(a.ref_no || f.ref_no, s.gr_no)) w(`number differs from the G.R. / docket number on the shipment (${s.gr_no}).`);
    if (a.kind === "po" && (a.ref_no || f.ref_no) && s.po_no && !same(a.ref_no || f.ref_no, s.po_no)) w(`number differs from the PO number on the shipment (${s.po_no}).`);
    if (a.kind === "fsc") {
      if (f.valid_until && s.invoice_date) { if (f.valid_until < s.invoice_date) e(`the licence it is based on expired on ${f.valid_until}, before this invoice (${s.invoice_date}). Get a current free sale certificate.`); else if (monthsBetween(mon(s.invoice_date), mon(f.valid_until)) < 3) w(`the licence it is based on is valid only up to ${f.valid_until}. Apply for the renewed certificate soon.`); }
      else if (!f.valid_until) w("the licence validity date is not recorded, so it could not be checked.");
      if (date && s.invoice_date && date > s.invoice_date) w(`is dated ${date}, after the invoice (${s.invoice_date}).`);
      if (f.products && String(f.products).trim()) {
        const listed = String(f.products).split(/\n+/).map((x) => normName(x)).filter(Boolean);
        lines.forEach((l) => { const n = normName(l.name); if (n && !listed.some((x) => x === n || x.includes(n) || n.includes(x))) e(`does not list ${l.name}. A free sale certificate must cover every product exported.`); });
      } else w("the products it lists are not recorded, so it could not be compared with the shipment.");
    }
    if (a.kind === "coa" && f.batch_no) {
      const l = lines.find((x) => same(x.batch_no, f.batch_no));
      if (!l) w(`is for batch ${f.batch_no}, which is not in this shipment.`);
      else { if (f.mfg && l.mfg && mon(f.mfg) !== mon(l.mfg)) e(`shows mfg ${mon(f.mfg)} but the shipment has ${mon(l.mfg)} for batch ${f.batch_no}.`); if (f.exp && l.exp && mon(f.exp) !== mon(l.exp)) e(`shows exp ${mon(f.exp)} but the shipment has ${mon(l.exp)} for batch ${f.batch_no}.`); }
    }
    if (!a.file_path) add("info", "Outside documents", `${lab}: only the facts are recorded, no file is attached.`);
  });
  if (attachments.length && !items.some((i) => i.area === "Outside documents" && i.level !== "info")) passed.push("Outside documents: the facts typed from them agree with the shipment");
  return { items, passed, errors: items.filter((i) => i.level === "error").length, warnings: items.filter((i) => i.level === "warn").length, papers };
}
