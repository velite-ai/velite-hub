import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";
import { FIRM_COLORS } from "./compliance/common";
import { stateOf, STATE_LABEL, STATE_COLOR, fmtD, fmtM, monthLabel, monthKey, todayISO } from "../lib/qc";
import { KINDS, MARKETS, normBatch, groupOf, letterOf, readBatchSheet } from "../lib/batches";

// Batch Detail: the production batch-coding register (replaces the "Batch Detail" Google Sheet).
// A batch can be split into products: V-001A is the mother, V-001B and V-001C are its children. A batch entered here
// appears in QC Release as "not sampled yet". A batch planned in advance (numbers printed by the vendor) waits as "Planned".

const PAGE = 50;
// newest manufacturing month first; inside a month by firm and type, then by the running number (highest first), mother before children
const serialOf = (r) => { const m = String(r.group_no || r.batch_no || "").match(/(\d+)\D*$/); return m ? +m[1] : 0; };
const byOrder = (a, b) => ((a.mfg || "") !== (b.mfg || "") ? ((b.mfg || "") > (a.mfg || "") ? 1 : -1)
  : a.firm_id !== b.firm_id ? (a.firm_id < b.firm_id ? 1 : -1)
  : a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1)
  : (b.series_year || 0) - (a.series_year || 0) || serialOf(b) - serialOf(a) || ((a.child_letter || "A") < (b.child_letter || "A") ? -1 : 1));
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const addMonths = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const qtyText = (b) => [b.pieces != null ? `${b.pieces.toLocaleString("en-IN")} pcs` : null, b.batch_size != null ? `${Number(b.batch_size)} ${b.batch_size_unit || ""}`.trim() : null].filter(Boolean).join(" · ");

// what the next batch number could be
export function suggestBatchNo(rows, firm, kind, product, mfg) {
  const year = mfg ? +mfg.slice(0, 4) : new Date().getFullYear();
  const num = (b) => { const m = String(b).match(/(\d+)[A-Za-z]?$/); return m ? +m[1] : null; };
  if (firm === "VP") {
    const used = rows.filter((r) => r.firm_id === "VP" && r.kind === kind && r.series_year === year).map((r) => num(r.group_no || r.batch_no)).filter((n) => n != null);
    const next = (used.length ? Math.max(...used) : 0) + 1;
    return kind === "other" ? `V-${String(next).padStart(3, "0")}` : String(next).padStart(3, "0");
  }
  if (firm === "VH" && kind === "other") {
    const letters = String(product || "").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
    if (letters.length < 2) return "";
    const used = rows.filter((r) => r.firm_id === "VH" && r.kind === "other").map((r) => num(r.batch_no)).filter((n) => n != null && n < 100000);
    return `H${letters}-${(used.length ? Math.max(...used) : 0) + 1}`;
  }
  return "";
}

function useQcStatus(batchRows) {
  const [map, setMap] = useState({});
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 120000); const f = () => setTick((x) => x + 1); window.addEventListener("focus", f); return () => { clearInterval(t); window.removeEventListener("focus", f); }; }, []);
  useEffect(() => {
    let live = true;
    supabase.rpc("hub_batch_qc_status").then(({ data }) => { if (live && data) setMap(Object.fromEntries(data.map((r) => [r.batch_id, r]))); });
    return () => { live = false; };
  }, [batchRows.length, tick]);
  return map;
}

