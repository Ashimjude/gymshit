const cron = require('node-cron');
const db = require('../db/database');
const hikvision = require('../services/hikvisionService');

let aakashSmsToken = null;

async function printPublicIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    if (res.ok) {
      const data = await res.json();
      console.log(`ℹ️  Public IP of this computer: ${data.ip}`);
      console.log(`🔗 Make sure this IP (${data.ip}) is whitelisted in your Aakash SMS dashboard!\n`);
    }
  } catch (err) {
    // Fail silently if network/DNS issues
  }
}

// Initialize SMS if credentials are available
function initSMS() {
  aakashSmsToken = db.getSetting('aakash_sms_auth_token', '') || process.env.AAKASH_SMS_AUTH_TOKEN;
  if (aakashSmsToken) {
    console.log('📱 Aakash SMS initialized successfully.');
    printPublicIP();
    return true;
  } else {
    console.log('📱 Aakash SMS not configured — SMS notifications will be logged to console.');
    return false;
  }
}

// Send SMS (or log to console if SMS not configured)
async function sendSMS(phone, message) {
  if (aakashSmsToken) {
    try {
      const body = {
        auth_token: aakashSmsToken,
        to: phone,
        text: message
      };
      
      const res = await fetch('https://sms.aakashsms.com/sms/v3/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      
      const data = await res.json();
      
      if (!res.ok || data.error) {
        throw new Error(data.message || 'Failed to send SMS via Aakash SMS');
      }
      
      console.log(`📨 SMS sent to ${phone} via Aakash SMS`);
      return { success: true, sid: data.message_id || 'aakash-sms' };
    } catch (err) {
      console.error(`❌ SMS failed to ${phone}:`, err.message);
      return { success: false, error: err.message };
    }
  } else {
    console.log(`📨 [CONSOLE SMS] To: ${phone}`);
    console.log(`   Message: ${message}`);
    return { success: true, sid: 'console-log' };
  }
}

// Notify a single member
async function notifyMember(member, type, force = false) {
  // Check if we already notified recently (only if not forced)
  if (!force && db.hasRecentNotification(member.id, null, 20)) {
    console.log(`⏭️  Skipping ${member.full_name} — already notified recently.`);
    return { success: false, reason: 'already_notified' };
  }

  const expiryDate = new Date(member.expiry_date);
  const now = new Date();
  expiryDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

  let message;
  if (type === 'manual_reminder' || type === 'manual') {
    // Manually triggered by admin for a customer
    if (diffDays > 0) {
      message = `Dear Customer, you have ${diffDays} day${diffDays === 1 ? '' : 's'} remaining for your membership to get expired at Powerzone Fitness. Please renew your membership before the expiry date.
Thank you,
Powerzone Fitness`;
    } else if (diffDays === 0) {
      message = `Dear Customer, your membership at Powerzone Fitness expires today. Please renew your membership to continue accessing our facilities.
Thank you,
Powerzone Fitness`;
    } else {
      message = `Dear Customer, your membership at Powerzone Fitness expired ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} ago. Please renew your membership to continue accessing our facilities.
Thank you,
Powerzone Fitness`;
    }
  } else if (type === 'expiry_warning') {
    // Automated reminder sent 2 days before
    message = `Dear Customer,
Your membership at Powerzone Fitness will expire in 2 days. Please renew your membership before the expiry date.
Thank you,
Powerzone Fitness`;
  } else if (type === 'expired') {
    message = `Dear Customer, your membership at Powerzone Fitness expires today. Please renew your membership to continue accessing our facilities.
Thank you,
Powerzone Fitness`;
  } else {
    message = `Dear Customer, this is a reminder from Powerzone Fitness regarding your membership.
Thank you,
Powerzone Fitness`;
  }

  const result = await sendSMS(member.phone, message);
  db.logNotification(
    member.id,
    type,
    message,
    result.success ? 'sent' : 'failed'
  );
  return result;
}

// Run the daily check
async function runDailyCheck() {
  console.log('\n🔍 Running daily membership check...');

  // Update expired members in DB and sync to Hikvision
  const allActive = db.getAllMembers('', 'active');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const newlyExpired = [];
  for (const m of allActive) {
    const expiry = new Date(m.expiry_date);
    expiry.setHours(0, 0, 0, 0);
    if (expiry < now) newlyExpired.push(m);
  }

  const expiredCount = db.updateExpiredMembers();
  if (expiredCount > 0) {
    console.log(`📋 Marked ${expiredCount} member(s) as expired.`);
    // Sync each newly expired member to Hikvision
    for (const m of newlyExpired) {
      const expiredMember = { ...m, status: 'expired' };
      const result = await hikvision.syncMemberToDevice(expiredMember);
      if (result.success) {
        console.log(`🔒 [Hikvision] ${m.full_name} disabled on device — membership expired.`);
      } else {
        console.log(`⚠️  [Hikvision] Could not disable ${m.full_name} on device: ${result.message || ''}`);
      }
    }
  }

  const daysBeforeNotify = parseInt(process.env.NOTIFY_DAYS_BEFORE) || 2;

  // Notify members expiring soon (within N days)
  const expiringSoon = db.getMembersExpiringSoon(daysBeforeNotify);
  console.log(`⏰ ${expiringSoon.length} member(s) expiring within ${daysBeforeNotify} days.`);

  for (const member of expiringSoon) {
    const expiry = new Date(member.expiry_date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);

    const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    if (diffDays === 2) {
      await notifyMember(member, 'expiry_warning');
    } else {
      console.log(`⏭️  Skipping ${member.full_name} — diffDays is ${diffDays} (automated notification is only sent once, exactly 2 days before expiry).`);
    }
  }

  console.log('✅ Daily check complete.\n');
}

// Start the cron scheduler
function startScheduler() {
  initSMS();

  // Run daily at 9:00 AM
  cron.schedule('0 9 * * *', () => {
    runDailyCheck();
  });

  console.log('⏰ Notification scheduler started (runs daily at 9:00 AM).');

  // Poll Hikvision device every 15 seconds for attendance events
  cron.schedule('*/15 * * * * *', () => {
    hikvision.pollAndRecordAttendance();
  });

  console.log('📋 Attendance polling started (every 15 seconds from Hikvision device).');

  // Also run immediately on startup
  setTimeout(() => {
    runDailyCheck();
    hikvision.pollAndRecordAttendance();
    if (typeof hikvision.backupAllEnrolledBiometrics === 'function') {
      hikvision.backupAllEnrolledBiometrics().catch(() => {});
    }
  }, 3000);
}

module.exports = { startScheduler, sendSMS, notifyMember, runDailyCheck, initSMS };
