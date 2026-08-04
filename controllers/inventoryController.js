import { pool } from '../db/pool.js';
import { auditLog } from '../utils/auditLog.js';
import * as XLSX from 'xlsx';

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
}

export async function listInventory(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, product_name, category, current_stock, reorder_level, cost_price, selling_price, unit,
              DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
              created_at, updated_at
       FROM inventory ORDER BY product_name`
    );
    return res.json({ success: true, items: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function addInventory(req, res) {
  try {
    const {
      product_name,
      category,
      current_stock,
      reorder_level,
      cost_price,
      selling_price,
      unit,
      expiry_date,
    } = req.body;
    if (!product_name || cost_price == null || selling_price == null) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    const [ins] = await pool.execute(
      `INSERT INTO inventory (product_name, category, current_stock, reorder_level, cost_price, selling_price, unit, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_name.trim(),
        category || 'drug',
        Number(current_stock) || 0,
        Number(reorder_level) || 50,
        cost_price,
        selling_price,
        unit || 'units',
        expiry_date || null,
      ]
    );
    await auditLog(req.user.id, 'INVENTORY_CREATE', 'inventory', ins.insertId, { product_name }, clientIp(req));
    return res.status(201).json({ success: true, id: ins.insertId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function updateInventory(req, res) {
  try {
    const id = Number(req.params.id);
    const fields = ['product_name', 'category', 'reorder_level', 'cost_price', 'selling_price', 'unit', 'expiry_date'];
    const updates = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        vals.push(req.body[f]);
      }
    }
    if (!updates.length) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }
    vals.push(id);
    await pool.execute(`UPDATE inventory SET ${updates.join(', ')} WHERE id = ?`, vals);
    await auditLog(req.user.id, 'INVENTORY_UPDATE', 'inventory', id, req.body, clientIp(req));
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function restock(req, res) {
  try {
    const id = Number(req.params.id);
    const qty = Number(req.body.quantity);
    if (!id || !qty || qty < 1) {
      return res.status(400).json({ success: false, message: 'Valid quantity required' });
    }
    await pool.execute(`UPDATE inventory SET current_stock = current_stock + ? WHERE id = ?`, [qty, id]);
    await pool.execute(
      `INSERT INTO inventory_transactions (inventory_id, transaction_type, quantity, reference_id, performed_by, note)
       VALUES (?, 'restock', ?, NULL, ?, ?)`,
      [id, qty, req.user.id, req.body.note || null]
    );
    await auditLog(req.user.id, 'INVENTORY_RESTOCK', 'inventory', id, { qty }, clientIp(req));
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function lowStock(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, product_name, category, current_stock, reorder_level, cost_price, selling_price, unit,
              DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
              created_at, updated_at
       FROM inventory WHERE current_stock <= reorder_level ORDER BY current_stock ASC`
    );
    return res.json({ success: true, items: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function usageReport(req, res) {
  try {
    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to query params required (YYYY-MM-DD)' });
    }
    const [rows] = await pool.execute(
      `SELECT i.id, i.product_name,
              SUM(it.quantity) AS qty_dispensed,
              SUM(it.quantity * i.cost_price) AS est_cost_value
       FROM inventory_transactions it
       JOIN inventory i ON i.id = it.inventory_id
       WHERE it.transaction_type = 'dispensed' AND DATE(it.created_at) BETWEEN ? AND ?
       GROUP BY i.id, i.product_name
       ORDER BY qty_dispensed DESC`,
      [from, to]
    );
    return res.json({ success: true, report: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/** Quantities prescribed (prescription lines), not necessarily dispensed from stock. */
export async function prescribedReport(req, res) {
  try {
    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to query params required (YYYY-MM-DD)' });
    }
    const [rows] = await pool.execute(
      `SELECT pi.drug_name,
              SUM(pi.quantity) AS qty_prescribed
       FROM prescription_items pi
       JOIN prescriptions pr ON pr.id = pi.prescription_id
       WHERE DATE(pr.created_at) BETWEEN ? AND ?
       GROUP BY pi.drug_name
       ORDER BY qty_prescribed DESC`,
      [from, to]
    );
    return res.json({ success: true, report: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

function normHeaderKey(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function getMappedCell(row, ...aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const want = normHeaderKey(alias);
    for (const k of keys) {
      if (normHeaderKey(k) === want) return row[k];
    }
  }
  return undefined;
}

function parseExpiryForDb(val) {
  if (val === '' || val == null) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number') {
    try {
      const o = XLSX.SSF.parse_date_code(val);
      if (o && o.y >= 1990 && o.y <= 2100) {
        return `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d || 1).padStart(2, '0')}`;
      }
    } catch {
      /* ignore */
    }
  }
  const s = String(val).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    const yyyy = dmy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

const ALLOWED_CATEGORY = new Set(['drug', 'supply', 'equipment', 'other']);

/** POST multipart file field "file" — CSV or Excel (.xlsx/.xls). */
export async function bulkImportInventory(req, res) {
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ success: false, message: 'Upload a file (field name: file)' });
  }
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ success: false, message: 'Workbook has no sheets' });
    }
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ success: false, message: 'Could not read file. Use .csv, .xlsx, or .xls' });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ success: false, message: 'No data rows found under the first sheet' });
  }

  const errors = [];
  let created = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const excelRow = i + 2;
    const rowEmpty = !Object.values(row).some((v) => v !== '' && v != null && String(v).trim() !== '');
    const product_name = String(getMappedCell(row, 'product_name', 'product', 'item', 'name', 'drug') ?? '').trim();
    if (!product_name) {
      if (rowEmpty) continue;
      errors.push({ row: excelRow, message: 'Skipped row (no product name)' });
      continue;
    }

    let category = String(getMappedCell(row, 'category', 'type') ?? 'drug')
      .trim()
      .toLowerCase();
    if (!ALLOWED_CATEGORY.has(category)) category = 'drug';

    const current_stock = Number(getMappedCell(row, 'current_stock', 'stock', 'quantity', 'qty')) || 0;
    const reorder_level = Number(getMappedCell(row, 'reorder_level', 'reorder', 'min_stock', 'reorder level')) || 50;

    const costRaw = getMappedCell(row, 'cost_price', 'cost', 'unit_cost', 'cost price');
    const sellRaw = getMappedCell(row, 'selling_price', 'sell', 'price', 'selling price', 'unit_price');
    const cost_price = Number(costRaw);
    const selling_price = Number(sellRaw);
    if (Number.isNaN(cost_price) || Number.isNaN(selling_price)) {
      errors.push({ row: excelRow, message: 'Invalid or missing cost_price / selling_price' });
      continue;
    }

    const unit = String(getMappedCell(row, 'unit', 'uom') ?? 'units').trim() || 'units';
    const expiryRaw = getMappedCell(row, 'expiry_date', 'expiry', 'exp_date', 'best_before', 'expiry date');
    const expiry_date = parseExpiryForDb(expiryRaw);

    try {
      await pool.execute(
        `INSERT INTO inventory (product_name, category, current_stock, reorder_level, cost_price, selling_price, unit, expiry_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [product_name, category, current_stock, reorder_level, cost_price, selling_price, unit, expiry_date]
      );
      created += 1;
    } catch (err) {
      console.error(err);
      errors.push({ row: excelRow, message: err.message || 'Insert failed' });
    }
  }

  await auditLog(
    req.user.id,
    'INVENTORY_BULK_IMPORT',
    'inventory',
    null,
    JSON.stringify({ created, failed: errors.length }),
    clientIp(req)
  );

  return res.json({
    success: true,
    created,
    failed: errors.length,
    errors,
  });
}
