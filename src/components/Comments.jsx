import { useState } from "react";
import { supabase } from "../supabase";
import { useData, run } from "../lib/data";
import { fmtDateTime } from "../lib/dates";

export function commentCount(comments, type, id) {
  return comments.rows.filter((c) => c.entity_type === type && c.entity_id === id && !c.deleted_at).length;
}

export function CommentToggle({ type, id, open, onToggle }) {
  const { comments } = useData();
  const n = commentCount(comments, type, id);
  return (
    <button className="icon-btn cb" title="Comments" onClick={onToggle}>
      💬{n > 0 && <span className="cnt">{n}</span>} {open ? "▲" : "▼"}
    </button>
  );
}

export default function Comments({ type, id }) {
  const { comments, me, isOwner } = useData();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = comments.rows.filter((c) => c.entity_type === type && c.entity_id === id && !c.deleted_at);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const r = await run(supabase.from("hub_comments").insert({ entity_type: type, entity_id: id, body }));
    setBusy(false);
    if (r.ok) { setText(""); comments.reload(); }
  };

  const del = async (c) => {
    if (!window.confirm("Delete this comment?")) return;
    await run(supabase.from("hub_comments").update({ deleted_at: new Date().toISOString() }).eq("id", c.id));
    comments.reload();
  };

  return (
    <div className="comments-area">
      {list.length === 0 && <div className="no-comments">No comments yet.</div>}
      {list.map((c) => (
        <div key={c.id} className="comment-item">
          <span className="comment-author">{c.author_name}</span>
          <span className="comment-time">{fmtDateTime(c.created_at)}</span>
          {(c.author_id === me.id || isOwner) && (
            <button className="link-btn" onClick={() => del(c)} title="Delete comment">✕</button>
          )}
          <div className="comment-text">{c.body}</div>
        </div>
      ))}
      <div className="comment-input-row">
        <input className="comment-inp" placeholder="Add a comment…" value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="comment-send" onClick={send} disabled={busy}>Send</button>
      </div>
    </div>
  );
}
