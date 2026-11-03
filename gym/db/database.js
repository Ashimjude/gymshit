const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const EventEmitter = require('events');

const dbEvents = new EventEmitter();

function capitalizeName(name) {
  if (!name) return '';
  return name.trim().split(/\s+/).map(word => {
    if (!word) return '';
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

// In a packaged Electron app, we cannot write to the .asar archive. 
// We use an environment variable to set a writable directory (e.g., AppData).
const dbDir = process.env.GYMPRO_DB_DIR || __dirname;
const dbPath = path.join(dbDir, 'gym.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for better performance
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ─── Create Tables ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT DEFAULT '',
    address TEXT DEFAULT '',
    join_date DATE NOT NULL,
    duration_months INTEGER NOT NULL,
    expiry_date DATE,
    plan_type TEXT NOT NULL DEFAULT 'Monthly',
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    check_in_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    date DATE NOT NULL,
    shift TEXT NOT NULL CHECK(shift IN ('morning', 'day')),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS logistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    image_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS logistics_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    type TEXT CHECK(type IN ('restock', 'sale')) NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL,
    notes TEXT DEFAULT '',
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES logistics(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_name TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    duration_value INTEGER NOT NULL,
    duration_type TEXT NOT NULL CHECK(duration_type IN ('DAY', 'WEEK', 'MONTH', 'YEAR')),
    regular_price REAL NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    plan_id INTEGER,
    plan_name_snapshot TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    original_price REAL NOT NULL,
    discount_type TEXT NOT NULL DEFAULT 'NONE' CHECK(discount_type IN ('NONE', 'FIXED', 'PERCENT')),
    discount_amount REAL NOT NULL DEFAULT 0,
    final_payable_amount REAL NOT NULL,
    payment_due_date DATE,
    membership_status TEXT NOT NULL CHECK(membership_status IN ('UPCOMING', 'ACTIVE', 'EXPIRED', 'FROZEN', 'CANCELLED', 'COMPLETED')),
    payment_status TEXT NOT NULL CHECK(payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE')),
    renewed_from_membership_id INTEGER,
    notes TEXT DEFAULT '',
    created_by TEXT DEFAULT 'Admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    membership_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash', 'QR', 'Bank Transfer', 'Card', 'Other')),
    payment_date DATETIME NOT NULL,
    transaction_reference TEXT DEFAULT '',
    receipt_number TEXT UNIQUE NOT NULL,
    notes TEXT DEFAULT '',
    payment_status TEXT NOT NULL,
    recorded_by TEXT DEFAULT 'Admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payment_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER,
    membership_id INTEGER NOT NULL,
    adjustment_type TEXT NOT NULL CHECK(adjustment_type IN ('REVERSAL', 'REFUND', 'DISCOUNT', 'WAIVER', 'CORRECTION', 'FINE')),
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    created_by TEXT DEFAULT 'Admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL,
    FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS membership_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    membership_id INTEGER NOT NULL,
    previous_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    reason TEXT DEFAULT '',
    changed_by TEXT DEFAULT 'Admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    old_values TEXT,
    new_values TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    duration_months INTEGER NOT NULL,
    price REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS member_biometrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    employee_no TEXT NOT NULL,
    biometric_type TEXT NOT NULL,
    sub_id INTEGER DEFAULT 1,
    finger_type TEXT DEFAULT 'normalFP',
    card_reader_no INTEGER DEFAULT 1,
    biometric_data TEXT NOT NULL,
    extra_json TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_biometrics_member ON member_biometrics(member_id);
  CREATE INDEX IF NOT EXISTS idx_biometrics_emp ON member_biometrics(employee_no);
`);

// ─── Schema Alterations & Migrations ─────────────────────────
try { db.exec('ALTER TABLE members ADD COLUMN member_code TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE members ADD COLUMN photo_url TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE members ADD COLUMN date_of_birth DATE;'); } catch(e){}
try { db.exec('ALTER TABLE members ADD COLUMN gender TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE members ADD COLUMN first_joining_date DATE;'); } catch(e){}
try { db.exec('ALTER TABLE members ADD COLUMN emergency_contact_name TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE members ADD COLUMN emergency_contact_phone TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE members ADD COLUMN is_active INTEGER DEFAULT 1;'); } catch(e){}

// Membership freeze columns
try { db.exec('ALTER TABLE memberships ADD COLUMN freeze_start_date DATE;'); } catch(e){}
try { db.exec('ALTER TABLE memberships ADD COLUMN freeze_end_date DATE;'); } catch(e){}
try { db.exec('ALTER TABLE memberships ADD COLUMN freeze_reason TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE memberships ADD COLUMN original_end_date DATE;'); } catch(e){}
try { db.exec('ALTER TABLE memberships ADD COLUMN total_frozen_days INTEGER DEFAULT 0;'); } catch(e){}

try {
  db.exec('ALTER TABLE members ADD COLUMN expiry_date DATE;');
  const members = db.prepare('SELECT id, join_date, duration_months FROM members WHERE expiry_date IS NULL').all();
  for (const m of members) {
    const date = new Date(m.join_date);
    date.setMonth(date.getMonth() + m.duration_months);
    const expiry = date.toISOString().split('T')[0];
    db.prepare('UPDATE members SET expiry_date = ? WHERE id = ?').run(expiry, m.id);
  }
} catch (e) {}

try {
  db.exec('ALTER TABLE members ADD COLUMN avatar_path TEXT;');
} catch (e) {}

// Populate missing member codes, first joining dates, and photos
try {
  const existingMembers = db.prepare('SELECT id, join_date, avatar_path, member_code FROM members').all();
  for (const m of existingMembers) {
    const code = m.member_code || `FH-${m.id.toString().padStart(6, '0')}`;
    const firstJoin = m.join_date;
    const photo = m.avatar_path || '';
    db.prepare('UPDATE members SET member_code = ?, first_joining_date = COALESCE(first_joining_date, ?), photo_url = COALESCE(photo_url, ?) WHERE id = ?')
      .run(code, firstJoin, photo, m.id);
  }
} catch (e) {
  console.error('Migration error for member codes:', e);
}

// Migrate packages to plans
try {
  const pkgs = db.prepare('SELECT * FROM packages').all();
  for (const p of pkgs) {
    db.prepare('INSERT OR IGNORE INTO plans (plan_name, duration_value, duration_type, regular_price) VALUES (?, ?, \'MONTH\', ?)')
      .run(p.name, p.duration_months, p.price);
  }
} catch (e) {}

// Ensure standard plans exist with active status
try {
  const defaultPlans = [
    { name: 'Monthly', duration: 1, type: 'MONTH', price: 2000 },
    { name: 'Quarterly', duration: 3, type: 'MONTH', price: 5500 },
    { name: 'Half-Yearly', duration: 6, type: 'MONTH', price: 10000 },
    { name: 'Yearly', duration: 12, type: 'MONTH', price: 18000 }
  ];
  for (const dp of defaultPlans) {
    const existing = db.prepare('SELECT id FROM plans WHERE plan_name = ?').get(dp.name);
    if (!existing) {
      db.prepare('INSERT INTO plans (plan_name, duration_value, duration_type, regular_price, is_active) VALUES (?, ?, ?, ?, 1)')
        .run(dp.name, dp.duration, dp.type, dp.price);
    } else {
      db.prepare('UPDATE plans SET is_active = 1 WHERE id = ?').run(existing.id);
    }
  }
  db.prepare(`
    UPDATE plans SET is_active = 1
    WHERE plan_name IN ('Quarterly Standard', 'Annual Premium', '6-Month Fitness', 'Student Special', 'Tihar Dhamaka')
  `).run();
} catch (e) {
  console.error('Plan seeding/activation migration error:', e);
}

// Migrate default memberships for existing members
try {
  const membersWithoutMembership = db.prepare(`
    SELECT m.id, m.join_date, m.expiry_date, m.duration_months, m.plan_type, m.notes
    FROM members m
    LEFT JOIN memberships ms ON ms.member_id = m.id
    WHERE ms.id IS NULL
  `).all();
  
  for (const m of membersWithoutMembership) {
    let plan = db.prepare('SELECT id, regular_price FROM plans WHERE plan_name = ?').get(m.plan_type);
    let planId = plan ? plan.id : null;
    let price = plan ? plan.regular_price : 2000;
    
    if (!planId) {
      try {
        db.prepare('INSERT OR IGNORE INTO plans (plan_name, duration_value, duration_type, regular_price) VALUES (?, ?, \'MONTH\', ?)')
          .run(m.plan_type, m.duration_months, 2000);
        const newPlan = db.prepare('SELECT id, regular_price FROM plans WHERE plan_name = ?').get(m.plan_type);
        if (newPlan) {
          planId = newPlan.id;
          price = newPlan.regular_price;
        }
      } catch(e) {}
    }
    
    const status = (new Date(m.expiry_date) >= new Date()) ? 'ACTIVE' : 'EXPIRED';
    
    db.prepare(`
      INSERT INTO memberships (
        member_id, plan_id, plan_name_snapshot, start_date, end_date,
        original_price, discount_type, discount_amount, final_payable_amount,
        payment_due_date, membership_status, payment_status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, 'NONE', 0, ?, ?, ?, 'PAID', ?)
    `).run(m.id, planId, m.plan_type, m.join_date, m.expiry_date, price, price, m.expiry_date, status, m.notes || 'Migrated membership');
  }
} catch (e) {
  console.error('Migration error for member default memberships:', e);
}

// Backfill payment records for migrated memberships that were marked 'PAID' but lack payment entries
try {
  const unbackedMemberships = db.prepare(`
    SELECT ms.id, ms.member_id, ms.final_payable_amount, ms.start_date, ms.created_at
    FROM memberships ms
    WHERE ms.payment_status = 'PAID'
      AND (SELECT COUNT(*) FROM payments WHERE membership_id = ms.id) = 0
  `).all();

  for (const ms of unbackedMemberships) {
    if (ms.final_payable_amount > 0) {
      const receipt = `MIG-PAID-${ms.id}`;
      db.prepare(`
        INSERT INTO payments (
          member_id, membership_id, amount, payment_method, payment_date,
          transaction_reference, receipt_number, notes, payment_status, recorded_by
        ) VALUES (?, ?, ?, 'Cash', COALESCE(?, CURRENT_TIMESTAMP), 'MIGRATION_SETTLED', ?, 'Legacy membership settlement', 'COMPLETED', 'System Migration')
      `).run(ms.member_id, ms.id, ms.final_payable_amount, ms.created_at || ms.start_date, receipt);
    }
  }
} catch (e) {
  console.error('Payment reconciliation migration error:', e);
}

// Capitalize existing member names in the database on load
try {
  const allMembers = db.prepare('SELECT id, full_name FROM members').all();
  const updateStmt = db.prepare('UPDATE members SET full_name = ? WHERE id = ?');
  allMembers.forEach(m => {
    const capName = capitalizeName(m.full_name);
    if (capName !== m.full_name) {
      updateStmt.run(capName, m.id);
      console.log(`Updated legacy name: "${m.full_name}" -> "${capName}"`);
    }
  });
} catch (err) {
  console.error('Failed to run capitalized names migration:', err);
}

// ─── Seed Default Admin ─────────────────────────────────────
function seedAdmin(username, password) {
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`✅ Default admin "${username}" created.`);
  }
}

// ─── Admin Queries ──────────────────────────────────────────
function getAdminByUsername(username) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
}

function updateAdminPassword(id, newPasswordHash) {
  return db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newPasswordHash, id);
}

// ─── Member Queries ─────────────────────────────────────────
function getAllMembers(search = '', statusFilter = '') {
  let query = `
    SELECT m.*,
           (SELECT COALESCE(SUM(ms.final_payable_amount), 0) FROM memberships ms WHERE ms.member_id = m.id) as total_payable,
           (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.member_id = m.id AND p.payment_status = 'COMPLETED') as total_paid,
           (SELECT payment_status FROM memberships WHERE member_id = m.id ORDER BY start_date DESC, created_at DESC LIMIT 1) as latest_payment_status,
           (SELECT membership_status FROM memberships WHERE member_id = m.id ORDER BY start_date DESC, created_at DESC LIMIT 1) as latest_membership_status,
           (SELECT COUNT(DISTINCT a.date) FROM attendance a WHERE a.member_id = m.id AND a.date >= date('now', '-30 days')) as days_in_last_30
    FROM members m
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ' AND (m.full_name LIKE ? OR m.phone LIKE ? OR m.email LIKE ? OR m.member_code LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  if (statusFilter) {
    if (statusFilter === 'active') {
      query += " AND latest_membership_status = 'ACTIVE'";
    } else if (statusFilter === 'frozen') {
      query += " AND latest_membership_status = 'FROZEN'";
    } else if (statusFilter === 'expired') {
      query += " AND latest_membership_status = 'EXPIRED'";
    } else if (statusFilter === 'paid') {
      query += " AND (SELECT COALESCE(SUM(ms.final_payable_amount), 0) FROM memberships ms WHERE ms.member_id = m.id) - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.member_id = m.id AND p.payment_status = 'COMPLETED') <= 0";
    } else if (statusFilter === 'due') {
      query += " AND (SELECT COALESCE(SUM(ms.final_payable_amount), 0) FROM memberships ms WHERE ms.member_id = m.id) - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.member_id = m.id AND p.payment_status = 'COMPLETED') > 0";
    } else if (statusFilter === 'overdue') {
      query += ` AND (
        latest_payment_status = 'OVERDUE' 
        OR (
          ((SELECT COALESCE(SUM(ms.final_payable_amount), 0) FROM memberships ms WHERE ms.member_id = m.id) - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.member_id = m.id AND p.payment_status = 'COMPLETED') > 0)
          AND EXISTS (SELECT 1 FROM memberships WHERE member_id = m.id AND payment_status != 'PAID' AND payment_due_date < date('now'))
        )
      )`;
    }
  }

  query += ' ORDER BY m.created_at DESC';
  const rows = db.prepare(query).all(...params);

  return rows.map(r => ({
    ...r,
    outstanding_balance: Math.max(0, r.total_payable - r.total_paid),
    latest_payment_status: r.latest_payment_status || 'UNPAID',
    latest_membership_status: r.latest_membership_status || 'EXPIRED'
  }));
}

function getMemberById(id) {
  const r = db.prepare(`
    SELECT m.*,
           (SELECT COALESCE(SUM(ms.final_payable_amount), 0) FROM memberships ms WHERE ms.member_id = m.id) as total_payable,
           (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.member_id = m.id AND p.payment_status = 'COMPLETED') as total_paid
    FROM members m
    WHERE m.id = ?
  `).get(id);
  if (!r) return null;
  return {
    ...r,
    outstanding_balance: Math.max(0, r.total_payable - r.total_paid)
  };
}

function addMember(member) {
  const stmt = db.prepare(`
    INSERT INTO members (
      full_name, phone, email, address, join_date, duration_months, expiry_date, plan_type, status, notes, avatar_path,
      member_code, date_of_birth, gender, first_joining_date, emergency_contact_name, emergency_contact_phone, is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const mCode = member.member_code || `FH-${Date.now()}`;
  
  const result = stmt.run(
    capitalizeName(member.full_name),
    member.phone,
    member.email || '',
    member.address || '',
    member.join_date,
    member.duration_months,
    member.expiry_date,
    member.plan_type,
    member.notes || '',
    member.avatar_path || '',
    mCode,
    member.date_of_birth || null,
    member.gender || 'male',
    member.first_joining_date || member.join_date,
    member.emergency_contact_name || '',
    member.emergency_contact_phone || '',
    member.is_active !== undefined ? member.is_active : 1
  );
  
  const insertedId = result.lastInsertRowid;
  // Auto-generate proper clean sequential member code if temp one was used
  if (!member.member_code) {
    const formattedCode = `FH-${insertedId.toString().padStart(6, '0')}`;
    db.prepare('UPDATE members SET member_code = ? WHERE id = ?').run(formattedCode, insertedId);
  }
  
  return getMemberById(insertedId);
}

function updateMember(id, member) {
  const protectedNames = ['saurav kunwar', 'ashim pandey'];
  let status = member.status || 'active';
  if (protectedNames.includes(member.full_name.toLowerCase())) {
    status = 'active';
  }

  const stmt = db.prepare(`
    UPDATE members SET
      full_name = ?, phone = ?, email = ?, address = ?,
      join_date = ?, duration_months = ?, expiry_date = ?, plan_type = ?,
      status = ?, notes = ?, avatar_path = ?, 
      member_code = ?, date_of_birth = ?, gender = ?, first_joining_date = ?, 
      emergency_contact_name = ?, emergency_contact_phone = ?, is_active = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(
    capitalizeName(member.full_name),
    member.phone,
    member.email || '',
    member.address || '',
    member.join_date,
    member.duration_months,
    member.expiry_date,
    member.plan_type,
    status,
    member.notes || '',
    member.avatar_path !== undefined ? member.avatar_path : null,
    member.member_code,
    member.date_of_birth || null,
    member.gender || 'male',
    member.first_joining_date,
    member.emergency_contact_name || '',
    member.emergency_contact_phone || '',
    member.is_active !== undefined ? member.is_active : 1,
    id
  );
  return getMemberById(id);
}

function deleteMember(id) {
  const existing = getMemberById(id);
  if (existing) {
    const protectedNames = ['saurav kunwar', 'ashim pandey'];
    if (protectedNames.includes(existing.full_name.toLowerCase())) {
      throw new Error('Protected members cannot be deleted.');
    }
  }
  return db.prepare('DELETE FROM members WHERE id = ?').run(id);
}

// ─── Expiry Calculation ─────────────────────────────────────
function getExpiryDate(joinDate, durationMonths) {
  const date = new Date(joinDate);
  date.setMonth(date.getMonth() + durationMonths);
  return date;
}

function getMembersExpiringOn(targetDate) {
  const allActive = db.prepare("SELECT * FROM members WHERE status = 'active'").all();
  return allActive.filter(m => {
    const expiry = new Date(m.expiry_date);
    const target = new Date(targetDate);
    return (
      expiry.getFullYear() === target.getFullYear() &&
      expiry.getMonth() === target.getMonth() &&
      expiry.getDate() === target.getDate()
    );
  });
}

function getMembersExpiringSoon(days) {
  const allActive = db.prepare("SELECT * FROM members WHERE status = 'active'").all();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return allActive.filter(m => {
    const expiry = new Date(m.expiry_date);
    expiry.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= days;
  });
}

function updateExpiredMembers() {
  const allActive = db.prepare("SELECT * FROM members WHERE status = 'active'").all();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let count = 0;

  const protectedNames = ['saurav kunwar', 'ashim pandey'];

  for (const m of allActive) {
    if (protectedNames.includes(m.full_name.toLowerCase())) {
      continue;
    }
    const expiry = new Date(m.expiry_date);
    expiry.setHours(0, 0, 0, 0);
    if (expiry < now) {
      db.prepare("UPDATE members SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(m.id);
      count++;
    }
  }
  return count;
}

// ─── Dashboard Stats ────────────────────────────────────────
function getDashboardStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM members').get().count;
  const active = db.prepare("SELECT COUNT(*) as count FROM members WHERE status = 'active'").get().count;
  const expired = db.prepare("SELECT COUNT(*) as count FROM members WHERE status = 'expired'").get().count;
  const expiringSoon = getMembersExpiringSoon(parseInt(process.env.NOTIFY_DAYS_BEFORE) || 3).length;

  const duesStats = getOutstandingDues().stats;

  return {
    total,
    active,
    expired,
    expiringSoon,
    totalOutstandingAmount: duesStats.totalOutstandingAmount,
    overduePaymentsCount: duesStats.overduePaymentsCount,
    amountCollectedToday: duesStats.amountCollectedToday,
    amountCollectedThisMonth: duesStats.amountCollectedThisMonth
  };
}

// ─── Notification Queries ───────────────────────────────────
function logNotification(memberId, type, message, status = 'sent') {
  return db.prepare(
    'INSERT INTO notifications (member_id, type, message, status) VALUES (?, ?, ?, ?)'
  ).run(memberId, type, message, status);
}

function getNotifications(limit = 50) {
  const notifs = db.prepare(`
    SELECT n.*, m.full_name, m.phone
    FROM notifications n
    JOIN members m ON n.member_id = m.id
    ORDER BY n.sent_at DESC
    LIMIT ?
  `).all(limit);
  
  // Append Z to sent_at so the browser parses the SQLite UTC timestamp correctly
  return notifs.map(n => {
    if (n.sent_at && !n.sent_at.endsWith('Z')) {
      n.sent_at = n.sent_at.replace(' ', 'T') + 'Z';
    }
    return n;
  });
}

function hasRecentNotification(memberId, type = null, hoursAgo = 20) {
  let query = `
    SELECT COUNT(*) as count FROM notifications
    WHERE member_id = ? AND sent_at > datetime('now', '-' || ? || ' hours')
  `;
  const params = [memberId, hoursAgo];
  if (type) {
    query += ` AND type = ?`;
    params.push(type);
  }
  const result = db.prepare(query).get(...params);
  return result.count > 0;
}

function deleteNotification(id) {
  return db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
}

// ─── Settings Queries ───────────────────────────────────────
function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// ─── Attendance Queries ─────────────────────────────────────

// Helper: get local date string (YYYY-MM-DD) avoiding UTC offset issues
function getLocalDateStr(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalTimeStr(date) {
  const d = date || new Date();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  return `${getLocalDateStr(d)} ${hours}:${mins}:${secs}`;
}

function recordAttendance(memberId, timestamp = null) {
  let eventTime = new Date();
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!isNaN(parsed.getTime())) {
      eventTime = parsed;
    }
  }

  const date = getLocalDateStr(eventTime);
  const hour = eventTime.getHours();
  const shift = hour < 12 ? 'morning' : 'day';

  // Check for duplicate check-in (same member, same date, same shift)
  const existing = db.prepare(
    'SELECT id FROM attendance WHERE member_id = ? AND date = ? AND shift = ?'
  ).get(memberId, date, shift);

  if (existing) {
    const resultObj = { duplicate: true, shift, date };
    // Do not emit event for duplicates to prevent spam during background polling
    return resultObj;
  }

  const checkInTime = getLocalTimeStr(eventTime);
  const result = db.prepare(
    'INSERT INTO attendance (member_id, check_in_time, date, shift) VALUES (?, ?, ?, ?)'
  ).run(memberId, checkInTime, date, shift);

  const resultObj = { id: result.lastInsertRowid, shift, date, check_in_time: checkInTime, duplicate: false };
  dbEvents.emit('attendance', { ...resultObj, memberId });
  return resultObj;
}

function deleteAttendance(id) {
  const result = db.prepare('DELETE FROM attendance WHERE id = ?').run(id);
  return result.changes > 0;
}

function getAttendanceByDate(date, shift = '') {
  let query = `
    SELECT a.*, m.full_name, m.phone, m.status as member_status, m.avatar_path, m.photo_url, m.member_code
    FROM attendance a
    JOIN members m ON a.member_id = m.id
    WHERE a.date = ?
  `;
  const params = [date];

  if (shift && shift !== 'all') {
    query += ' AND a.shift = ?';
    params.push(shift);
  }

  query += ' ORDER BY a.check_in_time DESC';
  return db.prepare(query).all(...params);
}

function getAttendanceSummary(days = 30) {
  const results = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dateStr = getLocalDateStr(d);

    const morning = db.prepare(
      "SELECT COUNT(*) as count FROM attendance WHERE date = ? AND shift = 'morning'"
    ).get(dateStr).count;

    const day = db.prepare(
      "SELECT COUNT(*) as count FROM attendance WHERE date = ? AND shift = 'day'"
    ).get(dateStr).count;

    results.push({
      date: dateStr,
      morning,
      day,
      total: morning + day
    });
  }

  return results;
}

function getTodayAttendanceCount() {
  const today = getLocalDateStr();
  return db.prepare('SELECT COUNT(*) as count FROM attendance WHERE date = ?').get(today).count;
}

function getMemberAttendanceStats(memberId, days = 30) {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const cutoffStr = getLocalDateStr(cutoff);
  const todayStr = getLocalDateStr(now);

  // Distinct days present in the window
  const distinctDaysRow = db.prepare(`
    SELECT COUNT(DISTINCT date) as count
    FROM attendance
    WHERE member_id = ? AND date >= ? AND date <= ?
  `).get(memberId, cutoffStr, todayStr);
  const daysPresent = distinctDaysRow ? distinctDaysRow.count : 0;

  // Shift counts in the window
  const morningRow = db.prepare(`
    SELECT COUNT(*) as count FROM attendance
    WHERE member_id = ? AND date >= ? AND date <= ? AND shift = 'morning'
  `).get(memberId, cutoffStr, todayStr);
  const morningShifts = morningRow ? morningRow.count : 0;

  const dayRow = db.prepare(`
    SELECT COUNT(*) as count FROM attendance
    WHERE member_id = ? AND date >= ? AND date <= ? AND shift = 'day'
  `).get(memberId, cutoffStr, todayStr);
  const dayShifts = dayRow ? dayRow.count : 0;

  // Total check-ins all time
  const totalVisitsRow = db.prepare(`
    SELECT COUNT(*) as count FROM attendance WHERE member_id = ?
  `).get(memberId);
  const totalVisits = totalVisitsRow ? totalVisitsRow.count : 0;

  // Most recent check-in
  const lastVisit = db.prepare(`
    SELECT check_in_time, date, shift FROM attendance
    WHERE member_id = ?
    ORDER BY check_in_time DESC, id DESC
    LIMIT 1
  `).get(memberId);

  // Daily map of each day in the last N days (from oldest to newest: cutoff -> today)
  const dailyStatus = [];
  const attendancesInWindow = db.prepare(`
    SELECT date, shift, check_in_time FROM attendance
    WHERE member_id = ? AND date >= ? AND date <= ?
    ORDER BY check_in_time ASC
  `).all(memberId, cutoffStr, todayStr);

  const attendanceByDate = {};
  for (const a of attendancesInWindow) {
    if (!attendanceByDate[a.date]) {
      attendanceByDate[a.date] = [];
    }
    attendanceByDate[a.date].push(a);
  }

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dateStr = getLocalDateStr(d);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = d.getDate();
    const monthName = d.toLocaleDateString('en-US', { month: 'short' });
    const isToday = (i === 0);
    const dayRecords = attendanceByDate[dateStr] || [];
    const attended = dayRecords.length > 0;
    const shift = attended ? dayRecords[0].shift : null;
    const checkInTime = attended ? dayRecords[0].check_in_time : null;

    dailyStatus.push({
      date: dateStr,
      dayName,
      dayNum,
      monthName,
      isToday,
      attended,
      shift,
      checkInTime,
      totalCheckIns: dayRecords.length
    });
  }

  const attendanceRate = Math.min(100, Math.round((daysPresent / days) * 100));

  return {
    daysPresent,
    totalDays: days,
    attendanceRate,
    morningShifts,
    dayShifts,
    totalVisits,
    lastVisit: lastVisit || null,
    cutoffDate: cutoffStr,
    todayDate: todayStr,
    dailyStatus
  };
}

