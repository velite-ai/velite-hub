// Run with: node tests/party-history.test.mjs
import assert from "node:assert/strict";
import { partyHistory } from "../src/lib/partyHistory.js";

const ships = [
  { id: "1", party_id: "p", invoice_no: "EX1", invoice_date: "2026-05-01", status: "dispatched", currency: "INR" },
  { id: "2", party_id: "p", invoice_no: "EX2", invoice_date: "2026-07-01", status: "closed", currency: "INR" },
  { id: "3", party_id: "p", invoice_no: null, proforma_date: "2026-11-01", status: "proforma", currency: "INR" },
  { id: "4", party_id: "p", invoice_no: "EX4", invoice_date: "2026-06-01", status: "dispatched", currency: "INR", deleted_at: "2026-06-02" },
  { id: "5", party_id: "q", invoice_no: "EX5", invoice_date: "2026-04-07", status: "dispatched", currency: "USD" },
];
const lines = { 1: [{ name: "A", qty: 10, rate: 5 }], 2: [{ name: "A", qty: 20, rate: 5 }, { name: "B", qty: 1, rate: 100 }], 3: [{ name: "C", qty: 5, rate: 5 }], 5: [{ name: "Z", qty: 100, rate: 0.5 }] };
const recs = { 1: [{ amount: 50 }], 2: [{ amount: 100 }] };
const h = partyHistory(ships, lines, recs, "2026-11-28");
assert.equal(h.p.orders.length, 3);                                   // deleted one left out, proforma kept
assert.deepEqual(h.p.orders.map((o) => o.ship.id), ["3", "2", "1"]); // newest first
assert.equal(h.p.byCurrency.INR.orders, 2);                           // proforma is not billed yet
assert.deepEqual([h.p.byCurrency.INR.billed, h.p.byCurrency.INR.received, h.p.byCurrency.INR.balance], [250, 150, 100]);
assert.equal(h.p.lastDate, "2026-07-01"); assert.equal(h.p.firstDate, "2026-05-01");
assert.deepEqual(h.p.products, { A: 30, B: 1 });
assert.equal(h.p.orders[0].status, null);
assert.equal(h.q.byCurrency.USD.billed, 50);
console.log("party history tests passed");
