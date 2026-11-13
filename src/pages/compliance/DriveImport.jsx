import { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { useData, toast } from "../../lib/data";
import { Modal } from "../../components/ui";
import { getClientId, saveClientId, driveToken, fetchDriveFile, isDriveLink, folderFor } from "../../lib/drive";
import { uploadProof, FirmBadge } from "./common";

// Copy one paper's Drive file into the Hub and record where it is stored
export async function copyDocFromDrive(doc, tok) {
  const file = await fetchDriveFile(doc.link, tok);
  const up = await uploadProof(file, folderFor(doc));
  if (!up) throw new Error("Upload to Hub failed");
  const { error } = await supabase.from("hub_cmp_docs").update({ file_path: up.path, file_name: doc.file_name || up.name }).eq("id", doc.id);
  if (error) throw new Error(error.message);
}

async function copyLicenceProof(lic, tok) {
  const file = await fetchDriveFile(lic.proof_link, tok);
  const up = await uploadProof(file, `${lic.firm_id}/licences/${lic.id}`);
  if (!up) throw new Error("Upload to Hub failed");
  const { error } = await supabase.from("hub_cmp_licences").update({ proof_path: up.path, proof_name: lic.proof_name || up.name }).eq("id", lic.id);
  if (error) throw new Error(error.message);
}

export const pendingDocs = (rows) => rows.filter((x) => !x.deleted_at && !x.file_path && isDriveLink(x.link));
const pendingLics = (rows) => rows.filter((x) => !x.deleted_at && !x.proof_path && isDriveLink(x.proof_link));

// Owner-only button + window on the Licences page
export default function DriveImport() {
  const d = useData();
  const [open, setOpen] = useState(false);
  if (!d.isOwner) return null;
  const n = pendingDocs(d.cmpDocs.rows).length + pendingLics(d.cmpLic.rows).length;
  return (<>
    <button className="btn-ghost" onClick={() => setOpen(true)}>⬇ Copy Drive files into Hub{n ? ` (${n})` : ""}</button>
    {open && <ImportModal onClose={() => setOpen(false)} />}
  </>);
}

function ImportModal({ onClose }) {
  const d = useData();
  const [cid, setCid] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState([]);
  useEffect(() => { getClientId().then(setCid); }, []);

  const docs = pendingDocs(d.cmpDocs.rows);
  const lics = pendingLics(d.cmpLic.rows);
  const total = docs.length + lics.length;

  const save = async () => {
    if (!/\.apps\.googleusercontent\.com$/.test(draft.trim())) { toast("That doesn't look like a Google Client ID (it ends with .apps.googleusercontent.com)", "err"); return; }
    if (await saveClientId(draft)) { setCid(draft.trim()); toast("Saved"); } else toast("Could not save", "err");
  };

  const runAll = async () => {
    setBusy(true); setDone(0); setErrors([]);
    let tok;
    try { tok = await driveToken(cid); } catch (e) { toast(e.message, "err"); setBusy(false); return; }
    const errs = []; let n = 0;
    for (const x of docs) {
      try { await copyDocFromDrive(x, tok); } catch (e) { errs.push(`${x.file_name || x.link}: ${e.message}`); }
      setDone(++n);
    }
    for (const l of lics) {
      try { await copyLicenceProof(l, tok); } catch (e) { errs.push(`${l.title}: ${e.message}`); }
      setDone(++n);
    }
    setErrors(errs); setBusy(false);
    d.cmpDocs.reload(); d.cmpLic.reload();
    toast(errs.length ? `${n - errs.length} copied, ${errs.length} failed` : `All ${n} files copied into the Hub`, errs.length ? "err" : undefined);
  };

  if (cid === null) return <Modal title="Copy Drive files into Hub" onClose={onClose}><p>Loading…</p></Modal>;

  if (!cid) return (
    <Modal title="One-time setup: connect Google Drive" onClose={onClose}>
      <p>The Hub needs a Google “Client ID” once, so it can ask your permission to read Drive files. Do this on a computer, signed in to Google as <b>velite@velite.in</b>:</p>
      <ol className="small-steps">
        <li>Open <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Drive API</a>. If asked, create a project named <b>Velite Hub</b>. Click <b>Enable</b>.</li>
        <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform</a> → <b>Get started</b>. App name: <b>Velite Hub</b>; support email: yours; Audience: <b>Internal</b>. Finish.</li>
        <li>Go to <b>Clients</b> → <b>Create client</b>. Type: <b>Web application</b>. Name: <b>Velite Hub</b>.</li>
        <li>Under <b>Authorised JavaScript origins</b> add <code>https://hub.velite.in</code>. Click <b>Create</b>.</li>
        <li>Copy the <b>Client ID</b> (ends with <code>.apps.googleusercontent.com</code>) and paste it below.</li>
      </ol>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input className="inp" style={{ flex: 1 }} placeholder="xxxxxxxx.apps.googleusercontent.com" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn-primary" onClick={save}>Save</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Copy Drive files into Hub" onClose={busy ? () => {} : onClose}>
      {total === 0 && !done ? <p>Every Drive link already has its file stored in the Hub. ✓</p> : <>
        <p><b>{total}</b> paper{total === 1 ? "" : "s"} have a Drive link but no file stored in the Hub yet. Click the button, choose <b>velite@velite.in</b> in the Google window, and the Hub copies each file. Keep this window open until it finishes.</p>
        <div className="table-wrap" style={{ maxHeight: 260, overflow: "auto", marginBottom: 10 }}><table className="tbl">
          <tbody>
            {docs.map((x) => <tr key={x.id}><td><FirmBadge id={x.firm_id} /></td><td>{x.file_name || x.link}</td><td className="small-muted">{x.kind}</td></tr>)}
            {lics.map((l) => <tr key={l.id}><td><FirmBadge id={l.firm_id} /></td><td>{l.proof_name || l.proof_link}</td><td className="small-muted">Licence: {l.title}</td></tr>)}
          </tbody>
        </table></div>
        {busy && <p>Copying… {done} of {total}</p>}
        {errors.length > 0 && <div className="small-muted" style={{ color: "#b42318" }}><b>Not copied:</b><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn-ghost" disabled={busy} onClick={() => { saveClientId("").then(() => setCid("")); }}>Change Client ID</button>
          <button className="btn-primary" disabled={busy || total === 0} onClick={runAll}>{busy ? `Copying ${done}/${total}…` : `Copy ${total} file${total === 1 ? "" : "s"}`}</button>
        </div>
      </>}
    </Modal>
  );
}
