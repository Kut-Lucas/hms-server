import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

export async function doctorQueue(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT v.*, p.full_name, p.unique_id, DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth, p.gender, p.phone,
              EXISTS(
                SELECT 1 FROM lab_orders lo
                WHERE lo.visit_id = v.id AND lo.status = 'completed'
              ) AS returned_from_lab
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE v.status = 'doctor'
       ORDER BY v.created_at ASC`
    );
    const awaiting_consultation = rows.filter((r) => !r.returned_from_lab);
    const returned_from_lab = rows.filter((r) => r.returned_from_lab);
    return res.json({ success: true, awaiting_consultation, returned_from_lab, queue: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Lab orders and prescriptions created today by this doctor (for daily log). */
export async function doctorHandledToday(req, res) {
  try {
    const uid = req.user.id;
    const [labRows] = await pool.execute(
      `SELECT lo.id AS ref_id,
              lo.created_at AS recorded_at,
              lo.visit_id,
              lo.instructions AS detail,
              p.full_name AS patient_name,
              p.unique_id,
              'sent_to_lab' AS outcome
       FROM lab_orders lo
       JOIN visits v ON v.id = lo.visit_id
       JOIN patients p ON p.id = v.patient_id
       WHERE lo.doctor_id = ? AND DATE(lo.created_at) = CURDATE()
       ORDER BY lo.created_at DESC`,
      [uid]
    );
    const [rxRows] = await pool.execute(
      `SELECT pr.id AS ref_id,
              pr.created_at AS recorded_at,
              pr.visit_id,
              COALESCE(pr.notes, '') AS detail,
              p.full_name AS patient_name,
              p.unique_id,
              'sent_to_pharmacy' AS outcome
       FROM prescriptions pr
       JOIN visits v ON v.id = pr.visit_id
       JOIN patients p ON p.id = v.patient_id
       WHERE pr.doctor_id = ? AND DATE(pr.created_at) = CURDATE()
       ORDER BY pr.created_at DESC`,
      [uid]
    );
    const items = [...labRows, ...rxRows].sort(
      (a, b) => new Date(b.recorded_at) - new Date(a.recorded_at)
    );
    return res.json({ success: true, items, sent_to_lab: labRows, sent_to_pharmacy: rxRows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function createLabOrder(req, res) {
  const conn = await pool.getConnection();
  try {
    const { visit_id, instructions, selected_tests } = req.body;
    const vid = Number(visit_id);
    // selected_tests is an array of {id, name, price}; instructions is auto-built on client but also accepted freeform
    const tests = Array.isArray(selected_tests) ? selected_tests : [];
    const autoInstructions = tests.length
      ? tests.map((t) => t.name).join(', ')
      : instructions?.trim() || '';
    if (!vid || !autoInstructions) {
      return res.status(400).json({ success: false, message: 'visit_id and at least one test (or instructions) required' });
    }
    // Sum min prices as the expected lab fee
    const fee = tests.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
    await conn.beginTransaction();
    const [vrows] = await conn.execute(`SELECT id, status FROM visits WHERE id = ? FOR UPDATE`, [vid]);
    const visit = vrows[0];
    if (!visit || visit.status !== 'doctor') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Visit not in doctor queue' });
    }
    const [ins] = await conn.execute(
      `INSERT INTO lab_orders (visit_id, doctor_id, instructions, selected_tests, lab_fee, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [vid, req.user.id, autoInstructions, tests.length ? JSON.stringify(tests) : null, fee]
    );
    await conn.execute(`UPDATE visits SET status = 'lab' WHERE id = ?`, [vid]);
    await conn.commit();
    await auditLog(req.user.id, 'LAB_ORDER_CREATE', 'lab_orders', ins.insertId, { visit_id: vid }, clientIp(req));
    return res.status(201).json({ success: true, lab_order_id: ins.insertId });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    conn.release();
  }
}

