// Export settlement: how much of each export invoice has been paid, when the payment is due, and what is overdue.
// Pure functions, no database access. Amounts are in the invoice's own currency.

export const DEFAULT_MONTHS = 9;   // months allowed from the invoice date to receive the payment (can be set per shipment)
export const SOON_DAYS = 30;       // "due soon" window
const r2 = (n) => Math.round(n * 100 + 1e-9) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const pad = (n) => String(n).padStart(2, "0");
// Same day n months later; a 31st becomes the last day of a shorter month.
export function addMonths(iso, n) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = m - 1 + n; const yy = y + Math.floor(t / 12); const mm = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(d, last))}`;
}
export const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

// Only shipments that have an invoice and have left (dispatched / closed) take part.
export const takesPayment = (s) => !!s && !s.deleted_at && !!s.invoice_no && (s.status === "dispatched" || s.status === "closed");

export function settlementOf(ship, lines, receipts, today, defaultMonths = DEFAULT_MONTHS) {
  const billed = r2((lines || []).reduce((t, l) => t + num(l.qty) * num(l.rate), 0));
  const received = r2((receipts || []).reduce((t, r) => t + num(r.amount), 0));
  const writeOff = r2(num(ship.write_off));
  const balance = r2(billed - received - writeOff);
  const months = ship.due_months || defaultMonths;
  const dueOn = ship.invoice_date ? addMonths(ship.invoice_date, months) : null;
  const daysLeft = dueOn ? daysBetween(today, dueOn) : null;
  let status;
  if (billed <= 0) status = "No value";
  else if (balance <= 0.005) status = "Settled";
  else if (dueOn && daysLeft < 0) status = "Overdue";
  else if (received > 0) status = "Part received";
  else status = "Pending";
  const open = status !== "Settled" && status !== "No value";
  return {
    billed, received, writeOff, balance: Math.max(balance, 0), status, months, dueOn, daysLeft, open,
    overdueDays: status === "Overdue" ? -daysLeft : 0,
    dueSoon: open && daysLeft !== null && daysLeft >= 0 && daysLeft <= SOON_DAYS,
    needsBrc: status === "Settled" && !ship.brc_no,
    needsEdpms: status === "Settled" && !ship.edpms_closed,
  };
}

// One row per party and currency: invoices, billed, received, balance, how many overdue.
export function partyTotals(items) {
  const m = new Map();
  for (const it of items) {
    const k = `${it.partyId || it.partyName}|${it.currency}`;
    if (!m.has(k)) m.set(k, { partyId: it.partyId, party: it.partyName, currency: it.currency, invoices: 0, billed: 0, received: 0, balance: 0, overdue: 0, lastInvoice: "" });
    const p = m.get(k); const s = it.s;
    p.invoices++; p.billed = r2(p.billed + s.billed); p.received = r2(p.received + s.received); p.balance = r2(p.balance + s.balance);
    if (s.status === "Overdue") p.overdue++;
    if (it.invoiceDate > p.lastInvoice) p.lastInvoice = it.invoiceDate;
  }
  return [...m.values()].sort((a, b) => a.party.localeCompare(b.party) || a.currency.localeCompare(b.currency));
}
