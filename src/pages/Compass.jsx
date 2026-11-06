import { useState } from "react";
import { supabase } from "../supabase";
import { useData, run } from "../lib/data";
import { GOAL_TYPES, G_COLOR } from "../lib/constants";
import { fmtDateTime, fmtDate, dueLabel } from "../lib/dates";
import Comments, { CommentToggle } from "../components/Comments";
import { Modal, Field, Empty, Tag, Collapse, useConfirm } from "../components/ui";

// Progress is always calculated live from the checklist — never stored.
export function goalProgress(items) {
  if (!items.length) return 0;
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

export default function Compass() {
  const { goals, goalItems, profiles } = useData();
  const [type, setType] = useState("All");
  const [modal, setModal] = useState(null);
  const [ask, dialog] = useConfirm();
  const owners = profiles.rows.filter((p) => p.role === "owner" && p.status === "approved").map((p) => p.full_name);

  const live = goals.rows.filter((g) => !g.deleted_at);
  const active = live.filter((g) => !g.achieved && (type === "All" || g.type === type))
    .sort((a, b) => (a.target_date || "9999") < (b.target_date || "9999") ? -1 : 1);
  const achieved = live.filter((g) => g.achieved).sort((a, b) => ((a.achieved_at || "") < (b.achieved_at || "") ? 1 : -1));
  const itemsOf = (gid) => goalItems.rows.filter((i) => i.goal_id === gid);

  const setAchieved = async (g, achieved) => {
    const r = await run(supabase.from("hub_goals").update({ achieved }).eq("id", g.id), achieved ? "Goal achieved 🏆" : "Goal reopened");
    if (r.ok) goals.reload();
  };
  const del = async (g) => {
    const ok = await ask({ title: "Delete this goal?", body: `"${g.title}" will go to the recycle bin. You can restore it within 30 days.`, okText: "Delete", danger: true });
    if (!ok) return;
    const r = await run(supabase.from("hub_goals").update({ deleted_at: new Date().toISOString() }).eq("id", g.id), "Moved to recycle bin");
    if (r.ok) goals.reload();
  };

  return (
    <div className="section">
      <div className="section-head">
        <div className="section-title">🧭 Business Compass <span className="section-count">{active.length} active</span></div>
        <button className="add-btn" style={{ background: "#5b4bb5" }} onClick={() => setModal({})}>+ New Goal</button>
      </div>
      <div className="filter-bar">
        {["All", ...GOAL_TYPES].map((f) => (
          <button key={f} className={`filter-btn ${type === f ? "active" : ""}`} onClick={() => setType(f)}>{f}</button>
        ))}
      </div>
      <div className="task-cards-area">
        {active.length === 0 && <Empty>No active goals. Add one above ↑</Empty>}
        {active.map((g) => (
          <GoalCard key={g.id} g={g} items={itemsOf(g.id)} onEdit={() => setModal(g)}
            onAchieved={() => setAchieved(g, true)} onDelete={() => del(g)} />
        ))}
      </div>
      {achieved.length > 0 && (
        <div className="archive-wrap">
          <Collapse label="🏆 Achieved goals" badge={achieved.length}>
            {achieved.map((g) => (
              <div key={g.id} className="task-card archived">
                <div className="task-card-head">
                  <span className="archive-task-title">{g.title}</span>
                  <div className="todo-actions">
                    <button className="restore-btn" onClick={() => setAchieved(g, false)}>↩ Reopen</button>
                    <button className="icon-btn" onClick={() => del(g)}>🗑</button>
                  </div>
                </div>
                <div className="meta-row">
                  <Tag color={G_COLOR[g.type]}>{g.type}</Tag>
                  {g.owner_name && <span>👤 {g.owner_name}</span>}
                  <span>🏆 <strong>{g.achieved_by_name || "—"}</strong> · {fmtDateTime(g.achieved_at)}</span>
                  <span>Progress {goalProgress(itemsOf(g.id))}%</span>
                </div>
              </div>
            ))}
          </Collapse>
        </div>
      )}
      {modal && <GoalModal goal={modal.id ? modal : null} owners={owners} onClose={() => setModal(null)} onSaved={goals.reload} />}
      {dialog}
    </div>
  );
}

function GoalCard({ g, items, onEdit, onAchieved, onDelete }) {
  const [open, setOpen] = useState(false);
  const pct = goalProgress(items);
  const color = G_COLOR[g.type] || "#5b4bb5";
  const due = g.target_date ? dueLabel(g.target_date) : null;
  return (
    <div className="compass-card">
      <div className="compass-card-head">
        <div className="compass-title">{g.title}</div>
        <div className="todo-actions">
          <CommentToggle type="goal" id={g.id} open={open} onToggle={() => setOpen((o) => !o)} />
          <button className="achieve-btn" onClick={onAchieved}>✅ Mark achieved</button>
          <button className="icon-btn edit" title="Edit" onClick={onEdit}>✎</button>
          <button className="icon-btn" onClick={onDelete}>🗑</button>
        </div>
      </div>
      {g.description && <div className="compass-body">{g.description}</div>}
      <div className="compass-footer">
        <Tag color={color}>{g.type}</Tag>
        {g.owner_name && <span className="assignee">👤 {g.owner_name}</span>}
        {due && <span className={`due ${due.cls}`}>🎯 {due.text}</span>}
      </div>
      <div className="progress-wrap">
        <div className="progress-label"><span>Progress (from checklist)</span><span style={{ fontWeight: 600, color }}>{pct}%</span></div>
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%`, background: color }} /></div>
      </div>
      <GoalItems goalId={g.id} items={items} />
      {g.review_notes && <div className="review-notes"><strong>Review notes:</strong> {g.review_notes}</div>}
      <div className="meta-row" style={{ marginTop: 6 }}>
        <span>➕ <strong>{g.created_by_name || "—"}</strong> · {fmtDateTime(g.created_at)}</span>
      </div>
      {open && <div style={{ marginTop: 10 }}><Comments type="goal" id={g.id} /></div>}
    </div>
  );
}

function GoalItems({ goalId, items }) {
  const { goalItems } = useData();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [openSubs, setOpenSubs] = useState({});
  const [subText, setSubText] = useState({});
  const top = items.filter((i) => !i.parent_id);
  const subs = (id) => items.filter((i) => i.parent_id === id);

  const add = async (parent_id = null) => {
    const t = (parent_id ? subText[parent_id] : text || "").trim();
    if (!t) return;
    const r = await run(supabase.from("hub_goal_items").insert({ goal_id: goalId, parent_id, text: t, due_date: parent_id ? null : due || null }));
    if (r.ok) { parent_id ? setSubText((s) => ({ ...s, [parent_id]: "" })) : (setText(""), setDue("")); goalItems.reload(); }
  };
  const toggle = async (i) => { await run(supabase.from("hub_goal_items").update({ done: !i.done }).eq("id", i.id)); goalItems.reload(); };
  const del = async (i) => {
    if (!window.confirm(`Delete "${i.text}"${subs(i.id).length ? " and its sub-items" : ""}?`)) return;
    await run(supabase.from("hub_goal_items").delete().eq("id", i.id)); goalItems.reload();
  };

  return (
    <div className="goal-tasks">
      <div className="goal-tasks-head">
        <span className="goal-tasks-title">📌 Milestones & tasks</span>
        <span className="small-muted">{top.filter((t) => t.done).length}/{top.length} done</span>
      </div>
      <div className="add-subtask-row">
        <input className="subtask-inp" placeholder="Add a milestone or task…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <input className="subtask-inp" style={{ flex: "0 0 140px" }} type="date" title="Milestone date (optional)" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="subtask-add-btn" onClick={() => add()}>+ Add</button>
      </div>
      {top.length === 0 && <div className="small-muted" style={{ padding: "4px 0 8px" }}>No items yet.</div>}
      {top.map((i) => {
        const s = subs(i.id);
        const d = i.due_date && !i.done ? dueLabel(i.due_date) : null;
        return (
          <div key={i.id}>
            <div className="goal-task-item">
              <input type="checkbox" className="goal-task-cb" checked={i.done} onChange={() => toggle(i)} />
              <span className={`goal-task-text ${i.done ? "done" : ""}`}>{i.text}</span>
              {i.due_date && <span className={`due ${d ? d.cls : "due-later"}`}>{fmtDate(i.due_date)}</span>}
              <button className="icon-btn small" onClick={() => setOpenSubs((o) => ({ ...o, [i.id]: !o[i.id] }))}>
                {openSubs[i.id] ? "▲" : "▼"} {s.length ? `${s.filter((x) => x.done).length}/${s.length}` : "sub-items"}
              </button>
              <button className="icon-btn small" onClick={() => del(i)}>🗑</button>
            </div>
            {openSubs[i.id] && (
              <div className="subtasks-area">
                {s.map((x) => (
                  <div key={x.id} className="subtask-item">
                    <input type="checkbox" className="subtask-cb" checked={x.done} onChange={() => toggle(x)} />
                    <span className={`subtask-text ${x.done ? "done" : ""}`}>{x.text}</span>
                    <button className="icon-btn small" onClick={() => del(x)}>🗑</button>
                  </div>
                ))}
                <div className="add-subtask-inline">
                  <input className="subtask-inp-sm" placeholder="Add sub-item…" value={subText[i.id] || ""}
                    onChange={(e) => setSubText((st) => ({ ...st, [i.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && add(i.id)} />
                  <button className="subtask-add-sm" onClick={() => add(i.id)}>+ Sub</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GoalModal({ goal, owners, onClose, onSaved }) {
  const [f, setF] = useState({
    title: goal?.title || "", description: goal?.description || "", type: goal?.type || "Long-term",
    owner_name: goal?.owner_name || owners[0] || "", target_date: goal?.target_date || "", review_notes: goal?.review_notes || "",
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.title.trim()) return;
    const row = { ...f, title: f.title.trim(), target_date: f.target_date || null };
    const q = goal ? supabase.from("hub_goals").update(row).eq("id", goal.id) : supabase.from("hub_goals").insert(row);
    const r = await run(q, goal ? "Goal saved" : "Goal added");
    if (r.ok) { onSaved(); onClose(); }
  };
  const ownerOpts = owners.includes(f.owner_name) || !f.owner_name ? owners : [f.owner_name, ...owners];
  return (
    <Modal title={goal ? "Edit goal" : "New goal"} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" style={{ background: "#5b4bb5" }} onClick={save}>{goal ? "Save" : "Add goal"}</button></>}>
      <Field label="Goal title"><input className="form-inp" value={f.title} onChange={set("title")} placeholder="e.g. Launch export division…" autoFocus /></Field>
      <Field label="Description"><textarea className="form-inp" value={f.description} onChange={set("description")} /></Field>
      <div className="form-grid">
        <Field label="Type"><select className="form-inp" value={f.type} onChange={set("type")}>{GOAL_TYPES.map((o) => <option key={o}>{o}</option>)}</select></Field>
        <Field label="Goal owner"><select className="form-inp" value={f.owner_name} onChange={set("owner_name")}>{ownerOpts.map((o) => <option key={o}>{o}</option>)}</select></Field>
        <Field label="Target date"><input type="date" className="form-inp" value={f.target_date} onChange={set("target_date")} /></Field>
      </div>
      {goal && <Field label="Quarterly review notes"><textarea className="form-inp" value={f.review_notes} onChange={set("review_notes")} placeholder="Where we are, what's blocking, next steps…" /></Field>}
    </Modal>
  );
}