export async function createPrescription(req, res) {
  const conn = await pool.getConnection();
  try {
    const { visit_id, notes, diagnosis, items } = req.body;
    const vid = Number(visit_id);
    if (!vid || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'visit_id and items[] required' });
    }
    await conn.beginTransaction();
    const [vrows] = await conn.execute(`SELECT id, status FROM visits WHERE id = ? FOR UPDATE`, [vid]);
    const visit = vrows[0];
    if (!visit || visit.status !== 'doctor') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Visit not in doctor queue' });
    }
    const [pendingLab] = await conn.execute(
      `SELECT id FROM lab_orders WHERE visit_id = ? AND status IN ('pending','in_progress')`,
      [vid]
    );
    if (pendingLab.length) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: 'Complete or cancel pending lab orders before prescribing',
      });
    }
    const [pIns] = await conn.execute(
      `INSERT INTO prescriptions (visit_id, doctor_id, notes, diagnosis, status) VALUES (?, ?, ?, ?, 'pending')`,
      [vid, req.user.id, notes || null, diagnosis || null]
    );
    const rxId = pIns.insertId;
    for (const it of items) {
      if (!it.drug_name || !it.quantity) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: 'Each item needs drug_name and quantity' });
      }
      await conn.execute(
        `INSERT INTO prescription_items (prescription_id, drug_name, dosage, frequency, duration_days, quantity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rxId, it.drug_name, it.dosage || null, it.frequency || null, it.duration_days || null, Number(it.quantity)]
      );
    }
    await conn.execute(`UPDATE visits SET status = 'pharmacy' WHERE id = ?`, [vid]);
    await conn.commit();
    await auditLog(req.user.id, 'PRESCRIPTION_CREATE', 'prescriptions', rxId, { visit_id: vid }, clientIp(req));
    return res.status(201).json({ success: true, prescription_id: rxId });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    conn.release();
  }
}

/** Drug autocomplete — search inventory drugs by name (doctor use). */
export async function drugSearch(req, res) {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, drugs: [] });
    const [rows] = await pool.execute(
      `SELECT id, product_name AS name, selling_price, current_stock, unit
       FROM inventory
       WHERE category = 'drug' AND current_stock > 0 AND product_name LIKE ?
       ORDER BY product_name ASC
       LIMIT 15`,
      [`%${q}%`]
    );
    return res.json({ success: true, drugs: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Return all active lab tests. */
export async function getLabTests(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, price_min, price_max FROM lab_tests WHERE is_active = TRUE ORDER BY name ASC`
    );
    return res.json({ success: true, tests: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Return all active service procedures. */
export async function getServiceProcedures(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, category, price_min, price_max FROM service_procedures WHERE is_active = TRUE ORDER BY category, name ASC`
    );
    return res.json({ success: true, procedures: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function labResultsForVisit(req, res) {
  try {
    const visitId = Number(req.params.visitId);
    const [rows] = await pool.execute(
      `SELECT lr.*, lo.instructions, lo.id AS lab_order_id
       FROM lab_results lr
       JOIN lab_orders lo ON lo.id = lr.lab_order_id
       WHERE lo.visit_id = ?
       ORDER BY lr.submitted_at DESC`,
      [visitId]
    );
    return res.json({ success: true, results: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function getMyLabOrder(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const isAdmin = req.user.role === 'admin';
    const [rows] = await pool.execute(
      isAdmin
        ? `SELECT lo.*, p.full_name AS patient_name, p.unique_id, v.id AS visit_id
            FROM lab_orders lo
            JOIN visits v ON v.id = lo.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE lo.id = ?`
        : `SELECT lo.*, p.full_name AS patient_name, p.unique_id, v.id AS visit_id
            FROM lab_orders lo
            JOIN visits v ON v.id = lo.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE lo.id = ? AND lo.doctor_id = ?`,
      isAdmin ? [id] : [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, order: rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function getMyPrescription(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const isAdmin = req.user.role === 'admin';
    const [rows] = await pool.execute(
      isAdmin
        ? `SELECT pr.*, p.full_name AS patient_name, p.unique_id, v.id AS visit_id
            FROM prescriptions pr
            JOIN visits v ON v.id = pr.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE pr.id = ?`
        : `SELECT pr.*, p.full_name AS patient_name, p.unique_id, v.id AS visit_id
            FROM prescriptions pr
            JOIN visits v ON v.id = pr.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE pr.id = ? AND pr.doctor_id = ?`,
      isAdmin ? [id] : [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const pr = rows[0];
    const [items] = await pool.execute(`SELECT * FROM prescription_items WHERE prescription_id = ?`, [id]);
    pr.items = items;
    return res.json({ success: true, prescription: pr });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
