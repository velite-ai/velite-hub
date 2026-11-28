// Compliance due list: one line per compliance (all firms together), folded by month. Pure functions, no database access.

const OPEN = (i) => !i.deleted_at && (i.status === "pending" || i.status === "in_progress");
const DONE = (i) => i.status === "filed" || i.status === "verified" || i.status === "na";
const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
export const monthOf = (iso) => iso.slice(0, 7);
export const nextMonth = (ym) => { const [y, m] = ym.split("-").map(Number); const t = new Date(Date.UTC(y, m, 1)); return t.toISOString().slice(0, 7); };

// How one firm's item looks on a chip: done / late / soon (within 7 days) / open.
export function chipState(i, today) {
  if (DONE(i)) return "done";
  if (!OPEN(i)) return "done";
  const n = daysBetween(today, i.due_date);
  return n < 0 ? "late" : n <= 7 ? "soon" : "open";
}

// Items with the same compliance, period and due date become one group.
// opts: { today, goLive } (goLive: items due before it, without a licence, are old catch-up items)
export function groupItems(items, libBy, { today, goLive }) {
  const m = new Map();
  for (const i of items) {
    if (i.deleted_at) continue;
    const k = `${i.code}|${i.period_label}|${i.due_date}`;
    if (!m.has(k)) { const l = libBy[i.code] || {}; m.set(k, { key: k, code: i.code, title: l.title || i.code, dept: l.dept || "", risk: l.risk || "", period: i.period_label, due: i.due_date, items: [] }); }
    m.get(k).items.push(i);
  }
  const groups = [...m.values()];
  for (const g of groups) {
    g.items.sort((a, b) => a.firm_id.localeCompare(b.firm_id));
    g.states = g.items.map((i) => chipState(i, today));
    g.open = g.items.filter(OPEN).length; g.done = g.items.length - g.open;
    g.late = g.states.filter((s) => s === "late").length; g.soon = g.states.filter((s) => s === "soon").length;
    g.backlog = g.open > 0 && g.items.filter(OPEN).every((i) => i.due_date < goLive && !i.licence_id);
    g.tone = g.late ? "red" : g.soon ? "amber" : "";
  }
  return groups.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

// Sections for the screen: one per month (this month and next open, others folded), then old catch-up items folded at the end.
export function sectionsOf(groups, today) {
  const cur = monthOf(today), nxt = nextMonth(cur);
  const months = new Map(); const backlog = [];
  for (const g of groups) { if (g.backlog) { backlog.push(g); continue; } const k = monthOf(g.due); if (!months.has(k)) months.set(k, []); months.get(k).push(g); }
  const out = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, list]) => ({ key: k, month: k, groups: list, open: k === cur || k === nxt }));
  if (backlog.length) out.push({ key: "backlog", month: null, groups: backlog, open: false, backlog: true });
  for (const s of out) { s.count = s.groups.length; s.late = s.groups.filter((g) => g.late).length; }
  return out;
}

// The few things to look at first: open, not old catch-up, soonest due first, high-risk before others on the same day.
export function mostUrgent(groups, n = 5) {
  return groups.filter((g) => g.open > 0 && !g.backlog)
    .sort((a, b) => a.due.localeCompare(b.due) || (b.risk === "H") - (a.risk === "H") || a.title.localeCompare(b.title)).slice(0, n);
}
