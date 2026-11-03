const db = require('../db/database');

const crypto = require('crypto');
const os = require('os');

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    if (name.toLowerCase().includes('vmware') || name.toLowerCase().includes('virtual')) continue;
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '192.168.1.115';
}

/**
 * Helper to fetch settings from DB.
 */
function getHikvisionConfig() {
  return {
    ip: db.getSetting('hikvision_ip', '192.168.1.182'),
    port: db.getSetting('hikvision_port', '80'),
    username: db.getSetting('hikvision_username', 'admin'),
    password: db.getSetting('hikvision_password', '@Fitness24')
  };
}

/**
 * Performs an HTTP fetch and automatically handles Digest Authentication if required
 * by the Hikvision device (which is typical).
 */
async function fetchWithAuth(url, options = {}, config) {
  if (!options.signal) {
    // Fail fast on LAN requests (8 seconds instead of default 30s+)
    options.signal = AbortSignal.timeout(8000);
  }

  // First attempt, usually responds with 401 and WWW-Authenticate for Digest
  const initialResponse = await fetch(url, options);

  if (initialResponse.status === 401) {
    const wwwAuth = initialResponse.headers.get('www-authenticate');
    if (wwwAuth && wwwAuth.startsWith('Digest')) {
      const params = {};
      wwwAuth.replace(/(\w+)="([^"]+)"/g, (_, key, value) => { params[key] = value; });
      wwwAuth.replace(/(\w+)=([^",\s]+)/g, (_, key, value) => { if (!params[key]) params[key] = value; });

      const { realm, nonce, qop, opaque } = params;
      const method = options.method || 'GET';
      const uri = new URL(url).pathname + (new URL(url).search || '');
      const nc = '00000001';
      const cnonce = crypto.randomBytes(8).toString('hex');

      const ha1 = crypto.createHash('md5').update(`${config.username}:${realm}:${config.password}`).digest('hex');
      const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
      
      let responseHash;
      if (qop === 'auth' || qop === 'auth-int') {
        responseHash = crypto.createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex');
      } else {
        responseHash = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
      }

      let authHeader = `Digest username="${config.username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${responseHash}"`;
      if (opaque !== undefined && opaque !== null) authHeader += `, opaque="${opaque}"`;
      if (qop) authHeader += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;

      const newOptions = { ...options };
      newOptions.headers = { ...newOptions.headers, 'Authorization': authHeader };

      return await fetch(url, newOptions);
    }
  }

  return initialResponse;
}


/**
 * 1. testHikvisionConnection()
 * Tests connection to the Hikvision device using the provided config.
 */
async function testHikvisionConnection(ip, port, username, password) {
  try {
    const url = `http://${ip}:${port}/ISAPI/System/deviceInfo`;
    
    const config = { username, password };
    const response = await fetchWithAuth(url, { method: 'GET' }, config);

    if (response.ok) {
      return { success: true, message: 'Connection successful!' };
    } else if (response.status === 401) {
      const text = await response.text();
      if (text.includes('<lockStatus>lock</lockStatus>')) {
        const match = text.match(/<unlockTime>(\d+)<\/unlockTime>/);
        const secs = match ? match[1] : 'few';
        const mins = Math.ceil(parseInt(secs, 10) / 60);
        return { 
          success: false, 
          message: `🔒 Hikvision device is temporarily locked (${secs}s / ~${mins} min remaining) due to security lockout. Unplug and replug the device power to reset the lock immediately, or wait for the timer.` 
        };
      }
      return { success: false, message: 'Authentication failed (check username/password).' };
    } else {
      return { success: false, message: `Connection failed with status ${response.status}` };
    }
  } catch (err) {
    return { success: false, message: `Connection error: ${err.message}` };
  }
}

/**
 * 2. fetchHikvisionEvents()
 * Pulls today's access events from the Hikvision device.
 */
async function fetchHikvisionEvents() {
  try {
    const config = getHikvisionConfig();
    if (!config.ip) return { success: false, message: 'Hikvision IP not configured' };

    const url = `http://${config.ip}:${config.port}/ISAPI/AccessControl/AcsEvent?format=json`;
    
    // Search events covering today in local gym time (accounting for the Hikvision device's +08:00 timezone,
    // which is 2h15m ahead of Nepal and crosses midnight earlier than local time).
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const pad = (n) => String(n).padStart(2, '0');
    const toIsoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const startTime = `${toIsoDate(past)}T00:00:00+08:00`;
    const endTime = `${toIsoDate(future)}T23:59:59+08:00`;

    let allEvents = [];
    let currentPosition = 0;
    const maxResults = 30; // Device limits to 30 per request

    while (true) {
      const payload = {
        "AcsEventCond": {
          "searchID": "attendance-poll",
          "searchResultPosition": currentPosition,
          "maxResults": maxResults,
          "major": 5, // Access Control Event
          "minor": 0, // 0 fetches all access control events (fingerprint, face, etc.)
          "startTime": startTime,
          "endTime": endTime
        }
      };

      const response = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, config);

      if (!response.ok) {
        if (allEvents.length > 0) break; // Return what we have if a later page fails
        return { success: false, message: `Failed to fetch events: ${response.status}` };
      }

      const data = await response.json();
      const events = data.AcsEvent?.InfoList || [];
      allEvents = allEvents.concat(events);

      // If we received fewer events than the max, we've reached the end
      if (events.length < maxResults) {
        break;
      }
      currentPosition += maxResults;
    }

    return { success: true, data: { AcsEvent: { InfoList: allEvents } } };
  } catch (err) {
    if (err.name === 'TimeoutError' || (err.cause && err.cause.code === 'UND_ERR_CONNECT_TIMEOUT') || err.message === 'fetch failed') {
      return { success: false, message: 'Connection timeout or device offline' };
    }
    console.error('Error fetching Hikvision events:', err);
    return { success: false, message: err.message };
  }
}
/**
 * Accurately resolves a gym member from any Hikvision event object.
 * Checks biometrics cache, employee ID, phone numbers (with/without country code), and member name.
 */
function resolveMemberFromHikvisionEvent(event, allMembers) {
  if (!event) return null;
  const rawEmpNo = event.employeeNoString || event.employeeNo;
  const empNo = rawEmpNo ? String(rawEmpNo).replace(/\D/g, '') : '';
  const eventName = (event.name || '').trim().toLowerCase();

  // Ignore root admin operator device account
  if (empNo === '1' && (eventName === 'admin' || !eventName)) return null;

  const matchesPhone = (m, eNo) => {
    if (!eNo) return false;
    const p = String(m.phone || '').replace(/\D/g, '');
    if (!p) return false;
    const eNoNo977 = eNo.startsWith('977') && eNo.length > 10 ? eNo.slice(3) : eNo;
    const pNo977 = p.startsWith('977') && p.length > 10 ? p.slice(3) : p;
    return (
      p === eNo ||
      p === eNoNo977 ||
      pNo977 === eNoNo977 ||
      (eNoNo977.length >= 7 && p.endsWith(eNoNo977)) ||
      (pNo977.length >= 7 && eNo.endsWith(pNo977))
    );
  };

  // 1. Highest priority: Match by event.name AND phone/ID together
  if (eventName && eventName !== 'admin') {
    const mBoth = allMembers.find(mem => 
      (mem.full_name || '').trim().toLowerCase() === eventName &&
      (matchesPhone(mem, empNo) || String(mem.id) === empNo || mem.member_code?.replace(/\D/g, '') === empNo)
    );
    if (mBoth) return mBoth;

    // 2. Match by event.name alone (if device screen showed user's name)
    const mByName = allMembers.find(mem => (mem.full_name || '').trim().toLowerCase() === eventName);
    if (mByName) return mByName;
  }

  // 3. Check member_biometrics table by employee_no (high accuracy for enrolled templates)
  if (empNo) {
    try {
      const bio = db.db.prepare('SELECT member_id FROM member_biometrics WHERE employee_no = ?').get(empNo);
      if (bio) {
        const m = allMembers.find(mem => mem.id === bio.member_id);
        if (m) return m;
      }
    } catch (e) {}
  }

  // 4. Check phone number (exact digits, or with/without Nepal 977 country code, or endsWith)
  if (empNo) {
    const mByPhone = allMembers.find(mem => matchesPhone(mem, empNo));
    if (mByPhone) return mByPhone;
  }

  // 5. Check by member ID or member_code
  if (empNo) {
    const mById = allMembers.find(mem => String(mem.id) === empNo || (mem.member_code && mem.member_code.replace(/\D/g, '') === empNo));
    if (mById) return mById;
  }

  return null;
}

/**
 * 2. pollAndRecordAttendance()
 * Pulls today's events from the Hikvision device and records attendance in the database.
 */
async function pollAndRecordAttendance() {
  try {
    const result = await fetchHikvisionEvents();
    if (!result.success || !result.data) {
      return;
    }
    
    const events = result.data.AcsEvent?.InfoList || [];
    if (events.length === 0) return;

    const allMembers = db.getAllMembers('', 'all');
    let recorded = 0;

    for (const event of events) {
      // Ignore unverified events without user identity
      if (event.currentVerifyMode === undefined && !event.name && !event.employeeNoString && !event.employeeNo) continue;
      if (event.currentVerifyMode === 'invalid' && !event.name) continue;

      const member = resolveMemberFromHikvisionEvent(event, allMembers);

      if (member) {
        const eventTime = event.time || null;
        const attendance = db.recordAttendance(member.id, eventTime);
        if (!attendance.duplicate) {
          recorded++;
          console.log(`[Hikvision Poll] Recorded attendance for ${member.full_name} (${attendance.shift} shift) [Member status: ${member.status}]`);
        }
      } else {
        const rawEmp = event.employeeNoString || event.employeeNo || '';
        if (rawEmp && rawEmp !== '1') {
          console.log(`[Hikvision Poll] IGNORED SCAN: Employee ID / Phone ${rawEmp} (${event.name || 'unnamed'}) not matched in gym database.`);
        }
      }
    }

    if (recorded > 0) {
      console.log(`[Hikvision Poll] Recorded ${recorded} new attendance entries from device events.`);
    }
  } catch (err) {
    // Silently fail - polling is a backup mechanism
    console.error('[Hikvision Poll] Error:', err.message);
  }
}

/**
 * 3. handleFingerprintEvent()
 * This function handles an incoming event, checks the member's status, and opens the door if valid.
 */
async function handleFingerprintEvent(employeeNo, timestamp = null, eventName = null) {
  try {
    console.log(`[Hikvision] Received fingerprint event for employeeNo: ${employeeNo}, name: ${eventName || ''}`);
    const allMembers = db.getAllMembers('', 'all'); 
    const member = resolveMemberFromHikvisionEvent({ employeeNo, name: eventName }, allMembers);

    if (!member) {
      console.log(`[Hikvision] Access Denied: Phone/Employee ID ${employeeNo} not found in database.`);
      await denyAccess(String(employeeNo), 'Member not found');
      return { success: false, message: 'Member not found', action: 'deny' };
    }

    // Always record attendance for any recognized member scan
    const attendance = db.recordAttendance(member.id, timestamp);
    const shiftMsg = attendance.duplicate ? '(already checked in today)' : `(${attendance.shift} shift)`;

    if (member.status === 'active') {
      console.log(`[Hikvision] Access Granted for ${member.full_name} (${employeeNo}). Attendance: ${shiftMsg}. Opening door...`);
      await openDoor();
      return { success: true, message: 'Access granted', action: 'open' };
    } else if (member.status === 'frozen') {
      console.log(`[Hikvision] Access Denied for ${member.full_name} (${employeeNo}): Membership is FROZEN. Attendance logged: ${shiftMsg}.`);
      await denyAccess(String(employeeNo), 'Membership is currently frozen');
      return { success: false, message: 'Membership is currently frozen', action: 'deny' };
    } else {
      console.log(`[Hikvision] Access Denied for ${member.full_name}: Status is ${member.status}. Attendance logged: ${shiftMsg}.`);
      await denyAccess(String(employeeNo), 'Membership expired');
      return { success: false, message: 'Membership expired', action: 'deny' };
    }
  } catch (err) {
    console.error('[Hikvision] Error handling fingerprint event:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 4. openDoor()
 * Sends the command to the Hikvision device to open the door.
 */
async function openDoor() {
  try {
    const config = getHikvisionConfig();
    if (!config.ip) return { success: false, message: 'Hikvision IP not configured' };

    const url = `http://${config.ip}:${config.port}/ISAPI/AccessControl/RemoteControl/door/1`;
    
    // Remote Control uses XML format
    const xmlPayload = `<?xml version="1.0" encoding="utf-8"?><RemoteControlDoor xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0"><cmd>open</cmd></RemoteControlDoor>`;

    const response = await fetchWithAuth(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/xml' },
      body: xmlPayload
    }, config);

    if (response.ok) {
      console.log('[Hikvision] Door opened successfully.');
      return { success: true };
    } else {
      console.error(`[Hikvision] Failed to open door. Status: ${response.status}`);
      return { success: false, status: response.status };
    }
  } catch (err) {
    console.error('[Hikvision] Error opening door:', err);
    return { success: false, message: err.message };
  }
}

/**
 * 5. denyAccess()
 * Optional function to log or handle denied access.
 * The Hikvision device naturally denies access if the door open command is not sent,
 * but this can be used to send an alert or trigger a buzzer.
 */
async function denyAccess(employeeNo, reason) {
  try {
    console.log(`[Hikvision] Denying access to ${employeeNo}. Reason: ${reason}`);
    
    // If your device supports remote buzzer/alarm triggering, you can implement it here.
    
    return { success: true, message: 'Access denied logic executed' };
  } catch (err) {
    console.error('[Hikvision] Error denying access:', err);
    return { success: false, message: err.message };
  }
}

/**
 * 6. setupLanConnection()
 * Configures the Hikvision device to push attendance events to the laptop over the LAN.
 */
async function setupLanConnection() {
  try {
    const config = getHikvisionConfig();
    const laptopIp = getLocalIp();
    
    if (!config.ip) return { success: false, message: 'Hikvision IP not configured' };

    const url = `http://${config.ip}:${config.port}/ISAPI/Event/notification/httpHosts`;

    const xmlPayload = `<?xml version="1.0" encoding="utf-8"?>
<HttpHostNotificationList xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0">
  <HttpHostNotification>
    <id>1</id>
    <url>/api/hikvision/event</url>
    <protocolType>HTTP</protocolType>
    <parameterFormatType>JSON</parameterFormatType>
    <addressingFormatType>ipaddress</addressingFormatType>
    <ipAddress>${laptopIp}</ipAddress>
    <portNo>3001</portNo>
    <httpAuthenticationMethod>none</httpAuthenticationMethod>
  </HttpHostNotification>
</HttpHostNotificationList>`;

    const response = await fetchWithAuth(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/xml' },
      body: xmlPayload
    }, config);

    if (response.ok) {
      console.log(`[Hikvision] LAN connection established. Device will push events to ${laptopIp}:3000`);
      return { success: true, message: 'LAN Connection established successfully!' };
    } else {
      console.error(`[Hikvision] Failed to setup LAN connection. Status: ${response.status}`);
      return { success: false, message: `Failed to configure device, status ${response.status}` };
    }
  } catch (err) {
    console.error('[Hikvision] Error setting up LAN connection:', err);
    return { success: false, message: err.message };
  }
}

/**
 * Downloads enrolled biometric templates (fingerprint & face) from the Hikvision device
 * and saves them into the local SQLite database (member_biometrics table).
 */
async function downloadAndBackupBiometrics(member, employeeNo, config) {
  if (!member || !employeeNo) return { backedUpFp: 0, backedUpFace: 0 };
  let backedUpFp = 0;
  let backedUpFace = 0;

  try {
    // 1. Download Fingerprints
    const fpUrl = `http://${config.ip}:${config.port}/ISAPI/AccessControl/FingerPrintUpload?format=json`;
    const fpPayload = {
      "FingerPrintCond": {
        "searchID": "1",
        "employeeNo": String(employeeNo),
        "cardReaderNo": 1
      }
    };

    const fpRes = await fetchWithAuth(
      fpUrl,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fpPayload) },
      config
    );

    if (fpRes.ok) {
      try {
        const fpData = await fpRes.json();
        const list = fpData.FingerPrintInfo?.FingerPrintList || [];
        for (const fp of list) {
          if (fp.fingerData) {
            db.saveMemberBiometric(
              member.id,
              employeeNo,
              'fingerprint',
              fp.fingerPrintID || 1,
              fp.fingerType || 'normalFP',
              fp.cardReaderNo || 1,
              fp.fingerData
            );
            backedUpFp++;
          }
        }
      } catch (parseErr) {
        console.error(`[Hikvision Biometrics] Error parsing fingerprint response for ${member.full_name}:`, parseErr.message);
      }
    }

    // 2. Download Face Data
    const faceUrl = `http://${config.ip}:${config.port}/ISAPI/Intelligent/FDLib/FDSearch?format=json`;
    const facePayload = {
      "searchResultPosition": 0,
      "maxResults": 10,
      "faceLibType": "blackFD",
      "FDID": "1",
      "FPID": String(employeeNo)
    };

    const faceRes = await fetchWithAuth(
      faceUrl,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(facePayload) },
      config
    );

    if (faceRes.ok) {
      try {
        const faceData = await faceRes.json();
        const matches = faceData.MatchList || [];
        for (const match of matches) {
          if (match.modelData) {
            db.saveMemberBiometric(
              member.id,
              employeeNo,
              'face',
              1,
              '',
              1,
              match.modelData,
              JSON.stringify({ faceURL: match.faceURL || '' })
            );
            backedUpFace++;
          }
        }
      } catch (parseErr) {
        console.error(`[Hikvision Biometrics] Error parsing face response for ${member.full_name}:`, parseErr.message);
      }
    }

    if (backedUpFp > 0 || backedUpFace > 0) {
      console.log(`[Hikvision Biometrics] Backed up ${backedUpFp} fingerprint(s) and ${backedUpFace} face template(s) for ${member.full_name} (${employeeNo}) into database.`);
    }
  } catch (err) {
    console.error(`[Hikvision Biometrics] Failed to backup biometrics for ${member.full_name}:`, err.message);
  }

  return { backedUpFp, backedUpFace };
}

