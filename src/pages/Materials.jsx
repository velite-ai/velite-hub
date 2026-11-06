import { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run } from "../lib/data";
import { RM_UNITS, PM_UNITS } from "../lib/constants";
import { fmtDateTime, dueLabel, daysUntil } from "../lib/dates";
import Comments, { CommentToggle } from "../components/Comments";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";

const LISTS = {
  rm: { title: "Raw Materials", icon: "🧪", color: "#1a6fa8", units: RM_UNITS },
  pm: { title: "Packing Materials", icon: "📦", color: "#6c3483", units: PM_UNITS },
};
const STAGES = [
  { k: "pending", label: "Pending" },
  { k: "ordered", label: "Ordered" },
  { k: "received", label: "Received" },
];

function sortPending(a, b) {
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  const da = a.required_by || "9999", db = b.required_by || "9999";
  if (da !== db) return da < db ? -1 : 1;
  return a.created_at < b.created_at ? 1 : -1;
}

export default function Materials() {
  const { materials } = useData();
  const [list, setList] = useState(() => localStorage.getItem("hub-mat-list") || "rm");
  const [stage, setStage] = useState("pending");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [ordering, setOrdering] = useState(null);
  const [ask, dialog] = useConfirm();
  const cfg = LISTS[list];

  const live = materials.rows.filter((m) => !m.deleted_at && m.list_type === list);
  const counts = Object.fromEntries(STAGES.map((s) => [s.k, live.filter((m) => m.status === s.k).length]));
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = live.filter((m) => m.status === stage);
    if (s) r = r.filter((m) => [m.name, m.supplier, m.po_number, m.notes, m.created_by_name].join(" ").toLowerCase().includes(s));
    if (stage === "pending") r.sort(sortPending);
    else if (stage === "ordered") r.sort((a, b) => ((a.ordered_at || "") < (b.ordered_at || "") ? 1 : -1));
    else r.sort((a, b) => ((a.received_at || "") < (b.received_at || "") ? 1 : -1));
    return stage === "received" && !s ? r.slice(0, 200) : r;
  }, [live, stage, q]);

  const pickList = (k) => { setList(k); localStorage.setItem("hub-mat-list", k); };

  const setStatus = async (m, status, extra = {}) => {
    const r = await run(supabase.from("hub_materials").update({ status, ...extra }).eq("id", m.id),
      status === "pending" ? "Moved back to Pending" : status === "ordered" ? "Marked as ordered" : "Marked as received");
    if (r.ok) materials.reload();
  };

  const del = async (m) => {
    const ok = await ask({ title: "Delete this item?", body: `"${m.name}" will go to the recycle bin. An owner can restore it within 30 days.`, okText: "Delete", danger: true });
    if (!ok) return;
    const r = await run(supabase.from("hub_materials").update({ deleted_at: new Date().toISOString() }).eq("id", m.id), "Moved to recycle bin");
    if (r.ok) materials.reload();
  };

  return (
    <div className="section">
      <div className="section-head">
        <div className="seg">
          {Object.entries(LISTS).map(([k, v]) => (
            <button key={k} className={list === k ? "on" : ""} onClick={() => pickList(k)}>{v.icon} {v.title}</button>
          ))}
        </div>
      </div>

      <AddRow list={list} cfg={cfg} onAdded={materials.reload} />

      <div className="filter-bar">
        {STAGES.map((s) => (
          <button key={s.k} className={`filter-btn ${stage === s.k ? "active" : ""}`} onClick={() => setStage(s.k)}>
            {s.label} <span className="fcount">{counts[s.k]}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <SearchBox value={q} onChange={setQ} placeholder="Search name, supplier, PO…" />
      </div>

      <div className="todo-list">
        {shown.length === 0 && <Empty>{stage === "pending" ? "Nothing pending ✅" : "Nothing here."}</Empty>}
        {shown.map((m) => (
          <MaterialRow key={m.id} m={m} cfg={cfg}
            onOrder={() => setOrdering(m)}
            onReceive={() => setStatus(m, "received")}
            onBack={() => setStatus(m, m.status === "received" ? "ordered" : "pending")}
            onEdit={() => setEditing(m)} onDelete={() => del(m)} />
        ))}
        {stage === "received" && !q && live.filter((m) => m.status === "received").length > 200 && (
          <div className="form-hint" style={{ padding: 12 }}>Showing latest 200. Use search to find older items.</div>
        )}
      </div>

      {editing && <EditMaterial m={editing} cfg={cfg} onClose={() => setEditing(null)} onSaved={materials.reload} />}
      {ordering && <OrderModal m={ordering} onClose={() => setOrdering(null)}
        onSave={async (extra) => { await setStatus(ordering, "ordered", extra); setOrdering(null); }} />}
      {dialog}
    </div>
  );
}

function AddRow({ list, cfg, onAdded }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState(cfg.units[0]);
  const [reqBy, setReqBy] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await run(supabase.from("hub_materials").insert({
      list_type: list, name: name.trim(), qty, unit: cfg.units.includes(unit) ? unit : cfg.units[0],
      required_by: reqBy || null, urgent,
    }), "Added");
    setBusy(false);
    if (r.ok) { setName(""); setQty(""); setReqBy(""); setUrgent(false); onAdded(); }
  };
  return (
    <div className="add-row">
      <input className="inp" placeholder={`Add ${cfg.title.toLowerCase().replace(/s$/, "")}…`} value={name}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <input className="inp inp-sm" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
      <select className="inp inp-xs" value={unit} onChange={(e) => setUnit(e.target.value)}>
        {cfg.units.map((u) => <option key={u}>{u}</option>)}
      </select>
      <input className="inp inp-date" type="date" title="Required by" value={reqBy} onChange={(e) => setReqBy(e.target.value)} />
      <label className="chk"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
      <button className="add-btn" style={{ background: cfg.color }} onClick={add} disabled={busy}>+ Add</button>
    </div>
  );
}

function MaterialRow({ m, onOrder, onReceive, onBack, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const due = m.status !== "received" && m.required_by ? dueLabel(m.required_by) : null;
  return (
    <div className={`todo-item ${m.status === "received" ? "is-done" : ""}`}>
      <div className="todo-item-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="todo-text">
            {m.urgent && m.status !== "received" && <span className="urgent">URGENT</span>}
            {m.name}
            {m.qty && <span className="qty">— {m.qty} {m.unit}</span>}
          </div>
          <div className="meta-row">
            {due && <span className={due.cls}>📅 {due.text}</span>}
            {m.supplier && <span>🏭 <strong>{m.supplier}</strong></span>}
            {m.po_number && <span>🧾 PO <strong>{m.po_number}</strong></span>}
            <span>➕ <strong>{m.created_by_name || "—"}</strong> · {fmtDateTime(m.created_at)}</span>
            {m.ordered_at && <span>🛒 Ordered by <strong>{m.ordered_by_name || "—"}</strong> · {fmtDateTime(m.ordered_at)}</span>}
            {m.received_at && <span>✅ Received by <strong>{m.received_by_name || "—"}</strong> · {fmtDateTime(m.received_at)}</span>}
          </div>
          {m.notes && <div className="notes">{m.notes}</div>}
        </div>
        <div className="todo-actions">
          {m.status === "pending" && <button className="step-btn" onClick={onOrder}>Mark ordered →</button>}
          {m.status === "ordered" && <button className="step-btn" onClick={onReceive}>Mark received →</button>}
          {m.status !== "pending" && <button className="restore-btn" onClick={onBack} title="Move back one step">↩</button>}
          <CommentToggle type="material" id={m.id} open={open} onToggle={() => setOpen((o) => !o)} />
          <button className="icon-btn edit" title="Edit" onClick={onEdit}>✎</button>
          <button className="icon-btn" title="Delete" onClick={onDelete}>🗑</button>
        </div>
      </div>
      {open && <Comments type="material" id={m.id} />}
    </div>
  );
}

function OrderModal({ m, onClose, onSave }) {
  const [supplier, setSupplier] = useState(m.supplier || "");
  const [po, setPo] = useState(m.po_number || "");
  return (
    <Modal title={`Mark "${m.name}" as ordered`} onClose={onClose}
      actions={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave({ supplier: supplier.trim(), po_number: po.trim() })}>Mark ordered</button>
      </>}>
      <Field label="Supplier (optional)"><input className="form-inp" value={supplier} onChange={(e) => setSupplier(e.target.value)} autoFocus /></Field>
      <Field label="PO number (optional)" hint="e.g. VHR-1234 or VPR-567"><input className="form-inp" value={po} onChange={(e) => setPo(e.target.value)} /></Field>
    </Modal>
  );
}

function EditMaterial({ m, cfg, onClose, onSaved }) {
  const [f, setF] = useState({
    name: m.name, qty: m.qty || "", unit: m.unit || cfg.units[0], required_by: m.required_by || "",
    urgent: m.urgent, supplier: m.supplier || "", po_number: m.po_number || "", notes: m.notes || "",
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const save = async () => {
    if (!f.name.trim()) return;
    const r = await run(supabase.from("hub_materials").update({ ...f, name: f.name.trim(), required_by: f.required_by || null }).eq("id", m.id), "Saved");
    if (r.ok) { onSaved(); onClose(); }
  };
  const units = cfg.units.includes(f.unit) ? cfg.units : [f.unit, ...cfg.units];
  return (
    <Modal title="Edit item" onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <Field label="Item name"><input className="form-inp" value={f.name} onChange={set("name")} /></Field>
      <div className="form-grid">
        <Field label="Quantity"><input className="form-inp" value={f.qty} onChange={set("qty")} /></Field>
        <Field label="Unit"><select className="form-inp" value={f.unit} onChange={set("unit")}>{units.map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label="Required by"><input className="form-inp" type="date" value={f.required_by} onChange={set("required_by")} /></Field>
      </div>
      <label className="chk" style={{ marginBottom: 12 }}><input type="checkbox" checked={f.urgent} onChange={set("urgent")} /> Urgent</label>
      <div className="form-grid">
        <Field label="Supplier"><input className="form-inp" value={f.supplier} onChange={set("supplier")} /></Field>
        <Field label="PO number"><input className="form-inp" value={f.po_number} onChange={set("po_number")} /></Field>
      </div>
      <Field label="Notes"><textarea className="form-inp" value={f.notes} onChange={set("notes")} /></Field>
    </Modal>
  );
}

export function materialsSummary(rows) {
  const live = rows.filter((m) => !m.deleted_at && m.status !== "received");
  return {
    rmPending: live.filter((m) => m.list_type === "rm" && m.status === "pending").length,
    pmPending: live.filter((m) => m.list_type === "pm" && m.status === "pending").length,
    ordered: live.filter((m) => m.status === "ordered").length,
    hot: live.filter((m) => m.urgent || (m.required_by && daysUntil(m.required_by) <= 3)).sort(sortPending),
  };
}
