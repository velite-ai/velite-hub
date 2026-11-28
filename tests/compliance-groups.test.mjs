// Run with: node tests/compliance-groups.test.mjs
import assert from "node:assert/strict";
import { groupItems, sectionsOf, mostUrgent, chipState, nextMonth } from "../src/lib/complianceGroups.js";

const today = "2026-11-28", goLive = "2026-11-08";
const lib = { MSE: { title: "Pay MSE suppliers within 45 days", dept: "Finance & Tax", risk: "M" }, GST: { title: "GSTR-3B", dept: "Finance & Tax", risk: "H" } };
const it = (id, code, firm, due, status = "pending", extra = {}) => ({ id, code, firm_id: firm, due_date: due, period_label: "P", status, ...extra });
const items = [
  it(1, "MSE", "VH", "2026-10-05"), it(2, "MSE", "VP", "2026-10-05"), it(3, "MSE", "VI", "2026-10-05", "verified"), it(4, "MSE", "VS", "2026-10-05"), // old catch-up, one done
  it(5, "GST", "VH", "2026-11-20"), it(6, "GST", "VP", "2026-11-20", "filed"), // this month, late
  it(7, "GST", "VH", "2026-12-20"), it(8, "GST", "VP", "2026-12-20"),         // next month
  it(9, "GST", "VH", "2027-01-20"),                                            // later
  it(10, "GST", "VH", "2026-12-01", "pending", { deleted_at: "2026-11-01" }), // removed: ignored
  it(11, "MSE", "VH", "2026-10-05", "pending", { licence_id: "L", period_label: "Q" }),           // expired licence is never old backlog
];
const g = groupItems(items, lib, { today, goLive });
const mse = g.find((x) => x.code === "MSE" && !x.items.some((i) => i.licence_id));
assert.equal(mse.items.length, 4); assert.equal(mse.open, 3); assert.equal(mse.done, 1); assert.equal(mse.backlog, true); assert.equal(mse.late, 3);
assert.deepEqual(mse.states, ["late", "done", "late", "late"]);
const nov = g.find((x) => x.due === "2026-11-20"); assert.equal(nov.late, 1); assert.equal(nov.tone, "red"); assert.equal(nov.open, 1);
assert.equal(g.some((x) => x.due === "2026-12-01"), false);
const lic = g.find((x) => x.items.some((i) => i.licence_id)); assert.equal(lic.backlog, false);

const s = sectionsOf(g, today);
assert.deepEqual(s.map((x) => x.key), ["2026-10", "2026-11", "2026-12", "2027-01", "backlog"]);
assert.deepEqual(s.map((x) => x.open), [false, true, true, false, false]);   // this and next month open; October (licence one) folded
assert.equal(s.at(-1).count, 1);
const u = mostUrgent(g, 5);
assert.deepEqual(u.map((x) => x.due), ["2026-10-05", "2026-11-20", "2026-12-20", "2027-01-20"]); // licence group (not backlog) leads; old catch-up excluded
assert.equal(chipState(it(1, "A", "VH", "2026-12-02"), today), "soon");
assert.equal(chipState(it(1, "A", "VH", "2026-12-20"), today), "open");
assert.equal(nextMonth("2026-12"), "2027-01");
console.log("compliance group tests passed");
