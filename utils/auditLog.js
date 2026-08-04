import { pool } from '../db/pool.js';

export async function auditLog(userId, action, entity = null, entityId = null, details = null, ipAddress = null) {
  try {
    await pool.execute(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        action,
        entity,
        entityId,
        details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
        ipAddress,
      ]
    );
  } catch (e) {
    console.error('auditLog failed', e.message);
  }
}
