import { LIBRARY, FLAGS } from "./library.mjs";
import { writeFileSync } from "fs";
const rows = LIBRARY.map((x, i) => ({ code: x.code, dept: x.dept, title: x.title, what: x.what, applies: x.applies, rule: x.r, risk: x.risk, lead: x.lead,
  law: x.law, authority: x.authority, portal: x.portal, form: x.form, penalty: x.penalty, evidence: x.evidence, src: x.src, sort: i }));
writeFileSync(new URL("./library.json", import.meta.url), JSON.stringify(rows));
writeFileSync(new URL("../../src/pages/compliance/flags.json", import.meta.url), JSON.stringify(FLAGS, null, 1));
console.log(rows.length);