function getMemberAttendanceHistory(memberId, limit = 100) {
  return db.prepare(`
    SELECT a.*, m.full_name, m.phone
    FROM attendance a
    JOIN members m ON a.member_id = m.id
    WHERE a.member_id = ?
    ORDER BY a.check_in_time DESC, a.id DESC
    LIMIT ?
  `).all(memberId, limit);
}

// ─── Logistics Queries ──────────────────────────────────────
function getAllLogistics(search = '') {
  let query = 'SELECT * FROM logistics WHERE 1=1';
  const params = [];
  if (search) {
    query += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }
  query += ' ORDER BY created_at DESC';
  return db.prepare(query).all(...params);
}

function getLogisticsById(id) {
  return db.prepare('SELECT * FROM logistics WHERE id = ?').get(id);
}

function addLogisticsItem(item) {
  const stmt = db.prepare(`
    INSERT INTO logistics (name, price, quantity, image_path)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    item.name,
    item.price,
    item.quantity || 0,
    item.image_path || ''
  );
  return getLogisticsById(result.lastInsertRowid);
}

function updateLogisticsItem(id, item) {
  const stmt = db.prepare(`
    UPDATE logistics SET
      name = ?, price = ?, quantity = ?, image_path = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(
    item.name,
    item.price,
    item.quantity,
    item.image_path,
    id
  );
  return getLogisticsById(id);
}

function deleteLogisticsItem(id) {
  return db.prepare('DELETE FROM logistics WHERE id = ?').run(id);
}

function recordLogisticsTransaction(productId, type, quantity, price, notes = '') {
  const stmt = db.prepare(`
    INSERT INTO logistics_transactions (product_id, type, quantity, price, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(productId, type, quantity, price, notes);
}

function getLogisticsTransactions(limit = 50) {
  return db.prepare(`
    SELECT t.*, l.name as product_name
    FROM logistics_transactions t
    JOIN logistics l ON t.product_id = l.id
    ORDER BY t.date DESC
    LIMIT ?
  `).all(limit);
}

function getAllPlans() {
  return db.prepare('SELECT * FROM plans WHERE is_active = 1 ORDER BY plan_name ASC').all();
}

function addPlan(plan) {
  const stmt = db.prepare(`
    INSERT INTO plans (plan_name, description, duration_value, duration_type, regular_price)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(plan.plan_name, plan.description || '', plan.duration_value, plan.duration_type || 'MONTH', plan.regular_price);
  return { id: result.lastInsertRowid, ...plan };
}

function deletePlan(id) {
  db.prepare('UPDATE plans SET is_active = 0 WHERE id = ?').run(id);
}

function logAudit(userId, action, entityType, entityId, oldValues, newValues, description) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId || null, action, entityType, entityId || null, oldValues || null, newValues || null, description || null);
  } catch (e) {
    console.error('Failed to write audit log:', e);
  }
}