export default function BatchDetail() {
  const { batches, products, canBatchEdit, isOwner } = useData();
  const [view, setView] = useState("list");
  const [edit, setEdit] = useState(null);
  const rows = useMemo(() => batches.rows.filter((r) => !r.deleted_at), [batches.rows]);
  const qcMap = useQcStatus(rows);
  const planned = rows.filter((r) => r.status === "planned");
  const toCheck = rows.filter((r) => (r.import_flags || []).length && !r.review_done).length;
  const stateFor = (b) => { const q = qcMap[b.id]; return q ? stateOf({ ...q, stage: "fp" }) : null; };

  return (
    <div className="section qcp">
      <div className="mt-hero bd-hero">
        <div>
          <div className="mt-hero-title">🏭 Batch Detail</div>
          <div className="mt-hero-sub">Production batch coding for VP and VH · tubes and other than tubes · feeds QC Release automatically</div>
        </div>
        {canBatchEdit && <button className="qc-add" onClick={() => setEdit({ draft: true })}>＋ New batch</button>}
      </div>
      <div className="tk-views qc-tabs">
        {[["list", "📋 Batches"], ["planned", `📅 Planned${planned.length ? ` (${planned.length})` : ""}`], ...(isOwner ? [["products", "🧾 Products"]] : []), ...(canBatchEdit ? [["check", `🔍 Import & check${toCheck ? ` (${toCheck})` : ""}`]] : [])].map(([k, l]) => (
          <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>))}
      </div>
      {batches.loading ? <div className="loading">Loading…</div> : (
        view === "list" ? <List rows={rows} stateFor={stateFor} onOpen={(r) => setEdit({ row: r })} />
        : view === "planned" ? <Planned rows={planned} onOpen={(r) => setEdit({ row: r })} canEdit={canBatchEdit} reload={batches.reload} />
        : view === "products" ? <Products rows={products.rows} reload={products.reload} />
        : <Check rows={rows} products={products.rows} onOpen={(r) => setEdit({ row: r })} reload={() => { batches.reload(); products.reload(); }} />
      )}
      {edit && <BatchForm row={edit.row} draft={edit.draft} all={rows} products={products.rows} readOnly={!canBatchEdit} onClose={() => setEdit(null)} onSaved={batches.reload} />}
    </div>
  );
}

