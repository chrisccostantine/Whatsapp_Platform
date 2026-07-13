import PDFDocument from "pdfkit";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type PdfParty = { name: string; address?: string | null; phone?: string | null; email?: string | null; taxNumber?: string | null; logoUrl?: string | null };
type PdfItem = { name: string; quantity: unknown; unitPrice: unknown; discount: unknown; taxRate: unknown; lineTotal: unknown };
type PdfInput = { title: string; number: string; currency: string; issueDate: Date; endDateLabel: string; endDate: Date; business: PdfParty; customer: PdfParty; items: PdfItem[]; subtotal: unknown; discount: unknown; tax: unknown; total: unknown; amountPaid?: unknown; amountDue?: unknown; notes?: string | null; terms?: string | null };

const value = (input: unknown) => Number(String(input ?? 0));
const format = (input: unknown, currency: string) => `${currency} ${value(input).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generateDocumentPdf(input: PdfInput) {
  const logo=await loadSafeLogo(input.business.logoUrl);
  const document = new PDFDocument({ size: "A4", margin: 42, info: { Title: `${input.title} ${input.number}`, Author: input.business.name } });
  const chunks: Buffer[] = []; document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  if(logo)document.image(logo,42,42,{fit:[48,48],align:"center",valign:"center"});else document.roundedRect(42, 42, 48, 48, 12).fill("#16a34a").fillColor("#ffffff").fontSize(22).text(input.business.name.slice(0, 2).toUpperCase(), 42, 57, { width: 48, align: "center" });
  document.fillColor("#0f172a").fontSize(20).text(input.business.name, 104, 46).fontSize(9).fillColor("#64748b").text([input.business.address, input.business.phone, input.business.email, input.business.taxNumber ? `Tax: ${input.business.taxNumber}` : null].filter(Boolean).join(" · "), 104, 72, { width: 280 });
  document.fillColor("#0f172a").fontSize(22).text(input.title.toUpperCase(), 390, 46, { align: "right" }).fontSize(10).fillColor("#64748b").text(input.number, 390, 74, { align: "right" });
  document.moveTo(42, 110).lineTo(553, 110).strokeColor("#e2e8f0").stroke();
  document.fillColor("#64748b").fontSize(9).text("BILL TO", 42, 130).fillColor("#0f172a").fontSize(12).text(input.customer.name, 42, 146).fontSize(9).fillColor("#475569").text([input.customer.address, input.customer.phone, input.customer.email].filter(Boolean).join("\n"), 42, 164);
  document.fillColor("#64748b").text("ISSUE DATE", 365, 130).fillColor("#0f172a").text(input.issueDate.toLocaleDateString("en-GB"), 455, 130, { align: "right" }).fillColor("#64748b").text(input.endDateLabel.toUpperCase(), 365, 150).fillColor("#0f172a").text(input.endDate.toLocaleDateString("en-GB"), 455, 150, { align: "right" });
  let y = 220; document.roundedRect(42, y, 511, 28, 6).fill("#f1f5f9").fillColor("#475569").fontSize(8).text("ITEM", 52, y + 10).text("QTY", 280, y + 10).text("PRICE", 335, y + 10).text("TAX", 410, y + 10).text("TOTAL", 470, y + 10, { width: 72, align: "right" }); y += 38;
  for (const item of input.items) { if (y > 690) { document.addPage(); y = 50; } document.fillColor("#0f172a").fontSize(9).text(item.name, 52, y, { width: 210 }).text(String(item.quantity), 280, y).text(format(item.unitPrice, input.currency), 335, y, { width: 70 }).text(`${value(item.taxRate)}%`, 410, y).text(format(item.lineTotal, input.currency), 470, y, { width: 72, align: "right" }); y += 28; document.moveTo(42, y - 8).lineTo(553, y - 8).strokeColor("#f1f5f9").stroke(); }
  y = Math.max(y + 12, 500); const totals = [["Subtotal", input.subtotal], ["Discount", input.discount], ["Tax", input.tax], ["Total", input.total], ...(input.amountPaid !== undefined ? [["Paid", input.amountPaid], ["Amount due", input.amountDue]] : [])] as [string, unknown][];
  for (const [label, amount] of totals) { const final = label === "Total" || label === "Amount due"; document.fillColor(final ? "#0f172a" : "#64748b").fontSize(final ? 11 : 9).text(label, 360, y).text(format(amount, input.currency), 455, y, { width: 88, align: "right" }); y += final ? 25 : 19; }
  if (input.notes) { document.fillColor("#64748b").fontSize(8).text("NOTES", 42, y + 10).fillColor("#334155").fontSize(9).text(input.notes, 42, y + 24, { width: 280 }); }
  if (input.terms) document.fillColor("#64748b").fontSize(8).text(`Terms: ${input.terms}`, 42, 760, { width: 511, align: "center" });
  document.end(); return done;
}

async function loadSafeLogo(value?:string|null){if(!value)return null;try{const url=new URL(value);if(url.protocol!=="https:"||isIP(url.hostname))return null;const addresses=await lookup(url.hostname,{all:true});if(addresses.some(({address})=>isPrivateAddress(address)))return null;const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(5_000)});const type=response.headers.get("content-type")??"";const declared=Number(response.headers.get("content-length")??0);if(!response.ok||!/^image\/(png|jpeg)$/.test(type)||declared>2_000_000)return null;const bytes=Buffer.from(await response.arrayBuffer());return bytes.length<=2_000_000?bytes:null;}catch{return null;}}
function isPrivateAddress(address:string){const normalized=address.toLowerCase();if(normalized==="::1"||normalized.startsWith("fc")||normalized.startsWith("fd")||normalized.startsWith("fe80:"))return true;const parts=normalized.split(".").map(Number);if(parts.length!==4)return false;return parts[0]===10||parts[0]===127||(parts[0]===169&&parts[1]===254)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168);}
