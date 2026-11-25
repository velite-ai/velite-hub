import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { run, toast } from "../lib/data";
import { Modal, Field, Empty, SearchBox, useConfirm } from "../components/ui";
import { saveAttachment, openFile } from "./ExportAudit";
import { SENDERS, CC_ALWAYS, parseEmails, proformaMail } from "../lib/exportMail";
import { totals } from "../lib/shipment";

const stamp = (t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const SENDER_KEY = "exp-mail-sender";
const readSender = () => { try { const v = localStorage.getItem(SENDER_KEY); return SENDERS.some((s) => s.k === v) ? v : SENDERS[0].k; } catch { return SENDERS[0].k; } };

// the mails sent from the Hub (all of them, or those of one shipment)
export function useEmails(shipmentId) {
  const [rows, setRows] = useState(null);
  const load = async () => {
    let q = supabase.from("exp_emails").select("*").order("sent_at", { ascending: false }).limit(300); if (shipmentId) q = q.eq("shipment_id", shipmentId);
    const { data } = await q; setRows(data || []);
  };
  useEffect(() => { load(); }, [shipmentId]); // eslint-disable-line
  return [rows, load];
}

export function MailView({ mail, onClose }) {
  return (
    <Modal wide title={mail.subject} onClose={onClose} actions={<button className="btn-primary" onClick={onClose}>Close</button>}>
      <div className="small-muted" style={{ marginBottom: 6 }}>{stamp(mail.sent_at)} · sent by {mail.sent_by_name || "—"} · {mail.status === "sent" ? "✅ sent" : `⛔ not sent: ${mail.error || ""}`}</div>
      <div className="ex-facts" style={{ gridTemplateColumns: "1fr" }}>
        <span><b>From</b> {mail.from_addr}</span><span><b>Replies go to</b> {mail.reply_to}</span><span><b>To</b> {(mail.to_addrs || []).join(", ")}</span><span><b>Copy</b> {(mail.cc_addrs || []).join(", ") || "—"}</span>
        <span><b>Attachment</b> {mail.attachment_name || "—"}</span></div>
      <pre className="ex-mailbody">{mail.body}</pre>
    </Modal>
  );
}

function MailList({ rows, onOpen, shipments }) {
  if (rows == null) return <div className="small-muted">Loading…</div>;
  if (!rows.length) return <Empty>No email has been sent from the Hub yet.</Empty>;
  return (
    <div className="table-wrap"><table className="tbl qc-tbl"><thead><tr><th>Sent</th><th>Subject</th><th>To</th><th>From</th><th>Shipment</th><th></th></tr></thead>
      <tbody>{rows.map((m) => { const sh = shipments?.find((x) => x.id === m.shipment_id); return (
        <tr key={m.id} className="qc-tr" onClick={() => onOpen(m)}><td className="nowrap">{stamp(m.sent_at)}</td><td>{m.subject}</td><td>{(m.to_addrs || []).join(", ")}</td><td>{m.reply_to}</td><td>{sh ? (sh.proforma_no || sh.invoice_no) : "—"}</td>
          <td>{m.status === "sent" ? "✅" : "⛔"}</td></tr>); })}</tbody></table></div>
  );
}

// Export → Sent emails
export function SentEmails({ shipments }) {
  const [rows] = useEmails(null); const [q, setQ] = useState(""); const [open, setOpen] = useState(null);
  const list = useMemo(() => { const s = q.trim().toLowerCase(); return (rows || []).filter((m) => !s || [m.subject, (m.to_addrs || []).join(" "), m.sent_by_name, m.reply_to].join(" ").toLowerCase().includes(s)); }, [rows, q]);
  return (
    <>
      <div className="qc-filters" style={{ marginBottom: 8 }}><div className="rg-search" style={{ flex: 1, minWidth: 220 }}><SearchBox value={q} onChange={setQ} placeholder="🔎 Search subject, recipient, sender…" /></div></div>
      <div className="small-muted" style={{ marginBottom: 6 }}>Every mail sent from the Hub, with the proforma that went with it. Mail is sent only through the Hub.</div>
      <MailList rows={rows == null ? null : list} onOpen={setOpen} shipments={shipments} />
      {open && <MailView mail={open} onClose={() => setOpen(null)} />}
    </>
  );
}

// On the proforma: save the signed and stamped copy, then send it to the party
export function SendProforma({ ship, party, firm, lines, atts, reloadAtts }) {
  const [ask, dialog] = useConfirm();
  const signed = useMemo(() => atts.filter((a) => a.kind === "signed_proforma").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")), [atts]);
  const [file, setFile] = useState(null); const [upBusy, setUpBusy] = useState(false);
  const [sender, setSender] = useState(readSender); const [attId, setAttId] = useState("");
  const tot = useMemo(() => totals(lines), [lines]);
  const cover = useMemo(() => proformaMail({ firm, party, shipment: ship, items: lines.filter((l) => Number(l.qty)).length, total: tot.amount }), [firm, party, ship, lines, tot]);
  const [to, setTo] = useState(party?.email || ""); const [cc, setCc] = useState(""); const [subject, setSubject] = useState(cover.subject); const [body, setBody] = useState(cover.body);
  const [busy, setBusy] = useState(false); const [mails, reloadMails] = useEmails(ship.id); const [open, setOpen] = useState(null);
  useEffect(() => { setTo(party?.email || ""); }, [party?.id]); // eslint-disable-line
  useEffect(() => { if (!attId && signed[0]) setAttId(signed[0].id); }, [signed.length]); // eslint-disable-line
  const pick = (k) => { setSender(k); try { localStorage.setItem(SENDER_KEY, k); } catch { /* ignore */ } };
  const S = SENDERS.find((x) => x.k === sender) || SENDERS[0];

  const upload = async () => {
    if (!file) return; setUpBusy(true);
    const ok = await saveAttachment(ship.id, "signed_proforma", file, { ref_no: ship.proforma_no, doc_date: new Date().toISOString().slice(0, 10), notes: "Signed and stamped, as sent to the party" });
    setUpBusy(false); if (ok) { toast("Signed proforma saved"); setFile(null); reloadAtts(); }
  };
  const removeSigned = async (a) => {
    if (!(await ask({ title: "Remove this signed copy?", body: "The file is deleted. Mails already sent keep their record.", okText: "Remove", danger: true }))) return;
    if (a.file_path) await supabase.storage.from("export").remove([a.file_path]);
    const r = await run(supabase.from("exp_attachments").delete().eq("id", a.id), "Removed"); if (r.ok) { setAttId(""); reloadAtts(); }
  };
  const send = async () => {
    const t = parseEmails(to), c = parseEmails(cc);
    if (!attId) { toast("Save the signed and stamped proforma first", "err"); return; }
    if (!t.list.length) { toast("Enter the party's email address", "err"); return; }
    if (t.bad.length || c.bad.length) { toast(`These do not look like email addresses: ${[...t.bad, ...c.bad].join(", ")}`, "err"); return; }
    const all = [...new Set([...c.list, CC_ALWAYS])].filter((x) => !t.list.includes(x));
    if (!(await ask({ title: "Send the proforma now?", body: `From ${S.label}\nTo: ${t.list.join(", ")}\nCopy: ${all.join(", ")}\nAttached: ${signed.find((a) => a.id === attId)?.file_name || "signed proforma"}\nA mail cannot be taken back once sent.`, okText: "Send" }))) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("export-send-mail", { body: { shipment_id: ship.id, attachment_id: attId, sender, to: t.list, cc: c.list, subject, body } });
    setBusy(false);
    if (error) { let msg = error.message; try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* keep the generic text */ } toast(msg, "err"); reloadMails(); return; }
    toast("Email sent"); reloadMails();
  };

  return (
    <div className="ipanel"><div className="ipanel-head"><div><h3>After printing: signed copy and email</h3><p>Sign and stamp the printout, scan it, save it here, then send it to the party from the Hub. Mail is sent only through the Hub, and Velite is always copied.</p></div></div>
      <div className="form-label">1 · Signed and stamped proforma</div>
      {signed.length === 0 && <div className="small-muted">Not saved yet.</div>}
      {signed.map((a) => <div key={a.id} className="qc-row"><span className="qc-row-main"><b>{a.file_name}</b><small>saved {stamp(a.created_at)} by {a.created_by_name}</small></span>
        <button className="btn-ghost sm" onClick={() => openFile(a.file_path)}>Open</button><button className="btn-ghost sm" onClick={() => removeSigned(a)}>Remove</button></div>)}
      <div className="qc-filters" style={{ marginTop: 6 }}><input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ flex: 1 }} />
        <button className="btn-primary sm" onClick={upload} disabled={!file || upBusy}>{upBusy ? "Saving…" : "Save the signed copy"}</button></div>

      <div className="form-label" style={{ marginTop: 12 }}>2 · Send by email</div>
      <div className="ex-grid">
        <Field label="Send from"><select className="form-inp" value={sender} onChange={(e) => pick(e.target.value)}>{SENDERS.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select></Field>
        <Field label="Attach"><select className="form-inp" value={attId} onChange={(e) => setAttId(e.target.value)}><option value="">{signed.length ? "Choose…" : "Save the signed copy first"}</option>{signed.map((a) => <option key={a.id} value={a.id}>{a.file_name}</option>)}</select></Field>
        <Field label="To" hint="Party's email from Parties; add more with commas."><input className="form-inp" value={to} onChange={(e) => setTo(e.target.value)} placeholder="party@example.com" /></Field>
        <Field label="Copy" hint={`${CC_ALWAYS} is always copied. Add others here if needed.`}><input className="form-inp" value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
      </div>
      <div className="small-muted">{sender === "tp2" ? `The mail leaves from thirdparty@velite.in. The party’s reply goes to ${S.replyTo}.` : `The mail leaves from ${S.from}; replies come to ${S.replyTo}.`}</div>
      <Field label="Subject"><input className="form-inp" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Message (written automatically, change it if you like)"><textarea className="form-inp" rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="qc-filters"><button className="btn-ghost sm" onClick={() => { setSubject(cover.subject); setBody(cover.body); }}>↺ Write the text again</button><span style={{ flex: 1 }} />
        <button className="btn-primary" onClick={send} disabled={busy || !signed.length}>{busy ? "Sending…" : "✉️ Send the proforma"}</button></div>

      <div className="form-label" style={{ marginTop: 12 }}>3 · Sent from the Hub for this shipment</div>
      <MailList rows={mails} onOpen={setOpen} shipments={[ship]} />
      {open && <MailView mail={open} onClose={() => setOpen(null)} />}
      {dialog}
    </div>
  );
}
