import PDFDocument from "pdfkit";

export type InvoiceData = {
  transactionId: string;
  createdAt: Date;
  amountUsd: number; // positive dollars paid
  description: string;
  org: { name: string; billingEmail: string | null };
};

const BRAND = "Octopus Review";
const BRAND_ADDR = "octopus-review.ai";
const ACCENT = "#0E6E64";

/** Short human invoice number derived from the transaction id (stable, unique). */
export function invoiceNumber(transactionId: string): string {
  return `OCT-${transactionId.slice(-10).toUpperCase()}`;
}

/** Render a branded receipt/invoice PDF and resolve the full buffer. */
export function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const money = (n: number) => `$${n.toFixed(2)}`;
    const date = data.createdAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Header
    doc.fillColor(ACCENT).fontSize(22).font("Helvetica-Bold").text(BRAND, 50, 50);
    doc.fillColor("#666").fontSize(9).font("Helvetica").text(BRAND_ADDR, 50, 76);

    doc.fillColor("#111").fontSize(20).font("Helvetica-Bold").text("RECEIPT", 0, 50, {
      align: "right",
    });
    doc
      .fillColor("#666")
      .fontSize(9)
      .font("Helvetica")
      .text(invoiceNumber(data.transactionId), 0, 76, { align: "right" })
      .text(date, { align: "right" });

    // Bill-to
    doc.moveTo(50, 110).lineTo(545, 110).strokeColor("#E0E0E0").stroke();
    doc.fillColor("#666").fontSize(8).font("Helvetica-Bold").text("BILLED TO", 50, 125);
    doc.fillColor("#111").fontSize(11).font("Helvetica").text(data.org.name, 50, 140);
    if (data.org.billingEmail) {
      doc.fillColor("#666").fontSize(9).text(data.org.billingEmail, 50, 156);
    }

    // Line-item table
    const top = 200;
    doc.fillColor("#666").fontSize(8).font("Helvetica-Bold");
    doc.text("DESCRIPTION", 50, top);
    doc.text("AMOUNT", 0, top, { align: "right" });
    doc.moveTo(50, top + 15).lineTo(545, top + 15).strokeColor("#E0E0E0").stroke();

    doc.fillColor("#111").fontSize(11).font("Helvetica");
    doc.text(data.description, 50, top + 28, { width: 380 });
    doc.text(money(data.amountUsd), 0, top + 28, { align: "right" });

    // Total
    const totalY = top + 70;
    doc.moveTo(300, totalY).lineTo(545, totalY).strokeColor("#E0E0E0").stroke();
    doc.fillColor("#666").fontSize(10).font("Helvetica-Bold").text("Total paid", 300, totalY + 12);
    doc
      .fillColor(ACCENT)
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(money(data.amountUsd), 0, totalY + 9, { align: "right" });
    doc.fillColor("#666").fontSize(8).font("Helvetica").text("USD", 0, totalY + 26, { align: "right" });

    // Footer
    doc
      .fillColor("#999")
      .fontSize(8)
      .font("Helvetica")
      .text(
        `Reference ${data.transactionId} · Paid via card. Thank you for using ${BRAND}.`,
        50,
        760,
        { align: "center", width: 495 },
      );

    doc.end();
  });
}
