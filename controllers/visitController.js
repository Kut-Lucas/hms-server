import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

function receiptNumber() {
  return `RCP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function createVisit(req, res) {
  const conn = await pool.getConnection();
  try {
    const { patient_id, consultation_fee, fee_paid, payment_method, visit_type } = req.body;
    const pid = Number(patient_id);
    const fee = Number(consultation_fee);
    if (!pid || Number.isNaN(fee) || fee < 0) {
      return res.status(400).json({ success: false, message: 'Invalid patient or fee' });
    }
    const paid = Boolean(fee_paid);
    const method = payment_method || 'cash';
    const vtype = visit_type === 'dressing' ? 'dressing' : 'consultation';
    // Dressing patients skip triage/doctor and go straight to lab
    const initialStatus = vtype === 'dressing' ? 'lab' : 'registered';
    if (paid && fee === 0) {
      return res.status(400).json({ success: false, message: 'Paid visit requires consultation fee > 0' });
    }

    await conn.beginTransaction();
    const [pRows] = await conn.execute(`SELECT id FROM patients WHERE id = ?`, [pid]);
    if (!pRows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }

    const [vIns] = await conn.execute(
      `INSERT INTO visits (patient_id, receptionist_id, consultation_fee, fee_paid, visit_type, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [pid, req.user.id, fee, paid, vtype, initialStatus]
    );
    const visitId = vIns.insertId;

    if (paid && fee > 0) {
      const rno = receiptNumber();
      const details = JSON.stringify({ lines: [{ label: 'Consultation Fee', amount: fee }] });
      const [rIns] = await conn.execute(
        `INSERT INTO receipts (visit_id, patient_id, receipt_number, total_amount, payment_method, details, issued_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [visitId, pid, rno, fee, method, details, req.user.id]
      );
      const receiptId = rIns.insertId;
      await conn.execute(
        `INSERT INTO payments (visit_id, patient_id, payment_type, amount, payment_method, received_by, receipt_id)
         VALUES (?, ?, 'consultation', ?, ?, ?, ?)`,
        [visitId, pid, fee, method, req.user.id, receiptId]
      );
    }

    await conn.commit();
    await auditLog(req.user.id, 'VISIT_CREATE', 'visits', visitId, { patient_id: pid, fee_paid: paid, visit_type: vtype }, clientIp(req));
    return res.status(201).json({ success: true, visit: { id: visitId, status: initialStatus, fee_paid: paid, visit_type: vtype } });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    conn.release();
  }
}

export async function listActiveVisits(req, res) {
  try {
    const role = req.user.role;
    let sql;
    const params = [];

    if (role === 'triage') {
      sql = `SELECT v.*, p.full_name, p.unique_id, DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth, p.gender
             FROM visits v
             JOIN patients p ON p.id = v.patient_id
             WHERE v.status = 'registered'
             ORDER BY v.created_at ASC`;
    } else if (role === 'doctor') {
      sql = `SELECT v.*, p.full_name, p.unique_id, DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth, p.gender
             FROM visits v
             JOIN patients p ON p.id = v.patient_id
             WHERE v.status = 'doctor'
             ORDER BY v.created_at ASC`;
    } else if (role === 'pharmacist') {
      sql = `SELECT DISTINCT v.*, p.full_name, p.unique_id
             FROM visits v
             JOIN patients p ON p.id = v.patient_id
             JOIN prescriptions pr ON pr.visit_id = v.id AND pr.status = 'pending'
             WHERE v.status = 'pharmacy'
             ORDER BY v.created_at ASC`;
    } else if (role === 'receptionist') {
      sql = `SELECT v.*, p.full_name, p.unique_id
             FROM visits v
             JOIN patients p ON p.id = v.patient_id
             WHERE v.status != 'completed' AND DATE(v.created_at) = CURDATE()
             ORDER BY v.created_at DESC`;
    } else if (role === 'admin') {
      sql = `SELECT v.*, p.full_name, p.unique_id
             FROM visits v
             JOIN patients p ON p.id = v.patient_id
             WHERE v.status != 'completed'
             ORDER BY v.created_at DESC
             LIMIT 200`;
    } else {
      sql = `SELECT v.*, p.full_name, p.unique_id
             FROM visits v
             JOIN patients p ON p.id = v.patient_id
             WHERE v.status != 'completed'
             ORDER BY v.created_at DESC
             LIMIT 100`;
    }

    const [rows] = await pool.execute(sql, params);
    return res.json({ success: true, visits: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Visits marked completed today (reception / discharge tracking). */
export async function listTodayCompletedVisits(req, res) {
  try {
    if (!['receptionist', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const [rows] = await pool.execute(
      `SELECT v.*, p.full_name, p.unique_id
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE v.status = 'completed'
         AND (
           DATE(v.completed_at) = CURDATE()
           OR (v.completed_at IS NULL AND DATE(v.updated_at) = CURDATE())
         )
       ORDER BY COALESCE(v.completed_at, v.updated_at) DESC`
    );
    return res.json({ success: true, visits: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function getVisit(req, res) {
  try {
    const id = Number(req.params.id);
    const [v] = await pool.execute(
      `SELECT v.*,
              p.id AS patient_row_id,
              p.unique_id,
              p.full_name,
              DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth,
              p.gender,
              p.phone,
              p.id_type,
              p.guardian_id,
              ur.full_name AS receptionist_name
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       JOIN users ur ON ur.id = v.receptionist_id
       WHERE v.id = ?`,
      [id]
    );
    if (!v.length) {
      return res.status(404).json({ success: false, message: 'Visit not found' });
    }
    const visit = v[0];
    const [vitals] = await pool.execute(
      `SELECT vi.*, u.full_name AS triage_name FROM vitals vi JOIN users u ON u.id = vi.triage_user_id WHERE vi.visit_id = ?`,
      [id]
    );
    const [labs] = await pool.execute(
      `SELECT lo.*, u.full_name AS doctor_name,
        (SELECT lr.results FROM lab_results lr WHERE lr.lab_order_id = lo.id ORDER BY lr.submitted_at DESC LIMIT 1) AS latest_result
       FROM lab_orders lo
       JOIN users u ON u.id = lo.doctor_id
       WHERE lo.visit_id = ?
       ORDER BY lo.created_at ASC`,
      [id]
    );
    const [rx] = await pool.execute(
      `SELECT pr.*, u.full_name AS doctor_name FROM prescriptions pr JOIN users u ON u.id = pr.doctor_id WHERE pr.visit_id = ?`,
      [id]
    );
    for (const p of rx) {
      const [items] = await pool.execute(`SELECT * FROM prescription_items WHERE prescription_id = ?`, [p.id]);
      p.items = items;
    }
    const [payments] = await pool.execute(`SELECT * FROM payments WHERE visit_id = ? ORDER BY created_at`, [id]);
    const [receipts] = await pool.execute(`SELECT * FROM receipts WHERE visit_id = ? ORDER BY issued_at`, [id]);
    return res.json({
      success: true,
      visit,
      vitals,
      lab_orders: labs,
      prescriptions: rx,
      payments,
      receipts,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function patchVisitStatus(req, res) {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const allowed = ['registered', 'triage', 'doctor', 'lab', 'pharmacy', 'completed'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const [rows] = await pool.execute(`SELECT status FROM visits WHERE id = ?`, [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Visit not found' });
    }

    if (status === 'completed') {
      const [rc] = await pool.execute(`SELECT id FROM receipts WHERE visit_id = ? LIMIT 1`, [id]);
      if (!rc.length) {
        return res.status(400).json({
          success: false,
          message: 'Cannot complete visit without a receipt on file',
        });
      }
    }

    await pool.execute(`UPDATE visits SET status = ?, completed_at = IF(? = 'completed', NOW(), completed_at) WHERE id = ?`, [
      status,
      status,
      id,
    ]);
    await auditLog(req.user.id, 'VISIT_STATUS', 'visits', id, { to: status }, clientIp(req));
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