/**
 * Automatically restores backed-up biometric templates from SQLite back to the Hikvision machine.
 */
async function restoreBiometricsToDevice(member, targetEmployeeNo, config) {
  if (!member || !targetEmployeeNo) return { restoredFp: 0, restoredFace: 0 };
  let restoredFp = 0;
  let restoredFace = 0;

  try {
    // 1. Get saved biometrics from DB (try by member_id, fallback to employee_no)
    let biometrics = db.getMemberBiometrics(member.id);
    if (!biometrics || biometrics.length === 0) {
      biometrics = db.getMemberBiometricsByEmployeeNo(targetEmployeeNo);
    }
    if (!biometrics || biometrics.length === 0) {
      const rawPhone = String(member.phone).replace(/\D/g, '');
      biometrics = db.getMemberBiometricsByEmployeeNo(rawPhone);
    }

    if (!biometrics || biometrics.length === 0) {
      console.log(`[Hikvision Biometrics] No saved biometrics in database for ${member.full_name}. Member can enroll directly on the machine.`);
      return { restoredFp: 0, restoredFace: 0 };
    }

    for (const b of biometrics) {
      if (b.biometric_type === 'fingerprint') {
        const restorePayload = {
          "FingerPrintCfg": {
            "searchID": "1",
            "employeeNo": String(targetEmployeeNo),
            "enableCardReader": [b.card_reader_no || 1],
            "fingerPrintID": b.sub_id || 1,
            "fingerType": b.finger_type || "normalFP",
            "fingerData": b.biometric_data
          }
        };

        const res = await fetchWithAuth(
          `http://${config.ip}:${config.port}/ISAPI/AccessControl/FingerPrintDownload?format=json`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(restorePayload) },
          config
        );

        if (res.ok) {
          restoredFp++;
          console.log(`[Hikvision Biometrics] Restored fingerprint #${b.sub_id} for ${member.full_name} (${targetEmployeeNo}) to Hikvision machine!`);
        } else {
          const errText = await res.text();
          console.warn(`[Hikvision Biometrics] Could not restore fingerprint #${b.sub_id} for ${member.full_name}: ${errText}`);
        }
      } else if (b.biometric_type === 'face') {
        const facePayload = {
          "faceLibType": "blackFD",
          "FDID": "1",
          "FPID": String(targetEmployeeNo),
          "modelData": b.biometric_data
        };

        const res = await fetchWithAuth(
          `http://${config.ip}:${config.port}/ISAPI/Intelligent/FDLib/FDSetUp?format=json`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(facePayload) },
          config
        );

        if (res.ok) {
          restoredFace++;
          console.log(`[Hikvision Biometrics] Restored face data for ${member.full_name} (${targetEmployeeNo}) to Hikvision machine!`);
        } else {
          const errText = await res.text();
          console.warn(`[Hikvision Biometrics] Could not restore face for ${member.full_name}: ${errText}`);
        }
      }
    }
  } catch (err) {
    console.error(`[Hikvision Biometrics] Error restoring biometrics for ${member.full_name}:`, err.message);
  }

  return { restoredFp, restoredFace };
}

