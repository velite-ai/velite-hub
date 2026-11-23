// QC Release register: shared rules (stages, status of a record, numbers for the charts) and the one-time
// reader for the old "Material Release Table" Excel sheet.

export const STAGES = {
  raw: { key: "raw", title: "Raw material", short: "Raw", icon: "🧪", color: "#1a6fa8", item: "Raw material", hasMicro: false },
  packing: { key: "packing", title: "Packing material", short: "Packing", icon: "📦", color: "#6c3483", item: "Packing material", hasMicro: false },
  bulk: { key: "bulk", title: "Bulk", short: "Bulk", icon: "🧴", color: "#0f766e", item: "Generic name", hasMicro: true },
  fp: { key: "fp", title: "Finished product", short: "Finished", icon: "✅", color: "#b45309", item: "Brand name", hasMicro: true },
};
export const STAGE_KEYS = Object.keys(STAGES);
export const FIRMS = ["VP", "VH"];
export const REMARKS = ["Approved", "Not approved", "On hold"];

// ── dates ──────────────────────────────────────────────────────────────────
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const toDate = (s) => (s ? new Date(`${s}T00:00:00`) : null);
export const daysBetween = (a, b) => (a && b ? Math.round((toDate(b) - toDate(a)) / 86400000) : null);
export const fmtD = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
export const fmtT = (t) => (t ? String(t).slice(0, 5) : "");
export const fmtM = (s) => (s ? `${s.slice(5, 7)}/${s.slice(2, 4)}` : "");
export const monthKey = (s) => (s ? s.slice(0, 7) : null);
export const monthLabel = (k) => { const [y, m] = k.split("-"); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m - 1]} ${y.slice(2)}`; };
export const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ── what state is a record in? ─────────────────────────────────────────────
// awaiting_sample → awaiting_qc → awaiting_micro (bulk / finished only) → released.  Or: rejected / hold.
export function stateOf(r, today = todayISO()) {
  const st = STAGES[r.stage];
  if (r.qc_remarks === "Not approved" || r.micro_remarks === "Not approved") return "rejected";
  if (r.qc_remarks === "On hold" || r.micro_remarks === "On hold") return "hold";
  if (!r.sampling_date && !r.qc_release_date && !r.qc_remarks) { const a = daysBetween(r.entry_date, today); return a != null && a <= 45 ? "awaiting_sample" : "incomplete"; } // an old record with no sampling date is a gap in the data, not a queue
  if (!r.qc_release_date && !r.qc_remarks) return "awaiting_qc";
  if (st.hasMicro && !r.micro_release_date && !r.micro_remarks && !r.final_release_date) {
    // old records that never had a micro date are not "waiting"; only recent ones are
    const age = daysBetween(r.qc_release_date || r.sampling_date, today);
    return age != null && age <= 30 ? "awaiting_micro" : "released";
  }
  return "released";
}
export const STATE_LABEL = {
  awaiting_sample: "Not sampled yet", incomplete: "No sampling date", awaiting_qc: "Waiting for QC", awaiting_micro: "Waiting for Micro",
  released: "Released", rejected: "Not approved", hold: "On hold",
};
export const STATE_COLOR = {
  awaiting_sample: "#64748b", incomplete: "#94a3b8", awaiting_qc: "#d97706", awaiting_micro: "#2563eb", released: "#16a34a", rejected: "#dc2626", hold: "#9333ea",
};
export const isWaiting = (s) => s === "awaiting_qc" || s === "awaiting_micro" || s === "awaiting_sample" || s === "hold";

// the day the batch was finally released (for the waiting-time numbers)
export function releaseDate(r) {
  if (r.final_release_date) return r.final_release_date;
  const ds = [r.qc_release_date, r.micro_release_date].filter(Boolean).sort();
  return ds.length ? ds[ds.length - 1] : null;
}
// days from sampling to QC release / to final release; null when a date is missing or the order is wrong
export function qcDays(r) { const d = daysBetween(r.sampling_date, r.qc_release_date); return d != null && d >= 0 && d <= 90 ? d : null; }
export function totalDays(r) { const d = daysBetween(r.sampling_date, releaseDate(r)); return d != null && d >= 0 && d <= 90 ? d : null; }
export const median = (xs) => { const a = xs.filter((x) => x != null).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export const avg = (xs) => { const a = xs.filter((x) => x != null); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };

// the QC Head's tentative date of release against what happened
export const tentativeGap = (r) => { const a = releaseDate(r); return r.tentative_release_date && a ? daysBetween(r.tentative_release_date, a) : null; }; // + = later than planned
export const tentativeFor = (r) => (r.qc_release_date && !r.micro_release_date && r.micro_tentative_date ? r.micro_tentative_date : r.tentative_release_date); // once QC is done and micro is waiting, the micro date counts
export const overdueDays = (r, today) => { const t = tentativeFor(r); return t && t < today ? daysBetween(t, today) : null; };

// checks shown to the person filling the form
export function warningsFor(f) {
  const w = [];
  if (f.sampling_date && f.entry_date && f.sampling_date < f.entry_date) w.push("Sampling date is before the date received.");
  if (f.sampling_date && f.qc_release_date && f.qc_release_date < f.sampling_date) w.push("QC release date is before the sampling date.");
  if (f.qc_release_date && f.micro_release_date && f.micro_release_date < f.sampling_date) w.push("Micro release date is before the sampling date.");
  if (f.tentative_release_date && f.sampling_date && f.tentative_release_date < f.sampling_date) w.push("Tentative release date is before the sampling date.");
  if (f.mfg && f.exp && f.exp < f.mfg) w.push("Expiry is before the manufacturing month.");
  if (f.qc_release_date && !f.qc_remarks) w.push("Add the QC remark (Approved / Not approved / On hold).");
  return w;
}

// ── one-time import of the old sheet ───────────────────────────────────────
const NA = new Set(["", "na", "n/a", "-", "--", "nil", "n.a.", "n.a"]);
const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const txt = (c) => { const t = clean(c && (c.w ?? c.v)); return NA.has(t.toLowerCase()) ? null : t; };
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null; };

export function makeReaders(XLSX) {
  const isDateCell = (c) => c && typeof c.v === "number" && c.z && XLSX.SSF.is_date(c.z);
  // a date typed day/month but stored month/day (cell format starts with the month) is turned back
  const monthFirst = (z) => /^\[?\$?-?[a-z0-9]*\]?\s*m{1,2}\s*[/.-]\s*d{1,2}/i.test(String(z || "")) && !/^d/i.test(String(z));
  function date(c, flags, label) {
    if (!c || c.v == null || c.v === "") return null;
    if (isDateCell(c)) {
      const p = XLSX.SSF.parse_date_code(c.v);
      if (!p) { flags.push(`${label}: unreadable date`); return null; }
      if (monthFirst(c.z)) { const sw = iso(p.y, p.d, p.m); if (sw) { flags.push(`${label}: day and month were swapped in the sheet, corrected`); return sw; } }
      return iso(p.y, p.m, p.d);
    }
    const t = clean(c.w ?? c.v);
    if (NA.has(t.toLowerCase())) return null;
    const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (!m) { flags.push(`${label}: unreadable "${t.slice(0, 20)}"`); return null; }
    let y = +m[3]; const dd = +m[1], mm = +m[2];
    if (m[3].length === 2) y += 2000;
    else if (y < 1000) {
      const fix = { 205: 2025, 206: 2026, 225: 2025, 226: 2026 }[y];
      if (!fix) { flags.push(`${label}: odd year "${t}"`); return null; }
      flags.push(`${label}: year "${m[3]}" read as ${fix}`); y = fix;
    }
    const r = iso(y, mm, dd);
    if (!r) flags.push(`${label}: impossible date "${t}"`);
    return r;
  }
  function month(c, flags, label) {
    if (!c || c.v == null || c.v === "") return null;
    if (isDateCell(c)) { const p = XLSX.SSF.parse_date_code(c.v); if (p) return /y/i.test(c.z) && !/d/i.test(c.z) ? `${p.y}-${pad(p.m)}-01` : `${p.y}-${pad(p.m)}-01`; }
    const t = clean(c.w ?? c.v);
    if (NA.has(t.toLowerCase())) return null;
    const m = t.match(/^(\d{1,2})[/.-](\d{2,4})$/);
    if (m) { let y = +m[2]; if (y < 100) y += 2000; const mm = +m[1]; if (mm >= 1 && mm <= 12 && y >= 2000 && y <= 2100) return `${y}-${pad(mm)}-01`; }
    flags.push(`${label}: unreadable "${t.slice(0, 20)}"`); return null;
  }
  const remark = (c) => {
    const t = clean(c && (c.w ?? c.v)).toLowerCase();
    if (NA.has(t)) return null;
    if (t.startsWith("approved")) return "Approved";
    if (t.includes("not") && t.includes("approv")) return "Not approved";
    if (t.includes("hold")) return "On hold";
    if (t.includes("pending")) return null;
    return clean(c.w ?? c.v);
  };
  const int = (c) => { const m = clean(c && (c.w ?? c.v)).match(/^(\d+)/); return m ? +m[1] : null; };
  return { date, month, remark, int };
}

const SHEETS = [
  { name: "Raw Material", stage: "raw", hdr: 3, firm: null },
  { name: "Packing Material", stage: "packing", hdr: 2, firm: null },
  { name: "Bulk", stage: "bulk", hdr: 3, firm: null },
  { name: "Finish product -VP", stage: "fp", hdr: 2, firm: "VP" },
  { name: "Finish Product - VH", stage: "fp", hdr: 2, firm: "VH" },
];
const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIAS = { sampled_by: { shiwaniyadaav: "Shiwani Yadav", jaskaran: "Jaskaran Singh" } };

export function readOldSheet(XLSX, buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellNF: true, cellText: true });
  const R = makeReaders(XLSX);
  const out = [];
  const seen = [];
  for (const spec of SHEETS) {
    const key = wb.SheetNames.find((n) => n.trim() === spec.name);
    if (!key) { seen.push(`Tab "${spec.name}" not found`); continue; }
    const ws = wb.Sheets[key];
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    for (let r = spec.hdr; r <= range.e.r; r++) {
      const cell = (c) => ws[XLSX.utils.encode_cell({ r, c })];
      let any = false;
      for (let c = 0; c <= Math.min(range.e.c, 20); c++) { const x = cell(c); if (x && x.v != null && x.v !== "") { any = true; break; } }
      if (!any) continue;
      const fl = [];
      let o;
      if (spec.stage === "raw") o = { entry_date: R.date(cell(1), fl, "Date"), item_name: txt(cell(2)), qty: txt(cell(3)), supplier: txt(cell(4)), containers: R.int(cell(5)), batch_no: txt(cell(6)), mfg: R.month(cell(7), fl, "Mfg"), exp: R.month(cell(8), fl, "Exp"), sampling_date: R.date(cell(9), fl, "Sampling date"), sampled_by: txt(cell(10)), qc_release_date: R.date(cell(11), fl, "QC release"), qc_report_no: txt(cell(12)), qc_remarks: R.remark(cell(13)), assay: txt(cell(14)), water_lod: txt(cell(15)), micro_release_date: R.date(cell(16), fl, "Micro release"), micro_report_no: txt(cell(17)), micro_remarks: R.remark(cell(18)), notes: txt(cell(19)) };
      else if (spec.stage === "packing") o = { entry_date: R.date(cell(1), fl, "Date"), item_name: txt(cell(2)), qty: txt(cell(3)), containers: R.int(cell(4)), supplier: txt(cell(5)), bill_no: txt(cell(6)), bill_date: R.date(cell(7), fl, "Bill date"), sampling_date: R.date(cell(8), fl, "Sampling date"), sampled_by: txt(cell(9)), qc_release_date: R.date(cell(10), fl, "QC release"), qc_report_no: txt(cell(11)), qc_remarks: R.remark(cell(12)) };
      else if (spec.stage === "bulk") o = { entry_date: R.date(cell(1), fl, "Date"), item_name: txt(cell(2)), qty: txt(cell(3)), batch_no: txt(cell(4)), mfg: R.month(cell(5), fl, "Mfg"), exp: R.month(cell(6), fl, "Exp"), sampling_date: R.date(cell(7), fl, "Sampling date"), sampled_by: txt(cell(8)), qc_release_date: R.date(cell(9), fl, "QC release"), qc_report_no: txt(cell(10)), qc_remarks: R.remark(cell(11)), micro_release_date: R.date(cell(12), fl, "Micro release"), micro_report_no: txt(cell(13)), micro_remarks: R.remark(cell(14)) };
      else {
        o = { entry_date: R.date(cell(1), fl, "Date"), item_name: txt(cell(2)), qty: txt(cell(3)), batch_no: txt(cell(4)), mfg: R.month(cell(5), fl, "Mfg"), exp: R.month(cell(6), fl, "Exp"), sampling_date: R.date(cell(7), fl, "Sampling date"), sampled_by: txt(cell(8)), qc_release_date: R.date(cell(9), fl, "QC release"), qc_report_no: txt(cell(10)), qc_remarks: R.remark(cell(11)), micro_release_date: R.date(cell(12), fl, "Micro release"), micro_remarks: R.remark(cell(13)) };
        if (spec.firm === "VH") { o.control_release_date = R.date(cell(14), fl, "Control release"); o.final_release_date = R.date(cell(15), fl, "Final release"); } else o.final_release_date = R.date(cell(14), fl, "Final release");
      }
      if (!o.item_name) continue;
      const a = o.sampling_date, b = o.qc_release_date;
      if (a && b && b < a) fl.push("QC release is before sampling");
      if (a && b && daysBetween(a, b) > 90) fl.push("QC release more than 90 days after sampling");
      if (o.entry_date && a && a < o.entry_date) fl.push("Sampling is before the date received");
      if (!o.entry_date) fl.push("no entry date");
      else if (o.entry_date < "2024-01-01" || o.entry_date > "2026-12-31") fl.push("entry date outside 2024-2026");
      Object.assign(o, { stage: spec.stage, firm_id: spec.firm, legacy_ref: `${spec.name}!${r + 1}`, import_flags: fl, created_by_name: "Imported from the sheet" });
      out.push(o);
    }
  }
  // one spelling per supplier / person / item (ignoring capitals, spaces and punctuation)
  const tidy = (field, perStage) => {
    const groups = new Map();
    for (const o of out) { const v = o[field]; if (!v) continue; const k = (perStage ? o.stage : "") + "|" + norm(v); if (!groups.has(k)) groups.set(k, new Map()); const g = groups.get(k); g.set(v, (g.get(v) || 0) + 1); }
    for (const o of out) {
      const v = o[field]; if (!v) continue;
      const al = ALIAS[field] && ALIAS[field][norm(v)];
      if (al) { o[field] = al; continue; }
      const g = groups.get((perStage ? o.stage : "") + "|" + norm(v));
      o[field] = [...g.entries()].sort((p, q) => q[1] - p[1])[0][0];
    }
  };
  tidy("supplier"); tidy("sampled_by"); tidy("item_name", true);
  // empty values are left out, except the flag list and the checked marker, which every row must carry
  for (const o of out) { for (const k of Object.keys(o)) if (o[k] === null) delete o[k]; o.import_flags = o.import_flags || []; o.review_done = false; }
  return { rows: out, notes: seen };
}
