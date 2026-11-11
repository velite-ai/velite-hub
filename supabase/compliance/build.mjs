import { LIBRARY, FLAGS } from "./library.mjs";
import { writeFileSync } from "fs";
import { CHECKS, CHECK_DEPTS } from "./checks.mjs";
const rows = LIBRARY.map((x, i) => ({ code: x.code, dept: x.dept, title: x.title, what: x.what, applies: x.applies, rule: x.r, risk: x.risk, lead: x.lead,
  law: x.law, authority: x.authority, portal: x.portal, form: x.form, penalty: x.penalty, evidence: x.evidence, src: x.src, sort: i }));
writeFileSync(new URL("./library.json", import.meta.url), JSON.stringify(rows));
writeFileSync(new URL("../../src/pages/compliance/flags.json", import.meta.url), JSON.stringify(FLAGS, null, 1));
writeFileSync(new URL("./checks.json", import.meta.url), JSON.stringify(CHECKS.map((c, i) => ({ ...c, sort: i }))));
writeFileSync(new URL("../../src/pages/compliance/checkDepts.json", import.meta.url), JSON.stringify(CHECK_DEPTS));
console.log(rows.length, CHECKS.length);
