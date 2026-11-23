import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useData, run, toast } from "../lib/data";
import { ROLES } from "../lib/constants";
import { fmtDateTime, timeAgo } from "../lib/dates";
import { Modal, Field, Empty, useConfirm } from "../components/ui";

export default function Admin() {
  const [tab, setTab] = useState("users");
  return (
    <div className="section">
      <div className="section-head">
        <div className="seg">
          {[["users", "👥 Users"], ["bin", "🗑 Recycle bin"], ["activity", "📜 Activity log"]].map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {tab === "users" && <Users />}
      {tab === "bin" && <Bin />}
      {tab === "activity" && <Activity />}
    </div>
  );
}

function Users() {
  const { profiles, me } = useData();
  const [ask, dialog] = useConfirm();
  const [resetFor, setResetFor] = useState(null);
  const [adding, setAdding] = useState(false);
  const pending = profiles.rows.filter((p) => p.status === "pending");
  const others = profiles.rows.filter((p) => p.status !== "pending");

  const setUser = async (p, role, status, msg) => {
    const r = await run(supabase.rpc("hub_admin_set_user", { p_user: p.id, p_role: role, p_status: status }), msg);
    if (r.ok) profiles.reload();
  };

  const setBatch = async (p) => {
    const r = await run(supabase.rpc("hub_admin_set_batch", { p_user: p.id, p_on: !p.batch_access }), "Batch Detail access updated");
    if (r.ok) profiles.reload();
  };
  const setQc = async (p) => {
    const r = await run(supabase.rpc("hub_admin_set_qc", { p_user: p.id, p_on: !p.qc_access }), "QC Release access updated");
    if (r.ok) profiles.reload();
  };
  const setMaterials = async (p, k) => {
    const cur = p.material_lists || [];
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    const r = await run(supabase.rpc("hub_admin_set_materials", { p_user: p.id, p_lists: next }), "Materials access updated");
    if (r.ok) profiles.reload();
  };

  return (
    <div className="admin-pad">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div className="small-muted" style={{ maxWidth: 640 }}>People can create their own account on the sign-in page and wait here for approval. Or add someone directly: no email is sent, so the email limit does not apply.</div>
        <button className="btn-primary" onClick={() => setAdding(true)}>＋ Add user</button>
      </div>
      <div className="day-block-title">Waiting for approval <span className="section-count">{pending.length}</span></div>
      {pending.length === 0 && <div className="small-muted" style={{ marginBottom: 16 }}>No one is waiting.</div>}
      {pending.map((p) => <PendingRow key={p.id} p={p} onApprove={(role) => setUser(p, role, "approved", `${p.full_name} approved`)}
        onReject={async () => { if (await ask({ title: `Reject ${p.full_name}?`, body: "They will not be able to use Velite Hub.", okText: "Reject", danger: true })) setUser(p, "member", "disabled", "Rejected"); }} />)}

      <div className="day-block-title" style={{ marginTop: 18 }}>Team</div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email / mobile</th><th>Role</th><th>Materials</th><th>QC Release</th><th>Batch Detail</th><th>Status</th><th>Approved</th><th></th></tr></thead>
          <tbody>
            {others.map((p) => (
              <tr key={p.id} className={p.status === "disabled" ? "row-off" : ""}>
                <td><strong>{p.full_name}</strong>{p.id === me.id && <span className="small-muted"> (you)</span>}</td>
                <td>{p.email}<div className="small-muted">{p.mobile}</div></td>
                <td>
                  <select className="inp inp-xs" value={p.role} disabled={p.id === me.id}
                    onChange={(e) => setUser(p, e.target.value, p.status, "Role updated")}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td>
                  {p.role === "owner" || p.role === "manager" ? <span className="small-muted">Both lists</span> : (
                    <div title="Can see and add to these material lists. Without a tick, Materials is hidden for this person.">
                      {[["rm", "Raw"], ["pm", "Packing"]].map(([k, l]) => (
                        <label key={k} style={{ display: "block", fontSize: 13 }}>
                          <input type="checkbox" checked={(p.material_lists || []).includes(k)} onChange={() => setMaterials(p, k)} /> {l}
                        </label>))}
                    </div>)}
                </td>
                <td>
                  {p.role === "owner" || p.role === "manager" ? <span className="small-muted">Yes</span> : (
                    <label style={{ fontSize: 13 }} title="Can see, add and edit QC release records. Owners always see everything.">
                      <input type="checkbox" checked={!!p.qc_access} onChange={() => setQc(p)} /> Can use
                    </label>)}
                </td>
                <td>
                  {p.role === "owner" || p.role === "manager" ? <span className="small-muted">Yes</span> : (
                    <label style={{ fontSize: 13 }} title="Production staff: can add and edit batches. QC staff can already look at Batch Detail.">
                      <input type="checkbox" checked={!!p.batch_access} onChange={() => setBatch(p)} /> Can edit
                    </label>)}
                </td>
                <td>{p.status}</td>
                <td className="small-muted">{p.approved_by_name ? `${p.approved_by_name}, ${fmtDateTime(p.approved_at)}` : "—"}</td>
                <td className="nowrap">
                  {p.id !== me.id && (p.status === "approved"
                    ? <button className="restore-btn" onClick={async () => { if (await ask({ title: `Switch off ${p.full_name}?`, body: "Their access stops immediately. Their past entries stay.", okText: "Switch off", danger: true })) setUser(p, p.role, "disabled", "Access switched off"); }}>Disable</button>
                    : <button className="restore-btn" onClick={() => setUser(p, p.role, "approved", "Access restored")}>Enable</button>)}
                  {" "}<button className="restore-btn" onClick={() => setResetFor(p)}>Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-hint" style={{ marginTop: 10 }}>
        Roles: <strong>owner</strong> — everything incl. Business Compass and this Admin page · <strong>manager</strong> and <strong>member</strong> — tasks given to them or by them, the Materials list(s) ticked above, and compliance items assigned to them.
      </div>
      {resetFor && <ResetPassword p={resetFor} onClose={() => setResetFor(null)} />}
      {adding && <AddUser onClose={() => setAdding(false)} onAdded={() => profiles.reload()} />}
      {dialog}
    </div>
  );
}

function PendingRow({ p, onApprove, onReject }) {
  const [role, setRole] = useState("member");
  return (
    <div className="pending-row">
      <div style={{ flex: 1 }}>
        <strong>{p.full_name || "(no name)"}</strong> · {p.email} {p.mobile && `· ${p.mobile}`}
        <div className="small-muted">Signed up {timeAgo(p.created_at)}</div>
      </div>
      <select className="inp inp-xs" value={role} onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => <option key={r}>{r}</option>)}
      </select>
      <button className="btn-primary sm" onClick={() => onApprove(role)}>Approve</button>
      <button className="btn-ghost sm" onClick={onReject}>Reject</button>
    </div>
  );
}

// ── Add a user directly (owner only). Calls the hub-add-user server function; no confirmation email is sent. ──
const PW_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makePassword = () => Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => PW_CHARS[n % PW_CHARS.length]).join("");
async function errorText(error) {
  try { const j = await error.context.json(); if (j?.error) return j.error; } catch { /* fall through */ }
  return error?.message || "Something went wrong. Try again.";
}

function AddUser({ onClose, onAdded }) {
  const [f, setF] = useState({ full_name: "", email: "", mobile: "", role: "member", password: makePassword() });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [show, setShow] = useState(true);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const message = (d) => `Velite Hub login\nWebsite: https://hub.velite.in\nEmail: ${d.email}\nPassword: ${d.password}\nPlease change the password after signing in (click your name at the top right).`;

  const save = async () => {
    if (f.full_name.trim().length < 2) { toast("Write the person's full name.", "err"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) { toast("Check the email address.", "err"); return; }
    if (f.password.length < 8) { toast("The password must be at least 8 characters.", "err"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("hub-add-user", { body: { ...f, email: f.email.trim(), full_name: f.full_name.trim(), mobile: f.mobile.trim() } });
    setBusy(false);
    if (error || data?.error) { toast(error ? await errorText(error) : data.error, "err"); return; }
    toast(`${f.full_name.trim()} added`);
    onAdded();
    setDone({ email: f.email.trim().toLowerCase(), password: f.password, name: f.full_name.trim(), role: f.role });
  };

  if (done) {
    const text = message(done);
    return (
      <Modal title={`✅ ${done.name} can now sign in`} onClose={onClose} actions={<button className="btn-primary" onClick={onClose}>Done</button>}>
        <div className="cmp-alert" style={{ marginBottom: 10 }}>Share these details privately. This password is shown only now. If it is lost, use <b>Reset password</b> in the list.</div>
        <pre className="form-inp" style={{ whiteSpace: "pre-wrap", userSelect: "all" }}>{text}</pre>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => toast("Copied"))}>📋 Copy</button>
          <a className="btn-ghost" style={{ textDecoration: "none" }} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title="Add a user" onClose={onClose} actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Adding…" : "Add user"}</button></>}>
      <div className="form-hint" style={{ marginBottom: 8 }}>The account is created and approved at once. No email is sent.</div>
      <Field label="Full name"><input className="form-inp" autoFocus value={f.full_name} onChange={set("full_name")} /></Field>
      <Field label="Email"><input className="form-inp" type="email" value={f.email} onChange={set("email")} autoComplete="off" /></Field>
      <Field label="Mobile (optional)"><input className="form-inp" value={f.mobile} onChange={set("mobile")} /></Field>
      <Field label="Role" hint="member or manager: tasks, materials and compliance items assigned to them. owner: everything, including Business Compass and this Admin page.">
        <select className="form-inp" value={f.role} onChange={set("role")}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
      </Field>
      {f.role === "owner" && <div className="cmp-alert" style={{ marginBottom: 10 }}>Owners can see everything and manage users. Choose owner only for someone who should.</div>}
      <Field label="Temporary password" hint="Share it privately (for example on WhatsApp). They can change it after signing in.">
        <div style={{ display: "flex", gap: 8 }}>
          <input className="form-inp" type={show ? "text" : "password"} value={f.password} onChange={set("password")} autoComplete="new-password" />
          <button type="button" className="btn-ghost" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
          <button type="button" className="btn-ghost" onClick={() => setF({ ...f, password: makePassword() })}>New</button>
        </div>
      </Field>
    </Modal>
  );
}

function ResetPassword({ p, onClose }) {
  const [pw, setPw] = useState(() => "Velite-" + Math.random().toString(36).slice(2, 8) + "-" + (10 + Math.floor(Math.random() * 89)));
  const save = async () => {
    const r = await run(supabase.rpc("hub_admin_reset_password", { p_user: p.id, p_password: pw }), "Password changed");
    if (r.ok) onClose();
  };
  return (
    <Modal title={`New password for ${p.full_name}`} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Set password</button></>}>
      <Field label="Temporary password" hint="Share it with them privately (e.g. WhatsApp). They can change it after signing in, from their name at the top right.">
        <input className="form-inp" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
    </Modal>
  );
}

function Bin() {
  const { materials, tasks, goals, trademarks, iprNotices, iprThird, iprDocs, iprMatters, qc, batches, isOwner } = useData();
  const [ask, dialog] = useConfirm();
  const items = [
    ...materials.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "material", _table: "hub_materials", _label: r.name, _kind: r.list_type === "rm" ? "Raw material" : "Packing material" })),
    ...batches.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "batch", _table: "hub_batches", _label: `${r.product_name} (${r.batch_no})`, _kind: "Batch" })),
    ...qc.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "qc", _table: "hub_qc_releases", _label: r.item_name, _kind: "QC release record" })),
    ...tasks.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "task", _table: "hub_tasks", _label: r.title, _kind: "Task" })),
    ...trademarks.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "trademark", _table: "hub_trademarks", _label: r.mark, _kind: "Trademark" })),
    ...iprNotices.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "ipr_notice", _table: "hub_ipr_notifications", _label: (r.summary || "").slice(0, 60), _kind: "IPR notification" })),
    ...iprThird.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "ipr_third", _table: "hub_ipr_third_party", _label: `${r.brand} (${r.client})`, _kind: "Third-party brand" })),
    ...iprDocs.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "ipr_doc", _table: "hub_ipr_documents", _label: r.name, _kind: r.kind === "proof" ? "Usage proof" : "IPR document" })),
    ...iprMatters.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "ipr_matter", _table: "hub_ipr_matters", _label: r.title, _kind: "Legal matter" })),
    ...(isOwner ? goals.rows.filter((r) => r.deleted_at).map((r) => ({ ...r, _type: "goal", _table: "hub_goals", _label: r.title, _kind: "Goal" })) : []),
  ].sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));

  const reloadAll = () => { [materials, tasks, goals, trademarks, iprNotices, iprThird, iprDocs, iprMatters, qc, batches].forEach((t) => t.reload()); };
  const restore = async (it) => { const r = await run(supabase.from(it._table).update({ deleted_at: null }).eq("id", it.id), "Restored"); if (r.ok) reloadAll(); };
  const purge = async (it) => {
    if (!(await ask({ title: "Delete forever?", body: `"${it._label}" and its comments will be permanently removed. This cannot be undone.`, okText: "Delete forever", danger: true }))) return;
    const r = await run(supabase.rpc("hub_purge", { p_type: it._type, p_id: it.id }), "Deleted permanently");
    if (r.ok) reloadAll();
  };

  return (
    <div className="admin-pad">
      {items.length === 0 && <Empty>The recycle bin is empty.</Empty>}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Item</th><th>Type</th><th>Deleted by</th><th>When</th><th></th></tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it._type + it.id}>
                <td><strong>{it._label}</strong></td><td>{it._kind}</td><td>{it.deleted_by_name || "—"}</td><td>{fmtDateTime(it.deleted_at)}</td>
                <td className="nowrap"><button className="restore-btn" onClick={() => restore(it)}>↩ Restore</button> <button className="icon-btn" onClick={() => purge(it)} title="Delete forever">🗑</button></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {dialog}
    </div>
  );
}

