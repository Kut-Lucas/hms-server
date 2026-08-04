import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

export async function listUsers(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, role, is_approved, is_active, created_at
       FROM users
       ORDER BY is_approved ASC, created_at DESC`
    );
    return res.json({ success: true, users: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function approveUser(req, res) {
  try {
    const id = Number(req.params.id);
    const { role } = req.body;
    const roles = ['receptionist', 'triage', 'doctor', 'pharmacist', 'lab_technician', 'admin'];
    if (!roles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    await pool.execute(`UPDATE users SET is_approved = TRUE, role = ? WHERE id = ?`, [role, id]);
    await auditLog(req.user.id, 'USER_APPROVE', 'users', id, { role }, clientIp(req));
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function changeRole(req, res) {
  try {
    const id = Number(req.params.id);
    const { role } = req.body;
    const roles = ['receptionist', 'triage', 'doctor', 'pharmacist', 'lab_technician', 'admin'];
    if (!roles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot change own role here' });
    }
    await pool.execute(`UPDATE users SET role = ? WHERE id = ?`, [role, id]);
    await auditLog(req.user.id, 'USER_ROLE', 'users', id, { role }, clientIp(req));
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function deactivateUser(req, res) {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate self' });
    }
    await pool.execute(`UPDATE users SET is_active = FALSE WHERE id = ?`, [id]);
    await pool.execute(`DELETE FROM refresh_tokens WHERE user_id = ?`, [id]);
    await auditLog(req.user.id, 'USER_DEACTIVATE', 'users', id, null, clientIp(req));
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function auditLogList(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const [rows] = await pool.execute(
      `SELECT a.*, u.email, u.full_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const [[{ cnt }]] = await pool.execute(`SELECT COUNT(*) AS cnt FROM audit_log`);
    return res.json({ success: true, logs: rows, total: cnt, page, limit });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function listAllPatients(req, res) {
  try {
    const q = (req.query.q || '').trim();
    let sql = `SELECT p.id, p.unique_id, p.full_name, p.gender,
                      DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth,
                      p.phone, p.id_type, p.created_at,
                      (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visit_count,
                      (SELECT MAX(v.created_at) FROM visits v WHERE v.patient_id = p.id) AS last_visit_at
               FROM patients p`;
    const params = [];
    if (q.length >= 2) {
      sql += ` WHERE p.full_name LIKE ? OR p.unique_id LIKE ?`;
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY p.created_at DESC LIMIT 500`;
    const [rows] = await pool.execute(sql, params);
    return res.json({ success: true, patients: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function listVisitsByDate(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.execute(
      `SELECT v.*, p.full_name, p.unique_id, p.phone
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE DATE(v.created_at) = ?
       ORDER BY v.created_at DESC`,
      [date]
    );
    return res.json({ success: true, date, visits: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function listQueueForDate(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.execute(
      `SELECT v.*, p.full_name, p.unique_id, p.phone
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE DATE(v.created_at) = ? AND v.status != 'completed'
       ORDER BY v.created_at ASC`,
      [date]
    );
    return res.json({ success: true, date, visits: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function listAttendedForDate(req, res) {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.execute(
      `SELECT v.*, p.full_name, p.unique_id, p.phone
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE v.status = 'completed'
         AND (DATE(v.completed_at) = ? OR (v.completed_at IS NULL AND DATE(v.updated_at) = ?))
       ORDER BY COALESCE(v.completed_at, v.updated_at) DESC`,
      [date, date]
    );
    return res.json({ success: true, date, visits: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * Admin: generate a one-time password-reset code for a user.
 * The plain code is returned to the admin once and never stored.
 * The SHA-256 hash is stored with a 2-minute expiry.
 */
export async function generateResetCode(req, res) {
  try {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ success: false, message: 'Invalid user id' });
    const [users] = await pool.execute(
      `SELECT id, full_name, email FROM users WHERE id = ? AND is_active = TRUE`,
      [userId]
    );
    if (!users.length) return res.status(404).json({ success: false, message: 'User not found or inactive' });

    // Generate 8-character uppercase alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

    // Remove any previous unused codes for this user
    await pool.execute(`DELETE FROM password_reset_codes WHERE user_id = ?`, [userId]);

    await pool.execute(
      `INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)`,
      [userId, codeHash, expiresAt]
    );

    await auditLog(req.user.id, 'RESET_CODE_GENERATED', 'users', userId, {}, clientIp(req));

    return res.status(201).json({
      success: true,
      code,           // plain — show once only
      expiresInSeconds: 120,
      user: { id: users[0].id, full_name: users[0].full_name, email: users[0].email },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function adminStats(req, res) {
  try {
    const [pt] = await pool.execute(
      `SELECT COUNT(DISTINCT patient_id) AS c FROM visits WHERE DATE(created_at) = CURDATE()`
    );
    const [av] = await pool.execute(`SELECT COUNT(*) AS c FROM visits WHERE status != 'completed'`);
    const [pu] = await pool.execute(`SELECT COUNT(*) AS c FROM users WHERE is_approved = FALSE`);
    const [pendingList] = await pool.execute(
      `SELECT id, full_name, email, created_at FROM users WHERE is_approved = FALSE ORDER BY created_at DESC LIMIT 15`
    );
    const [low] = await pool.execute(
      `SELECT COUNT(*) AS c FROM inventory WHERE current_stock <= reorder_level`
    );
    return res.json({
      success: true,
      stats: {
        patientsToday: pt[0]?.c ?? 0,
        activeVisits: av[0]?.c ?? 0,
        pendingApprovals: pu[0]?.c ?? 0,
        lowStockItems: low[0]?.c ?? 0,
        pendingUsers: pendingList,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
