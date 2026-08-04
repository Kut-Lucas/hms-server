import PDFDocument from 'pdfkit';

const HOSPITAL_NAME    = 'Multicare Hospital Health Services';
const HOSPITAL_ADDRESS = 'Cousin House, Ground Floor, Along Kenya Builders Road, Pipeline';
const HOSPITAL_CITY    = 'P.O. Box 71-00606, Nairobi, Kenya';
const HOSPITAL_PHONES  = '0702 008 721 / 0729 615 926';
const HOSPITAL_EMAIL   = 'multicarehospital.services@gmail.com';
const TAGLINE          = 'Touching lives with five star healthcare';

/** Shared header drawn on every document */
function drawHeader(doc) {
  doc.fontSize(16).font('Helvetica-Bold').text(HOSPITAL_NAME, { align: 'center' });
  doc.fontSize(9).font('Helvetica').text(TAGLINE, { align: 'center' });
  doc.fontSize(8).text(HOSPITAL_ADDRESS, { align: 'center' });
  doc.fontSize(8).text(`${HOSPITAL_CITY}   ·   Tel: ${HOSPITAL_PHONES}`, { align: 'center' });
  doc.fontSize(8).text(HOSPITAL_EMAIL, { align: 'center' });
  doc
    .moveDown(0.5)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#aaaaaa')
    .lineWidth(0.5)
    .stroke()
    .moveDown(0.5);
}

/** Thin divider line */
function divider(doc) {
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#cccccc')
    .lineWidth(0.3)
    .stroke()
    .moveDown(0.4);
}

/** Build a single-receipt PDF buffer */
export function buildReceiptPdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc);
    doc.fontSize(13).font('Helvetica-Bold').text('PAYMENT RECEIPT', { align: 'center' });
    doc.moveDown(0.5);
    divider(doc);

    doc.fontSize(10).font('Helvetica');
    doc.text(`Receipt No: ${data.receiptNumber}`);
    doc.text(`Date:       ${data.dateStr}`);
    doc.moveDown(0.3);
    doc.text(`Patient:    ${data.patientName}`);
    doc.text(`Patient ID: ${data.uniqueId}`);
    doc.moveDown(0.5);
    divider(doc);

    doc.font('Helvetica-Bold').text('Services', { continued: true });
    doc.font('Helvetica').text('');
    doc.moveDown(0.3);
    for (const line of data.lines || []) {
      const label = String(line.label).padEnd(40, ' ');
      doc.text(`  ${label} KES ${Number(line.amount).toFixed(2)}`);
    }
    doc.moveDown(0.3);
    divider(doc);

    doc.fontSize(11).font('Helvetica-Bold').text(`Total Paid: KES ${Number(data.total).toFixed(2)}`);
    doc.fontSize(10).font('Helvetica').text(`Payment Method: ${data.method}`);
    doc.text(`Received by: ${data.staffName}`);
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor('#555555').text('Thank you for choosing Multicare Hospital Health Services.', { align: 'center' });
    doc.end();
  });
}

/** Consolidated visit receipt — all charges in one PDF */
export function buildConsolidatedVisitReceiptPdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc);
    doc.fontSize(13).font('Helvetica-Bold').text('VISIT RECEIPT', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(`Visit #${data.visitId}`, { align: 'center' });
    doc.moveDown(0.5);
    divider(doc);

    doc.fontSize(10).font('Helvetica');
    doc.text(`Date:       ${data.dateStr}`);
    doc.text(`Patient:    ${data.patientName}`);
    doc.text(`Patient ID: ${data.uniqueId}`);
    doc.moveDown(0.5);
    divider(doc);

    doc.font('Helvetica-Bold').text('All charges for this visit:');
    doc.font('Helvetica').moveDown(0.3);
    for (const line of data.lines || []) {
      const label = String(line.label).padEnd(40, ' ');
      doc.text(`  ${label} KES ${Number(line.amount).toFixed(2)}`);
    }
    doc.moveDown(0.3);
    divider(doc);

    doc.fontSize(11).font('Helvetica-Bold').text(`Grand Total: KES ${Number(data.total).toFixed(2)}`);
    if (data.paymentMethods?.length) {
      doc.fontSize(10).font('Helvetica').text(`Payment method(s): ${data.paymentMethods.join(', ')}`);
    }
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor('#555555').text('Thank you for choosing Multicare Hospital Health Services.', { align: 'center' });
    doc.end();
  });
}

/**
 * Pharmacy dispensing receipt — shows each drug dispensed with qty + total.
 * data: { prescriptionId, dateStr, patientName, uniqueId, doctorName,
 *          items:[{drug_name, quantity, dosage, frequency, duration_days}],
 *          total, paymentMethod, staffName }
 */
export function buildPharmacyReceiptPdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc);
    doc.fontSize(13).font('Helvetica-Bold').text('PHARMACY DISPENSING RECEIPT', { align: 'center' });
    doc.moveDown(0.5);
    divider(doc);

    doc.fontSize(10).font('Helvetica');
    doc.text(`Rx #:       ${data.prescriptionId}`);
    doc.text(`Date:       ${data.dateStr}`);
    doc.text(`Patient:    ${data.patientName}`);
    doc.text(`Patient ID: ${data.uniqueId}`);
    doc.text(`Doctor:     ${data.doctorName || '—'}`);
    doc.moveDown(0.5);

    if (data.diagnosis) {
      doc.font('Helvetica-Bold').text('Diagnosis:');
      doc.font('Helvetica').text(data.diagnosis, { indent: 10 });
      doc.moveDown(0.3);
    }

    divider(doc);
    doc.font('Helvetica-Bold').text('Drugs dispensed:');
    doc.font('Helvetica').moveDown(0.3);

    // Table header
    const colX = { drug: 50, qty: 280, dosage: 330, freq: 420 };
    doc.fontSize(9).font('Helvetica-Bold')
      .text('Drug', colX.drug, doc.y, { continued: true, width: 220 })
      .text('Qty', colX.qty, doc.y, { continued: true, width: 45 })
      .text('Dosage', colX.dosage, doc.y, { continued: true, width: 85 })
      .text('Frequency', colX.freq, doc.y, { width: 100 });
    doc.moveDown(0.2);
    divider(doc);

    doc.font('Helvetica').fontSize(9);
    for (const it of data.items || []) {
      const rowY = doc.y;
      doc.text(it.drug_name || '—', colX.drug, rowY, { continued: true, width: 220 });
      doc.text(String(it.quantity || 1), colX.qty, rowY, { continued: true, width: 45 });
      doc.text(it.dosage || '—', colX.dosage, rowY, { continued: true, width: 85 });
      doc.text(it.frequency || '—', colX.freq, rowY, { width: 100 });
      if (it.duration_days) {
        doc.fontSize(8).fillColor('#666666')
          .text(`Duration: ${it.duration_days} day(s)`, colX.drug + 10, doc.y, { width: 400 })
          .fillColor('#000000').fontSize(9);
      }
      doc.moveDown(0.1);
    }

    doc.moveDown(0.3);
    divider(doc);
    doc.fontSize(11).font('Helvetica-Bold').text(`Total: KES ${Number(data.total || 0).toFixed(2)}`);
    doc.fontSize(10).font('Helvetica').text(`Payment Method: ${data.paymentMethod || '—'}`);
    doc.text(`Dispensed by: ${data.staffName || '—'}`);

    if (data.notes) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Notes:');
      doc.font('Helvetica').text(data.notes, { indent: 10 });
    }

    doc.moveDown(0.8);
    doc.fontSize(9).fillColor('#555555').text('Thank you for choosing Multicare Hospital Health Services.', { align: 'center' });
    doc.end();
  });
}

/**
 * Lab results report — formal printout the patient hands to the doctor.
 * data: { labOrderId, dateStr, patientName, uniqueId, doctorName,
 *          selectedTests:[{name,price}], instructions, results, labFee, techName }
 */
export function buildLabReportPdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc);
    doc.fontSize(13).font('Helvetica-Bold').text('LABORATORY RESULTS REPORT', { align: 'center' });
    doc.moveDown(0.5);
    divider(doc);

    // Patient / order info
    doc.fontSize(10).font('Helvetica');
    doc.text(`Order #:      ${data.labOrderId}`);
    doc.text(`Date:         ${data.dateStr}`);
    doc.text(`Patient:      ${data.patientName}`);
    doc.text(`Patient ID:   ${data.uniqueId}`);
    doc.text(`Requesting Dr:${data.doctorName || '—'}`);
    doc.text(`Lab Tech:     ${data.techName || '—'}`);
    doc.moveDown(0.5);
    divider(doc);

    // Tests ordered
    if (data.selectedTests?.length) {
      doc.font('Helvetica-Bold').text('Tests Requested:');
      doc.font('Helvetica').moveDown(0.2);
      for (const t of data.selectedTests) {
        doc.fontSize(9).text(`  • ${t.name}`);
      }
      doc.moveDown(0.3);
      divider(doc);
    }

    // Doctor instructions
    if (data.instructions?.trim()) {
      doc.fontSize(10).font('Helvetica-Bold').text('Clinical Instructions (from Doctor):');
      doc.font('Helvetica').fontSize(9).text(data.instructions.trim(), { indent: 10 });
      doc.moveDown(0.3);
      divider(doc);
    }

    // Results
    doc.fontSize(11).font('Helvetica-Bold').text('RESULTS');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica')
      .text(data.results?.trim() || '—', {
        indent: 5,
        paragraphGap: 4,
        lineGap: 2,
      });

    doc.moveDown(0.8);
    divider(doc);

    // Fee & signature block
    doc.fontSize(10).font('Helvetica');
    doc.text(`Lab fee charged: KES ${Number(data.labFee || 0).toFixed(2)}`);
    doc.moveDown(1.5);

    // Signature lines
    const sigY = doc.y;
    const leftX  = doc.page.margins.left;
    const rightX = doc.page.width / 2 + 20;
    const lineW  = 180;

    doc
      .moveTo(leftX, sigY).lineTo(leftX + lineW, sigY)
      .strokeColor('#000000').lineWidth(0.5).stroke();
    doc
      .moveTo(rightX, sigY).lineTo(rightX + lineW, sigY)
      .strokeColor('#000000').lineWidth(0.5).stroke();

    doc.fontSize(8).font('Helvetica')
      .text('Lab Technician Signature', leftX, sigY + 3, { width: lineW, align: 'center' })
      .text("Doctor's Signature / Stamp", rightX, sigY + 3, { width: lineW, align: 'center' });

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#555555')
      .text('This report is confidential and intended for the named patient and their treating physician only.', { align: 'center' })
      .text('Multicare Hospital Health Services — ' + HOSPITAL_PHONES, { align: 'center' });

    doc.end();
  });
}
