import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { Field, Empty, SearchBox, useConfirm } from "../components/ui";
import { FIRM_COLORS } from "./compliance/common";
import { fmtD, fmtM, todayISO, stateOf, STATE_LABEL, STATE_COLOR } from "../lib/qc";
import { normName } from "../lib/export";
import { packLines, totals, lineAmount, preflight } from "../lib/shipment";
import Papers from "./ExportPapers";
import { useSettlements } from "./ExportPayments";
import { saveAttachment, openFile } from "./ExportAudit";

// Shipments: choose country and party, add products and batches, type the invoice number and exchange rate.
// The check below the form says what is missing or wrong before any paper is made.

const FIRM_NAME = { VH: "Velite Healthcare", VI: "Velite India" };
const STATUS = [["proforma", "Order: proforma"], ["draft", "Preparing dispatch"], ["dispatched", "Dispatched"], ["closed", "Closed"]];
const MODES = [["road", "By road"], ["air", "By air"], ["sea", "By sea"], ["road+sea", "Road, then sea"], ["air+road", "Air, then road"]];
const txt = (v) => { const s = String(v ?? "").trim(); return s || null; };
const nm = (v) => { const s = String(v ?? "").replace(/,/g, "").trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const money = (n, c) => `${c === "USD" ? "$" : "₹"}${Number(n || 0).toLocaleString(c === "USD" ? "en-US" : "en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let keySeq = 0; const newKey = () => `k${++keySeq}`;

// QC state of every batch (released / waiting / …), refreshed when the window is focused
function useBatchState(enabled) {
  const [map, setMap] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const load = () => supabase.rpc("hub_batch_qc_status").then(({ data, error }) => { if (live && !error && data) setMap(Object.fromEntries(data.map((r) => [r.batch_id, stateOf({ ...r, stage: "fp" })]))); });
    load(); window.addEventListener("focus", load);
    return () => { live = false; window.removeEventListener("focus", load); };
  }, [enabled]);
  return map;
}

function ctxFor(s, lines, d, batchState) {
  return { firm: d.firms.find((f) => f.id === s.firm_id), party: d.parties.find((p) => p.id === s.party_id), country: d.countries.find((c) => c.country === s.country),
    others: d.shipments.filter((x) => x.id !== s.id && !x.deleted_at), batchState, today: todayISO() };
}

export default function Shipments() {
  const { expFirms, expParties, expProducts, expPrices, expCountries, expAgents, expShipments, expLines, canBatch, batches } = useData();
  const [open, setOpen] = useState(null); const [papers, setPapers] = useState(null); const [q, setQ] = useState("");
  const batchState = useBatchState(canBatch);
  const { byShip: pay } = useSettlements();
  const d = useMemo(() => ({ firms: expFirms.rows, parties: expParties.rows.filter((p) => !p.deleted_at), countries: expCountries.rows, agents: expAgents.rows.filter((a) => !a.deleted_at),
    products: expProducts.rows.filter((p) => !p.deleted_at), prices: expPrices.rows, shipments: expShipments.rows.filter((x) => !x.deleted_at), batches: canBatch ? batches.rows.filter((b) => !b.deleted_at) : [] }),
  [expFirms.rows, expParties.rows, expCountries.rows, expAgents.rows, expProducts.rows, expPrices.rows, expShipments.rows, batches.rows, canBatch]);
  const linesOf = useMemo(() => { const m = {}; expLines.rows.forEach((l) => (m[l.shipment_id] ||= []).push(l)); return m; }, [expLines.rows]);
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return d.shipments.filter((x) => !s || [x.invoice_no, x.country, x.po_no, d.parties.find((p) => p.id === x.party_id)?.name].join(" ").toLowerCase().includes(s)); }, [d, q]);
  const reload = () => { expShipments.reload(); expLines.reload(); };
  if (papers) return <Papers ship={papers} lines={(linesOf[papers.id] || []).slice().sort((a, b) => a.position - b.position)} d={d} batchState={batchState} onClose={() => setPapers(null)} />;
  if (open) return <Editor ship={open.id ? open : null} lines={open.id ? linesOf[open.id] || [] : []} d={d} batchState={batchState} onClose={() => setOpen(null)} onSaved={reload} onPapers={(x) => { setOpen(null); setPapers(x); }} />;
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <div className="rg-search" style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="🔎 Search invoice no., party, country, PO…" /></div>
        <button className="btn-primary sm" onClick={() => setOpen({})}>＋ New order</button>
      </div>
      {list.length === 0 ? <Empty>{d.shipments.length ? "No shipment matches." : "Nothing yet. When a party places an order, start with “New order”: you make the proforma invoice first."}</Empty> : (
        <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Invoice / proforma</th><th>Date</th><th>Party</th><th>Qty</th><th>Value</th><th>Cartons</th><th>Status</th><th>Payment</th><th>Check</th><th></th></tr></thead>
          <tbody>{list.map((x) => {
            const ls = (linesOf[x.id] || []); const t = totals(ls); const pk = packLines(ls); const errs = preflight(x, ls, ctxFor(x, ls, d, batchState)).filter((i) => i.level === "error").length;
            return (<tr key={x.id} className="qc-tr" onClick={() => setOpen(x)}>
              <td><span className="tk-firm" style={{ background: FIRM_COLORS[x.firm_id] }}>{x.firm_id}</span><b>{x.status === "proforma" ? (x.proforma_no || "no proforma no.") : (x.invoice_no || "no invoice no.")}</b></td><td>{fmtD(x.status === "proforma" ? x.proforma_date : x.invoice_date) || "—"}</td>
              <td>{d.parties.find((p) => p.id === x.party_id)?.name || "—"} <small className="small-muted">{x.country}</small></td><td>{t.qty || "—"}</td><td>{t.qty ? money(t.amount, x.currency) : "—"}</td><td>{pk.boxes || "—"}</td>
              <td>{STATUS.find((s) => s[0] === x.status)?.[1] || x.status}</td><td>{pay[x.id] ? <b style={{ color: pay[x.id].s.status === "Overdue" ? "#b91c1c" : pay[x.id].s.status === "Settled" ? "#15803d" : "#475467" }}>{pay[x.id].s.status}</b> : <span className="small-muted">—</span>}</td><td>{errs ? <span style={{ color: "#b91c1c" }}>⚠ {errs}</span> : <span style={{ color: "#16a34a" }}>✓</span>}</td>
              <td onClick={(e) => e.stopPropagation()}><button className="btn-ghost sm" onClick={() => setPapers(x)}>📄 Papers</button></td></tr>);
          })}</tbody></table></div>)}
    </>
  );
}

const blankLine = () => ({ key: newKey(), product_id: null, name: "", hsn: "", product_hsn: "", brand_owner: "", batch_id: null, batch_no: "", mfg: "", exp: "", qty: "", rate: "", pcs_per_carton: "", net_kg: "", gross_kg: "", partial_net: "", partial_gross: "", manual: false });

export function Editor({ ship, lines: saved, d, batchState, onClose, onSaved, onPapers }) {
  const { isOwner } = useData(); const [ask, dialog] = useConfirm();
  const [s, setS] = useState(() => ship ? { ...ship } : { firm_id: "VH", country: "", party_id: null, notify_id: null, brand_owner_id: null, invoice_no: "", invoice_date: "", proforma_no: "", proforma_date: todayISO(), po_no: "", po_date: "",
    currency: "INR", exchange_rate: "", transport_mode: "road", port_loading: "Ludhiana, Punjab, India", port_discharge: "", final_destination: "", entry_point: "", agent_id: null, transporter_id: null, eway_bill: "", gr_no: "", payment_terms: "", delivery_terms: "", status: "proforma", notes: "", proforma_date: todayISO() });
  const [lines, setLines] = useState(() => saved.slice().sort((a, b) => a.position - b.position).map((l) => {
    const pr = d.products.find((p) => p.id === l.product_id);
    return { ...blankLine(), ...l, key: newKey(), product_hsn: pr?.hsn || "", brand_owner: pr?.brand_owner || "", manual: !l.batch_id && !!l.batch_no, mfg: l.mfg || "", exp: l.exp || "", qty: l.qty ?? "", rate: l.rate ?? "", pcs_per_carton: l.pcs_per_carton ?? "", net_kg: l.net_kg ?? "", gross_kg: l.gross_kg ?? "", partial_net: l.partial_net ?? "", partial_gross: l.partial_gross ?? "" };
  }));
  const [busy, setBusy] = useState(false);
  const [orderFile, setOrderFile] = useState(null); const [orders, setOrders] = useState([]);
  const loadOrders = async () => { if (!ship) return; const { data } = await supabase.from("exp_attachments").select("id,file_path,file_name,created_at").eq("shipment_id", ship.id).eq("kind", "po").order("created_at"); setOrders(data || []); };
  useEffect(() => { loadOrders(); }, []); // eslint-disable-line
  const removeOrder = async (o) => { if (!(await ask({ title: "Remove this copy of the order?", okText: "Remove", danger: true }))) return; if (o.file_path) await supabase.storage.from("export").remove([o.file_path]); const r = await run(supabase.from("exp_attachments").delete().eq("id", o.id), "Removed"); if (r.ok) loadOrders(); };
  const isPI = s.status === "proforma";
  const set = (k) => (e) => setS((x) => ({ ...x, [k]: e.target.value }));
  // proforma number follows the usual pattern from the date (PI_VH_dd.mm.yyyy, VI_PI_dd.mm.yyyy); a second one on the same day gets _2
  const suggestPI = (firm, date, id) => {
    if (!date) return ""; const dm = `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`; const base = firm === "VI" ? `VI_PI_${dm}` : `PI_${firm}_${dm}`;
    const used = new Set(d.shipments.filter((x) => x.id !== id && x.firm_id === firm && x.proforma_no).map((x) => x.proforma_no.toLowerCase())); let n = base, k = 2; while (used.has(n.toLowerCase())) n = `${base}_${k++}`; return n;
  };
  const autoPI = (patch) => setS((x) => { const y = { ...x, ...patch }; const prev = suggestPI(x.firm_id, x.proforma_date, ship?.id); if (!x.proforma_no || x.proforma_no === prev) y.proforma_no = suggestPI(y.firm_id, y.proforma_date, ship?.id); return y; });
  useEffect(() => { if (!ship) autoPI({}); }, []); // eslint-disable-line
  const country = d.countries.find((c) => c.country === s.country);
  const countryParties = d.parties.filter((p) => p.country === s.country && (p.roles || []).some((r) => r === "buyer" || r === "consignee"));
  const party = d.parties.find((p) => p.id === s.party_id);
  const products = d.products.filter((p) => p.firm_id === s.firm_id);

  const pickCountry = (e) => { const c = d.countries.find((x) => x.country === e.target.value); setS((x) => ({ ...x, country: e.target.value, party_id: null, currency: c?.currency || x.currency })); };
  const pickParty = (e) => {
    const p = d.parties.find((x) => x.id === e.target.value);
    setS((x) => ({ ...x, party_id: p?.id || null, ...(p ? { currency: p.currency || x.currency, firm_id: p.usual_firm || x.firm_id, payment_terms: x.payment_terms || p.payment_terms || "", delivery_terms: x.delivery_terms || p.delivery_terms || "", entry_point: x.entry_point || p.entry_point || "" } : {}) }));
  };
  const priceFor = (productId) => {
    const all = d.prices.filter((p) => p.product_id === productId && p.currency === s.currency);
    const best = (a) => a.sort((x, y) => (y.as_of || "").localeCompare(x.as_of || ""))[0];
    return best(all.filter((p) => p.party_id && p.party_id === s.party_id)) || best(all.filter((p) => !p.party_id));
  };
  const setLine = (i, patch) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const chooseProduct = (i, name) => {
    const p = products.find((x) => normName(x.name) === normName(name));
    if (!p) { setLine(i, { name, product_id: null }); return; }
    const pr = priceFor(p.id);
    setLine(i, { name: p.name, product_id: p.id, hsn: p.hsn || "", product_hsn: p.hsn || "", brand_owner: p.brand_owner || "", pcs_per_carton: p.pcs_per_carton ?? "", net_kg: p.net_kg ?? "", gross_kg: p.gross_kg ?? "", rate: pr ? pr.rate : "", batch_id: null, batch_no: "", mfg: "", exp: "", manual: false });
  };
  const batchesFor = (l) => (l.name ? d.batches.filter((b) => normName(b.product_name) === normName(l.name)).sort((a, b) => (b.mfg || "").localeCompare(a.mfg || "")).slice(0, 40) : []);
  const chooseBatch = (i, v) => {
    if (v === "__manual") { setLine(i, { manual: true, batch_id: null }); return; }
    const b = d.batches.find((x) => x.id === v); if (!b) { setLine(i, { batch_id: null, batch_no: "", mfg: "", exp: "", manual: false }); return; }
    setLine(i, { manual: false, batch_id: b.id, batch_no: b.batch_no, mfg: b.mfg || "", exp: b.exp || "" });
  };

  const pk = useMemo(() => packLines(lines), [lines]);
  const tot = useMemo(() => totals(lines), [lines]);
  const checks = useMemo(() => preflight(s, lines, ctxFor(s, lines, d, batchState)), [s, lines, d, batchState]);
  const errs = checks.filter((c) => c.level === "error");

  const save = async () => {
    if (!s.country || !s.firm_id) { toast("Choose the exporting firm and the country first", "err"); return; }
    setBusy(true);
    const body = { firm_id: s.firm_id, country: s.country, party_id: s.party_id || null, notify_id: s.notify_id || null, brand_owner_id: s.brand_owner_id || null, invoice_no: txt(s.invoice_no), invoice_date: s.invoice_date || null,
      proforma_no: txt(s.proforma_no), proforma_date: s.proforma_date || null, po_no: txt(s.po_no), po_date: s.po_date || null, currency: s.currency, exchange_rate: nm(s.exchange_rate), transport_mode: s.transport_mode,
      port_loading: txt(s.port_loading), port_discharge: txt(s.port_discharge), final_destination: txt(s.final_destination), entry_point: txt(s.entry_point), agent_id: s.agent_id || null, transporter_id: s.transporter_id || null,
      eway_bill: txt(s.eway_bill), gr_no: txt(s.gr_no), payment_terms: txt(s.payment_terms), delivery_terms: txt(s.delivery_terms), status: s.status, notes: txt(s.notes) };
    const r = ship ? await supabase.from("exp_shipments").update(body).eq("id", ship.id).select("id").single() : await supabase.from("exp_shipments").insert(body).select("id").single();
    if (r.error) { setBusy(false); toast(r.error.code === "23505" ? `Invoice number ${s.invoice_no} is already used for this firm` : r.error.message, "err"); return; }
    const id = r.data.id; const keep = new Set(lines.filter((l) => l.id).map((l) => l.id));
    const gone = saved.filter((l) => !keep.has(l.id)).map((l) => l.id);
    if (gone.length) { const x = await run(supabase.from("exp_shipment_lines").delete().in("id", gone)); if (!x.ok) { setBusy(false); return; } }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; if (!l.name.trim()) continue;
      const lb = { shipment_id: id, position: i + 1, product_id: l.product_id || null, name: l.name.trim(), hsn: txt(l.hsn), batch_id: l.batch_id || null, batch_no: txt(l.batch_no), mfg: l.mfg || null, exp: l.exp || null, qty: Math.round(nm(l.qty) || 0), rate: nm(l.rate),
        pcs_per_carton: nm(l.pcs_per_carton) != null ? Math.round(nm(l.pcs_per_carton)) : null, net_kg: nm(l.net_kg), gross_kg: nm(l.gross_kg), partial_net: nm(l.partial_net), partial_gross: nm(l.partial_gross) };
      const w = l.id ? await run(supabase.from("exp_shipment_lines").update(lb).eq("id", l.id)) : await run(supabase.from("exp_shipment_lines").insert(lb));
      if (!w.ok) { setBusy(false); return; }
    }
    if (orderFile) { const ok = await saveAttachment(id, "po", orderFile, { ref_no: txt(s.po_no), doc_date: s.po_date || null }); if (!ok) { setBusy(false); toast("The shipment was saved but the order file could not be stored. Open it again and add the order.", "err"); onSaved(); return; } }
    setBusy(false); toast("Shipment saved"); onSaved(); onClose();
  };
  const del = async () => {
    if (!(await ask({ title: `Remove shipment ${s.invoice_no || ""}?`, body: "It disappears from the list.", okText: "Remove", danger: true }))) return;
    const r = await run(supabase.from("exp_shipments").update({ deleted_at: new Date().toISOString() }).eq("id", ship.id), "Shipment removed"); if (r.ok) { onSaved(); onClose(); }
  };
  const agents = (k) => d.agents.filter((a) => (k === "cha" ? ["cha", "forwarder"].includes(a.kind) : a.kind === "transporter" || a.kind === "other"));
  const owners = d.parties.filter((p) => (p.roles || []).includes("brand_owner")), notifies = d.parties.filter((p) => (p.roles || []).includes("notify"));
  const idsLine = party ? Object.entries(party.ids || {}).map(([k, v]) => `${k} ${v}`).join(" · ") : "";
  const monthVal = (v) => (v ? v.slice(0, 7) : "");

  return (
    <div className="ex-editor">
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <button className="btn-ghost sm" onClick={onClose}>← All shipments</button>
        <b style={{ flex: 1, fontSize: 18 }}>{ship ? `Shipment ${ship.invoice_no || ""}` : "New order"}</b>
        {ship && isOwner && <button className="btn-danger sm" onClick={del}>Remove</button>}
        {ship ? <button className="btn-ghost" onClick={() => onPapers(ship)} title="Uses the saved shipment: save your changes first">📄 Papers</button> : null}
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save shipment"}</button>
      </div>

      {isPI
        ? <div className="rg-note amber" style={{ marginBottom: 8 }}><b>Stage: order received, proforma invoice.</b> Choose the party, add the products with quantity and rate, check the terms, then save and press <b>📄 Papers</b> to print the proforma. Batches, cartons and the invoice come later: when the buyer confirms and the goods are ready, change <b>Status</b> to “Preparing dispatch”.</div>
        : s.status === "draft" && <div className="rg-note grey" style={{ marginBottom: 8 }}>Stage: preparing dispatch. Choose the batches, check the cartons, type the invoice number, then prepare the papers.</div>}
      <div className="ipanel"><div className="ipanel-head"><div><h3>1 · Who and where</h3></div></div>
        <div className="ex-grid">
          <Field label="Exporting firm"><select className="form-inp" value={s.firm_id} onChange={(e) => autoPI({ firm_id: e.target.value })}>{Object.entries(FIRM_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Country"><select className="form-inp" value={s.country} onChange={pickCountry}><option value="">Choose…</option>{d.countries.map((c) => <option key={c.country}>{c.country}</option>)}</select></Field>
          <Field label="Buyer / consignee" hint={idsLine || (party ? "No IDs entered for this party" : "")}><select className="form-inp" value={s.party_id || ""} onChange={pickParty}><option value="">{s.country ? "Choose…" : "Choose the country first"}</option>{countryParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Notify party (if different)"><select className="form-inp" value={s.notify_id || ""} onChange={(e) => setS((x) => ({ ...x, notify_id: e.target.value || null }))}><option value="">Same as consignee</option>{notifies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Brand owner (if the brand is not Velite's)"><select className="form-inp" value={s.brand_owner_id || ""} onChange={(e) => setS((x) => ({ ...x, brand_owner_id: e.target.value || null }))}><option value="">None</option>{owners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Status"><select className="form-inp" value={s.status} onChange={set("status")}>{STATUS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        {country && <div className="small-muted">{country.route}{country.label_rule ? ` · ${country.label_rule}` : ""}</div>}
      </div>

      <div className="ipanel"><div className="ipanel-head"><div><h3>2 · Numbers and dates</h3><p>{isPI ? "The proforma number is filled in from the date and can be changed. Add the buyer’s PO number if there is one." : "You type the invoice number and the exchange rate; the Hub only checks them."}</p></div></div>
        <div className="ex-grid">
          {!isPI && <Field label="Invoice number"><input className="form-inp" value={s.invoice_no || ""} onChange={set("invoice_no")} placeholder="e.g. EX67" /></Field>}
          {!isPI && <Field label="Invoice date"><input className="form-inp" type="date" value={s.invoice_date || ""} onChange={set("invoice_date")} /></Field>}
          <Field label="Proforma invoice no."><input className="form-inp" value={s.proforma_no || ""} onChange={set("proforma_no")} placeholder="PI_VH_dd.mm.yyyy" /></Field>
          <Field label="Proforma date"><input className="form-inp" type="date" value={s.proforma_date || ""} onChange={(e) => autoPI({ proforma_date: e.target.value })} /></Field>
          <Field label="Buyer's order (PO) no."><input className="form-inp" value={s.po_no || ""} onChange={set("po_no")} /></Field>
          <Field label="PO date"><input className="form-inp" type="date" value={s.po_date || ""} onChange={set("po_date")} /></Field>
          <Field label="Buyer's order (PDF)" hint="A copy is saved with this shipment. You will also be asked for it when you make the proforma.">
            {orders.map((o) => <div key={o.id} className="small-muted"><a href="#open" onClick={(e) => { e.preventDefault(); openFile(o.file_path); }}>{o.file_name || "order"}</a> <button className="btn-ghost sm" onClick={() => removeOrder(o)}>Remove</button></div>)}
            <input type="file" accept=".pdf,image/*,.xlsx,.xls,.csv,.doc,.docx" onChange={(e) => setOrderFile(e.target.files?.[0] || null)} />
            {orderFile && <div className="small-muted">{orderFile.name} will be saved when you press Save shipment.</div>}
          </Field>
          <Field label="Invoice currency"><select className="form-inp" value={s.currency} onChange={set("currency")}><option>INR</option><option>USD</option></select></Field>
          {!isPI && s.currency !== "INR" && <Field label={`Exchange rate (₹ per ${s.currency})`} hint="Typed by hand for the invoice day."><input className="form-inp" value={s.exchange_rate ?? ""} onChange={set("exchange_rate")} inputMode="decimal" /></Field>}
        </div>
      </div>

      <div className="ipanel"><div className="ipanel-head"><div><h3>3 · Route and agents</h3></div></div>
        <div className="ex-grid">
          {!isPI && <Field label="Transport"><select className="form-inp" value={s.transport_mode} onChange={set("transport_mode")}>{MODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
          <Field label="Entry point (customs)"><input className="form-inp" value={s.entry_point || ""} onChange={set("entry_point")} placeholder="Sunauli (India) – Bhairahawa (Nepal)" /></Field>
          {!isPI && <Field label="Port of loading"><input className="form-inp" value={s.port_loading || ""} onChange={set("port_loading")} /></Field>}
          <Field label="Port of discharge"><input className="form-inp" value={s.port_discharge || ""} onChange={set("port_discharge")} /></Field>
          <Field label="Final destination"><input className="form-inp" value={s.final_destination || ""} onChange={set("final_destination")} /></Field>
          <Field label="Payment terms"><input className="form-inp" value={s.payment_terms || ""} onChange={set("payment_terms")} /></Field>
          <Field label="Delivery terms"><input className="form-inp" value={s.delivery_terms || ""} onChange={set("delivery_terms")} /></Field>
          {!isPI && <Field label="Transporter"><select className="form-inp" value={s.transporter_id || ""} onChange={(e) => setS((x) => ({ ...x, transporter_id: e.target.value || null }))}><option value="">—</option>{agents("t").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          {!isPI && <Field label="Customs agent (CHA) / forwarder"><select className="form-inp" value={s.agent_id || ""} onChange={(e) => setS((x) => ({ ...x, agent_id: e.target.value || null }))}><option value="">—</option>{agents("cha").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          {!isPI && <Field label="E-way bill no."><input className="form-inp" value={s.eway_bill || ""} onChange={set("eway_bill")} /></Field>}
          {!isPI && <Field label="G.R. / docket no."><input className="form-inp" value={s.gr_no || ""} onChange={set("gr_no")} /></Field>}
        </div>
      </div>

      <div className="ipanel"><div className="ipanel-head"><div><h3>{isPI ? "4 · Products" : "4 · Products and batches"}</h3><p>{isPI ? "Choose each product and type the quantity. The rate comes from your price list and can be changed." : "You choose every batch. The Hub shows QC release and shelf life but never picks one for you."}</p></div></div>
        <datalist id="ex-prodnames">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        {lines.map((l, i) => {
          const opts = batchesFor(l); const st = l.batch_id && batchState ? batchState[l.batch_id] : null;
          return (
            <div key={l.key} className="ex-line">
              <div className="ex-line-top">
                <b>{i + 1}</b>
                <input className="form-inp" list="ex-prodnames" value={l.name} onChange={(e) => chooseProduct(i, e.target.value)} placeholder="Type or choose the product" />
                <button className="btn-ghost sm" onClick={() => setLines((x) => x.filter((_, j) => j !== i))} title="Remove this line">✕</button>
              </div>
              {l.name && !l.product_id && <div className="rg-note amber">This name is not in the Products list. Pick an existing product, or add it under Products first.</div>}
              <div className="ex-line-grid" style={isPI ? { gridTemplateColumns: "repeat(3,1fr)" } : undefined}>
                <label>Quantity (pcs)<input className="form-inp" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="numeric" /></label>
                <label>Rate ({s.currency})<input className="form-inp" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} inputMode="decimal" /></label>
                <label>HSN<input className="form-inp" value={l.hsn} onChange={(e) => setLine(i, { hsn: e.target.value })} /></label>
                {!isPI && <label>Pcs / carton<input className="form-inp" value={l.pcs_per_carton} onChange={(e) => setLine(i, { pcs_per_carton: e.target.value })} inputMode="numeric" /></label>}
                {!isPI && <label>Net kg / carton<input className="form-inp" value={l.net_kg} onChange={(e) => setLine(i, { net_kg: e.target.value })} inputMode="decimal" /></label>}
                {!isPI && <label>Gross kg / carton<input className="form-inp" value={l.gross_kg} onChange={(e) => setLine(i, { gross_kg: e.target.value })} inputMode="decimal" /></label>}
              </div>
              {!isPI && <div className="ex-line-batch">
                {!l.manual ? (
                  <select className="form-inp" value={l.batch_id || ""} onChange={(e) => chooseBatch(i, e.target.value)} disabled={!l.name}>
                    <option value="">{opts.length ? "Choose the batch…" : l.name ? "No batch found in Batch Detail" : "Choose the product first"}</option>
                    {opts.map((b) => <option key={b.id} value={b.id}>{b.batch_no} · mfg {fmtM(b.mfg)} · exp {fmtM(b.exp)}{batchState ? ` · ${batchState[b.id] ? STATE_LABEL[batchState[b.id]] : "QC not found"}` : ""}</option>)}
                    <option value="__manual">✎ Type the batch by hand…</option>
                  </select>
                ) : (
                  <div className="ex-line-grid" style={{ gridTemplateColumns: "2fr 1fr 1fr auto" }}>
                    <input className="form-inp" value={l.batch_no} onChange={(e) => setLine(i, { batch_no: e.target.value })} placeholder="Batch no." />
                    <input className="form-inp" type="month" value={monthVal(l.mfg)} onChange={(e) => setLine(i, { mfg: e.target.value ? `${e.target.value}-01` : "" })} title="Mfg" />
                    <input className="form-inp" type="month" value={monthVal(l.exp)} onChange={(e) => setLine(i, { exp: e.target.value ? `${e.target.value}-01` : "" })} title="Exp" />
                    <button className="btn-ghost sm" onClick={() => setLine(i, { manual: false, batch_no: "", mfg: "", exp: "" })}>Use the list</button>
                  </div>)}
                {l.batch_id && <span className="ex-state" style={{ background: st ? STATE_COLOR[st] : "#94a3b8" }}>{st ? STATE_LABEL[st] : "QC not found"}</span>}
                {l.batch_no && l.exp && <small className="small-muted"> mfg {fmtM(l.mfg)} · exp {fmtM(l.exp)}</small>}
              </div>}
              {Number(l.qty) > 0 && Number(l.rate) > 0 && <div className="small-muted">Line value {money(lineAmount(l), s.currency)}</div>}
            </div>);
        })}
        <button className="btn-ghost sm" onClick={() => setLines((x) => [...x, blankLine()])}>＋ Add a product</button>
        {!isPI && !d.batches.length && <div className="rg-note grey">Batches cannot be listed for your login. Type each batch by hand, or ask for Batch Detail access.</div>}
      </div>

      {!isPI && (<div className="ipanel"><div className="ipanel-head"><div><h3>5 · Cartons and totals</h3><p>Worked out from the quantities and the carton data. A part carton is made when the quantity does not fill a whole carton.</p></div></div>
        {pk.rows.length === 0 ? <div className="small-muted">Add quantities to see the cartons.</div> : (
          <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Boxes</th><th>Product</th><th>Pcs / box</th><th>Qty</th><th>Net kg / box</th><th>Gross kg / box</th><th>Net kg</th><th>Gross kg</th></tr></thead>
            <tbody>{pk.rows.map((r, i) => r.unknown ? <tr key={i}><td colSpan={8} style={{ color: "#b45309" }}>Line {r.line + 1}: pieces per carton is missing, so cartons cannot be worked out.</td></tr> : (
              <tr key={i}><td>{r.from === r.to ? r.from : `${r.from}-${r.to}`}</td><td>{lines[r.line].name}{r.part ? " (part carton)" : ""}</td><td>{r.perBox}</td><td>{r.qty}</td>
                <td>{r.part ? <input className="form-inp ex-mini" value={lines[r.line].partial_net} placeholder={String(r.netPerBox)} onChange={(e) => setLine(r.line, { partial_net: e.target.value })} /> : r.netPerBox}</td>
                <td>{r.part ? <input className="form-inp ex-mini" value={lines[r.line].partial_gross} placeholder={String(r.grossPerBox)} onChange={(e) => setLine(r.line, { partial_gross: e.target.value })} /> : r.grossPerBox}</td><td>{r.net}</td><td>{r.gross}</td></tr>))}
              <tr style={{ fontWeight: 700 }}><td colSpan={3}>Total</td><td>{tot.qty}</td><td></td><td></td><td>{pk.net}</td><td>{pk.gross}</td></tr></tbody></table></div>)}
        <div className="ex-total">Boxes <b>{pk.boxes}</b> · Quantity <b>{tot.qty}</b> · Invoice value <b>{money(tot.amount, s.currency)}</b>{s.currency !== "INR" && Number(s.exchange_rate) > 0 && <> · about <b>{money(tot.amount * Number(s.exchange_rate), "INR")}</b></>}</div>
      </div>)}

      <div className="ipanel"><div className="ipanel-head"><div><h3>{isPI ? "5" : "6"} · Check before the papers are made {errs.length ? <span style={{ color: "#b91c1c" }}>· {errs.length} to fix</span> : <span style={{ color: "#16a34a" }}>· nothing blocking</span>}</h3></div></div>
        {checks.length === 0 ? <Empty>All good. 👍</Empty> : checks.map((c, i) => <div key={i} className={`ex-check ${c.level}`}>{c.level === "error" ? "⛔" : c.level === "warn" ? "⚠️" : "ℹ️"} {c.text}</div>)}
        <Field label="Notes"><textarea className="form-inp" rows={2} value={s.notes || ""} onChange={set("notes")} /></Field>
      </div>
      <div style={{ textAlign: "right", marginBottom: 20 }}><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save shipment"}</button></div>
      {dialog}
    </div>
  );
}
