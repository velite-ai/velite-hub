import { useState } from "react";
import { supabase } from "../../supabase";
import { useData, run, toast } from "../../lib/data";
import { Modal, Field } from "../../components/ui";
import Comments from "../../components/Comments";
import { fmtDate, fmtDateTime } from "../../lib/dates";
import { Pill } from "../ipr/shared";
import { STATUS, ruleText, uploadProof, openProof, dueBadge } from "./common";

export function LibInfo({ lib }) {
  if (!lib) return null;
  return (
    <div className="cmp-info">
      {lib.what && <p>{lib.what}</p>}
      <div className="cmp-facts">
        <div><b>When</b>{ruleText(lib.rule)}</div>
        {lib.law && <div><b>Law</b>{lib.law}</div>}
        {lib.authority && <div><b>Authority</b>{lib.authority}</div>}
        {lib.portal && <div><b>Portal</b>{lib.portal}</div>}
        {lib.form && <div><b>Form</b>{lib.form}</div>}
        {lib.penalty && <div><b>If missed</b><span className="due-over">{lib.penalty}</span></div>}
        {lib.evidence && <div><b>Proof to keep</b>{lib.evidence}</div>}
        {lib.src && <div><b>Source</b><a href={lib.src} target="_blank" rel="noreferrer">open reference ↗</a></div>}
      </div>
    </div>
  );
}

export default function ItemModal({ item, onClose }) {
  const { cmpLib, cmpFirms, profiles, isOwner, me, cmpItems } = useData();
  const lib = cmpLib.rows.find((l) => l.code === item.code);
  const firm = cmpFirms.rows.find((f) => f.id === item.firm_id);
  const people = profiles.rows.filter((p) => p.status === "approved");
  const [f, setF] = useState({
    status: item.status, filed_on: item.filed_on || "", ref_no: item.ref_no || "", proof_link: item.proof_link || "",
    proof_path: item.proof_path || null, proof_name: item.proof_name || "", notes: item.notes || "", na_reason: item.na_reason || "",
    owner_id: item.owner_id || "", checker_id: item.checker_id || "", due_date: item.due_date,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  const canVerify = isOwner || item.checker_id === me.id;

  const upload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true);
    const r = await uploadProof(file, `${item.firm_id}/${item.code}`);
    setBusy(false);
    if (r) { setF({ ...f, proof_path: r.path, proof_name: r.name }); toast("File attached — remember to Save"); }
  };

  const save = async () => {
    if ((f.status === "filed" || f.status === "verified") && !f.ref_no.trim() && !f.proof_link.trim() && !f.proof_path) {
      toast("To mark it filed, add the acknowledgement/reference number or attach proof.", "err"); return;
    }
    if (f.status === "na" && !f.na_reason.trim()) { toast("Write why it is not applicable.", "err"); return; }
    if (f.status === "verified" && !canVerify) { toast("Only the checker or an owner can verify.", "err"); return; }
    setBusy(true);
    const patch = {
      status: f.status, filed_on: f.filed_on || null, ref_no: f.ref_no.trim() || null, proof_link: f.proof_link.trim() || null,
      proof_path: f.proof_path, proof_name: f.proof_name || null, notes: f.notes.trim() || null, na_reason: f.na_reason.trim() || null,
      owner_id: f.owner_id || null, checker_id: f.checker_id || null,
    };
    if (isOwner) patch.due_date = f.due_date;
    const r = await run(supabase.from("hub_cmp_items").update(patch).eq("id", item.id), "Saved");
    setBusy(false);
    if (r.ok) { cmpItems.reload(); onClose(); }
  };

  const remove = async () => {
    if (!window.confirm("Delete this manually added item?")) return;
    const r = await run(supabase.from("hub_cmp_items").update({ deleted_at: new Date().toISOString() }).eq("id", item.id), "Deleted");
    if (r.ok) { cmpItems.reload(); onClose(); }
  };

  const statuses = ["pending", "in_progress", "filed", "verified", ...(isOwner ? ["na"] : [])];
  const db = dueBadge(item);
  return (
    <Modal wide title={`${lib?.title || item.code}`} onClose={onClose}
      actions={<>
        {item.manual && isOwner && <button className="btn-danger" onClick={remove}>Delete</button>}
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
      </>}>
      <div className="cmp-modal-top">
        <Pill tone="blue">{firm?.name || item.firm_id}</Pill>
        <Pill>{item.period_label}</Pill>
        <span className={`due ${db.cls}`}>{db.text}</span>
        <Pill>{lib?.dept}</Pill>
      </div>
      <LibInfo lib={lib} />

      <Field label="Status">
        <div className="seg">
          {statuses.map((s) => (
            <button key={s} className={f.status === s ? "on" : ""} disabled={s === "verified" && !canVerify}
              title={s === "verified" && !canVerify ? "Only the checker or an owner can verify" : ""}
              onClick={() => setF({ ...f, status: s })}>{STATUS[s].label}</button>
          ))}
        </div>
      </Field>
      {f.status === "na" && <Field label="Why not applicable? (required)"><input className="inp" value={f.na_reason} onChange={set("na_reason")} /></Field>}

      <div className="cmp-form">
        <Field label="Filed / done on"><input className="inp" type="date" value={f.filed_on} onChange={set("filed_on")} /></Field>
        <Field label="Acknowledgement / ARN / challan no."><input className="inp" value={f.ref_no} onChange={set("ref_no")} /></Field>
        <Field label="Proof link (Google Drive etc.)"><input className="inp" placeholder="https://drive.google.com/…" value={f.proof_link} onChange={set("proof_link")} /></Field>
        <Field label="Or attach a file (max 15 MB)">
          <input type="file" onChange={upload} disabled={busy} />
          {f.proof_path && <div className="form-hint"><button className="link-btn" onClick={() => openProof(f.proof_path)}>📎 {f.proof_name || "attached file"}</button></div>}
          {f.proof_link && <div className="form-hint"><a href={f.proof_link} target="_blank" rel="noreferrer">Open link ↗</a></div>}
        </Field>
        <Field label="Responsible (maker)">
          <select className="inp" value={f.owner_id} onChange={set("owner_id")}><option value="">— not set —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
        </Field>
        <Field label="Checker">
          <select className="inp" value={f.checker_id} onChange={set("checker_id")}><option value="">— not set —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
        </Field>
        {isOwner && <Field label="Due date" hint="Change only if the government extends the date."><input className="inp" type="date" value={f.due_date} onChange={set("due_date")} /></Field>}
      </div>
      {item.licence_id && (f.status === "filed" || f.status === "verified") && (
        <div className="cmp-alert">After renewal, open <b>Licences & certificates</b> and set the licence's next due date to the following cycle, so the next reminder is created.</div>
      )}
      <Field label="Notes"><textarea className="inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>

      {(item.filed_by_name || item.verified_by_name) && (
        <div className="small-muted" style={{ margin: "6px 0" }}>
          {item.filed_by_name && <>Marked filed by <b>{item.filed_by_name}</b> on {fmtDateTime(item.filed_at)}{item.filed_on ? ` (filed ${fmtDate(item.filed_on)})` : ""}. </>}
          {item.verified_by_name && <>Verified by <b>{item.verified_by_name}</b> on {fmtDateTime(item.verified_at)}.</>}
        </div>
      )}
      <div className="day-block-title" style={{ marginTop: 10 }}>Comments</div>
      <Comments type="compliance" id={item.id} />
    </Modal>
  );
}
