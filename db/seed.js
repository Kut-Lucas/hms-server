import '../loadEnv.js';
import bcrypt from 'bcrypt';
import { pool } from './pool.js';

// Multicare Hospital inventory — drugs & supplies from stock invoice
// [product_name, category, current_stock, reorder_level, cost_price, selling_price]
const inventoryItems = [
  // Drugs
  ['Fertilion F Caps 3\'s', 'drug', 10, 5, 1400, 2000],
  ['Fertilion M Caps 30\'s', 'drug', 10, 5, 1600, 2300],
  ['Ceftriaxone Inj 1g (Safe Tax)', 'drug', 25, 10, 20, 35],
  ['Acinet 228mg/5ml Susp 100ml', 'drug', 10, 5, 100, 155],
  ['Acinet 45/5ml Dry Syrup 100ml', 'drug', 10, 5, 180, 265],
  ['Amoxxiline Syrup 125/5ml 100ml', 'drug', 10, 5, 290, 420],
  ['Amoxyllin 250mg Caps 100\'s', 'drug', 10, 5, 120, 180],
  ['Amoxyciline 500mg Caps 100\'s', 'drug', 10, 5, 190, 280],
  ['Azithromycin (Agycin) 500mg Tabs 3\'s', 'drug', 100, 20, 35, 55],
  ['Cefixime (Bactifix) 400mg Tabs 10\'s', 'drug', 20, 5, 100, 150],
  ['Clindamycin (Clindalized) 300mg Caps 100\'s', 'drug', 200, 20, 10, 15],
  ['Clotrimazole (Canazole) 200mg Pess 3\'s', 'drug', 30, 10, 40, 60],
  ['Diclofenac (Dolor) Gel 1% 20g', 'drug', 50, 10, 13, 20],
  ['Fluconazole (FC-Zole) 150mg 1\'s', 'drug', 100, 20, 6, 10],
  ['Folic Acid (Folisure) 5mg 100\'s', 'drug', 10, 5, 35, 55],
  ['Levofloxacin (Levosaf) 500mg Tabs', 'drug', 20, 5, 120, 180],
  ['Acvinet 156mg/5ml Dry Syrup 100ml', 'drug', 10, 5, 100, 150],
  ['Brustan Susp 100ml', 'drug', 20, 5, 170, 255],
  ['Cefuroxime (Cefuronet) 125mg/5ml 60ml', 'drug', 20, 5, 90, 135],
  ['Cefuroxime (Cefuronet) 250mg/5ml 60ml', 'drug', 10, 5, 120, 180],
  ['Clotrimazole (Clotrine) 200mg Pess 3\'s', 'drug', 20, 5, 44, 66],
  ['Drez Ointment 10g', 'drug', 20, 5, 100, 155],
  ['Dyrade M Susp 100ml', 'drug', 20, 5, 160, 245],
  ['Fevapyn Extra Susp 100ml', 'drug', 30, 10, 30, 48],
  ['Hemoforce Family Syrup 200ml', 'drug', 120, 20, 120, 180],
  ['Ibuprofen 400mg Tabs 100\'s', 'drug', 10, 5, 90, 140],
  ['Lignocaine 2% 30ml', 'drug', 20, 5, 22, 35],
  ['Artemether Inj 80mg 6\'s', 'drug', 20, 5, 35, 55],
  ['Azithromycin (Shalzin) 500mg Tabs 3\'s', 'drug', 100, 20, 32, 50],
  ['Chlorpromazine 25mg/ml Injection 1\'s', 'drug', 100, 20, 9, 14],
  ['Doxyllin 100mg Caps 100\'s', 'drug', 10, 5, 130, 205],
  ['Lunahist Expectorant 100ml', 'drug', 50, 10, 35, 55],
  ['Lunahist Expectorant 60ml', 'drug', 50, 10, 35, 55],
  ['Metochlopromide 10mg/2ml Injection', 'drug', 100, 20, 6, 9],
  ['Prednisolone 5mg Tabs 100\'s (Blue)', 'drug', 20, 5, 48, 75],
  ['Calamine Lotion 100ml', 'drug', 20, 5, 19, 30],
  ['Cetrizine (Alzinex) 60ml', 'drug', 50, 10, 12, 20],
  ['Chlorpheniramine (Zeditrion) Syrup 60ml', 'drug', 50, 10, 12, 20],
  ['Dexamethasone Inj 8mg/2ml', 'drug', 100, 20, 8, 13],
  ['Dyrade M DS Tabs 15\'s', 'drug', 20, 5, 175, 270],
  ['Ferrolic LF Tablets 100\'s', 'drug', 20, 5, 85, 130],
  ['Gacet Supp 125mg 10\'s', 'drug', 10, 5, 145, 220],
  ['Griseofulvin 250mg Tabs 100\'s', 'drug', 10, 5, 330, 505],
  ['Amitriptylline 25mg Tabs 100\'s', 'drug', 10, 5, 160, 250],
  ['Hyoscinf Injection 1\'s', 'drug', 100, 20, 12, 19],
  ['Ketoconazole (Hitoral) Shampoo 100ml', 'drug', 10, 5, 210, 320],
  ['Dexirose 5% 500ml', 'drug', 50, 10, 42, 65],
  ['H-Pylori Kit (Hellicure) 7\'s', 'drug', 10, 5, 420, 650],
  ['Levofloxacin (Livota) 750mg 10\'s', 'drug', 10, 5, 130, 199],
  ['MA-Kare (Mife+Miso) Tabs 5\'s', 'drug', 10, 5, 120, 185],
  ['MZ-Cal Plus Susp 200ml', 'drug', 10, 5, 245, 375],
  ['Tramadol 50mg/ml Inj 1\'s', 'drug', 100, 20, 12, 19],
  ['Podosal Paint', 'drug', 10, 5, 600, 871],
  // Supplies
  ['Crepe Bandage 3', 'supply', 12, 5, 18, 29],
  ['Branular 24G (Yellow) 1\'s', 'supply', 100, 20, 8, 13],
  ['Cotton Wool 400g (Velvex)', 'supply', 10, 5, 195, 299],
  ['Gauze Roll 750g', 'supply', 10, 5, 420, 650],
  ['Latex Gloves Medium 100\'s', 'supply', 10, 5, 225, 350],
  ['Normal Saline 500ml', 'supply', 50, 10, 64, 99],
  ['Diclofenac (Rufenacv) Gel 20g', 'supply', 50, 10, 15, 23],
];

