import { useState } from "react";
import { supabase } from "../../supabase";
import { useData, run, toast } from "../../lib/data";
import { Modal, Field, Empty } from "../../components/ui";
import { fmtDate, dueLabel } from "../../lib/dates";
import { Pill } from "../ipr/shared";
import { applicability, uploadProof, openProof, FirmBadge } from "./common";
import DocChain, { docsOf } from "./DocChain";

export default function Licences() {
  const d = useData();
  const [edit, setEdit] = useState(null);
  const [firm, setFirm] = useState("all");
  const rows = d.cmpLic.rows.filter((l) => !l.deleted_at && (firm === "all" || l.firm_id === firm))
    .sort((a, b) => (a.next_due || "9999") < (b.next_due || "9999") ? -1 : 1);
  const libT = (c) => d.cmpLib.rows.find((l) => l.code === c)?.title || "";
  return (
    <div className="ipanel">
      <div className="ipanel-head">
        <div><h3>Licences & certificates</h3><p>The <b>one place</b> for every licence and all its papers. Enter it once with its <b>next due date</b> (renewal or retention-fee date); the tracker reminds you before it, and the matching checklist point shows the same papers.</p></div>
        <button className="btn-primary" onClick={() => setEdit({})}>+ Add licence</button>
      </div>
      <div className="filter-bar" style={{ marginBottom: 10 }}>
        <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}>
          <option value="all">All firms</option>{d.cmpFirms.rows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      </div>
      {rows.length === 0 ? <Empty>No licences entered yet. Start with Form 25 (VP), COS-8 (VH), 20B/21B (VI), factory licence, PPCB consents and fire certificate.</Empty> : (
        <div className="table-wrap"><table className="tbl">
          <thead><tr><th>Firm</th><th>Licence / certificate</th><th>Number</th><th>Valid till</th><th>Next due</th><th>Papers</th></tr></thead>
          <tbody>{rows.map((l) => { const b = l.next_due ? dueLabel(l.next_due) : null; return (
            <tr key={l.id} className="click-row" onClick={() => setEdit(l)}>
              <td><FirmBadge id={l.firm_id} /></td>
              <td>{l.title}<div className="small-muted">{libT(l.code)}</div></td>
              <td>{l.number || "—"}<div className="small-muted">{l.authority}</div></td>
              <td>{l.valid_till ? fmtDate(l.valid_till) : "Perpetual"}</td>
              <td>{b ? <span className={`due ${b.cls}`}>{b.text}</span> : <Pill tone="red">Not set</Pill>}</td>
              <td>{(() => { const n = docsOf(d.cmpDocs.rows, "licence", l.id).length; return n ? <span className="doc-count">📂 {n}</span> : <span className="small-muted">none</span>; })()}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
      {edit && <LicenceModal key={edit.id || "new"} lic={edit} onClose={() => setEdit(null)} onReopen={setEdit} />}
    </div>
  );
}

function LicenceModal({ lic, onClose, onReopen }) {
  const d = useData();
  const isNew = !lic.id;
  const [f, setF] = useState({
    firm_id: lic.firm_id || d.cmpFirms.rows[0]?.id || "", code: lic.code || "", title: lic.title || "", number: lic.number || "",
    authority: lic.authority || "", issued_on: lic.issued_on || "", valid_till: lic.valid_till || "", next_due: lic.next_due || "",
    proof_link: lic.proof_link || "", proof_path: lic.proof_path || null, proof_name: lic.proof_name || "", notes: lic.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const firm = d.cmpFirms.rows.find((x) => x.id === f.firm_id);
  const options = d.cmpLib.rows.filter((l) => l.rule?.t === "licence");
  const sorted = firm ? [...options].sort((a, b) => Number(applicability(firm, b, d.cmpAssign.rows).applies) - Number(applicability(firm, a, d.cmpAssign.rows).applies)) : options;

  const pick = (e) => {
    const code = e.target.value; const l = d.cmpLib.rows.find((x) => x.code === code);
    setF({ ...f, code, title: f.title || (l ? l.title.replace(/ — .*$/, "").replace(/ \(.*\)$/, "") : ""), authority: f.authority || l?.authority || "" });
  };
  const upload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); const r = await uploadProof(file, `${f.firm_id}/licences`); setBusy(false);
    if (r) setF({ ...f, proof_path: r.path, proof_name: r.name });
  };
  const save = async () => {
    if (!f.firm_id || !f.title.trim()) { toast("Choose the firm and give the licence a name.", "err"); return; }
    if (f.code && !f.next_due) { toast("Enter the next due date (renewal / retention fee) so it can be reminded.", "err"); return; }
    setBusy(true);
    const row = { ...f, code: f.code || null, title: f.title.trim(), issued_on: f.issued_on || null, valid_till: f.valid_till || null,
      next_due: f.next_due || null, proof_link: f.proof_link || null, proof_name: f.proof_name || null, number: f.number || null, authority: f.authority || null, notes: f.notes || null };
    const q = isNew ? supabase.from("hub_cmp_licences").insert(row).select() : supabase.from("hub_cmp_licences").update(row).eq("id", lic.id);
    const r = await run(q, "Saved");
    setBusy(false);
    if (r.ok) {
      d.cmpLic.reload(); d.cmpItems.reload();
      if (isNew && r.data?.[0]) { toast("Saved — now add its papers"); onReopen?.(r.data[0]); } else onClose();
    }
  };
  const del = async () => {
    if (!window.confirm("Remove this licence from the register?")) return;
    const r = await run(supabase.from("hub_cmp_licences").update({ deleted_at: new Date().toISOString() }).eq("id", lic.id), "Removed");
    if (r.ok) { d.cmpLic.reload(); d.cmpItems.reload(); onClose(); }
  };
  return (
    <Modal wide title={isNew ? "Add licence / certificate" : "Edit licence / certificate"} onClose={onClose}
      actions={<>{!isNew && d.isOwner && <button className="btn-danger" onClick={del}>Remove</button>}
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="cmp-form">
        <Field label="Firm"><select className="inp" value={f.firm_id} onChange={set("firm_id")}>{d.cmpFirms.rows.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Which compliance does it renew?" hint="Links the licence to its renewal reminder.">
          <select className="inp" value={f.code} onChange={pick}><option value="">— other / not linked —</option>
            {sorted.map((l) => <option key={l.code} value={l.code}>{firm && !applicability(firm, l, d.cmpAssign.rows).applies ? "(not usual) " : ""}{l.title}</option>)}</select></Field>
        <Field label="Name"><input className="inp" value={f.title} onChange={set("title")} placeholder="e.g. Form 25 Drug Manufacturing Licence" /></Field>
        <Field label="Licence / certificate number"><input className="inp" value={f.number} onChange={set("number")} /></Field>
        <Field label="Issued by"><input className="inp" value={f.authority} onChange={set("authority")} /></Field>
        <Field label="Issued on"><input className="inp" type="date" value={f.issued_on} onChange={set("issued_on")} /></Field>
        <Field label="Valid till" hint="Leave empty if perpetual (e.g. Form 25, COS-8, 20B/21B)."><input className="inp" type="date" value={f.valid_till} onChange={set("valid_till")} /></Field>
        <Field label="Next due date" hint="Renewal or retention-fee date. For 5-yearly retention: 5th anniversary of issue."><input className="inp" type="date" value={f.next_due} onChange={set("next_due")} /></Field>
      </div>
      <Field label="Notes"><textarea className="inp" rows={2} value={f.notes} onChange={set("notes")} /></Field>
      {isNew ? <div className="cmp-alert">Save first. Then open the licence again to add <b>all its papers</b> — the original licence, every retention certificate and fee receipt, oldest to newest.</div>
        : <DocChain firmId={lic.firm_id} type="licence" id={lic.id} folder={`${lic.firm_id}/licences/${lic.id}`} title="Full chain of papers (original + every retention / renewal)" />}
      <div className="small-muted" style={{ marginTop: 8 }}>After renewing, update <b>Next due date</b> to the following cycle — the reminder moves automatically. A Form 25 / 28 / COS-8 / 20B / 21B licence is perpetual while retention is paid, so leave <b>Valid till</b> empty and put each period on its retention certificate.</div>
    </Modal>
  );
}
