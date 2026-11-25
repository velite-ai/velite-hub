// Run with: node tests/shipment.test.mjs
import assert from "node:assert/strict";
import { packLines, totals, preflight } from "../src/lib/shipment.js";

// Real shipment EX65 (Nuderma, Oct 2026): 1000 pcs, 72 per carton, 2.2 / 8.9 kg, part carton typed as 2.0 / 8.0
const ex65 = packLines([{ qty: 1000, pcs_per_carton: 72, net_kg: 2.2, gross_kg: 8.9, partial_net: 2.0, partial_gross: 8.0 }]);
assert.equal(ex65.boxes, 14); assert.equal(ex65.net, 30.6); assert.equal(ex65.gross, 123.7);
assert.deepEqual([ex65.rows[0].from, ex65.rows[0].to, ex65.rows[1].from], [1, 13, 14]);
// part carton defaults in proportion when nothing is typed
const d = packLines([{ qty: 1000, pcs_per_carton: 72, net_kg: 2.2, gross_kg: 8.9 }]);
assert.equal(d.rows[1].net, 2.0); assert.equal(d.rows[1].gross, 7.9);
// two lines are numbered one after the other
const two = packLines([{ qty: 144, pcs_per_carton: 72, net_kg: 2, gross_kg: 8 }, { qty: 60, pcs_per_carton: 60, net_kg: 4, gross_kg: 5 }]);
assert.deepEqual(two.rows.map((r) => [r.from, r.to]), [[1, 2], [3, 3]]); assert.equal(two.boxes, 3);
// no carton size -> flagged, not guessed
assert.equal(packLines([{ qty: 10 }]).rows[0].unknown, true);
assert.deepEqual(totals([{ qty: 1000, rate: 145 }]), { qty: 1000, amount: 145000 });

const firm = { id: "VH", name: "VH", iec: "1", gstin: "g", signatory_name: "S", bank: { account: "1", ifsc: "X" }, lut: { no: "L" } };
const party = { name: "P", address: "a", ids: { PAN: "1" }, usual_firm: "VH" };
const s = { firm_id: "VH", invoice_no: "EX70", invoice_date: "2026-11-20", currency: "INR", final_destination: "Kathmandu" };
const good = { name: "A", hsn: "3304", qty: 100, rate: 10, pcs_per_carton: 50, net_kg: 1, gross_kg: 2, batch_no: "B1", mfg: "2026-10-01", exp: "2028-09-01", batch_id: "b" };
const ctx = (o = {}) => ({ firm, party, country: { party_ids: ["PAN", "EXIM"] }, today: "2026-11-25", others: [], batchState: { b: "released" }, ...o });
assert.ok(preflight(s, [good], ctx()).some((x) => x.text.includes("EXIM")));                 // missing buyer ID
assert.equal(preflight(s, [good], ctx({ country: { party_ids: ["PAN"] } })).filter((x) => x.level === "error").length, 0);
assert.ok(preflight(s, [good], ctx({ country: { party_ids: [] }, batchState: { b: "awaiting_qc" } })).some((x) => x.text.includes("not released")));
assert.ok(preflight(s, [{ ...good, exp: "2027-03-01" }], ctx({ country: { party_ids: [] } })).some((x) => x.level === "warn" && x.text.includes("shelf life")));
assert.ok(preflight(s, [{ ...good, exp: "2026-10-01" }], ctx({ country: { party_ids: [] } })).some((x) => x.text.includes("expired")));
assert.ok(preflight({ ...s, currency: "USD" }, [good], ctx({ country: { party_ids: [] } })).some((x) => x.text.includes("exchange rate")));
assert.ok(preflight(s, [good], ctx({ country: { party_ids: [] }, others: [{ firm_id: "VH", invoice_no: "ex70" }] })).some((x) => x.text.includes("already used")));
console.log("shipment tests passed");
