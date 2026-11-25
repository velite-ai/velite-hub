import { useState } from "react";
import { supabase } from "../supabase";
import { run, toast } from "../lib/data";
import { Modal, Field, Empty, useConfirm } from "../components/ui";
import { ATTACH, FACTS, attachKind } from "../lib/exportAudit";
import { fmtD } from "../lib/qc";

const ICON = { error: "⛔", warn: "⚠️", info: "ℹ️" };

// Findings of the audit, grouped by area, with what passed folded away
export function AuditPanel({ audit }) {
  const [showOk, setShowOk] = useState(false);
  const areas = [...new Set(audit.items.map((i) => i.area))];
  return (
    <div className="ipanel"><div className="ipanel-head"><div><h3>Audit {audit.errors ? <span style={{ color: "#b91c1c" }}>· {audit.errors} to fix</span> : <span style={{ color: "#16a34a" }}>· no errors</span>}{audit.warnings > 0 && <span style={{ color: "#b45309" }}> · {audit.warnings} to check</span>}</h3>
      <p>The shipment, the papers made from it and the documents attached below are compared with each other and with your masters and rules.</p></div></div>
      {audit.items.length === 0 ? <Empty>Nothing found. 👍</Empty> : areas.map((a) => (
        <div key={a} style={{ marginBottom: 8 }}><div className="form-label">{a}</div>
          {audit.items.filter((i) => i.area === a).sort((x, y) => ["error", "warn", "info"].indexOf(x.level) - ["error", "warn", "info"].indexOf(y.level)).map((i, j) => <div key={j} className={`ex-check ${i.level}`}>{ICON[i.level]} {i.text}</div>)}</div>))}
      {audit.passed.length > 0 && (<><button className="rg-sub-head" onClick={() => setShowOk((x) => !x)}>{showOk ? "▾" : "▸"} {audit.passed.length} checks passed</button>
        {showOk && audit.passed.map((p, i) => <div key={i} className="ex-check" style={{ background: "#f0fdf4", color: "#166534" }}>✅ {p}</div>)}</>)}
    </div>
  );
}

