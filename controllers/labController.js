import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';
import { buildLabReportPdfBuffer } from '../utils/receiptPdf.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

function receiptNumber() {
  return `RCP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function labQueue(req, res) {
  try {
    // Regular lab orders from doctor
    const [orders] = await pool.execute(
      `SELECT lo.*, v.patient_id, v.visit_type, p.full_name AS patient_name, p.unique_id, u.full_name AS doctor_name
       FROM lab_orders lo
       JOIN visits v ON v.id = lo.visit_id
       JOIN patients p ON p.id = v.patient_id
       JOIN users u ON u.id = lo.doctor_id
       WHERE lo.status IN ('pending','in_progress')
       ORDER BY lo.created_at ASC`
    );
    // Dressing visits sent directly to lab by reception
    const [dressings] = await pool.execute(
      `SELECT v.id AS visit_id, v.id AS id, v.patient_id, v.visit_type, v.created_at,
              p.full_name AS patient_name, p.unique_id,
              'dressing' AS queue_type, 'pending' AS status,
              NULL AS doctor_name, NULL AS instructions, NULL AS selected_tests, 0 AS lab_fee
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE v.visit_type = 'dressing' AND v.status = 'lab'
       ORDER BY v.created_at ASC`
    );
    const queue = [
      ...dressings.map(d => ({ ...d, is_dressing: true })),
      ...orders.map(o => ({ ...o, is_dressing: false })),
    ];
    return res.json({ success: true, queue });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function submitDressingCharge(req, res) {
  const conn = await pool.getConnection();
  try {
    const { visit_id, lab_fee, payment_method } = req.body;
    const vid = Number(visit_id);
    if (!vid) return res.status(400).json({ success: false, message: 'visit_id required' });
    const fee = Math.max(0, Number(lab_fee || 0));
    const method = payment_method || 'cash';
    await conn.beginTransaction();
    const [vrows] = await conn.execute(
      `SELECT id, patient_id, visit_type, status FROM visits WHERE id = ? FOR UPDATE`, [vid]
    );
    const visit = vrows[0];
    if (!visit) { await conn.rollback(); return res.status(404).json({ success: false, message: 'Visit not found' }); }
    if (visit.visit_type !== 'dressing' || visit.status !== 'lab') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Not a dressing visit in lab queue' });
    }
    if (fee > 0) {
      const rno = receiptNumber();
      const details = JSON.stringify({ lines: [{ label: 'Dressing', amount: fee }] });
      const [rIns] = await conn.execute(
        `INSERT INTO receipts (visit_id, patient_id, receipt_number, total_amount, payment_method, details, issued_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [vid, visit.patient_id, rno, fee, method, details, req.user.id]
      );
      await conn.execute(
        `INSERT INTO payments (visit_id, patient_id, payment_type, amount, payment_method, received_by, receipt_id)
         VALUES (?, ?, 'lab', ?, ?, ?, ?)`,
        [vid, visit.patient_id, fee, method, req.user.id, rIns.insertId]
      );
    }
    await conn.execute(`UPDATE visits SET status = 'completed', completed_at = NOW() WHERE id = ?`, [vid]);
    await conn.commit();
    await auditLog(req.user.id, 'DRESSING_CHARGE', 'visits', vid, { fee }, clientIp(req));
    return res.status(201).json({ success: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    conn.release();
  }
}

