import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';
import {
  buildConsolidatedVisitReceiptPdfBuffer,
  buildReceiptPdfBuffer,
  buildPharmacyReceiptPdfBuffer,
} from '../utils/receiptPdf.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

function periodBounds(period, fromQ, toQ) {
  const now = new Date();
  let from;
  let to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  if (period === 'custom' && fromQ && toQ) {
    from = new Date(fromQ);
    to = new Date(toQ);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }

  if (period === 'week') {
    from = new Date(now);
    from.setDate(now.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }
  if (period === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to };
  }
  if (period === 'year') {
    from = new Date(now.getFullYear(), 0, 1);
    return { from, to };
  }
  if (period === 'halfmonth') {
    const d = now.getDate();
    if (d <= 15) {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth(), 15, 23, 59, 59);
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 16);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }
    return { from, to };
  }
  from = new Date(now);
  from.setDate(now.getDate() - 6);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export async function financialReport(req, res) {
  try {
    const period = (req.query.period || 'week').toLowerCase();
    const { from, to } = periodBounds(period, req.query.from, req.query.to);
    const fromStr = from.toISOString().slice(0, 19).replace('T', ' ');
    const toStr = to.toISOString().slice(0, 19).replace('T', ' ');

    const [payRows] = await pool.execute(
      `SELECT payment_type, SUM(amount) AS total
       FROM payments
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY payment_type`,
      [fromStr, toStr]
    );
    const totals = { consultation: 0, pharmacy: 0, lab: 0 };
    for (const r of payRows) {
      totals[r.payment_type] = Number(r.total);
    }
    const revenue = totals.consultation + totals.pharmacy + totals.lab;

    const [procRows] = await pool.execute(
      `SELECT COALESCE(SUM(it.quantity * i.cost_price), 0) AS procurement
       FROM inventory_transactions it
       JOIN inventory i ON i.id = it.inventory_id
       WHERE it.transaction_type = 'restock' AND it.created_at >= ? AND it.created_at <= ?`,
      [fromStr, toStr]
    );
    const procurement = Number(procRows[0]?.procurement || 0);
    const net = revenue - procurement;

    const [daily] = await pool.execute(
      `SELECT DATE(created_at) AS d, SUM(amount) AS total
       FROM payments
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY DATE(created_at)
       ORDER BY d`,
      [fromStr, toStr]
    );

    return res.json({
      success: true,
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        consultation: totals.consultation,
        pharmacy: totals.pharmacy,
        lab: totals.lab,
        procurement,
        net,
      },
      daily_revenue: daily,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function patientPayments(req, res) {
  try {
    const patientId = Number(req.params.id);
    const [rows] = await pool.execute(
      `SELECT p.*, r.receipt_number
       FROM payments p
       LEFT JOIN receipts r ON r.id = p.receipt_id
       WHERE p.patient_id = ?
       ORDER BY p.visit_id DESC, p.created_at DESC`,
      [patientId]
    );
    return res.json({ success: true, payments: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function listPayments(req, res) {
  try {
    const { from, to, type } = req.query;
    let sql = `SELECT p.*, pt.full_name AS patient_name, pt.unique_id, u.full_name AS received_by_name
               FROM payments p
               JOIN patients pt ON pt.id = p.patient_id
               JOIN users u ON u.id = p.received_by
               WHERE 1=1`;
    const params = [];
    if (from) {
      sql += ` AND p.created_at >= ?`;
      params.push(from);
    }
    if (to) {
      sql += ` AND p.created_at <= ?`;
      params.push(to);
    }
    if (type) {
      sql += ` AND p.payment_type = ?`;
      params.push(type);
    }
    sql += ` ORDER BY p.created_at DESC LIMIT 500`;
    const [rows] = await pool.execute(sql, params);
    return res.json({ success: true, payments: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function receiptPdf(req, res) {
  try {
    const receiptId = Number(req.params.receiptId);
    const [rrows] = await pool.execute(
      `SELECT r.*, p.full_name AS patient_name, p.unique_id, u.full_name AS staff_name
       FROM receipts r
       JOIN patients p ON p.id = r.patient_id
       JOIN users u ON u.id = r.issued_by
       WHERE r.id = ?`,
      [receiptId]
    );
    const rec = rrows[0];
    if (!rec) {
      return res.status(404).json({ success: false, message: 'Receipt not found' });
    }
    let lines = [];
    try {
      const d = typeof rec.details === 'string' ? JSON.parse(rec.details) : rec.details;
      lines = d?.lines || [];
    } catch {
      lines = [{ label: 'Payment', amount: rec.total_amount }];
    }
    const dateStr = new Date(rec.issued_at).toLocaleString('en-GB');
    const buf = await buildReceiptPdfBuffer({
      receiptNumber: rec.receipt_number,
      dateStr,
      patientName: rec.patient_name,
      uniqueId: rec.unique_id,
      lines,
      total: rec.total_amount,
      method: rec.payment_method,
      staffName: rec.staff_name,
    });
    await auditLog(req.user?.id || null, 'RECEIPT_PDF', 'receipts', receiptId, null, clientIp(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${rec.receipt_number}.pdf"`);
    return res.send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** One PDF with every charge for a single visit (consultation + lab + pharmacy). */
export async function visitConsolidatedReceiptPdf(req, res) {
  try {
    const visitId = Number(req.params.visitId);
    if (!visitId) {
      return res.status(400).json({ success: false, message: 'Invalid visit id' });
    }
    const [vrows] = await pool.execute(
      `SELECT v.id, v.created_at, p.full_name AS patient_name, p.unique_id
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE v.id = ?`,
      [visitId]
    );
    const visit = vrows[0];
    if (!visit) {
      return res.status(404).json({ success: false, message: 'Visit not found' });
    }
    const [receipts] = await pool.execute(
      `SELECT r.* FROM receipts r WHERE r.visit_id = ? ORDER BY r.issued_at ASC`,
      [visitId]
    );
    const lines = [];
    const methods = new Set();
    let total = 0;
    for (const rec of receipts) {
      total += Number(rec.total_amount);
      methods.add(rec.payment_method);
      try {
        const d = typeof rec.details === 'string' ? JSON.parse(rec.details) : rec.details;
        for (const line of d?.lines || []) {
          lines.push({ label: line.label, amount: line.amount });
        }
      } catch {
        lines.push({ label: 'Payment', amount: rec.total_amount });
      }
    }
    if (!lines.length) {
      const [payments] = await pool.execute(
        `SELECT payment_type, amount, payment_method FROM payments WHERE visit_id = ? ORDER BY created_at ASC`,
        [visitId]
      );
      for (const p of payments) {
        const label =
          p.payment_type === 'consultation'
            ? 'Consultation fee'
            : p.payment_type === 'lab'
              ? 'Laboratory fee'
              : 'Pharmacy';
        lines.push({ label, amount: p.amount });
        total += Number(p.amount);
        methods.add(p.payment_method);
      }
    }
    if (!lines.length) {
      return res.status(404).json({ success: false, message: 'No payments recorded for this visit yet' });
    }
    const dateStr = new Date(visit.created_at).toLocaleString('en-GB');
    const buf = await buildConsolidatedVisitReceiptPdfBuffer({
      visitId,
      dateStr,
      patientName: visit.patient_name,
      uniqueId: visit.unique_id,
      lines,
      total,
      paymentMethods: [...methods],
    });
    await auditLog(req.user?.id || null, 'VISIT_RECEIPT_PDF', 'visits', visitId, null, clientIp(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="visit-${visitId}-consolidated-receipt.pdf"`
    );
    return res.send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Pharmacy dispensing receipt PDF for a prescription */
export async function pharmacyReceiptPdf(req, res) {
  try {
    const prescriptionId = Number(req.params.prescriptionId);
    if (!prescriptionId) {
      return res.status(400).json({ success: false, message: 'Invalid prescription id' });
    }
    // Prescription + doctor + patient
    const [prows] = await pool.execute(
      `SELECT pr.id, pr.notes, pr.diagnosis, pr.created_at,
              p.full_name AS patient_name, p.unique_id,
              u.full_name AS doctor_name
       FROM prescriptions pr
       JOIN visits v ON v.id = pr.visit_id
       JOIN patients p ON p.id = v.patient_id
       JOIN users u ON u.id = pr.doctor_id
       WHERE pr.id = ?`,
      [prescriptionId]
    );
    const rx = prows[0];
    if (!rx) return res.status(404).json({ success: false, message: 'Prescription not found' });

    // Items
    const [items] = await pool.execute(
      `SELECT * FROM prescription_items WHERE prescription_id = ?`,
      [prescriptionId]
    );

    // Payment for this visit (pharmacy type) - most recent
    const [payments] = await pool.execute(
      `SELECT pay.amount, pay.payment_method, u.full_name AS staff_name
       FROM payments pay
       JOIN prescriptions pr ON pr.visit_id = pay.visit_id
       JOIN users u ON u.id = pay.received_by
       WHERE pr.id = ? AND pay.payment_type = 'pharmacy'
       ORDER BY pay.created_at DESC LIMIT 1`,
      [prescriptionId]
    );
    const payment = payments[0];

    const dateStr = new Date(rx.created_at).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' });
    const buf = await buildPharmacyReceiptPdfBuffer({
      prescriptionId,
      dateStr,
      patientName: rx.patient_name,
      uniqueId: rx.unique_id,
      doctorName: rx.doctor_name,
      diagnosis: rx.diagnosis || '',
      notes: rx.notes || '',
      items,
      total: payment?.amount || 0,
      paymentMethod: payment?.payment_method || '—',
      staffName: payment?.staff_name || '—',
    });

    await auditLog(req.user?.id || null, 'PHARMACY_RECEIPT_PDF', 'prescriptions', prescriptionId, null, clientIp(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="pharmacy-rx-${prescriptionId}.pdf"`);
    return res.send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function financialReportPdf(req, res) {
  try {
    const period = (req.query.period || 'week').toLowerCase();
    const { from, to } = periodBounds(period, req.query.from, req.query.to);
    const fromStr = from.toISOString().slice(0, 19).replace('T', ' ');
    const toStr = to.toISOString().slice(0, 19).replace('T', ' ');

    const [payRows] = await pool.execute(
      `SELECT payment_type, SUM(amount) AS total
       FROM payments WHERE created_at >= ? AND created_at <= ?
       GROUP BY payment_type`,
      [fromStr, toStr]
    );
    const totals = { consultation: 0, pharmacy: 0, lab: 0 };
    for (const r of payRows) totals[r.payment_type] = Number(r.total);
    const revenue = totals.consultation + totals.pharmacy + totals.lab;
    const [procRows] = await pool.execute(
      `SELECT COALESCE(SUM(it.quantity * i.cost_price), 0) AS procurement
       FROM inventory_transactions it
       JOIN inventory i ON i.id = it.inventory_id
       WHERE it.transaction_type = 'restock' AND it.created_at >= ? AND it.created_at <= ?`,
      [fromStr, toStr]
    );
    const procurement = Number(procRows[0]?.procurement || 0);
    const net = revenue - procurement;

    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.fontSize(16).text('Financial Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Period: ${from.toDateString()} - ${to.toDateString()}`);
    doc.text(`Consultation: KES ${totals.consultation.toFixed(2)}`);
    doc.text(`Pharmacy: KES ${totals.pharmacy.toFixed(2)}`);
    doc.text(`Lab: KES ${totals.lab.toFixed(2)}`);
    doc.text(`Procurement (est.): KES ${procurement.toFixed(2)}`);
    doc.text(`Net: KES ${net.toFixed(2)}`);
    doc.end();
    const buf = await done;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="financial-report.pdf"');
    return res.send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
