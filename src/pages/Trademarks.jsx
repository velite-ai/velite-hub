import { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { fmtDate, fmtDateTime, daysUntil } from "../lib/dates";
import Comments, { CommentToggle } from "../components/Comments";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";

export const TM_STATUSES = ["Registered", "Filed", "Applied / Filed", "Objected", "Opposed", "Accepted & Advertised",
  "Search Pending", "Filing Needed", "Renewal Due", "Not Applied", "Client To Confirm", "Abandoned", "Withdrawn"];
export const TM_CATEGORIES = ["Moisturiser", "Sunscreen", "Hair Care", "Anti-hyperpigmentation", "Cleanser", "Anti-aging",
  "Anti-dandruff", "Anti-inflammatory", "Antiparasitic", "Anti-acne", "Anti-fungal", "Anti-stretch marks",
  "Hair Retarding Lotion", "Steroid", "Antibiotic", "Keratolytic", "Anti-allergic", "Soothing agent",
  "Mixed Infectious Agent", "hair, skin, and nails nutritional supplement", "Business", "Scientific Research", "others"];
export const FIRMS = ["Velite Healthcare", "Velite Pharmaceuticals", "Velite India", "Velite Sciences"];
const CLOSED = ["Abandoned", "Withdrawn"];
const ST_COLOR = {
  Registered: "#2d7d4a", "Accepted & Advertised": "#0f7a5a", Filed: "#1a6fa8", "Applied / Filed": "#1a6fa8",
  Objected: "#e07b1a", Opposed: "#e24b4a", "Renewal Due": "#e24b4a", "Filing Needed": "#b7791f",
  "Search Pending": "#888", "Not Applied": "#888", "Client To Confirm": "#888", Abandoned: "#aaa", Withdrawn: "#aaa",
};
const RISK_COLOR = { Green: "#2d7d4a", Amber: "#e07b1a", Red: "#e24b4a" };

export function tmDue(t) {
  if (!t.deadline || CLOSED.includes(t.status)) return null;
  const n = daysUntil(t.deadline);
  if (n < 0) return { n, cls: "due-over", text: `Overdue ${-n}d` };
  if (n <= 30) return { n, cls: "due-over", text: `${n}d left` };
  if (n <= 180) return { n, cls: "due-today", text: `${Math.round(n / 30)} mo left` };
  return { n, cls: "due-later", text: "" };
}

export default function Trademarks() {
  const { trademarks, me } = useData();
  const canEdit = me.role === "owner" || me.role === "manager";
  const [q, setQ] = useState("");
  const [firm, setFirm] = useState("");
  const [status, setStatus] = useState("");
  const [cls, setCls] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [sort, setSort] = useState("deadline");
  const [open, setOpen] = useState(null); // trademark object or {} for new
  const [ask, dialog] = useConfirm();

  const live = trademarks.rows.filter((t) => !t.deleted_at);
  const active = live.filter((t) => !CLOSED.includes(t.status));
  const stats = {
    active: active.length,
    registered: live.filter((t) => t.status === "Registered").length,
    inProcess: active.filter((t) => t.status !== "Registered").length,
    due6: active.filter((t) => t.deadline && daysUntil(t.deadline) <= 180).length,
  };
  const classes = [...new Set(live.map((t) => t.class_no).filter(Boolean))].sort((a, b) => a - b);

  const shown = useMemo(() => {
    let r = showClosed ? live : active;
    if (firm) r = r.filter((t) => t.company === firm);
    if (status) r = r.filter((t) => t.status === status);
    if (cls) r = r.filter((t) => t.class_no === cls);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((t) => [t.mark, t.app_no, t.notes, t.category, (t.products || []).join(" ")].join(" ").toLowerCase().includes(s));
    return [...r].sort((a, b) => sort === "mark"
      ? a.mark.localeCompare(b.mark)
      : (a.deadline || "9999") < (b.deadline || "9999") ? -1 : (a.deadline || "9999") > (b.deadline || "9999") ? 1 : a.mark.localeCompare(b.mark));
  }, [live, active, showClosed, firm, status, cls, q, sort]);

  const exportCsv = () => {
    const cols = ["Mark", "Class", "Application No", "Firm", "Category", "Status", "Risk", "Attorney", "Deadline", "Use since", "Products", "Notes"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.join(",")].concat(shown.map((t) => [t.mark, t.class_no, t.app_no, t.company, t.category, t.status, t.risk, t.attorney,
      t.deadline || "", t.use_since || "", (t.products || []).join("; "), t.notes].map(esc).join(",")));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Velite-Trademarks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const del = async (t) => {
    const ok = await ask({ title: "Delete this trademark?", body: `"${t.mark}" will go to the recycle bin. An owner can restore it within 30 days.`, okText: "Delete", danger: true });
    if (!ok) return false;
    const r = await run(supabase.from("hub_trademarks").update({ deleted_at: new Date().toISOString() }).eq("id", t.id), "Moved to recycle bin");
    if (r.ok) trademarks.reload();
    return r.ok;
  };

  return (
    <div className="section">
      <div className="section-head">
        <div className="section-title">⚖️ Trademarks & IPR <span className="section-count">{stats.active} active</span></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost sm" onClick={exportCsv}>⬇ Excel (CSV)</button>
          {canEdit && <button className="add-btn" onClick={() => setOpen({})}>+ New Trademark</button>}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="stat-n">{stats.registered}</div><div className="stat-l">Registered</div></div>
        <div className="stat"><div className="stat-n">{stats.inProcess}</div><div className="stat-l">In process / contested</div></div>
        <div className={`stat ${stats.due6 ? "stat-warn" : ""}`}><div className="stat-n">{stats.due6}</div><div className="stat-l">Deadlines in next 6 months</div></div>
      </div>

      <div className="filter-bar">
        <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}>
          <option value="">All firms</option>{FIRMS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select className="inp inp-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{TM_STATUSES.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select className="inp inp-filter" value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="">All classes</option>{classes.map((c) => <option key={c} value={c}>Class {c}</option>)}
        </select>
        <select className="inp inp-filter" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="deadline">Sort: next deadline</option><option value="mark">Sort: A–Z</option>
        </select>
        <label className="chk"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show abandoned / withdrawn</label>
        <div style={{ flex: 1 }} />
        <SearchBox value={q} onChange={setQ} placeholder="Search mark, app no, product…" />
      </div>

      {shown.length === 0 ? <Empty>No trademarks match.</Empty> : (
        <div className="table-wrap">
          <table className="tbl tm-tbl">
            <thead><tr><th></th><th>Mark</th><th>Class</th><th>App. no</th><th>Firm</th><th>Status</th><th>Next deadline</th><th>Products</th></tr></thead>
            <tbody>
              {shown.map((t) => {
                const d = tmDue(t);
                return (
                  <tr key={t.id} className={`click-row ${CLOSED.includes(t.status) ? "row-off" : ""}`} onClick={() => setOpen(t)}>
                    <td className="tm-thumb">{t.image_data ? <img src={t.image_data} alt="" /> : <span className="tm-noimg">{t.mark.slice(0, 2)}</span>}</td>
                    <td><strong>{t.mark}</strong>{t.risk !== "Green" && <span className="risk-dot" style={{ background: RISK_COLOR[t.risk] }} title={`${t.risk} risk`} />}
                      <div className="small-muted">{t.category}</div></td>
                    <td>{t.class_no}</td>
                    <td className="nowrap">{t.app_no}</td>
                    <td className="nowrap">{(t.company || "").replace("Velite ", "")}</td>
                    <td><span className="tag" style={{ background: ST_COLOR[t.status] || "#888" }}>{t.status}</span></td>
                    <td className="nowrap">{t.deadline ? fmtDate(t.deadline) : "—"}{d?.text && <div className={`due ${d.cls}`}>{d.text}</div>}</td>
                    <td className="small-muted">{(t.products || []).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="form-hint" style={{ padding: "8px 24px 16px" }}>
        Indian trademarks last 10 years from the application date; renewal can be filed up to 6 months before expiry (and within 6 months after, with a surcharge). Keep "Next deadline" set to the earliest action date — renewal, reply to examination report or opposition hearing.
      </div>

      {open && <TmModal t={open.id ? open : null} canEdit={canEdit} onClose={() => setOpen(null)} onSaved={trademarks.reload}
        onDelete={async () => { if (await del(open)) setOpen(null); }} />}
      {dialog}
    </div>
  );
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 400, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function TmModal({ t, canEdit, onClose, onSaved, onDelete }) {
  const [f, setF] = useState(() => ({
    mark: t?.mark || "", app_no: t?.app_no || "", class_no: t?.class_no || "3", company: t?.company || FIRMS[0],
    category: t?.category || "others", status: t?.status || "Filed", risk: t?.risk || "Green", attorney: t?.attorney || "MAHTTA",
    deadline: t?.deadline || "", use_since: t?.use_since || "", products: (t?.products || []).join(", "), notes: t?.notes || "",
    image_data: t?.image_data || null,
  }));
  const [showComments, setShowComments] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ro = !canEdit;

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { const data = await shrinkImage(file); setF((x) => ({ ...x, image_data: data })); }
    catch { toast("Could not read that image", "err"); }
  };

  const save = async () => {
    if (!f.mark.trim()) return toast("Please enter the mark", "err");
    const row = { ...f, mark: f.mark.trim(), deadline: f.deadline || null, use_since: f.use_since || null,
      products: f.products.split(",").map((s) => s.trim()).filter(Boolean) };
    const q = t ? supabase.from("hub_trademarks").update(row).eq("id", t.id) : supabase.from("hub_trademarks").insert(row);
    const r = await run(q, t ? "Saved" : "Trademark added");
    if (r.ok) { onSaved(); onClose(); }
  };

  const opt = (list, v) => (list.includes(v) || !v ? list : [v, ...list]);
  return (
    <Modal wide title={t ? f.mark || "Trademark" : "New trademark"} onClose={onClose}
      actions={<>
        {t && canEdit && <button className="btn-ghost" style={{ marginRight: "auto", color: "#e24b4a" }} onClick={onDelete}>🗑 Delete</button>}
        <button className="btn-ghost" onClick={onClose}>{canEdit ? "Cancel" : "Close"}</button>
        {canEdit && <button className="btn-primary" onClick={save}>{t ? "Save" : "Add trademark"}</button>}
      </>}>
      <fieldset disabled={ro} className="plain-fieldset">
        <div className="tm-top">
          <div className="tm-imgbox">
            {f.image_data ? <img src={f.image_data} alt="logo" /> : <span className="small-muted">No logo</span>}
            {canEdit && <label className="restore-btn" style={{ marginTop: 8, display: "inline-block", cursor: "pointer" }}>
              {f.image_data ? "Change" : "Upload"} logo<input type="file" accept="image/*" hidden onChange={pickImage} /></label>}
            {canEdit && f.image_data && <button className="link-btn" onClick={() => setF((x) => ({ ...x, image_data: null }))}>remove</button>}
          </div>
          <div style={{ flex: 1 }}>
            <div className="form-grid">
              <Field label="Mark"><input className="form-inp" value={f.mark} onChange={set("mark")} /></Field>
              <Field label="Application no."><input className="form-inp" value={f.app_no} onChange={set("app_no")} /></Field>
              <Field label="Class"><input className="form-inp" value={f.class_no} onChange={set("class_no")} /></Field>
            </div>
            <div className="form-grid">
              <Field label="Firm (proprietor)"><select className="form-inp" value={f.company} onChange={set("company")}>{opt(FIRMS, f.company).map((o) => <option key={o}>{o}</option>)}</select></Field>
              <Field label="Status"><select className="form-inp" value={f.status} onChange={set("status")}>{opt(TM_STATUSES, f.status).map((o) => <option key={o}>{o}</option>)}</select></Field>
              <Field label="Risk"><select className="form-inp" value={f.risk} onChange={set("risk")}>{["Green", "Amber", "Red"].map((o) => <option key={o}>{o}</option>)}</select></Field>
            </div>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Next deadline" hint="Renewal, reply or hearing date"><input type="date" className="form-inp" value={f.deadline} onChange={set("deadline")} /></Field>
          <Field label="Use since"><input type="date" className="form-inp" value={f.use_since} onChange={set("use_since")} /></Field>
          <Field label="Category"><select className="form-inp" value={f.category} onChange={set("category")}>{opt(TM_CATEGORIES, f.category).map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Attorney"><input className="form-inp" value={f.attorney} onChange={set("attorney")} /></Field>
        </div>
        <Field label="Products (comma separated)"><input className="form-inp" value={f.products} onChange={set("products")} /></Field>
        <Field label="Notes"><textarea className="form-inp" value={f.notes} onChange={set("notes")} /></Field>
      </fieldset>
      {t && (
        <>
          <div className="meta-row">
            <span>➕ <strong>{t.created_by_name || "—"}</strong> · {fmtDateTime(t.created_at)}</span>
            <span>Last change {fmtDateTime(t.updated_at)}</span>
            <CommentToggle type="trademark" id={t.id} open={showComments} onToggle={() => setShowComments((o) => !o)} />
          </div>
          {showComments && <Comments type="trademark" id={t.id} />}
        </>
      )}
      {ro && <div className="form-hint">View only — owners and managers can edit trademarks.</div>}
    </Modal>
  );
}
