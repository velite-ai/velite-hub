// Run with: node tests/batch-calc.test.mjs
import assert from "node:assert/strict";
import { expiryFor, shelfOf, lastShelfMonths, uspFor } from "../src/lib/batchCalc.js";

// "Best before 24 months from the month of manufacturing": 10/26 -> 09/28 (real EX65 batch HAZ-1222)
assert.equal(expiryFor("2026-10-01", 24), "2028-09-01");
assert.equal(expiryFor("2026-01-01", 24), "2027-12-01");
assert.equal(expiryFor("2026-06-01", 18), "2027-11-01");
assert.equal(expiryFor("2026-03-01", 36), "2029-02-01");
assert.equal(expiryFor("2026-03-01", 1), "2026-03-01");
assert.equal(expiryFor("", 24), ""); assert.equal(expiryFor("2026-10-01", ""), "");
// and back: mfg + exp -> months
assert.equal(shelfOf("2026-10-01", "2028-09-01"), 24); assert.equal(shelfOf("2026-06-01", "2027-11-01"), 18);
assert.equal(shelfOf("2026-10-01", "2026-10-01"), null);                   // nonsense is not offered as a default
// the months of the last batch of the same product and firm
const rows = [
  { id: "1", firm_id: "VH", product_name: "SKINOPERF AZ SERUM 30ML", mfg: "2026-01-01", exp: "2027-12-01", created_at: "2026-01-02" },
  { id: "2", firm_id: "VH", product_name: "Skinoperf AZ Serum 30 ml", mfg: "2026-09-01", exp: "2027-02-01", shelf_months: 18, created_at: "2026-09-02" },
  { id: "3", firm_id: "VP", product_name: "SKINOPERF AZ SERUM 30ML", mfg: "2026-10-01", exp: "2027-03-01", shelf_months: 6 },
  { id: "4", firm_id: "VH", product_name: "OTHER", mfg: "2026-09-01", exp: "2028-08-01" },
];
assert.equal(lastShelfMonths(rows, "VH", "SKINOPERF AZ SERUM 30ML"), 18);   // newest batch of that product, other spelling, other firm ignored
assert.equal(lastShelfMonths(rows, "VH", "SKINOPERF AZ SERUM 30ML", "2"), 24); // when editing batch 2, the one before it counts
assert.equal(lastShelfMonths(rows, "VH", "NEW PRODUCT"), null);
// unit sale price = MRP / pack size (checked against stored values)
assert.equal(uspFor(1460, "30"), 48.67); assert.equal(uspFor(330, "100"), 3.3); assert.equal(uspFor(230, "150"), 1.53);
assert.equal(uspFor(950, "200 ml"), 4.75); assert.equal(uspFor(1499, "50g"), 29.98); assert.equal(uspFor(650, "30 ML"), 21.67);
assert.equal(uspFor("", "30"), null); assert.equal(uspFor(100, ""), null); assert.equal(uspFor(100, "pack"), null);
console.log("batch calculation tests passed");
