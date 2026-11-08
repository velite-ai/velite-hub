import { useMemo, useState } from "react";
import { useData } from "../lib/data";
import { daysUntil, fmtDate } from "../lib/dates";
import { Empty, SearchBox } from "../components/ui";
import { Pill } from "./ipr/shared";
import { STATUS, isOpen, tone, dueBadge, personName, regenerate, exportCsv, applicability } from "./compliance/common";
import ItemModal from "./compliance/ItemModal";
import Licences from "./compliance/Licences";
import Library from "./compliance/Library";
import Firms from "./compliance/Firms";

const VIEWS = [
  ["dash", "📊 Dashboard"], ["due", "📅 Due list"], ["lic", "📜 Licences & certificates"], ["lib", "📚 Compliance library"], ["firms", "🏢 Firm settings", true],
];

export default function Compliance() {
  const d = useData();
  const [view, setView] = useState("dash");
  const [filter, setFilter] = useState({ firm: "all", dept: "all", show: "open", mine: false, q: "" });
  const [open, setOpen] = useState(null);
  const loading = d.cmpItems.loading || d.cmpLib.loading || d.cmpFirms.loading;
  const goDue = (patch) => { setFilter({ firm: "all", dept: "all", show: "open", mine: false, q: "", ...patch }); setView("due"); };
  const openItem = open && d.cmpItems.rows.find((i) => i.id === open);

  return (
    <div className="ipr cmp">
      <div className="ipr-top">
        <div>
          <div className="ipr-title">🛡️ Compliance Tracker</div>
          <div className="ipr-sub">All statutory filings, renewals and checks for Velite Pharmaceuticals, Velite Healthcare, Velite India and Velite Sciences.</div>
        </div>
        {d.isOwner && <button className="btn-ghost" onClick={async () => { await regenerate(); d.cmpItems.reload(); }}>↻ Refresh due dates</button>}
      </div>
      <div className="seg" style={{ marginBottom: 16 }}>
        {VIEWS.filter((v) => !v[2] || d.isOwner).map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {loading ? <div className="loading">Loading…</div> : <>
        {view === "dash" && <Dashboard goDue={goDue} onOpen={setOpen} goView={setView} />}
        {view === "due" && <DueList filter={filter} setFilter={setFilter} onOpen={setOpen} />}
        {view === "lic" && <Licences />}
        {view === "lib" && <Library />}
        {view === "firms" && d.isOwner && <Firms />}
      </>}
      {openItem && <ItemModal item={openItem} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Row({ i, onOpen, showFirm = true }) {
  const { cmpLib, profiles } = useData();
  const lib = cmpLib.rows.find((l) => l.code === i.code);
  const b = dueBadge(i); const st = STATUS[i.status];
  return (
    <div className={`cmp-row ${tone(i)}`} onClick={() => onOpen(i.id)}>
      <span className={`due ${b.cls} cmp-due`}>{b.text}</span>
      {showFirm && <span className="cmp-firm">{i.firm_id}</span>}
      <span className="cmp-title"><b>{lib?.title || i.code}</b> <span className="small-muted">· {i.period_label}</span>
        <span className="small-muted cmp-dept"> · {lib?.dept}</span></span>
      <span className="small-muted cmp-who">{personName(profiles, i.owner_id) || "—"}</span>
      <Pill tone={st.tone}>{st.label}</Pill>
    </div>
  );
}

function Dashboard({ goDue, onOpen, goView }) {
  const d = useData();
  const items = d.cmpItems.rows.filter((i) => !i.deleted_at);
  const open = items.filter(isOpen);
  const over = open.filter((i) => daysUntil(i.due_date) < 0);
  const wk = open.filter((i) => { const n = daysUntil(i.due_date); return n >= 0 && n <= 7; });
  const mo = open.filter((i) => { const n = daysUntil(i.due_date); return n >= 0 && n <= 30; });
  const toCheck = items.filter((i) => i.status === "filed");
  const depts = [...new Set(d.cmpLib.rows.map((l) => l.dept))];
  const deptOf = (code) => d.cmpLib.rows.find((l) => l.code === code)?.dept;
  const firms = d.cmpFirms.rows;

  // licence-type obligations with nothing in the register = blind spots
  const missing = [];
  for (const f of firms) for (const l of d.cmpLib.rows.filter((x) => x.rule?.t === "licence" && x.active)) {
    if (!applicability(f, l, d.cmpAssign.rows).applies) continue;
    if (!d.cmpLic.rows.some((x) => !x.deleted_at && x.firm_id === f.id && x.code === l.code)) missing.push({ f, l });
  }
  const unassigned = open.filter((i) => !i.owner_id && daysUntil(i.due_date) <= 30).length;
  const assumed = firms.filter((f) => !f.flags?.confirmed);

  return (
    <>
      {d.isOwner && assumed.length > 0 && (
        <div className="cmp-alert">⚠️ Firm settings for <b>{assumed.map((f) => f.id).join(", ")}</b> are not yet confirmed. Please check them in <button className="link-btn strong" onClick={() => goView("firms")}>Firm settings</button> so only the right compliances appear.</div>
      )}
      <div className="icards">
        <div className="metric cmp-click" onClick={() => goDue({ show: "overdue" })}><span>Overdue</span><strong className={over.length ? "due-over" : ""}>{over.length}</strong><small>past the due date</small></div>
        <div className="metric cmp-click" onClick={() => goDue({ show: "7" })}><span>Due in 7 days</span><strong>{wk.length}</strong><small>act now</small></div>
        <div className="metric cmp-click" onClick={() => goDue({ show: "30" })}><span>Due in 30 days</span><strong>{mo.length}</strong><small>{unassigned} without a responsible person</small></div>
        <div className="metric cmp-click" onClick={() => goDue({ show: "filed" })}><span>Filed – to check</span><strong>{toCheck.length}</strong><small>waiting for checker</small></div>
      </div>

      <div className="ipanel">
        <div className="ipanel-head"><div><h3>Health by firm and department</h3><p>Red = something overdue · Amber = due within 7 days · number = open items due in the next 30 days. Click a box to see them.</p></div></div>
        <div className="table-wrap">
          <table className="tbl cmp-grid">
            <thead><tr><th>Department</th>{firms.map((f) => <th key={f.id} title={f.name}>{f.id}</th>)}</tr></thead>
            <tbody>{depts.map((dep) => (
              <tr key={dep}><td>{dep}</td>{firms.map((f) => {
                const mine = open.filter((i) => i.firm_id === f.id && deptOf(i.code) === dep);
                const o = mine.filter((i) => daysUntil(i.due_date) < 0).length;
                const a = mine.filter((i) => { const n = daysUntil(i.due_date); return n >= 0 && n <= 7; }).length;
                const m = mine.filter((i) => daysUntil(i.due_date) <= 30).length;
                const any = d.cmpLib.rows.some((l) => l.dept === dep && applicability(f, l, d.cmpAssign.rows).applies);
                return <td key={f.id}>{any ? <button className={`cmp-cell ${o ? "red" : a ? "amber" : "green"}`} onClick={() => goDue({ firm: f.id, dept: dep, show: o ? "overdue" : "30" })}>{o ? `${o} late` : m || "✓"}</button> : <span className="small-muted">—</span>}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="ipanel">
          <div className="ipanel-head"><div><h3>Next up</h3><p>Overdue first, then by due date.</p></div><button className="link-btn strong" onClick={() => goDue({})}>All →</button></div>
          {open.length === 0 ? <Empty>Nothing open. 🎉</Empty> : open.slice(0, 14).map((i) => <Row key={i.id} i={i} onOpen={onOpen} />)}
        </div>
        <div className="ipanel">
          <div className="ipanel-head"><div><h3>Licences not yet in the register</h3><p>These renewals cannot be reminded until you enter the licence and its next due date.</p></div>
            <button className="link-btn strong" onClick={() => goView("lic")}>Add →</button></div>
          {missing.length === 0 ? <Empty>All licence renewals are tracked.</Empty> : missing.map(({ f, l }) => (
            <div key={f.id + l.code} className="side-item flex-between"><span><b>{f.id}</b> · {l.title}</span><Pill tone={l.risk === "H" ? "red" : "amber"}>{l.risk === "H" ? "High risk" : "Medium"}</Pill></div>
          ))}
        </div>
      </div>
    </>
  );
}

function DueList({ filter, setFilter, onOpen }) {
  const d = useData();
  const set = (k, v) => setFilter({ ...filter, [k]: v });
  const depts = [...new Set(d.cmpLib.rows.map((l) => l.dept))];
  const libBy = useMemo(() => Object.fromEntries(d.cmpLib.rows.map((l) => [l.code, l])), [d.cmpLib.rows]);
  const q = filter.q.trim().toLowerCase();
  const rows = d.cmpItems.rows.filter((i) => {
    if (i.deleted_at) return false;
    if (filter.firm !== "all" && i.firm_id !== filter.firm) return false;
    if (filter.dept !== "all" && libBy[i.code]?.dept !== filter.dept) return false;
    if (filter.mine && i.owner_id !== d.me.id && i.checker_id !== d.me.id) return false;
    const n = daysUntil(i.due_date);
    switch (filter.show) {
      case "open": if (!isOpen(i)) return false; break;
      case "overdue": if (!isOpen(i) || n >= 0) return false; break;
      case "7": if (!isOpen(i) || n > 7) return false; break;
      case "30": if (!isOpen(i) || n > 30) return false; break;
      case "filed": if (i.status !== "filed") return false; break;
      case "done": if (!["filed", "verified", "na"].includes(i.status)) return false; break;
      default: break;
    }
    if (q) { const l = libBy[i.code]; if (!`${l?.title} ${l?.dept} ${l?.form} ${i.period_label} ${i.code} ${i.ref_no || ""}`.toLowerCase().includes(q)) return false; }
    return true;
  });
  const groups = {};
  for (const i of rows) { const k = i.due_date.slice(0, 7); (groups[k] = groups[k] || []).push(i); }

  const csv = () => exportCsv([["Firm", "Department", "Compliance", "Period", "Due date", "Status", "Responsible", "Checker", "Filed on", "Reference", "Proof link", "Law", "Form", "Portal"],
    ...rows.map((i) => { const l = libBy[i.code] || {}; return [i.firm_id, l.dept, l.title, i.period_label, i.due_date, STATUS[i.status].label, personName(d.profiles, i.owner_id), personName(d.profiles, i.checker_id), i.filed_on, i.ref_no, i.proof_link, l.law, l.form, l.portal]; })],
    `velite-compliance-${new Date().toISOString().slice(0, 10)}.csv`);

  return (
    <div className="ipanel">
      <div className="filter-bar" style={{ marginBottom: 10 }}>
        <select className="inp inp-filter" value={filter.firm} onChange={(e) => set("firm", e.target.value)}>
          <option value="all">All firms</option>{d.cmpFirms.rows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select className="inp inp-filter" value={filter.dept} onChange={(e) => set("dept", e.target.value)}>
          <option value="all">All departments</option>{depts.map((x) => <option key={x}>{x}</option>)}</select>
        <select className="inp inp-filter" value={filter.show} onChange={(e) => set("show", e.target.value)}>
          <option value="open">Open (not done)</option><option value="overdue">Overdue</option><option value="7">Due in 7 days</option>
          <option value="30">Due in 30 days</option><option value="filed">Filed – to check</option><option value="done">Done</option><option value="all">Everything</option></select>
        <button className={`filter-btn ${filter.mine ? "active" : ""}`} onClick={() => set("mine", !filter.mine)}>Only mine</button>
        <SearchBox value={filter.q} onChange={(v) => set("q", v)} placeholder="Search e.g. GSTR, PF, licence…" />
        <button className="btn-ghost" onClick={csv}>⬇ Excel (CSV)</button>
      </div>
      <div className="small-muted" style={{ marginBottom: 8 }}>{rows.length} item{rows.length === 1 ? "" : "s"}</div>
      {rows.length === 0 && <Empty>Nothing matches.</Empty>}
      {Object.entries(groups).map(([k, list]) => (
        <div key={k} className="cmp-month">
          <div className="day-block-title">{fmtDate(k + "-01").replace(/^\d+ /, "")}</div>
          {list.map((i) => <Row key={i.id} i={i} onOpen={onOpen} />)}
        </div>
      ))}
    </div>
  );
}
