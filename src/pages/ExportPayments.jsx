import { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";
import { FIRM_COLORS } from "./compliance/common";
import { fmtD, todayISO } from "../lib/qc";
import { settlementOf, partyTotals, takesPayment, DEFAULT_MONTHS } from "../lib/settlement";

// Payments: is the money for each export invoice in? Due date, amounts received, e-BRC and bank EDPMS closure, party by party.

const money = (n, c) => `${c === "USD" ? "$" : "₹"}${Number(n || 0).toLocaleString(c === "USD" ? "en-US" : "en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = { Pending: "#475467", "Part received": "#b45309", Overdue: "#b91c1c", Settled: "#15803d", "No value": "#98a2b3" };
const Status = ({ s }) => <b style={{ color: TONE[s.status] }}>{s.status}{s.status === "Overdue" ? ` · ${s.overdueDays}d` : ""}</b>;
const nm = (v) => { const s = String(v ?? "").replace(/,/g, "").trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const txt = (v) => { const s = String(v ?? "").trim(); return s || null; };

export function useSettlements() {
  const { expShipments, expLines, expReceipts, expParties } = useData();
  return useMemo(() => {
    const today = todayISO();
    const lines = {}; expLines.rows.forEach((l) => (lines[l.shipment_id] ||= []).push(l));
    const recs = {}; expReceipts.rows.forEach((r) => (recs[r.shipment_id] ||= []).push(r));
    const parties = Object.fromEntries(expParties.rows.map((p) => [p.id, p]));
    const items = expShipments.rows.filter(takesPayment).map((x) => ({
      ship: x, partyId: x.party_id, partyName: parties[x.party_id]?.name || "—", currency: x.currency || "INR", invoiceDate: x.invoice_date || "",
      receipts: (recs[x.id] || []).slice().sort((a, b) => a.received_on.localeCompare(b.received_on)), s: settlementOf(x, lines[x.id] || [], recs[x.id] || [], today),
    }));
    return { items, byShip: Object.fromEntries(items.map((i) => [i.ship.id, i])) };
  }, [expShipments.rows, expLines.rows, expReceipts.rows, expParties.rows]);
}

export default function Payments() {
  const { items } = useSettlements();
  const { expShipments, expReceipts } = useData();
  const [q, setQ] = useState(""); const [f, setF] = useState("open"); const [edit, setEdit] = useState(null);
  const reload = () => { expShipments.reload(); expReceipts.reload(); };
  const cur = [...new Set(items.map((i) => i.currency))];
  const sum = (c, k, pred = () => true) => items.filter((i) => i.currency === c && pred(i)).reduce((t, i) => t + i.s[k], 0);
  const overdue = items.filter((i) => i.s.status === "Overdue"), soon = items.filter((i) => i.s.dueSoon);
  const chips = [["open", `Not settled (${items.filter((i) => i.s.open).length})`], ["overdue", `Overdue (${overdue.length})`], ["soon", `Due in 30 days (${soon.length})`],
    ["paperwork", `e-BRC / EDPMS to do (${items.filter((i) => i.s.needsBrc || i.s.needsEdpms).length})`], ["settled", `Settled (${items.filter((i) => i.s.status === "Settled").length})`], ["all", `All (${items.length})`]];
  const pass = { open: (i) => i.s.open, overdue: (i) => i.s.status === "Overdue", soon: (i) => i.s.dueSoon, paperwork: (i) => i.s.needsBrc || i.s.needsEdpms, settled: (i) => i.s.status === "Settled", all: () => true }[f];
  const rows = items.filter(pass).filter((i) => { const s = q.trim().toLowerCase(); return !s || `${i.ship.invoice_no} ${i.partyName} ${i.ship.country}`.toLowerCase().includes(s); })
    .sort((a, b) => (a.s.dueOn || "9").localeCompare(b.s.dueOn || "9"));
  const parties = partyTotals(items);
  return (
    <>
      <div className="mt-kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {cur.map((c) => <div key={c} className="mt-kpi blue"><b>{money(sum(c, "balance"), c)}</b><span>still to receive ({c})</span></div>)}
        <button className="mt-kpi red" onClick={() => setF("overdue")}><b>{overdue.length}</b><span>overdue</span></button>
        <button className="mt-kpi amber" onClick={() => setF("soon")}><b>{soon.length}</b><span>due in the next 30 days</span></button>
        <div className="mt-kpi green"><b>{items.filter((i) => i.s.status === "Settled").length}</b><span>settled</span></div>
      </div>
      {(overdue.length > 0 || soon.length > 0) && (
        <div className="rg-note amber" style={{ marginBottom: 8 }}>
          {overdue.length > 0 && <div>⚠ <b>{overdue.length} overdue</b>: {overdue.slice(0, 5).map((i) => `${i.ship.invoice_no} (${i.partyName}, ${i.s.overdueDays} days)`).join(" · ")}{overdue.length > 5 ? " …" : ""}</div>}
          {soon.length > 0 && <div>⏰ <b>{soon.length} due within 30 days</b>: {soon.slice(0, 5).map((i) => `${i.ship.invoice_no} (${fmtD(i.s.dueOn)})`).join(" · ")}{soon.length > 5 ? " …" : ""}</div>}
        </div>)}
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <div className="rg-search" style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="🔎 Search invoice no., party, country…" /></div>
      </div>
      <div className="tk-views qc-tabs" style={{ marginBottom: 8 }}>{chips.map(([k, l]) => <button key={k} className={f === k ? "on" : ""} onClick={() => setF(k)}>{l}</button>)}</div>
      {rows.length === 0 ? <Empty>{items.length ? "Nothing in this list." : "No dispatched invoices yet. Payments are tracked for invoices that are dispatched or closed."}</Empty> : (
        <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Party</th><th>Billed</th><th>Received</th><th>Balance</th><th>Due by</th><th>Status</th><th>e-BRC</th><th>EDPMS</th></tr></thead>
          <tbody>{rows.map((i) => (
            <tr key={i.ship.id} className="qc-tr" onClick={() => setEdit(i.ship.id)}>
              <td><span className="tk-firm" style={{ background: FIRM_COLORS[i.ship.firm_id] }}>{i.ship.firm_id}</span><b>{i.ship.invoice_no}</b></td><td>{fmtD(i.ship.invoice_date)}</td>
              <td>{i.partyName} <small className="small-muted">{i.ship.country}</small></td><td>{money(i.s.billed, i.currency)}</td><td>{money(i.s.received, i.currency)}</td>
              <td>{money(i.s.balance, i.currency)}</td><td>{fmtD(i.s.dueOn) || "—"}</td><td><Status s={i.s} /></td>
              <td>{i.ship.brc_no ? "✓" : <span className="small-muted">—</span>}</td><td>{i.ship.edpms_closed ? "✓" : <span className="small-muted">—</span>}</td></tr>))}</tbody></table></div>)}
      <div className="ipanel" style={{ marginTop: 12 }}><div className="ipanel-head"><div><h3>Party by party</h3><p>Billed, received and still to come, for dispatched and closed invoices.</p></div></div>
        {parties.length === 0 ? <Empty>Nothing yet.</Empty> : (
          <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Party</th><th>Invoices</th><th>Billed</th><th>Received</th><th>Balance</th><th>Overdue</th><th>Last invoice</th></tr></thead>
            <tbody>{parties.map((p) => (<tr key={`${p.partyId}${p.currency}`}><td><b>{p.party}</b></td><td>{p.invoices}</td><td>{money(p.billed, p.currency)}</td><td>{money(p.received, p.currency)}</td>
              <td><b>{money(p.balance, p.currency)}</b></td><td>{p.overdue ? <b style={{ color: "#b91c1c" }}>{p.overdue}</b> : "—"}</td><td>{fmtD(p.lastInvoice)}</td></tr>))}</tbody></table></div>)}
      </div>
      {edit && <PaymentForm shipId={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function PaymentForm({ shipId, onClose, onSaved }) {
  const { byShip } = useSettlements();
  const it = byShip[shipId];
  const [ask, dialog] = useConfirm();
  const x = it?.ship || {};
  const [f, setF] = useState(() => ({ due_months: x.due_months ?? "", write_off: x.write_off || "", brc_no: x.brc_no || "", brc_date: x.brc_date || "", edpms_closed: !!x.edpms_closed, settle_notes: x.settle_notes || "" }));
  const [r, setR] = useState({ received_on: todayISO(), amount: "", bank_ref: "", notes: "" });
  const [busy, setBusy] = useState(false);
  if (!it) return null;
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const saveInfo = async () => {
    const dm = nm(f.due_months);
    if (dm !== null && (!Number.isInteger(dm) || dm < 1 || dm > 36)) return toast("Months to receive payment: a whole number from 1 to 36", "err");
    setBusy(true);
    const res = await run(supabase.from("exp_shipments").update({ due_months: dm, write_off: nm(f.write_off) || 0, brc_no: txt(f.brc_no), brc_date: f.brc_date || null, edpms_closed: f.edpms_closed, settle_notes: txt(f.settle_notes) }).eq("id", x.id), "Saved");
    setBusy(false); if (res.ok) onSaved();
  };
  const addReceipt = async () => {
    const amt = nm(r.amount);
    if (!r.received_on) return toast("Enter the date the money came in", "err");
    if (!amt || amt <= 0) return toast("Enter the amount received", "err");
    if (amt > it.s.balance + 0.005 && !(await ask({ title: "More than the balance?", body: `The balance is ${money(it.s.balance, it.currency)} and you are adding ${money(amt, it.currency)}. Add it anyway?`, okText: "Add anyway" }))) return;
    setBusy(true);
    const res = await run(supabase.from("exp_receipts").insert({ shipment_id: x.id, received_on: r.received_on, amount: amt, bank_ref: txt(r.bank_ref), notes: txt(r.notes) }), "Payment recorded");
    setBusy(false); if (res.ok) { setR({ received_on: todayISO(), amount: "", bank_ref: "", notes: "" }); onSaved(); }
  };
  const delReceipt = async (rc) => {
    if (!(await ask({ title: "Remove this payment entry?", body: `${money(rc.amount, it.currency)} on ${fmtD(rc.received_on)}`, okText: "Remove", danger: true }))) return;
    const res = await run(supabase.from("exp_receipts").delete().eq("id", rc.id), "Removed"); if (res.ok) onSaved();
  };
  const s = it.s;
  return (
    <Modal wide title={`Payment · ${x.invoice_no} · ${it.partyName}`} onClose={onClose} actions={<><button className="btn-ghost" onClick={onClose}>Close</button><button className="btn-primary" onClick={saveInfo} disabled={busy}>Save details</button></>}>
      <div className="mt-kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
        <div className="mt-kpi blue"><b>{money(s.billed, it.currency)}</b><span>billed</span></div>
        <div className="mt-kpi green"><b>{money(s.received, it.currency)}</b><span>received</span></div>
        <div className="mt-kpi amber"><b>{money(s.balance, it.currency)}</b><span>balance</span></div>
        <div className="mt-kpi"><b><Status s={s} /></b><span>due by {fmtD(s.dueOn) || "—"}{s.daysLeft !== null && s.open ? (s.daysLeft >= 0 ? ` · ${s.daysLeft} days left` : "") : ""}</span></div>
      </div>
      <div className="ipanel"><div className="ipanel-head"><div><h3>Money received</h3></div></div>
        {it.receipts.length === 0 ? <div className="small-muted" style={{ marginBottom: 8 }}>Nothing recorded yet.</div> : it.receipts.map((rc) => (
          <div key={rc.id} className="qc-row"><span className="qc-row-main"><b>{money(rc.amount, it.currency)} · {fmtD(rc.received_on)}</b><small>{[rc.bank_ref && `Bank ref ${rc.bank_ref}`, rc.notes].filter(Boolean).join(" · ") || "no reference"}</small></span>
            <button className="btn-ghost sm" onClick={() => delReceipt(rc)}>Remove</button></div>))}
        <div className="ex-grid" style={{ marginTop: 8 }}>
          <Field label="Date received"><input className="form-inp" type="date" value={r.received_on} onChange={(e) => setR((v) => ({ ...v, received_on: e.target.value }))} /></Field>
          <Field label={`Amount (${it.currency})`}><input className="form-inp" inputMode="decimal" value={r.amount} onChange={(e) => setR((v) => ({ ...v, amount: e.target.value }))} placeholder={String(s.balance || "")} /></Field>
          <Field label="Bank reference / FIRC no."><input className="form-inp" value={r.bank_ref} onChange={(e) => setR((v) => ({ ...v, bank_ref: e.target.value }))} /></Field>
          <Field label="Note"><input className="form-inp" value={r.notes} onChange={(e) => setR((v) => ({ ...v, notes: e.target.value }))} /></Field>
        </div>
        <button className="btn-primary sm" onClick={addReceipt} disabled={busy}>＋ Add this payment</button>
      </div>
      <div className="ipanel"><div className="ipanel-head"><div><h3>Settlement details</h3><p>Payment is due {s.months} months after the invoice date unless you change it here.</p></div></div>
        <div className="ex-grid">
          <Field label="Months allowed to receive payment" hint={`Blank = ${DEFAULT_MONTHS} months`}><input className="form-inp" inputMode="numeric" value={f.due_months} onChange={set("due_months")} placeholder={String(DEFAULT_MONTHS)} /></Field>
          <Field label={`Written off: bank charges / short payment accepted (${it.currency})`}><input className="form-inp" inputMode="decimal" value={f.write_off} onChange={set("write_off")} /></Field>
          <Field label="e-BRC number"><input className="form-inp" value={f.brc_no} onChange={set("brc_no")} /></Field>
          <Field label="e-BRC date"><input className="form-inp" type="date" value={f.brc_date} onChange={set("brc_date")} /></Field>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}><input type="checkbox" checked={f.edpms_closed} onChange={set("edpms_closed")} /> Bank has closed this invoice in EDPMS</label>
        <Field label="Notes"><input className="form-inp" value={f.settle_notes} onChange={set("settle_notes")} /></Field>
        {s.status === "Settled" && (s.needsBrc || s.needsEdpms) && <div className="small-muted">Paid in full. Still to do: {[s.needsBrc && "e-BRC number", s.needsEdpms && "EDPMS closure"].filter(Boolean).join(" and ")}.</div>}
      </div>
      {dialog}
    </Modal>
  );
}
