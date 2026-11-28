// Export: what each party has ordered. Pure functions, no database access.
import { settlementOf, takesPayment } from "./settlement.js";

const r2 = (n) => Math.round(n * 100 + 1e-9) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// partyId -> { orders, byCurrency, products, firstDate, lastDate }.
// orders: newest first, each { ship, date, billed, received, balance, status, qty, products }; payment figures only for dispatched / closed invoices.
export function partyHistory(shipments, linesOf, receiptsOf, today) {
  const out = {};
  for (const x of shipments || []) {
    if (x.deleted_at || !x.party_id) continue;
    const ls = linesOf[x.id] || [];
    const billed = r2(ls.reduce((t, l) => t + num(l.qty) * num(l.rate), 0));
    const qty = ls.reduce((t, l) => t + num(l.qty), 0);
    const pays = takesPayment(x);
    const s = pays ? settlementOf(x, ls, receiptsOf[x.id] || [], today) : null;
    const date = (x.status === "proforma" ? x.proforma_date : x.invoice_date) || x.invoice_date || x.proforma_date || "";
    const h = (out[x.party_id] ||= { orders: [], byCurrency: {}, products: {}, firstDate: "", lastDate: "" });
    h.orders.push({ ship: x, date, billed, qty, received: s ? s.received : 0, balance: s ? s.balance : 0, status: s ? s.status : null, products: ls.map((l) => l.name).filter(Boolean) });
    if (pays) {
      const c = (h.byCurrency[x.currency || "INR"] ||= { orders: 0, billed: 0, received: 0, balance: 0 });
      c.orders++; c.billed = r2(c.billed + s.billed); c.received = r2(c.received + s.received); c.balance = r2(c.balance + s.balance);
      if (date && (!h.firstDate || date < h.firstDate)) h.firstDate = date;
      if (date > h.lastDate) h.lastDate = date;
      for (const l of ls) if (l.name) h.products[l.name] = (h.products[l.name] || 0) + num(l.qty);
    }
  }
  for (const h of Object.values(out)) h.orders.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}