function createMembership(memberId, planId, details, paymentDetails, user = 'Admin') {
  const todayStr = new Date().toISOString().split('T')[0];
  let status = 'ACTIVE';
  if (details.start_date > todayStr) {
    status = 'UPCOMING';
  }
  
  const finalPayable = parseFloat(details.final_payable_amount);
  const amountPaid = parseFloat(paymentDetails.amount_paid || 0);
  
  let payStatus = 'UNPAID';
  if (amountPaid > 0) {
    payStatus = amountPaid >= finalPayable ? 'PAID' : 'PARTIALLY_PAID';
  }
  
  if (payStatus !== 'PAID' && details.payment_due_date && details.payment_due_date < todayStr) {
    payStatus = 'OVERDUE';
  }

  const planName = details.plan_name_snapshot || 'Custom Plan';

  const mStmt = db.prepare(`
    INSERT INTO memberships (
      member_id, plan_id, plan_name_snapshot, start_date, end_date,
      original_price, discount_type, discount_amount, final_payable_amount,
      payment_due_date, membership_status, payment_status, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const mResult = mStmt.run(
    memberId, planId || null, planName, details.start_date, details.end_date,
    parseFloat(details.original_price), details.discount_type || 'NONE',
    parseFloat(details.discount_amount || 0), finalPayable,
    details.payment_due_date || null, status, payStatus, details.notes || '', user
  );
  
  const membershipId = mResult.lastInsertRowid;

  if (amountPaid > 0) {
    const receiptNum = `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const pStmt = db.prepare(`
      INSERT INTO payments (
        member_id, membership_id, amount, payment_method, payment_date,
        transaction_reference, receipt_number, notes, payment_status, recorded_by
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
    `);
    pStmt.run(
      memberId, membershipId, amountPaid, paymentDetails.payment_method || 'Cash',
      paymentDetails.transaction_reference || '', receiptNum,
      paymentDetails.notes || 'Initial payment', 'COMPLETED', user
    );
  }

  logAudit(null, 'CREATE_MEMBERSHIP', 'memberships', membershipId, null, JSON.stringify(details), `Membership created for plan ${planName}`);
  
  // Sync the status of members
  updateMembershipStatuses();

  return membershipId;
}

