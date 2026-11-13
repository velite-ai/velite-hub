import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { DataProvider, Toasts, useData, toast } from "./lib/data";
import Login, { PendingScreen } from "./pages/Login";
import MyDay, { myAlerts, cmpAlerts } from "./pages/MyDay";
import Materials from "./pages/Materials";
import Tasks from "./pages/Tasks";
import Compass from "./pages/Compass";
import Trademarks from "./pages/Trademarks";
import Compliance from "./pages/Compliance";
import Admin, { AccountModal } from "./pages/Admin";
import { timeAgo } from "./lib/dates";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user?.id;
  const loadProfile = useCallback(async () => {
    if (!uid) { setProfile(undefined); return; }
    const { data, error } = await supabase.from("hub_profiles").select("*").eq("id", uid).maybeSingle();
    if (error) toast(error.message, "err");
    setProfile(data || null);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    loadProfile();
    // auto-open the app the moment an owner approves this user
    const ch = supabase.channel(`me-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hub_profiles", filter: `id=eq.${uid}` }, loadProfile)
      .subscribe();
    const iv = setInterval(loadProfile, 60000);
    return () => { supabase.removeChannel(ch); clearInterval(iv); };
  }, [uid, loadProfile]);

  // Log out only this device (default "global" would end the session on every phone and computer too).
  const signOut = () => { if (window.confirm("Log out of Velite Hub on this device?")) supabase.auth.signOut({ scope: "local" }); };

  let body;
  if (session === undefined || (session && profile === undefined)) body = <div className="loading">Loading Velite Hub…</div>;
  else if (!session) body = <Login />;
  else if (!profile || profile.status !== "approved") {
    body = <PendingScreen profile={profile} onSignOut={signOut}
      onRequest={async (name) => {
        const { error } = await supabase.rpc("hub_request_access", { p_full_name: name, p_mobile: "" });
        if (error) toast(error.message, "err"); else loadProfile();
      }} />;
  } else {
    body = <DataProvider me={profile}><Shell onSignOut={signOut} reloadMe={loadProfile} /></DataProvider>;
  }
  return <>{body}<Toasts /></>;
}

function Bell({ alerts, go }) {
  const { notifs } = useData();
  const [open, setOpen] = useState(false);
  const unread = notifs.rows.filter((n) => !n.read_at);
  const markAll = async () => { await supabase.from("hub_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null); notifs.reload(); };
  const click = async (n) => {
    setOpen(false);
    if (!n.read_at) { await supabase.from("hub_notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id); notifs.reload(); }
    if (n.entity_type === "task" && n.entity_id) window.location.hash = `tasks/${n.entity_id}`;
    if (n.entity_type === "material") window.location.hash = "materials";
    if (n.entity_type === "goal") window.location.hash = "compass";
  };
  const icon = { assigned: "📌", helper: "🤝", moved: "↪️", status: "🔄", done: "✅", comment: "💬", due: "⏰", overdue: "🔴", escalated: "⬆️", material: "📦", goal: "🧭" };
  const n = unread.length + alerts;
  return (
    <div className="bell-wrap">
      <button className="bell" title="Notifications" onClick={() => setOpen((o) => !o)}>🔔{n > 0 && <span className="bell-n">{n}</span>}</button>
      {open && <>
        <div className="bell-shade" onClick={() => setOpen(false)} />
        <div className="bell-panel">
          <div className="bell-head"><b>Notifications</b>{unread.length > 0 && <button className="link-btn" onClick={markAll}>Mark all as read</button>}</div>
          {alerts > 0 && <button className="bell-alert" onClick={() => { setOpen(false); go("myday"); }}>⚠️ {alerts} task{alerts === 1 ? "" : "s"} / compliance item{alerts === 1 ? "" : "s"} due today or late — open My Day →</button>}
          <div className="bell-list">
            {notifs.rows.length === 0 && <div className="bell-empty">Nothing yet. You will see here when a task is given to you, changes or gets a comment.</div>}
            {notifs.rows.slice(0, 40).map((x) => (
              <button key={x.id} className={`bell-item ${x.read_at ? "" : "unread"}`} onClick={() => click(x)}>
                <span className="bell-ic">{icon[x.kind] || "🔔"}</span>
                <span className="bell-txt"><span className="bell-t">{x.title}</span>{x.body && <span className="bell-b">{x.body}</span>}
                  <span className="bell-m">{x.actor_name ? `${x.actor_name} · ` : ""}{timeAgo(x.created_at)}</span></span>
              </button>
            ))}
          </div>
        </div>
      </>}
    </div>
  );
}

const TABS = [
  { k: "myday", label: "🏠 My Day" },
  { k: "materials", label: "📦 Materials" },
  { k: "tasks", label: "✅ Tasks" },
  { k: "compliance", label: "🛡️ Compliance" },
  { k: "ipr", label: "⚖️ Trademarks" },
  { k: "compass", label: "🧭 Business Compass", owner: true },
  { k: "admin", label: "⚙️ Admin", owner: true },
];

function useHashTab(allowed) {
  const read = () => { const h = window.location.hash.replace("#", "").split("/")[0]; return allowed.includes(h) ? h : "myday"; };
  const [tab, setTab] = useState(read);
  useEffect(() => { const f = () => setTab(read()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); });
  const go = (k) => { window.location.hash = k; setTab(k); window.scrollTo(0, 0); };
  return [tab, go];
}

function Shell({ onSignOut, reloadMe }) {
  const { me, isOwner, tasks, profiles, cmpItems } = useData();
  const tabs = TABS.filter((t) => !t.owner || isOwner);
  const [tab, go] = useHashTab(tabs.map((t) => t.k));
  const [acct, setAcct] = useState(false);
  const alerts = myAlerts(tasks, me) + cmpAlerts(cmpItems, me);
  const pendingUsers = isOwner ? profiles.rows.filter((p) => p.status === "pending").length : 0;

  return (
    <>
      <div className="header">
        <div className="header-top">
          <div>
            <div className="brand">VELITE <span className="brand-hub">HUB</span></div>
            <span className="brand-loc">Ludhiana</span>
          </div>
          <div className="user-info">
            <Bell alerts={alerts} go={go} />
            <button className="user-badge" onClick={() => setAcct(true)} title="My account">👤 {me.full_name}</button>
            <button className="logout-btn" onClick={onSignOut}>Logout</button>
          </div>
        </div>
        <div className="tabs">
          {tabs.map((t) => (
            <button key={t.k} className={`tab ${tab === t.k ? "active" : ""}`} onClick={() => go(t.k)}>
              {t.label}{t.k === "admin" && pendingUsers > 0 && <span className="tab-n">{pendingUsers}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="page">
        {tab === "myday" && <MyDay go={go} />}
        {tab === "materials" && <Materials />}
        {tab === "tasks" && <Tasks />}
        {tab === "compliance" && <Compliance />}
        {tab === "ipr" && <Trademarks />}
        {tab === "compass" && isOwner && <Compass />}
        {tab === "admin" && isOwner && <Admin />}
      </div>
      {acct && <AccountModal me={me} onClose={() => setAcct(false)} onSaved={() => { reloadMe(); profiles.reload(); }} />}
    </>
  );
}
