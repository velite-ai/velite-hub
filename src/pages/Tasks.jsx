import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { DEPARTMENTS, PRIORITIES, STATUSES, P_COLOR, S_COLOR } from "../lib/constants";
import { fmtDateTime, fmtDate, dueLabel, daysUntil, todayISO, timeAgo } from "../lib/dates";
import Comments, { commentCount } from "../components/Comments";
import { Modal, Field, Empty, SearchBox, Collapse, useConfirm } from "../components/ui";
import { uploadProof, openProof, FIRM_COLORS } from "./compliance/common";

const FIRMS = ["VP", "VH", "VI", "VS"];
const REPEATS = [["", "Does not repeat"], ["daily", "Every day"], ["weekly", "Every week"], ["monthly", "Every month"], ["quarterly", "Every 3 months"], ["yearly", "Every year"]];
const PRI = { High: 0, Medium: 1, Low: 2 };

// ── helpers shared with My Day ───────────────────────────────────────
const sameName = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
export function isMine(t, me) {
  if (t.assignee_id) return t.assignee_id === me.id;
  return !!t.assignee_name && sameName(t.assignee_name, me.full_name);
}
export const isHelper = (t, me) => (t.helper_ids || []).includes(me.id);
export const canClose = (t, me, isOwner) => isOwner || isMine(t, me) || t.created_by === me.id;
export function byDue(a, b) {
  const da = a.due_date || "9999-12-31", db = b.due_date || "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  if (PRI[a.priority] !== PRI[b.priority]) return PRI[a.priority] - PRI[b.priority];
  return a.created_at < b.created_at ? 1 : -1;
}
const AV_COLORS = ["#2563eb", "#db2777", "#ea580c", "#16a34a", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#0f766e"];
const avColor = (name) => AV_COLORS[[...(name || "?")].reduce((n, c) => n + c.charCodeAt(0), 0) % AV_COLORS.length];
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export function Avatar({ name, size = 26, title }) {
  return <span className="av" title={title || name} style={{ background: avColor(name), width: size, height: size, fontSize: size * 0.42 }}>{initials(name)}</span>;
}
const shareText = (t) => encodeURIComponent(`*Task:* ${t.title}\n*For:* ${t.assignee_name || "—"}\n*Priority:* ${t.priority}${t.due_date ? `\n*Due:* ${fmtDate(t.due_date)}` : ""}${t.description ? `\n\n${t.description}` : ""}\n\nOpen: https://hub.velite.in/#tasks/${t.id}`);
const checkProgress = (t) => { const c = t.checklist || []; return c.length ? { done: c.filter((x) => x.done).length, all: c.length } : null; };

// Status change with a "what was done?" note when closing
export function useTaskStatus(reload) {
  const [closing, setClosing] = useState(null);
  const apply = async (t, status, note) => {
    const row = { status }; if (status === "Done") row.done_note = note || null;
    const r = await run(supabase.from("hub_tasks").update(row).eq("id", t.id), status === "Done" ? "Task completed ✅" : null);
    if (r.ok) reload();
  };
  const setStatus = (t, status) => (status === "Done" ? setClosing(t) : apply(t, status));
  const dialog = closing && <DoneModal t={closing} onClose={() => setClosing(null)} onDone={(note) => { apply(closing, "Done", note); setClosing(null); }} />;
  return [setStatus, dialog];
}
function DoneModal({ t, onClose, onDone }) {
  const [note, setNote] = useState("");
  const pending = (t.checklist || []).filter((x) => !x.done).length;
  return (
    <Modal title="✅ Mark as done" onClose={onClose} actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn-primary" onClick={() => (note.trim() ? onDone(note.trim()) : toast("Write one line on what was done.", "err"))}>Mark done</button></>}>
      <p className="modal-text"><b>{t.title}</b></p>
      {pending > 0 && <div className="cmp-alert" style={{ marginBottom: 10 }}>{pending} checklist step{pending === 1 ? " is" : "s are"} still not ticked.</div>}
      <Field label="What was done? (one line)" hint="For example: Collected all 3 approvals, kept in QA file."><input className="form-inp" autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && note.trim() && onDone(note.trim())} /></Field>
    </Modal>
  );
}