function Activity() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    supabase.from("hub_activity").select("*").order("at", { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) toast(error.message, "err"); setRows(data || []); });
  }, []);
  if (!rows) return <div className="admin-pad small-muted">Loading…</div>;
  return (
    <div className="admin-pad">
      {rows.length === 0 && <Empty>No activity yet.</Empty>}
      {rows.map((a) => (
        <div key={a.id} className="activity-row">
          <span className="small-muted nowrap">{fmtDateTime(a.at)}</span>
          <span><strong>{a.actor_name}</strong> {a.action} {a.entity_type} <em>{a.summary}</em></span>
        </div>
      ))}
    </div>
  );
}

export function AccountModal({ me, onClose, onSaved }) {
  const [name, setName] = useState(me.full_name || "");
  const [mobile, setMobile] = useState(me.mobile || "");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const save = async () => {
    if (name.trim() !== me.full_name || mobile !== (me.mobile || "")) {
      const r = await run(supabase.rpc("hub_update_my_profile", { p_full_name: name.trim(), p_mobile: mobile.trim() }));
      if (!r.ok) return;
    }
    if (pw) {
      if (pw.length < 8) return toast("Password must be at least 8 characters", "err");
      if (pw !== pw2) return toast("The two passwords don't match", "err");
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) return toast(error.message, "err");
    }
    toast("Saved"); onSaved(); onClose();
  };
  return (
    <Modal title="My account" onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <Field label="Name"><input className="form-inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Mobile"><input className="form-inp" value={mobile} onChange={(e) => setMobile(e.target.value)} /></Field>
      <Field label="Email"><input className="form-inp" value={me.email || ""} disabled /></Field>
      <div className="form-grid">
        <Field label="New password (optional)"><input className="form-inp" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Repeat new password"><input className="form-inp" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      <div className="form-hint">Role: <strong>{me.role}</strong></div>
    </Modal>
  );
}