/**
 * Finds all Employee IDs on the Hikvision device matching a member by phone or full name.
 */
async function findDeviceEmployeeNosForMember(member, config) {
  const rawPhone = String(member.phone);
  const digitsWithCode = rawPhone.replace(/\D/g, '');
  const digitsWithoutCode = digitsWithCode.startsWith('977') && digitsWithCode.length > 10
    ? digitsWithCode.slice(3)
    : digitsWithCode;

  const idSet = new Set();
  if (digitsWithCode) idSet.add(digitsWithCode);
  if (digitsWithoutCode) idSet.add(digitsWithoutCode);

  try {
    const searchUrl = `http://${config.ip}:${config.port}/ISAPI/AccessControl/UserInfo/Search?format=json`;
    const searchPayload = {
      "UserInfoSearchCond": {
        "searchID": "find-member",
        "searchResultPosition": 0,
        "maxResults": 100,
        "EmployeeNoList": []
      }
    };

    const res = await fetchWithAuth(
      searchUrl,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(searchPayload) },
      config
    );

    if (res.ok) {
      const data = await res.json();
      const users = data.UserInfoSearch?.UserInfo || [];
      const targetName = (member.full_name || '').trim().toLowerCase();
      for (const u of users) {
        const uName = (u.name || '').trim().toLowerCase();
        if (uName && uName === targetName) {
          idSet.add(String(u.employeeNo));
        } else if (u.employeeNo === digitsWithCode || u.employeeNo === digitsWithoutCode) {
          idSet.add(String(u.employeeNo));
        }
      }
    }
  } catch (err) {
    // Non-fatal search fallback
  }

  return Array.from(idSet);
}

