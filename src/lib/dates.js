// All dates are shown in Indian time.
const TZ = "Asia/Kolkata";

export function fmtDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", {
    timeZone: TZ, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-IN", {
    timeZone: "UTC", day: "2-digit", month: "short", year: "numeric",
  });
}

// Today's date in India as YYYY-MM-DD
export function todayISO() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // en-CA gives YYYY-MM-DD
}

export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// negative = overdue by N days, 0 = today, positive = due in N days
export function daysUntil(d) {
  if (!d) return null;
  const t = todayISO();
  const a = Date.UTC(...t.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
  const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
  const b = Date.UTC(y, m - 1, day);
  return Math.round((b - a) / 86400000);
}

export function dueLabel(d) {
  const n = daysUntil(d);
  if (n === null) return null;
  if (n < 0) return { text: `Overdue ${-n}d · ${fmtDate(d)}`, cls: "due-over" };
  if (n === 0) return { text: `Due today`, cls: "due-today" };
  if (n <= 7) return { text: `Due in ${n}d · ${fmtDate(d)}`, cls: "due-soon" };
  return { text: `Due ${fmtDate(d)}`, cls: "due-later" };
}

export function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDateTime(ts);
}