function renewMembership(memberId, planId, details, paymentDetails, user = 'Admin') {
  db.prepare(`
    UPDATE memberships 
    SET membership_status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP 
    WHERE member_id = ? AND membership_status = 'ACTIVE'
  `).run(memberId);

  return createMembership(memberId, planId, details, paymentDetails, user);
}

function recordPayment(memberId, membershipId, amount, details, user = 'Admin') {
  const finalAmount = Math.round(parseFloat(amount) * 100) / 100;
  if (isNaN(finalAmount) || finalAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const ms = db.prepare('SELECT * FROM memberships WHERE id = ?').get(membershipId);
  if (!ms) throw new Error('Membership record not found.');

  const paidRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_paid
    FROM payments
    WHERE membership_id = ? AND payment_status = 'COMPLETED'
  `).get(membershipId);
  const currentPaid = Math.round((paidRow ? paidRow.total_paid : 0) * 100) / 100;
  
  const remaining = Math.max(0, Math.round((ms.final_payable_amount - currentPaid) * 100) / 100);
  if (finalAmount > remaining + 0.009) {
    throw new Error(`Amount exceeds outstanding balance of NPR ${remaining}`);
  }

  const receiptNum = `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const pStmt = db.prepare(`
    INSERT INTO payments (
      member_id, membership_id, amount, payment_method, payment_date,
      transaction_reference, receipt_number, notes, payment_status, recorded_by
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)
  `);
  pStmt.run(
    memberId, membershipId, finalAmount, details.payment_method || 'Cash',
    details.transaction_reference || '', receiptNum,
    details.notes || 'Subsequent payment', 'COMPLETED', user
  );

  updatePaymentStatuses();

  logAudit(null, 'RECORD_PAYMENT', 'payments', receiptNum, null, null, `Payment of NPR ${finalAmount} recorded for receipt ${receiptNum}`);

  return receiptNum;
}

function reversePayment(paymentId, reason, user = 'Admin') {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!p) throw new Error('Payment record not found.');
  if (p.payment_status === 'REVERSED') throw new Error('Payment is already reversed.');

  db.prepare("UPDATE payments SET payment_status = 'REVERSED', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(paymentId);

  db.prepare(`
    INSERT INTO payment_adjustments (payment_id, membership_id, adjustment_type, amount, reason, created_by)
    VALUES (?, ?, 'REVERSAL', ?, ?, ?)
  `).run(p.id, p.membership_id, p.amount, reason, user);

  updatePaymentStatuses();

  logAudit(null, 'REVERSE_PAYMENT', 'payments', p.id, JSON.stringify(p), null, `Payment of NPR ${p.amount} reversed. Reason: ${reason}`);

  return true;
}

function getMemberProfile(memberId) {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
  if (!member) return null;

  const currentMembership = db.prepare(`
    SELECT * FROM memberships
    WHERE member_id = ? AND membership_status = 'ACTIVE'
    LIMIT 1
  `).get(memberId) || db.prepare(`
    SELECT * FROM memberships
    WHERE member_id = ? AND membership_status = 'FROZEN'
    LIMIT 1
  `).get(memberId) || db.prepare(`
    SELECT * FROM memberships
    WHERE member_id = ?
    ORDER BY start_date DESC, created_at DESC
    LIMIT 1
  `).get(memberId);

  const paidRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE member_id = ? AND payment_status = 'COMPLETED'
  `).get(memberId);
  const totalAmountPaid = Math.round((paidRow ? paidRow.amount : 0) * 100) / 100;

  const payableRow = db.prepare(`
    SELECT COALESCE(SUM(final_payable_amount), 0) as amount
    FROM memberships
    WHERE member_id = ?
  `).get(memberId);
  const totalPayable = Math.round((payableRow ? payableRow.amount : 0) * 100) / 100;

  const totalOutstandingBalance = Math.max(0, Math.round((totalPayable - totalAmountPaid) * 100) / 100);

  // Retrieve any memberships with outstanding dues (earliest due first)
  const unpaidMemberships = db.prepare(`
    SELECT ms.*,
           (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE membership_id = ms.id AND payment_status = 'COMPLETED') as total_paid
    FROM memberships ms
    WHERE ms.member_id = ?
    ORDER BY ms.payment_due_date ASC, ms.start_date ASC
  `).all(memberId).map(m => {
    const paid = Math.round((m.total_paid || 0) * 100) / 100;
    const remaining = Math.max(0, Math.round((m.final_payable_amount - paid) * 100) / 100);
    return { ...m, total_paid: paid, remaining_balance: remaining };
  }).filter(m => m.remaining_balance > 0.001);

  const lastPaymentRow = db.prepare(`
    SELECT payment_date FROM payments
    WHERE member_id = ? AND payment_status = 'COMPLETED'
    ORDER BY payment_date DESC
    LIMIT 1
  `).get(memberId);

  const lastRenewalRow = db.prepare(`
    SELECT start_date FROM memberships
    WHERE member_id = ?
    ORDER BY start_date DESC
    LIMIT 1
  `).get(memberId);

  const renewalCountRow = db.prepare(`
    SELECT COUNT(*) as count FROM memberships WHERE member_id = ?
  `).get(memberId);
  const totalRenewals = renewalCountRow ? Math.max(0, renewalCountRow.count - 1) : 0;

  const visitCountRow = db.prepare(`
    SELECT COUNT(*) as count FROM attendance WHERE member_id = ?
  `).get(memberId);
  const totalGymVisits = visitCountRow ? visitCountRow.count : 0;

  const membershipsLogs = db.prepare(`
    SELECT 'membership' as type, plan_name_snapshot as title, start_date as detail, created_at as date, final_payable_amount as val, membership_status as status
    FROM memberships
    WHERE member_id = ?
  `).all(memberId).map(m => ({
    type: 'membership',
    message: `Membership renewed for ${m.title} (NPR ${m.val})`,
    date: m.date
  }));

  const paymentsLogs = db.prepare(`
    SELECT 'payment' as type, payment_method as title, receipt_number as detail, payment_date as date, amount as val, payment_status as status
    FROM payments
    WHERE member_id = ?
  `).all(memberId).map(p => ({
    type: 'payment',
    message: p.status === 'REVERSED'
      ? `Payment of NPR ${p.val} reversed (Receipt: ${p.detail})`
      : `Payment of NPR ${p.val} received via ${p.title} (Receipt: ${p.detail})`,
    date: p.date
  }));

  const statusLogs = db.prepare(`
    SELECT 'status' as type, previous_status as title, new_status as detail, reason as msg, sh.created_at as date
    FROM membership_status_history sh
    JOIN memberships ms ON sh.membership_id = ms.id
    WHERE ms.member_id = ?
  `).all(memberId).map(s => ({
    type: 'status',
    message: `Membership status changed from ${s.title} to ${s.detail}. Reason: ${s.msg}`,
    date: s.date
  }));

  const timeline = [...membershipsLogs, ...paymentsLogs, ...statusLogs]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 15);

  const attendance30Days = getMemberAttendanceStats(memberId, 30);

  return {
    member,
    currentMembership,
    unpaidMemberships,
    stats: {
      totalAmountPaid,
      totalOutstandingBalance,
      totalRenewals,
      totalGymVisits,
      daysInLast30: attendance30Days.daysPresent,
      attendanceRateLast30: attendance30Days.attendanceRate,
      lastRenewalDate: lastRenewalRow ? lastRenewalRow.start_date : null,
      lastPaymentDate: lastPaymentRow ? lastPaymentRow.payment_date : null
    },
    attendance30Days,
    timeline
  };
}

function getMembershipHistory(memberId) {
  return db.prepare(`
    SELECT ms.*, p.plan_name, p.regular_price as plan_regular_price,
           (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE membership_id = ms.id AND payment_status = 'COMPLETED') as total_paid
    FROM memberships ms
    LEFT JOIN plans p ON ms.plan_id = p.id
    WHERE ms.member_id = ?
    ORDER BY ms.start_date DESC, ms.created_at DESC
  `).all(memberId).map(ms => {
    const totalPaid = Math.round((ms.total_paid || 0) * 100) / 100;
    const remaining = Math.max(0, Math.round((ms.final_payable_amount - totalPaid) * 100) / 100);
    return {
      ...ms,
      total_paid: totalPaid,
      remaining_balance: remaining
    };
  });
}

function getPaymentHistory(memberId) {
  return db.prepare(`
    SELECT py.*, ms.plan_name_snapshot,
           (SELECT adjustment_type FROM payment_adjustments WHERE payment_id = py.id LIMIT 1) as adjustment_type,
           (SELECT reason FROM payment_adjustments WHERE payment_id = py.id LIMIT 1) as adjustment_reason
      FROM payments py
      JOIN memberships ms ON py.membership_id = ms.id
      WHERE py.member_id = ?
      ORDER BY py.payment_date DESC, py.created_at DESC
  `).all(memberId);
}

function updatePaymentStatuses() {
  const todayStr = getLocalDateStr(new Date());

  // 1. Mark as PAID if remaining balance is <= 0
  db.prepare(`
    UPDATE memberships
    SET payment_status = 'PAID', updated_at = CURRENT_TIMESTAMP
    WHERE payment_status != 'PAID'
      AND (final_payable_amount - (
        SELECT COALESCE(SUM(amount), 0)
        FROM payments
        WHERE membership_id = memberships.id AND payment_status = 'COMPLETED'
      )) <= 0.001
  `).run();

  // 2. Mark as OVERDUE if remaining balance > 0 and payment_due_date < today
  db.prepare(`
    UPDATE memberships
    SET payment_status = 'OVERDUE', updated_at = CURRENT_TIMESTAMP
    WHERE payment_status != 'OVERDUE'
      AND payment_due_date IS NOT NULL
      AND payment_due_date < ?
      AND (final_payable_amount - (
        SELECT COALESCE(SUM(amount), 0)
        FROM payments
        WHERE membership_id = memberships.id AND payment_status = 'COMPLETED'
      )) > 0.001
  `).run(todayStr);

  // 3. Mark as PARTIALLY_PAID if not overdue, paid > 0, but remaining > 0
  db.prepare(`
    UPDATE memberships
    SET payment_status = 'PARTIALLY_PAID', updated_at = CURRENT_TIMESTAMP
    WHERE payment_status != 'PARTIALLY_PAID'
      AND (payment_due_date IS NULL OR payment_due_date >= ?)
      AND (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE membership_id = memberships.id AND payment_status = 'COMPLETED') > 0.001
      AND (final_payable_amount - (
        SELECT COALESCE(SUM(amount), 0)
        FROM payments
        WHERE membership_id = memberships.id AND payment_status = 'COMPLETED'
      )) > 0.001
  `).run(todayStr);

  // 4. Mark as UNPAID if not overdue, paid == 0, and remaining > 0
  db.prepare(`
    UPDATE memberships
    SET payment_status = 'UNPAID', updated_at = CURRENT_TIMESTAMP
    WHERE payment_status != 'UNPAID'
      AND (payment_due_date IS NULL OR payment_due_date >= ?)
      AND (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE membership_id = memberships.id AND payment_status = 'COMPLETED') <= 0.001
      AND final_payable_amount > 0.001
  `).run(todayStr);
}

function getOutstandingDues() {
  updatePaymentStatuses();

  const memberships = db.prepare(`
    SELECT ms.*, m.full_name, m.phone, m.member_code,
           (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE membership_id = ms.id AND payment_status = 'COMPLETED') as total_paid
    FROM memberships ms
    JOIN members m ON ms.member_id = m.id
    ORDER BY ms.payment_due_date ASC, ms.start_date ASC
  `).all();
  
  const duesList = memberships.map(ms => {
    const totalPaid = Math.round((ms.total_paid || 0) * 100) / 100;
    const remainingBalance = Math.max(0, Math.round((ms.final_payable_amount - totalPaid) * 100) / 100);
    
    let daysOverdue = 0;
    if (ms.payment_due_date) {
      const due = new Date(ms.payment_due_date);
      const today = new Date();
      today.setHours(0,0,0,0);
      due.setHours(0,0,0,0);
      if (today > due && remainingBalance > 0.001) {
        const diffMs = today - due;
        daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }
    }
    
    return {
      ...ms,
      total_paid: totalPaid,
      remaining_balance: remainingBalance,
      days_overdue: daysOverdue
    };
  }).filter(item => item.remaining_balance > 0.001);

  const totalOutstandingAmount = duesList.reduce((sum, item) => sum + item.remaining_balance, 0);
  const overduePaymentsCount = duesList.filter(item => item.days_overdue > 0).length;
  const uniqueMembersWithDues = new Set(duesList.map(item => item.member_id)).size;

  const now = new Date();
  const todayStr = getLocalDateStr(now);
  const startOfMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const startOfYearStr = `${now.getFullYear()}-01-01`;

  const todayPaidRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE date(payment_date, 'localtime') = date(?) AND payment_status = 'COMPLETED'
  `).get(todayStr);

  const monthPaidRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE date(payment_date, 'localtime') >= date(?) AND payment_status = 'COMPLETED'
  `).get(startOfMonthStr);

  const yearPaidRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE date(payment_date, 'localtime') >= date(?) AND payment_status = 'COMPLETED'
  `).get(startOfYearStr);

  return {
    stats: {
      totalOutstandingAmount: Math.round(totalOutstandingAmount * 100) / 100,
      membersWithDuesCount: uniqueMembersWithDues,
      overduePaymentsCount,
      amountCollectedToday: todayPaidRow ? todayPaidRow.amount : 0,
      amountCollectedThisMonth: monthPaidRow ? monthPaidRow.amount : 0,
      amountCollectedThisYear: yearPaidRow ? yearPaidRow.amount : 0
    },
    dues: duesList
  };
}

