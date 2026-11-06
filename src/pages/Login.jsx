import { useState } from "react";
import { supabase } from "../supabase";

function friendly(msg = "") {
  const m = msg.toLowerCase();
  if (m.includes("email not confirmed")) return "Your account is waiting for an owner to approve it. Please try again after approval.";
  if (m.includes("invalid login")) return "Wrong email or password.";
  if (m.includes("already registered")) return "An account with this email already exists. Please sign in instead.";
  if (m.includes("password")) return msg;
  return msg || "Something went wrong. Please try again.";
}

export default function Login() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMsg({ kind: "err", text: friendly(error.message) });
  };

  const signUp = async (e) => {
    e.preventDefault(); setMsg(null);
    if (name.trim().length < 2) return setMsg({ kind: "err", text: "Please enter your name." });
    if (password.length < 8) return setMsg({ kind: "err", text: "Password must be at least 8 characters." });
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { app: "hub", full_name: name.trim(), mobile: mobile.trim() } },
    });
    setBusy(false);
    if (error) return setMsg({ kind: "err", text: friendly(error.message) });
    if (data?.user && data.user.identities && data.user.identities.length === 0) {
      return setMsg({ kind: "err", text: "An account with this email already exists. Please sign in instead." });
    }
    if (!data.session) {
      setMode("signin");
      setMsg({ kind: "ok", text: "Account created. An owner (Sanjiv, Sangeeta or Piyush) must approve it before you can sign in. You may get a confirmation email — you don't need to click it." });
    }
  };

  return (
    <div className="pin-screen">
      <div className="pin-card login-card">
        <div className="pin-logo">VELITE</div>
        <div className="pin-sub">HUB · LUDHIANA</div>

        <div className="login-tabs">
          <button className={mode === "signin" ? "on" : ""} onClick={() => { setMode("signin"); setMsg(null); }}>Sign in</button>
          <button className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setMsg(null); }}>Create account</button>
        </div>

        <form onSubmit={mode === "signin" ? signIn : signUp}>
          {mode === "signup" && (
            <>
              <input className="login-inp" placeholder="Your name (as colleagues know you)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              <input className="login-inp" placeholder="Mobile (optional)" value={mobile} onChange={(e) => setMobile(e.target.value)} autoComplete="tel" />
            </>
          )}
          <input className="login-inp" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <input className="login-inp" type="password" placeholder={mode === "signup" ? "Choose a password (min 8 characters)" : "Password"}
            value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
          <button className="login-btn" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
        </form>

        {msg && <div className={msg.kind === "err" ? "pin-error" : "login-ok"}>{msg.text}</div>}
        {mode === "signin" && <div className="login-help">Forgot your password? Ask an owner to reset it from Admin → Users.</div>}
      </div>
    </div>
  );
}

export function PendingScreen({ profile, onSignOut, onRequest }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  let body;
  if (!profile) {
    body = (
      <>
        <p className="login-help-strong">This account is not on Velite Hub yet.</p>
        <input className="login-inp" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="login-btn" disabled={busy} onClick={async () => { setBusy(true); await onRequest(name); setBusy(false); }}>Request access</button>
      </>
    );
  } else if (profile.status === "disabled") {
    body = <p className="login-help-strong">Your access has been switched off. Please contact an owner.</p>;
  } else {
    body = <p className="login-help-strong">Hi {profile.full_name || "there"} — your account is waiting for approval by an owner. This page will open automatically once you are approved.</p>;
  }
  return (
    <div className="pin-screen">
      <div className="pin-card login-card">
        <div className="pin-logo">VELITE</div>
        <div className="pin-sub">HUB · LUDHIANA</div>
        {body}
        <button className="logout-btn" style={{ marginTop: 18 }} onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}
