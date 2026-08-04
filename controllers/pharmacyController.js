import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

function receiptNumber() {
  return `RCP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function pharmacyQueue(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT pr.*, p.full_name AS patient_name, p.unique_id, u.full_name AS doctor_name, v.id AS visit_id
       FROM prescriptions pr
       JOIN visits v ON v.id = pr.visit_id
       JOIN patients p ON p.id = v.patient_id
       JOIN users u ON u.id = pr.doctor_id
       WHERE pr.status = 'pending' AND v.status = 'pharmacy'
       ORDER BY pr.created_at ASC`
    );
    for (const row of rows) {
      const [items] = await pool.execute(`SELECT * FROM prescription_items WHERE prescription_id = ?`, [row.id]);
      row.items = items;
    }
    return res.json({ success: true, queue: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function pharmacyInventory(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, product_name, category, current_stock, reorder_level, cost_price, selling_price, unit,
              DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date
       FROM inventory ORDER BY product_name`
    );
    return res.json({ success: true, inventory: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function dispense(req, res) {
  const conn = await pool.getConnection();
  try {
    const { prescription_id, payment_method, allocations } = req.body;
    const prId = Number(prescription_id);
    if (!prId || !Array.isArray(allocations) || allocations.length === 0) {
      return res.status(400).json({ success: false, message: 'prescription_id and allocations[] required' });
    }
    const method = payment_method || 'cash';

    await conn.beginTransaction();
    const [prows] = await conn.execute(
      `SELECT pr.id, pr.visit_id, pr.status, v.patient_id, v.status AS visit_status
       FROM prescriptions pr
       JOIN visits v ON v.id = pr.visit_id
       WHERE pr.id = ? FOR UPDATE`,
      [prId]
    );
    const presc = prows[0];
    if (!presc || presc.status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Prescription not pending' });
    }
    if (presc.visit_status !== 'pharmacy') {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Visit not in pharmacy stage' });
    }

    const [pItems] = await conn.execute(`SELECT * FROM prescription_items WHERE prescription_id = ?`, [prId]);
    const itemById = Object.fromEntries(pItems.map((x) => [x.id, x]));

    let total = 0;
    const lineDetails = [];
    const lowStock = [];

    for (const a of allocations) {
      const piId = Number(a.prescription_item_id);
      const invId = Number(a.inventory_id);
      const pi = itemById[piId];
      if (!pi) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: `Invalid prescription_item_id ${piId}` });
      }
      const [invRows] = await conn.execute(
        `SELECT id, product_name, current_stock, selling_price, reorder_level FROM inventory WHERE id = ? FOR UPDATE`,
        [invId]
      );
      const inv = invRows[0];
      if (!inv) {
        await conn.rollback();
        return res.status(404).json({ success: false, message: `Inventory ${invId} not found` });
      }
      const qty = Number(pi.quantity);
      if (inv.current_stock < qty) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${inv.product_name} (need ${qty}, have ${inv.current_stock})`,
        });
      }
      const lineTotal = Number(inv.selling_price) * qty;
      total += lineTotal;
      lineDetails.push({
        label: `Pharmacy - ${inv.product_name} x${qty}`,
        amount: lineTotal,
        inventory_id: invId,
        qty,
      });

      await conn.execute(`UPDATE inventory SET current_stock = current_stock - ? WHERE id = ?`, [qty, invId]);
      await conn.execute(
        `INSERT INTO inventory_transactions (inventory_id, transaction_type, quantity, reference_id, performed_by, note)
         VALUES (?, 'dispensed', ?, ?, ?, ?)`,
        [invId, qty, presc.visit_id, req.user.id, `Prescription ${prId} item ${piId}`]
      );

      const [after] = await conn.execute(
        `SELECT current_stock, reorder_level FROM inventory WHERE id = ?`,
        [invId]
      );
      if (after[0].current_stock <= after[0].reorder_level) {
        lowStock.push({ inventory_id: invId, product_name: inv.product_name, current_stock: after[0].current_stock });
      }
    }

    const rno = receiptNumber();
    const detailsObj = {
      lines: lineDetails.map((l) => ({ label: l.label, amount: l.amount })),
    };
    const [rIns] = await conn.execute(
      `INSERT INTO receipts (visit_id, patient_id, receipt_number, total_amount, payment_method, details, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [presc.visit_id, presc.patient_id, rno, total, method, JSON.stringify(detailsObj), req.user.id]
    );
    const receiptId = rIns.insertId;

    await conn.execute(
      `INSERT INTO payments (visit_id, patient_id, payment_type, amount, payment_method, received_by, receipt_id)
       VALUES (?, ?, 'pharmacy', ?, ?, ?, ?)`,
      [presc.visit_id, presc.patient_id, total, method, req.user.id, receiptId]
    );

    await conn.execute(`UPDATE prescriptions SET status = 'dispensed' WHERE id = ?`, [prId]);
    await conn.execute(`UPDATE visits SET status = 'completed', completed_at = NOW() WHERE id = ?`, [presc.visit_id]);

    await conn.commit();
    await auditLog(req.user.id, 'PHARMACY_DISPENSE', 'prescriptions', prId, { receipt_id: receiptId, total }, clientIp(req));
    return res.json({
      success: true,
      receipt_id: receiptId,
      receipt_number: rno,
      total,
      low_stock_alerts: lowStock,
    });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    conn.release();
  }
}

/** Pharmacy payments received today by this pharmacist (dispensed visits). */
export async function pharmacyCompletedToday(req, res) {
  try {
    const uid = req.user.id;
    const [rows] = await pool.execute(
      `SELECT py.id AS ref_id,
              py.created_at AS recorded_at,
              py.amount,
              py.visit_id,
              p.full_name AS patient_name,
              p.unique_id,
              'dispensed' AS outcome
       FROM payments py
       JOIN visits v ON v.id = py.visit_id
       JOIN patients p ON p.id = v.patient_id
       WHERE py.payment_type = 'pharmacy' AND py.received_by = ? AND DATE(py.created_at) = CURDATE()
       ORDER BY py.created_at DESC`,
      [uid]
    );
    return res.json({ success: true, items: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Pharmacy payment row + prescription lines for the dispensing pharmacist (or admin). */
export async function getMyPharmacySale(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid id' });
    const isAdmin = req.user.role === 'admin';
    const [rows] = await pool.execute(
      isAdmin
        ? `SELECT py.*, v.id AS visit_id, p.full_name AS patient_name, p.unique_id
            FROM payments py
            JOIN visits v ON v.id = py.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE py.id = ? AND py.payment_type = 'pharmacy'`
        : `SELECT py.*, v.id AS visit_id, p.full_name AS patient_name, p.unique_id
            FROM payments py
            JOIN visits v ON v.id = py.visit_id
            JOIN patients p ON p.id = v.patient_id
            WHERE py.id = ? AND py.payment_type = 'pharmacy' AND py.received_by = ?`,
      isAdmin ? [id] : [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const pay = rows[0];
    const [rxRows] = await pool.execute(
      `SELECT pr.* FROM prescriptions pr WHERE pr.visit_id = ? AND pr.status = 'dispensed' ORDER BY pr.updated_at DESC LIMIT 1`,
      [pay.visit_id]
    );
    const pr = rxRows[0] || null;
    let items = [];
    if (pr) {
      const [it] = await pool.execute(`SELECT * FROM prescription_items WHERE prescription_id = ?`, [pr.id]);
      items = it;
    }
    return res.json({ success: true, payment: pay, prescription: pr, items });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