// store a file in the private bucket and record it with the shipment (used for the buyer's order and by the form below)
export async function saveAttachment(shipmentId, kind, file, { ref_no = null, doc_date = null, notes = null } = {}) {
  const path = `${shipmentId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const up = await supabase.storage.from("export").upload(path, file, { contentType: file.type || undefined });
  if (up.error) { toast(up.error.message, "err"); return false; }
  const r = await run(supabase.from("exp_attachments").insert({ shipment_id: shipmentId, kind, title: attachKind(kind).label, ref_no, doc_date, notes, facts: {}, file_path: path, file_name: file.name }));
  if (!r.ok) { await supabase.storage.from("export").remove([path]); return false; }
  return true;
}

export async function openFile(path) {
  const { data, error } = await supabase.storage.from("export").createSignedUrl(path, 300);
  if (error) { toast(error.message, "err"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

// Outside documents kept with the shipment (shipping bill, e-way bill, COA …) with the facts typed from them
export function Records({ ship, rows, reload }) {
  const [edit, setEdit] = useState(null);
  return (
    <div className="ipanel"><div className="ipanel-head"><div><h3>Outside documents</h3><p>Shipping bill, e-way bill, truck receipt, COA, MSDS, buyer's PO and so on. Attach the file and type the key facts from it; the audit compares them with the shipment.</p></div>
      <button className="btn-primary sm" onClick={() => setEdit({})}>＋ Add a document</button></div>
      {rows.length === 0 ? <Empty>Nothing attached yet.</Empty> : rows.slice().sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")).map((r) => (
        <div key={r.id} className="qc-row" onClick={() => setEdit(r)} style={{ cursor: "pointer" }}>
          <span className="qc-row-main"><b>{attachKind(r.kind).label}{r.ref_no ? ` · ${r.ref_no}` : ""}</b><small>{[r.doc_date && fmtD(r.doc_date), r.file_name, r.notes].filter(Boolean).join(" · ") || "facts only"}</small></span>
          {r.file_path && <button className="btn-ghost sm" onClick={(e) => { e.stopPropagation(); openFile(r.file_path); }}>Open file</button>}
        </div>))}
      {edit && <RecordForm ship={ship} row={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}

function RecordForm({ ship, row, onClose, onSaved }) {
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState(() => ({ kind: row?.kind || "shipping_bill", ref_no: row?.ref_no || "", doc_date: row?.doc_date || "", notes: row?.notes || "" }));
  const [facts, setFacts] = useState(() => ({ ...(row?.facts || {}) }));
  const [file, setFile] = useState(null); const [busy, setBusy] = useState(false);
  const def = attachKind(f.kind); const typed = def.facts.filter((k) => k !== "ref_no" && k !== "doc_date");
  const save = async () => {
    setBusy(true);
    let file_path = row?.file_path || null, file_name = row?.file_name || null;
    if (file) {
      const path = `${ship.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const up = await supabase.storage.from("export").upload(path, file, { contentType: file.type || undefined });
      if (up.error) { setBusy(false); toast(up.error.message, "err"); return; }
      if (row?.file_path) await supabase.storage.from("export").remove([row.file_path]);
      file_path = path; file_name = file.name;
    }
    const clean = Object.fromEntries(Object.entries(facts).filter(([k, v]) => typed.includes(k) && String(v).trim() !== ""));
    ["value_inr", "packages"].forEach((k) => { if (clean[k] !== undefined) clean[k] = Number(String(clean[k]).replace(/,/g, "")); });
    ["mfg", "exp"].forEach((k) => { if (clean[k] && /^\d{4}-\d{2}$/.test(clean[k])) clean[k] = `${clean[k]}-01`; });
    const body = { shipment_id: ship.id, kind: f.kind, title: def.label, ref_no: f.ref_no.trim() || null, doc_date: f.doc_date || null, notes: f.notes.trim() || null, facts: clean, file_path, file_name };
    const r = row ? await run(supabase.from("exp_attachments").update(body).eq("id", row.id), "Saved") : await run(supabase.from("exp_attachments").insert(body), "Document added");
    setBusy(false); if (r.ok) { onSaved(); onClose(); }
  };
  const del = async () => {
    if (!(await ask({ title: "Remove this document?", body: "The file and the facts are deleted.", okText: "Remove", danger: true }))) return;
    if (row.file_path) await supabase.storage.from("export").remove([row.file_path]);
    const r = await run(supabase.from("exp_attachments").delete().eq("id", row.id), "Removed"); if (r.ok) { onSaved(); onClose(); }
  };
  const input = (k) => (k === "products"
    ? <textarea className="form-inp" rows={5} value={facts[k] ?? ""} onChange={(e) => setFacts((x) => ({ ...x, [k]: e.target.value }))} placeholder="Copy the product names from the certificate" />
    : k === "valid_until"
    ? <input className="form-inp" type="date" value={facts[k] ?? ""} onChange={(e) => setFacts((x) => ({ ...x, [k]: e.target.value }))} />
    : k === "mfg" || k === "exp"
    ? <input className="form-inp" type="month" value={String(facts[k] || "").slice(0, 7)} onChange={(e) => setFacts((x) => ({ ...x, [k]: e.target.value }))} />
    : <input className="form-inp" value={facts[k] ?? ""} onChange={(e) => setFacts((x) => ({ ...x, [k]: e.target.value }))} inputMode={k === "value_inr" || k === "packages" ? "decimal" : undefined} />);
  return (
    <Modal wide title={row ? attachKind(row.kind).label : "Add an outside document"} onClose={onClose}
      actions={<>{row && <button className="btn-danger" onClick={del} style={{ marginRight: "auto" }}>Remove</button>}<button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="ex-grid">
        <Field label="Type of document"><select className="form-inp" value={f.kind} onChange={(e) => { setF((x) => ({ ...x, kind: e.target.value })); setFacts({}); }}>{ATTACH.map((a) => <option key={a.k} value={a.k}>{a.label}</option>)}</select></Field>
        <Field label="File (PDF or photo)" hint={row?.file_name ? `Now: ${row.file_name}. Choose a file to replace it.` : "Optional; the facts alone are enough for the audit."}><input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        {def.facts.includes("ref_no") && <Field label={FACTS.ref_no}><input className="form-inp" value={f.ref_no} onChange={(e) => setF((x) => ({ ...x, ref_no: e.target.value }))} /></Field>}
        {def.facts.includes("doc_date") && <Field label={FACTS.doc_date}><input className="form-inp" type="date" value={f.doc_date} onChange={(e) => setF((x) => ({ ...x, doc_date: e.target.value }))} /></Field>}
        {typed.map((k) => <Field key={k} label={FACTS[k]}>{input(k)}</Field>)}
      </div>
      <Field label="Notes"><input className="form-inp" value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} /></Field>
      {typed.length > 0 && <div className="small-muted">Type what is printed on the document. The audit compares it with this shipment ({ship.invoice_no || "invoice not numbered"}).</div>}
      {dialog}
    </Modal>
  );
}

// Asked when a proforma is about to be made and no copy of the buyer's order is saved
export function OrderPrompt({ ship, onSaved, onSkip, onClose }) {
  const [file, setFile] = useState(null); const [busy, setBusy] = useState(false);
  const save = async () => { if (!file) { toast("Choose the order file first", "err"); return; } setBusy(true); const ok = await saveAttachment(ship.id, "po", file, { ref_no: ship.po_no, doc_date: ship.po_date }); setBusy(false); if (ok) { toast("Order saved with this shipment"); onSaved(); } };
  return (
    <Modal title="Attach the buyer's order" onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onSkip} style={{ marginRight: "auto" }}>No written order, make the proforma anyway</button><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy || !file}>{busy ? "Saving…" : "Save the order and continue"}</button></>}>
      <p className="modal-text">A proforma invoice is made against the buyer's order. Attach the order (usually a PDF) so a copy is kept with this shipment.</p>
      <input type="file" accept=".pdf,image/*,.xlsx,.xls,.csv,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
    </Modal>
  );
}