// ── list ─────────────────────────────────────────────────────────────────
function List({ rows, stateFor, onOpen }) {
  const [firm, setFirm] = useState(""); const [kind, setKind] = useState(""); const [month, setMonth] = useState(""); const [split, setSplit] = useState(false);
  const [q, setQ] = useState(""); const [shown, setShown] = useState(PAGE);
  const months = useMemo(() => [...new Set(rows.map((r) => monthKey(r.mfg)).filter(Boolean))].sort().reverse(), [rows]);
  const groupSize = useMemo(() => { const m = {}; rows.forEach((r) => { const k = `${r.firm_id}|${r.kind}|${r.group_no}|${r.series_year}`; m[k] = (m[k] || 0) + 1; }); return m; }, [rows]);
  const gk = (r) => `${r.firm_id}|${r.kind}|${r.group_no}|${r.series_year}`;
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => r.status === "made" && (!firm || r.firm_id === firm) && (!kind || r.kind === kind) && (!month || monthKey(r.mfg) === month) && (!split || groupSize[gk(r)] > 1)
      && (!s || [r.product_name, r.batch_no, r.market, r.note, r.remarks_original].join(" ").toLowerCase().includes(s)))
      .sort(byOrder);
  }, [rows, firm, kind, month, split, q, groupSize]); // eslint-disable-line
  return (
    <>
      <div className="pg-search chk-noprint"><SearchBox value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="🔎 Search product, batch number, market, remarks…" />{q && <button className="btn-ghost" onClick={() => setQ("")}>Clear</button>}</div>
      <div className="qc-filters" style={{ marginBottom: 8 }}>
        <select className="inp inp-filter" value={firm} onChange={(e) => { setFirm(e.target.value); setShown(PAGE); }}><option value="">VP and VH</option><option>VP</option><option>VH</option></select>
        <select className="inp inp-filter" value={kind} onChange={(e) => { setKind(e.target.value); setShown(PAGE); }}><option value="">All types (tubes and other than tubes)</option>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="inp inp-filter" value={month} onChange={(e) => { setMonth(e.target.value); setShown(PAGE); }}><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        <label className="chk"><input type="checkbox" checked={split} onChange={(e) => { setSplit(e.target.checked); setShown(PAGE); }} /> Split batches only</label>
        <span className="small-muted">{list.length} batch{list.length === 1 ? "" : "es"}</span>
      </div>
      {list.length === 0 ? <Empty>No batches match.</Empty> : (
        <div className="table-wrap">
          <table className="tbl qc-tbl">
            <thead><tr><th>Batch</th><th>Type</th><th>Product</th><th>Mfg</th><th>Exp</th><th>MRP</th><th>Quantity</th><th>Market / note</th><th>QC</th></tr></thead>
            <tbody>
              {list.slice(0, shown).map((r) => {
                const st = stateFor(r); const n = groupSize[gk(r)];
                return (
                  <tr key={r.id} className="qc-tr" onClick={() => onOpen(r)}>
                    <td className="nowrap"><span className="tk-firm" style={{ background: FIRM_COLORS[r.firm_id] }}>{r.firm_id}</span><b>{r.batch_no}</b>{n > 1 && <small className="qc-sub"> {r.child_letter === "A" || !r.child_letter ? "mother" : "child"} of {n}</small>}</td>
                    <td className="nowrap"><small className="qc-sub">{r.kind === "tube" ? "Tubes only" : "Other than tubes"}</small></td>
                    <td>{r.product_name}{(r.import_flags || []).length > 0 && !r.review_done && <span className="qc-flag" title={r.import_flags.join("\n")}>⚠</span>}</td>
                    <td className="nowrap">{fmtM(r.mfg)}</td><td className="nowrap">{fmtM(r.exp)}</td>
                    <td className="nowrap">{r.mrp != null ? `₹${Number(r.mrp).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—"}</td>
                    <td className="nowrap">{qtyText(r) || "—"}</td>
                    <td>{r.market && <span className="qc-tent">{r.market}</span>} {r.note && <small className="qc-sub">{r.note.slice(0, 60)}</small>}</td>
                    <td className="nowrap">{st ? <span className="qc-pill" style={{ background: STATE_COLOR[st] }}>{STATE_LABEL[st]}</span> : <span className="small-muted">—</span>}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>)}
      {list.length > shown && <div style={{ textAlign: "center", marginTop: 12 }}><button className="btn-ghost" onClick={() => setShown((n) => n + PAGE * 3)}>Show more ({list.length - shown} left)</button></div>}
    </>
  );
}

function Planned({ rows, onOpen, canEdit, reload }) {
  const mark = async (r) => { const x = await run(supabase.from("hub_batches").update({ status: "made", entered_on: todayISO() }).eq("id", r.id), "Marked as made. QC Release now shows it as not sampled yet."); if (x.ok) reload(); };
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>📅 Planned in advance</h3><p>Batch numbers given ahead of time, for example when the vendor prints the packing. They do not go to QC Release until you mark them as made.</p></div></div>
      {rows.length === 0 && <Empty>No planned batches. Tick “Planned in advance” when you add one.</Empty>}
      {rows.sort((a, b) => ((a.mfg || "") < (b.mfg || "") ? -1 : 1)).map((r) => (
        <div key={r.id} className="qc-row">
          <span className="qc-row-main"><b><span className="tk-firm" style={{ background: FIRM_COLORS[r.firm_id] }}>{r.firm_id}</span>{r.product_name}</b><small>{r.batch_no} · {KINDS[r.kind]} · mfg {fmtM(r.mfg)}{r.mrp != null ? ` · ₹${r.mrp}` : ""}</small></span>
          <button className="btn-ghost sm" onClick={() => onOpen(r)}>Open</button>
          {canEdit && <button className="btn-primary sm" onClick={() => mark(r)}>Mark as made</button>}
        </div>))}
    </div>
  );
}

// ── add / edit ───────────────────────────────────────────────────────────
const blankChild = () => ({ product_name: "", pieces: "", mrp: "", market: "" });
function BatchForm({ row, draft, all, products, readOnly, onClose, onSaved }) {
  const { isOwner } = useData();
  const isNew = !row;
  const [f, setF] = useState(() => ({
    firm_id: row?.firm_id || "", kind: row?.kind || "other", product_name: row?.product_name || "", pack_size: row?.pack_size || "",
    mfg: row?.mfg || (draft ? `${todayISO().slice(0, 7)}-01` : ""), exp: row?.exp || "", mrp: row?.mrp ?? "", usp: row?.usp ?? "", batch_no: row?.batch_no || "",
    batch_size: row?.batch_size ?? "", batch_size_unit: row?.batch_size_unit || "kg", pieces: row?.pieces ?? "", market: row?.market || "", note: row?.note || "", status: row?.status || "made",
  }));
  const [kids, setKids] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setMfg = (e) => { const v = e.target.value ? `${e.target.value}-01` : ""; setF((x) => ({ ...x, mfg: v, exp: x.exp || (v ? addMonths(v, 23) : "") })); };
  const sib = row ? all.filter((r) => r.id !== row.id && r.firm_id === row.firm_id && r.kind === row.kind && r.group_no === row.group_no && r.series_year === row.series_year) : [];
  const names = useMemo(() => products.filter((p) => p.active && (!f.firm_id || !p.firm_id || p.firm_id === f.firm_id)).map((p) => p.name), [products, f.firm_id]);
  const suggestion = isNew && f.firm_id ? suggestBatchNo(all, f.firm_id, f.kind, f.product_name, f.mfg) : "";
  const dup = f.batch_no.trim() && all.some((r) => r.id !== row?.id && r.firm_id === f.firm_id && r.kind === f.kind && normBatch(r.batch_no) === normBatch(f.batch_no) && r.series_year === (f.mfg ? +f.mfg.slice(0, 4) : null));

  const save = async () => {
    if (busy) return;
    if (!f.firm_id) { toast("Choose the firm (VP or VH).", "err"); return; }
    if (!f.product_name.trim()) { toast("Choose or type the product name.", "err"); return; }
    if (!f.batch_no.trim()) { toast("Enter the batch number.", "err"); return; }
    if (!f.mfg) { toast("Choose the manufacturing month.", "err"); return; }
    setBusy(true);
    const base = {
      firm_id: f.firm_id, kind: f.kind, product_name: f.product_name.trim(), pack_size: f.pack_size.trim() || null, mfg: f.mfg, exp: f.exp || null,
      mrp: f.mrp === "" ? null : Number(f.mrp), usp: f.usp === "" ? null : Number(f.usp),
      batch_size: f.batch_size === "" ? null : Number(f.batch_size), batch_size_unit: f.batch_size === "" ? null : f.batch_size_unit, pieces: f.pieces === "" ? null : parseInt(f.pieces, 10),
      market: f.market.trim() || null, note: f.note.trim() || null, status: f.status,
    };
    let r;
    if (isNew) {
      const root = groupOf(f.batch_no.trim()); const kidsOk = kids.filter((k) => k.product_name.trim());
      const motherNo = kidsOk.length && !letterOf(f.batch_no) ? `${root}A` : f.batch_no.trim();
      const g = groupOf(motherNo);
      const list = [{ ...base, batch_no: motherNo, group_no: g, child_letter: kidsOk.length || letterOf(motherNo) ? (letterOf(motherNo) || "A") : null, series_year: +f.mfg.slice(0, 4) }];
      kidsOk.forEach((k, i) => { const L = LETTERS[1 + i]; list.push({ ...base, product_name: k.product_name.trim(), pack_size: null, usp: null, mrp: k.mrp === "" ? null : Number(k.mrp), pieces: k.pieces === "" ? null : parseInt(k.pieces, 10), batch_size: null, batch_size_unit: null, market: k.market.trim() || base.market, note: null, batch_no: `${g}${L}`, group_no: g, child_letter: L, series_year: +f.mfg.slice(0, 4) }); });
      r = await run(supabase.from("hub_batches").insert(list), list.length > 1 ? `${list.length} batches saved (mother and children)` : "Batch saved");
    } else {
      const kidsOk = kids.filter((k) => k.product_name.trim());
      r = await run(supabase.from("hub_batches").update({ ...base, batch_no: f.batch_no.trim(), group_no: groupOf(f.batch_no.trim()), child_letter: letterOf(f.batch_no), series_year: +f.mfg.slice(0, 4), review_done: true }).eq("id", row.id), "Saved");
      if (r.ok && kidsOk.length) {
        const used = new Set([row.child_letter, ...sib.map((s) => s.child_letter)].filter(Boolean)); const g = row.group_no || groupOf(row.batch_no);
        const list = kidsOk.map((k) => { let L = ""; for (const c of LETTERS) if (c !== "A" && !used.has(c)) { L = c; used.add(c); break; }
          return { ...base, product_name: k.product_name.trim(), pack_size: null, usp: null, mrp: k.mrp === "" ? null : Number(k.mrp), pieces: k.pieces === "" ? null : parseInt(k.pieces, 10), batch_size: null, batch_size_unit: null, market: k.market.trim() || base.market, note: null, batch_no: `${g}${L}`, group_no: g, child_letter: L, series_year: +f.mfg.slice(0, 4) }; });
        r = await run(supabase.from("hub_batches").insert(list), `${list.length} more product${list.length > 1 ? "s" : ""} added to this batch`);
      }
    }
    setBusy(false);
    if (r.ok) { onSaved(); onClose(); }
  };
  const remove = async () => {
    if (!(await ask({ title: "Delete this batch?", body: `${row.product_name} (${row.batch_no}) moves to the recycle bin. Its QC Release record is not deleted.`, okText: "Delete", danger: true }))) return;
    const r = await run(supabase.from("hub_batches").update({ deleted_at: new Date().toISOString() }).eq("id", row.id), "Deleted");
    if (r.ok) { onSaved(); onClose(); }
  };
  const dis = readOnly;

  return (
    <Modal title={isNew ? "New batch" : `${row.product_name} · ${row.batch_no}`} onClose={onClose} wide
      actions={<>{!isNew && isOwner && <button className="btn-danger" onClick={remove} style={{ marginRight: "auto" }}>Delete</button>}<button className="btn-ghost" onClick={onClose}>{dis ? "Close" : "Cancel"}</button>{!dis && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>}</>}>
      {dis && <div className="small-muted" style={{ marginBottom: 8 }}>You can look at batches but not change them.</div>}
      <div className="form-grid">
        <Field label="Firm"><select className="form-inp" value={f.firm_id} onChange={set("firm_id")} disabled={dis}><option value="">Choose…</option><option>VP</option><option>VH</option></select></Field>
        <Field label="Type"><select className="form-inp" value={f.kind} onChange={set("kind")} disabled={dis}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Manufacturing month"><input className="form-inp" type="month" value={f.mfg ? f.mfg.slice(0, 7) : ""} onChange={setMfg} disabled={dis} /></Field>
        <Field label="Expiry month"><input className="form-inp" type="month" value={f.exp ? f.exp.slice(0, 7) : ""} onChange={(e) => setF((x) => ({ ...x, exp: e.target.value ? `${e.target.value}-01` : "" }))} disabled={dis} /></Field>
      </div>
      <Field label="Product" hint={f.firm_id ? "Pick from the list. A new product must be added by an owner (Products tab)." : "Choose the firm first to see its products."}>
        <input className="form-inp" list="bd-products" value={f.product_name} onChange={set("product_name")} disabled={dis} placeholder="Type or pick from the list…" />
        <datalist id="bd-products">{names.map((x) => <option key={x} value={x} />)}</datalist>
      </Field>
      <div className="form-grid">
        <Field label="Batch number"><input className="form-inp" value={f.batch_no} onChange={set("batch_no")} disabled={dis} />
          {suggestion && !f.batch_no && <button type="button" className="link-btn" onClick={() => setF((x) => ({ ...x, batch_no: suggestion }))}>Use suggested: {suggestion}</button>}</Field>
        <Field label="MRP (₹)"><input className="form-inp" type="number" min="0" step="0.01" value={f.mrp} onChange={set("mrp")} disabled={dis} /></Field>
        {f.firm_id === "VH" && <Field label="Unit sale price (₹)"><input className="form-inp" type="number" min="0" step="0.01" value={f.usp} onChange={set("usp")} disabled={dis} /></Field>}
        {f.firm_id === "VH" && <Field label="Pack size"><input className="form-inp" value={f.pack_size} onChange={set("pack_size")} disabled={dis} placeholder="e.g. 30 ml" /></Field>}
      </div>
      {dup && <div className="mt-dup">⚠️ This batch number is already used for {f.firm_id} {KINDS[f.kind].toLowerCase()} in the same year.</div>}
      <div className="form-grid">
        <Field label="Batch size"><div style={{ display: "flex", gap: 6 }}><input className="form-inp" type="number" min="0" step="any" value={f.batch_size} onChange={set("batch_size")} disabled={dis} /><select className="form-inp" style={{ maxWidth: 80 }} value={f.batch_size_unit} onChange={set("batch_size_unit")} disabled={dis}><option>kg</option><option>ltr</option></select></div></Field>
        <Field label="Pieces"><input className="form-inp" type="number" min="0" value={f.pieces} onChange={set("pieces")} disabled={dis} /></Field>
        <Field label="Market"><select className="form-inp" value={MARKETS.includes(f.market) ? f.market : f.market ? "__other" : ""} onChange={(e) => setF((x) => ({ ...x, market: e.target.value === "__other" ? "Other" : e.target.value }))} disabled={dis}><option value="">India / not specified</option>{MARKETS.map((m) => <option key={m}>{m}</option>)}<option value="__other">Other…</option></select></Field>
      </div>
      {f.market && !MARKETS.includes(f.market) && <Field label="Which market?"><input className="form-inp" value={f.market === "Other" ? "" : f.market} onChange={set("market")} disabled={dis} /></Field>}
      <Field label="Note"><textarea className="form-inp" value={f.note} onChange={set("note")} disabled={dis} placeholder="For example: different MRP, new formula, tube short pending" /></Field>
      <label className="chk" style={{ margin: "4px 0 10px" }}><input type="checkbox" checked={f.status === "planned"} onChange={(e) => setF((x) => ({ ...x, status: e.target.checked ? "planned" : "made" }))} disabled={dis} /> Planned in advance (number reserved, not made yet). It will not go to QC Release until marked as made.</label>

      {sib.length > 0 && (
        <div className="bd-split"><b>Same batch, other products</b>
          {sib.sort((a, b) => ((a.child_letter || "A") < (b.child_letter || "A") ? -1 : 1)).map((s) => <div key={s.id} className="small-muted">{s.batch_no} · {s.product_name} {s.pieces ? `· ${s.pieces.toLocaleString("en-IN")} pcs` : ""} {s.mrp != null ? `· ₹${s.mrp}` : ""}</div>)}
        </div>)}
      {!dis && (
        <div className="bd-split">
          <b>{isNew ? "Split this batch into more products" : "Add another product from this batch"}</b>
          <div className="small-muted">The same lot filled into other products gets the next letters (A, B, C). They share the manufacturing and expiry month.</div>
          {kids.map((k, i) => (
            <div key={i} className="bd-kid">
              <input className="form-inp" list="bd-products" placeholder="Product" value={k.product_name} onChange={(e) => setKids((x) => x.map((y, j) => (j === i ? { ...y, product_name: e.target.value } : y)))} />
              <input className="form-inp" type="number" placeholder="Pieces" value={k.pieces} onChange={(e) => setKids((x) => x.map((y, j) => (j === i ? { ...y, pieces: e.target.value } : y)))} />
              <input className="form-inp" type="number" step="0.01" placeholder="MRP" value={k.mrp} onChange={(e) => setKids((x) => x.map((y, j) => (j === i ? { ...y, mrp: e.target.value } : y)))} />
              <button className="icon-btn" onClick={() => setKids((x) => x.filter((_, j) => j !== i))} title="Remove">✕</button>
            </div>))}
          <button className="btn-ghost sm" onClick={() => setKids((x) => [...x, blankChild()])}>＋ Add a product</button>
        </div>)}
      {row?.remarks_original && <div className="small-muted" style={{ marginTop: 10 }}><b>Original remarks from the sheet:</b> {row.remarks_original}</div>}
      {dialog}
    </Modal>
  );
}

// ── products (owners) ────────────────────────────────────────────────────
function Products({ rows, reload }) {
  const [q, setQ] = useState(""); const [name, setName] = useState(""); const [firm, setFirm] = useState("");
  const s = q.trim().toLowerCase();
  const list = rows.filter((p) => !s || p.name.toLowerCase().includes(s));
  const add = async () => {
    if (!name.trim()) return;
    const r = await run(supabase.from("hub_products").insert({ name: name.trim(), firm_id: firm || null }), "Product added");
    if (r.ok) { setName(""); reload(); }
  };
  const toggle = async (p) => { const r = await run(supabase.from("hub_products").update({ active: !p.active }).eq("id", p.id), p.active ? "Hidden from the list" : "Back in the list"); if (r.ok) reload(); };
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>🧾 Product list</h3><p>The names production picks from. Include the pack size in the name, as in the old list. {rows.length} products.</p></div></div>
      <div className="qc-filters" style={{ marginBottom: 10 }}>
        <input className="form-inp" style={{ flex: 1, minWidth: 220 }} placeholder="New product name, for example ACNECAV GEL 15GM" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="">Both firms</option><option>VP</option><option>VH</option></select>
        <button className="btn-primary" onClick={add}>＋ Add</button>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="🔎 Search the list…" />
      <div className="table-wrap" style={{ marginTop: 8, maxHeight: 420, overflowY: "auto" }}><table className="tbl"><thead><tr><th>Product</th><th>Firm</th><th></th></tr></thead><tbody>
        {list.slice(0, 200).map((p) => <tr key={p.id} className={p.active ? "" : "row-off"}><td>{p.name}</td><td>{p.firm_id || "both"}</td><td><button className="restore-btn" onClick={() => toggle(p)}>{p.active ? "Hide" : "Show"}</button></td></tr>)}
      </tbody></table></div>
      {list.length > 200 && <div className="small-muted">Showing 200 of {list.length}. Type to narrow it down.</div>}
    </div>
  );
}

// ── import and check ─────────────────────────────────────────────────────
function Check({ rows, products, onOpen, reload }) {
  const flagged = rows.filter((r) => (r.import_flags || []).length && !r.review_done);
  const imported = rows.filter((r) => r.legacy_ref).length;
  const [prev, setPrev] = useState(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(null); const [err, setErr] = useState("");
  const byRef = useMemo(() => Object.fromEntries(rows.filter((r) => r.legacy_ref).map((r) => [r.legacy_ref, r])), [rows]);

  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    setErr(""); setPrev(null); setDone(null);
    try {
      const XLSX = await import("xlsx");
      const res = readBatchSheet(XLSX, new Uint8Array(await file.arrayBuffer()));
      if (!res.rows.length) { setErr("No batches found. Is this the Batch Detail sheet downloaded as Excel (.xlsx)?"); return; }
      setPrev(res);
    } catch (x) { setErr("That file could not be read. Download the sheet as Excel (.xlsx) and try again."); console.error(x); }
  };
  const doImport = async () => {
    setBusy(true);
    const have = new Set(products.map((p) => p.name.toLowerCase()));
    const newP = prev.products.filter((p) => !have.has(p.name.toLowerCase()));
    for (let i = 0; i < newP.length; i += 300) {
      const { error } = await supabase.from("hub_products").insert(newP.slice(i, i + 300));
      if (error) { toast(error.message, "err"); setBusy(false); return; }
    }
    let added = 0;
    for (let i = 0; i < prev.rows.length; i += 200) {
      const { data, error } = await supabase.from("hub_batches").upsert(prev.rows.slice(i, i + 200), { onConflict: "legacy_ref", ignoreDuplicates: true }).select("id");
      if (error) { toast(error.message, "err"); setBusy(false); reload(); return; }
      added += data.length;
    }
    const { data: sync } = await supabase.rpc("hub_batch_sync");
    setBusy(false); setDone({ added, total: prev.rows.length, products: newP.length, sync }); setPrev(null); reload();
    toast(`${added} batches imported`);
  };
  const fine = async (r) => { const x = await run(supabase.from("hub_batches").update({ review_done: true }).eq("id", r.id), "Marked as checked"); if (x.ok) reload(); };
  const kids = prev ? prev.rows.filter((r) => r.legacy_ref.includes("#")).length : 0;

  return (
    <>
      <div className="ipanel">
        <div className="ipanel-head"><div><h3>📥 Bring in the old sheet (one time)</h3>
          <p>In Google Sheets: File → Download → Microsoft Excel (.xlsx). Choose that file here. Batches already imported are skipped, so it is safe to repeat. {imported ? `${imported} imported batches are in the Hub.` : "Nothing has been imported yet."}</p></div></div>
        <input type="file" accept=".xlsx" onChange={onFile} />
        {err && <div className="mt-dup">{err}</div>}
        {prev && (
          <div style={{ marginTop: 12 }}>
            <div><b>{prev.rows.length}</b> batches found: {prev.rows.length - kids} from the sheet rows and <b>{kids}</b> child batches read from the Remarks. <b>{prev.products.length}</b> products for the list. {prev.rows.filter((r) => r.status === "planned").length} planned in advance.</div>
            <div className="small-muted">Each child batch is created as its own batch, tied to its mother by the batch number (V-001A, V-001B). They are flagged so you can check them. Remarks about markets (Nepal, Yemen), pieces and batch size were turned into fields; the original remark text is kept. After the import, existing QC Release records are linked to their batches and recent batches missing in QC are added there as “not sampled yet”.</div>
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={doImport} disabled={busy}>{busy ? "Importing… please wait" : `Import ${prev.rows.length} batches`}</button>
          </div>)}
        {done && <div className="mt-dup" style={{ background: "#ecfdf5", color: "#166534" }}>✅ Imported {done.added} of {done.total} batches ({done.total - done.added} were already there) and {done.products} new products. QC Release: {done.sync?.linked ?? 0} records linked, {done.sync?.created ?? 0} added as not sampled yet.</div>}
      </div>
      <div className="ipanel">
        <div className="ipanel-head"><div><h3>🔍 To check <span className="section-count">{flagged.length}</span></h3><p>Child batches read from the old Remarks, and rows with an odd date. Open one, correct it and save, or press “It is fine”.</p></div></div>
        {flagged.length === 0 && <Empty>Nothing to check. 👍</Empty>}
        {flagged.slice(0, 60).map((r) => {
          const mother = r.legacy_ref && r.legacy_ref.includes("#") ? byRef[r.legacy_ref.split("#")[0]] : null;
          return (
            <div key={r.id} className="qc-row">
              <span className="qc-row-main"><b><span className="tk-firm" style={{ background: FIRM_COLORS[r.firm_id] }}>{r.firm_id}</span>{r.batch_no} · {r.product_name}</b>
                <small>{r.import_flags.join("; ")}{mother?.remarks_original ? ` · remark: ${mother.remarks_original.replace(/\s+/g, " ").slice(0, 110)}` : ""}</small></span>
              <button className="btn-ghost sm" onClick={() => onOpen(r)}>Open</button><button className="btn-ghost sm" onClick={() => fine(r)}>It is fine</button>
            </div>);
        })}
        {flagged.length > 60 && <div className="small-muted">+{flagged.length - 60} more</div>}
      </div>
    </>
  );
}