/**
 * 7. syncMemberToDevice()
 * - When EXPIRED: Backs up biometrics (fingerprints/face) to SQLite database, then deletes user from Hikvision device.
 * - When ACTIVE: Sets up user on Hikvision device, and automatically restores backed-up biometrics to the device!
 */
async function syncMemberToDevice(member) {
  try {
    const config = getHikvisionConfig();
    if (!config.ip) return { success: false, message: 'Hikvision IP not configured' };

    const rawPhone = String(member.phone);
    const digitsWithCode = rawPhone.replace(/\D/g, '');
    const digitsWithoutCode = digitsWithCode.startsWith('977') && digitsWithCode.length > 10
      ? digitsWithCode.slice(3)
      : digitsWithCode;

    // ── FROZEN: Keep fingerprint on device, door entry denied by software controller ──
    if (member.status === 'frozen') {
      console.log(`[Hikvision] Member ${member.full_name} is FROZEN. Biometric profile preserved; entry disabled.`);
      return { success: true, message: 'Membership frozen, entry disabled' };
    }

    // Protected members check (saurav kunwar, ashim pandey are never deleted)
    const protectedNames = ['saurav kunwar', 'ashim pandey'];
    const isProtected = protectedNames.includes((member.full_name || '').toLowerCase());

    // ── EXPIRED: BACKUP BIOMETRICS FIRST, THEN DELETE FROM DEVICE ──
    if (member.status === 'expired') {
      if (isProtected) {
        console.log(`[Hikvision] Member ${member.full_name} is protected; skipping deletion from device.`);
        return { success: true, message: 'Protected member preserved' };
      }

      // Step 1: Find all employee IDs for this member on the device
      const candidateIds = await findDeviceEmployeeNosForMember(member, config);

      // Step 2: Download and backup biometric templates to SQLite BEFORE deleting
      for (const empId of candidateIds) {
        await downloadAndBackupBiometrics(member, empId, config);
      }

      // Step 3: Delete user from device so their name and biometric are removed
      async function tryDelete(employeeNo) {
        const payload1 = { "UserInfoDelCond": { "EmployeeNoList": [{ "employeeNo": String(employeeNo) }] } };
        let res = await fetchWithAuth(
          `http://${config.ip}:${config.port}/ISAPI/AccessControl/UserInfo/Delete?format=json`,
          { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload1) },
          config
        );
        if (!res.ok) {
          const payload2 = { "UserInfoDetail": { "mode": "byEmployeeNo", "EmployeeNoList": [{ "employeeNo": String(employeeNo) }] } };
          res = await fetchWithAuth(
            `http://${config.ip}:${config.port}/ISAPI/AccessControl/UserInfo/Delete?format=json`,
            { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload2) },
            config
          );
        }
        return res;
      }

      let deletedAny = false;
      for (const empId of candidateIds) {
        const res = await tryDelete(empId);
        if (res.ok) {
          deletedAny = true;
        } else {
          const err = await res.text();
          if (err.includes('notFound') || err.includes('noRecord') || err.includes('No record')) {
            deletedAny = true;
          }
        }
      }

      console.log(`[Hikvision] REMOVED ${member.full_name} from device (name & biometric deleted). Biometric backup safely saved in database for future renewal.`);
      return { success: true, message: 'User and biometric removed from device; backed up to DB.' };
    }

    // ── ACTIVE: RE-ADD TO DEVICE AND AUTOMATICALLY RESTORE BIOMETRICS ──
    const activeEndTime = member.expiry_date ? `${member.expiry_date}T23:59:59` : '2037-12-31T23:59:59';
    const primaryEmployeeNo = digitsWithCode || digitsWithoutCode;

    async function trySetUp(employeeNo) {
      const payload = {
        "UserInfo": {
          "employeeNo": String(employeeNo),
          "name": member.full_name.substring(0, 32),
          "userType": "normal",
          "doorRight": "1",
          "Valid": {
            "enable": true,
            "beginTime": "2000-01-01T00:00:00",
            "endTime": activeEndTime,
            "timeType": "local"
          },
          "RightPlan": [
            {
              "doorNo": 1,
              "planTemplateNo": "1"
            }
          ]
        }
      };
      return fetchWithAuth(
        `http://${config.ip}:${config.port}/ISAPI/AccessControl/UserInfo/SetUp?format=json`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
        config
      );
    }

    let res = await trySetUp(primaryEmployeeNo);
    if (!res.ok && digitsWithoutCode && digitsWithoutCode !== primaryEmployeeNo) {
      res = await trySetUp(digitsWithoutCode);
    }

    if (res.ok) {
      console.log(`[Hikvision] ENABLED ${member.full_name} (${primaryEmployeeNo}) on device until ${member.expiry_date}.`);

      // Automatically restore any saved fingerprints / face from database!
      const restoreResult = await restoreBiometricsToDevice(member, primaryEmployeeNo, config);

      // If no biometrics were restored because they enrolled directly on machine while active, backup now
      if (restoreResult.restoredFp === 0 && restoreResult.restoredFace === 0) {
        await downloadAndBackupBiometrics(member, primaryEmployeeNo, config);
      }

      return {
        success: true,
        message: `Member active on device until ${member.expiry_date}. Biometrics restored: ${restoreResult.restoredFp} FP, ${restoreResult.restoredFace} face.`
      };
    }

    const body = await res.text();
    console.warn(`[Hikvision] Could not set up ${member.full_name} (${res.status}): ${body}`);
    return { success: false, message: body };
  } catch (err) {
    console.error('[Hikvision] Error syncing member:', err);
    return { success: false, message: err.message };
  }
}

