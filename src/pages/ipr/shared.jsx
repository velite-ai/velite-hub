import { supabase } from "../../supabase";
import { daysUntil, fmtDate } from "../../lib/dates";
import { toast } from "../../lib/data";

export const FIRMS = ["Velite Pharmaceuticals", "Velite Healthcare", "Velite India", "Velite Sciences"];
export const DEFAULT_CATEGORIES = ["Personal Care - General", "Moisturiser", "Sunscreen", "Face Wash", "Serum", "Cream", "Lotion", "Hair Care", "Other"];
export const DEFAULT_STATUSES = ["Registered", "Filed", "Applied / Filed", "Objected", "Opposed", "Search Pending", "Filing Needed", "Renewal Due", "Not Applied", "Client To Confirm"];
export const NOTICE_TYPES = ["Registry Notice", "Attorney Update", "Market Watch", "Internal Reminder", "Competitor Filing", "Domain / Online Misuse"];
export const PRIORITIES = ["Normal", "Important", "Urgent"];
export const DOC_TYPES = ["Registration Certificate", "Application Acknowledgement", "Examination Report", "Reply / Submission", "Hearing Notice", "Opposition Papers", "Renewal Receipt", "Other"];
export const PROOF_CHANNELS = ["Invoice", "Product Photo", "Packaging", "Catalogue", "Website / Online", "Advertisement", "Other"];
export const RISKS = ["Green", "Amber", "Red"];
export const GAP_STATUSES = ["Filing Needed", "Search Pending"];
export const CLOSED = ["Abandoned", "Withdrawn"];

// same colour logic as the old ipr.velite.in app
export function statusClass(status) {
  if (status === "Registered") return "green";
  if (status === "Objected" || status === "Opposed") return "red";
  if (status === "Filed") return "blue";
  if (status === "Filing Needed" || status === "Renewal Due" || status === "Search Pending") return "amber";
  return "cyan";
}
export const riskClass = (r) => (r === "Red" ? "red" : r === "Amber" ? "amber" : "green");
export const prioClass = (p) => (p === "Urgent" ? "red" : p === "Important" ? "amber" : "green");

export function days(d) { return d ? daysUntil(d) : 9999; }
export function dueText(d) {
  if (!d) return "Not set";
  const n = daysUntil(d);
  return `${fmtDate(d)} (${n < 0 ? `${-n} days late` : `${n} days`})`;
}

export function Pill({ tone = "", children, title }) {
  return <span className={`ipill ${tone}`} title={title}>{children}</span>;
}

export function cleanOption(v) { return String(v || "").trim().replace(/\s+/g, " "); }
export function mergeOptions(...lists) {
  const seen = new Set(); const out = [];
  lists.flat().forEach((v) => {
    const o = cleanOption(v); const k = o.toLowerCase();
    if (!o || k === "all" || seen.has(k)) return;
    seen.add(k); out.push(o);
  });
  return out;
}

// categories / statuses: saved lists + anything already used in records (like the old app)
export function useIprOptions(d) {
  const row = (k) => d.iprOptions.rows.find((r) => r.key === k)?.vals;
  const tms = d.trademarks.rows.filter((t) => !t.deleted_at);
  const categories = mergeOptions(row("categories") || DEFAULT_CATEGORIES, tms.map((t) => t.category),
    d.iprNotices.rows.map((n) => n.category), d.iprThird.rows.map((t) => t.category));
  const statuses = mergeOptions(row("statuses") || DEFAULT_STATUSES, tms.map((t) => t.status), d.iprThird.rows.map((t) => t.status));
  return { categories, statuses };
}

export function fileToDataUrl(file, label = "file") {
  return new Promise((resolve, reject) => {
    if (!file) return resolve({ name: "", data: "" });
    if (file.size > 5 * 1024 * 1024) return reject(new Error(`Please upload the ${label} below 5 MB.`));
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, data: r.result });
    r.onerror = () => reject(new Error(`Could not read the ${label}.`));
    r.readAsDataURL(file);
  });
}

export function downloadDataUrl(dataUrl, name) {
  const a = document.createElement("a");
  a.href = dataUrl; a.download = name || "file"; a.click();
}

// fetch a stored file only when someone clicks Download
export async function downloadStored(table, id, dataCol, nameCol) {
  const { data, error } = await supabase.from(table).select(`${dataCol},${nameCol}`).eq("id", id).single();
  if (error || !data?.[dataCol]) return toast(error?.message || "File not found", "err");
  downloadDataUrl(data[dataCol], data[nameCol]);
}

export const splitList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
