// Run with: node tests/export-mail.test.mjs
import assert from "node:assert/strict";
import { SENDERS, CC_ALWAYS, parseEmails, isEmail, proformaMail } from "../src/lib/exportMail.js";

assert.equal(CC_ALWAYS, "velite@velite.in");
assert.deepEqual(SENDERS.map((s) => s.label), ["thirdparty@velite.in", "tp2.velite@gmail.com"]);
assert.ok(SENDERS.every((s) => s.from.endsWith("@velite.in")));                         // always sent through the verified domain
assert.equal(SENDERS[1].replyTo, "tp2.velite@gmail.com");                              // the Gmail choice gets the replies
assert.ok(isEmail("a@b.co") && !isEmail("a@b") && !isEmail("a b@c.com") && !isEmail(""));
assert.deepEqual(parseEmails("A@x.com, b@y.com; a@x.com\nbad@, c@z.in"), { list: ["a@x.com", "b@y.com", "c@z.in"], bad: ["bad@"] });
const m = proformaMail({ firm: { name: "Velite Healthcare", signatory_name: "Sangeeta Verma", phone: "+91-97807-44143", email: "velitehealthcare@yahoo.co.in" },
  party: { name: "P S Cosmo Traders" }, shipment: { proforma_no: "PI_VH_14.05.2026", proforma_date: "2026-05-14", currency: "INR", po_no: "P.O. 001", po_date: "2026-06-08", payment_terms: "100% advance" }, items: 1, total: 353000 });
assert.equal(m.subject, "Proforma Invoice PI_VH_14.05.2026 - Velite Healthcare");
assert.ok(m.body.startsWith("Dear P S Cosmo Traders,"));
assert.ok(m.body.includes("Proforma Invoice No. PI_VH_14.05.2026 dated 14.05.2026 against your order P.O. 001 dated 08.06.2026, for 1 item, total INR 3,53,000.00"));
assert.ok(m.body.includes("(100% advance)") && m.body.includes("Sangeeta Verma") && m.body.includes("Velite Healthcare"));
const usd = proformaMail({ firm: { name: "Velite India" }, party: { name: "X", contact_person: "Mr. Rahman" }, shipment: { proforma_no: "VI_PI_01.01.2026", proforma_date: "2026-01-01", currency: "USD" }, items: 3, total: 1748 });
assert.ok(usd.body.startsWith("Dear Mr. Rahman,") && usd.body.includes("for 3 items, total USD 1,748.00") && !usd.body.includes("against your order"));
console.log("export mail tests passed");