export async function startLabOrder(req, res) {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.execute(`SELECT status FROM lab_orders WHERE id = ?`, [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (rows[0].status === 'completed') {
      return res.status(400).json({ success: false, message: 'Order already completed' });
    }
    await pool.execute(`UPDATE lab_orders SET status = 'in_progress' WHERE id = ?`, [id]);
    await auditLog(req.user.id, 'LAB_ORDER_START', 'lab_orders', id, null, clientIp(req));
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function submitLabResults(req, res) {
  const conn = await pool.getConnection();
  try {
    const { lab_order_id, results, result_file_url, payment_method, lab_fee } = req.body;
    const oid = Number(lab_order_id);
    if (!oid || !results?.trim()) {
      return res.status(400).json({ success: false, message: 'lab_order_id and results required' });
    }
    const method = payment_method || 'cash';

    await conn.beginTransaction();
    const [ords] = await conn.execute(
      `SELECT lo.id, lo.visit_id, lo.status, lo.lab_fee, v.patient_id, v.status AS visit_status
       FROM lab_orders lo
       JOIN visits v ON v.id = lo.visit_id
       WHERE lo.id = ? FOR UPDATE`,
      [oid]
    );
    const order = ords[0];
    if (!order) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Lab order not found' });
    }
    if (order.status === 'completed') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Results already submitted' });
    }

    const [rIns] = await conn.execute(
      `INSERT INTO lab_results (lab_order_id, lab_tech_id, results, result_file_url) VALUES (?, ?, ?, ?)`,
      [oid, req.user.id, results.trim(), result_file_url || null]
    );
    const newResultId = rIns.insertId;
    const labFee =
      lab_fee != null && lab_fee !== '' ? Math.max(0, Number(lab_fee)) : Number(order.lab_fee || 0);
    await conn.execute(`UPDATE lab_orders SET status = 'completed', lab_fee = ? WHERE id = ?`, [labFee, oid]);
    await conn.execute(`UPDATE visits SET status = 'doctor' WHERE id = ?`, [order.visit_id]);
    if (labFee > 0) {
      const rno = receiptNumber();
      const details = JSON.stringify({ lines: [{ label: 'Laboratory services', amount: labFee }] });
      const [rIns] = await conn.execute(
        `INSERT INTO receipts (visit_id, patient_id, receipt_number, total_amount, payment_method, details, issued_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [order.visit_id, order.patient_id, rno, labFee, method, details, req.user.id]
      );
      const receiptId = rIns.insertId;
      await conn.execute(
        `INSERT INTO payments (visit_id, patient_id, payment_type, amount, payment_method, received_by, receipt_id)
         VALUES (?, ?, 'lab', ?, ?, ?, ?)`,
        [order.visit_id, order.patient_id, labFee, method, req.user.id, receiptId]
      );
    }

    await conn.commit();
    await auditLog(req.user.id, 'LAB_RESULT_SUBMIT', 'lab_orders', oid, { visit_id: order.visit_id }, clientIp(req));
    return res.status(201).json({ success: true, result_id: newResultId });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    conn.release();
  }
}

/** Lab results submitted today by this technician. */
export async function labCompletedToday(req, res) {
  try {
    const uid = req.user.id;
    const [rows] = await pool.execute(
      `SELECT lr.id AS ref_id,
              lr.submitted_at AS recorded_at,
              lo.id AS lab_order_id,
              lo.visit_id,
              LEFT(lr.results, 120) AS detail,
              p.full_name AS patient_name,
              p.unique_id,
              'results_submitted' AS outcome
       FROM lab_results lr
       JOIN lab_orders lo ON lo.id = lr.lab_order_id
       JOIN visits v ON v.id = lo.visit_id
       JOIN patients p ON p.id = v.patient_id
       WHERE lr.lab_tech_id = ? AND DATE(lr.submitted_at) = CURDATE()
       ORDER BY lr.submitted_at DESC`,
      [uid]
    );
    return res.json({ success: true, items: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function getMyLabResult(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const isAdmin = req.user.role === 'admin';
    const [rows] = await pool.execute(
      isAdmin
        ? `SELECT lr.*, lo.instructions, lo.lab_fee, lo.visit_id, lo.id AS lab_order_id,
                  p.full_name AS patient_name, p.unique_id
            FROM lab_results lr
            JOIN lab_orders lo ON lo.id = lr.lab_order_id
            JOIN visits v ON v.id = lo.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE lr.id = ?`
        : `SELECT lr.*, lo.instructions, lo.lab_fee, lo.visit_id, lo.id AS lab_order_id,
                  p.full_name AS patient_name, p.unique_id
            FROM lab_results lr
            JOIN lab_orders lo ON lo.id = lr.lab_order_id
            JOIN visits v ON v.id = lo.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE lr.id = ? AND lr.lab_tech_id = ?`,
      isAdmin ? [id] : [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, result: rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Generate a printable lab results report PDF for a specific lab_result record. */
export async function labResultReportPdf(req, res) {
  try {
    const resultId = Number(req.params.resultId);
    if (!resultId) return res.status(400).json({ success: false, message: 'Invalid id' });

    const [rows] = await pool.execute(
      `SELECT lr.id, lr.results, lr.submitted_at,
              lo.id AS lab_order_id, lo.instructions, lo.lab_fee, lo.selected_tests,
              p.full_name AS patient_name, p.unique_id,
              ud.full_name AS doctor_name,
              ut.full_name AS tech_name
       FROM lab_results lr
       JOIN lab_orders lo ON lo.id = lr.lab_order_id
       JOIN visits v ON v.id = lo.visit_id
       JOIN patients p ON p.id = v.patient_id
       JOIN users ud ON ud.id = lo.doctor_id
       JOIN users ut ON ut.id = lr.lab_tech_id
       WHERE lr.id = ?`,
      [resultId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Lab result not found' });

    // Parse selected_tests JSON
    let selectedTests = [];
    try {
      const raw = typeof row.selected_tests === 'string'
        ? JSON.parse(row.selected_tests)
        : row.selected_tests;
      selectedTests = Array.isArray(raw) ? raw : [];
    } catch { /* ignore */ }

    const dateStr = new Date(row.submitted_at).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' });
    const buf = await buildLabReportPdfBuffer({
      labOrderId: row.lab_order_id,
      dateStr,
      patientName: row.patient_name,
      uniqueId: row.unique_id,
      doctorName: row.doctor_name,
      techName: row.tech_name,
      selectedTests,
      instructions: row.instructions,
      results: row.results,
      labFee: row.lab_fee,
    });

    await auditLog(req.user?.id || null, 'LAB_REPORT_PDF', 'lab_results', resultId, null,
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lab-report-${resultId}.pdf"`);
    return res.send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
