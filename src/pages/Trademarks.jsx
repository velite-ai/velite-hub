import { useState } from "react";
import { useData } from "../lib/data";
import { daysUntil } from "../lib/dates";
import Register, { TrademarkModal } from "./ipr/Register";
import { Dashboard, Products, Actions, Reports } from "./ipr/Views";
import { Notifications, NoticeModal, ThirdParty, ThirdPartyModal, Documents, DocModal, MatterModal } from "./ipr/Records";
import { exportExcel, exportPdf } from "./ipr/exports";

const CLOSED = ["Abandoned", "Withdrawn"];
// used by My Day
export function tmDue(t) {
  if (!t.deadline || CLOSED.includes(t.status)) return null;
  const n = daysUntil(t.deadline);
  if (n < 0) return { n, cls: "due-over", text: `Overdue ${-n}d` };
  if (n <= 30) return { n, cls: "due-over", text: `${n}d left` };
  if (n <= 180) return { n, cls: "due-today", text: `${Math.round(n / 30)} mo left` };
  return { n, cls: "due-later", text: "" };
}

const VIEWS = [
  ["dashboard", "Dashboard"], ["register", "Trademark Register"], ["products", "Products & Categories"],
  ["actions", "Actions & Deadlines"], ["documents", "Documents & Proof"], ["notifications", "IPR Notifications"],
  ["thirdparty", "Third-party Brands"], ["reports", "Reports"],
];

export default function Trademarks() {
  const d = useData();
  const canEdit = d.me.role === "owner" || d.me.role === "manager";
  const [view, setView] = useState(() => sessionStorage.getItem("hub-ipr-view") || "dashboard");
  const [modal, setModal] = useState(null); // {type, rec}
  const go = (v) => { setView(v); sessionStorage.setItem("hub-ipr-view", v); window.scrollTo(0, 0); };
  const open = (type) => (rec) => setModal({ type, rec });
  const close = () => setModal(null);

  const live = (t) => t.rows.filter((x) => !x.deleted_at);
  const src = () => ({
    trademarks: live(d.trademarks), notices: live(d.iprNotices), third: live(d.iprThird),
    docs: live(d.iprDocs).filter((x) => x.kind === "document"), proof: live(d.iprDocs).filter((x) => x.kind === "proof"), matters: live(d.iprMatters),
  });

  return (
    <div className="ipr">
      <div className="ipr-top">
        <div>
          <h2 className="ipr-title">⚖️ Trademark & IPR Management</h2>
          <p className="ipr-sub">Velite marks, third-party client brands, product categories, companies, deadlines, usage proof, Personal Care IPR notifications, documents and attorneys.</p>
        </div>
        <div className="ipr-actions">
          <button className="btn-ghost sm" onClick={() => exportPdf(src())}>PDF Report</button>
          <button className="btn-ghost sm" onClick={() => exportExcel(src())}>Excel Sheet</button>
          {canEdit && <button className="add-btn" onClick={() => open("mark")({})}>Add Trademark</button>}
        </div>
      </div>
      <div className="ipr-nav">
        {VIEWS.map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => go(k)}>{l}</button>)}
      </div>

      {view === "dashboard" && <Dashboard openMark={open("mark")} openNotice={open("notice")} go={go} />}
      {view === "register" && <Register canEdit={canEdit} openMark={open("mark")} />}
      {view === "products" && <Products openMark={open("mark")} />}
      {view === "actions" && <Actions canEdit={canEdit} openMark={open("mark")} openMatter={open("matter")} />}
      {view === "documents" && <Documents canEdit={canEdit} openDoc={open("doc")} />}
      {view === "notifications" && <Notifications canEdit={canEdit} openNotice={open("notice")} />}
      {view === "thirdparty" && <ThirdParty canEdit={canEdit} openThird={open("third")} />}
      {view === "reports" && <Reports />}

      {modal?.type === "mark" && <TrademarkModal t={modal.rec.id ? modal.rec : null} canEdit={canEdit} onClose={close} />}
      {modal?.type === "notice" && <NoticeModal n={modal.rec.id ? modal.rec : null} canEdit={canEdit} onClose={close} />}
      {modal?.type === "third" && <ThirdPartyModal t={modal.rec.id ? modal.rec : null} canEdit={canEdit} onClose={close} />}
      {modal?.type === "doc" && <DocModal x={modal.rec} canEdit={canEdit} onClose={close} />}
      {modal?.type === "matter" && <MatterModal m={modal.rec} canEdit={canEdit} onClose={close} />}
      {!canEdit && <p className="form-hint" style={{ marginTop: 8 }}>You can view everything here. Owners and managers can add or edit records.</p>}
    </div>
  );
}
