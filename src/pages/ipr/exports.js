// PDF report and multi-sheet Excel export — same layout as the old ipr.velite.in app
const safe = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const xml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

function download(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function reportRows({ trademarks, notices, third, docs, proof, matters }) {
  const tms = [...trademarks].sort((a, b) => String(a.mark || "").localeCompare(String(b.mark || ""), undefined, { sensitivity: "base" }));
  return {
    trademarks: tms.map((t) => ({ Mark: t.mark, Products: (t.products || []).join(", "), Category: t.category, Company: t.company,
      Class: t.class_no, Status: t.status, Application: t.app_no, UseSince: t.use_since || "", Deadline: t.deadline || "",
      Risk: t.risk, Attorney: t.attorney, ImageMark: t.image_name || "", Notes: t.notes })),
    products: tms.flatMap((t) => (t.products || []).map((p) => ({ Product: p, Category: t.category, Trademark: t.mark,
      Company: t.company, Protection: t.status, Class: t.class_no }))),
    notifications: notices.map((n) => ({ Date: n.notice_date, Type: n.type, Mark: n.mark || "Personal Care", Category: n.category,
      Priority: n.priority, FollowUp: n.follow_up || "", Summary: n.summary })),
    thirdParty: third.map((t) => ({ Client: t.client, Brand: t.brand, Products: (t.products || []).join(", "), Category: t.category,
      Status: t.status, Application: t.app_no, Class: t.class_no, Contact: t.contact, UndertakingDate: t.undertaking_date || "",
      UndertakingFile: t.undertaking_name || "", Responsibility: t.responsibility })),
    documents: docs.map((d) => ({ Document: d.name, Trademark: d.mark, Type: d.doc_type, UploadedBy: d.created_by_name, Review: d.review })),
    proof: proof.map((p) => ({ Proof: p.name, Trademark: p.mark, Product: p.product, Channel: p.channel, Date: p.doc_date || "" })),
    matters: matters.map((m) => ({ Matter: m.title, Mark: m.mark, Owner: m.owner, Due: m.due || "", Risk: m.risk, Status: m.status })),
  };
}

export function exportExcel(src) {
  const r = reportRows(src);
  const { trademarks, notices, third, docs, proof } = src;
  const summary = [
    { Particular: "Total trademarks/proposed marks", Count: trademarks.length },
    { Particular: "Registered marks", Count: trademarks.filter((t) => t.status === "Registered").length },
    { Particular: "Risk / pending items", Count: trademarks.filter((t) => t.risk !== "Green").length },
    { Particular: "Personal Care IPR notifications", Count: notices.length },
    { Particular: "Third-party brand records", Count: third.length },
    { Particular: "Third-party missing undertakings", Count: third.filter((t) => t.status === "Not Applied" && !t.undertaking_name).length },
    { Particular: "Documents stored", Count: docs.length },
    { Particular: "Usage proof items", Count: proof.length },
  ];
  const book = { Summary: summary, Trademarks: r.trademarks, Products: r.products, Notifications: r.notifications,
    ThirdParty: r.thirdParty, Documents: r.documents, UsageProof: r.proof, Matters: r.matters };
  const sheets = Object.entries(book).map(([name, rows]) => {
    const headers = rows.length ? Object.keys(rows[0]) : ["NoData"];
    const head = headers.map((h) => `<Cell><Data ss:Type="String">${xml(h)}</Data></Cell>`).join("");
    const body = rows.length
      ? rows.map((row) => `<Row>${headers.map((h) => `<Cell><Data ss:Type="String">${xml(row[h])}</Data></Cell>`).join("")}</Row>`).join("")
      : `<Row><Cell><Data ss:Type="String">No records added yet</Data></Cell></Row>`;
    return `<Worksheet ss:Name="${xml(name).slice(0, 31)}"><Table><Row>${head}</Row>${body}</Table></Worksheet>`;
  }).join("");
  const out = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n xmlns:o="urn:schemas-microsoft-com:office:office"\n xmlns:x="urn:schemas-microsoft-com:office:excel"\n xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n${sheets}\n</Workbook>`;
  download("velite-ipr-report.xls", "application/vnd.ms-excel;charset=utf-8", out);
}

function tableHtml(title, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : ["Status"];
  const show = rows.length ? rows : [{ Status: "No records added yet" }];
  return `<section><h2>${safe(title)}</h2><table><thead><tr>${headers.map((h) => `<th>${safe(h)}</th>`).join("")}</tr></thead>
    <tbody>${show.map((row) => `<tr>${headers.map((h) => `<td>${safe(row[h])}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
}

export function exportPdf(src) {
  const r = reportRows(src);
  const generatedOn = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const html = `<!doctype html><html><head><title>Velite Trademark & IPR Report</title><style>
    body { margin: 0; padding: 28px; color: #172033; font-family: Arial, sans-serif; background: #f7fbff; }
    .cover { padding: 24px; border-radius: 10px; color: #fff; background: linear-gradient(135deg, #13213b, #2563eb, #16a34a); margin-bottom: 18px; }
    h1 { margin: 0; font-size: 28px; } .cover p { margin: 8px 0 0; color: #e5f0ff; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
    .metric { padding: 14px; border: 1px solid #dbe3ef; border-radius: 8px; background: #fff; }
    .metric span { color: #667085; font-size: 11px; font-weight: bold; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 8px; font-size: 24px; }
    section { break-inside: avoid; margin-top: 20px; padding: 16px; border: 1px solid #dbe3ef; border-radius: 8px; background: #fff; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { padding: 8px; border-bottom: 1px solid #e7edf6; text-align: left; vertical-align: top; }
    th { color: #475467; background: #f3f6fb; text-transform: uppercase; font-size: 10px; }
    @media print { body { background: #fff; padding: 14px; } .cover { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style></head><body>
  <div class="cover"><h1>Velite Trademark & IPR Management Report</h1>
    <p>Generated on ${safe(generatedOn)} | Includes trademarks, third-party client brands, product coverage, Personal Care IPR notifications, documents, proof, and matters.</p></div>
  <div class="metrics">
    <div class="metric"><span>Total Marks</span><strong>${src.trademarks.length}</strong></div>
    <div class="metric"><span>Third-party</span><strong>${src.third.length}</strong></div>
    <div class="metric"><span>IPR Notices</span><strong>${src.notices.length}</strong></div>
    <div class="metric"><span>Documents</span><strong>${src.docs.length}</strong></div>
  </div>
  ${tableHtml("Trademark Register", r.trademarks)}
  ${tableHtml("Third-party Client Brands", r.thirdParty)}
  ${tableHtml("Product Coverage", r.products)}
  ${tableHtml("Personal Care IPR Notifications", r.notifications)}
  ${tableHtml("Documents", r.documents)}
  ${tableHtml("Usage Proof", r.proof)}
  ${tableHtml("Legal Matters", r.matters)}
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups for this app to create the PDF report."); return; }
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => w.print(), 400);
}
