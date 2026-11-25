// Export papers built from a shipment: proforma invoice, export invoice, packing list, certificate of origin, declaration.
// Each paper is a list of simple blocks, so the same content is shown on screen, printed, saved and turned into Word.
// No signatures or stamps are ever added: the signatory's name is printed and the person signs and stamps the printout.
import { packLines, totals, lineAmount } from "./shipment.js";

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
const below1000 = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + below100(n % 100) : "") : below100(n));

// 145000 -> "One Lac Forty Five Thousand" (Indian grouping)
export function wordsIndian(n) {
  n = Math.floor(n); if (n === 0) return "Zero";
  const parts = []; const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(below1000(cr) + " Crore"); if (lk) parts.push(below100(lk) + " Lac"); if (th) parts.push(below100(th) + " Thousand"); if (n) parts.push(below1000(n));
  return parts.join(" ");
}
// 1250 -> "One Thousand Two Hundred Fifty" (international grouping)
export function wordsIntl(n) {
  n = Math.floor(n); if (n === 0) return "Zero";
  const parts = []; for (const [v, w] of [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]]) { const c = Math.floor(n / v); if (c) parts.push(below1000(c) + " " + w); n %= v; }
  if (n) parts.push(below1000(n)); return parts.join(" ");
}
export function amountWords(amount, currency) {
  const a = Math.round((Number(amount) || 0) * 100) / 100; const whole = Math.floor(a + 1e-9), frac = Math.round((a - whole) * 100);
  if (currency === "USD") return `US Dollars ${wordsIntl(whole)}${frac ? ` and ${below100(frac)} Cents` : ""} only`;
  return `Rs. ${wordsIndian(whole)}${frac ? ` and ${below100(frac)} Paise` : ""} only`;
}

