import assert from "node:assert/strict";
import { productsForBrand, statusGroup, groupByParty } from "../src/lib/thirdParty.js";

const names = ["ALOPRIME CREAM 100 G", "Aloprime cream 100G", "ALOPRIME LOTION 200 ML", "ALOPRIME-LOTION 200ML", "AGLEA GEL", "SOFTITE", "Other"];
assert.deepEqual(productsForBrand("Aloprime", names).length, 2);
assert.deepEqual(productsForBrand("AGLEA", names), ["AGLEA GEL"]);
assert.deepEqual(productsForBrand("UVPRIME", names), []);
assert.deepEqual(productsForBrand("PRIME", names), []); // whole word only
assert.equal(statusGroup("Registered"), "Registered");
assert.equal(statusGroup("Objected"), "Opposed");
assert.equal(statusGroup("Not Applied"), "Not registered");
assert.equal(statusGroup("Applied / Filed"), "Applied");

const rows = [
  { client: "Dermaprime", brand: "ALOPRIME", status: "Opposed", products: ["VELITE"], undertaking_name: "u.pdf" },
  { client: "dermaprime ", brand: "UVPRIME", status: "Objected", products: ["VELITE"] },
  { client: "Jain", brand: "AGLEA", status: "Registered", products: ["VELITE"], undertaking_date: "2026-01-01" },
];
const g = groupByParty(rows, names);
assert.equal(g.length, 2);
assert.equal(g[0].client, "Dermaprime");
assert.equal(g[0].brands.length, 2);
assert.equal(g[0].status.Opposed, 2);
assert.deepEqual(g[0].undertaking, { available: 1, notAvailable: 1 });
assert.equal(g[0].products.length, 2);
assert.equal(g[1].products.length, 1);
// no access to products: stored list is used, the "VELITE" placeholder is not a product
assert.equal(groupByParty(rows, null)[0].products.length, 0);
console.log("third-party tests passed");