function updateMembershipStatuses() {
  const todayStr = getLocalDateStr(new Date());
  
  // 1. Auto-unfreeze any FROZEN memberships whose freeze_end_date has arrived or passed!
  try {
    const frozenToUnfreeze = db.prepare(`
      SELECT id, freeze_end_date, original_end_date, freeze_start_date, member_id
      FROM memberships
      WHERE membership_status = 'FROZEN' AND freeze_end_date IS NOT NULL AND freeze_end_date <= ?
    `).all(todayStr);

    for (const fm of frozenToUnfreeze) {
      try {
        unfreezeMembership(fm.id, 'System Auto-Unfreeze');
      } catch (err) {
        console.error(`Error auto-unfreezing membership ${fm.id}:`, err);
      }
    }
  } catch (e) {
    console.error('Auto-unfreeze error:', e);
  }

  // 2. Activate upcoming memberships whose start_date has arrived
  db.prepare(`
    UPDATE memberships
    SET membership_status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
    WHERE membership_status = 'UPCOMING' AND start_date <= ? AND end_date >= ?
  `).run(todayStr, todayStr);
  
  // 3. Expire active/upcoming memberships whose end_date has passed
  db.prepare(`
    UPDATE memberships
    SET membership_status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
    WHERE (membership_status = 'ACTIVE' OR membership_status = 'UPCOMING') AND end_date < ?
  `).run(todayStr);

  // 4. Update member status in members table:
  const activeMemberships = db.prepare(`
    SELECT DISTINCT member_id FROM memberships WHERE membership_status = 'ACTIVE'
  `).all().map(r => r.member_id);

  const frozenMemberships = db.prepare(`
    SELECT DISTINCT member_id FROM memberships WHERE membership_status = 'FROZEN'
  `).all().map(r => r.member_id).filter(id => !activeMemberships.includes(id));

  db.prepare(`
    UPDATE members SET status = 'expired'
  `).run();

  if (activeMemberships.length > 0) {
    const placeholders = activeMemberships.map(() => '?').join(',');
    db.prepare(`
      UPDATE members SET status = 'active' WHERE id IN (${placeholders})
    `).run(...activeMemberships);
  }

  if (frozenMemberships.length > 0) {
    const placeholders = frozenMemberships.map(() => '?').join(',');
    db.prepare(`
      UPDATE members SET status = 'frozen' WHERE id IN (${placeholders})
    `).run(...frozenMemberships);
  }

  updatePaymentStatuses();
}

