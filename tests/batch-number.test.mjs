// Run with: node tests/batch-number.test.mjs
import assert from "node:assert/strict";
import { suggestBatchNo } from "../src/lib/batchCalc.js";

const r = (firm, kind, batch_no, mfg, extra = {}) => ({ firm_id: firm, kind, batch_no, group_no: batch_no.replace(/([0-9])[A-Za-z]$/, "$1"), mfg, series_year: +mfg.slice(0, 4), ...extra });
// real November 2026 numbers
const rows = [
  r("VH", "other", "HSK-1275", "2026-11-01"), r("VH", "other", "HZE-1269", "2026-11-01"), r("VH", "other", "HN1-1262", "2026-11-01"), r("VH", "other", "HZE-1227", "2026-10-01"),
  r("VH", "other", "HSK-1100", "2026-08-01"), r("VH", "other", "HAB-829", "2026-02-01"),
  r("VH", "tube", "558", "2026-11-01"), r("VH", "tube", "557", "2026-11-01"), r("VH", "tube", "527", "2026-10-01"), r("VH", "tube", "113", "2025-12-01"),
  r("VP", "other", "V-046B", "2026-11-01"), r("VP", "other", "V-045", "2026-11-01"), r("VP", "other", "V-042", "2025-12-01"),
  r("VP", "tube", "109", "2026-11-01"), r("VP", "tube", "108B", "2026-11-01"), r("VP", "tube", "130", "2025-12-01"),
];
// VH other: H + first two letters (or digits) of the product, running number carries on
assert.equal(suggestBatchNo(rows, "VH", "other", "AZELUX AZ SERUM 30ML", "2026-11-01"), "HAZ-1276");
assert.equal(suggestBatchNo(rows, "VH", "other", "N10 ADVANCE RADIANCE SERUM 30ML", "2026-11-01"), "HN1-1276");
assert.equal(suggestBatchNo(rows, "VH", "other", "OL'NEU RECOVERY CLEANSER 100ML", "2026-11-01"), "HOL-1276");
assert.equal(suggestBatchNo(rows, "VH", "other", "", "2026-11-01"), "");             // no product yet
assert.equal(suggestBatchNo(rows, "VH", "other", "AZELUX", "2027-01-01"), "HAZ-1276"); // the VH running number does not restart in January
// VH tubes: plain 3-digit running number, starting again after 999
assert.equal(suggestBatchNo(rows, "VH", "tube", "", "2026-11-01"), "559");
assert.equal(suggestBatchNo([r("VH", "tube", "999", "2026-11-01")], "VH", "tube", "", "2026-11-01"), "001");
assert.equal(suggestBatchNo([r("VH", "tube", "007", "2026-11-01")], "VH", "tube", "", "2026-11-01"), "008");
// VP: restarts every year; split children (046B) count as their mother
assert.equal(suggestBatchNo(rows, "VP", "other", "", "2026-11-01"), "V-047");
assert.equal(suggestBatchNo(rows, "VP", "tube", "", "2026-11-01"), "110");
assert.equal(suggestBatchNo(rows, "VP", "other", "", "2027-01-01"), "V-001");
assert.equal(suggestBatchNo(rows, "VP", "tube", "", "2027-01-01"), "001");
// deleted batches are ignored, nothing to go on gives no number
assert.equal(suggestBatchNo([r("VH", "other", "HSK-1999", "2026-11-01", { deleted_at: "x" }), ...rows], "VH", "other", "AZ", "2026-11-01"), "HAZ-1276");
assert.equal(suggestBatchNo([], "VH", "other", "AZ", "2026-11-01"), ""); assert.equal(suggestBatchNo(rows, "", "other", "AZ", "2026-11-01"), "");
console.log("batch number tests passed");
