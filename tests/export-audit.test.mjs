// Run with: node tests/export-audit.test.mjs
import assert from "node:assert/strict";
import { auditShipment, ATTACH } from "../src/lib/exportAudit.js";
import { buildPaper, paperContext, fingerprint } from "../src/lib/exportDocs.js";

const firm = { id: "VH", name: "Velite Healthcare", address: "Hambran", iec: "3012013458", gstin: "03ACQPV5065L1ZY", signatory_name: "S", bank: { account: "393905000325", ifsc: "ICIC0006319" }, lut: { no: "L1", valid_for: "2026-27" } };
const party = { id: "p", name: "NU DERMA ENTERPRISES PVT. LTD.", country: "Nepal", address: "Kathmandu", ids: { PAN: "606692753", EXIM: "6066927530123NP" }, usual_firm: "VH" };
const country = { country: "Nepal", currency: "INR", party_ids: ["PAN", "EXIM"], docs: ["Proforma invoice", "Export invoice (under LUT)", "Packing list", "Shipping bill (customs agent)", "E-invoice and e-way bill"] };
const s = { id: "s1", firm_id: "VH", country: "Nepal", party_id: "p", currency: "INR", invoice_no: "EX65", invoice_date: "2026-10-24", proforma_no: "PI_VH_13.10.2026", proforma_date: "2026-10-13", transport_mode: "road", final_destination: "Kathmandu", port_loading: "Ludhiana" };
const lines = [{ name: "AZELUX AZ SERUM 30ML", product_id: "pr", hsn: "33049910", batch_no: "HAZ-1222", mfg: "2026-10-01", exp: "2028-09-01", qty: 1000, rate: 145, pcs_per_carton: 72, net_kg: 2.2, gross_kg: 8.9, partial_net: 2.0, partial_gross: 8.0 }];
const base = { s, lines, firm, party, country, attachments: [], saved: {}, others: [], batchState: null, today: "2026-11-25", products: [{ id: "pr", hsn: "33049910" }], prices: [{ product_id: "pr", currency: "INR", rate: 145, party_id: null, as_of: "2026-10-01" }] };
const run = (o = {}) => auditShipment({ ...base, ...o });
const has = (r, level, frag) => r.items.some((i) => i.level === level && i.text.includes(frag));

let r = run();
assert.equal(r.errors, 0, JSON.stringify(r.items.filter((i) => i.level === "error")));
assert.ok(has(r, "warn", "Not yet prepared or attached"));                            // shipping bill, e-way bill, saved papers
assert.ok(r.passed.some((p) => p.startsWith("Papers: all papers")));                 // papers agree with the shipment

