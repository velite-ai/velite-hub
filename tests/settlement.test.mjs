// Run with: node tests/settlement.test.mjs
import assert from "node:assert/strict";
import { addMonths, daysBetween, settlementOf, partyTotals, takesPayment } from "../src/lib/settlement.js";

assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
assert.equal(addMonths("2026-04-11", 9), "2027-01-11");
assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
assert.equal(addMonths("2026-06-15", 12), "2027-06-15");
assert.equal(daysBetween("2026-11-28", "2026-12-28"), 30);

const lines = [{ qty: 1000, rate: 145 }];           // EX65: 1,45,000.00
const ship = { invoice_date: "2026-10-24", status: "dispatched", invoice_no: "EX65" };
let s = settlementOf(ship, lines, [], "2026-11-28");
assert.equal(s.billed, 145000); assert.equal(s.status, "Pending"); assert.equal(s.dueOn, "2027-07-24"); assert.equal(s.balance, 145000);
s = settlementOf(ship, lines, [{ amount: 50000 }], "2026-11-28");
assert.equal(s.status, "Part received"); assert.equal(s.balance, 95000);
s = settlementOf(ship, lines, [{ amount: 100000 }, { amount: 45000 }], "2026-11-28");
assert.equal(s.status, "Settled"); assert.equal(s.needsBrc, true); assert.equal(s.needsEdpms, true);
s = settlementOf({ ...ship, brc_no: "X1", edpms_closed: true }, lines, [{ amount: 145000 }], "2026-11-28");
assert.equal(s.needsBrc, false); assert.equal(s.needsEdpms, false);
// bank charges written off settle the invoice
s = settlementOf({ ...ship, write_off: 250 }, lines, [{ amount: 144750 }], "2026-11-28");
assert.equal(s.status, "Settled");
// overdue after the period (9 months from 2026-01-10 is 2026-10-10)
s = settlementOf({ ...ship, invoice_date: "2026-01-10" }, lines, [{ amount: 1000 }], "2026-11-28");
assert.equal(s.status, "Overdue"); assert.equal(s.overdueDays, 49);
// own period per shipment
s = settlementOf({ ...ship, invoice_date: "2026-01-10", due_months: 15 }, lines, [], "2026-11-28");
assert.equal(s.status, "Pending");
// due soon
s = settlementOf({ ...ship, invoice_date: "2026-02-20" }, lines, [], "2026-11-28"); // due 2026-11-20 -> overdue
assert.equal(s.status, "Overdue");
s = settlementOf({ ...ship, invoice_date: "2026-03-05" }, lines, [], "2026-11-28");  // due 2026-12-05 -> 7 days
assert.equal(s.dueSoon, true); assert.equal(s.daysLeft, 7);
assert.equal(settlementOf(ship, [], [], "2026-11-28").status, "No value");
assert.equal(takesPayment({ invoice_no: "EX1", status: "dispatched" }), true);
assert.equal(takesPayment({ invoice_no: "EX1", status: "proforma" }), false);
assert.equal(takesPayment({ invoice_no: null, status: "dispatched" }), false);

const tp = partyTotals([
  { partyId: "a", partyName: "A", currency: "INR", invoiceDate: "2026-05-01", s: { billed: 100, received: 40, balance: 60, status: "Overdue" } },
  { partyId: "a", partyName: "A", currency: "INR", invoiceDate: "2026-06-01", s: { billed: 50, received: 50, balance: 0, status: "Settled" } },
  { partyId: "b", partyName: "B", currency: "USD", invoiceDate: "2026-04-07", s: { billed: 20, received: 0, balance: 20, status: "Pending" } },
]);
assert.equal(tp.length, 2); assert.deepEqual([tp[0].invoices, tp[0].billed, tp[0].received, tp[0].balance, tp[0].overdue, tp[0].lastInvoice], [2, 150, 90, 60, 1, "2026-06-01"]);
console.log("settlement tests passed");