function freezeMembership(membershipId, days, reason, user = 'Admin') {
  const ms = db.prepare('SELECT * FROM memberships WHERE id = ?').get(membershipId);
  if (!ms) throw new Error('Membership not found.');
  if (ms.membership_status !== 'ACTIVE') throw new Error('Only active memberships can be frozen.');

  const todayStr = getLocalDateStr(new Date());
  const scheduledEnd = new Date();
  scheduledEnd.setDate(scheduledEnd.getDate() + parseInt(days));
  const freezeEndStr = getLocalDateStr(scheduledEnd);

  // Preserve the original end date prior to freeze
  const baseEndDate = ms.original_end_date || ms.end_date;

  // Tentative new end date if they stay frozen full duration
  const tentativeEndDateObj = new Date(baseEndDate);
  tentativeEndDateObj.setDate(tentativeEndDateObj.getDate() + parseInt(days));
  const tentativeEndStr = getLocalDateStr(tentativeEndDateObj);

  db.prepare(`
    UPDATE memberships
    SET membership_status = 'FROZEN',
        freeze_start_date = ?,
        freeze_end_date = ?,
        freeze_reason = ?,
        original_end_date = ?,
        end_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(todayStr, freezeEndStr, reason, baseEndDate, tentativeEndStr, membershipId);

  // Sync member table status and tentative expiry
  db.prepare(`
    UPDATE members
    SET status = 'frozen',
        expiry_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(tentativeEndStr, ms.member_id);

  db.prepare(`
    INSERT INTO membership_status_history (membership_id, previous_status, new_status, reason, changed_by)
    VALUES (?, 'ACTIVE', 'FROZEN', ?, ?)
  `).run(membershipId, `Frozen for ${days} days (until ${freezeEndStr}). Reason: ${reason}`, user);

  logAudit(null, 'FREEZE_MEMBERSHIP', 'memberships', membershipId, null, null, `Membership frozen for ${days} days until ${freezeEndStr}. Reason: ${reason}`);
  updateMembershipStatuses();

  return {
    success: true,
    membershipId,
    memberId: ms.member_id,
    freezeStartDate: todayStr,
    freezeEndDate: freezeEndStr,
    tentativeEndDate: tentativeEndStr,
    days: parseInt(days)
  };
}

function unfreezeMembership(membershipId, user = 'Admin') {
  const ms = db.prepare('SELECT * FROM memberships WHERE id = ?').get(membershipId);
  if (!ms) throw new Error('Membership not found.');
  if (ms.membership_status !== 'FROZEN') throw new Error('Only frozen memberships can be unfrozen.');

  const today = new Date();
  const todayStr = getLocalDateStr(today);
  
  // Calculate how many days the member was actually frozen
  const startDateStr = ms.freeze_start_date || getLocalDateStr(new Date(ms.updated_at));
  const startDate = new Date(startDateStr);
  startDate.setHours(0, 0, 0, 0);
  const todayZero = new Date(today);
  todayZero.setHours(0, 0, 0, 0);

  const diffMs = todayZero - startDate;
  // If unfrozen on the same day as frozen, count as 0 or 1 day minimum (let's do Math.max(0, ...))
  const actualDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));

  // Base end date is original_end_date
  const baseEndDate = ms.original_end_date || ms.end_date;
  const newEndDateObj = new Date(baseEndDate);
  newEndDateObj.setDate(newEndDateObj.getDate() + actualDays);
  const finalEndDateStr = getLocalDateStr(newEndDateObj);

  db.prepare(`
    UPDATE memberships
    SET membership_status = 'ACTIVE',
        end_date = ?,
        original_end_date = NULL,
        freeze_start_date = NULL,
        freeze_end_date = NULL,
        total_frozen_days = COALESCE(total_frozen_days, 0) + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(finalEndDateStr, actualDays, membershipId);

  // Sync member status back to active and update expiry_date
  db.prepare(`
    UPDATE members
    SET status = 'active',
        expiry_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(finalEndDateStr, ms.member_id);

  db.prepare(`
    INSERT INTO membership_status_history (membership_id, previous_status, new_status, reason, changed_by)
    VALUES (?, 'FROZEN', 'ACTIVE', ?, ?)
  `).run(membershipId, `Unfrozen after ${actualDays} day(s). New expiry: ${finalEndDateStr}`, user);

  logAudit(null, 'UNFREEZE_MEMBERSHIP', 'memberships', membershipId, null, null, `Membership unfrozen after ${actualDays} day(s). New expiry: ${finalEndDateStr}`);
  updateMembershipStatuses();

  return {
    success: true,
    membershipId,
    memberId: ms.member_id,
    actualDaysFrozen: actualDays,
    newEndDate: finalEndDateStr
  };
}

