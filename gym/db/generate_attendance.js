const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'gym.db');
const db = new DatabaseSync(dbPath);

console.log('=== STARTING REALISTIC DATA & ATTENDANCE GENERATION ===');

// 1. Clean up generic or test member profiles to look 100% authentic for client demo
const memberUpdates = [
  {
    id: 5,
    full_name: 'Abishek Adhikari',
    phone: '9827556772',
    email: 'abishek.adhikari@gmail.com',
    address: 'Baluwatar, Kathmandu'
  },
  {
    id: 6,
    full_name: 'Karina K.C.',
    phone: '9841772391',
    email: 'karina.kc@gmail.com',
    address: 'Jhamsikhel, Lalitpur'
  },
  {
    id: 10,
    full_name: 'Aarav Sharma',
    phone: '9841526371',
    email: 'aarav.sharma@gmail.com',
    address: 'New Baneshwor, Kathmandu',
    plan_type: 'Quarterly Standard'
  },
  {
    id: 11,
    full_name: 'Binod Chaudhary',
    phone: '9818294750',
    email: 'binod.chaudhary@gmail.com',
    address: 'Koteshwor, Kathmandu',
    plan_type: 'Annual Premium'
  },
  {
    id: 12,
    full_name: 'Priya Thapa',
    phone: '9860431289',
    email: 'priya.thapa@gmail.com',
    address: 'Pulchowk, Lalitpur',
    plan_type: '6-Month Fitness'
  },
  {
    id: 13,
    full_name: 'Rohan Shrestha',
    phone: '9803127845',
    email: 'rohan.shrestha@gmail.com',
    address: 'Thamel, Kathmandu',
    plan_type: 'Student Special'
  }
];

console.log('\n[1/4] Updating member details to realistic Nepali names, phones, and addresses...');
for (const m of memberUpdates) {
  if (m.plan_type) {
    db.prepare(`
      UPDATE members 
      SET full_name = ?, phone = ?, email = ?, address = ?, plan_type = ? 
      WHERE id = ?
    `).run(m.full_name, m.phone, m.email, m.address, m.plan_type, m.id);
  } else {
    db.prepare(`
      UPDATE members 
      SET full_name = ?, phone = ?, email = ?, address = ? 
      WHERE id = ?
    `).run(m.full_name, m.phone, m.email, m.address, m.id);
  }
}

// 2. Clean up test plan names in plans and memberships table
console.log('\n[2/4] Normalizing plan names...');
const planRenames = [
  { id: 8, name: 'Quarterly Standard', price: 5500 },
  { id: 10, name: 'Annual Premium', price: 18000 },
  { id: 12, name: '6-Month Fitness', price: 9500 },
  { id: 14, name: 'Student Special', price: 4500 }
];

for (const p of planRenames) {
  db.prepare('UPDATE plans SET plan_name = ?, regular_price = ? WHERE id = ?').run(p.name, p.price, p.id);
}

db.prepare("UPDATE memberships SET plan_name_snapshot = 'Quarterly Standard' WHERE member_id = 10").run();
db.prepare("UPDATE memberships SET plan_name_snapshot = 'Annual Premium' WHERE member_id = 11").run();
db.prepare("UPDATE memberships SET plan_name_snapshot = '6-Month Fitness' WHERE member_id = 12").run();
db.prepare("UPDATE memberships SET plan_name_snapshot = 'Student Special' WHERE member_id = 13").run();

// 3. Clear old attendance records
console.log('\n[3/4] Refreshing attendance records for past 30 days...');
db.prepare('DELETE FROM attendance').run();

// Extend memberships for Aarav, Binod, Priya, Rohan so they are active members
db.prepare("UPDATE members SET status = 'active', expiry_date = '2027-02-01' WHERE id IN (10, 11, 12)").run();
db.prepare("UPDATE memberships SET membership_status = 'ACTIVE', end_date = '2027-02-01' WHERE member_id IN (10, 11, 12)").run();
db.prepare("UPDATE members SET status = 'active', expiry_date = '2027-01-15' WHERE id = 13").run();
db.prepare("UPDATE memberships SET membership_status = 'ACTIVE', end_date = '2027-01-15' WHERE member_id = 13").run();

