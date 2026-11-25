// Word copy of an export paper (same blocks as the screen and the printout)
export async function paperToDocx(paper) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, BorderStyle, PageOrientation } = await import("docx");
  const b = { style: BorderStyle.SINGLE, size: 4, color: "888888" }; const borders = { top: b, bottom: b, left: b, right: b };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }; const noBorders = { top: none, bottom: none, left: none, right: none };
  const al = (a) => (a === "center" ? AlignmentType.CENTER : a === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT);
  const para = (text, o = {}) => new Paragraph({ alignment: al(o.align), spacing: { before: o.before ?? 60, after: o.after ?? 60 }, children: String(text ?? "").split("\n").flatMap((t, i) => [new TextRun({ text: t, bold: !!o.bold, size: o.size || 20, break: i ? 1 : 0 })]) });
  const cell = (text, w, o = {}) => new TableCell({ borders: o.noBorder ? noBorders : borders, width: { size: w, type: WidthType.PERCENTAGE }, margins: { top: 40, bottom: 40, left: 70, right: 70 }, children: [para(text, { bold: o.bold, align: o.align, size: o.size || 18, before: 0, after: 0 })] });
  const kids = [];
  for (const k of paper.blocks) {
    if (!k) continue;
    if (k.t === "head") { kids.push(para(k.name, { bold: true, align: "center", size: 30 })); k.lines.forEach((l) => kids.push(para(l, { align: "center", size: 18, before: 0, after: 0 }))); }
    else if (k.t === "gap") kids.push(para("", { before: Math.round(k.mm * 4), after: 0 }));
    else if (k.t === "title") { kids.push(para(k.text, { bold: true, align: "center", size: 26, before: 160 })); if (k.sub) kids.push(para(k.sub, { align: "center", bold: true })); }
    else if (k.t === "para") kids.push(para(k.text, { bold: k.bold, align: k.align, size: k.small ? 17 : 20 }));
    else if (k.t === "row") kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: k.items.map((it) => new TableCell({ borders, width: { size: Math.floor(100 / k.items.length), type: WidthType.PERCENTAGE }, margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [para(it.label, { bold: true, size: 16, before: 0 }), ...it.lines.map((l) => para(l, { size: 18, before: 0, after: 0 }))] })) })] }));
    else if (k.t === "table") kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ tableHeader: true, children: k.head.map((h, i) => cell(h, k.widths[i], { bold: true, align: "center", size: 16 })) }),
      ...k.rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, k.widths[i], { align: k.align[i] === "r" ? "right" : k.align[i] === "c" ? "center" : "left" })) })),
      ...(k.foot || []).map((r) => new TableRow({ children: r.map((v, i) => cell(v, k.widths[i], { bold: true, align: k.align[i] === "r" ? "right" : k.align[i] === "c" ? "center" : "left" })) }))] }));
    else if (k.t === "sign") { kids.push(para("", { before: 500 })); kids.push(para(k.forFirm, { bold: true, align: "right" })); kids.push(para("", { before: 500 })); if (k.name) kids.push(para(k.name, { align: "right", before: 0, after: 0 })); if (k.title) kids.push(para(k.title, { align: "right", before: 0 })); }
    kids.push(para("", { before: 0, after: 40, size: 8 }));
  }
  const doc = new Document({ sections: [{ properties: { page: { size: { orientation: paper.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 700, bottom: 700, left: 800, right: 800 } } }, children: kids }] });
  return Packer.toBlob(doc);
}