// ─── Biometrics Management ──────────────────────────────────
function saveMemberBiometric(memberId, employeeNo, biometricType, subId = 1, fingerType = 'normalFP', cardReaderNo = 1, biometricData, extraJson = '') {
  if (!memberId || !biometricData) return;
  const existing = db.prepare(`
    SELECT id FROM member_biometrics 
    WHERE member_id = ? AND biometric_type = ? AND sub_id = ?
  `).get(memberId, biometricType, subId);

  if (existing) {
    db.prepare(`
      UPDATE member_biometrics
      SET employee_no = ?, finger_type = ?, card_reader_no = ?, biometric_data = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(String(employeeNo), String(fingerType || 'normalFP'), parseInt(cardReaderNo || 1), String(biometricData), String(extraJson || ''), existing.id);
    return existing.id;
  } else {
    const res = db.prepare(`
      INSERT INTO member_biometrics (member_id, employee_no, biometric_type, sub_id, finger_type, card_reader_no, biometric_data, extra_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(memberId, String(employeeNo), biometricType, parseInt(subId || 1), String(fingerType || 'normalFP'), parseInt(cardReaderNo || 1), String(biometricData), String(extraJson || ''));
    return res.lastInsertRowid;
  }
}

function getMemberBiometrics(memberId) {
  if (!memberId) return [];
  return db.prepare('SELECT * FROM member_biometrics WHERE member_id = ? ORDER BY sub_id ASC').all(memberId);
}

function getMemberBiometricsByEmployeeNo(employeeNo) {
  if (!employeeNo) return [];
  return db.prepare('SELECT * FROM member_biometrics WHERE employee_no = ? ORDER BY sub_id ASC').all(String(employeeNo));
}

function deleteMemberBiometrics(memberId) {
  if (!memberId) return;
  db.prepare('DELETE FROM member_biometrics WHERE member_id = ?').run(memberId);
}

module.exports = {
  db,
  dbEvents,
  seedAdmin,
  getAdminByUsername,
  updateAdminPassword,
  getAllMembers,
  getMemberById,
  addMember,
  updateMember,
  deleteMember,
  getExpiryDate,
  getMembersExpiringOn,
  getMembersExpiringSoon,
  updateExpiredMembers,
  getDashboardStats,
  logNotification,
  getNotifications,
  deleteNotification,
  hasRecentNotification,
  getSetting,
  setSetting,
  recordAttendance,
  deleteAttendance,
  getAttendanceByDate,
  getAttendanceSummary,
  getTodayAttendanceCount,
  getMemberAttendanceStats,
  getMemberAttendanceHistory,
  getAllLogistics,
  getLogisticsById,
  addLogisticsItem,
  updateLogisticsItem,
  deleteLogisticsItem,
  recordLogisticsTransaction,
  getLogisticsTransactions,
  getAllPlans,
  addPlan,
  deletePlan,
  createMembership,
  renewMembership,
  recordPayment,
  reversePayment,
  getMemberProfile,
  getMembershipHistory,
  getPaymentHistory,
  getOutstandingDues,
  updateMembershipStatuses,
  updatePaymentStatuses,
  freezeMembership,
  unfreezeMembership,
  getLocalDateStr,
  saveMemberBiometric,
  getMemberBiometrics,
  getMemberBiometricsByEmployeeNo,
  deleteMemberBiometrics
};