// shipping bill facts that do not agree with the invoice
r = run({ attachments: [{ kind: "shipping_bill", ref_no: "1455799", facts: { invoice_no: "EX64", value_inr: 145145, packages: 13, iec: "3012013459", gstin: "03ACQPV5065L1ZY" }, doc_date: "2026-10-20" }] });
assert.ok(has(r, "error", "shows invoice EX64"));
assert.ok(has(r, "error", "1,45,145.00"));
assert.ok(has(r, "error", "13 packages"));
assert.ok(has(r, "error", "IEC 3012013459"));
assert.ok(has(r, "error", "before the invoice"));
assert.ok(!has(r, "error", "GSTIN"));
// a matching one is clean
r = run({ attachments: [{ kind: "shipping_bill", ref_no: "1", facts: { invoice_no: "EX65", value_inr: 145000, packages: 14, iec: "3012013458", gstin: "03ACQPV5065L1ZY" }, doc_date: "2026-10-25" }] });
assert.equal(r.items.filter((i) => i.area === "Outside documents" && i.level !== "info").length, 0);
// master-data rules
r = run({ party: { ...party, ids: { PAN: "606692753", EXIM: "6198833910154NP" } }}); assert.ok(has(r, "error", "does not start with the PAN"));
r = run({ firm: { ...firm, bank: { ...firm.bank, ifsc: "ICIC03939" } } }); assert.ok(has(r, "error", "IFSC"));
r = run({ lines: [{ ...lines[0], rate: 150 }] }); assert.ok(has(r, "warn", "differs from the price list"));
r = run({ lines: [{ ...lines[0], hsn: "30049099" }] }); assert.ok(has(r, "warn", "chapter 33 or 34"));
r = run({ s: { ...s, invoice_date: "2027-04-02" } }); assert.ok(has(r, "warn", "The LUT is for 2026-27"));
r = run({ others: [{ firm_id: "VH", invoice_no: "EX70", invoice_date: "2026-10-01" }] }); assert.ok(has(r, "warn", "lower than EX70"));
r = run({ others: [{ firm_id: "VH", invoice_no: "EX60", invoice_date: "2026-11-30" }] }); assert.ok(has(r, "warn", "later than this invoice"));
r = run({ s: { ...s, po_date: "2026-11-01" } }); assert.ok(has(r, "error", "PO is dated after the invoice"));
// COA batch / expiry check
r = run({ country: { ...country, docs: ["COA"] }, attachments: [{ kind: "coa", facts: { batch_no: "HAZ-1222", mfg: "2026-10-01", exp: "2028-10-01" } }] });
assert.ok(has(r, "error", "shows exp 2028-10"));
r = run({ country: { ...country, docs: ["COA"] } }); assert.ok(has(r, "warn", "No COA attached for batch HAZ-1222"));
// saved copies: current -> fine, changed shipment -> stale
const inv = buildPaper("invoice", paperContext(s, lines, { firms: [firm], parties: [party], agents: [] }, false));
r = run({ saved: { invoice: { version: 1, input_hash: fingerprint(inv) } } }); assert.ok(!has(r, "warn", "no longer matches"));
r = run({ saved: { invoice: { version: 1, input_hash: "old" } } }); assert.ok(has(r, "warn", "no longer matches"));
// Free sale certificate: a government paper, so the audit checks validity and that it lists every product
const fscC = { ...country, docs: ["Free sale certificate"] };
r = run({ country: fscC, attachments: [{ kind: "fsc", ref_no: "1646", doc_date: "2023-09-22", facts: { valid_until: "2024-09-11", products: "NutroSense Radiant Glow Serum\nAzelux AZ Serum 30ML" } }] });
assert.ok(has(r, "error", "expired on 2024-09-11"));
r = run({ country: fscC, attachments: [{ kind: "fsc", doc_date: "2026-09-01", facts: { valid_until: "2028-09-11", products: "Olneu Recovery Cream" } }] });
assert.ok(has(r, "error", "does not list AZELUX AZ SERUM 30ML"));
r = run({ country: fscC, attachments: [{ kind: "fsc", doc_date: "2026-09-01", facts: { valid_until: "2028-09-11", products: "Azelux AZ Serum 30ml\nOlneu Recovery Cream" } }] });
assert.equal(r.items.filter((i) => i.area === "Outside documents" && i.level !== "info").length, 0);
r = run({ country: fscC, attachments: [{ kind: "fsc", facts: { valid_until: "2026-12-31", products: "Azelux AZ Serum 30ml" } }] });
assert.ok(has(r, "warn", "valid only up to"));
r = run({ country: { ...country, docs: ["Non-DG certificate"] } }); assert.ok(has(r, "warn", "Not yet prepared or attached: Non-DG certificate"));
// Myanmar: letter of authority validity and ingredient list data
const myC = { ...country, country: "Myanmar", docs: ["Letter of authority", "Ingredient list with percentages"] };
const myParty = { ...party, authority: { representative: "Mr. Wai", trademarks: "CutaPro", valid_from: "2026-05", valid_to: "2028-04" } };
const myProd = [{ id: "pr", hsn: "33049910", reg_product_id: "rp" }];
const goodF = { rp: [{ label: "Water", pct: 85 }, { label: "Glycerin", pct: 15 }] };
r = run({ country: myC, party: myParty, products: myProd, formulas: goodF });
assert.ok(!r.items.some((i) => ["Letter of authority", "Ingredient list"].includes(i.area)), JSON.stringify(r.items.filter((i) => ["Letter of authority", "Ingredient list"].includes(i.area))));
r = run({ country: myC, party: { ...myParty, authority: { ...myParty.authority, valid_to: "2026-09" } }, products: myProd, formulas: goodF }); assert.ok(has(r, "error", "does not cover the invoice date"));
r = run({ country: myC, party: { ...myParty, authority: {} }, products: myProd, formulas: goodF }); assert.ok(has(r, "error", "authorised person is not entered"));
r = run({ country: myC, party: myParty, products: [{ id: "pr", hsn: "33049910" }], formulas: goodF }); assert.ok(has(r, "error", "not linked to a Regulatory product"));
r = run({ country: myC, party: myParty, products: myProd, formulas: { rp: [{ label: "Water", pct: 80 }, { label: "Glycerin", pct: 5 }] } }); assert.ok(has(r, "warn", "add up to 85"));
r = run({ country: myC, party: myParty, products: myProd, formulas: { rp: [{ label: "Water", pct: 80 }, { label: "Glycerin" }] } }); assert.ok(has(r, "warn", "no percentage for 1 of 2"));
r = run({ country: myC, party: myParty, products: myProd, formulas: { rp: [] } }); assert.ok(has(r, "error", "has no formula yet"));
assert.ok(ATTACH.length > 10);
console.log("export audit tests passed");

// Stage 1: an order is received and only the proforma is made. No invoice number, batch, carton data or exchange rate needed.
{
  const po = { id: "s9", firm_id: "VH", country: "Nepal", party_id: "p", currency: "INR", status: "proforma", proforma_no: "PI_VH_25.11.2026", proforma_date: "2026-11-25", payment_terms: "100% advance", delivery_terms: "Ex-factory", final_destination: "Kathmandu" };
  const pl = [{ name: "AZELUX AZ SERUM 30ML", product_id: "pr", hsn: "33049910", qty: 1000, rate: 145 }];
  const r = auditShipment({ ...base, s: po, lines: pl });
  assert.equal(r.errors, 0, JSON.stringify(r.items.filter((i) => i.level === "error")));
  assert.ok(!r.items.some((i) => /batch|invoice number|carton|exchange/i.test(i.text) && i.level !== "info"));
  assert.ok(r.items.some((i) => i.area === "Next step"));
  const bad = auditShipment({ ...base, s: { ...po, proforma_no: "" }, lines: [{ ...pl[0], rate: "" }] });
  assert.ok(bad.items.some((i) => i.text.includes("proforma number")) && bad.items.some((i) => i.text.includes("rate is missing")));
  assert.deepEqual(Object.keys(r.papers), ["proforma"]);
  assert.ok(r.items.some((i) => i.area === "Order" && i.level === "warn"));                       // no copy of the buyer's order yet
  const withOrder = auditShipment({ ...base, s: po, lines: pl, attachments: [{ kind: "po", file_path: "x", facts: {} }] });
  assert.ok(!withOrder.items.some((i) => i.area === "Order"));
  console.log("proforma stage tests passed");
}
