import { useData } from "../../lib/data";
import { fmtDate } from "../../lib/dates";
import { Empty } from "../../components/ui";
import { FIRMS, GAP_STATUSES, Pill, statusClass, days } from "./shared";

function Todo({ color, title, sub, badge, badgeTone, action }) {
  return (
    <div className="todo">
      <i className="dot" style={{ background: color }} />
      <div className="todo-main"><strong>{title}</strong><span>{sub}</span></div>
      {action}
      <Pill tone={badgeTone || (badge === "Red" ? "red" : badge === "Amber" ? "amber" : "blue")}>{badge}</Pill>
    </div>
  );
}

function StatList({ title, counts }) {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="stat-list">
      <div className="srow"><strong>{title}</strong><Pill tone="blue">{entries.length} groups</Pill></div>
      {entries.sort((a, b) => b[1] - a[1]).map(([name, n]) => (
        <div className="srow" key={name}>
          <div style={{ flex: 1 }}><strong>{name || "—"}</strong><div className="bar"><i style={{ width: `${Math.max(12, Math.round((n / max) * 100))}%` }} /></div></div>
          <Pill>{n}</Pill>
        </div>
      ))}
    </div>
  );
}
const groupCount = (list, k) => list.reduce((a, t) => { a[t[k]] = (a[t[k]] || 0) + 1; return a; }, {});