export const dmy = (d, sep = "/") => (d ? `${d.slice(8, 10)}${sep}${d.slice(5, 7)}${sep}${d.slice(0, 4)}` : "");
export const mmyy = (d) => (d ? `${d.slice(5, 7)}/${d.slice(2, 4)}` : "");
export const money = (n, cur) => Number(n || 0).toLocaleString(cur === "USD" ? "en-US" : "en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => (n == null || n === "" ? "" : String(Number(n)));
const up = (s) => String(s || "").toUpperCase();
const MODE = { road: "BY ROAD", air: "BY AIR", sea: "BY SEA", "road+sea": "BY ROAD, THEN BY SEA", "air+road": "BY AIR, THEN BY ROAD" };

export const KINDS = [
  ["proforma", "Proforma invoice"], ["invoice", "Export invoice"], ["packing", "Packing list"], ["coo", "Certificate of origin"], ["declaration", "Declaration"], ["nondg", "Non-DG declaration"],
];

// the edition of the IATA Dangerous Goods Regulations named in the declaration, as in the firm's own format
export const DGR_EDITION = "65th";

// Which paper does a line of a country's document list stand for? Unknown ones are papers to attach.
export function kindOfCountryDoc(name) {
  const s = String(name).toLowerCase();
  if (/e-invoice|e-way/.test(s)) return null;
  if (/proforma/.test(s)) return "proforma";
  if (/non-?dg|dangerous/.test(s)) return "nondg";
  if (/packing/.test(s)) return "packing";
  if (/origin/.test(s)) return "coo";
  if (/narcotics|scomet|declaration/.test(s) && !/letter of authority/.test(s)) return "declaration";
  if (/invoice/.test(s)) return "invoice";
  return null;
}

const partyLines = (p) => (p ? [p.name, p.address, p.phone && `PH NO: ${p.phone}`, Object.entries(p.ids || {}).map(([k, v]) => `${k}: ${v}`).join("   ")].filter(Boolean) : []);
const head = (f, plain) => (plain ? { t: "head", name: up(f.name), lines: [f.address, [f.phone && `Phone: ${f.phone}`, f.email && `E-mail: ${f.email}`].filter(Boolean).join("   ")].filter(Boolean) } : { t: "gap", mm: 28 });
const descr = (l) => `${l.name}${l.batch_no ? ` B.No.: ${l.batch_no}` : ""}${l.mfg ? `, MFG: ${mmyy(l.mfg)}` : ""}${l.exp ? `, EXP: ${mmyy(l.exp)}` : ""}`;
const sign = (f) => ({ t: "sign", forFirm: `For ${f.name.toUpperCase()}`, name: f.signatory_name || "", title: f.signatory_title || "Authorised signatory" });
const refs = (s) => [s.eway_bill && `EWAYBILL NO: ${s.eway_bill}`].filter(Boolean).join(" ");
const lutLine = (f) => ((f.lut || {}).no ? `LUT No. ${f.lut.no}${f.lut.date ? ` dated ${dmy(f.lut.date)}` : ""}` : "");
const SUPPLY = "SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING FOR EXPORT OF GOODS WITHOUT PAYMENT OF INTEGRATED TAX";

// ctx: { s, lines, firm, party, notify, brandOwner, transporter, agent, plain }
export function buildPaper(kind, c) {
  const { s, lines, firm: f, party: p } = c; const cur = s.currency; const tot = totals(lines); const pk = packLines(lines);
  const to = c.notify || null;
  const route = [s.entry_point && `CUSTOM ENTRY POINT: ${s.entry_point}`, s.port_discharge && `PORT OF DISCHARGE: ${s.port_discharge}`, `PORT OF LOADING: ${s.port_loading || "LUDHIANA, PUNJAB, INDIA"} ${MODE[s.transport_mode] ? `(TRANSPORT ${MODE[s.transport_mode]})` : ""}`].filter(Boolean);
  const boxesText = pk.rows.filter((r) => !r.unknown).map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`));
  const fx = cur !== "INR" && Number(s.exchange_rate) ? `Exchange rate: 1 ${cur} = Rs. ${num(s.exchange_rate)}    Invoice value in rupees: Rs. ${money(tot.amount * Number(s.exchange_rate), "INR")}` : null;

  if (kind === "proforma") return { kind, title: "Proforma invoice", file: `Proforma ${s.proforma_no || s.invoice_no || ""}`, blocks: [
    head(f, c.plain), { t: "title", text: "PROFORMA INVOICE", sub: `No.: ${s.proforma_no || ""}   DATED ${dmy(s.proforma_date || s.invoice_date, ".")}` },
    { t: "para", text: "SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX", align: "center", small: true },
    { t: "row", items: [{ label: "To", lines: partyLines(p) }, { label: "Order", lines: [s.po_no && `ORDER NO: ${s.po_no}`, s.po_date && `DATED: ${dmy(s.po_date, ".")}`, `IEC NO.: ${f.iec || ""}`].filter(Boolean) }] },
    { t: "para", text: [...route, `COUNTRY OF ORIGIN OF GOODS: INDIA`, s.final_destination && `FINAL DESTINATION: ${s.final_destination}`, s.payment_terms && `PAYMENT TERM: ${s.payment_terms}`, s.delivery_terms && `DELIVERY TERM: ${s.delivery_terms}`].filter(Boolean).join("\n"), small: true },
    { t: "table", head: ["S.No", "Product name", "HSN", `Quantity (pcs)`, `Net rate per piece (${cur === "INR" ? "Rs." : cur})`, `Net amount (${cur === "INR" ? "Rs." : cur})`], widths: [6, 38, 12, 12, 16, 16], align: "ccrrrr",
      rows: lines.map((l, i) => [String(i + 1), l.name, l.hsn || "", String(l.qty), money(l.rate, cur), money(lineAmount(l), cur)]), foot: [["", "TOTAL", "", String(tot.qty), "", money(tot.amount, cur)]] },
    { t: "para", text: amountWords(tot.amount, cur), bold: true }, fx && { t: "para", text: fx, small: true },
    { t: "para", text: "T & C: NET RATES QUOTED ARE EX-FACTORY (LUDHIANA, PUNJAB, INDIA) AND NO FREIGHT / INSURANCE IS INCLUDED. THE PROFORMA IS VALID FOR THE GOODS AND QUANTITIES LISTED ABOVE.", small: true },
    f.bank?.account && { t: "para", text: `BANK DETAILS: ${[f.bank.bank, f.bank.branch && `Branch ${f.bank.branch}`, `A/C No.: ${f.bank.account}`, f.bank.ifsc && `IFSC: ${f.bank.ifsc}`, f.bank.swift && `SWIFT: ${f.bank.swift}`].filter(Boolean).join(", ")}`, small: true },
    sign(f)].filter(Boolean) };

  if (kind === "invoice") return { kind, title: "Export invoice", file: `Invoice ${s.invoice_no || ""}`, blocks: [
    head(f, c.plain), { t: "title", text: "EXPORT INVOICE" }, { t: "para", text: SUPPLY, align: "center", small: true }, lutLine(f) && { t: "para", text: lutLine(f), align: "center", small: true },
    { t: "para", text: [f.dl_no && `DL.No. ${f.dl_no}`, f.gstin && `GST: ${f.gstin}`, f.iec && `IEC.No.: ${f.iec}`].filter(Boolean).join("     "), small: true },
    { t: "row", items: [{ label: "Bill and Ship to", lines: partyLines(p) }, { label: "Invoice", lines: [`Invoice No.: ${s.invoice_no || ""}`, `Date: ${dmy(s.invoice_date)}`, s.proforma_no && `Order No.: ${s.proforma_no}${s.proforma_date ? `   Date: ${dmy(s.proforma_date)}` : ""}`, s.po_no && `Buyer's PO: ${s.po_no}${s.po_date ? `   Date: ${dmy(s.po_date)}` : ""}`, s.gr_no && `G.R. No.: ${s.gr_no}`, `Case: ${pk.boxes}`, c.transporter && `Transport: ${up(c.transporter.name)}${refs(s) ? "   " + refs(s) : ""}`].filter(Boolean) }] },
    to && { t: "para", text: `NOTIFY PARTY: ${partyLines(to).join(", ")}`, small: true }, c.brandOwner && { t: "para", text: `BRAND OWNER: ${c.brandOwner.name}${c.brandOwner.address ? `, ${c.brandOwner.address}` : ""}`, small: true },
    { t: "para", text: [...route, "COUNTRY OF ORIGIN OF GOODS: INDIA", s.final_destination && `FINAL DESTINATION: ${s.final_destination}`, s.payment_terms && `PAYMENT TERM: ${s.payment_terms}`, s.delivery_terms && `DELIVERY TERM: ${s.delivery_terms}`].filter(Boolean).join("\n"), small: true },
    { t: "table", head: ["S.N", "Product", "HSN", "Batch", "Mfg.", "Exp.", "Qty.", `Rate (${cur === "INR" ? "Rs." : cur})`, "GST%", `Amount (${cur === "INR" ? "Rs." : cur})`], widths: [5, 25, 10, 10, 6, 6, 7, 10, 6, 15], align: "cllcccrrcr",
      rows: lines.map((l, i) => [String(i + 1), l.name, l.hsn || "", l.batch_no || "", mmyy(l.mfg), mmyy(l.exp), String(l.qty), money(l.rate, cur), "0", money(lineAmount(l), cur)]),
      foot: [["", "Total qty in pcs", "", "", "", "", String(tot.qty), "", "", money(tot.amount, cur)]] },
    { t: "para", text: `GST ${tot.amount}*0%-0 (IGST)`, small: true }, { t: "para", text: amountWords(tot.amount, cur), bold: true },
    { t: "para", text: `SUB TOTAL: ${money(tot.amount, cur)}        GRAND TOTAL: ${money(tot.amount, cur)}`, bold: true, align: "right" }, fx && { t: "para", text: fx, small: true },
    f.bank?.account && { t: "para", text: `${f.bank.bank || ""} A/C No.: ${f.bank.account}${f.bank.ifsc ? `  IFSC CODE: ${f.bank.ifsc}` : ""}${f.bank.branch ? `  BRANCH: ${f.bank.branch}` : ""}${f.bank.swift ? `  SWIFT CODE: ${f.bank.swift}` : ""}`, small: true },
    { t: "para", text: "Terms & Conditions: All disputes are subject to LUDHIANA jurisdiction only. E.&O.E. All the items supplied vide this invoice require proper storage conditions viz. cool place, free from humidity and protection from light. Party should check the goods at the time of receipt; any complaint should be intimated immediately. No warranty or claim of shortage concerning goods supplied vide this bill is valid if the container is opened, or if the outer cover is mutilated, defective or semi-opened. Do not over stock goods.", small: true },
    sign(f)].filter(Boolean) };

  if (kind === "packing") return { kind, title: "Packing list", file: `Packing list ${s.invoice_no || ""}`, landscape: true, blocks: [
    head(f, c.plain), { t: "title", text: "PACKING LIST" },
    { t: "row", items: [{ label: "Consignee", lines: partyLines(p) }, { label: "Buyer (if other than consignee)", lines: to ? partyLines(to) : ["Same as consignee"] }, { label: "Invoice", lines: [`Invoice No.: ${s.invoice_no || ""}`, `Date: ${dmy(s.invoice_date)}`, `Exporter's Ref: IEC NO - ${f.iec || ""}`] }] },
    { t: "para", text: [`Country of origin of goods: INDIA`, `Country of final destination: ${up(s.country)}`, `Pre-carriage by: ${MODE[s.transport_mode] || ""}`, `Place of receipt by pre-carrier: ${s.port_loading || "LUDHIANA, PUNJAB, INDIA"}`, ...route, s.final_destination && `FINAL DESTINATION: ${s.final_destination}`, [s.payment_terms && `PAYMENT TERM: ${s.payment_terms}`, s.delivery_terms && `DELIVERY TERM: ${s.delivery_terms}`].filter(Boolean).join("   ")].filter(Boolean).join("\n"), small: true },
    { t: "table", head: ["Marks & No", "No. of pcs per box", "HSN", "Description of goods - cosmetics", "Total quantity (pcs)", "Net wt per box (kg)", "Gross wt per box (kg)", "Total net wt (kg)", "Total gross wt (kg)"], widths: [9, 8, 9, 31, 9, 8, 8, 9, 9], align: "cccl" + "rrrrr",
      rows: pk.rows.filter((r) => !r.unknown).map((r) => [`BOX# ${r.from === r.to ? r.from : `${r.from}-${r.to}`}`, String(r.perBox), lines[r.line].hsn || "", descr(lines[r.line]), String(r.qty), num(r.netPerBox), num(r.grossPerBox), num(r.net), num(r.gross)]),
      foot: [["TOTAL BOXES", String(pk.boxes), "", "", String(tot.qty), "", "", String(pk.net), String(pk.gross)]] },
    { t: "para", text: `TOTAL BOXES: ${pk.boxes}     TOTAL NET WEIGHT (KG): ${pk.net}     TOTAL GROSS WEIGHT (KG): ${pk.gross}`, bold: true },
    sign(f)] };

  if (kind === "coo") return { kind, title: "Certificate of origin", file: `Certificate of origin ${s.invoice_no || ""}`, blocks: [
    head(f, c.plain), { t: "title", text: "CERTIFICATE OF COUNTRY OF ORIGIN" },
    { t: "para", text: `EXPORTER: ${up(f.name)}, ${f.address || ""}${f.iec ? `  IEC: ${f.iec}` : ""}\nCONSIGNEE: ${partyLines(p).join(", ")}`, small: true },
    { t: "para", text: [`PRE-CARRIAGE BY - ${MODE[s.transport_mode] || ""}`, `PLACE OF RECEIPT OF PRE-CARRIAGE - ${s.port_loading || "LUDHIANA, PUNJAB, INDIA"}`, `PORT OF LOADING - ${s.port_loading || "LUDHIANA, PUNJAB, INDIA"}`, s.port_discharge && `PORT OF DISCHARGE - ${s.port_discharge}`, s.final_destination && `FINAL DESTINATION: ${s.final_destination}`].filter(Boolean).join("\n"), small: true },
    { t: "table", head: ["Marks & No. / container no. of goods", "Description of goods", "Quantity", "Invoice no. & date"], widths: [18, 42, 18, 22], align: "llll",
      rows: [[`TOTAL NO OF BOXES: ${pk.boxes}`, lines.map((l) => `${l.name} HSN: ${l.hsn || ""} B.No.: ${l.batch_no || ""}, MFG: ${mmyy(l.mfg)}, EXP: ${mmyy(l.exp)} QUANTITY: ${l.qty}`).join("\n"), `GROSS WEIGHT: ${pk.gross}kg\nNET WEIGHT: ${pk.net}kg`,
        `INVOICE NO: ${s.invoice_no || ""}\nINVOICE DATE: ${dmy(s.invoice_date)}\nINVOICE VALUE: ${money(tot.amount, cur)} ${cur}\nIt is hereby certified that goods are of Indian Origin.`]] },
    { t: "para", text: `EXPORTER DECLARATION - THE UNDERSIGNED DECLARES THAT THE DETAILS AND STATEMENTS ARE CORRECT AND THAT ALL THE ABOVE MENTIONED GOODS ARE OF INDIAN ORIGIN.\nPLACE: LUDHIANA, PUNJAB, INDIA      DATE: ${dmy(s.invoice_date)}`, small: true },
    { t: "sign", forFirm: "SIGNATURE & STAMP OF EXPORTER / AUTHORISED SIGNATORY", name: f.signatory_name || "", title: f.signatory_title || "" }] };

  if (kind === "declaration") return { kind, title: "Declaration", file: `Declaration ${s.invoice_no || ""}`, blocks: [
    head(f, c.plain), { t: "para", text: `DATE: ${dmy(s.invoice_date, ".")}`, bold: true }, { t: "para", text: "TO WHOMSOEVER IT MAY CONCERN", bold: true, align: "center" },
    { t: "para", text: `It is certified that, we M/S ${up(f.name)}, ${up(f.address || "")} are a Manufacturer / Merchant Exporter of the Goods ${lines.map((l) => l.name).join(", ")} (description of goods: cosmetics products) falling under HSN ${[...new Set(lines.map((l) => l.hsn).filter(Boolean))].join(", ")} mentioned against Invoice No. ${s.invoice_no || ""} dated ${dmy(s.invoice_date, ".")}.` },
    { t: "para", text: "The Consignment does not fall under SCOMET LIST / Montreal Protocol / NDPS or any other restricted item. Besides CDSCO NOC is also not required for this consignment." },
    { t: "para", text: "The End Use of said products has no purpose other than civil purpose." },
    { t: "table", head: ["S. No.", "Particulars", "HSN code", "Case no."], widths: [8, 52, 18, 22], align: "clcc",
      rows: lines.map((l, i) => { const r = pk.rows.filter((x) => x.line === l.__i && !x.unknown); const a = r.length ? r[0].from : "", b = r.length ? r[r.length - 1].to : ""; return [String(i + 1), l.name, l.hsn || "", a === "" ? "" : `CASE# ${a === b ? a : `${a}-${b}`}`]; }) },
    sign(f)] };
  if (kind === "nondg") return { kind, title: "Non-DG declaration", file: `Non-DG declaration ${s.invoice_no || ""}`, blocks: [
    head(f, c.plain), { t: "para", text: `Date: ${dmy(s.invoice_date, ".")}`, bold: true }, { t: "title", text: "NON DANGEROUS GOODS DECLARATION" },
    { t: "para", text: `This is to certify that the articles / substances of this shipment are properly described by name, that they are not listed in the current edition ${DGR_EDITION} of IATA Dangerous Goods Regulations (DGR), Alphabetical List of Dangerous Goods nor do they correspond to any of the hazard classes appearing in the DGR, section 3, classifications of Dangerous Goods and that they are known to be not dangerous i.e. not restricted.` },
    { t: "para", text: "We again agree that this shipment is non-hazardous, non-toxic, non-corrosive, non-flammable, non-reactive." },
    { t: "para", text: "Furthermore the shipper confirms that the goods are in proper and good condition for transportation on passenger carrying Aircraft (DGR, 8.1.23) Of International Air Transport Association (IATA)." },
    { t: "table", head: ["Marks and number of packages", "Proper description of goods (trade names not permitted). Specify each article separately", "Net quantity per package"], widths: [22, 56, 22], align: "llc",
      rows: lines.map((l) => { const r = pk.rows.filter((x) => x.line === l.__i && !x.unknown); const a = r.length ? r[0].from : "", b = r.length ? r[r.length - 1].to : ""; return [a === "" ? "BOXES" : `BOXES ${a === b ? a : `${a}-${b}`}`, `${l.hsn || ""} ${l.name}`.trim(), l.pcs_per_carton ? String(l.pcs_per_carton) : ""]; }) },
    { t: "para", text: `Name and address of shipper:\n${up(f.name)}, ${up(f.address || "")}` },
    { t: "para", text: `Name and address of consignee:\n${to ? `BUYER: ${partyLines(p).join(", ")}\nCONSIGNEE: ${partyLines(to).join(", ")}` : partyLines(p).join(", ")}` },
    { t: "sign", forFirm: "Authorized Signatory (Name / Designation / Sign)", name: f.signatory_name || "", title: [f.signatory_title, f.phone && `Mobile: ${f.phone}`, `Dt. ${dmy(s.invoice_date, ".")}`].filter(Boolean).join("   ") }] };
  return null;
}

// everything needed to build the papers of one shipment
export function paperContext(s, lines, d, plain) {
  return { s, lines: lines.map((l, i) => ({ ...l, __i: i })), firm: d.firms.find((f) => f.id === s.firm_id), party: d.parties.find((x) => x.id === s.party_id), notify: d.parties.find((x) => x.id === s.notify_id) || null,
    brandOwner: d.parties.find((x) => x.id === s.brand_owner_id) || null, transporter: d.agents.find((x) => x.id === s.transporter_id) || null, agent: d.agents.find((x) => x.id === s.agent_id) || null, plain };
}

// a short fingerprint of a paper's content (the letterhead choice is ignored), to know whether a saved copy is still current
export function fingerprint(paper) {
  const str = JSON.stringify(paper.blocks.filter((b) => b && b.t !== "head" && b.t !== "gap")); let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + str.length.toString(36);
}
