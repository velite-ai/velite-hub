import { useState } from "react";
import { supabase } from "../../supabase";
import { useData, run, toast } from "../../lib/data";
import { fmtDate, todayISO } from "../../lib/dates";
import { Modal, Field, Empty, useConfirm } from "../../components/ui";
import { NOTICE_TYPES, PRIORITIES, DOC_TYPES, PROOF_CHANNELS, RISKS, Pill, prioClass, useIprOptions, splitList, fileToDataUrl, downloadStored } from "./shared";

const opt = (list, v) => (list.includes(v) || !v ? list : [v, ...list]);
const softDelete = async (table, id, reload) => {
  const r = await run(supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id), "Moved to recycle bin");
  if (r.ok) reload();
  return r.ok;
};

function useSave(table, reload) {
  return async (id, row, okMsg) => {
    const q = id ? supabase.from(table).update(row).eq("id", id) : supabase.from(table).insert(row);
    const r = await run(q, okMsg);
    if (r.ok) reload();
    return r.ok;
  };
}

function MarkPicker({ value, onChange }) {
  const { trademarks } = useData();
  const marks = [...new Set(trademarks.rows.filter((t) => !t.deleted_at).map((t) => t.mark))].sort();
  return (
    <>
      <input className="form-inp" list="ipr-marks" value={value} onChange={onChange} placeholder="Example: SUNSHIELD" />
      <datalist id="ipr-marks">{marks.map((m) => <option key={m} value={m} />)}</datalist>
    </>
  );
}