// [name, price_min, price_max]
const labTests = [
  ['FHG (Full Hemogram)', 400, 1000],
  ['Stool Analysis', 150, 150],
  ['SATE', 0, 0],
  ['H. Pylori Antibody', 450, 450],
  ['H. Pylori Antigen', 600, 600],
  ['SAT Antibody', 450, 450],
  ['SAT Antigen', 600, 600],
  ['MRDT', 200, 200],
  ['B/S for Malaria Parasites', 200, 200],
  ['Haemoglobin', 200, 200],
  ['PDT Serum', 400, 600],
  ['Urine', 100, 100],
  ['Blood Group', 200, 200],
  ['Urinalysis – Dipstick', 150, 150],
  ['Urinalysis – Microscopy', 200, 200],
  ['Seminalysis', 6500, 6500],
  ['DNA Test', 80000, 80000],
  ['Rheumatoid Factor', 400, 800],
];

// [name, category, price_min, price_max]
const serviceProcedures = [
  ['Dressing', 'procedure', 300, 1000],
  ['Delivery', 'procedure', 10000, 10000],
  ['Circumcision – Adult', 'procedure', 5000, 5000],
  ['Circumcision – Child', 'procedure', 2000, 2000],
  ['Stitching', 'procedure', 600, 3000],
  ['Incision & Drainage', 'procedure', 300, 2000],
  ['Nebulization – Adult', 'procedure', 700, 2000],
  ['Nebulization – Child', 'procedure', 500, 500],
  ['Ear Syringing', 'procedure', 700, 2000],
  ['Foreign Body Removal', 'procedure', 700, 700],
  ['Observation', 'procedure', 800, 1000],
  ['Manual Vacuum Aspiration (MVA)', 'procedure', 5000, 15000],
  ['IM Injection', 'injection', 100, 100],
  ['IV Injection', 'injection', 200, 200],
  ['S/C Injection', 'injection', 100, 100],
  ['Catheterization', 'procedure', 500, 500],
];

