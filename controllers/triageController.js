import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

export async function triageQueue(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT v.*, p.full_name, p.unique_id, DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE v.status = 'registered'
       ORDER BY v.created_at ASC`
    );
    return res.json({ success: true, queue: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function submitVitals(req, res) {
  const conn = await pool.getConnection();
  try {
    const { visit_id, weight_kg, height_cm, bp_systolic, bp_diastolic, temperature_c, spo2, notes } = req.body;
    const vid = Number(visit_id);
    if (!vid) {
      return res.status(400).json({ success: false, message: 'visit_id required' });
    }
    await conn.beginTransaction();
    const [vrows] = await conn.execute(`SELECT id, status, patient_id FROM visits WHERE id = ? FOR UPDATE`, [vid]);
    const visit = vrows[0];
    if (!visit) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: 'Visit not found' });
    }
    if (visit.status !== 'registered') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Visit is not awaiting triage' });
    }
    await conn.execute(
      `INSERT INTO vitals (visit_id, triage_user_id, weight_kg, height_cm, bp_systolic, bp_diastolic, temperature_c, spo2, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vid, req.user.id, weight_kg || null, height_cm || null, bp_systolic || null, bp_diastolic || null, temperature_c || null, spo2 || null, notes || null]
    );
    await conn.execute(`UPDATE visits SET status = 'doctor' WHERE id = ?`, [vid]);
    await conn.commit();
    await auditLog(req.user.id, 'VITALS_SUBMIT', 'visits', vid, null, clientIp(req));
    return res.status(201).json({ success: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    conn.release();
  }
}

/** Vitals recorded today by this triage user. */
export async function triageCompletedToday(req, res) {
  try {
    const uid = req.user.id;
    const [rows] = await pool.execute(
      `SELECT vt.id AS ref_id,
              vt.visit_id,
              vt.recorded_at,
              p.full_name AS patient_name,
              p.unique_id,
              'attended' AS outcome
       FROM vitals vt
       JOIN visits v ON v.id = vt.visit_id
       JOIN patients p ON p.id = v.patient_id
       WHERE vt.triage_user_id = ? AND DATE(vt.recorded_at) = CURDATE()
       ORDER BY vt.recorded_at DESC`,
      [uid]
    );
    return res.json({ success: true, items: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Single vitals record (for triage user who recorded it, or admin). */
export async function getVitalsRecord(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const isAdmin = req.user.role === 'admin';
    const [rows] = await pool.execute(
      isAdmin
        ? `SELECT vt.*, v.id AS visit_id, p.full_name AS patient_name, p.unique_id
            FROM vitals vt
            JOIN visits v ON v.id = vt.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE vt.id = ?`
        : `SELECT vt.*, v.id AS visit_id, p.full_name AS patient_name, p.unique_id
            FROM vitals vt
            JOIN visits v ON v.id = vt.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE vt.id = ? AND vt.triage_user_id = ?`,
      isAdmin ? [id] : [id, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Record not found' });
    }
    return res.json({ success: true, record: rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