/**
 * Scans all users currently on the device, and backs up their fingerprints & faces into SQLite.
 */
async function backupAllEnrolledBiometrics() {
  try {
    const config = getHikvisionConfig();
    if (!config.ip) return { success: false, message: 'Hikvision IP not configured' };

    const searchUrl = `http://${config.ip}:${config.port}/ISAPI/AccessControl/UserInfo/Search?format=json`;
    const searchPayload = {
      "UserInfoSearchCond": {
        "searchID": "backup-all",
        "searchResultPosition": 0,
        "maxResults": 1000,
        "EmployeeNoList": []
      }
    };

    const res = await fetchWithAuth(
      searchUrl,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(searchPayload) },
      config
    );

    if (!res.ok) return { success: false, message: `Device returned status ${res.status}` };

    const data = await res.json();
    const users = data.UserInfoSearch?.UserInfo || [];
    const allMembers = db.getAllMembers('', 'all');

    let totalBackedUp = 0;
    for (const u of users) {
      if ((u.numOfFP && u.numOfFP > 0) || (u.numOfFace && u.numOfFace > 0)) {
        const uPhoneDigits = String(u.employeeNo).replace(/\D/g, '');
        const uName = (u.name || '').trim().toLowerCase();

        // Ignore root admin operator account
        if (String(u.employeeNo) === '1' && (uName === 'admin' || !uName)) continue;

        // Match member in DB
        const member = allMembers.find(m => {
          const mPhone = String(m.phone).replace(/\D/g, '');
          if (uPhoneDigits && mPhone) {
            if (mPhone === uPhoneDigits) return true;
            if (uPhoneDigits.length >= 7 && mPhone.length >= 7 && (mPhone.endsWith(uPhoneDigits) || uPhoneDigits.endsWith(mPhone))) return true;
          }
          if (uName && uName !== 'admin' && (m.full_name || '').trim().toLowerCase() === uName) return true;
          return false;
        });

        if (member) {
          const r = await downloadAndBackupBiometrics(member, u.employeeNo, config);
          if (r.backedUpFp > 0 || r.backedUpFace > 0) {
            totalBackedUp += (r.backedUpFp + r.backedUpFace);
          }
        }
      }
    }

    console.log(`[Hikvision Biometrics] Full backup completed. Backed up ${totalBackedUp} templates.`);
    return { success: true, totalBackedUp };
  } catch (err) {
    console.error('[Hikvision Biometrics] Full backup failed:', err);
    return { success: false, message: err.message };
  }
}

module.exports = {
  getHikvisionConfig,
  testHikvisionConnection,
  fetchHikvisionEvents,
  pollAndRecordAttendance,
  resolveMemberFromHikvisionEvent,
  handleFingerprintEvent,
  openDoor,
  denyAccess,
  setupLanConnection,
  downloadAndBackupBiometrics,
  restoreBiometricsToDevice,
  syncMemberToDevice,
  backupAllEnrolledBiometrics
};