// ── Main page ────────────────────────────────────────────────────────
export default function Tasks() {
  const { tasks, me, isOwner, profiles } = useData();
  const [view, setView] = useState("list");
  const [quick, setQuick] = useState("active");
  const [person, setPerson] = useState("");
  const [firm, setFirm] = useState("");
  const [dept, setDept] = useState("");
  const [pri, setPri] = useState("");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [ask, confirmDialog] = useConfirm();
  const [setStatus, doneDialog] = useTaskStatus(tasks.reload);

  // open a task from a link: #tasks/<id>
  useEffect(() => {
    const fromHash = () => { const id = window.location.hash.split("/")[1]; if (id) setDetail(id); };
    fromHash(); window.addEventListener("hashchange", fromHash); return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const closeDetail = () => { setDetail(null); if (window.location.hash.includes("/")) window.history.replaceState(null, "", "#tasks"); };

  const live = tasks.rows.filter((t) => !t.deleted_at);
  const active = live.filter((t) => t.status !== "Done");
  const done = live.filter((t) => t.status === "Done").sort((a, b) => ((a.completed_at || "") < (b.completed_at || "") ? 1 : -1));
  const late = (t) => t.due_date && daysUntil(t.due_date) < 0;

  const filt = (list) => {
    let r = list;
    if (quick === "mine") r = r.filter((t) => isMine(t, me) || isHelper(t, me));
    if (quick === "given") r = r.filter((t) => t.created_by === me.id && !isMine(t, me));
    if (quick === "overdue") r = r.filter(late);
    if (quick === "Waiting") r = r.filter((t) => t.status === "Waiting");
    if (person) r = r.filter((t) => t.assignee_id === person || (t.helper_ids || []).includes(person));
    if (firm) r = r.filter((t) => t.firm_id === firm);
    if (dept) r = r.filter((t) => t.department === dept);
    if (pri) r = r.filter((t) => t.priority === pri);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((t) => [t.title, t.description, t.assignee_name, t.department, t.created_by_name].join(" ").toLowerCase().includes(s));
    return [...r].sort(byDue);
  };
  const shown = useMemo(() => filt(active), [active, quick, person, firm, dept, pri, q, me]); // eslint-disable-line
  const shownDone = useMemo(() => filt(done), [done, quick, person, firm, dept, pri, q, me]); // eslint-disable-line

  const counts = {
    active: active.length, mine: active.filter((t) => isMine(t, me) || isHelper(t, me)).length,
    given: active.filter((t) => t.created_by === me.id && !isMine(t, me)).length, overdue: active.filter(late).length,
    Waiting: active.filter((t) => t.status === "Waiting").length,
  };
  const people = profiles.rows.filter((p) => p.status === "approved");

  const del = async (t) => {
    const ok = await ask({ title: "Delete this task?", body: `"${t.title}" will go to the recycle bin. An owner can restore it within 30 days.`, okText: "Delete", danger: true });
    if (!ok) return;
    const r = await run(supabase.from("hub_tasks").update({ deleted_at: new Date().toISOString() }).eq("id", t.id), "Moved to recycle bin");
    if (r.ok) tasks.reload();
  };
  const cardProps = (t) => ({ t, onStatus: (s) => setStatus(t, s), onOpen: () => setDetail(t.id), onEdit: () => setModal(t), onDelete: () => del(t) });
  const openTask = live.find((t) => t.id === detail) || (detail && tasks.rows.find((t) => t.id === detail));

  const groups = [
    ["🔴 Overdue", shown.filter(late), "over"],
    ["🟠 Today", shown.filter((t) => t.due_date && daysUntil(t.due_date) === 0), "today"],
    ["🟡 Next 7 days", shown.filter((t) => t.due_date && daysUntil(t.due_date) > 0 && daysUntil(t.due_date) <= 7), "week"],
    ["🔵 Later", shown.filter((t) => t.due_date && daysUntil(t.due_date) > 7), "later"],
    ["⚪ No date", shown.filter((t) => !t.due_date), "nodate"],
  ];

  return (
    <div className="section tk">
      <div className="tk-hero">
        <div>
          <div className="tk-hero-title">✅ Task Manager</div>
          <div className="tk-hero-sub">{counts.active} open · <b>{counts.overdue} overdue</b> · {counts.mine} with me · {done.filter((t) => (t.completed_at || "").slice(0, 7) === todayISO().slice(0, 7)).length} done this month</div>
        </div>
        <button className="tk-add" onClick={() => setModal({})}>＋ New task</button>
      </div>

      <div className="tk-views">
        {[["list", "📋 List"], ["board", "🗂️ Board"], ...(isOwner ? [["team", "👥 Team"]] : [])].map(([k, l]) => (
          <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>

      {view === "team" && isOwner ? (
        <Team people={people} live={live} onPick={(id) => { setPerson(id); setQuick("active"); setView("list"); }} onOpen={(id) => setDetail(id)} />
      ) : (
        <>
          <div className="filter-bar">
            {[["active", "All open"], ["mine", "With me"], ["given", "Given by me"], ["overdue", "Overdue"], ["Waiting", "Waiting"]].map(([k, l]) => (
              <button key={k} className={`filter-btn ${quick === k ? "active" : ""} ${k === "overdue" && counts[k] ? "warn" : ""}`} onClick={() => setQuick(k)}>
                {l}<span className="fcount">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div className="filter-bar tk-filters">
            {isOwner && <select className="inp inp-filter" value={person} onChange={(e) => setPerson(e.target.value)}><option value="">All people</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}
            <select className="inp inp-filter" value={firm} onChange={(e) => setFirm(e.target.value)}><option value="">All firms</option>{FIRMS.map((f) => <option key={f}>{f}</option>)}</select>
            <select className="inp inp-filter" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select>
            <select className="inp inp-filter" value={pri} onChange={(e) => setPri(e.target.value)}><option value="">All priorities</option>{PRIORITIES.map((d) => <option key={d}>{d}</option>)}</select>
            <div style={{ flex: 1 }} />
            <SearchBox value={q} onChange={setQ} placeholder="Search tasks…" />
          </div>

          {view === "list" && (
            <div className="task-cards-area">
              {shown.length === 0 && <Empty>No open tasks match this filter.</Empty>}
              {groups.map(([label, list, cls]) => list.length > 0 && (
                <div key={cls} className={`tk-group ${cls}`}>
                  <div className="tk-group-h">{label} <span>{list.length}</span></div>
                  {list.map((t) => <TaskCard key={t.id} {...cardProps(t)} />)}
                </div>
              ))}
            </div>
          )}
          {view === "board" && <Board list={shown} done={shownDone.slice(0, 25)} cardProps={cardProps} onStatus={setStatus} />}

          {view === "list" && shownDone.length > 0 && (
            <div className="archive-wrap">
              <Collapse label="✅ Completed tasks" badge={shownDone.length}>
                {shownDone.slice(0, 150).map((t) => <TaskCard key={t.id} archived {...cardProps(t)} />)}
              </Collapse>
            </div>
          )}
        </>
      )}

      {modal && <TaskModal task={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={tasks.reload} />}
      {openTask && <TaskDetail t={openTask} onClose={closeDetail} onEdit={() => { setModal(openTask); closeDetail(); }} onStatus={(s) => setStatus(openTask, s)} />}
      {confirmDialog}{doneDialog}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────
export function TaskCard({ t, archived, onStatus, onOpen, onEdit, onDelete, compact, draggable }) {
  const { me, isOwner, comments, profiles, goals } = useData();
  const due = !archived && t.due_date ? dueLabel(t.due_date) : null;
  const cp = checkProgress(t);
  const nC = commentCount(comments, "task", t.id);
  const helpers = (t.helper_ids || []).map((id) => profiles.rows.find((p) => p.id === id)?.full_name).filter(Boolean);
  const statuses = canClose(t, me, isOwner) ? STATUSES : STATUSES.filter((s) => s !== "Done");
  const stop = (e) => e.stopPropagation();
  return (
    <div className={`task-card tk-card pri-${t.priority} ${archived ? "archived" : ""} ${due?.cls === "due-over" ? "is-overdue" : ""}`}
      onClick={onOpen} draggable={draggable} onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)}>
      <div className="task-card-head">
        <div className={archived ? "archive-task-title" : "task-title"}>
          {t.firm_id && <span className="tk-firm" style={{ background: FIRM_COLORS[t.firm_id] }}>{t.firm_id}</span>}
          {t.title}
          {t.repeat && <span className="tk-mini" title="Repeats">🔁</span>}
          {t.private && <span className="tk-mini" title="Private — only you can see it">🔒</span>}
          {t.goal_id && isOwner && <span className="tk-goal" title="Part of a Business Compass goal">🎯 {goals.rows.find((g) => g.id === t.goal_id)?.title || "Goal"}</span>}
        </div>
        <div className="todo-actions" onClick={stop}>
          {archived
            ? (canClose(t, me, isOwner) && <button className="restore-btn" onClick={() => onStatus("To-Do")}>↩ Reopen</button>)
            : <select className="task-status-sel" value={t.status} onChange={(e) => onStatus(e.target.value)} style={{ borderColor: S_COLOR[t.status], color: S_COLOR[t.status] }}>
                {statuses.map((s) => <option key={s}>{s}</option>)}
              </select>}
          {!compact && onEdit && <button className="icon-btn edit" title="Edit" onClick={onEdit}>✎</button>}
          {!compact && onDelete && (isOwner || t.created_by === me.id) && <button className="icon-btn" title="Delete" onClick={onDelete}>🗑</button>}
        </div>
      </div>
      {t.description && !compact && <div className="task-body tk-desc">{t.description}</div>}
      <div className="task-footer">
        <span className="tk-who">
          <Avatar name={t.assignee_name || "?"} size={22} />{t.assignee_name || "No one"}
          {helpers.length > 0 && <span className="tk-helpers">{helpers.slice(0, 3).map((n) => <Avatar key={n} name={n} size={18} title={`Helper: ${n}`} />)}{helpers.length > 3 && <small>+{helpers.length - 3}</small>}</span>}
        </span>
        <span className="tk-pri" style={{ color: P_COLOR[t.priority] }}>● {t.priority}</span>
        {due && <span className={`due ${due.cls}`}>📅 {due.text}</span>}
        {t.department && !compact && <span className="tk-dept">{t.department}</span>}
        {cp && <span className="tk-chk" title="Checklist">☑ {cp.done}/{cp.all}</span>}
        {(t.files || []).length > 0 && <span className="tk-mini">📎 {t.files.length}</span>}
        {nC > 0 && <span className="tk-mini">💬 {nC}</span>}
        {!archived && t.assignee_id && t.assignee_id !== me.id && <span className={`tk-seen ${t.seen_at ? "yes" : ""}`} title={t.seen_at ? `Seen ${fmtDateTime(t.seen_at)}` : "Not opened yet"}>{t.seen_at ? "✓✓ Seen" : "✓ Sent"}</span>}
      </div>
      {archived && t.done_note && <div className="tk-done-note">✅ {t.done_note} <small>— {t.completed_by_name}, {fmtDateTime(t.completed_at)}</small></div>}
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────
function Board({ list, done, cardProps, onStatus }) {
  const { tasks } = useData();
  const [over, setOver] = useState(null);
  const cols = [...STATUSES.filter((s) => s !== "Done").map((s) => [s, list.filter((t) => t.status === s)]), ["Done", done]];
  const drop = (e, s) => {
    e.preventDefault(); setOver(null);
    const t = tasks.rows.find((x) => x.id === e.dataTransfer.getData("text/task"));
    if (t && t.status !== s) onStatus(t, s);
  };
  return (
    <div className="tk-board">
      {cols.map(([s, items]) => (
        <div key={s} className={`tk-col ${over === s ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, s)}>
          <div className="tk-col-h" style={{ borderTopColor: S_COLOR[s] }}>{s} <span>{items.length}</span></div>
          {items.length === 0 && <div className="tk-col-empty">Drag a task here</div>}
          {items.map((t) => <TaskCard key={t.id} {...cardProps(t)} archived={s === "Done"} compact draggable />)}
        </div>
      ))}
    </div>
  );
}

// ── Team (owners) ────────────────────────────────────────────────────
function Team({ people, live, onPick, onOpen }) {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [report, setReport] = useState(false);
  const stats = people.map((p) => {
    const mine = live.filter((t) => t.assignee_id === p.id);
    const open = mine.filter((t) => t.status !== "Done");
    const doneM = mine.filter((t) => t.status === "Done" && (t.completed_at || "").slice(0, 7) === month);
    const doneDated = mine.filter((t) => t.status === "Done" && t.due_date && t.completed_at && new Date(t.completed_at) > new Date(Date.now() - 90 * 86400000));
    const onTime = doneDated.filter((t) => t.completed_at.slice(0, 10) <= t.due_date).length;
    return {
      p, open, helper: live.filter((t) => t.status !== "Done" && (t.helper_ids || []).includes(p.id)).length,
      late: open.filter((t) => t.due_date && daysUntil(t.due_date) < 0), week: open.filter((t) => t.due_date && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 7).length,
      waiting: open.filter((t) => t.status === "Waiting").length, doneM: doneM.length,
      onTimePct: doneDated.length ? Math.round((100 * onTime) / doneDated.length) : null,
      givenM: mine.filter((t) => (t.created_at || "").slice(0, 7) === month).length,
      lateDoneM: doneM.filter((t) => t.due_date && t.completed_at.slice(0, 10) > t.due_date).length,
    };
  }).sort((a, b) => b.late.length - a.late.length || b.open.length - a.open.length);
  const maxOpen = Math.max(1, ...stats.map((s) => s.open.length));
  const unassigned = live.filter((t) => t.status !== "Done" && !t.assignee_id).length;

  return (
    <>
      <div className="tk-team-bar">
        <span>Showing work for</span>
        <input className="inp" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} />
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={() => setReport(true)}>📄 Monthly report</button>
      </div>
      {unassigned > 0 && <div className="cmp-alert" style={{ marginBottom: 12 }}>⚠️ {unassigned} open task{unassigned === 1 ? " has" : "s have"} no one assigned.</div>}
      <div className="tk-team">
        {stats.map((s) => (
          <div key={s.p.id} className={`tk-person ${s.late.length ? "has-late" : ""}`}>
            <div className="tk-person-top" onClick={() => onPick(s.p.id)}>
              <Avatar name={s.p.full_name} size={42} />
              <div><div className="tk-person-name">{s.p.full_name}</div><div className="small-muted">{s.p.role}{s.p.departments?.length ? ` · ${s.p.departments.join(", ")}` : ""}</div></div>
            </div>
            <div className="tk-load" title="Open tasks compared with the busiest person"><i style={{ width: `${(100 * s.open.length) / maxOpen}%`, background: s.late.length ? "#dc2626" : s.open.length / maxOpen > 0.7 ? "#f59e0b" : "#16a34a" }} /></div>
            <div className="tk-stats">
              <div><b>{s.open.length}</b><span>Open</span></div>
              <div className={s.late.length ? "red" : ""}><b>{s.late.length}</b><span>Overdue</span></div>
              <div><b>{s.week}</b><span>Due 7 days</span></div>
              <div className="green"><b>{s.doneM}</b><span>Done in month</span></div>
              <div><b>{s.onTimePct === null ? "–" : `${s.onTimePct}%`}</b><span>On time*</span></div>
            </div>
            <div className="tk-person-foot">
              {s.helper > 0 && <span>🤝 Helping on {s.helper}</span>}
              {s.waiting > 0 && <span>⏳ {s.waiting} waiting</span>}
            </div>
            {s.late.slice(0, 3).map((t) => <div key={t.id} className="tk-late-line" onClick={() => onOpen(t.id)}>🔴 {t.title} <small>{dueLabel(t.due_date).text}</small></div>)}
            <button className="link-btn" onClick={() => onPick(s.p.id)}>See all tasks →</button>
          </div>
        ))}
      </div>
      <div className="small-muted" style={{ marginTop: 8 }}>* On time = tasks with a due date finished on or before it, in the last 90 days.</div>
      {report && (
        <Modal wide title={`Monthly task report — ${new Date(month + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" })}`} onClose={() => setReport(false)}
          actions={<><button className="btn-ghost" onClick={() => setReport(false)}>Close</button><button className="btn-primary" onClick={() => window.print()}>🖨️ Print</button></>}>
          <div className="tk-report">
            <table className="tbl">
              <thead><tr><th>Person</th><th>New tasks given</th><th>Done</th><th>Done late</th><th>Open now</th><th>Overdue now</th><th>On time (90 days)</th></tr></thead>
              <tbody>{stats.map((s) => <tr key={s.p.id}><td><b>{s.p.full_name}</b></td><td>{s.givenM}</td><td>{s.doneM}</td><td className={s.lateDoneM ? "chk-red" : ""}>{s.lateDoneM}</td><td>{s.open.length}</td><td className={s.late.length ? "chk-red" : ""}>{s.late.length}</td><td>{s.onTimePct === null ? "–" : `${s.onTimePct}%`}</td></tr>)}</tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Detail window ────────────────────────────────────────────────────
function TaskDetail({ t, onClose, onEdit, onStatus }) {
  const { me, isOwner, profiles, tasks } = useData();
  const [hist, setHist] = useState([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const helpers = (t.helper_ids || []).map((id) => profiles.rows.find((p) => p.id === id)?.full_name).filter(Boolean);
  const may = isOwner || isMine(t, me) || isHelper(t, me) || t.created_by === me.id;
  const due = t.due_date && t.status !== "Done" ? dueLabel(t.due_date) : null;

  useEffect(() => {
    if (t.assignee_id === me.id && !t.seen_at) supabase.rpc("hub_task_seen", { p_id: t.id }).then(() => tasks.reload());
    supabase.from("hub_activity").select("at,actor_name,action").eq("entity_id", t.id).order("at").then(({ data }) => setHist(data || []));
  }, [t.id]); // eslint-disable-line

  const saveField = async (patch, msg) => { const r = await run(supabase.from("hub_tasks").update(patch).eq("id", t.id), msg); if (r.ok) tasks.reload(); };
  const toggle = (i) => saveField({ checklist: t.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) });
  const addStep = () => { if (!step.trim()) return; saveField({ checklist: [...(t.checklist || []), { text: step.trim(), done: false }] }); setStep(""); };
  const upload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); const r = await uploadProof(file, `tasks/${t.id}`); setBusy(false);
    if (r) saveField({ files: [...(t.files || []), { path: r.path, name: r.name, by: me.full_name, at: new Date().toISOString() }] }, "File attached");
  };
  const removeFile = (i) => window.confirm("Remove this file from the task?") && saveField({ files: t.files.filter((_, j) => j !== i) });
  const cp = checkProgress(t);
  const statuses = canClose(t, me, isOwner) ? STATUSES : STATUSES.filter((s) => s !== "Done");

  return (
    <Modal wide title={null} onClose={onClose}>
      <div className={`tk-detail pri-${t.priority}`}>
        <div className="tk-d-head">
          <div>
            <div className="tk-d-title">{t.firm_id && <span className="tk-firm" style={{ background: FIRM_COLORS[t.firm_id] }}>{t.firm_id}</span>}{t.title}</div>
            <div className="tk-d-tags">
              <span className="tk-pri" style={{ color: P_COLOR[t.priority] }}>● {t.priority}{t.escalated_at ? " (raised: 3 days late)" : ""}</span>
              {due && <span className={`due ${due.cls}`}>📅 {due.text}</span>}
              {t.department && <span className="tk-dept">{t.department}</span>}
              {t.repeat && <span className="tk-dept">🔁 {REPEATS.find((r) => r[0] === t.repeat)?.[1]}</span>}
            </div>
          </div>
          {t.status === "Done"
            ? <span className="tk-status-big" style={{ background: S_COLOR.Done }}>✅ Done</span>
            : <select className="task-status-sel big" value={t.status} onChange={(e) => onStatus(e.target.value)} style={{ borderColor: S_COLOR[t.status], color: S_COLOR[t.status] }}>{statuses.map((s) => <option key={s}>{s}</option>)}</select>}
        </div>

        <div className="tk-d-people">
          <div><label>Main person</label><span><Avatar name={t.assignee_name || "?"} /> {t.assignee_name || "No one"} {t.assignee_id && <small className={`tk-seen ${t.seen_at ? "yes" : ""}`}>{t.seen_at ? `✓✓ Seen ${timeAgo(t.seen_at)}` : "✓ Not opened yet"}</small>}</span></div>
          {helpers.length > 0 && <div><label>Helpers</label><span>{helpers.map((n) => <span key={n} className="tk-chip"><Avatar name={n} size={18} /> {n}</span>)}</span></div>}
          <div><label>Given by</label><span>{t.created_by_name || "—"} · {fmtDateTime(t.created_at)}</span></div>
        </div>

        {t.description && <div className="tk-d-desc">{t.description}</div>}
        {t.status === "Done" && <div className="tk-done-note big">✅ {t.done_note || "Done"} <small>— {t.completed_by_name}, {fmtDateTime(t.completed_at)}</small></div>}

        <div className="tk-d-grid">
          <div className="tk-d-box">
            <div className="tk-d-box-h">☑ Checklist {cp && <span>{cp.done}/{cp.all}</span>}</div>
            {cp && <div className="chk-bar" style={{ marginBottom: 8 }}><i style={{ width: `${(100 * cp.done) / cp.all}%`, background: "#16a34a" }} /></div>}
            {(t.checklist || []).map((x, i) => (
              <label key={i} className={`tk-step ${x.done ? "done" : ""}`}><input type="checkbox" checked={!!x.done} disabled={!may} onChange={() => toggle(i)} /> {x.text}</label>
            ))}
            {may && <div className="tk-step-add"><input className="inp" placeholder="Add a step…" value={step} onChange={(e) => setStep(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStep()} /><button className="btn-ghost" onClick={addStep}>Add</button></div>}
          </div>
          <div className="tk-d-box">
            <div className="tk-d-box-h">📎 Files {(t.files || []).length > 0 && <span>{t.files.length}</span>}</div>
            {(t.files || []).map((f, i) => (
              <div key={i} className="tk-file"><button className="link-btn" onClick={() => openProof(f.path)}>📄 {f.name}</button><small>{f.by}</small>{(isOwner || f.by === me.full_name) && <button className="link-btn doc-del" onClick={() => removeFile(i)}>✕</button>}</div>
            ))}
            {may && <label className="tk-upload">{busy ? "Uploading…" : "＋ Attach a file (max 15 MB)"}<input type="file" hidden onChange={upload} disabled={busy} /></label>}
          </div>
        </div>

        <div className="tk-d-box">
          <div className="tk-d-box-h">🕒 History</div>
          <div className="tk-hist">
            {hist.map((h, i) => <div key={i}><span>{fmtDateTime(h.at)}</span> <b>{h.actor_name}</b> {h.action === "created" ? "created the task" : h.action.startsWith("status: ") ? `changed status to ${h.action.slice(8)}` : h.action === "edited" ? "edited the task" : h.action}</div>)}
            {t.seen_at && <div><span>{fmtDateTime(t.seen_at)}</span> <b>{t.assignee_name}</b> opened the task</div>}
            {hist.length === 0 && <div className="small-muted">No changes yet.</div>}
          </div>
        </div>

        <div className="tk-d-box"><div className="tk-d-box-h">💬 Comments</div><Comments type="task" id={t.id} /></div>

        <div className="tk-d-actions">
          <a className="tk-wa" href={`https://wa.me/?text=${shareText(t)}`} target="_blank" rel="noreferrer">🟢 Share on WhatsApp</a>
          <div style={{ flex: 1 }} />
          {(isOwner || t.created_by === me.id || isMine(t, me)) && <button className="btn-ghost" onClick={onEdit}>✎ Edit</button>}
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Add / edit ───────────────────────────────────────────────────────
export function TaskModal({ task, onClose, onSaved, preset }) {
  const { profiles, me } = useData();
  const people = profiles.rows.filter((p) => p.status === "approved");
  const [f, setF] = useState(() => ({
    title: task?.title || preset?.title || "", description: task?.description || "",
    assignee: task?.assignee_id || (task?.assignee_name ? `name:${task.assignee_name}` : "") || preset?.assignee || "",
    helpers: task?.helper_ids || [], copies: false,
    department: task?.department || DEPARTMENTS[0], priority: task?.priority || "Medium",
    status: task?.status || "To-Do", due_date: task?.due_date || preset?.due_date || "", firm_id: task?.firm_id || preset?.firm_id || "",
    repeat: task?.repeat || "", checklist: (task?.checklist || []).map((x) => x.text).join("\n"),
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const legacyName = task && !task.assignee_id && task.assignee_name;
  const toggleHelper = (id) => setF((x) => ({ ...x, helpers: x.helpers.includes(id) ? x.helpers.filter((h) => h !== id) : [...x.helpers, id] }));

  const save = async () => {
    if (!f.title.trim()) { toast("Write a title.", "err"); return; }
    if (!f.assignee) { toast("Choose the main person.", "err"); return; }
    const isId = !f.assignee.startsWith("name:");
    const person = isId ? people.find((p) => p.id === f.assignee) : null;
    const old = task?.checklist || [];
    const checklist = f.checklist.split("\n").map((s) => s.trim()).filter(Boolean).map((text) => ({ text, done: !!old.find((o) => o.text === text)?.done }));
    const base = {
      title: f.title.trim(), description: f.description, department: f.department, priority: f.priority,
      status: f.status, due_date: f.due_date || null, firm_id: f.firm_id || null, repeat: f.repeat || null, checklist,
      ...(preset?.goal_id && !task ? { goal_id: preset.goal_id, milestone_id: preset.milestone_id || null } : {}),
    };
    setBusy(true);
    let r;
    if (!task && f.copies && isId && f.helpers.length) {
      const everyone = [f.assignee, ...f.helpers.filter((h) => h !== f.assignee)];
      const rows = everyone.map((id) => ({ ...base, assignee_id: id, assignee_name: people.find((p) => p.id === id)?.full_name || "", helper_ids: [] }));
      r = await run(supabase.from("hub_tasks").insert(rows), `${rows.length} separate tasks added`);
    } else {
      const row = { ...base, assignee_id: isId ? f.assignee : null, assignee_name: isId ? person?.full_name || "" : f.assignee.replace(/^name:/, ""),
        helper_ids: isId ? f.helpers.filter((h) => h !== f.assignee) : [] };
      if (task && task.status !== "Done" && f.status === "Done") { toast("To close a task, use the status box on the task — it asks what was done.", "err"); setBusy(false); return; }
      r = await run(task ? supabase.from("hub_tasks").update(row).eq("id", task.id) : supabase.from("hub_tasks").insert(row), task ? "Task saved" : "Task added — the person has been told");
    }
    setBusy(false);
    if (r.ok) { onSaved(); onClose(); }
  };
  const depts = DEPARTMENTS.includes(f.department) || !f.department ? DEPARTMENTS : [f.department, ...DEPARTMENTS];
  const others = people.filter((p) => p.id !== f.assignee);
  return (
    <Modal wide title={task ? "Edit task" : preset?.goal_id ? `New task for goal: ${preset.goalTitle || ""}` : "New task"} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : task ? "Save" : "Add task"}</button></>}>
      <Field label="What needs to be done?"><input className="form-inp" value={f.title} onChange={set("title")} autoFocus placeholder="e.g. Collect original approvals from Drug Office" /></Field>
      <Field label="Details (optional)"><textarea className="form-inp" rows={2} value={f.description} onChange={set("description")} /></Field>
      {preset?.personal && <><div className="cmp-alert" style={{ marginBottom: 10 }}>🔒 Private task from your personal goal — only you will see it.</div>
        <Field label="Due date"><input className="form-inp" type="date" value={f.due_date} onChange={set("due_date")} /></Field></>}
      <div className="form-grid" style={preset?.personal ? { display: "none" } : undefined}>
        <Field label="Main person (responsible)">
          <select className="form-inp" value={f.assignee} onChange={set("assignee")}>
            <option value="">— choose —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.id === me.id ? " (me)" : ""}</option>)}
            {legacyName && <option value={`name:${legacyName}`}>{legacyName} (from old app)</option>}
          </select>
        </Field>
        <Field label="Due date"><input className="form-inp" type="date" value={f.due_date} onChange={set("due_date")} /></Field>
      </div>
      {f.assignee && !f.assignee.startsWith("name:") && !preset?.personal && (
        <Field label="Helpers (optional)" hint="Helpers are told, see it in their list and can comment and attach files. Only the main person closes it.">
          <div className="tk-pick">{others.map((p) => <button type="button" key={p.id} className={f.helpers.includes(p.id) ? "on" : ""} onClick={() => toggleHelper(p.id)}><Avatar name={p.full_name} size={18} /> {p.full_name}</button>)}</div>
          {!task && f.helpers.length > 0 && (
            <label className="tk-copies"><input type="checkbox" checked={f.copies} onChange={(e) => setF((x) => ({ ...x, copies: e.target.checked }))} /> Give a <b>separate copy</b> to each person instead (each one does it and is tracked on their own)</label>
          )}
        </Field>
      )}
      <div className="form-grid">
        <Field label="Firm"><select className="form-inp" value={f.firm_id} onChange={set("firm_id")}><option value="">— any / not firm-specific —</option>{FIRMS.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Department"><select className="form-inp" value={f.department} onChange={set("department")}>{depts.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Priority"><select className="form-inp" value={f.priority} onChange={set("priority")}>{PRIORITIES.map((d) => <option key={d}>{d}</option>)}</select></Field>
      </div>
      <div className="form-grid">
        <Field label="Repeats"><select className="form-inp" value={f.repeat} onChange={set("repeat")}>{REPEATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {task && <Field label="Status"><select className="form-inp" value={f.status} onChange={set("status")}>{STATUSES.map((d) => <option key={d}>{d}</option>)}</select></Field>}
      </div>
      {f.repeat && <div className="form-hint" style={{ marginTop: -6, marginBottom: 8 }}>When this task is marked Done, the next one is created by itself with the next due date.</div>}
      <Field label="Checklist steps (optional — one per line)"><textarea className="form-inp" rows={3} value={f.checklist} onChange={set("checklist")} placeholder={"Collect approval 1\nCollect approval 2\nFile in QA"} /></Field>
    </Modal>
  );
}
