import { supabase } from "../../supabase";
import { daysUntil, fmtDate } from "../../lib/dates";
import { toast } from "../../lib/data";
import FLAGS from "./flags.json";

export { FLAGS };

export const STATUS = {
  pending: { label: "Not started", tone: "" },
  in_progress: { label: "In progress", tone: "blue" },
  filed: { label: "Filed – to check", tone: "cyan" },
  verified: { label: "Verified ✓", tone: "green" },
  na: { label: "Not applicable", tone: "" },
};

export const FLAG_GROUPS = [
  ["Type of business", ["prop", "huf", "company", "drug_mfg", "cos_mfg", "drug_sale", "exporter", "mfg", "new_drug", "dpco_scheduled", "ucpmp"]],
  ["People", ["employees", "pf", "esi", "lwf", "posh10", "apprentice30", "contract50", "factory", "shops20", "shops_small"]],
  ["Tax", ["gst", "qrmp", "gst_2cr", "gst_5cr", "einv", "tds", "tax_audit", "msme", "dsc"]],
  ["Plant, safety & environment", ["ppcb", "haz_waste", "bmw", "pibo", "lmpc", "weights", "fire", "boiler", "ceig", "peso", "alcohol", "ndps", "groundwater"]],
];

export const isOpen = (i) => !i.deleted_at && (i.status === "pending" || i.status === "in_progress");
export const isDone = (i) => i.status === "filed" || i.status === "verified" || i.status === "na";

// "red" overdue, "amber" within 7 days (or within the item's lead time if shorter), "" otherwise
export function tone(i) {
  if (!isOpen(i)) return "";
  const n = daysUntil(i.due_date);
  if (n < 0) return "red";
  if (n <= 7) return "amber";
  return "";
}

export function dueBadge(i) {
  const n = daysUntil(i.due_date);
  if (!isOpen(i)) return { text: fmtDate(i.due_date), cls: "due-later" };
  if (n < 0) return { text: `${-n}d late · ${fmtDate(i.due_date)}`, cls: "due-over" };
  if (n === 0) return { text: "Due today", cls: "due-today" };
  if (n <= 7) return { text: `in ${n}d · ${fmtDate(i.due_date)}`, cls: "due-soon" };
  return { text: fmtDate(i.due_date), cls: "due-later" };
}

export function evalApplies(flags, expr) {
  if (!expr) return true;
  return expr.split("|").some((part) => part.split("&").every((tok) => {
    tok = tok.trim(); const neg = tok.startsWith("!"); const k = neg ? tok.slice(1) : tok;
    const v = !!(flags || {})[k]; return neg ? !v : v;
  }));
}

export function applicability(firm, lib, assignRows) {
  const a = assignRows.find((x) => x.firm_id === firm.id && x.code === lib.code);
  const auto = evalApplies(firm.flags, lib.applies);
  const mode = a?.mode || "auto";
  return { auto, mode, applies: mode === "yes" ? true : mode === "no" ? false : auto, assign: a };
}

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ord = (d) => `${d}${d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th"}`;
export function ruleText(r) {
  if (!r) return "";
  switch (r.t) {
    case "monthly": return `Monthly · by ${ord(r.d)} of ${(r.lag ?? 1) === 0 ? "the same" : "next"} month`;
    case "quarterly": return `Quarterly · by ${ord(r.d)} ${(r.lag ?? 1) === 0 ? "of the quarter's last month" : "after quarter end"}`;
    case "half": return `Half-yearly${r.cal ? " (calendar)" : ""} · by ${ord(r.d)}${(r.lag ?? 1) === 0 ? " of the half's last month" : " after the half"}`;
    case "yearly": return `Yearly · ${r.d} ${MON[r.m]}`;
    case "dates": return `On ${r.list.map((x) => { const [m, d] = x[0].split("-").map(Number); return `${d} ${MON[m]}`; }).join(", ")}`;
    case "once": return `One-time · ${fmtDate(r.date)}`;
    case "licence": return "Renewal / retention — date from Licence register";
    case "event": return r.offset > 0 ? `When it happens · within ${r.offset} days` : r.offset < 0 ? `${-r.offset} days before the event` : "When it happens";
    default: return "";
  }
}

export const personName = (profiles, id) => profiles.rows.find((p) => p.id === id)?.full_name || "";

export async function uploadProof(file, folder) {
  if (file.size > 15 * 1024 * 1024) { toast("File is larger than 15 MB", "err"); return null; }
  const safe = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${folder}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage.from("compliance").upload(path, file, { upsert: false });
  if (error) { toast(error.message, "err"); return null; }
  return { path, name: file.name };
}

export async function openProof(path) {
  const { data, error } = await supabase.storage.from("compliance").createSignedUrl(path, 120);
  if (error) { toast(error.message, "err"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

export async function regenerate(quiet) {
  const { data, error } = await supabase.rpc("hub_cmp_generate");
  if (error) { toast(error.message, "err"); return; }
  if (!quiet) toast(data ? `${data} new due item${data === 1 ? "" : "s"} added` : "Due dates are up to date");
}

export function exportCsv(rows, name) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
