// Copy files from Google Drive into the Hub's own file store.
// The browser signs in to Google (read-only Drive permission), downloads the file
// and uploads it with the user's normal Hub login. No Google password or secret is stored.
import { supabase } from "../supabase";

const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
let token = null; // { value, expires }
let gisLoading = null;

export async function getClientId() {
  const { data } = await supabase.from("hub_cmp_settings").select("v").eq("k", "google_client_id").maybeSingle();
  return (data?.v || "").trim();
}

export async function saveClientId(v) {
  const { error } = await supabase.from("hub_cmp_settings").upsert({ k: "google_client_id", v: v.trim() });
  return !error;
}

// Pull the file id out of any Drive / Docs link (or accept a bare id)
export function driveId(link) {
  if (!link) return null;
  const s = String(link).trim();
  const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/[?&]id=([\w-]{20,})/) || s.match(/^([\w-]{25,})$/);
  return m ? m[1] : null;
}
export const isDriveLink = (link) => /drive\.google\.com|docs\.google\.com/.test(link || "") && !!driveId(link);

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) gisLoading = new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = ok; s.onerror = () => { gisLoading = null; fail(new Error("Could not load Google sign-in")); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

// Asks Google once (a popup); reuses the permission for about 50 minutes.
export async function driveToken(clientId) {
  if (token && token.expires > Date.now()) return token.value;
  await loadGis();
  return new Promise((ok, fail) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return fail(new Error(r.error_description || r.error || "Google sign-in was cancelled"));
        token = { value: r.access_token, expires: Date.now() + (Number(r.expires_in || 3600) - 600) * 1000 };
        ok(token.value);
      },
      error_callback: (e) => fail(new Error(e?.message || "Google sign-in window was closed")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

// Download one Drive file and return it as a browser File (Google Docs/Sheets become PDF)
export async function fetchDriveFile(link, tok) {
  const id = driveId(link);
  if (!id) throw new Error("Not a Google Drive link");
  const api = "https://www.googleapis.com/drive/v3/files/" + id;
  const h = { Authorization: "Bearer " + tok };
  const metaRes = await fetch(api + "?fields=name,mimeType,size&supportsAllDrives=true", { headers: h });
  if (!metaRes.ok) throw new Error(metaRes.status === 404 ? "File not found or no access" : "Drive error " + metaRes.status);
  const meta = await metaRes.json();
  const native = meta.mimeType?.startsWith("application/vnd.google-apps.");
  const url = native ? api + "/export?mimeType=application/pdf" : api + "?alt=media&supportsAllDrives=true";
  const res = await fetch(url, { headers: h });
  if (!res.ok) throw new Error("Download failed (" + res.status + ")");
  const blob = await res.blob();
  const name = native && !/\.pdf$/i.test(meta.name) ? meta.name + ".pdf" : meta.name;
  return new File([blob], name, { type: native ? "application/pdf" : (meta.mimeType || blob.type) });
}

// Where a paper's file belongs in the store (same folders the upload buttons use)
export function folderFor(doc) {
  if (doc.parent_type === "licence") return `${doc.firm_id}/licences/${doc.parent_id}`;
  if (doc.parent_type === "check") return `${doc.firm_id}/checklist/${doc.parent_id.split("|")[1] || "misc"}`;
  return `${doc.firm_id}/${doc.parent_type}/${doc.parent_id}`;
}
