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
// Myanmar: letter of authority (wording of the firm's own letter) and ingredient list from the Regulatory formula
const my = { ...d, parties: [{ ...d.parties[0], name: "Best Appearance Confidence Co., Ltd.", address: "73 B, 8th Street, Lanmadaw Township, Yangon, Myanmar 11131", authority: { representative: "Mr. Wai Lynn Htun", authority: "Food and Drug Administration, Myanmar", trademarks: "CutaPro, Cutacare", valid_from: "2026-05", valid_to: "2028-04" } }], products: [{ id: "pr", reg_product_id: "rp" }] };
const mylines = [{ ...lines[0], product_id: "pr", name: "CutaPro Antipigment Serum 30 ml" }, { ...lines[0], product_id: "pr", name: "Cutacare HA serum 30 ml" }];
const loa = buildPaper("loa", paperContext(s, mylines, my, true));
assert.ok(text(loa).includes("Authorization Letter") && text(loa).includes('under the trademarks \\"CutaPro\\" and \\"Cutacare\\"'));
assert.ok(text(loa).includes("1. CutaPro Antipigment Serum 30 ml") && text(loa).includes("2. Cutacare HA serum 30 ml"));
assert.ok(text(loa).includes("Mr. Wai Lynn Htun in order to contact the Food and Drug Administration, Myanmar"));
assert.ok(text(loa).includes("valid from May, 2026 to April, 2028") && text(loa).includes("Sangeeta Verma"));
assert.equal(kindOfCountryDoc("Letter of authority"), "loa");
const il = buildPaper("ingredients", paperContext(s, [mylines[0]], my, true, [], { rp: [{ label: "Water", inci_name: "Aqua", pct: 80 }, { label: "Glycerin", pct: 15 }, { label: "Niacinamide", pct: 5 }] }));
assert.ok(text(il).includes("INGREDIENT LIST WITH PERCENTAGE COMPOSITION") && text(il).includes("Aqua") && text(il).includes('"Total","100"'));
assert.ok(text(buildPaper("ingredients", paperContext(s, [mylines[0]], my, true, [], {}))).includes("formula not available"));
assert.equal(kindOfCountryDoc("Ingredient list with percentages"), "ingredients");
// Customs office of the non-narcotics letter: Mundra for sea (Yemen), IGIA for air (Iraq)
const sea = { ...s, transport_mode: "road+sea", entry_point: "Mundra Port (INMUN1)" };
const nm = buildPaper("narcotics", paperContext(sea, lines, d, true));
assert.ok(text(nm).includes("The Assistant Commissioner of Customs") && text(nm).includes("Mundra Port") && !text(nm).includes("IGIA"));
assert.ok(text(buildPaper("narcotics", paperContext({ ...s, transport_mode: "air", entry_point: "IGI Airport New Delhi (INDEL4)" }, lines, d, true))).includes("IGIA, Cargo Complex"));
console.log("export document tests passed");

// Carton text: one label per carton, brand owner and manufacturer lines
{
  const dd = { ...d, parties: [...d.parties, { id: "bo", name: "OTC PHARMA", address: "Baghdad, Iraq", ids: {} }], countries: [{ country: "Iraq", label_rule: "FOR SALE IN IRAQ ONLY" }] };
  const sh = { ...s, country: "Iraq", brand_owner_id: "bo" };
  const ct = buildPaper("carton", paperContext(sh, lines, { ...dd, firms: [{ ...dd.firms[0], dl_no: "89-COS-PB" }] }, true));
  const labels = ct.blocks.filter((b) => b.t === "row").flatMap((b) => b.items);
  assert.equal(labels.length, 14);                                                     // 1000 pcs, 72 per carton: 14 cartons
  assert.equal(labels[0].label, "Carton 1 of 14"); assert.equal(labels[13].label, "Carton 14 of 14");
  assert.ok(labels[0].lines.some((x) => x.includes("BRAND OWNER: OTC PHARMA, Baghdad, Iraq")) && labels[0].lines.some((x) => x.includes("Mfg. Lic. No. 89-COS-PB")));
  assert.ok(labels[0].lines.some((x) => x.includes("QUANTITY: 72 pcs")) && labels[13].lines.some((x) => x.includes("QUANTITY: 64 pcs")));
  assert.ok(labels[0].lines.includes("FOR SALE IN IRAQ ONLY"));
  assert.equal(kindOfCountryDoc("Brand-owner carton text"), "carton");
  console.log("carton text tests passed");
}