// 4. Generate attendance records leading up to today (30 days total)
const allMembers = db.prepare('SELECT id, full_name, phone, status FROM members').all();
const activeMembers = allMembers.filter(m => m.id !== 3); // Exclude old inactive member Ramu
console.log(`Active members count: ${activeMembers.length}`);
activeMembers.forEach(m => console.log(` - ID ${m.id}: ${m.full_name} (${m.phone})`));

const insertStmt = db.prepare('INSERT INTO attendance (member_id, check_in_time, date, shift) VALUES (?, ?, ?, ?)');

// Local today reference
const today = new Date();
const todayYyyy = today.getFullYear();
const todayMm = String(today.getMonth() + 1).padStart(2, '0');
const todayDd = String(today.getDate()).padStart(2, '0');
const todayDateStr = `${todayYyyy}-${todayMm}-${todayDd}`;

console.log(`\nGenerating 30 days of attendance records up to today (${todayDateStr})...`);

let totalInserted = 0;

// Past 29 days (excluding today, which is handled specially below) => 30 days total
for (let i = 29; i >= 1; i--) {
  const currentDate = new Date(today);
  currentDate.setDate(today.getDate() - i);
  
  const yyyy = currentDate.getFullYear();
  const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
  const dd = String(currentDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  
  const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
  
  // Weekdays: 5-8 members, Weekends: 3-5 members
  const count = isWeekend ? Math.floor(Math.random() * 3) + 3 : Math.floor(Math.random() * 4) + 5;
  
  const shuffled = [...activeMembers].sort(() => 0.5 - Math.random());
  const selectedMembers = shuffled.slice(0, Math.min(count, shuffled.length));
  
  selectedMembers.forEach(m => {
    const shift = Math.random() < 0.6 ? 'morning' : 'day';
    let hour, minute, second;
    
    if (shift === 'morning') {
      // Morning: 06:15 - 09:45
      hour = Math.floor(Math.random() * 4) + 6;
    } else {
      // Day/Evening: 15:30 - 19:45
      hour = Math.floor(Math.random() * 5) + 15;
    }
    minute = Math.floor(Math.random() * 60);
    second = Math.floor(Math.random() * 60);
    
    const hhStr = String(hour).padStart(2, '0');
    const mmStr = String(minute).padStart(2, '0');
    const ssStr = String(second).padStart(2, '0');
    const checkInTime = `${dateStr} ${hhStr}:${mmStr}:${ssStr}`;
    
    insertStmt.run(m.id, checkInTime, dateStr, shift);
    totalInserted++;
  });
  
  const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'short' });
  console.log(` - ${dateStr} (${dayName}): ${selectedMembers.length} check-ins`);
}

// 4b. SPECIFIC HIGHLY REALISTIC ATTENDANCE ENTRIES FOR TODAY
console.log(`\n[4/4] Generating carefully timed check-ins for TODAY (${todayDateStr})...`);

const todayCheckIns = [
  { name: 'Ashim Pandey', shift: 'morning', time: `${todayDateStr} 06:18:24` },
  { name: 'Saurav Kunwar', shift: 'morning', time: `${todayDateStr} 06:45:10` },
  { name: 'Karina K.C.', shift: 'morning', time: `${todayDateStr} 07:12:45` },
  { name: 'Aarav Sharma', shift: 'morning', time: `${todayDateStr} 07:48:30` },
  { name: 'Binod Chaudhary', shift: 'morning', time: `${todayDateStr} 08:32:15` },
  { name: 'Abishek Adhikari', shift: 'morning', time: `${todayDateStr} 09:10:40` }
];

let todayCount = 0;
todayCheckIns.forEach(entry => {
  const member = activeMembers.find(m => m.full_name.toLowerCase().replace(/\s+/g, '') === entry.name.toLowerCase().replace(/\s+/g, ''));
  if (member) {
    insertStmt.run(member.id, entry.time, todayDateStr, entry.shift);
    totalInserted++;
    todayCount++;
    console.log(`  ✓ Checked in: ${member.full_name.padEnd(18)} | Shift: ${entry.shift.padEnd(8)} | Time: ${entry.time}`);
  } else {
    console.warn(`  ⚠ Member not found: ${entry.name}`);
  }
});

console.log(`\n✅ Completed! Generated ${todayCount} check-ins for TODAY (${todayDateStr}).`);
console.log(`✅ Total attendance records across all dates: ${totalInserted}`);
