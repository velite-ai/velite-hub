// Run with: node tests/export-docs.test.mjs
import assert from "node:assert/strict";
import { amountWords, wordsIndian, buildPaper, paperContext, kindOfCountryDoc, fingerprint } from "../src/lib/exportDocs.js";

assert.equal(amountWords(145000, "INR"), "Rs. One Lac Forty Five Thousand only");   // as printed on EX65
assert.equal(wordsIndian(1234567), "Twelve Lac Thirty Four Thousand Five Hundred Sixty Seven");
assert.equal(amountWords(1250.5, "USD"), "US Dollars One Thousand Two Hundred Fifty and Fifty Cents only");
assert.equal(amountWords(530000, "INR"), "Rs. Five Lac Thirty Thousand only");

const d = { firms: [{ id: "VH", name: "Velite Healthcare", address: "First Floor, Derma Wing, Grewal Nagar, Hambran 141110", iec: "3012013458", gstin: "03ACQPV5065L1ZY", signatory_name: "Sangeeta Verma", signatory_title: "Proprietor", bank: { account: "393905000325" }, lut: {} }],
  parties: [{ id: "p", name: "NU DERMA ENTERPRISES PVT. LTD.", address: "Kathmandu", ids: { PAN: "606692753", EXIM: "6066927530123NP" } }], agents: [] };
const s = { firm_id: "VH", party_id: "p", currency: "INR", invoice_no: "EX65", invoice_date: "2026-10-24", transport_mode: "road", country: "Nepal" };
const lines = [{ name: "AZELUX AZ SERUM 30ML", hsn: "33049910", batch_no: "HAZ-1222", mfg: "2026-10-01", exp: "2028-09-01", qty: 1000, rate: 145, pcs_per_carton: 72, net_kg: 2.2, gross_kg: 8.9, partial_net: 2.0, partial_gross: 8.0 }];
const c = paperContext(s, lines, d, true);
const inv = buildPaper("invoice", c), pl = buildPaper("packing", c), dec = buildPaper("declaration", c), coo = buildPaper("coo", c), pi = buildPaper("proforma", c);
const text = (p) => JSON.stringify(p.blocks);
assert.ok(text(inv).includes("Rs. One Lac Forty Five Thousand only"));
assert.ok(text(inv).includes("1,45,000.00"));                     // Indian grouping for rupees
assert.ok(text(inv).includes("10/26") && text(inv).includes("09/28"));
assert.ok(text(pl).includes("BOX# 1-13") && text(pl).includes("BOX# 14") && text(pl).includes("30.6"));
assert.ok(text(dec).includes("CASE# 1-14") && text(dec).includes("EX65 dated 24.10.2026"));
assert.ok(text(coo).includes("TOTAL NO OF BOXES: 14") && text(coo).includes("Indian Origin"));
assert.ok(text(pi).includes("PROFORMA INVOICE"));
// the signatory's name is printed, never a signature image
for (const p of [inv, pl, dec, coo, pi]) assert.ok(text(p).includes("Sangeeta Verma") && !/\.(png|jpg|jpeg)/i.test(text(p)));
// a letterhead print leaves a blank gap instead of the firm header
assert.equal(buildPaper("invoice", paperContext(s, lines, d, false)).blocks[0].t, "gap");
assert.equal(kindOfCountryDoc("Export invoice (under LUT)"), "invoice");
assert.equal(kindOfCountryDoc("E-invoice and e-way bill"), null);
assert.equal(kindOfCountryDoc("Narcotics / SCOMET declaration"), "narcotics");
assert.equal(kindOfCountryDoc("Declaration (not SCOMET / NDPS, no CDSCO NOC)"), "declaration");
assert.equal(kindOfCountryDoc("Certificate of origin"), "coo");
assert.equal(kindOfCountryDoc("MSDS"), null);
assert.equal(fingerprint(inv), fingerprint(buildPaper("invoice", c)));
// Non-DG declaration (wording of the firm's own format, as used for air shipments)
const ndg = buildPaper("nondg", c);
assert.ok(text(ndg).includes("NON DANGEROUS GOODS DECLARATION") && text(ndg).includes("65th of IATA Dangerous Goods Regulations"));
assert.ok(text(ndg).includes("33049910 AZELUX AZ SERUM 30ML") && text(ndg).includes("BOXES 1-14") && text(ndg).includes("Name and address of shipper") && text(ndg).includes("Sangeeta Verma"));
assert.equal(kindOfCountryDoc("Non-DG certificate"), "nondg");
// Non-narcotics letter to Customs (Iraq, by air via Delhi): shipping bill number and date are filled in once the shipping bill is attached
const air = { ...s, transport_mode: "air" };
const nl = buildPaper("narcotics", paperContext(air, lines, d, true));
assert.ok(text(nl).includes("Deputy Commissioner of Customs") && text(nl).includes("IGIA, Cargo Complex") && text(nl).includes("Non-Narcotics Drugs") && text(nl).includes("Inv. No. EX65"));
assert.ok(text(nl).includes("S/B No.: ____________"));
const nl2 = buildPaper("narcotics", paperContext(air, lines, d, true, [{ kind: "shipping_bill", ref_no: "1455799", doc_date: "2026-10-26", facts: {} }]));
assert.ok(text(nl2).includes("S/B No.: 1455799") && text(nl2).includes("Dt.: 26.10.2026"));
assert.ok(text(nl2).includes("Sangeeta Verma"));
console.log("export document tests passed");
