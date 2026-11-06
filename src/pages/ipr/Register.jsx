import { useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { useData, run, toast } from "../../lib/data";
import { fmtDate, fmtDateTime } from "../../lib/dates";
import Comments, { CommentToggle } from "../../components/Comments";
import { Modal, Field, Empty, useConfirm } from "../../components/ui";
async function softDeleteMark(t, ask, reload) {
  const ok = await ask({ title: `Delete trademark record "${t.mark}"?`, body: "This removes the word mark, products, dates, image mark and notes from the register. It goes to the recycle bin, where an owner can restore it within 30 days.", okText: "Delete", danger: true });
  if (!ok) return false;
  const r = await run(supabase.from("hub_trademarks").update({ deleted_at: new Date().toISOString() }).eq("id", t.id), "Moved to recycle bin");
  if (r.ok) reload();
  return r.ok;
}
import { FIRMS, RISKS, Pill, statusClass, riskClass, dueText, useIprOptions, mergeOptions, cleanOption, splitList, downloadDataUrl } from "./shared";

const CHIP = [["#2563eb", "#06b6d4"], ["#7c3aed", "#ec4899"], ["#16a34a", "#84cc16"], ["#f59e0b", "#ef4444"], ["#0891b2", "#6366f1"]];

export default function Register({ canEdit, openMark }) {
  const d = useData();
  const { trademarks } = d;
  const { categories, statuses } = useIprOptions(d);
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState({ search: "", category: "All", company: "All", classNo: "All", status: "All" });
  const marks = trademarks.rows.filter((t) => !t.deleted_at);
  const uniq = (k) => ["All", ...Array.from(new Set(marks.map((t) => t[k]).filter(Boolean))).sort()];
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const rows = useMemo(() => marks.filter((t) => {
    const text = [t.mark, (t.products || []).join(" "), t.app_no, t.attorney, t.category, t.company].join(" ").toLowerCase();
    return (!f.search || text.includes(f.search.toLowerCase())) &&
      (f.category === "All" || t.category === f.category) && (f.company === "All" || t.company === f.company) &&
      (f.classNo === "All" || t.class_no === f.classNo) && (f.status === "All" || t.status === f.status);
  }).sort((a, b) => String(a.mark || "").localeCompare(String(b.mark || ""), undefined, { sensitivity: "base" })), [marks, f]);

  return (
    <>
      <div className="ipanel">
        <div className="ipanel-head"><div><h3>Trademark Register</h3><p>Filter by category, company, class, status, risk, attorney, or product name.</p></div>
          {canEdit && <button className="add-btn" onClick={() => openMark({})}>+ Add Trademark</button>}</div>
        <div className="ifilters">
          <label>Search<input className="form-inp" placeholder="Mark, product, application no., attorney" value={f.search} onChange={set("search")} /></label>
          <label>Category<select className="form-inp" value={f.category} onChange={set("category")}>{["All", ...categories].map((o) => <option key={o}>{o}</option>)}</select></label>
          <label>Company<select className="form-inp" value={f.company} onChange={set("company")}>{uniq("company").map((o) => <option key={o}>{o}</option>)}</select></label>
          <label>Class<select className="form-inp" value={f.classNo} onChange={set("classNo")}>{uniq("class_no").map((o) => <option key={o}>{o}</option>)}</select></label>
          <label>Status<select className="form-inp" value={f.status} onChange={set("status")}>{["All", ...statuses].map((o) => <option key={o}>{o}</option>)}</select></label>
        </div>
        <div className="small-muted" style={{ padding: "0 4px 8px" }}>{rows.length} of {marks.length} records</div>
        <div className="table-wrap">
          <table className="tbl itbl">
            <thead><tr><th>Mark</th><th>Products</th><th>Category</th><th>Company</th><th>Class</th><th>Status</th><th>Use Since</th><th>Deadline</th><th>Risk</th><th>Attorney</th><th>Action</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11}><Empty>No records match these filters.</Empty></td></tr>}
              {rows.map((t, i) => {
                const c = CHIP[i % 5];
                return (
                  <tr key={t.id}>
                    <td><div className="mark-cell">
                      <div className="mark-visual">
                        <div className="logo-chip" style={{ background: `linear-gradient(135deg, ${c[0]}, ${c[1]})` }}>{String(t.mark || "V").charAt(0)}</div>
                        {t.image_data && <a href={t.image_data} download={t.image_name || `${t.mark}-image-mark.png`} title="Download image mark"><img className="mark-image-thumb" src={t.image_data} alt="" /></a>}
                      </div>
                      <div><strong>{t.mark}</strong><br /><span className="small-muted">{t.app_no || "No application no. yet"}</span></div>
                    </div></td>
                    <td>{(t.products || []).map((p) => <Pill key={p} tone="cyan">{p}</Pill>)}</td>
                    <td><Pill>{t.category}</Pill></td>
                    <td>{t.company}</td>
                    <td><Pill tone="blue">Class {t.class_no}</Pill></td>
                    <td><Pill tone={statusClass(t.status)}>{t.status}</Pill></td>
                    <td className="nowrap">{t.use_since ? fmtDate(t.use_since) : "Not set"}</td>
                    <td className="nowrap">{dueText(t.deadline)}</td>
                    <td><Pill tone={riskClass(t.risk)}>{t.risk}</Pill></td>
                    <td>{t.attorney}</td>
                    <td><div className="action-stack">
                      <button className="action-btn" onClick={() => openMark(t)}>{canEdit ? "Edit" : "View"}</button>
                      {canEdit && <button className="action-btn danger" onClick={() => softDeleteMark(t, ask, trademarks.reload)}>Delete</button>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {canEdit && <OptionManager />}
      {dialog}
    </>
  );
}

function OptionManager() {
  const d = useData();
  const { categories, statuses } = useIprOptions(d);
  const [cat, setCat] = useState(""); const [st, setSt] = useState("");
  const save = async (key, vals) => {
    const r = await run(supabase.from("hub_ipr_options").update({ vals }).eq("key", key));
    if (r.ok) d.iprOptions.reload();
  };
  const add = (key, list, v, reset) => { const o = cleanOption(v); if (!o) return; save(key, mergeOptions(list, [o])); reset(""); };
  const delCat = (v) => {
    const inUse = [...d.trademarks.rows.filter((t) => !t.deleted_at), ...d.iprNotices.rows.filter((t) => !t.deleted_at), ...d.iprThird.rows.filter((t) => !t.deleted_at)].some((x) => x.category === v);
    if (inUse) return alert("This category is being used in saved records. Please edit those records to another category before deleting it.");
    if (!window.confirm(`Delete category option "${v}"?`)) return;
    save("categories", categories.filter((x) => x.toLowerCase() !== v.toLowerCase()));
  };
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>Category & Status Options</h3><p>Add new dropdown values for trademarks, Personal Care notifications, and third-party brand records.</p></div></div>
      <div className="option-manager">
        <div className="option-box"><h4>Categories</h4>
          <div className="inline-form"><input className="form-inp" placeholder="Example: Toner" value={cat} onChange={(e) => setCat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add("categories", categories, cat, setCat)} />
            <button className="add-btn" onClick={() => add("categories", categories, cat, setCat)}>Add</button></div>
          <div className="option-list">{categories.map((v) => <Pill key={v} tone="cyan">{v} <button className="option-delete" onClick={() => delCat(v)} title={`Delete ${v}`}>×</button></Pill>)}</div>
        </div>
        <div className="option-box"><h4>Status</h4>
          <div className="inline-form"><input className="form-inp" placeholder="Example: Hearing Fixed" value={st} onChange={(e) => setSt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add("statuses", statuses, st, setSt)} />
            <button className="add-btn" onClick={() => add("statuses", statuses, st, setSt)}>Add</button></div>
          <div className="option-list">{statuses.map((v) => <Pill key={v} tone="blue">{v}</Pill>)}</div>
        </div>
      </div>
    </div>
  );
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Please upload only an image file for the image mark."));
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Could not read the image mark."));
    img.src = URL.createObjectURL(file);
  });
}

export function TrademarkModal({ t, canEdit, onClose }) {
  const d = useData();
  const { categories, statuses } = useIprOptions(d);
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState(() => ({
    mark: t?.mark || "", company: t?.company || FIRMS[0], status: t?.status || "Registered", products: (t?.products || []).join(", "),
    category: t?.category || "Moisturiser", class_no: t?.class_no || "", app_no: t?.app_no || "", use_since: t?.use_since || "",
    deadline: t?.deadline || "", attorney: t?.attorney || "", risk: t?.risk || "Green", notes: t?.notes || "",
    image_data: t?.image_data || null, image_name: t?.image_name || null,
  }));
  const [showC, setShowC] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const opt = (list, v) => (list.includes(v) || !v ? list : [v, ...list]);

  const pick = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { const data = await shrinkImage(file); setF((x) => ({ ...x, image_data: data, image_name: file.name })); }
    catch (err) { toast(err.message, "err"); }
  };
  const save = async () => {
    if (!f.mark.trim()) return toast("Please enter the mark name", "err");
    const products = splitList(f.products);
    if (!products.length) return toast("Please enter at least one existing product", "err");
    if (!f.class_no.trim()) return toast("Please enter the class", "err");
    const row = { ...f, mark: f.mark.trim(), products, class_no: f.class_no.trim(), app_no: f.app_no.trim(),
      attorney: f.attorney.trim() || "Not Assigned", notes: f.notes.trim(), use_since: f.use_since || null, deadline: f.deadline || null };
    const q = t?.id ? supabase.from("hub_trademarks").update(row).eq("id", t.id) : supabase.from("hub_trademarks").insert(row);
    const r = await run(q, t?.id ? "Trademark record updated" : "Trademark record saved");
    if (r.ok) { d.trademarks.reload(); onClose(); }
  };
  const del = async () => { if (await softDeleteMark(t, ask, d.trademarks.reload)) onClose(); };

  return (
    <Modal wide title={t?.id ? (canEdit ? `Edit Trademark: ${t.mark}` : t.mark) : "Add New Trademark / Proposed Mark"} onClose={onClose}
      actions={<>
        {t?.id && canEdit && <button className="btn-ghost" style={{ marginRight: "auto", color: "#e24b4a" }} onClick={del}>🗑 Delete</button>}
        <button className="btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
        {canEdit && <button className="btn-primary" onClick={save}>{t?.id ? "Update Trademark Record" : "Save Trademark Record"}</button>}
      </>}>
      {!t?.id && <p className="modal-text" style={{ marginBottom: 12 }}>Use this for registered marks, filed marks, or names being checked for future filing.</p>}
      <fieldset disabled={!canEdit} className="plain-fieldset">
        <div className="form-grid">
          <Field label="Mark Name"><input className="form-inp" value={f.mark} onChange={set("mark")} placeholder="Example: Velite SunShield" /></Field>
          <Field label="Velite Company"><select className="form-inp" value={f.company} onChange={set("company")}>{opt(FIRMS, f.company).map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Status"><select className="form-inp" value={f.status} onChange={set("status")}>{opt(statuses, f.status).map((o) => <option key={o}>{o}</option>)}</select></Field>
        </div>
        <Field label="Existing Products"><input className="form-inp" value={f.products} onChange={set("products")} placeholder="Comma separated product names" /></Field>
        <div className="form-grid">
          <Field label="Category"><select className="form-inp" value={f.category} onChange={set("category")}>{opt(categories, f.category).map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Class"><input className="form-inp" value={f.class_no} onChange={set("class_no")} placeholder="3 or 5" /></Field>
          <Field label="Application No."><input className="form-inp" value={f.app_no} onChange={set("app_no")} placeholder="Optional" /></Field>
        </div>
        <div className="form-grid">
          <Field label="Use Since Date"><input type="date" className="form-inp" value={f.use_since} onChange={set("use_since")} /></Field>
          <Field label="Next Deadline"><input type="date" className="form-inp" value={f.deadline} onChange={set("deadline")} /></Field>
          <Field label="Attorney"><input className="form-inp" value={f.attorney} onChange={set("attorney")} placeholder="Attorney / agent" /></Field>
          <Field label="Risk"><select className="form-inp" value={f.risk} onChange={set("risk")}>{RISKS.map((o) => <option key={o}>{o}</option>)}</select></Field>
        </div>
        <Field label="Image Mark">
          <div className="img-mark-row">
            {f.image_data ? <img src={f.image_data} alt="" className="img-mark-preview" /> : <span className="small-muted">No image mark</span>}
            {canEdit && <label className="restore-btn" style={{ cursor: "pointer" }}>{f.image_data ? "Replace image" : "Upload image"}<input type="file" accept="image/*" hidden onChange={pick} /></label>}
            {f.image_data && <button type="button" className="restore-btn" onClick={() => downloadDataUrl(f.image_data, f.image_name || `${f.mark}-image-mark.jpg`)}>Download</button>}
            {canEdit && f.image_data && <button type="button" className="link-btn" onClick={() => setF((x) => ({ ...x, image_data: null, image_name: null }))}>remove</button>}
          </div>
        </Field>
        <Field label="Notes"><textarea className="form-inp" value={f.notes} onChange={set("notes")} placeholder="Filing remarks, future action, attorney comments" /></Field>
      </fieldset>
      {t?.id && <>
        <div className="meta-row">
          <span>➕ <strong>{t.created_by_name || "—"}</strong> · {fmtDateTime(t.created_at)}</span>
          <span>Last change {fmtDateTime(t.updated_at)}</span>
          <CommentToggle type="trademark" id={t.id} open={showC} onToggle={() => setShowC((o) => !o)} />
        </div>
        {showC && <Comments type="trademark" id={t.id} />}
      </>}
      {!canEdit && <div className="form-hint">View only — owners and managers can edit trademarks.</div>}
      {dialog}
    </Modal>
  );
}
