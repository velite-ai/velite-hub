// Export mail: the two sender choices, the copy address, address checks and the automatic cover text of a proforma mail.
// (The mail function on the server checks the same rules again; the browser only helps to fill the form.)

export const CC_ALWAYS = "velite@velite.in";
// Both go out through velite.in (the verified domain). The Gmail choice shows the Gmail as the reply address, so the party's reply lands there.
export const SENDERS = [
  { k: "thirdparty", label: "thirdparty@velite.in", from: "thirdparty@velite.in", replyTo: "thirdparty@velite.in" },
  { k: "tp2", label: "tp2.velite@gmail.com", from: "thirdparty@velite.in", replyTo: "tp2.velite@gmail.com" },
];

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export const isEmail = (s) => EMAIL.test(String(s || "").trim());
// "a@x.com, b@y.com; c@z.com" -> { list: [...], bad: [...] }
export function parseEmails(text) {
  const parts = String(text || "").split(/[,;\n\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const list = [...new Set(parts.filter(isEmail))]; const bad = [...new Set(parts.filter((x) => !isEmail(x)))];
  return { list, bad };
}

const dmy = (d, sep = ".") => (d ? `${d.slice(8, 10)}${sep}${d.slice(5, 7)}${sep}${d.slice(0, 4)}` : "");
const money = (n, cur) => Number(n || 0).toLocaleString(cur === "USD" ? "en-US" : "en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The cover text written for the person to read and change before sending.
export function proformaMail({ firm, party, shipment, items, total }) {
  const fname = firm?.name || "Velite"; const cur = shipment.currency === "USD" ? "USD" : "INR";
  const subject = `Proforma Invoice ${shipment.proforma_no || ""} - ${fname}`.replace(/\s+/g, " ").trim();
  const ref = shipment.po_no ? ` against your order ${shipment.po_no}${shipment.po_date ? ` dated ${dmy(shipment.po_date)}` : ""}` : "";
  const n = items || 0;
  const body = [
    `Dear ${party?.contact_person || party?.name || "Sir / Madam"},`,
    "",
    `Greetings from ${fname}.`,
    "",
    `Thank you for your order. Please find attached our Proforma Invoice No. ${shipment.proforma_no || ""} dated ${dmy(shipment.proforma_date)}${ref}, for ${n} item${n === 1 ? "" : "s"}, total ${cur} ${money(total, cur)}.`,
    "",
    `Kindly confirm the proforma and arrange the payment as per the payment terms stated on it${shipment.payment_terms ? ` (${shipment.payment_terms})` : ""}. Our bank details are given on the proforma. Please share the payment details once the transfer is made, so that we can proceed with your order.`,
    "",
    "Please let us know if you need any change.",
    "",
    "Thanks and regards,",
    firm?.signatory_name ? `${firm.signatory_name}` : "",
    fname,
    [firm?.phone, firm?.email].filter(Boolean).join(" | "),
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").replace(/\n+$/, "");
  return { subject, body };
}