export function Dashboard({ openMark, openNotice, go }) {
  const { trademarks, iprThird, iprNotices } = useData();
  const tms = trademarks.rows.filter((t) => !t.deleted_at);
  const third = iprThird.rows.filter((t) => !t.deleted_at);
  const notices = iprNotices.rows.filter((t) => !t.deleted_at);
  const cards = [
    ["Total Marks", tms.length, "All trademarks and proposed marks", "rgba(37,99,235,.18)"],
    ["Registered", tms.filter((t) => t.status === "Registered").length, "Protected product or brand marks", "rgba(22,163,74,.18)"],
    ["Third-party", third.length, "Client brand responsibility records", "rgba(8,145,178,.18)"],
    ["IPR Notices", notices.length, "Personal Care reference items", "rgba(124,58,237,.18)"],
  ];
  // Category & company coverage (as in the old app: first 6 categories)
  const cats = Array.from(new Set(tms.map((t) => t.category))).slice(0, 6);
  const cos = ["Velite Pharmaceuticals", "Velite Healthcare", "Velite India", "Future Filing"];
  const cell = (cat, co) => {
    if (co === "Future Filing") {
      const need = tms.some((t) => t.category === cat && GAP_STATUSES.includes(t.status));
      return <span className={need ? "cell-needed" : "cell-registered"}>{need ? "Needed" : "Ok"}</span>;
    }
    const items = tms.filter((t) => t.category === cat && t.company === co);
    if (items.some((t) => t.status === "Registered")) return <span className="cell-registered">Registered</span>;
    if (items.some((t) => t.status === "Filed")) return <span className="cell-filed">Filed</span>;
    if (items.some((t) => t.status === "Objected")) return <span className="cell-risk">Objected</span>;
    if (items.length) return <span className="cell-watch">Watch</span>;
    return <span className="cell-needed">Gap</span>;
  };
  const urgent = tms.filter((t) => t.risk !== "Green" || days(t.deadline) <= 60).sort((a, b) => days(a.deadline) - days(b.deadline)).slice(0, 5);
  const gaps = tms.filter((t) => GAP_STATUSES.includes(t.status));
  const latest = [...notices].sort((a, b) => (b.notice_date || "").localeCompare(a.notice_date || "")).slice(0, 3);
  const edit = (t) => <button className="action-btn" onClick={() => openMark(t)}>Edit</button>;

  return (
    <>
      <div className="icards">
        {cards.map(([a, n, s, tone]) => (
          <article key={a} className="metric" style={{ background: `linear-gradient(135deg, ${tone}, #fff 70%)` }}>
            <span>{a}</span><strong>{n}</strong><small>{s}</small>
          </article>
        ))}
      </div>
      <div className="ilayout">
        <div>
          <div className="ipanel">
            <div className="ipanel-head"><div><h3>Portfolio Snapshot</h3><p>Live view of the current register data.</p></div></div>
            <div className="isplit"><StatList title="Company-wise ownership" counts={groupCount(tms, "company")} /><StatList title="Category-wise coverage" counts={groupCount(tms, "category")} /></div>
          </div>
          <div className="ipanel">
            <div className="ipanel-head"><div><h3>Category & Company Coverage</h3><p>Quickly shows future filing gaps by product category and Velite entity.</p></div></div>
            <div className="coverage-grid">
              <div className="coverage-row head"><span />{cos.map((c) => <span key={c}>{c.replace("Velite ", "")}</span>)}</div>
              {cats.map((cat) => <div className="coverage-row" key={cat}><span className="row-label">{cat}</span>{cos.map((co) => <span key={co}>{cell(cat, co)}</span>)}</div>)}
            </div>
          </div>
        </div>
        <aside>
          <div className="ipanel">
            <div className="ipanel-head"><div><h3>Urgent Actions</h3><p>Next legal or management tasks.</p></div></div>
            <div className="timeline">
              {urgent.length === 0 && <Empty>Nothing urgent.</Empty>}
              {urgent.map((t) => <Todo key={t.id} color={t.risk === "Red" ? "#dc2626" : "#d97706"} title={`${t.mark}: ${t.status}`}
                sub={`${t.company} | ${t.category} | Due ${t.deadline ? fmtDate(t.deadline) : "not set"}`} badge={t.risk} action={edit(t)} />)}
            </div>
          </div>
          <div className="ipanel">
            <div className="ipanel-head"><div><h3>Filing Gaps</h3><p>Products or categories needing attention.</p></div></div>
            <div className="timeline">
              {gaps.length === 0 && <Empty>No filing gaps marked right now.</Empty>}
              {gaps.map((t) => <Todo key={t.id} color="#7c3aed" title={`${t.category}: ${t.mark}`} sub={`${(t.products || []).join(", ")} | ${t.company}`} badge={t.status} badgeTone="blue" action={edit(t)} />)}
            </div>
          </div>
          <div className="ipanel">
            <div className="ipanel-head"><div><h3>Personal Care Notices</h3><p>IPR notifications saved for future reference.</p></div>
              <button className="link-btn strong" onClick={() => go("notifications")}>All →</button></div>
            <div className="timeline">
              {latest.length === 0 && <Empty>No Personal Care IPR notifications saved yet.</Empty>}
              {latest.map((n) => <Todo key={n.id} color={n.priority === "Urgent" ? "#dc2626" : n.priority === "Important" ? "#d97706" : "#2563eb"}
                title={`${n.type}: ${n.mark || "Personal Care"}`} sub={`${n.category} | ${fmtDate(n.notice_date)}${n.follow_up ? ` | Follow-up ${fmtDate(n.follow_up)}` : ""}`}
                badge={n.priority} badgeTone={n.priority === "Urgent" ? "red" : n.priority === "Important" ? "amber" : "blue"}
                action={<button className="action-btn" onClick={() => openNotice(n)}>Edit</button>} />)}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function Products({ openMark }) {
  const { trademarks } = useData();
  const rows = trademarks.rows.filter((t) => !t.deleted_at)
    .sort((a, b) => a.mark.localeCompare(b.mark))
    .flatMap((t) => (t.products || []).map((p) => ({ ...t, product: p })));
  const decision = (s) => s === "Registered" ? "Maintain proof" : s === "Filed" ? "Track application" : s === "Objected" ? "File reply" : s === "Search Pending" ? "Complete search" : "Consider filing";
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>Products & Category Decisions</h3><p>Shows products connected to trademarks and names that may need filing.</p></div></div>
      <div className="table-wrap">
        <table className="tbl itbl">
          <thead><tr><th>Product</th><th>Category</th><th>Trademark</th><th>Company</th><th>Protection</th><th>Decision</th><th>Action</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7}><Empty>No product links added yet. Add a trademark record with existing products to build this view.</Empty></td></tr>}
            {rows.map((r, i) => (
              <tr key={r.id + i}>
                <td><strong>{r.product}</strong></td><td><Pill>{r.category}</Pill></td><td>{r.mark}</td><td>{r.company}</td>
                <td><Pill tone={statusClass(r.status)}>{r.status}</Pill></td><td>{decision(r.status)}</td>
                <td><button className="action-btn" onClick={() => openMark(r)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Actions({ openMark, openMatter, canEdit }) {
  const { trademarks, iprMatters } = useData();
  const items = trademarks.rows.filter((t) => !t.deleted_at).sort((a, b) => days(a.deadline) - days(b.deadline));
  const matters = iprMatters.rows.filter((m) => !m.deleted_at).sort((a, b) => (a.status === b.status ? days(a.due) - days(b.due) : a.status === "Open" ? -1 : 1));
  return (
    <div className="isplit">
      <div className="ipanel">
        <div className="ipanel-head"><div><h3>Deadlines</h3><p>Renewal, objection, opposition, search, and filing tasks.</p></div></div>
        <div className="timeline">
          {items.length === 0 && <Empty>No deadlines added yet.</Empty>}
          {items.map((t) => {
            const n = days(t.deadline);
            const color = n <= 15 || t.risk === "Red" ? "#dc2626" : n <= 60 ? "#d97706" : "#16a34a";
            return <Todo key={t.id} color={color} title={`${t.mark}: ${t.status}`} sub={`${t.category} | ${t.attorney} | ${t.deadline ? fmtDate(t.deadline) : "No deadline"}`}
              badge={!t.deadline ? "No date" : n < 0 ? "Late" : `${n} days`} badgeTone={n < 0 ? "red" : n <= 60 ? "amber" : "green"}
              action={<button className="action-btn" onClick={() => openMark(t)}>Edit</button>} />;
          })}
        </div>
      </div>
      <div className="ipanel">
        <div className="ipanel-head"><div><h3>Matter Tracker</h3><p>Open legal or attorney-led matters.</p></div>
          {canEdit && <button className="add-btn" onClick={() => openMatter({})}>+ Add Matter</button>}</div>
        <div className="timeline">
          {matters.length === 0 && <Empty>No legal matters added yet.</Empty>}
          {matters.map((m) => <Todo key={m.id} color={m.status === "Closed" ? "#9ca3af" : m.risk === "Red" ? "#dc2626" : "#d97706"}
            title={`${m.title}${m.status === "Closed" ? " (closed)" : ""}`} sub={`${m.mark || "—"} | ${m.owner || "—"} | Due ${m.due ? fmtDate(m.due) : "not set"}`}
            badge={m.risk} action={<button className="action-btn" onClick={() => openMatter(m)}>{canEdit ? "Edit" : "View"}</button>} />)}
        </div>
      </div>
    </div>
  );
}

export function Reports() {
  const { trademarks, iprThird, iprNotices, iprDocs } = useData();
  const tms = trademarks.rows.filter((t) => !t.deleted_at);
  const third = iprThird.rows.filter((t) => !t.deleted_at);
  const notices = iprNotices.rows.filter((t) => !t.deleted_at);
  const docs = iprDocs.rows.filter((t) => !t.deleted_at && t.kind === "document");
  const proof = iprDocs.rows.filter((t) => !t.deleted_at && t.kind === "proof");
  const R = ({ label, n, tone }) => <div className="srow"><strong>{label}</strong><Pill tone={tone}>{n}</Pill></div>;
  return (
    <div className="ipanel">
      <div className="ipanel-head"><div><h3>Management Reports</h3><p>Ready summaries for Velite management review. Use “PDF Report” or “Excel Sheet” above for the full report.</p></div></div>
      <div className="isplit">
        <div className="stat-list">
          <R label="Category-wise trademark report" n={`${new Set(tms.map((t) => t.category)).size} categories`} tone="blue" />
          <R label="Company-wise ownership report" n={`${new Set(tms.map((t) => t.company)).size} companies`} tone="blue" />
          <R label="Products not yet protected" n={tms.filter((t) => ["Filing Needed", "Search Pending"].includes(t.status)).length} tone="amber" />
          <R label="Class-wise coverage" n={`${new Set(tms.map((t) => t.class_no)).size} classes`} tone="green" />
          <R label="Third-party brand records" n={third.length} tone="cyan" />
          <R label="Missing undertakings" n={third.filter((t) => t.status === "Not Applied" && !t.undertaking_name).length} tone="red" />
        </div>
        <div className="stat-list">
          <R label="Red risk matters" n={tms.filter((t) => t.risk === "Red").length} tone="red" />
          <R label="Amber follow-ups" n={tms.filter((t) => t.risk === "Amber").length} tone="amber" />
          <R label="Documents stored" n={docs.length} tone="blue" />
          <R label="Usage proof items" n={proof.length} tone="green" />
          <R label="Personal Care IPR notifications" n={notices.length} tone="rose" />
          <R label="Urgent notifications" n={notices.filter((n) => n.priority === "Urgent").length} tone="red" />
        </div>
      </div>
      <div className="isplit" style={{ marginTop: 14 }}>
        <div className="stat-list">
          <div className="srow"><strong>Marks by company and status</strong></div>
          {FIRMS.map((co) => {
            const l = tms.filter((t) => t.company === co);
            if (!l.length) return null;
            const by = groupCount(l, "status");
            return <div className="srow" key={co}><span>{co}</span><span>{Object.entries(by).map(([s, n]) => <Pill key={s} tone={statusClass(s)}>{s} {n}</Pill>)}</span></div>;
          })}
        </div>
        <StatList title="Class-wise coverage" counts={Object.fromEntries(Object.entries(groupCount(tms, "class_no")).map(([k, v]) => [`Class ${k}`, v]))} />
      </div>
    </div>
  );
}