/* ----------------------------- IPR Notifications ----------------------------- */
export function Notifications({ canEdit, openNotice }) {
  const { iprNotices } = useData();
  const rows = iprNotices.rows.filter((n) => !n.deleted_at).sort((a, b) => (b.notice_date || "").localeCompare(a.notice_date || ""));
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>Personal Care IPR Notification Register</h3><p>Store notices, updates, alerts, attorney messages, market watch items, and internal reminders connected to Personal Care IPR.</p></div>
        {canEdit && <button className="add-btn" onClick={() => openNotice({})}>+ Add Notification</button>}</div>
      <div className="table-wrap">
        <table className="tbl itbl">
          <thead><tr><th>Date</th><th>Type</th><th>Connected Mark</th><th>Category</th><th>Priority</th><th>Follow-up</th><th>Notification</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8}><Empty>No Personal Care IPR notifications saved yet.</Empty></td></tr>}
            {rows.map((n) => (
              <tr key={n.id}>
                <td className="nowrap">{fmtDate(n.notice_date)}</td><td><Pill tone="blue">{n.type}</Pill></td><td>{n.mark || "Personal Care"}</td>
                <td><Pill tone="cyan">{n.category}</Pill></td><td><Pill tone={prioClass(n.priority)}>{n.priority}</Pill></td>
                <td className="nowrap">{n.follow_up ? fmtDate(n.follow_up) : "No date"}</td><td className="pre">{n.summary}</td>
                <td><button className="action-btn" onClick={() => openNotice(n)}>{canEdit ? "Edit" : "View"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NoticeModal({ n, canEdit, onClose }) {
  const d = useData();
  const { categories } = useIprOptions(d);
  const save = useSave("hub_ipr_notifications", d.iprNotices.reload);
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState({ notice_date: n?.notice_date || todayISO(), type: n?.type || NOTICE_TYPES[0], priority: n?.priority || "Normal",
    mark: n?.mark || "", category: n?.category || "Personal Care - General", follow_up: n?.follow_up || "", summary: n?.summary || "" });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    if (!f.notice_date || !f.summary.trim()) return toast("Date and notification notes are required", "err");
    if (await save(n?.id, { ...f, mark: f.mark.trim(), summary: f.summary.trim(), follow_up: f.follow_up || null }, n?.id ? "IPR notification updated" : "IPR notification saved")) onClose();
  };
  const del = async () => { if (await ask({ title: "Delete this notification?", okText: "Delete", danger: true }) && await softDelete("hub_ipr_notifications", n.id, d.iprNotices.reload)) onClose(); };
  return (
    <Modal wide title={n?.id ? "Edit IPR Notification" : "New IPR Notification"} onClose={onClose}
      actions={<>{n?.id && canEdit && <button className="btn-ghost" style={{ marginRight: "auto", color: "#e24b4a" }} onClick={del}>🗑 Delete</button>}
        <button className="btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
        {canEdit && <button className="btn-primary" onClick={submit}>{n?.id ? "Update IPR Notification" : "Save IPR Notification"}</button>}</>}>
      <fieldset disabled={!canEdit} className="plain-fieldset">
        <div className="form-grid">
          <Field label="Notification Date"><input type="date" className="form-inp" value={f.notice_date} onChange={set("notice_date")} /></Field>
          <Field label="Type"><select className="form-inp" value={f.type} onChange={set("type")}>{opt(NOTICE_TYPES, f.type).map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Priority"><select className="form-inp" value={f.priority} onChange={set("priority")}>{PRIORITIES.map((o) => <option key={o}>{o}</option>)}</select></Field>
        </div>
        <div className="form-grid">
          <Field label="Connected Mark"><MarkPicker value={f.mark} onChange={set("mark")} /></Field>
          <Field label="Personal Care Category"><select className="form-inp" value={f.category} onChange={set("category")}>{opt(categories, f.category).map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Follow-up Date"><input type="date" className="form-inp" value={f.follow_up} onChange={set("follow_up")} /></Field>
        </div>
        <Field label="Notification / Reference Notes"><textarea className="form-inp" style={{ minHeight: 110 }} value={f.summary} onChange={set("summary")}
          placeholder="Write the notification, source, link/reference, attorney instruction, or future action here." /></Field>
      </fieldset>
      {dialog}
    </Modal>
  );
}

/* ----------------------------- Third-party brands ----------------------------- */
const TP_DEFAULT_RESP = "Third party has undertaken that if any trademark/IPR issue arises, it is solely their responsibility.";

export function ThirdParty({ canEdit, openThird }) {
  const { iprThird } = useData();
  const rows = iprThird.rows.filter((t) => !t.deleted_at).sort((a, b) => String(a.client || "").localeCompare(String(b.client || "")));
  const undertaking = (t) => {
    if (t.undertaking_name) return <><button className="ipill green linkish" onClick={() => downloadStored("hub_ipr_third_party", t.id, "undertaking_data", "undertaking_name")}>Download</button><br /><span className="small-muted">{t.undertaking_name}</span></>;
    if (t.status === "Not Applied") return <Pill tone="red">Required</Pill>;
    return <Pill tone="amber">Not uploaded</Pill>;
  };
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>Third-party Client Brand Register</h3><p>Keep client-owned brand records separate from Velite-owned trademarks, including responsibility undertaking where trademark registration is not applied.</p></div>
        {canEdit && <button className="add-btn" onClick={() => openThird({})}>+ Add Client Brand</button>}</div>
      <div className="table-wrap">
        <table className="tbl itbl">
          <thead><tr><th>Client</th><th>Brand</th><th>Products</th><th>Category</th><th>Status</th><th>Application</th><th>Undertaking</th><th>Responsibility</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9}><Empty>No third-party client brand records added yet.</Empty></td></tr>}
            {rows.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.client}</strong><br /><span className="small-muted">{t.contact}</span></td><td>{t.brand}</td>
                <td>{(t.products || []).map((p) => <Pill key={p} tone="cyan">{p}</Pill>)}</td><td><Pill>{t.category}</Pill></td>
                <td><Pill tone={t.status === "Registered" ? "green" : t.status === "Applied / Filed" ? "blue" : "red"}>{t.status}</Pill></td>
                <td>{t.app_no || "Not available"}<br /><span className="small-muted">{t.class_no ? `Class ${t.class_no}` : ""}</span></td>
                <td>{undertaking(t)}{t.undertaking_date && <><br /><span className="small-muted">{fmtDate(t.undertaking_date)}</span></>}</td>
                <td className="pre">{t.responsibility}</td>
                <td><button className="action-btn" onClick={() => openThird(t)}>{canEdit ? "Edit" : "View"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ThirdPartyModal({ t, canEdit, onClose }) {
  const d = useData();
  const { categories, statuses } = useIprOptions(d);
  const save = useSave("hub_ipr_third_party", d.iprThird.reload);
  const [ask, dialog] = useConfirm();
  const [file, setFile] = useState(null);
  const [f, setF] = useState({ client: t?.client || "", brand: t?.brand || "", category: t?.category || "Personal Care - General",
    products: (t?.products || []).join(", "), status: t?.status || "Registered", app_no: t?.app_no || "", class_no: t?.class_no || "",
    contact: t?.contact || "", undertaking_date: t?.undertaking_date || "", responsibility: t?.responsibility || "" });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    if (!f.client.trim() || !f.brand.trim()) return toast("Client and brand are required", "err");
    const products = splitList(f.products);
    if (!products.length) return toast("Please enter the products supplied / manufactured", "err");
    if (f.status === "Not Applied" && !file && !t?.undertaking_name)
      return toast("Please upload the undertaking on the third party's letterhead because trademark registration is not applied.", "err");
    let fileRow = {};
    try { if (file) { const u = await fileToDataUrl(file, "undertaking file"); fileRow = { undertaking_name: u.name, undertaking_data: u.data }; } }
    catch (e) { return toast(e.message, "err"); }
    const row = { ...f, client: f.client.trim(), brand: f.brand.trim(), products, app_no: f.app_no.trim(), class_no: f.class_no.trim(),
      contact: f.contact.trim(), undertaking_date: f.undertaking_date || null,
      responsibility: f.responsibility.trim() || (f.status === "Not Applied" ? TP_DEFAULT_RESP : ""), ...fileRow };
    if (await save(t?.id, row, t?.id ? "Third-party brand record updated" : "Third-party brand record saved")) onClose();
  };
  const del = async () => { if (await ask({ title: `Delete ${t.brand}?`, okText: "Delete", danger: true }) && await softDelete("hub_ipr_third_party", t.id, d.iprThird.reload)) onClose(); };
  return (
    <Modal wide title={t?.id ? `Edit Third-party Brand: ${t.brand}` : "Third-party Client Brand Register"} onClose={onClose}
      actions={<>{t?.id && canEdit && <button className="btn-ghost" style={{ marginRight: "auto", color: "#e24b4a" }} onClick={del}>🗑 Delete</button>}
        <button className="btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
        {canEdit && <button className="btn-primary" onClick={submit}>{t?.id ? "Update Third-party Brand Record" : "Save Third-party Brand Record"}</button>}</>}>
      <fieldset disabled={!canEdit} className="plain-fieldset">
        <div className="form-grid">
          <Field label="Third-party Client"><input className="form-inp" value={f.client} onChange={set("client")} placeholder="Client company name" /></Field>
          <Field label="Client Brand / Mark"><input className="form-inp" value={f.brand} onChange={set("brand")} placeholder="Brand or product mark" /></Field>
          <Field label="Product Category"><select className="form-inp" value={f.category} onChange={set("category")}>{opt(categories, f.category).map((o) => <option key={o}>{o}</option>)}</select></Field>
        </div>
        <Field label="Products Supplied / Manufactured"><input className="form-inp" value={f.products} onChange={set("products")} placeholder="Comma separated product names" /></Field>
        <div className="form-grid">
          <Field label="Trademark Status"><select className="form-inp" value={f.status} onChange={set("status")}>{opt(statuses, f.status).map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Application / Registration No."><input className="form-inp" value={f.app_no} onChange={set("app_no")} placeholder="Optional" /></Field>
          <Field label="Class"><input className="form-inp" value={f.class_no} onChange={set("class_no")} placeholder="Example: 3" /></Field>
        </div>
        <div className="form-grid">
          <Field label="Client Contact"><input className="form-inp" value={f.contact} onChange={set("contact")} placeholder="Name / email / phone" /></Field>
          <Field label="Undertaking Date"><input type="date" className="form-inp" value={f.undertaking_date} onChange={set("undertaking_date")} /></Field>
        </div>
        <Field label="Undertaking On Letterhead" hint={t?.undertaking_name ? `Existing undertaking will be kept unless a new file is selected: ${t.undertaking_name}` : (f.status === "Not Applied" ? "Required because trademark registration is not applied." : "PDF, image or Word file, below 5 MB")}>
          <input type="file" className="form-inp" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <Field label="Responsibility / Notes"><textarea className="form-inp" value={f.responsibility} onChange={set("responsibility")}
          placeholder="For non-applied marks, record that any IPR/trademark issue is solely the third party's responsibility." /></Field>
      </fieldset>
      {t?.undertaking_name && <button className="restore-btn" onClick={() => downloadStored("hub_ipr_third_party", t.id, "undertaking_data", "undertaking_name")}>⬇ Download current undertaking</button>}
      {dialog}
    </Modal>
  );
}

/* ----------------------------- Documents & usage proof ----------------------------- */
export function Documents({ canEdit, openDoc }) {
  const { iprDocs } = useData();
  const [tab, setTab] = useState("document");
  const rows = iprDocs.rows.filter((x) => !x.deleted_at && x.kind === tab);
  const dl = (x) => x.file_name ? <button className="ipill green linkish" onClick={() => downloadStored("hub_ipr_documents", x.id, "file_data", "file_name")}>Download</button> : <span className="small-muted">No file</span>;
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>Documents & Usage Proof</h3><p>Certificate, filing papers, invoices, product photos, catalogue pages, and screenshots.</p></div>
        {canEdit && <button className="add-btn" onClick={() => openDoc({ kind: tab })}>+ Add {tab === "document" ? "Document" : "Usage Proof"}</button>}</div>
      <div className="seg" style={{ marginBottom: 12, display: "inline-flex" }}>
        <button className={tab === "document" ? "on" : ""} onClick={() => setTab("document")}>Documents</button>
        <button className={tab === "proof" ? "on" : ""} onClick={() => setTab("proof")}>Usage Proof</button>
      </div>
      <div className="table-wrap">
        <table className="tbl itbl">
          {tab === "document"
            ? <thead><tr><th>Document</th><th>Trademark</th><th>Type</th><th>Uploaded By</th><th>Review</th><th>File</th><th></th></tr></thead>
            : <thead><tr><th>Proof</th><th>Trademark</th><th>Product</th><th>Channel</th><th>Date</th><th>File</th><th></th></tr></thead>}
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7}><Empty>{tab === "document" ? "No documents added yet." : "No usage proof added yet."}</Empty></td></tr>}
            {rows.map((x) => tab === "document" ? (
              <tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.mark}</td><td><Pill tone="blue">{x.doc_type}</Pill></td><td>{x.created_by_name}</td><td className="pre">{x.review}</td><td>{dl(x)}</td>
                <td><button className="action-btn" onClick={() => openDoc(x)}>{canEdit ? "Edit" : "View"}</button></td></tr>
            ) : (
              <tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.mark}</td><td>{x.product}</td><td><Pill tone="green">{x.channel}</Pill></td><td className="nowrap">{x.doc_date ? fmtDate(x.doc_date) : ""}</td><td>{dl(x)}</td>
                <td><button className="action-btn" onClick={() => openDoc(x)}>{canEdit ? "Edit" : "View"}</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DocModal({ x, canEdit, onClose }) {
  const d = useData();
  const save = useSave("hub_ipr_documents", d.iprDocs.reload);
  const [ask, dialog] = useConfirm();
  const kind = x.kind || "document";
  const [file, setFile] = useState(null);
  const [f, setF] = useState({ name: x.name || "", mark: x.mark || "", doc_type: x.doc_type || DOC_TYPES[0], review: x.review || "",
    product: x.product || "", channel: x.channel || PROOF_CHANNELS[0], doc_date: x.doc_date || "" });
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const submit = async () => {
    if (!f.name.trim()) return toast("Please enter a name", "err");
    let fileRow = {};
    try { if (file) { const u = await fileToDataUrl(file, "file"); fileRow = { file_name: u.name, file_data: u.data }; } }
    catch (e) { return toast(e.message, "err"); }
    if (await save(x.id, { kind, ...f, name: f.name.trim(), doc_date: f.doc_date || null, ...fileRow }, "Saved")) onClose();
  };
  const del = async () => { if (await ask({ title: `Delete ${x.name}?`, okText: "Delete", danger: true }) && await softDelete("hub_ipr_documents", x.id, d.iprDocs.reload)) onClose(); };
  return (
    <Modal wide title={x.id ? x.name : kind === "document" ? "Add Document" : "Add Usage Proof"} onClose={onClose}
      actions={<>{x.id && canEdit && <button className="btn-ghost" style={{ marginRight: "auto", color: "#e24b4a" }} onClick={del}>🗑 Delete</button>}
        <button className="btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
        {canEdit && <button className="btn-primary" onClick={submit}>Save</button>}</>}>
      <fieldset disabled={!canEdit} className="plain-fieldset">
        <div className="form-grid">
          <Field label={kind === "document" ? "Document name" : "Proof name"}><input className="form-inp" value={f.name} onChange={set("name")}
            placeholder={kind === "document" ? "Example: ISOCAV registration certificate" : "Example: Periflow invoice March 2016"} /></Field>
          <Field label="Trademark"><MarkPicker value={f.mark} onChange={set("mark")} /></Field>
        </div>
        {kind === "document" ? (
          <div className="form-grid">
            <Field label="Type"><select className="form-inp" value={f.doc_type} onChange={set("doc_type")}>{opt(DOC_TYPES, f.doc_type).map((o) => <option key={o}>{o}</option>)}</select></Field>
            <Field label="Review / remarks"><input className="form-inp" value={f.review} onChange={set("review")} placeholder="e.g. Checked by attorney" /></Field>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Product"><input className="form-inp" value={f.product} onChange={set("product")} /></Field>
            <Field label="Channel"><select className="form-inp" value={f.channel} onChange={set("channel")}>{opt(PROOF_CHANNELS, f.channel).map((o) => <option key={o}>{o}</option>)}</select></Field>
            <Field label="Date"><input type="date" className="form-inp" value={f.doc_date} onChange={set("doc_date")} /></Field>
          </div>
        )}
        <Field label="File" hint={x.file_name ? `Current file kept unless you choose a new one: ${x.file_name}` : "PDF, image or Word file, below 5 MB"}>
          <input type="file" className="form-inp" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
      </fieldset>
      {x.file_name && <button className="restore-btn" onClick={() => downloadStored("hub_ipr_documents", x.id, "file_data", "file_name")}>⬇ Download {x.file_name}</button>}
      {dialog}
    </Modal>
  );
}

/* ----------------------------- Matters ----------------------------- */
export function MatterModal({ m, canEdit, onClose }) {
  const d = useData();
  const save = useSave("hub_ipr_matters", d.iprMatters.reload);
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState({ title: m.title || "", mark: m.mark || "", owner: m.owner || "", due: m.due || "", risk: m.risk || "Amber", status: m.status || "Open", notes: m.notes || "" });
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const submit = async () => {
    if (!f.title.trim()) return toast("Please enter the matter title", "err");
    if (await save(m.id, { ...f, title: f.title.trim(), due: f.due || null }, "Matter saved")) onClose();
  };
  const del = async () => { if (await ask({ title: `Delete ${m.title}?`, okText: "Delete", danger: true }) && await softDelete("hub_ipr_matters", m.id, d.iprMatters.reload)) onClose(); };
  return (
    <Modal wide title={m.id ? m.title : "Add Legal Matter"} onClose={onClose}
      actions={<>{m.id && canEdit && <button className="btn-ghost" style={{ marginRight: "auto", color: "#e24b4a" }} onClick={del}>🗑 Delete</button>}
        <button className="btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
        {canEdit && <button className="btn-primary" onClick={submit}>Save</button>}</>}>
      <fieldset disabled={!canEdit} className="plain-fieldset">
        <Field label="Matter"><input className="form-inp" value={f.title} onChange={set("title")} placeholder="Example: PERIFLOW opposition hearing" /></Field>
        <div className="form-grid">
          <Field label="Mark"><MarkPicker value={f.mark} onChange={set("mark")} /></Field>
          <Field label="Owner / attorney"><input className="form-inp" value={f.owner} onChange={set("owner")} /></Field>
          <Field label="Due"><input type="date" className="form-inp" value={f.due} onChange={set("due")} /></Field>
        </div>
        <div className="form-grid">
          <Field label="Risk"><select className="form-inp" value={f.risk} onChange={set("risk")}>{RISKS.map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Status"><select className="form-inp" value={f.status} onChange={set("status")}>{["Open", "Closed"].map((o) => <option key={o}>{o}</option>)}</select></Field>
        </div>
        <Field label="Notes"><textarea className="form-inp" value={f.notes} onChange={set("notes")} /></Field>
      </fieldset>
      {dialog}
    </Modal>
  );
}
