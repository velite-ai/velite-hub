import { useState } from "react";
import { supabase } from "../../supabase";
import { useData, run, toast } from "../../lib/data";
import { fmtDate } from "../../lib/dates";
import { uploadProof, openProof } from "./common";

export const DOC_KINDS = ["Original licence / certificate", "Retention certificate", "Renewal", "Fee challan / receipt", "Amendment / endorsement", "Approved product list", "Inspection report / reply", "Other"];

export const docsOf = (rows, type, id) => rows
  .filter((x) => !x.deleted_at && x.parent_type === type && x.parent_id === id)
  .sort((a, b) => (key(a) < key(b) ? -1 : 1));
// oldest first by the paper's own dates; undated papers go to the end
const key = (x) => x.valid_from || x.issued_on || x.valid_till || "9999" + (x.created_at || "");

// A dated list of papers ("chain") for one licence or one checklist point. Any number of files.
export default function DocChain({ firmId, type, id, folder, title = "Papers on file" }) {
  const d = useData();
  const docs = docsOf(d.cmpDocs.rows, type, id);
  const blank = { kind: type === "licence" ? (docs.length ? "Retention certificate" : "Original licence / certificate") : "Other", doc_no: "", issued_on: "", valid_from: "", valid_till: "", link: "", notes: "", file_path: null, file_name: "" };
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const upload = async (e) => {
    const files = [...(e.target.files || [])]; if (!files.length) return;
    setBusy(true); const r = await uploadProof(files[0], folder); setBusy(false);
    if (r) setF({ ...f, file_path: r.path, file_name: r.name });
  };
  const add = async () => {
    if (!f.file_path && !f.link.trim()) { toast("Attach the file or paste a link.", "err"); return; }
    setBusy(true);
    const row = { firm_id: firmId, parent_type: type, parent_id: id, kind: f.kind, doc_no: f.doc_no.trim() || null, issued_on: f.issued_on || null,
      valid_from: f.valid_from || null, valid_till: f.valid_till || null, link: f.link.trim() || null, notes: f.notes.trim() || null, file_path: f.file_path, file_name: f.file_name || null };
    const r = await run(supabase.from("hub_cmp_docs").insert(row), "Paper added");
    setBusy(false);
    if (r.ok) { d.cmpDocs.reload(); setF(null); }
  };
  const remove = async (x) => {
    if (!window.confirm(`Remove “${x.kind}${x.doc_no ? " · " + x.doc_no : ""}” from this file?`)) return;
    const r = await run(supabase.from("hub_cmp_docs").update({ deleted_at: new Date().toISOString() }).eq("id", x.id), "Removed");
    if (r.ok) d.cmpDocs.reload();
  };
  const period = (x) => x.valid_from || x.valid_till ? `${x.valid_from ? fmtDate(x.valid_from) : "…"} → ${x.valid_till ? fmtDate(x.valid_till) : "…"}` : "";

  return (
    <div className="doc-chain">
      <div className="doc-chain-head"><b>📂 {title}</b> <span className="small-muted">{docs.length ? `${docs.length} paper${docs.length === 1 ? "" : "s"}, oldest first` : "none yet"}</span></div>
      {docs.length > 0 && <ol className="doc-list">{docs.map((x) => (
        <li key={x.id}>
          <div className="doc-main">
            <b>{x.kind}</b>{x.doc_no && <> · {x.doc_no}</>}
            <div className="small-muted">{[x.issued_on && `Issued ${fmtDate(x.issued_on)}`, period(x) && `Valid ${period(x)}`, x.notes].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="doc-acts">
            {x.file_path && <button className="link-btn" onClick={() => openProof(x.file_path)}>📎 Open</button>}
            {x.link && <a href={x.link} target="_blank" rel="noreferrer">Link ↗</a>}
            {(d.isOwner || x.created_by === d.me.id) && <button className="link-btn doc-del" title="Remove" onClick={() => remove(x)}>✕</button>}
          </div>
        </li>))}</ol>}
      {!f ? <button className="btn-ghost doc-add" onClick={() => setF(blank)}>＋ Add a paper (old or new)</button> : (
        <div className="doc-form">
          <div className="cmp-form">
            <label className="form-row"><span className="form-label">What is it?</span><select className="inp" value={f.kind} onChange={set("kind")}>{DOC_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="form-row"><span className="form-label">Number / letter no.</span><input className="inp" value={f.doc_no} onChange={set("doc_no")} /></label>
            <label className="form-row"><span className="form-label">Issued on</span><input className="inp" type="date" value={f.issued_on} onChange={set("issued_on")} /></label>
            <label className="form-row"><span className="form-label">Valid from</span><input className="inp" type="date" value={f.valid_from} onChange={set("valid_from")} /></label>
            <label className="form-row"><span className="form-label">Valid till</span><input className="inp" type="date" value={f.valid_till} onChange={set("valid_till")} /></label>
            <label className="form-row"><span className="form-label">File (max 15 MB)</span><input type="file" onChange={upload} disabled={busy} />{f.file_name && <span className="form-hint">📎 {f.file_name}</span>}</label>
            <label className="form-row"><span className="form-label">Or link (Drive)</span><input className="inp" value={f.link} onChange={set("link")} placeholder="https://…" /></label>
            <label className="form-row"><span className="form-label">Note</span><input className="inp" value={f.notes} onChange={set("notes")} /></label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn-ghost" onClick={() => setF(null)}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={add}>{busy ? "Please wait…" : "Add to file"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
