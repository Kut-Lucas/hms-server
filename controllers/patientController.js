import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';

function ageFromDob(dob) {
  const d = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function randomDigits(n) {
  return String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
}

async function generateUniqueMinor() {
  const year = new Date().getFullYear();
  for (let i = 0; i < 20; i++) {
    const uid = `MIN-${year}-${randomDigits(4)}`;
    const [ex] = await pool.execute(`SELECT id FROM patients WHERE unique_id = ?`, [uid]);
    if (!ex.length) return uid;
  }
  throw new Error('Could not generate minor ID');
}

async function generateTempId() {
  const year = new Date().getFullYear();
  for (let i = 0; i < 20; i++) {
    const uid = `TMP-${year}-${randomDigits(5)}`;
    const [ex] = await pool.execute(`SELECT id FROM patients WHERE unique_id = ?`, [uid]);
    if (!ex.length) return uid;
  }
  throw new Error('Could not generate temporary ID');
}

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

export async function createPatient(req, res) {
  try {
    const {
      full_name,
      date_of_birth,
      gender,
      phone,
      id_type,
      id_number,
      passport_number,
      guardian_unique_id,
    } = req.body;

    if (!full_name || !date_of_birth || !gender) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const age = ageFromDob(date_of_birth);
    let resolvedType = id_type;
    let uniqueId;

    if (!resolvedType) {
      if (age < 18) resolvedType = 'minor';
      else resolvedType = 'national_id';
    }

    if (resolvedType === 'national_id') {
      const nid = (id_number || '').trim();
      if (!nid) {
        return res.status(400).json({ success: false, message: 'National ID required' });
      }
      uniqueId = nid;
    } else if (resolvedType === 'passport') {
      const pp = (passport_number || id_number || '').trim();
      if (!pp) {
        return res.status(400).json({ success: false, message: 'Passport number required' });
      }
      uniqueId = pp.startsWith('PP-') ? pp : `PP-${pp}`;
    } else if (resolvedType === 'minor') {
      if (age >= 18) {
        return res.status(400).json({ success: false, message: 'Patient is 18+; use national ID or passport' });
      }
      const g = (guardian_unique_id || '').trim();
      if (!g) {
        return res.status(400).json({ success: false, message: "Guardian's national ID required for minors" });
      }
      uniqueId = await generateUniqueMinor();
      const [ins] = await pool.execute(
        `INSERT INTO patients (unique_id, id_type, full_name, date_of_birth, gender, phone, guardian_id)
         VALUES (?, 'minor', ?, ?, ?, ?, ?)`,
        [uniqueId, full_name.trim(), date_of_birth, gender, phone || null, g]
      );
      await auditLog(req.user.id, 'PATIENT_CREATE', 'patients', ins.insertId, { unique_id: uniqueId }, clientIp(req));
      return res.status(201).json({
        success: true,
        patient: { id: ins.insertId, unique_id: uniqueId, id_type: 'minor', guardian_id: g },
      });
    } else if (resolvedType === 'temporary') {
      uniqueId = await generateTempId();
    } else {
      return res.status(400).json({ success: false, message: 'Invalid id_type' });
    }

    const [existing] = await pool.execute(`SELECT id, full_name, unique_id FROM patients WHERE unique_id = ?`, [
      uniqueId,
    ]);
    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: 'Patient already exists. Open a new visit for this patient.',
        patient: existing[0],
      });
    }

    const [ins] = await pool.execute(
      `INSERT INTO patients (unique_id, id_type, full_name, date_of_birth, gender, phone, guardian_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [uniqueId, resolvedType, full_name.trim(), date_of_birth, gender, phone || null]
    );
    await auditLog(req.user.id, 'PATIENT_CREATE', 'patients', ins.insertId, { unique_id: uniqueId }, clientIp(req));
    return res.status(201).json({
      success: true,
      patient: { id: ins.insertId, unique_id: uniqueId, id_type: resolvedType },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Patients whose record was created today (reception — see who is registered but may still need a visit). */
export async function listRegisteredToday(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT p.id, p.full_name, p.unique_id, p.id_type, p.phone, p.created_at,
        EXISTS (
          SELECT 1 FROM visits v
          WHERE v.patient_id = p.id
            AND DATE(v.created_at) = CURDATE()
            AND v.status != 'completed'
        ) AS has_open_visit_today
       FROM patients p
       WHERE DATE(p.created_at) = CURDATE()
       ORDER BY p.created_at DESC`
    );
    return res.json({ success: true, patients: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function searchPatients(req, res) {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ success: false, message: 'Query at least 2 characters' });
    }
    const like = `%${q}%`;
    const [rows] = await pool.execute(
      `SELECT id, unique_id, full_name, date_of_birth, gender, phone, id_type, created_at
       FROM patients
       WHERE full_name LIKE ? OR unique_id LIKE ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [like, like]
    );
    return res.json({ success: true, patients: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function getPatient(req, res) {
  try {
    const id = Number(req.params.id);
    const [p] = await pool.execute(`SELECT * FROM patients WHERE id = ?`, [id]);
    if (!p.length) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }
    const [visits] = await pool.execute(
      `SELECT v.*, u.full_name AS receptionist_name
       FROM visits v
       JOIN users u ON u.id = v.receptionist_id
       WHERE v.patient_id = ?
       ORDER BY v.created_at DESC`,
      [id]
    );
    return res.json({ success: true, patient: p[0], visits });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function getPatientVitals(req, res) {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.execute(
      `SELECT vi.*, v.created_at AS visit_date, v.id AS visit_id
       FROM vitals vi
       JOIN visits v ON v.id = vi.visit_id
       WHERE v.patient_id = ?
       ORDER BY vi.recorded_at ASC`,
      [id]
    );
    return res.json({ success: true, vitals: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
