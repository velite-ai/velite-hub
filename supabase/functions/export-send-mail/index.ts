// Velite Hub, Export: sends the signed proforma to the party and keeps a log of it.
// Only a signed-in, approved owner (or a person ticked for Export) may call this. The mail goes through Resend from the verified
// domain velite.in; the Gmail sender choice is sent via velite.in with the Gmail as the reply address. Velite is always copied.
// Secret needed: RESEND_API_KEY (a sending-only key).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const ALLOWED_ORIGINS = ["https://hub.velite.in"];
const CC_ALWAYS = "velite@velite.in";
const SENDERS: Record<string, { from: string; replyTo: string }> = {
  thirdparty: { from: "thirdparty@velite.in", replyTo: "thirdparty@velite.in" },
  tp2: { from: "thirdparty@velite.in", replyTo: "tp2.velite@gmail.com" },
};
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_FILE = 20 * 1024 * 1024;

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const reply = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const addrs = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, 405, { error: "Use POST" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY");

  // 1. who is calling, and may they use Export?
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return reply(req, 401, { error: "Please sign in" });
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  if (whoErr || !who?.user) return reply(req, 401, { error: "Please sign in again" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: me } = await admin.from("hub_profiles").select("id, full_name, role, status, export_access").eq("id", who.user.id).maybeSingle();
  if (!me || me.status !== "approved" || !(me.role === "owner" || me.export_access)) return reply(req, 403, { error: "Only people with Export access can send mail" });
  if (!resendKey) return reply(req, 500, { error: "The mail key is not set up yet. Ask the Hub owner to add RESEND_API_KEY." });

  // 2. check what was sent
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply(req, 400, { error: "Bad request" }); }
  const sender = SENDERS[String(b.sender ?? "")];
  if (!sender) return reply(req, 400, { error: "Choose which email address to send from." });
  const to = [...new Set(addrs(b.to))];
  const cc = [...new Set([CC_ALWAYS, ...addrs(b.cc)])].filter((x) => !to.includes(x));
  if (!to.length || to.length > 5) return reply(req, 400, { error: "Enter one to five recipient addresses." });
  if (cc.length > 6) return reply(req, 400, { error: "Too many copy addresses." });
  for (const a of [...to, ...cc]) if (a.length > 254 || !EMAIL.test(a)) return reply(req, 400, { error: `The address ${a} does not look right.` });
  const subject = String(b.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const body = String(b.body ?? "").trim();
  if (subject.length < 3 || subject.length > 200) return reply(req, 400, { error: "Write a subject (up to 200 letters)." });
  if (body.length < 5 || body.length > 10000) return reply(req, 400, { error: "Write the message (up to 10,000 letters)." });

  // 3. the shipment and the signed copy to attach
  const shipmentId = String(b.shipment_id ?? ""); const attachmentId = String(b.attachment_id ?? "");
  const { data: ship } = await admin.from("exp_shipments").select("id, firm_id, proforma_no").eq("id", shipmentId).maybeSingle();
  if (!ship) return reply(req, 404, { error: "That shipment was not found." });
  const { data: att } = await admin.from("exp_attachments").select("id, shipment_id, kind, file_path, file_name").eq("id", attachmentId).maybeSingle();
  if (!att || att.shipment_id !== shipmentId || att.kind !== "signed_proforma" || !att.file_path) return reply(req, 400, { error: "Attach the signed and stamped proforma first." });
  const { data: file, error: dlErr } = await admin.storage.from("export").download(att.file_path);
  if (dlErr || !file) return reply(req, 500, { error: "The signed proforma could not be read from storage." });
  if (file.size > MAX_FILE) return reply(req, 400, { error: "The signed proforma is larger than 20 MB. Save it smaller and upload it again." });
  const content = encodeBase64(new Uint8Array(await file.arrayBuffer()));
  const { data: firm } = await admin.from("exp_firms").select("name").eq("id", ship.firm_id).maybeSingle();
  const fromName = String(firm?.name ?? "Velite").replace(/[^A-Za-z0-9 .&-]/g, "").trim() || "Velite";
  const fromAddr = `${fromName} <${sender.from}>`;

  // 4. send
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${esc(body).replace(/\n/g, "<br>")}</div>`;
  let status = "sent", error: string | null = null, providerId: string | null = null;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddr, to, cc, reply_to: sender.replyTo, subject, text: body, html, attachments: [{ filename: att.file_name ?? "proforma.pdf", content }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.id) providerId = String(j.id); else { status = "failed"; error = String(j?.message ?? `Mail service answered ${r.status}`).slice(0, 500); }
  } catch (e) { status = "failed"; error = `Could not reach the mail service: ${String((e as Error)?.message ?? e)}`.slice(0, 500); }

  // 5. keep the log (a failed try is kept too)
  const { data: row } = await admin.from("exp_emails").insert({
    shipment_id: shipmentId, kind: "proforma", sender: String(b.sender), from_addr: fromAddr, reply_to: sender.replyTo, to_addrs: to, cc_addrs: cc, subject, body,
    attachment_id: att.id, attachment_name: att.file_name, status, error, provider_id: providerId, sent_by: me.id, sent_by_name: me.full_name,
  }).select("id").single();
  console.log("export-send-mail:", status, "shipment", shipmentId, "by", me.id, error ?? "");
  if (status !== "sent") return reply(req, 502, { error: `The email was not sent: ${error}`, id: row?.id });
  return reply(req, 200, { ok: true, id: row?.id });
});
