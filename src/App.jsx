import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import { ref, onValue, push, remove, update } from "firebase/database";

const SHARED_PIN = "0000";
const USERS = ["Sanjiv", "Sangeeta", "Piyush", "User 4", "User 5", "User 6", "User 7"];
const OWNER_USERS = ["Sanjiv", "Sangeeta", "Piyush"];
const DEPARTMENTS = ["Production","Sales & Marketing","Regulatory & Compliance","R&D / Formulation","Operations / Admin","Finance","Export / International"];
const PRIORITIES = ["High", "Medium", "Low"];
const STATUSES = ["To-Do", "In Progress", "Done"];
const GOAL_TYPES = ["Long-term", "Short-term"];
const RM_UNITS = ["kg","g","L","mL","pcs","bags","drums","bottles"];
const PM_UNITS = ["pcs","boxes","rolls","sheets","cartons","kg"];
const P_COLOR = { High:"#e24b4a", Medium:"#ba7517", Low:"#2d7d4a" };
const S_COLOR = { "To-Do":"#888", "In Progress":"#1a6fa8", "Done":"#2d7d4a" };
const G_COLOR = { "Long-term":"#5b4bb5", "Short-term":"#0f7a5a" };

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', sans-serif; background: #f0f2f5; min-height: 100vh; }
  .pin-screen { min-height:100vh; background:linear-gradient(135deg,#0d1b2a 0%,#1a3a5c 60%,#0d3a2e 100%); display:flex; align-items:center; justify-content:center; }
  .pin-card { background:rgba(255,255,255,0.07); backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.15); border-radius:20px; padding:48px 40px; width:380px; text-align:center; box-shadow:0 32px 80px rgba(0,0,0,0.4); }
  .pin-logo { font-family:'DM Serif Display',serif; font-size:32px; color:#fff; letter-spacing:2px; margin-bottom:4px; }
  .pin-sub { color:rgba(255,255,255,0.5); font-size:13px; margin-bottom:32px; }
  .user-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:28px; }
  .user-btn { padding:10px 4px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.7); font-size:11px; cursor:pointer; transition:all 0.2s; }
  .user-btn.active { background:rgba(255,255,255,0.2); color:#fff; border-color:rgba(255,255,255,0.4); }
  .pin-dots { display:flex; gap:12px; justify-content:center; margin-bottom:24px; }
  .pin-dot { width:14px; height:14px; border-radius:50%; border:2px solid rgba(255,255,255,0.4); background:transparent; transition:all 0.15s; }
  .pin-dot.filled { background:#fff; border-color:#fff; }
  .pin-pad { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .pin-key { height:52px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.08); color:#fff; font-size:20px; font-weight:500; cursor:pointer; transition:all 0.15s; }
  .pin-key:hover { background:rgba(255,255,255,0.18); }
  .pin-key:active { transform:scale(0.95); }
  .pin-error { color:#ff6b6b; font-size:13px; margin-top:14px; min-height:20px; }
  .shake { animation:shake 0.4s ease; }
  @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
  .header { background:linear-gradient(135deg,#0d1b2a 0%,#1a3a5c 70%,#0d3a2e 100%); padding:0 24px; position:sticky; top:0; z-index:100; box-shadow:0 2px 16px rgba(0,0,0,0.3); }
  .header-top { display:flex; align-items:center; justify-content:space-between; padding:14px 0 8px; }
  .brand { font-family:'DM Serif Display',serif; font-size:22px; color:#fff; letter-spacing:1px; }
  .brand-loc { font-size:11px; color:rgba(255,255,255,0.45); display:block; }
  .user-info { display:flex; align-items:center; gap:10px; }
  .user-badge { background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.2); color:#fff; font-size:12px; padding:4px 12px; border-radius:20px; }
  .logout-btn { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,0.7); font-size:12px; padding:4px 12px; border-radius:20px; cursor:pointer; transition:all 0.15s; }
  .logout-btn:hover { background:rgba(255,100,100,0.2); color:#ff9999; }
  .tabs { display:flex; gap:4px; overflow-x:auto; }
  .tab { padding:10px 18px; font-size:13px; font-weight:500; cursor:pointer; border:none; background:transparent; color:rgba(255,255,255,0.5); border-bottom:3px solid transparent; transition:all 0.2s; white-space:nowrap; }
  .tab.active { color:#fff; border-bottom-color:#4caf8c; }
  .tab:hover:not(.active) { color:rgba(255,255,255,0.8); }
  .page { max-width:820px; margin:0 auto; padding:24px 16px 60px; }
  .card { background:#fff; border-radius:14px; padding:20px; box-shadow:0 2px 12px rgba(0,0,0,0.06); margin-bottom:16px; }
  .section-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
  .section-title { font-size:15px; font-weight:600; color:#1a3a5c; }
  .btn-primary { background:#1a3a5c; color:#fff; border:none; border-radius:8px; padding:8px 16px; font-size:13px; font-weight:500; cursor:pointer; transition:background 0.15s; }
  .btn-primary:hover { background:#0d2a4a; }
  .btn-sm { padding:4px 10px; font-size:12px; border-radius:6px; border:none; cursor:pointer; transition:all 0.15s; }
  .todo-item { display:flex; align-items:flex-start; gap:12px; padding:12px; border-radius:10px; border:1px solid #eee; margin-bottom:8px; transition:all 0.2s; }
  .todo-item.ordered { opacity:0.55; background:#f9fafb; }
  .todo-item input[type=checkbox] { width:18px; height:18px; margin-top:2px; cursor:pointer; accent-color:#2d7d4a; }
  .todo-meta { font-size:12px; color:#888; margin-top:3px; }
  .task-card { border:1px solid #eee; border-radius:10px; padding:14px 16px; margin-bottom:10px; border-left:4px solid #ddd; transition:box-shadow 0.15s; }
  .task-card:hover { box-shadow:0 2px 10px rgba(0,0,0,0.08); }
  .task-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .badge { font-size:11px; font-weight:500; padding:2px 8px; border-radius:10px; display:inline-block; }
  .goal-card { border:1px solid #eee; border-radius:12px; padding:16px; margin-bottom:12px; }
  .progress-bar { height:6px; background:#eee; border-radius:3px; margin:8px 0; overflow:hidden; }
  .progress-fill { height:100%; border-radius:3px; transition:width 0.3s; }
  .subtask { display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #f5f5f5; }
  .subtask:last-child { border-bottom:none; }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:999; padding:16px; }
  .modal { background:#fff; border-radius:16px; padding:28px; width:100%; max-width:480px; max-height:90vh; overflow-y:auto; box-shadow:0 24px 60px rgba(0,0,0,0.25); }
  .modal h3 { font-size:17px; font-weight:600; color:#1a3a5c; margin-bottom:20px; }
  .form-group { margin-bottom:14px; }
  .form-group label { display:block; font-size:12px; font-weight:500; color:#555; margin-bottom:5px; }
  .form-group input, .form-group select, .form-group textarea { width:100%; padding:9px 12px; border:1px solid #ddd; border-radius:8px; font-size:13px; font-family:'DM Sans',sans-serif; outline:none; transition:border 0.15s; }
  .form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color:#1a3a5c; }
  .form-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:20px; }
  .btn-cancel { background:#f5f5f5; color:#555; border:none; border-radius:8px; padding:8px 16px; font-size:13px; cursor:pointer; }
  .divider { text-align:center; font-size:12px; color:#aaa; margin:16px 0; position:relative; }
  .divider::before { content:''; position:absolute; left:0; top:50%; width:100%; height:1px; background:#eee; z-index:0; }
  .divider span { background:#fff; padding:0 10px; position:relative; z-index:1; }
  .empty { text-align:center; color:#aaa; font-size:13px; padding:32px 0; }
  @media(max-width:600px){ .form-row{grid-template-columns:1fr;} .user-grid{grid-template-columns:repeat(3,1fr);} .pin-card{padding:32px 20px; width:calc(100vw - 32px);} }
`;

function PinScreen({ onLogin }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const pressKey = (k) => {
    if (!selectedUser) { setError("Please select your name first"); return; }
    if (k === "⌫") { setPin(p => p.slice(0, -1)); setError(""); return; }
    const next = pin + k;
    setPin(next);
    if (next.length === 4) {
      if (next === SHARED_PIN) {
        onLogin(selectedUser);
      } else {
        setShake(true);
        setError("Incorrect PIN. Try again.");
        setTimeout(() => { setPin(""); setShake(false); }, 600);
      }
    }
  };

  return (
    <div className="pin-screen">
      <div className="pin-card">
        <div className="pin-logo">VELITE</div>
        <div className="pin-sub">Healthcare · Ludhiana</div>
        <div className="user-grid">
          {USERS.map(u => (
            <button key={u} className={`user-btn ${selectedUser===u?"active":""}`}
              onClick={() => { setSelectedUser(u); setPin(""); setError(""); }}>{u}</button>
          ))}
        </div>
        <div className={`pin-dots ${shake?"shake":""}`}>
          {[0,1,2,3].map(i => <div key={i} className={`pin-dot ${i<pin.length?"filled":""}`} />)}
        </div>
        <div className="pin-pad">
          {["1","2","3","4","5","6","7","8","9","⌫","0","✓"].map(k => (
            <button key={k} className="pin-key" onClick={() => pressKey(k)}>{k}</button>
          ))}
        </div>
        <div className="pin-error">{error}</div>
      </div>
    </div>
  );
}

function TodoSection({ title, color, icon, dbPath, units }) {
  const [items, setItems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const nameRef = useRef(); const qtyRef = useRef(); const unitRef = useRef();
  const vendorRef = useRef(); const notesRef = useRef();

  useEffect(() => {
    return onValue(ref(db, dbPath), snap => {
      const data = snap.val() || {};
      setItems(Object.entries(data).map(([id, v]) => ({ id, ...v })));
    });
  }, [dbPath]);

  const addItem = () => {
    const name = nameRef.current?.value.trim();
    if (!name) return;
    push(ref(db, dbPath), {
      name, qty: qtyRef.current?.value || "", unit: unitRef.current?.value || units[0],
      vendor: vendorRef.current?.value || "", notes: notesRef.current?.value || "",
      ordered: false, createdAt: Date.now()
    });
    setShowModal(false);
  };

  const toggle = (item) => update(ref(db, `${dbPath}/${item.id}`), { ordered: !item.ordered });
  const del = (id) => remove(ref(db, `${dbPath}/${id}`));
  const pending = items.filter(i => !i.ordered);
  const ordered = items.filter(i => i.ordered);

  return (
    <div className="card">
      <div className="section-header">
        <div className="section-title" style={{ color }}>{icon} {title}</div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Add</button>
      </div>
      {pending.length === 0 && <div className="empty">No pending items</div>}
      {pending.map(item => (
        <div key={item.id} className="todo-item">
          <input type="checkbox" checked={false} onChange={() => toggle(item)} />
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:500, fontSize:14 }}>{item.name}</div>
            <div className="todo-meta">
              {item.qty && <span>{item.qty} {item.unit} </span>}
              {item.vendor && <span>· Vendor: {item.vendor} </span>}
              {item.notes && <span>· {item.notes}</span>}
            </div>
          </div>
          <button className="btn-sm" style={{ background:"#fee", color:"#c00" }} onClick={() => del(item.id)}>✕</button>
        </div>
      ))}
      {ordered.length > 0 && (
        <>
          <div className="divider"><span>✓ Ordered ({ordered.length})</span></div>
          {ordered.map(item => (
            <div key={item.id} className="todo-item ordered">
              <input type="checkbox" checked={true} onChange={() => toggle(item)} />
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:500, fontSize:14, textDecoration:"line-through" }}>{item.name}</div>
                <div className="todo-meta">{item.qty && <span>{item.qty} {item.unit} </span>}{item.vendor && <span>· {item.vendor}</span>}</div>
              </div>
              <button className="btn-sm" style={{ background:"#fee", color:"#c00" }} onClick={() => del(item.id)}>✕</button>
            </div>
          ))}
        </>
      )}
      {showModal && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <h3>Add to {title}</h3>
            <div className="form-group"><label>Item Name *</label><input ref={nameRef} placeholder="e.g. Niacinamide" /></div>
            <div className="form-row">
              <div className="form-group"><label>Quantity</label><input ref={qtyRef} placeholder="e.g. 25" /></div>
              <div className="form-group"><label>Unit</label><select ref={unitRef}>{units.map(u=><option key={u}>{u}</option>)}</select></div>
            </div>
            <div className="form-group"><label>Proposed Vendor</label><input ref={vendorRef} placeholder="Vendor name" /></div>
            <div className="form-group"><label>Notes</label><input ref={notesRef} placeholder="Any remarks" /></div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={addItem}>Add Item</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskManager({ user }) {
  const [tasks, setTasks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [filterDept, setFilterDept] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const titleRef = useRef(); const deptRef = useRef(); const assignRef = useRef();
  const prioRef = useRef(); const dueRef = useRef(); const notesRef = useRef();

  useEffect(() => {
    return onValue(ref(db, "tasks"), snap => {
      const data = snap.val() || {};
      setTasks(Object.entries(data).map(([id, v]) => ({ id, ...v })));
    });
  }, []);

  const addTask = () => {
    const title = titleRef.current?.value.trim();
    if (!title) return;
    push(ref(db, "tasks"), {
      title, dept: deptRef.current?.value, assignee: assignRef.current?.value,
      priority: prioRef.current?.value, due: dueRef.current?.value,
      notes: notesRef.current?.value, status: "To-Do",
      createdBy: user, createdAt: Date.now()
    });
    setShowModal(false);
  };

  const cycleStatus = (task) => {
    const idx = STATUSES.indexOf(task.status);
    update(ref(db, `tasks/${task.id}`), { status: STATUSES[(idx+1) % STATUSES.length] });
  };
  const del = (id) => remove(ref(db, `tasks/${id}`));
  const filtered = tasks.filter(t =>
    (filterDept==="All" || t.dept===filterDept) && (filterStatus==="All" || t.status===filterStatus)
  );

  return (
    <div>
      <div className="card">
        <div className="section-header">
          <div className="section-title">Task Manager</div>
          <button className="btn-primary" onClick={() => setShowModal(true)}>+ New Task</button>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
          <select value={filterDept} onChange={e=>setFilterDept(e.target.value)} style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:12 }}>
            <option value="All">All Departments</option>
            {DEPARTMENTS.map(d=><option key={d}>{d}</option>)}
          </select>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:12 }}>
            <option value="All">All Statuses</option>
            {STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
        {filtered.length===0 && <div className="empty">No tasks found</div>}
        {filtered.map(task => (
          <div key={task.id} className="task-card" style={{ borderLeftColor: P_COLOR[task.priority]||"#ddd" }}>
            <div className="task-row">
              <span style={{ fontWeight:600, fontSize:14, flex:1 }}>{task.title}</span>
              <span className="badge" style={{ background:S_COLOR[task.status]+"22", color:S_COLOR[task.status] }}>{task.status}</span>
            </div>
            <div className="task-row" style={{ marginTop:8 }}>
              <span className="badge" style={{ background:"#f0f2f5", color:"#555" }}>{task.dept}</span>
              <span className="badge" style={{ background:P_COLOR[task.priority]+"22", color:P_COLOR[task.priority] }}>{task.priority}</span>
              {task.assignee && <span style={{ fontSize:12, color:"#888" }}>👤 {task.assignee}</span>}
              {task.due && <span style={{ fontSize:12, color:"#888" }}>📅 {task.due}</span>}
            </div>
            {task.notes && <div style={{ fontSize:12, color:"#888", marginTop:6 }}>{task.notes}</div>}
            <div style={{ display:"flex", gap:6, marginTop:10 }}>
              <button className="btn-sm" style={{ background:"#e8f4ff", color:"#1a6fa8" }} onClick={() => cycleStatus(task)}>⟳ Status</button>
              <button className="btn-sm" style={{ background:"#fee", color:"#c00" }} onClick={() => del(task.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {showModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <h3>New Task</h3>
            <div className="form-group"><label>Title *</label><input ref={titleRef} placeholder="Task title" /></div>
            <div className="form-row">
              <div className="form-group"><label>Department</label><select ref={deptRef}>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select></div>
              <div className="form-group"><label>Assign To</label><select ref={assignRef}><option value="">— Select —</option>{USERS.map(u=><option key={u}>{u}</option>)}</select></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Priority</label><select ref={prioRef}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select></div>
              <div className="form-group"><label>Due Date</label><input type="date" ref={dueRef} /></div>
            </div>
            <div className="form-group"><label>Notes</label><textarea ref={notesRef} rows={2} placeholder="Additional details" /></div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={addTask}>Add Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BusinessCompass({ user }) {
  const [goals, setGoals] = useState([]);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(null);
  const goalTitleRef = useRef(); const goalTypeRef = useRef();
  const goalDeadlineRef = useRef(); const goalDescRef = useRef();
  const taskTitleRef = useRef(); const taskAssignRef = useRef(); const taskDueRef = useRef();

  useEffect(() => {
    return onValue(ref(db, "goals"), snap => {
      const data = snap.val() || {};
      setGoals(Object.entries(data).map(([id, v]) => ({
        id, ...v,
        tasks: v.tasks ? Object.entries(v.tasks).map(([tid,tv])=>({id:tid,...tv})) : []
      })));
    });
  }, []);

  const addGoal = () => {
    const title = goalTitleRef.current?.value.trim();
    if (!title) return;
    push(ref(db, "goals"), {
      title, type: goalTypeRef.current?.value,
      deadline: goalDeadlineRef.current?.value,
      desc: goalDescRef.current?.value, createdBy: user, createdAt: Date.now()
    });
    setShowGoalModal(false);
  };

  const addTask = (goalId) => {
    const title = taskTitleRef.current?.value.trim();
    if (!title) return;
    push(ref(db, `goals/${goalId}/tasks`), {
      title, assignee: taskAssignRef.current?.value,
      due: taskDueRef.current?.value, done: false
    });
    setShowTaskModal(null);
  };

  const toggleTask = (goalId, taskId, done) => update(ref(db, `goals/${goalId}/tasks/${taskId}`), { done: !done });
  const delGoal = (id) => remove(ref(db, `goals/${id}`));

  return (
    <div>
      <div className="card">
        <div className="section-header">
          <div className="section-title">🧭 Business Compass</div>
          <button className="btn-primary" onClick={()=>setShowGoalModal(true)}>+ Add Goal</button>
        </div>
        {goals.length===0 && <div className="empty">No goals yet — start planning!</div>}
        {goals.map(goal => {
          const done = goal.tasks.filter(t=>t.done).length;
          const total = goal.tasks.length;
          const pct = total > 0 ? Math.round(done/total*100) : 0;
          return (
            <div key={goal.id} className="goal-card">
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                <div style={{ flex:1 }}>
                  <span className="badge" style={{ background:G_COLOR[goal.type]+"22", color:G_COLOR[goal.type], marginBottom:6, display:"inline-block" }}>{goal.type}</span>
                  <div style={{ fontWeight:600, fontSize:15 }}>{goal.title}</div>
                  {goal.desc && <div style={{ fontSize:13, color:"#666", marginTop:3 }}>{goal.desc}</div>}
                  {goal.deadline && <div style={{ fontSize:12, color:"#999", marginTop:3 }}>🎯 Target: {goal.deadline}</div>}
                </div>
                <button className="btn-sm" style={{ background:"#fee", color:"#c00" }} onClick={()=>delGoal(goal.id)}>✕</button>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width:`${pct}%`, background:G_COLOR[goal.type] }} />
              </div>
              <div style={{ fontSize:12, color:"#888", marginBottom:10 }}>{done}/{total} tasks · {pct}%</div>
              {goal.tasks.map(task => (
                <div key={task.id} className="subtask">
                  <input type="checkbox" checked={task.done} onChange={()=>toggleTask(goal.id,task.id,task.done)} style={{ accentColor:G_COLOR[goal.type] }} />
                  <span style={{ flex:1, fontSize:13, textDecoration:task.done?"line-through":"none", color:task.done?"#aaa":"#333" }}>{task.title}</span>
                  {task.assignee && <span style={{ fontSize:11, color:"#aaa" }}>{task.assignee}</span>}
                  {task.due && <span style={{ fontSize:11, color:"#aaa" }}>{task.due}</span>}
                </div>
              ))}
              <button className="btn-sm" style={{ background:"#f0f7ff", color:"#1a6fa8", marginTop:8 }}
                onClick={()=>setShowTaskModal(goal.id)}>+ Add Task</button>
            </div>
          );
        })}
      </div>
      {showGoalModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowGoalModal(false)}>
          <div className="modal">
            <h3>New Goal</h3>
            <div className="form-group"><label>Goal Title *</label><input ref={goalTitleRef} placeholder="e.g. Expand export to 3 new markets" /></div>
            <div className="form-row">
              <div className="form-group"><label>Type</label><select ref={goalTypeRef}>{GOAL_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div className="form-group"><label>Target Date</label><input type="date" ref={goalDeadlineRef} /></div>
            </div>
            <div className="form-group"><label>Description</label><textarea ref={goalDescRef} rows={2} placeholder="Brief description" /></div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={()=>setShowGoalModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={addGoal}>Add Goal</button>
            </div>
          </div>
        </div>
      )}
      {showTaskModal && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowTaskModal(null)}>
          <div className="modal">
            <h3>Add Task to Goal</h3>
            <div className="form-group"><label>Task Title *</label><input ref={taskTitleRef} placeholder="Task description" /></div>
            <div className="form-row">
              <div className="form-group"><label>Assign To</label><select ref={taskAssignRef}><option value="">— Select —</option>{USERS.map(u=><option key={u}>{u}</option>)}</select></div>
              <div className="form-group"><label>Due Date</label><input type="date" ref={taskDueRef} /></div>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={()=>setShowTaskModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={()=>addTask(showTaskModal)}>Add Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("todo");
  const isOwner = OWNER_USERS.includes(user);
  const tabs = [
    { k:"todo", label:"📋 To-Do Lists", ownerOnly:false },
    { k:"tasks", label:"✅ Task Manager", ownerOnly:false },
    { k:"compass", label:"🧭 Business Compass", ownerOnly:true },
  ].filter(t => !t.ownerOnly || isOwner);

  if (!user) return (<><style>{css}</style><PinScreen onLogin={setUser} /></>);

  return (
    <>
      <style>{css}</style>
      <div className="header">
        <div className="header-top">
          <div>
            <div className="brand">VELITE</div>
            <span className="brand-loc">Productivity Hub · Ludhiana</span>
          </div>
          <div className="user-info">
            <span className="user-badge">👤 {user}</span>
            <button className="logout-btn" onClick={()=>setUser(null)}>Logout</button>
          </div>
        </div>
        <div className="tabs">
          {tabs.map(t => (
            <button key={t.k} className={`tab ${tab===t.k?"active":""}`} onClick={()=>setTab(t.k)}>{t.label}</button>
          ))}
        </div>
      </div>
      <div className="page">
        {tab==="todo" && (
          <>
            <TodoSection title="Raw Materials to Order" color="#1a6fa8" icon="🧪" dbPath="rm_items" units={RM_UNITS} />
            <TodoSection title="Packing Materials to Order" color="#6c3483" icon="📦" dbPath="pm_items" units={PM_UNITS} />
          </>
        )}
        {tab==="tasks" && <TaskManager user={user} />}
        {tab==="compass" && isOwner && <BusinessCompass user={user} />}
      </div>
    </>
  );
}