// Default staff accounts — all pre-approved so the system works immediately after a schema reset.
// Change these passwords after first login.
const STAFF_ACCOUNTS = [
  { full_name: 'System Admin',      email: 'jacobokinja9@gmail.com', password: 'Kut@2022',    role: 'admin' },
  { full_name: 'Receptionist',      email: 'reception@multicare.co.ke', password: 'Staff@2024', role: 'receptionist' },
  { full_name: 'Triage Nurse',      email: 'triage@multicare.co.ke',    password: 'Staff@2024', role: 'triage' },
  { full_name: 'Doctor',            email: 'doctor@multicare.co.ke',    password: 'Staff@2024', role: 'doctor' },
  { full_name: 'Lab Technician',    email: 'lab@multicare.co.ke',       password: 'Staff@2024', role: 'lab_technician' },
  { full_name: 'Pharmacist',        email: 'pharmacy@multicare.co.ke',  password: 'Staff@2024', role: 'pharmacist' },
];

const ADMIN_EMAIL = 'jacobokinja9@gmail.com';
const ADMIN_PASSWORD = 'Kut@2022';

async function main() {
  // Seed all staff accounts
  for (const s of STAFF_ACCOUNTS) {
    const h = await bcrypt.hash(s.password, 10);
    await pool.execute(
      `INSERT INTO users (full_name, email, password_hash, role, is_approved, is_active)
       VALUES (?, ?, ?, ?, TRUE, TRUE)
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         password_hash = VALUES(password_hash),
         role = VALUES(role),
         is_approved = TRUE,
         is_active = TRUE`,
      [s.full_name, s.email, h, s.role]
    );
    console.log(`Seeded ${s.role}: ${s.email}`);
  }

  await pool.execute(`UPDATE users SET is_active = FALSE WHERE email = 'admin@hospital.com'`);

  for (const [name, cat, stock, reorder, cost, sell] of inventoryItems) {
    const [ex] = await pool.execute(`SELECT id FROM inventory WHERE product_name = ?`, [name]);
    if (ex.length) continue;
    await pool.execute(
      `INSERT INTO inventory (product_name, category, current_stock, reorder_level, cost_price, selling_price, unit, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, 'units', DATE_ADD(CURDATE(), INTERVAL 365 DAY))`,
      [name, cat, stock, reorder, cost, sell]
    );
    console.log('Seeded inventory:', name);
  }

  // Lab tests
  for (const [name, price_min, price_max] of labTests) {
    const [ex] = await pool.execute(`SELECT id FROM lab_tests WHERE name = ?`, [name]);
    if (ex.length) continue;
    await pool.execute(
      `INSERT INTO lab_tests (name, price_min, price_max) VALUES (?, ?, ?)`,
      [name, price_min, price_max]
    );
    console.log('Seeded lab test:', name);
  }

  // Service procedures
  for (const [name, category, price_min, price_max] of serviceProcedures) {
    const [ex] = await pool.execute(`SELECT id FROM service_procedures WHERE name = ?`, [name]);
    if (ex.length) continue;
    await pool.execute(
      `INSERT INTO service_procedures (name, category, price_min, price_max) VALUES (?, ?, ?, ?)`,
      [name, category, price_min, price_max]
    );
    console.log('Seeded procedure:', name);
  }

  console.log('Seed completed.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
