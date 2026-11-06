import { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { useData, run } from "../lib/data";
import { DEPARTMENTS, PRIORITIES, STATUSES, P_COLOR, S_COLOR } from "../lib/constants";
import { fmtDateTime, dueLabel, daysUntil } from "../lib/dates";
import Comments, { CommentToggle } from "../components/Comments";
import { Modal, Field, Empty, Tag, SearchBox, Collapse, useConfirm } from "../components/ui";

export function isMine(t, me) {
  if (t.assignee_id) return t.assignee_id === me.id;
  return !!t.assignee_name && t.assignee_name.trim().toLowerCase() === (me.full_name || "").trim().toLowerCase();
}
const PRI = { High: 0, Medium: 1, Low: 2 };
export function byDue(a, b) {
  const da = a.due_date || "9999-12-31", db = b.due_date || "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  if (PRI[a.priority] !== PRI[b.priority]) return PRI[a.priority] - PRI[b.priority];
  return a.created_at < b.created_at ? 1 : -1;
}

export default function Tasks() {
  const { tasks, me } = useData();
  const [view, setView] = useState("active");
  const [dept, setDept] = useState("");
  const [pri, setPri] = useState("");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null); // null | {} (new) | task (edit)
  const [ask, dialog] = useConfirm();

  const live = tasks.rows.filter((t) => !t.deleted_at);
  const active = live.filter((t) => t.status !== "Done");
  const done = live.filter((t) => t.status === "Done").sort((a, b) => ((a.completed_at || "") < (b.completed_at || "") ? 1 : -1));

  const shown = useMemo(() => {
    let r = active;
    if (view === "mine") r = r.filter((t) => isMine(t, me));
    if (view === "overdue") r = r.filter((t) => t.due_date && daysUntil(t.due_date) < 0);
    if (view === "To-Do" || view === "In Progress") r = r.filter((t) => t.status === view);
    if (dept) r = r.filter((t) => t.department === dept);
    if (pri) r = r.filter((t) => t.priority === pri);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((t) => [t.title, t.description, t.assignee_name, t.department].join(" ").toLowerCase().includes(s));
    return [...r].sort(byDue);
  }, [active, view, dept, pri, q, me]);

  const overdueN = active.filter((t) => t.due_date && daysUntil(t.due_date) < 0).length;
  const mineN = active.filter((t) => isMine(t, me)).length;

  const setStatus = async (t, status) => {
    const r = await run(supabase.from("hub_tasks").update({ status }).eq("id", t.id), status === "Done" ? "Task completed ✅" : null);
    if (r.ok) tasks.reload();
  };
  const del = async (t) => {
    const ok = await ask({ title: "Delete this task?", body: `"${t.title}" will go to the recycle bin. An owner can restore it within 30 days.`, okText: "Delete", danger: true });
    if (!ok) return;
    const r = await run(supabase.from("hub_tasks").update({ deleted_at: new Date().toISOString() }).eq("id", t.id), "Moved to recycle bin");
    if (r.ok) tasks.reload();
  };

  return (
    <div className="section">
      <div className="section-head">
        <div className="section-title">✅ Task Manager <span className="section-count">{active.length} active</span></div>
        <button className="add-btn" onClick={() => setModal({})}>+ New Task</button>
      </div>
      <div className="filter-bar">
        {[["active", "All active", active.length], ["mine", "Assigned to me", mineN], ["overdue", "Overdue", overdueN], ["To-Do", "To-Do"], ["In Progress", "In Progress"]].map(([k, l, n]) => (
          <button key={k} className={`filter-btn ${view === k ? "active" : ""} ${k === "overdue" && n ? "warn" : ""}`} onClick={() => setView(k)}>
            {l}{n !== undefined && <span className="fcount">{n}</span>}
          </button>
        ))}
        <select className="inp inp-filter" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select className="inp inp-filter" value={pri} onChange={(e) => setPri(e.target.value)}>
          <option value="">All priorities</option>{PRIORITIES.map((d) => <option key={d}>{d}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <SearchBox value={q} onChange={setQ} placeholder="Search tasks…" />
      </div>

      <div className="task-cards-area">
        {shown.length === 0 && <Empty>No tasks match this filter.</Empty>}
        {shown.map((t) => (
          <TaskCard key={t.id} t={t} onStatus={(s) => setStatus(t, s)} onEdit={() => setModal(t)} onDelete={() => del(t)} />
        ))}
      </div>

      {done.length > 0 && (
        <div className="archive-wrap">
          <Collapse label="✅ Completed tasks" badge={done.length}>
            {done.slice(0, 150).map((t) => (
              <TaskCard key={t.id} t={t} archived onStatus={(s) => setStatus(t, s)} onEdit={() => setModal(t)} onDelete={() => del(t)} />
            ))}
          </Collapse>
        </div>
      )}

      {modal && <TaskModal task={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={tasks.reload} />}
      {dialog}
    </div>
  );
}

export function TaskCard({ t, archived, onStatus, onEdit, onDelete, compact }) {
  const [open, setOpen] = useState(false);
  const due = !archived && t.due_date ? dueLabel(t.due_date) : null;
  return (
    <div className={`task-card ${archived ? "archived" : ""} ${due?.cls === "due-over" ? "is-overdue" : ""}`}>
      <div className="task-card-head">
        <div className={archived ? "archive-task-title" : "task-title"}>{t.title}</div>
        <div className="todo-actions">
          {archived
            ? <button className="restore-btn" onClick={() => onStatus("To-Do")}>↩ Reopen</button>
            : <select className="task-status-sel" value={t.status} onChange={(e) => onStatus(e.target.value)} style={{ borderColor: S_COLOR[t.status] }}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>}
          {!compact && <CommentToggle type="task" id={t.id} open={open} onToggle={() => setOpen((o) => !o)} />}
          {!compact && <button className="icon-btn edit" title="Edit" onClick={onEdit}>✎</button>}
          {!compact && <button className="icon-btn" title="Delete" onClick={onDelete}>🗑</button>}
        </div>
      </div>
      {t.description && !compact && <div className="task-body">{t.description}</div>}
      <div className="task-footer">
        <Tag color={P_COLOR[t.priority]}>{t.priority}</Tag>
        {!archived && <Tag color={S_COLOR[t.status]}>{t.status}</Tag>}
        {t.department && <Tag color="#555">{t.department}</Tag>}
        {t.assignee_name && <span className="assignee">→ {t.assignee_name}</span>}
        {due && <span className={`due ${due.cls}`}>📅 {due.text}</span>}
      </div>
      {!compact && (
        <div className="meta-row" style={{ marginTop: 6 }}>
          <span>➕ <strong>{t.created_by_name || "—"}</strong> · {fmtDateTime(t.created_at)}</span>
          {t.completed_at && <span>✅ <strong>{t.completed_by_name || "—"}</strong> · {fmtDateTime(t.completed_at)}</span>}
        </div>
      )}
      {open && <Comments type="task" id={t.id} />}
    </div>
  );
}

export function TaskModal({ task, onClose, onSaved }) {
  const { profiles, me } = useData();
  const people = profiles.rows.filter((p) => p.status === "approved");
  const [f, setF] = useState(() => ({
    title: task?.title || "", description: task?.description || "",
    assignee: task?.assignee_id || (task?.assignee_name ? `name:${task.assignee_name}` : me.id),
    department: task?.department || DEPARTMENTS[0], priority: task?.priority || "Medium",
    status: task?.status || "To-Do", due_date: task?.due_date || "",
  }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const legacyName = task && !task.assignee_id && task.assignee_name;
  const save = async () => {
    if (!f.title.trim()) return;
    const isId = f.assignee && !f.assignee.startsWith("name:");
    const person = isId ? people.find((p) => p.id === f.assignee) : null;
    const row = {
      title: f.title.trim(), description: f.description, department: f.department, priority: f.priority,
      status: f.status, due_date: f.due_date || null,
      assignee_id: isId ? f.assignee : null,
      assignee_name: isId ? person?.full_name || "" : (f.assignee || "").replace(/^name:/, ""),
    };
    const q = task ? supabase.from("hub_tasks").update(row).eq("id", task.id) : supabase.from("hub_tasks").insert(row);
    const r = await run(q, task ? "Task saved" : "Task added");
    if (r.ok) { onSaved(); onClose(); }
  };
  const depts = DEPARTMENTS.includes(f.department) || !f.department ? DEPARTMENTS : [f.department, ...DEPARTMENTS];
  return (
    <Modal title={task ? "Edit task" : "New task"} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>{task ? "Save" : "Add task"}</button></>}>
      <Field label="Title"><input className="form-inp" value={f.title} onChange={set("title")} autoFocus /></Field>
      <Field label="Details"><textarea className="form-inp" value={f.description} onChange={set("description")} /></Field>
      <div className="form-grid">
        <Field label="Assign to">
          <select className="form-inp" value={f.assignee} onChange={set("assignee")}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            {legacyName && <option value={`name:${legacyName}`}>{legacyName} (from old app)</option>}
            <option value="name:">— Nobody —</option>
          </select>
        </Field>
        <Field label="Due date"><input className="form-inp" type="date" value={f.due_date} onChange={set("due_date")} /></Field>
      </div>
      <div className="form-grid">
        <Field label="Department"><select className="form-inp" value={f.department} onChange={set("department")}>{depts.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Priority"><select className="form-inp" value={f.priority} onChange={set("priority")}>{PRIORITIES.map((d) => <option key={d}>{d}</option>)}</select></Field>
        <Field label="Status"><select className="form-inp" value={f.status} onChange={set("status")}>{STATUSES.map((d) => <option key={d}>{d}</option>)}</select></Field>
      </div>
    </Modal>
  );
}
