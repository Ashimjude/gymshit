// ═══════════════════════════════════════════════
// GymPro Dashboard - Main Application Logic
// ═══════════════════════════════════════════════

// ─── Auth Check ────────────────────────────────
(async () => {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();
    if (data.admin.username === 'admin') {
      document.getElementById('adminName').textContent = 'Powerzone Admin';
      document.getElementById('adminAvatar').innerHTML = '<img src="/images/powerzone_logo.jpg" alt="Powerzone Admin">';
    } else {
      document.getElementById('adminName').textContent = data.admin.username;
      document.getElementById('adminAvatar').innerHTML = '<img src="/images/powerzone_logo.jpg" alt="Powerzone Admin">';
    }
    loadDashboard();
    loadPackages();
  } catch { window.location.href = '/'; }
})();

// ─── Theme Toggle ──────────────────────────────
// Theme is locked to Light Mode with Dark Sidebar for premium visual balance.

// ─── Toast Notifications ──────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ─── Navigation ───────────────────────────────
const navItems = document.querySelectorAll('.nav-item[data-page]');
const pages = document.querySelectorAll('.page-section');

function navigateTo(page) {
  navItems.forEach(n => n.classList.remove('active'));
  pages.forEach(p => p.classList.remove('active'));
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  const section = document.getElementById(`page-${page}`);
  if (nav) nav.classList.add('active');
  if (section) section.classList.add('active');
  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');

  if (page === 'overview') loadDashboard();
  if (page === 'members') {
    loadPackages();
    loadMembers();
  }
  if (page === 'attendance') loadAttendancePage();
  if (page === 'notifications') loadNotifications();
  if (page === 'logistics') loadLogistics();
  if (page === 'dues') loadDuesPage();
}

navItems.forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

// Mobile toggle
document.getElementById('mobileToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ─── Logout ───────────────────────────────────
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// ═══════════════════════════════════════════════
// DASHBOARD / OVERVIEW
// ═══════════════════════════════════════════════

async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const stats = await res.json();
    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statActive').textContent = stats.active;
    document.getElementById('statExpiring').textContent = stats.expiringSoon;
    document.getElementById('statExpired').textContent = stats.expired;
    document.getElementById('statTodayAttendance').textContent = stats.todayAttendance || 0;

    // Load expiring soon list
    const expRes = await fetch('/api/members?status=active');
    const members = await expRes.json();
    const expiring = members.filter(m => m.days_remaining >= 0 && m.days_remaining <= 7);
    const container = document.getElementById('expiringList');

    if (expiring.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><h3>All good!</h3><p>No memberships expiring within 7 days</p></div>`;
      return;
    }

    container.innerHTML = expiring.map(m => `
      <div class="notif-item">
        <div class="notif-icon warning">⏰</div>
        <div class="notif-content">
          <div class="name">${escapeHtml(m.full_name)}</div>
          <div class="message">Membership expires on ${formatDate(m.expiry_date)} (${m.days_remaining} day${m.days_remaining !== 1 ? 's' : ''} remaining)</div>
          <div class="time">📱 ${m.phone}</div>
        </div>
        <button class="btn btn-success btn-sm" onclick="sendNotification(${m.id}, 'manual_reminder')">📨 Notify</button>
      </div>
    `).join('');
  } catch (err) {
    showToast('Failed to load dashboard', 'error');
  }
}

// ═══════════════════════════════════════════════
// MEMBERS CRUD
// ═══════════════════════════════════════════════

let searchTimeout;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadMembers(), 300);
});
document.getElementById('statusFilter').addEventListener('change', () => loadMembers());

async function loadMembers() {
  const search = document.getElementById('searchInput').value;
  const status = document.getElementById('statusFilter').value;
  try {
    const res = await fetch(`/api/members?search=${encodeURIComponent(search)}&status=${status}`);
    const members = await res.json();
    renderMembers(members);
  } catch { showToast('Failed to load members', 'error'); }
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0][0].toUpperCase();
}

function renderMembers(members) {
  const tbody = document.getElementById('membersBody');
  const empty = document.getElementById('emptyState');

  if (members.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    document.querySelector('#membersTableContainer').style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  document.querySelector('#membersTableContainer').style.display = 'block';

  tbody.innerHTML = members.map(m => {
    let statusClass = m.status;
    let statusLabel = m.status;
    if (m.status === 'frozen' || m.latest_membership_status === 'FROZEN') {
      statusClass = 'frozen';
      statusLabel = '❄️ Frozen';
    } else if (m.status === 'active' && m.days_remaining <= 7) {
      statusClass = 'expiring';
      statusLabel = 'Expiring';
    }

    let paymentBadge = '';
    if (m.outstanding_balance === 0) {
      paymentBadge = `<span class="badge active" style="background:var(--green); color:white;">Paid</span>`;
    } else {
      if (m.latest_payment_status === 'OVERDUE') {
        paymentBadge = `<span class="badge expired" style="background:#ef4444; color:white;">Overdue: NPR ${m.outstanding_balance}</span>`;
      } else if (m.total_paid > 0) {
        paymentBadge = `<span class="badge warning" style="background:#f59e0b; color:white;">Due: NPR ${m.outstanding_balance}</span>`;
      } else {
        paymentBadge = `<span class="badge" style="background:#64748b; color:white;">Unpaid: NPR ${m.outstanding_balance}</span>`;
      }
    }

    return `
    <tr class="clickable-row">
      <td onclick="viewMemberProfile(${m.id})">
        <div class="member-info-cell">
          <div class="member-avatar-container">
            <img src="${m.avatar_path || m.photo_url || '/images/powerzone_logo.jpg'}" class="member-avatar-img" alt="${escapeHtml(m.full_name)}" onerror="this.src='/images/powerzone_logo.jpg';">
          </div>
          <div>
            <div class="member-name">${escapeHtml(m.full_name)}</div>
            ${m.email ? `<div class="member-phone">${escapeHtml(m.email)}</div>` : ''}
          </div>
        </div>
      </td>
      <td onclick="viewMemberProfile(${m.id})">${escapeHtml(m.phone)}</td>
      <td onclick="viewMemberProfile(${m.id})"><span class="badge active">${m.plan_type}</span></td>
      <td onclick="viewMemberProfile(${m.id})">${formatDate(m.join_date)}</td>
      <td onclick="viewMemberProfile(${m.id})">${formatDate(m.expiry_date)}</td>
      <td onclick="viewMemberProfile(${m.id})" style="text-align:center;">
        <span class="badge ${m.days_in_last_30 >= 18 ? 'active' : (m.days_in_last_30 >= 8 ? 'warning' : 'expired')}" style="font-size:12px; font-weight:700;">
          ${m.days_in_last_30 || 0} / 30 d
        </span>
      </td>
      <td onclick="viewMemberProfile(${m.id})"><span class="badge ${statusClass}">${statusLabel}</span></td>
      <td onclick="viewMemberProfile(${m.id})">${paymentBadge}</td>
      <td>
        <div class="actions-cell">
          <button class="action-btn" title="Edit" onclick="editMember(${m.id})">✏️</button>
          <button class="action-btn notify" title="Send Notification" onclick="sendNotification(${m.id}, 'manual_reminder')">📨</button>
          ${['saurav kunwar', 'ashim pandey'].includes(m.full_name.trim().toLowerCase())
            ? `<button class="action-btn delete" title="Protected Member" style="opacity: 0.4; cursor: not-allowed;" disabled>🔒</button>`
            : `<button class="action-btn delete" title="Delete" onclick="confirmDelete(${m.id}, '${escapeHtml(m.full_name)}')">🗑️</button>`
          }
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ─── Add/Edit Modal ───────────────────────────
const modal = document.getElementById('memberModal');
const form = document.getElementById('memberForm');

document.getElementById('addMemberBtn').addEventListener('click', () => {
  document.getElementById('modalTitle').textContent = 'Add New Member';
  document.getElementById('modalSubmit').textContent = 'Add Member';
  form.reset();
  document.getElementById('memberId').value = '';
  document.getElementById('memberJoinDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('memberDuration').value = '1';
  document.getElementById('memberPlan').value = 'Monthly';
  document.getElementById('memberDOB').value = '';
  document.getElementById('memberGender').value = 'male';
  document.getElementById('memberEmergencyName').value = '';
  document.getElementById('memberEmergencyPhone').value = '';
  document.getElementById('memberPaymentMethod').value = 'Cash';
  document.getElementById('memberTransactionRef').value = '';
  document.getElementById('memberPaymentDueDate').value = '';
  document.getElementById('onboardingPaymentSection').style.display = 'block';
  calculateExpiryDate();
  applySelectedPlanPricing();
  clearMemberPhoto();
  modal.classList.add('active');
});

function closeMemberModal() {
  modal.classList.remove('active');
  stopWebcam();
}

document.getElementById('modalClose').addEventListener('click', () => closeMemberModal());
document.getElementById('modalCancel').addEventListener('click', () => closeMemberModal());
modal.addEventListener('click', (e) => { if (e.target === modal) closeMemberModal(); });

// ─── Auto-calculate Expiry Date (Custom dates always respected) ───
function calculateExpiryDate(force = false) {
  const joinDateStr = document.getElementById('memberJoinDate').value;
  const durationStr = document.getElementById('memberDuration').value;
  
  if (!force && durationStr === 'custom') {
    return;
  }
  
  if (joinDateStr && durationStr && durationStr !== 'custom') {
    const joinDate = new Date(joinDateStr);
    const duration = parseInt(durationStr, 10);
    
    if (!isNaN(joinDate.getTime()) && !isNaN(duration)) {
      joinDate.setMonth(joinDate.getMonth() + duration);
      const expiryDateStr = joinDate.toISOString().split('T')[0];
      document.getElementById('memberExpiryDate').value = expiryDateStr;
    }
  }
}

function handleExpiryDateManualChange() {
  document.getElementById('memberDuration').value = 'custom';
}

// Immediate response to manual changes on Expiry Date
const memberExpEl = document.getElementById('memberExpiryDate');
if (memberExpEl) {
  memberExpEl.addEventListener('input', handleExpiryDateManualChange);
  memberExpEl.addEventListener('change', handleExpiryDateManualChange);
}

// Changing Join Date only auto-updates expiry if user is adding a new member and hasn't set custom expiry
document.getElementById('memberJoinDate').addEventListener('change', () => {
  const isEdit = !!document.getElementById('memberId').value;
  const durVal = document.getElementById('memberDuration').value;
  if (!isEdit && durVal !== 'custom') {
    calculateExpiryDate();
  }
});

// Synchronize Duration changes to Plan Type selection
document.getElementById('memberDuration').addEventListener('change', () => {
  const durationVal = document.getElementById('memberDuration').value;
  const planSelect = document.getElementById('memberPlan');
  
  if (durationVal !== 'custom') {
    const duration = parseInt(durationVal, 10);
    let matchedValue = null;
    if (duration === 1) matchedValue = 'Monthly';
    else if (duration === 3) matchedValue = 'Quarterly';
    else if (duration === 6) matchedValue = 'Half-Yearly';
    else if (duration === 12) matchedValue = 'Yearly';
    else {
      const pkg = customPackages.find(p => p.duration_months === duration);
      if (pkg) matchedValue = pkg.name;
    }

    if (matchedValue) {
      planSelect.value = matchedValue;
    }
    calculateExpiryDate(true);
    applySelectedPlanPricing();
  }
});

// Synchronize Plan Type changes to Duration selection and Fee
document.getElementById('memberPlan').addEventListener('change', () => {
  const isEdit = !!document.getElementById('memberId').value;
  const planSelect = document.getElementById('memberPlan');
  const opt = planSelect.options[planSelect.selectedIndex];
  if (!opt) return;

  const duration = parseInt(opt.dataset.duration) || 1;
  const durationSelect = document.getElementById('memberDuration');

  // Only auto-update duration and expiry date when creating a brand new member
  if (!isEdit) {
    let durationOptionExists = false;
    for (let i = 0; i < durationSelect.options.length; i++) {
      if (durationSelect.options[i].value == duration) {
        durationOptionExists = true;
        break;
      }
    }
    if (!durationOptionExists) {
      const newOpt = document.createElement('option');
      newOpt.value = duration.toString();
      newOpt.textContent = `${duration} Month${duration > 1 ? 's' : ''}`;
      durationSelect.appendChild(newOpt);
    }
    durationSelect.value = duration.toString();

    calculateExpiryDate(true);
    applySelectedPlanPricing();
  }
});

function applySelectedPlanPricing() {
  const planSelect = document.getElementById('memberPlan');
  const payableInput = document.getElementById('memberPayableAmount');
  const paidInput = document.getElementById('memberAmountPaid');
  if (!planSelect || !payableInput) return;

  const opt = planSelect.options[planSelect.selectedIndex];
  let price = 2000;
  if (opt && opt.dataset.price && !isNaN(parseFloat(opt.dataset.price))) {
    price = parseFloat(opt.dataset.price);
  } else {
    const planVal = planSelect.value;
    const pkg = customPackages.find(p => p.name.toLowerCase() === planVal.toLowerCase());
    if (pkg && pkg.price) {
      price = pkg.price;
    } else if (planVal === 'Monthly') price = 2000;
    else if (planVal === 'Quarterly' || planVal === 'Quarterly Standard') price = 5500;
    else if (planVal === 'Half-Yearly' || planVal === '6-Month Fitness') price = 10000;
    else if (planVal === 'Yearly' || planVal === 'Annual Premium') price = 18000;
  }

  payableInput.value = price;
  if (paidInput) {
    paidInput.value = price; // Default to paid in full
  }

  updateOnboardingRemainder();
}

function updateOnboardingRemainder() {
  const payable = Math.max(0, parseFloat(document.getElementById('memberPayableAmount')?.value) || 0);
  const paid = Math.max(0, parseFloat(document.getElementById('memberAmountPaid')?.value) || 0);
  const remainder = Math.round((payable - paid) * 100) / 100;

  const card = document.getElementById('onboardingRemainderCard');
  const text = document.getElementById('onboardingRemainderText');
  const badge = document.getElementById('onboardingRemainderStatusBadge');
  const alert = document.getElementById('onboardingDueDateAlert');
  const dueInput = document.getElementById('memberPaymentDueDate');
  const dueReq = document.getElementById('dueDateRequiredIndicator');
  const amountDueSpan = document.getElementById('onboardingRemainderAmountDue');
  const datePreview = document.getElementById('onboardingDueDatePreview');
  const statusTag = document.getElementById('dueDateStatusTag');

  if (!card || !text || !badge) return;

  if (remainder <= 0) {
    card.style.background = '#f0fdf4';
    card.style.borderColor = '#bbf7d0';
    text.style.color = '#15803d';
    text.innerHTML = `Rs. 0 <span style="font-size:12px; font-weight:500; color:#16a34a;">(Fully Settled - No Dues)</span>`;
    badge.style.background = '#16a34a';
    badge.textContent = 'PAID IN FULL';
    if (alert) alert.style.display = 'none';
    if (dueReq) dueReq.style.display = 'none';
    if (statusTag) statusTag.textContent = '(Fully settled - No dues)';
  } else {
    const isPartial = paid > 0;
    card.style.background = '#fffbeb';
    card.style.borderColor = '#fde68a';
    text.style.color = '#b45309';
    text.innerHTML = `<span style="color:#ef4444;">Rs. ${remainder.toLocaleString()}</span> <span style="font-size:12px; font-weight:600; color:#78350f;">(${isPartial ? 'Partially Paid' : 'Fully Unpaid'})</span>`;
    badge.style.background = isPartial ? '#f59e0b' : '#ef4444';
    badge.textContent = isPartial ? 'PARTIALLY PAID' : 'UNPAID DUES';

    if (dueReq) dueReq.style.display = 'inline';
    if (statusTag) statusTag.textContent = `(Payment of Rs. ${remainder.toLocaleString()} due)`;

    // Auto-suggest next due date (15 days from today) if empty
    if (dueInput && !dueInput.value) {
      const defDue = new Date();
      defDue.setDate(defDue.getDate() + 15);
      dueInput.value = defDue.toISOString().split('T')[0];
    }

    if (alert) {
      alert.style.display = 'block';
      if (amountDueSpan) amountDueSpan.textContent = `Rs. ${remainder.toLocaleString()}`;
      if (datePreview) {
        datePreview.textContent = dueInput && dueInput.value ? formatDate(dueInput.value) : 'selected date';
      }
    }
  }
}

// Live remainder recalculations on inputs
document.getElementById('memberPayableAmount')?.addEventListener('input', updateOnboardingRemainder);
document.getElementById('memberAmountPaid')?.addEventListener('input', updateOnboardingRemainder);
document.getElementById('memberPaymentDueDate')?.addEventListener('change', updateOnboardingRemainder);

// Quick toggle buttons
document.getElementById('paidFullBtn')?.addEventListener('click', () => {
  const payable = document.getElementById('memberPayableAmount')?.value || 0;
  const paidInput = document.getElementById('memberAmountPaid');
  if (paidInput) {
    paidInput.value = payable;
    updateOnboardingRemainder();
  }
});

document.getElementById('paidZeroBtn')?.addEventListener('click', () => {
  const paidInput = document.getElementById('memberAmountPaid');
  if (paidInput) {
    paidInput.value = 0;
    updateOnboardingRemainder();
  }
});

// Due date shortcut buttons
document.querySelectorAll('.due-shortcut-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const days = btn.dataset.days;
    const dueInput = document.getElementById('memberPaymentDueDate');
    if (!dueInput) return;

    if (days === 'expiry') {
      const expVal = document.getElementById('memberExpiryDate')?.value;
      if (expVal) dueInput.value = expVal;
    } else {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + parseInt(days, 10));
      dueInput.value = targetDate.toISOString().split('T')[0];
    }
    updateOnboardingRemainder();
  });
});

async function editMember(id) {
  try {
    const res = await fetch(`/api/members/${id}`);
    const m = await res.json();
    document.getElementById('modalTitle').textContent = 'Edit Member';
    document.getElementById('modalSubmit').textContent = 'Save Changes';
    document.getElementById('memberId').value = m.id;
    document.getElementById('memberName').value = m.full_name;
    document.getElementById('memberPhone').value = m.phone;
    document.getElementById('memberEmail').value = m.email || '';
    document.getElementById('memberAddress').value = m.address || '';
    
    // Set both dates directly and set duration to 'custom' so manual changes are never overridden
    document.getElementById('memberJoinDate').value = m.join_date || '';
    document.getElementById('memberDuration').value = 'custom';
    document.getElementById('memberExpiryDate').value = m.expiry_date || '';
    document.getElementById('memberPlan').value = m.plan_type;
    document.getElementById('memberNotes').value = m.notes || '';
    
    // Custom profile fields
    document.getElementById('memberDOB').value = m.date_of_birth || '';
    document.getElementById('memberGender').value = m.gender || 'male';
    document.getElementById('memberEmergencyName').value = m.emergency_contact_name || '';
    document.getElementById('memberEmergencyPhone').value = m.emergency_contact_phone || '';
    
    // Hide payment fields since they are only for new onboarding
    document.getElementById('onboardingPaymentSection').style.display = 'none';
    
    setMemberPhotoPreview(m.avatar_path, m.full_name);
    
    modal.classList.add('active');
  } catch { showToast('Failed to load member details', 'error'); }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('memberId').value;
  
  const joinDateVal = document.getElementById('memberJoinDate').value;
  const expiryDateVal = document.getElementById('memberExpiryDate').value;
  
  if (!joinDateVal || !expiryDateVal) {
    showToast('Both Join Date and Expiry Date are required.', 'error');
    return;
  }

  let durationVal = document.getElementById('memberDuration').value;
  let duration_months = 1;
  if (durationVal === 'custom') {
    const start = new Date(joinDateVal);
    const end = new Date(expiryDateVal);
    if (!isNaN(start) && !isNaN(end)) {
      duration_months = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24 * 30)));
    }
  } else {
    duration_months = parseInt(durationVal, 10);
  }

  const body = {
    full_name: document.getElementById('memberName').value.trim(),
    phone: document.getElementById('memberPhone').value.trim(),
    email: document.getElementById('memberEmail').value.trim(),
    address: document.getElementById('memberAddress').value.trim(),
    join_date: joinDateVal,
    duration_months: duration_months,
    expiry_date: expiryDateVal,
    plan_type: document.getElementById('memberPlan').value,
    notes: document.getElementById('memberNotes').value.trim(),
    
    // Custom profile fields
    date_of_birth: document.getElementById('memberDOB').value || null,
    gender: document.getElementById('memberGender').value,
    emergency_contact_name: document.getElementById('memberEmergencyName').value.trim(),
    emergency_contact_phone: document.getElementById('memberEmergencyPhone').value.trim()
  };

  if (!id) {
    // Initial payment details on onboarding
    body.final_payable_amount = parseFloat(document.getElementById('memberPayableAmount')?.value) || 0;
    body.amount_paid_initial = parseFloat(document.getElementById('memberAmountPaid')?.value) || 0;
    body.payment_method = document.getElementById('memberPaymentMethod')?.value || 'Cash';
    body.transaction_reference = document.getElementById('memberTransactionRef')?.value.trim() || '';
    body.payment_due_date = document.getElementById('memberPaymentDueDate')?.value || null;
  }

  if (memberPhotoCleared) {
    body.avatar_base64 = '';
  } else if (memberPhotoBase64) {
    body.avatar_base64 = memberPhotoBase64;
  }

  try {
    const url = id ? `/api/members/${id}` : '/api/members';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(id ? 'Member updated successfully!' : 'New member added successfully!');
    closeMemberModal();
    
    // Always refresh members list
    loadMembers();

    if (id) {
      // Reload profile page if viewing profile
      viewMemberProfile(id);
    }
    loadDashboard();
  } catch (err) { showToast(err.message || 'Failed to save member', 'error'); }
});

// ─── Delete Confirmation ──────────────────────
let deleteId = null;
const confirmDlg = document.getElementById('confirmDialog');

function confirmDelete(id, name) {
  if (name && ['saurav kunwar', 'ashim pandey'].includes(name.trim().toLowerCase())) {
    showToast('This member is protected and cannot be deleted.', 'error');
    return;
  }
  deleteId = id;
  document.getElementById('confirmTitle').textContent = `Delete ${name}?`;
  document.getElementById('confirmMessage').textContent = 'This will permanently remove this member and their data.';
  confirmDlg.classList.add('active');
}

function closeConfirmDlg() {
  confirmCallback = null;
  deleteId = null;
  document.getElementById('confirmOk').textContent = 'Delete';
  confirmDlg.classList.remove('active');
}

document.getElementById('confirmCancel').addEventListener('click', closeConfirmDlg);
confirmDlg.addEventListener('click', (e) => { if (e.target === confirmDlg) closeConfirmDlg(); });

let confirmCallback = null;

document.getElementById('confirmOk').addEventListener('click', async () => {
  if (confirmCallback) {
    const cb = confirmCallback;
    closeConfirmDlg();
    await cb();
    return;
  }
  if (!deleteId) return;
  try {
    const res = await fetch(`/api/members/${deleteId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Member deleted successfully');
    closeConfirmDlg();
    loadMembers();
    loadDashboard();
  } catch { showToast('Failed to delete member', 'error'); }
});

// ─── Force Expire Membership (Testing Purpose) ───
function triggerTestExpiry(memberId, memberName) {
  confirmCallback = async () => {
    try {
      showToast('Revoking biometric credentials and expiring membership...', 'info');
      let res = await fetch(`/api/members/${memberId}/expire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      // Seamless fallback if server has not restarted yet
      if (res.status === 404) {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yStr = y.toISOString().split('T')[0];
        res = await fetch(`/api/members/${memberId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiry_date: yStr, status: 'expired' })
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(`⚡ ${memberName || 'Member'} has been expired! Biometric access revoked.`, 'warning');
      loadMembers();
      viewMemberProfile(memberId);
      loadDashboard();
    } catch (err) {
      showToast(err.message || 'Failed to expire membership', 'error');
    }
  };

  document.getElementById('confirmTitle').textContent = `⚡ Force Expire ${memberName}?`;
  document.getElementById('confirmMessage').textContent = `Are you sure you want to forcibly expire this membership for testing? This will set their expiry date to yesterday, mark the status as EXPIRED across the system, and immediately revoke door/turnstile access from the Hikvision biometric device.`;
  const okBtn = document.getElementById('confirmOk');
  okBtn.textContent = '⚡ Yes, Expire Now';
  confirmDlg.classList.add('active');
}

// ─── Send Notification ────────────────────────
async function sendNotification(id, type) {
  try {
    const res = await fetch(`/api/members/${id}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.message || 'Notification sent!');
    loadNotifications();
  } catch (err) { showToast(err.message || 'Failed to send notification', 'error'); }
}

// ═══════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════

document.getElementById('notifFilter')?.addEventListener('change', () => loadNotifications());

async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    let notifs = await res.json();
    const container = document.getElementById('notificationsList');
    const empty = document.getElementById('emptyNotifications');

    // Apply Filter
    const filter = document.getElementById('notifFilter').value;
    if (filter !== 'all') {
      notifs = notifs.filter(n => n.status === filter);
    }

    if (notifs.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    container.innerHTML = notifs.map(n => {
      // Determine styling based on type and status
      let iconClass = 'success';
      let iconEmoji = '📨';
      let typeClass = 'type-success';
      
      if (n.status === 'failed') {
        iconClass = 'expired';
        iconEmoji = '❌';
        typeClass = 'type-expired';
      } else if (n.type === 'expired') {
        iconClass = 'warning';
        iconEmoji = '⚠️';
        typeClass = 'type-warning';
      }

      // Calculate time ago
      const sentTime = new Date(n.sent_at);
      const now = new Date();
      const diffMs = now - sentTime;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      
      let timeStr = '';
      if (diffMins < 1) timeStr = 'Just now';
      else if (diffMins < 60) timeStr = `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
      else if (diffHours < 24) timeStr = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      else timeStr = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

      return `
      <div class="notif-item ${typeClass} slide-up">
        <div class="notif-icon ${iconClass}">${iconEmoji}</div>
        <div class="notif-content">
          <div class="header">
            <div class="name">${escapeHtml(n.full_name)} <span class="badge ${n.status}">${n.status}</span></div>
            <div style="display:flex; align-items:center; gap: 12px;">
              <div class="time">🕒 ${timeStr}</div>
              <button class="action-btn delete" style="width:28px; height:28px; font-size:12px;" onclick="deleteNotification(${n.id})" title="Delete Notification">🗑️</button>
            </div>
          </div>
          <div class="message">${escapeHtml(n.message)}</div>
          <div class="footer">
            <div class="phone">📱 ${n.phone}</div>
            <div class="time" style="font-size: 11px; color: var(--text-muted); border: none; padding: 0;">${sentTime.toLocaleString()}</div>
          </div>
        </div>
      </div>
      `;
    }).join('');
  } catch { showToast('Failed to load notifications', 'error'); }
}

async function deleteNotification(id) {
  if (!confirm('Are you sure you want to delete this notification?')) return;
  try {
    const res = await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Notification deleted successfully');
    loadNotifications();
  } catch { showToast('Failed to delete notification', 'error'); }
}

// ═══════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════

let currentAttendanceDate = new Date().toISOString().split('T')[0];
let currentShiftFilter = 'all';

async function loadAttendancePage() {
  await loadAttendanceSummary();
  await loadAttendance();
  setupCheckinSearch();
  setupDateTabsNavigation();
}

function setupDateTabsNavigation() {
  const tabsContainer = document.getElementById('dateTabs');
  if (!tabsContainer) return;

  const scrollStep = 320;

  // Header navigation buttons
  const btnScrollLeft = document.getElementById('btnDateScrollLeft');
  if (btnScrollLeft) {
    btnScrollLeft.onclick = () => tabsContainer.scrollBy({ left: -scrollStep, behavior: 'smooth' });
  }

  const btnScrollRight = document.getElementById('btnDateScrollRight');
  if (btnScrollRight) {
    btnScrollRight.onclick = () => tabsContainer.scrollBy({ left: scrollStep, behavior: 'smooth' });
  }

  // Floating side buttons
  const btnArrowLeft = document.getElementById('btnDateArrowLeft');
  if (btnArrowLeft) {
    btnArrowLeft.onclick = () => tabsContainer.scrollBy({ left: -scrollStep, behavior: 'smooth' });
  }

  const btnArrowRight = document.getElementById('btnDateArrowRight');
  if (btnArrowRight) {
    btnArrowRight.onclick = () => tabsContainer.scrollBy({ left: scrollStep, behavior: 'smooth' });
  }

  // Jump to Today button
  const btnJumpToday = document.getElementById('btnDateJumpToday');
  if (btnJumpToday) {
    btnJumpToday.onclick = () => {
      const todayTab = tabsContainer.querySelector('.date-tab:first-child');
      if (todayTab) {
        todayTab.click();
        tabsContainer.scrollTo({ left: 0, behavior: 'smooth' });
      }
    };
  }

  // Mouse-wheel horizontal scrolling over the date tabs
  tabsContainer.onwheel = (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      tabsContainer.scrollLeft += e.deltaY;
    }
  };
}

async function loadAttendanceSummary() {
  try {
    const res = await fetch('/api/attendance/summary?days=30');
    const summary = await res.json();
    const tabsContainer = document.getElementById('dateTabs');

    // Update today's mini stats
    if (summary.length > 0) {
      const today = summary[0];
      document.getElementById('attendMorning').textContent = today.morning;
      document.getElementById('attendDay').textContent = today.day;
      document.getElementById('attendTotal').textContent = today.total;
    }

    // Render date tabs
    tabsContainer.innerHTML = summary.map((s, i) => {
      const d = new Date(s.date + 'T00:00:00');
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = d.getDate();
      const month = d.toLocaleDateString('en-US', { month: 'short' });
      const isActive = s.date === currentAttendanceDate;
      const isToday = i === 0;
      return `
        <button class="date-tab ${isActive ? 'active' : ''}" data-date="${s.date}" title="${s.date}: ${s.total} check-ins">
          <span class="date-tab-day">${isToday ? 'Today' : dayName}</span>
          <span class="date-tab-num">${dayNum}</span>
          <span class="date-tab-month">${month}</span>
          <span class="date-tab-count">${s.total} ✓</span>
        </button>
      `;
    }).join('');

    // Attach click handlers
    tabsContainer.querySelectorAll('.date-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentAttendanceDate = tab.dataset.date;
        tabsContainer.querySelectorAll('.date-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update header date label
        const dateLabel = document.getElementById('attendanceDateLabel');
        if (dateLabel) {
          const isToday = tab.dataset.date === new Date().toISOString().split('T')[0];
          const dObj = new Date(tab.dataset.date + 'T00:00:00');
          const dStr = dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          dateLabel.textContent = isToday ? `Today (${dStr})` : dStr;
        }

        loadAttendance();
      });
    });

    // Update date label initially
    const dateLabel = document.getElementById('attendanceDateLabel');
    if (dateLabel) {
      const isToday = currentAttendanceDate === new Date().toISOString().split('T')[0];
      const dObj = new Date(currentAttendanceDate + 'T00:00:00');
      const dStr = dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      dateLabel.textContent = isToday ? `Today (${dStr})` : dStr;
    }

    setupDateTabsNavigation();
  } catch { showToast('Failed to load attendance summary', 'error'); }
}

async function loadAttendance() {
  try {
    const res = await fetch(`/api/attendance?date=${currentAttendanceDate}&shift=${currentShiftFilter}`);
    const records = await res.json();
    const tbody = document.getElementById('attendanceBody');
    const empty = document.getElementById('emptyAttendance');
    const tableContainer = document.getElementById('attendanceTableContainer');

    if (records.length === 0) {
      tbody.innerHTML = '';
      tableContainer.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    tableContainer.style.display = 'block';

    tbody.innerHTML = records.map((r, idx) => {
      const time = new Date(r.check_in_time.replace(' ', 'T'));
      const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const shiftClass = r.shift === 'morning' ? 'shift-morning' : 'shift-day';
      const shiftLabel = r.shift === 'morning' ? '🌅 Morning' : '☀️ Day';

      const photoSrc = r.avatar_path || r.photo_url;
      const avatarHtml = photoSrc
        ? `<img src="${photoSrc}" class="attendance-avatar-img" alt="${escapeHtml(r.full_name)}" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'attendance-avatar-initials\\'>${getInitials(r.full_name)}</span>';">`
        : `<span class="attendance-avatar-initials">${getInitials(r.full_name)}</span>`;

      return `
        <tr class="fade-in clickable-row" style="animation-delay:${idx * 0.02}s">
          <td style="color:var(--text-muted); font-size:13px; text-align:center;">${idx + 1}</td>
          <td>
            <div class="attendance-member-link" onclick="viewMemberProfile(${r.member_id}, 'attendance')" title="Click to view ${escapeHtml(r.full_name)}'s profile">
              <div class="attendance-avatar-container">
                ${avatarHtml}
              </div>
              <div>
                <div class="member-name" style="font-weight:600; color:var(--text-primary); font-size:14px;">${escapeHtml(r.full_name)}</div>
                ${r.member_code ? `<span style="font-size:11px; color:var(--text-muted);">${escapeHtml(r.member_code)}</span>` : ''}
              </div>
            </div>
          </td>
          <td onclick="viewMemberProfile(${r.member_id}, 'attendance')" style="cursor:pointer;">${escapeHtml(r.phone)}</td>
          <td onclick="viewMemberProfile(${r.member_id}, 'attendance')" style="cursor:pointer; font-weight:600;">${timeStr}</td>
          <td onclick="viewMemberProfile(${r.member_id}, 'attendance')" style="cursor:pointer;"><span class="badge ${shiftClass}">${shiftLabel}</span></td>
          <td class="actions-cell" onclick="event.stopPropagation()">
            <button class="action-btn delete btn-delete-attendance" data-id="${r.id}" title="Remove Record">
              <i class="fas fa-trash">🗑️</i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach delete handlers
    tbody.querySelectorAll('.btn-delete-attendance').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to remove this attendance record?')) {
          try {
            const res = await fetch(`/api/attendance/${btn.dataset.id}`, { method: 'DELETE' });
            const data = await res.json();
            if (res.ok && data.success) {
              showToast('Attendance record removed', 'success');
              loadAttendanceSummary(); // Reload to update counts and table
            } else {
              showToast(data.message || 'Failed to remove record', 'error');
            }
          } catch (err) {
            showToast('Failed to connect to server', 'error');
          }
        }
      });
    });
  } catch { showToast('Failed to load attendance', 'error'); }
}

// Shift filter buttons
document.querySelectorAll('.shift-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.shift-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentShiftFilter = btn.dataset.shift;
    loadAttendance();
  });
});

// Check-in search with autocomplete
let checkinSearchTimeout;
let allMembersCache = [];

function setupCheckinSearch() {
  const input = document.getElementById('checkinSearch');
  const suggestions = document.getElementById('checkinSuggestions');

  input.addEventListener('input', () => {
    clearTimeout(checkinSearchTimeout);
    const query = input.value.trim();
    document.getElementById('checkinMemberId').value = '';

    if (query.length < 2) {
      suggestions.innerHTML = '';
      suggestions.style.display = 'none';
      return;
    }

    checkinSearchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/members?search=${encodeURIComponent(query)}&status=all`);
        allMembersCache = await res.json();

        if (allMembersCache.length === 0) {
          suggestions.innerHTML = '<div class="suggestion-item no-result">No members found</div>';
          suggestions.style.display = 'block';
          return;
        }

        suggestions.innerHTML = allMembersCache.slice(0, 8).map(m => {
          const photoSrc = m.avatar_path || m.photo_url;
          const avatarHtml = photoSrc
            ? `<img src="${photoSrc}" style="width:30px; height:30px; border-radius:50%; object-fit:cover; flex-shrink:0;">`
            : `<div style="width:30px; height:30px; border-radius:50%; background:var(--accent-glow); color:var(--accent); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; flex-shrink:0;">${getInitials(m.full_name)}</div>`;
          return `
            <div class="suggestion-item" data-id="${m.id}" data-name="${escapeHtml(m.full_name)}" style="display:flex; align-items:center; gap:10px;">
              ${avatarHtml}
              <div style="flex:1;">
                <span class="suggestion-name" style="font-weight:600;">${escapeHtml(m.full_name)}</span>
                <span class="suggestion-phone" style="margin-left:8px; font-size:12px; color:var(--text-muted);">${m.phone}</span>
              </div>
              <span class="badge ${m.status}" style="font-size:10px;">${m.status}</span>
            </div>
          `;
        }).join('');
        suggestions.style.display = 'block';

        suggestions.querySelectorAll('.suggestion-item[data-id]').forEach(item => {
          item.addEventListener('click', () => {
            input.value = item.dataset.name;
            document.getElementById('checkinMemberId').value = item.dataset.id;
            suggestions.style.display = 'none';
          });
        });
      } catch { suggestions.style.display = 'none'; }
    }, 250);
  });

  // Hide suggestions on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.checkin-form')) {
      suggestions.style.display = 'none';
    }
  });
}

// Sync Device button
document.getElementById('syncHikvisionBtn').addEventListener('click', async () => {
  const btn = document.getElementById('syncHikvisionBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Syncing...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/hikvision/sync');
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Successfully synced attendance from device', 'success');
      loadAttendanceSummary();
      loadAttendance();
    } else {
      showToast(data.message || 'Failed to sync device', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});

// Check-in button
document.getElementById('checkinBtn').addEventListener('click', async () => {
  const memberId = document.getElementById('checkinMemberId').value;
  const searchVal = document.getElementById('checkinSearch').value.trim();

  if (!memberId && !searchVal) {
    showToast('Please search and select a member first', 'error');
    return;
  }

  const body = memberId ? { member_id: parseInt(memberId) } : { phone: searchVal };

  try {
    const res = await fetch('/api/attendance/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Check-in failed', res.status === 409 ? 'info' : 'error');
      return;
    }

    showToast(data.message || 'Checked in successfully!');
    document.getElementById('checkinSearch').value = '';
    document.getElementById('checkinMemberId').value = '';
    document.getElementById('checkinSuggestions').style.display = 'none';

    // Refresh attendance data
    await loadAttendanceSummary();
    await loadAttendance();
  } catch { showToast('Failed to check in member', 'error'); }
});

// ═══════════════════════════════════════════════
// SETTINGS - Change Password
// ═══════════════════════════════════════════════

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }

  try {
    const res = await fetch('/api/admin/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Password updated successfully!');
    e.target.reset();
  } catch (err) { showToast(err.message || 'Failed to update password', 'error'); }
});

// ═══════════════════════════════════════════════
// SETTINGS - Hikvision Hardware
// ═══════════════════════════════════════════════

async function loadHikvisionSettings() {
  try {
    const res = await fetch('/api/hikvision/settings');
    const config = await res.json();
    if (config.ip) document.getElementById('hikIp').value = config.ip;
    if (config.port) document.getElementById('hikPort').value = config.port;
    if (config.username) document.getElementById('hikUsername').value = config.username;
    if (config.password) document.getElementById('hikPassword').value = config.password;
  } catch (err) {
    console.error('Failed to load Hikvision settings', err);
  }
}

async function loadSmsDiagnostics() {
  try {
    const res = await fetch('/api/sms/diagnose');
    const data = await res.json();
    document.getElementById('diagnoseIp').textContent = data.publicIp || 'Unknown';
  } catch (err) {
    document.getElementById('diagnoseIp').textContent = 'Error loading IP';
  }
}

async function loadSmsSettings() {
  try {
    const res = await fetch('/api/sms/settings');
    const data = await res.json();
    if (data.token) document.getElementById('smsAuthToken').value = data.token;
  } catch (err) {
    console.error('Failed to load SMS settings', err);
  }
}

// Load settings when the settings page is opened
document.getElementById('nav-settings').addEventListener('click', () => {
  loadHikvisionSettings();
  loadSmsSettings();
  loadSmsDiagnostics();
  loadPackages();
});

// Settings Sub-Tabs Switching
document.querySelectorAll('.settings-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.settings-content-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-settings-tab');
    document.getElementById(`settings-pane-${tabId}`)?.classList.add('active');
  });
});

document.getElementById('smsSettingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = document.getElementById('smsAuthToken').value;

  try {
    const res = await fetch('/api/sms/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save SMS settings');
    showToast('Aakash SMS Token saved successfully!', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to save SMS settings', 'error');
  }
});

document.getElementById('hikvisionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ip = document.getElementById('hikIp').value.trim();
  const port = document.getElementById('hikPort').value.trim();
  const username = document.getElementById('hikUsername').value.trim();
  const password = document.getElementById('hikPassword').value;

  try {
    const res = await fetch('/api/hikvision/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port, username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message);
    showToast('Hikvision settings saved successfully!');
  } catch (err) {
    showToast(err.message || 'Failed to save settings', 'error');
  }
});

document.getElementById('hikTestBtn').addEventListener('click', async () => {
  const ip = document.getElementById('hikIp').value.trim();
  const port = document.getElementById('hikPort').value.trim();
  const username = document.getElementById('hikUsername').value.trim();
  const password = document.getElementById('hikPassword').value;

  if (!ip) return showToast('Device IP is required to test connection', 'error');

  const btn = document.getElementById('hikTestBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Testing...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/hikvision/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port, username, password })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'Connection successful!', 'success');
    } else {
      showToast(data.message || 'Connection failed', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to server', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});

document.getElementById('hikBackupBiometricsBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('hikBackupBiometricsBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Backing up biometrics from device...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/hikvision/backup-biometrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ Successfully backed up ${data.totalBackedUp || 0} biometric profile(s) from device to database!`, 'success');
    } else {
      showToast(data.message || 'Failed to backup biometrics', 'error');
    }
  } catch (err) {
    showToast('Network error while backing up biometrics', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function toTitleCase(str) {
  if (!str) return '';
  return str.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

// ─── Real-Time Attendance via SSE ──────────────
const evtSource = new EventSource('/api/attendance/stream');
evtSource.onmessage = function(event) {
  try {
    const data = JSON.parse(event.data);
    const memberName = toTitleCase(data.member_name);
    if (data.duplicate) {
      showToast(`${memberName} already checked in for ${data.shift} shift`, 'info');
    } else {
      showToast(`${memberName} checked in! (${data.shift} shift)`, 'success');
      
      // If we are on the attendance page, refresh the list
      const attendancePage = document.getElementById('page-attendance');
      if (attendancePage && attendancePage.classList.contains('active')) {
        loadAttendanceSummary();
        loadAttendance();
      }
      
      // If on overview page, refresh dashboard stats
      const overviewPage = document.getElementById('page-overview');
      if (overviewPage && overviewPage.classList.contains('active')) {
        loadDashboard();
      }
    }
  } catch (err) {
    console.error('Error parsing SSE data:', err);
  }
};

// ═══════════════════════════════════════════════
// SETTINGS - Aakash SMS Diagnostics
// ═══════════════════════════════════════════════

document.getElementById('smsDiagnoseBtn').addEventListener('click', async () => {
  const resultDiv = document.getElementById('diagnoseResult');
  resultDiv.style.display = 'block';
  resultDiv.style.background = 'rgba(255, 255, 255, 0.05)';
  resultDiv.style.borderLeft = '4px solid var(--purple)';
  resultDiv.style.color = 'var(--text-light)';
  resultDiv.innerHTML = '⏳ Running server diagnostic check...';

  try {
    const res = await fetch('/api/sms/diagnose');
    const data = await res.json();

    let report = `<strong>AAKASH SMS DIAGNOSTIC REPORT</strong>\n`;
    report += `========================================\n`;
    report += `📡 Gym Computer Public IP: <span style="color:var(--purple); font-weight:bold;">${data.publicIp}</span>\n`;
    report += `🔑 Env Token Status:      ${data.configured ? '✅ LOADED' : '❌ NOT LOADED (.env missing or empty)'}\n`;
    if (data.configured) {
      report += `🔑 Token Preview:          ${data.tokenPreview}\n`;
    }
    report += `========================================\n`;
    report += `📝 <strong>Troubleshooting Steps:</strong>\n`;
    report += `1. Open your <strong>Aakash SMS Dashboard</strong> in a browser.\n`;
    report += `2. Navigate to your IP whitelisting settings.\n`;
    report += `3. Add this exact IP address: <span style="color:var(--purple); font-weight:bold; font-size:14px; background:rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${data.publicIp}</span>\n`;
    report += `4. Click Save/Whitelist IP.\n`;
    report += `5. Try sending a Test SMS below to verify it works!`;

    resultDiv.innerHTML = report;
  } catch (err) {
    resultDiv.innerHTML = `<span style="color:var(--red);">❌ Diagnostic failed: ${err.message}</span>`;
  }
});

document.getElementById('smsTestBtn').addEventListener('click', async () => {
  const phone = prompt('Enter a phone number to send a diagnostic test SMS (e.g., 98XXXXXXXX):');
  if (!phone) return;

  const resultDiv = document.getElementById('diagnoseResult');
  resultDiv.style.display = 'block';
  resultDiv.style.background = 'rgba(255, 255, 255, 0.05)';
  resultDiv.style.borderLeft = '4px solid var(--yellow)';
  resultDiv.style.color = 'var(--text-light)';
  resultDiv.innerHTML = '⏳ Initiating test SMS...';

  try {
    const res = await fetch('/api/sms/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      resultDiv.style.borderLeft = '4px solid var(--green)';
      resultDiv.innerHTML = `<span style="color:var(--green); font-weight:bold;">✅ SMS SENT SUCCESSFULLY!</span>\n\n` +
        `Response from Aakash SMS API:\n` +
        `----------------------------------------\n` +
        JSON.stringify(data.details, null, 2);
      showToast('Test SMS sent successfully!', 'success');
    } else {
      resultDiv.style.borderLeft = '4px solid var(--red)';
      let errMsg = data.error || 'Connection failed';
      let detailsText = data.details ? JSON.stringify(data.details, null, 2) : '';

      resultDiv.innerHTML = `<span style="color:var(--red); font-weight:bold;">❌ SMS SENDING FAILED</span>\n` +
        `Error: <span style="font-weight:bold; color:var(--red);">${errMsg}</span>\n\n` +
        `💡 <strong>Likely cause:</strong> Your current Gym Computer public IP is not whitelisted on your Aakash SMS dashboard.\n` +
        `Please copy the IP at the top and whitelist it in your Aakash SMS panel.\n\n` +
        (detailsText ? `API Response Details:\n----------------------------------------\n${detailsText}` : '');
      
      showToast(errMsg, 'error');
    }
  } catch (err) {
    resultDiv.style.borderLeft = '4px solid var(--red)';
    resultDiv.innerHTML = `<span style="color:var(--red); font-weight:bold;">❌ CONNECTION ERROR</span>\n` +
      `Failed to connect to the backend server or Aakash SMS API: ${err.message}`;
    showToast('Failed to connect to server', 'error');
  }
});

// ─── Initial Load ─────────────────────────────
loadDashboard();

// ═══════════════════════════════════════════════
// FLOATING CHATBOT WIDGET
// ═══════════════════════════════════════════════
(function() {
  const trigger = document.getElementById('chatbotTrigger');
  const windowEl = document.getElementById('chatbotWindow');
  const closeBtn = document.getElementById('chatbotClose');
  const sendBtn = document.getElementById('chatbotSend');
  const inputEl = document.getElementById('chatbotInput');
  const messagesContainer = document.getElementById('chatbotMessages');

  let history = [
    { role: 'assistant', content: 'Hello! I am your Fitness Hub AI Assistant. How can I help you manage your gym today?' }
  ];

  // Toggle chat window visibility
  trigger.addEventListener('click', () => {
    windowEl.classList.toggle('open');
    if (windowEl.classList.contains('open')) {
      inputEl.focus();
      scrollToBottom();
    }
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    windowEl.classList.remove('open');
  });

  // Scroll messages to bottom
  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Escape HTML helper
  function safeEscape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Append a message to UI
  function appendMessage(role, content) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${role}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = safeEscape(content).replace(/\n/g, '<br>');
    
    msgDiv.appendChild(contentDiv);
    messagesContainer.appendChild(msgDiv);
    scrollToBottom();
  }

  // Send message implementation
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;

    // Append User message
    appendMessage('user', text);
    history.push({ role: 'user', content: text });
    inputEl.value = '';
    
    // Show typing indicator
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    typingIndicator.id = 'chatbotTypingIndicator';
    typingIndicator.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(typingIndicator);
    scrollToBottom();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages: history })
      });

      // Remove typing indicator
      const indicator = document.getElementById('chatbotTypingIndicator');
      if (indicator) indicator.remove();

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const serverError = errorData.error || `HTTP Error ${res.status}`;
        appendMessage('bot', `Error: ${serverError}`);
        return;
      }

      const data = await res.json();
      const botReply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        ? data.choices[0].message.content
        : 'Sorry, I couldn\'t process that request.';

      appendMessage('bot', botReply);
      history.push({ role: 'assistant', content: botReply });
    } catch (err) {
      console.error('[Chatbot UI Error]:', err);
      const indicator = document.getElementById('chatbotTypingIndicator');
      if (indicator) indicator.remove();
      appendMessage('bot', 'Error: Unable to connect to the assistant server.');
    }
  }

  // Event Listeners
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
})();

// ═══════════════════════════════════════════════
// LOGISTICS / INVENTORY
// ═══════════════════════════════════════════════

async function safeFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let errMsg = `Request failed with status ${res.status}`;
    if (contentType.includes('application/json')) {
      const errData = await res.json();
      errMsg = errData.error || errMsg;
    } else {
      const text = await res.text();
      if (text.startsWith('<')) {
        const titleMatch = text.match(/<title>(.*?)<\/title>/i);
        const preMatch = text.match(/<pre>(.*?)<\/pre>/i);
        if (preMatch && preMatch[1]) {
          errMsg = preMatch[1];
        } else if (titleMatch && titleMatch[1]) {
          errMsg = titleMatch[1];
        }
      } else if (text.length < 100) {
        errMsg = text;
      }
    }
    throw new Error(errMsg);
  }
  if (!contentType.includes('application/json')) {
    throw new Error('Server returned non-JSON response');
  }
  return await res.json();
}

let logisticsSearchTimeout;
document.getElementById('logisticsSearchInput').addEventListener('input', () => {
  clearTimeout(logisticsSearchTimeout);
  logisticsSearchTimeout = setTimeout(() => loadLogistics(), 300);
});

// Setup drag and drop for image upload
const dropzone = document.getElementById('logisticsDropzone');
const fileInput = document.getElementById('logisticsImageInput');
const imgPreview = document.getElementById('logisticsImagePreview');
const dropzoneText = dropzone.querySelector('.dropzone-text');

dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('active');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('active');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('active');
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    handleImagePreview(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) {
    handleImagePreview(e.target.files[0]);
  }
});

function handleImagePreview(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    imgPreview.src = e.target.result;
    imgPreview.style.display = 'block';
    dropzoneText.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function clearLogisticsImagePreview() {
  fileInput.value = '';
  imgPreview.src = '';
  imgPreview.style.display = 'none';
  dropzoneText.style.display = 'block';
}

// Add Item Modal
const logisticsModal = document.getElementById('logisticsModal');
document.getElementById('addLogisticsBtn').addEventListener('click', () => {
  document.getElementById('logisticsModalTitle').textContent = 'Add New Product';
  document.getElementById('logisticsModalSubmit').textContent = 'Add Product';
  document.getElementById('logisticsForm').reset();
  document.getElementById('logisticsId').value = '';
  document.getElementById('logisticsQuantityGroup').style.display = 'block';
  document.getElementById('logisticsQuantity').required = true;
  clearLogisticsImagePreview();
  logisticsModal.classList.add('active');
});

// Modal close buttons
document.getElementById('logisticsModalClose').addEventListener('click', () => logisticsModal.classList.remove('active'));
document.getElementById('logisticsModalCancel').addEventListener('click', () => logisticsModal.classList.remove('active'));
logisticsModal.addEventListener('click', (e) => { if (e.target === logisticsModal) logisticsModal.classList.remove('active'); });

// Submit Add/Edit Product
document.getElementById('logisticsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const id = document.getElementById('logisticsId').value;
  const name = document.getElementById('logisticsName').value.trim();
  const price = document.getElementById('logisticsPrice').value;
  
  const payload = {
    name,
    price: parseFloat(price)
  };

  if (!id) {
    const quantity = document.getElementById('logisticsQuantity').value;
    payload.quantity = parseInt(quantity) || 0;
  }

  if (fileInput.files.length) {
    const file = fileInput.files[0];
    const base64 = await toBase64(file);
    payload.image_base64 = base64;
  }

  try {
    const url = id ? `/api/logistics/${id}` : '/api/logistics';
    const method = id ? 'PUT' : 'POST';
    
    await safeFetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    showToast(id ? 'Product updated successfully' : 'Product added successfully', 'success');
    logisticsModal.classList.remove('active');
    loadLogistics();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// Load Logistics Page
async function loadLogistics() {
  const search = document.getElementById('logisticsSearchInput').value;
  try {
    const products = await safeFetchJson(`/api/logistics?search=${encodeURIComponent(search)}`);
    renderLogistics(products);

    const transactions = await safeFetchJson('/api/logistics/transactions?limit=15');
    renderLogisticsTransactions(transactions);
  } catch (err) {
    showToast('Failed to load logistics: ' + err.message, 'error');
  }
}

// Render Products
function renderLogistics(products) {
  const grid = document.getElementById('logisticsGrid');
  const empty = document.getElementById('emptyLogistics');
  
  if (products.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  
  empty.style.display = 'none';
  
  grid.innerHTML = products.map(p => {
    let stockClass = 'stock-in';
    let stockLabel = 'In Stock';
    
    if (p.quantity === 0) {
      stockClass = 'stock-out';
      stockLabel = 'Out of Stock';
    } else if (p.quantity <= 5) {
      stockClass = 'stock-low';
      stockLabel = `Low Stock (${p.quantity})`;
    } else {
      stockLabel = `In Stock (${p.quantity})`;
    }

    const imgTag = p.image_path 
      ? `<img src="${p.image_path}" class="logistics-card-img" alt="${escapeHtml(p.name)}">`
      : `<div class="logistics-card-img-placeholder">📦</div>`;

    return `
      <div class="logistics-card">
        <button class="logistics-card-edit-btn" onclick="editLogistics(${p.id})" title="Edit details">✏️</button>
        <div class="logistics-card-img-wrapper">
          ${imgTag}
        </div>
        <div class="logistics-card-info">
          <div class="logistics-card-name">${escapeHtml(p.name)}</div>
          <div class="logistics-card-price">Rs. ${parseFloat(p.price).toFixed(2)}</div>
          <div class="logistics-card-stock-row">
            <span class="badge ${stockClass}">${stockLabel}</span>
          </div>
        </div>
        <div class="logistics-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="showRestockModal(${p.id}, '${escapeHtml(p.name)}', ${p.quantity})">➕ Restock</button>
          <button class="btn btn-primary btn-sm" onclick="showSellModal(${p.id}, '${escapeHtml(p.name)}', ${p.quantity})" ${p.quantity === 0 ? 'disabled' : ''}>💸 Sell</button>
        </div>
        <button class="action-btn delete" onclick="deleteLogistics(${p.id}, '${escapeHtml(p.name)}')" title="Delete product" style="position:absolute; bottom:52px; right:12px; width:28px; height:28px; font-size:12px; padding:0; display:flex; align-items:center; justify-content:center;">🗑️</button>
      </div>
    `;
  }).join('');
}

// Render Transactions Timeline
function renderLogisticsTransactions(transactions) {
  const container = document.getElementById('logisticsTransactionList');
  if (transactions.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">No transactions recorded yet.</div>`;
    return;
  }

  container.innerHTML = transactions.map(t => {
    const isRestock = t.type === 'restock';
    const classType = isRestock ? 'restock' : 'sale';
    const icon = isRestock ? '📥' : '📤';
    const actionLabel = isRestock ? 'Restocked' : 'Sold';
    const qtySign = isRestock ? '+' : '-';
    
    return `
      <div class="transaction-item ${classType}">
        <div class="transaction-icon">${icon}</div>
        <div class="transaction-info">
          <div class="title">${actionLabel} ${t.quantity} ${escapeHtml(t.product_name)}</div>
          <div class="meta">
            ${qtySign}${t.quantity} items | Rs. ${(t.price * t.quantity).toFixed(0)} | ${formatDate(t.date)}
          </div>
          ${t.notes ? `<div class="notes">"${escapeHtml(t.notes)}"</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Edit Product Mode
async function editLogistics(id) {
  try {
    const products = await safeFetchJson(`/api/logistics`);
    const product = products.find(p => p.id === id);
    if (!product) return;

    document.getElementById('logisticsModalTitle').textContent = 'Edit Product';
    document.getElementById('logisticsModalSubmit').textContent = 'Save Changes';
    document.getElementById('logisticsId').value = product.id;
    document.getElementById('logisticsName').value = product.name;
    document.getElementById('logisticsPrice').value = product.price;
    document.getElementById('logisticsQuantityGroup').style.display = 'none';
    document.getElementById('logisticsQuantity').required = false;

    if (product.image_path) {
      imgPreview.src = product.image_path;
      imgPreview.style.display = 'block';
      dropzoneText.style.display = 'none';
    } else {
      clearLogisticsImagePreview();
    }

    logisticsModal.classList.add('active');
  } catch (err) {
    showToast('Failed to fetch product details: ' + err.message, 'error');
  }
}

// Sell Modal Operations
const sellModal = document.getElementById('logisticsSellModal');
function showSellModal(id, name, stock) {
  document.getElementById('logisticsSellId').value = id;
  document.getElementById('logisticsSellProductName').textContent = name;
  document.getElementById('logisticsSellProductStock').textContent = `Available stock: ${stock}`;
  document.getElementById('logisticsSellQuantity').value = '';
  document.getElementById('logisticsSellQuantity').max = stock;
  document.getElementById('logisticsSellNotes').value = '';
  sellModal.classList.add('active');
}

document.getElementById('logisticsSellModalClose').addEventListener('click', () => sellModal.classList.remove('active'));
document.getElementById('logisticsSellModalCancel').addEventListener('click', () => sellModal.classList.remove('active'));
sellModal.addEventListener('click', (e) => { if (e.target === sellModal) sellModal.classList.remove('active'); });

document.getElementById('logisticsSellForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('logisticsSellId').value;
  const quantity = parseInt(document.getElementById('logisticsSellQuantity').value);
  const notes = document.getElementById('logisticsSellNotes').value.trim();

  try {
    await safeFetchJson(`/api/logistics/${id}/sell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity, notes })
    });

    showToast('Sale recorded successfully', 'success');
    sellModal.classList.remove('active');
    loadLogistics();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Restock Modal Operations
const restockModal = document.getElementById('logisticsRestockModal');
function showRestockModal(id, name, stock) {
  document.getElementById('logisticsRestockId').value = id;
  document.getElementById('logisticsRestockProductName').textContent = name;
  document.getElementById('logisticsRestockProductStock').textContent = `Current stock: ${stock}`;
  document.getElementById('logisticsRestockQuantity').value = '';
  document.getElementById('logisticsRestockNotes').value = '';
  restockModal.classList.add('active');
}

document.getElementById('logisticsRestockModalClose').addEventListener('click', () => restockModal.classList.remove('active'));
document.getElementById('logisticsRestockModalCancel').addEventListener('click', () => restockModal.classList.remove('active'));
restockModal.addEventListener('click', (e) => { if (e.target === restockModal) restockModal.classList.remove('active'); });

document.getElementById('logisticsRestockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('logisticsRestockId').value;
  const quantity = parseInt(document.getElementById('logisticsRestockQuantity').value);
  const notes = document.getElementById('logisticsRestockNotes').value.trim();

  try {
    await safeFetchJson(`/api/logistics/${id}/restock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity, notes })
    });

    showToast('Stock replenished successfully', 'success');
    restockModal.classList.remove('active');
    loadLogistics();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Delete Action Bridge
function confirmAction(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmDlg.classList.add('active');
  confirmCallback = callback;
}

function deleteLogistics(id, name) {
  confirmAction(
    `Delete ${name}?`,
    `Are you sure you want to remove this product and delete its transaction history?`,
    async () => {
      try {
        await safeFetchJson(`/api/logistics/${id}`, { method: 'DELETE' });
        showToast('Product deleted successfully', 'success');
        loadLogistics();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  );
}

// ─── MEMBER WEBCAM & PHOTO HANDLERS ───
let memberPhotoBase64 = null;
let memberPhotoCleared = false;
let webcamStreamTrack = null;

const memberImageInput = document.getElementById('memberImageInput');
const memberPhotoPreview = document.getElementById('memberPhotoPreview');
const memberPhotoInitials = document.getElementById('memberPhotoInitials');
const memberPhotoClearBtn = document.getElementById('memberPhotoClearBtn');

memberImageInput.addEventListener('change', async (e) => {
  if (e.target.files.length) {
    const file = e.target.files[0];
    const base64 = await toBase64(file);
    memberPhotoBase64 = base64;
    memberPhotoCleared = false;
    
    memberPhotoPreview.src = base64;
    memberPhotoPreview.style.display = 'block';
    memberPhotoInitials.style.display = 'none';
    memberPhotoClearBtn.style.display = 'flex';
  }
});

memberPhotoClearBtn.addEventListener('click', () => {
  clearMemberPhoto();
  memberPhotoCleared = true;
});

function clearMemberPhoto() {
  memberPhotoBase64 = null;
  memberPhotoCleared = false;
  memberImageInput.value = '';
  memberPhotoPreview.src = '';
  memberPhotoPreview.style.display = 'none';
  memberPhotoInitials.style.display = 'flex';
  memberPhotoInitials.textContent = '?';
  memberPhotoClearBtn.style.display = 'none';
  
  document.getElementById('photoTabUploadBtn').click();
  stopWebcam();
}

function setMemberPhotoPreview(avatarPath, fullName) {
  clearMemberPhoto();
  if (avatarPath) {
    memberPhotoPreview.src = avatarPath;
    memberPhotoPreview.style.display = 'block';
    memberPhotoInitials.style.display = 'none';
    memberPhotoClearBtn.style.display = 'flex';
  } else {
    memberPhotoPreview.style.display = 'none';
    memberPhotoInitials.style.display = 'flex';
    memberPhotoInitials.textContent = getInitials(fullName);
  }
}

async function startWebcam() {
  const video = document.getElementById('webcamStream');
  const startBtn = document.getElementById('webcamStartBtn');
  const captureBtn = document.getElementById('webcamCaptureBtn');
  const viewfinder = document.getElementById('webcamViewfinder');
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    video.srcObject = stream;
    webcamStreamTrack = stream;
    startBtn.style.display = 'none';
    captureBtn.style.display = 'inline-flex';
    if (viewfinder) viewfinder.style.display = 'block';
  } catch (err) {
    showToast('Could not access webcam: ' + err.message, 'error');
  }
}

function stopWebcam() {
  if (webcamStreamTrack) {
    webcamStreamTrack.getTracks().forEach(track => track.stop());
    webcamStreamTrack = null;
  }
  const video = document.getElementById('webcamStream');
  if (video) video.srcObject = null;
  
  const startBtn = document.getElementById('webcamStartBtn');
  const captureBtn = document.getElementById('webcamCaptureBtn');
  const viewfinder = document.getElementById('webcamViewfinder');
  if (startBtn) startBtn.style.display = 'inline-flex';
  if (captureBtn) captureBtn.style.display = 'none';
  if (viewfinder) viewfinder.style.display = 'none';
}

function captureWebcamPhoto() {
  const video = document.getElementById('webcamStream');
  const canvas = document.getElementById('webcamCanvas');
  if (!webcamStreamTrack) return;
  
  const ctx = canvas.getContext('2d');
  
  // Mirror-flip the drawn frame so it matches the mirrored preview view
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  
  const dataUrl = canvas.toDataURL('image/png');
  
  memberPhotoBase64 = dataUrl;
  memberPhotoCleared = false;
  
  memberPhotoPreview.src = dataUrl;
  memberPhotoPreview.style.display = 'block';
  memberPhotoInitials.style.display = 'none';
  memberPhotoClearBtn.style.display = 'flex';
  
  showToast('Photo captured!', 'success');
}

document.getElementById('photoTabUploadBtn').addEventListener('click', () => {
  document.getElementById('photoTabUploadBtn').classList.add('active');
  document.getElementById('photoTabWebcamBtn').classList.remove('active');
  document.getElementById('photoPaneUpload').classList.add('active');
  document.getElementById('photoPaneWebcam').classList.remove('active');
  stopWebcam();
});

document.getElementById('photoTabWebcamBtn').addEventListener('click', () => {
  document.getElementById('photoTabWebcamBtn').classList.add('active');
  document.getElementById('photoTabUploadBtn').classList.remove('active');
  document.getElementById('photoPaneWebcam').classList.add('active');
  document.getElementById('photoPaneUpload').classList.remove('active');
});

document.getElementById('webcamStartBtn').addEventListener('click', startWebcam);
document.getElementById('webcamCaptureBtn').addEventListener('click', captureWebcamPhoto);

// ─── OFFER PACKAGES MANAGEMENT ───
let customPackages = [];

async function loadPackages() {
  try {
    const res = await fetch('/api/packages');
    if (!res.ok) {
      throw new Error(`Server returned status ${res.status}`);
    }
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Server returned HTML instead of JSON. Please restart the backend server.');
    }
    customPackages = await res.json();
    
    // Render settings custom packages list table
    const tbody = document.getElementById('packagesListBody');
    const empty = document.getElementById('emptyPackagesState');
    
    if (!tbody || !empty) return;
    
    const countBadge = document.getElementById('settingsPackagesCount');
    if (countBadge) countBadge.textContent = customPackages.length;

    if (customPackages.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
    } else {
      empty.style.display = 'none';
      tbody.innerHTML = customPackages.map(p => `
        <tr>
          <td style="padding: 14px 18px;">
            <div style="font-weight: 700; color: var(--text-primary); font-size: 14px;">${escapeHtml(p.name)}</div>
          </td>
          <td style="padding: 14px 18px;">
            <span class="badge active" style="font-size: 11px;">⏱️ ${p.duration_months} Month${p.duration_months > 1 ? 's' : ''}</span>
          </td>
          <td style="padding: 14px 18px;">
            <strong style="color: #10b981; font-size: 14px;">NPR ${Number(p.price).toLocaleString()}</strong>
          </td>
          <td style="padding: 14px 18px; text-align: center;">
            <button class="action-btn delete" onclick="deletePackage(${p.id}, '${escapeHtml(p.name)}')" title="Delete Package">🗑️</button>
          </td>
        </tr>
      `).join('');
    }
    
    updateMemberPlanDropdown();
  } catch (err) {
    console.error('Failed to load packages:', err);
  }
}

function updateMemberPlanDropdown() {
  const select = document.getElementById('memberPlan');
  if (!select) return;
  
  const standardPlans = [
    { name: 'Monthly', duration: 1, price: 2000 },
    { name: 'Quarterly', duration: 3, price: 5500 },
    { name: 'Half-Yearly', duration: 6, price: 10000 },
    { name: 'Yearly', duration: 12, price: 18000 }
  ];

  let html = '';
  const currentVal = select.value;

  standardPlans.forEach(sp => {
    const matched = customPackages.find(p => p.name.toLowerCase() === sp.name.toLowerCase());
    const price = matched ? matched.price : sp.price;
    const dur = matched ? matched.duration_months : sp.duration;
    html += `<option value="${sp.name}" data-price="${price}" data-duration="${dur}">${sp.name} (${dur} Month${dur > 1 ? 's' : ''} - Rs. ${price.toLocaleString()})</option>`;
  });

  // Append other offer/custom packages
  customPackages.forEach(p => {
    const isStandard = ['monthly', 'quarterly', 'half-yearly', 'yearly'].includes(p.name.toLowerCase());
    if (!isStandard) {
      html += `<option value="${escapeHtml(p.name)}" data-price="${p.price}" data-duration="${p.duration_months}">${escapeHtml(p.name)} (${p.duration_months} Month${p.duration_months > 1 ? 's' : ''} - Rs. ${p.price.toLocaleString()})</option>`;
    }
  });

  select.innerHTML = html;
  if (currentVal) {
    select.value = currentVal;
  }
}

document.getElementById('createPackageForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('pkgName').value.trim();
  const duration_months = parseInt(document.getElementById('pkgDuration').value);
  const price = parseFloat(document.getElementById('pkgPrice').value);
  
  try {
    const res = await fetch('/api/packages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, duration_months, price })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create package');
    
    showToast('Package created successfully!', 'success');
    e.target.reset();
    loadPackages();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function deletePackage(id, name) {
  confirmAction(
    `Delete ${name}?`,
    `Are you sure you want to remove this custom membership package?`,
    async () => {
      try {
        const res = await fetch(`/api/packages/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        showToast('Package deleted successfully', 'success');
        loadPackages();
      } catch (err) {
        showToast(err.message || 'Failed to delete package', 'error');
      }
    }
  );
}

// ═══════════════════════════════════════════════
// MEMBER PROFILE & ADVANCED FINANCIAL SYSTEM
// ═══════════════════════════════════════════════

// confirmAction Utility
function confirmAction(title, message, callback) {
  confirmCallback = callback;
  deleteId = null;
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('confirmDialog').classList.add('active');
}

// Back button listener
let profilePreviousPage = 'members';

document.getElementById('btnBackToMembers')?.addEventListener('click', () => {
  navigateTo(profilePreviousPage);
});

// View Member Profile page loader
let currentProfileMemberId = null;

async function viewMemberProfile(memberId, sourcePage = null) {
  if (sourcePage) {
    profilePreviousPage = sourcePage;
  }
  const backBtn = document.getElementById('btnBackToMembers');
  if (backBtn) {
    backBtn.textContent = profilePreviousPage === 'attendance' ? '← Back to Attendance' : '← Back to Members';
  }
  currentProfileMemberId = memberId;
  try {
    const res = await fetch(`/api/members/${memberId}/profile`);
    if (!res.ok) throw new Error('Profile not found');
    const data = await res.json();
    
    const { member, currentMembership, stats, timeline } = data;
    
    // Set Profile Header
    document.getElementById('profileFullName').textContent = member.full_name;
    document.getElementById('profileMemberCode').textContent = member.member_code || `FH-${member.id.toString().padStart(6, '0')}`;
    document.getElementById('profilePhone').textContent = member.phone;
    
    // Avatar
    const avatarArea = document.getElementById('profileAvatarArea');
    const memberPhoto = member.avatar_path || member.photo_url || '/images/powerzone_logo.jpg';
    avatarArea.innerHTML = `<img src="${memberPhoto}" class="profile-avatar-img" alt="${escapeHtml(member.full_name)}" onerror="this.src='/images/powerzone_logo.jpg';">`;
    
    // Membership Status Badge
    const mBadge = document.getElementById('profileMembershipBadge');
    mBadge.className = 'badge';
    let statusClass = 'expired';
    let statusLabel = 'EXPIRED';
    if (currentMembership) {
      statusClass = currentMembership.membership_status.toLowerCase();
      statusLabel = currentMembership.membership_status === 'FROZEN' ? '❄️ FROZEN' : currentMembership.membership_status;
    }
    mBadge.classList.add(statusClass);
    mBadge.textContent = statusLabel;
    
    // Payment Status Badge
    const pBadge = document.getElementById('profilePaymentBadge');
    pBadge.style.display = 'inline-block';
    if (stats.totalOutstandingBalance === 0) {
      pBadge.style.background = 'var(--green)';
      pBadge.style.color = 'white';
      pBadge.textContent = 'PAID';
    } else {
      pBadge.style.color = 'white';
      if (currentMembership && currentMembership.payment_status === 'OVERDUE') {
        pBadge.style.background = '#ef4444';
        pBadge.textContent = `OVERDUE: NPR ${stats.totalOutstandingBalance}`;
      } else if (stats.totalAmountPaid > 0) {
        pBadge.style.background = '#f59e0b';
        pBadge.textContent = `DUE: NPR ${stats.totalOutstandingBalance}`;
      } else {
        pBadge.style.background = '#64748b';
        pBadge.textContent = `UNPAID: NPR ${stats.totalOutstandingBalance}`;
      }
    }
    
    // Metric Boxes
    document.getElementById('profileStatOutstanding').textContent = `NPR ${stats.totalOutstandingBalance.toLocaleString()}`;
    document.getElementById('profileStatExpiry').textContent = currentMembership ? formatDate(currentMembership.end_date) : (member.expiry_date ? formatDate(member.expiry_date) : 'N/A');
    document.getElementById('profileStatRenewals').textContent = `${stats.totalRenewals} Renewal${stats.totalRenewals !== 1 ? 's' : ''}`;
    
    // Wire up direct date editing when clicking on Expiry stat card
    const expCard = document.getElementById('profileStatExpiryCard');
    if (expCard) {
      expCard.onclick = () => {
        if (currentMembership) {
          openEditMembershipDatesModal(currentMembership.id, currentMembership.start_date, currentMembership.end_date, currentMembership.plan_name_snapshot);
        } else {
          editMember(member.id);
        }
      };
    }
    
    // 30-Day Attendance Metrics
    const attendance30 = data.attendance30Days || {
      daysPresent: stats.daysInLast30 || 0,
      totalDays: 30,
      attendanceRate: stats.attendanceRateLast30 || 0,
      morningShifts: 0,
      dayShifts: 0,
      lastVisit: null,
      cutoffDate: new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0],
      todayDate: new Date().toISOString().split('T')[0],
      dailyStatus: []
    };

    document.getElementById('profileStatAttendance30').textContent = `${attendance30.daysPresent} Days`;

    // Populate dedicated 30-day section
    document.getElementById('profile30dDaysCount').textContent = attendance30.daysPresent;
    document.getElementById('profile30dTotalDays').textContent = `out of last ${attendance30.totalDays} days`;
    document.getElementById('profile30dRate').textContent = `${attendance30.attendanceRate}%`;
    document.getElementById('profile30dMorning').textContent = `${attendance30.morningShifts} days`;
    document.getElementById('profile30dDay').textContent = `${attendance30.dayShifts} days`;

    if (attendance30.lastVisit) {
      document.getElementById('profile30dLastVisit').textContent = formatDateTime(attendance30.lastVisit.check_in_time);
    } else {
      document.getElementById('profile30dLastVisit').textContent = 'No visits recorded';
    }

    if (attendance30.cutoffDate && attendance30.todayDate) {
      document.getElementById('profileAttendancePeriod').textContent = 
        `Last 30 Days (${formatDate(attendance30.cutoffDate)} - ${formatDate(attendance30.todayDate)})`;
    }

    document.getElementById('profile30dProgressFill').style.width = `${Math.min(100, attendance30.attendanceRate)}%`;
    document.getElementById('profile30dProgressText').textContent = 
      `${attendance30.daysPresent} / ${attendance30.totalDays} Days Attended (${attendance30.attendanceRate}%)`;

    const cBadge = document.getElementById('profile30dConsistencyBadge');
    if (attendance30.daysPresent >= 20) {
      cBadge.className = 'badge active';
      cBadge.textContent = '🔥 High Consistency';
    } else if (attendance30.daysPresent >= 10) {
      cBadge.className = 'badge warning';
      cBadge.textContent = '⚡ Regular Consistency';
    } else {
      cBadge.className = 'badge expired';
      cBadge.textContent = '⚠️ Low Consistency';
    }

    // Render 30-Day Activity Calendar Grid
    const calendarGrid = document.getElementById('profile30dCalendarGrid');
    if (calendarGrid && attendance30.dailyStatus) {
      calendarGrid.innerHTML = attendance30.dailyStatus.map(d => {
        const shiftEmoji = d.shift === 'morning' ? '🌅' : (d.shift === 'day' ? '☀️' : '');
        let tooltipText = '';
        if (d.attended) {
          const tOnly = d.checkInTime && d.checkInTime.includes(' ') ? d.checkInTime.split(' ')[1] : '';
          tooltipText = `${d.monthName} ${d.dayNum} (${d.dayName}): Present (${d.shift}) ${tOnly}`;
        } else {
          tooltipText = `${d.monthName} ${d.dayNum} (${d.dayName}): Absent`;
        }

        return `
          <div class="attendance-day-tile ${d.attended ? 'attended' : 'absent'} ${d.isToday ? 'is-today' : ''}">
            <span class="day-tile-date">${d.dayNum}</span>
            <span class="day-tile-sub">${d.dayName}</span>
            <span class="day-tile-status-icon">${d.attended ? (shiftEmoji || '✓') : '·'}</span>
            <div class="day-tooltip">${tooltipText}${d.isToday ? ' (Today)' : ''}</div>
          </div>
        `;
      }).join('');
    }

    // Wire up "View Detailed Log ->" button
    const btnViewLog = document.getElementById('btnViewAttendanceLogTab');
    if (btnViewLog) {
      btnViewLog.onclick = () => {
        const attTab = document.querySelector('.profile-tab[data-tab="attendance"]');
        if (attTab) attTab.click();
      };
    }

    // Personal Details Tab data
    document.getElementById('detailJoinDate').textContent = formatDate(member.first_joining_date || member.join_date);
    document.getElementById('detailDOB').textContent = member.date_of_birth ? formatDate(member.date_of_birth) : 'N/A';
    document.getElementById('detailGender').textContent = member.gender || 'N/A';
    document.getElementById('detailEmail').textContent = member.email || 'N/A';
    document.getElementById('detailAddress').textContent = member.address || 'N/A';
    document.getElementById('detailEmergencyContact').textContent = member.emergency_contact_name || 'N/A';
    document.getElementById('detailEmergencyPhone').textContent = member.emergency_contact_phone || 'N/A';
    
    // Bind action buttons click listeners
    // Record Pay dues quick fill
    const payBtn = document.getElementById('btnRecordPayment');
    const unpaidList = data.unpaidMemberships || [];
    if (unpaidList.length > 0) {
      const targetMs = unpaidList[0];
      payBtn.style.display = 'inline-block';
      payBtn.onclick = () => openRecordPaymentModal(member.id, targetMs.id, targetMs.plan_name_snapshot, targetMs.remaining_balance, member.full_name);
    } else {
      payBtn.style.display = 'none';
    }
    
    // Renew Membership
    document.getElementById('btnRenewMembership').onclick = () => openRenewMembershipModal(member.id, currentMembership);
    
    // Freeze & Unfreeze Membership Actions
    const freezeBtn = document.getElementById('btnFreezeMembership');
    const unfreezeBtn = document.getElementById('btnUnfreezeMembership');
    const freezeBanner = document.getElementById('profileFreezeBanner');

    if (currentMembership && currentMembership.membership_status === 'ACTIVE') {
      freezeBtn.style.display = 'inline-block';
      freezeBtn.onclick = () => openFreezeMembershipModal(currentMembership.id, currentMembership.end_date);
      if (unfreezeBtn) unfreezeBtn.style.display = 'none';
      if (freezeBanner) freezeBanner.style.display = 'none';
    } else if (currentMembership && currentMembership.membership_status === 'FROZEN') {
      freezeBtn.style.display = 'none';
      if (unfreezeBtn) {
        unfreezeBtn.style.display = 'inline-block';
        unfreezeBtn.onclick = () => openUnfreezeMembershipModal(
          currentMembership.id,
          member.full_name,
          currentMembership.freeze_start_date,
          currentMembership.original_end_date || currentMembership.end_date
        );
      }
      if (freezeBanner) {
        freezeBanner.style.display = 'block';
        const startText = currentMembership.freeze_start_date ? formatDate(currentMembership.freeze_start_date) : formatDate(currentMembership.created_at);
        const endText = currentMembership.freeze_end_date ? formatDate(currentMembership.freeze_end_date) : 'Scheduled Date';
        document.getElementById('freezeBannerStart').textContent = startText;
        document.getElementById('freezeBannerEnd').textContent = endText;
        document.getElementById('freezeBannerReason').textContent = currentMembership.freeze_reason || 'Personal request';
        
        const bannerUnfreezeBtn = document.getElementById('btnBannerUnfreeze');
        if (bannerUnfreezeBtn) {
          bannerUnfreezeBtn.onclick = () => openUnfreezeMembershipModal(
            currentMembership.id,
            member.full_name,
            currentMembership.freeze_start_date,
            currentMembership.original_end_date || currentMembership.end_date
          );
        }
      }
    } else {
      freezeBtn.style.display = 'none';
      if (unfreezeBtn) unfreezeBtn.style.display = 'none';
      if (freezeBanner) freezeBanner.style.display = 'none';
    }
    
    // Edit Member Profile
    document.getElementById('btnEditMemberProfile').onclick = () => editMember(member.id);
    
    // Send SMS from Member Profile
    const smsProfileBtn = document.getElementById('btnProfileSendSms');
    if (smsProfileBtn) {
      smsProfileBtn.onclick = () => sendNotification(member.id, 'manual_reminder');
    }

    // Force Expire Membership (Test Button)
    const expireBtn = document.getElementById('btnExpireMembership');
    if (expireBtn) {
      if (member.status === 'expired') {
        expireBtn.textContent = '⚡ Expired (Re-test)';
        expireBtn.title = 'Membership is already expired. Click to re-run test expiry & device revocation.';
      } else {
        expireBtn.textContent = '⚡ Expire (Test)';
        expireBtn.title = 'Force Expire Membership for Testing';
      }
      expireBtn.onclick = () => triggerTestExpiry(member.id, member.full_name);
    }
    
    // Set up tabs switching
    const tabs = document.querySelectorAll('.profile-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadProfileTabContent(tab.dataset.tab, member.id, timeline);
      };
    });
    
    // Active Overview Tab initially
    document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.profile-tab[data-tab="overview"]').classList.add('active');
    loadProfileTabContent('overview', member.id, timeline);
    
    // Switch Page View to Member Profile
    navigateToProfileView();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function navigateToProfileView() {
  navItems.forEach(n => n.classList.remove('active'));
  pages.forEach(p => p.classList.remove('active'));
  document.getElementById('nav-members').classList.add('active');
  document.getElementById('page-member-profile').classList.add('active');
}

// Render tab contents dynamically
function loadProfileTabContent(tabName, memberId, timeline = []) {
  const panes = document.querySelectorAll('.profile-tab-content');
  panes.forEach(p => p.classList.remove('active'));
  document.getElementById(`pane-${tabName}`).classList.add('active');
  
  if (tabName === 'overview') {
    const timelineContainer = document.getElementById('profileActivityTimeline');
    if (timeline.length === 0) {
      timelineContainer.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding-left:10px;">No recorded activity logs.</div>';
      return;
    }
    
    timelineContainer.innerHTML = timeline.map(log => `
      <div class="timeline-item ${log.type}">
        <div class="timeline-item-dot"></div>
        <div class="timeline-item-content">
          <div class="timeline-item-date">${formatDateTime(log.date)}</div>
          <div class="timeline-item-text">${escapeHtml(log.message)}</div>
        </div>
      </div>
    `).join('');
  } 
  else if (tabName === 'memberships') {
    loadProfileMemberships(memberId);
  } 
  else if (tabName === 'payments') {
    loadProfilePayments(memberId);
  } 
  else if (tabName === 'attendance') {
    loadProfileAttendance(memberId);
  }
}

async function loadProfileMemberships(memberId) {
  const tbody = document.getElementById('profileMembershipsBody');
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Loading memberships...</td></tr>';
  try {
    const res = await fetch(`/api/members/${memberId}/memberships`);
    const history = await res.json();
    if (history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--text-muted);">No membership records found.</td></tr>';
      return;
    }
    const memberName = document.getElementById('profileFullName')?.textContent || '';
    tbody.innerHTML = history.map(ms => {
      let discText = '-';
      if (ms.discount_type === 'FIXED') discText = `Rs. ${ms.discount_amount}`;
      else if (ms.discount_type === 'PERCENT') discText = `${ms.discount_amount}%`;
      
      const remaining = ms.remaining_balance !== undefined ? ms.remaining_balance : Math.max(0, ms.final_payable_amount - ms.total_paid);
      const remainingHtml = remaining > 0.001
        ? `<strong style="color:#ef4444;">Rs. ${remaining.toLocaleString()}</strong>`
        : `<span style="color:var(--green); font-weight:600;">Rs. 0</span>`;

      const editDatesBtn = `<button class="btn btn-outline btn-sm" onclick="openEditMembershipDatesModal(${ms.id}, '${ms.start_date}', '${ms.end_date}', '${escapeHtml(ms.plan_name_snapshot)}')" style="padding:4px 8px; font-size:11px; border-color:var(--accent); color:var(--accent); margin-left:4px;" title="Change Start and Expiry Dates">📅 Edit Dates</button>`;

      const actionHtml = `
        <div style="display:flex; gap:4px; align-items:center;">
          ${remaining > 0.001
            ? `<button class="btn btn-outline btn-sm" onclick="openRecordPaymentModal(${memberId}, ${ms.id}, '${escapeHtml(ms.plan_name_snapshot)}', ${remaining}, '${escapeHtml(memberName)}')" style="padding:4px 8px; font-size:11px; border-color:var(--green); color:var(--green);">💸 Pay Dues</button>`
            : `<span style="font-size:11px; color:var(--text-muted);">Settled</span>`
          }
          ${editDatesBtn}
        </div>
      `;

      return `
        <tr>
          <td><strong>${escapeHtml(ms.plan_name_snapshot)}</strong></td>
          <td>${formatDate(ms.start_date)}</td>
          <td>${formatDate(ms.end_date)}</td>
          <td>Rs. ${ms.original_price.toLocaleString()}</td>
          <td>${discText}</td>
          <td>Rs. ${ms.final_payable_amount.toLocaleString()}</td>
          <td>Rs. ${ms.total_paid.toLocaleString()}</td>
          <td>${remainingHtml}</td>
          <td><span class="badge ${ms.membership_status.toLowerCase()}">${ms.membership_status}</span></td>
          <td>${actionHtml}</td>
        </tr>
      `;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--red);">Failed to load memberships.</td></tr>';
  }
}

async function loadProfilePayments(memberId) {
  const tbody = document.getElementById('profilePaymentsBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Loading payments...</td></tr>';
  try {
    const res = await fetch(`/api/members/${memberId}/payments`);
    const payments = await res.json();
    if (payments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No payment transactions recorded.</td></tr>';
      return;
    }
    tbody.innerHTML = payments.map(p => {
      const isReversable = p.payment_status === 'COMPLETED';
      const statusLabel = p.payment_status;
      const statusStyle = p.payment_status === 'REVERSED' ? 'background:#ef4444; color:white;' : 'background:var(--green); color:white;';
      
      let refText = p.transaction_reference || '-';
      if (p.adjustment_type === 'REVERSAL') {
        refText += ` <span style="font-size:10px; color:#ef4444;">(Reversed: ${escapeHtml(p.adjustment_reason)})</span>`;
      }
      
      const reverseBtn = isReversable 
        ? `<button class="btn btn-outline btn-sm" onclick="reversePaymentAction(${p.id}, ${p.amount}, '${p.receipt_number}')" style="padding:4px 8px; font-size:11px; border-color:#ef4444; color:#ef4444;">Reverse</button>`
        : `<span style="font-size:12px; color:var(--text-muted);">Locked</span>`;
        
      return `
        <tr>
          <td>${formatDateTime(p.payment_date)}</td>
          <td><code>${p.receipt_number}</code></td>
          <td><strong>Rs. ${p.amount}</strong></td>
          <td>${p.payment_method}</td>
          <td>${refText}</td>
          <td>${escapeHtml(p.recorded_by)}</td>
          <td><span class="badge" style="${statusStyle}">${statusLabel}</span></td>
          <td>${reverseBtn}</td>
        </tr>
      `;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--red);">Failed to load payment transactions.</td></tr>';
  }
}

async function loadProfileAttendance(memberId) {
  const tbody = document.getElementById('profileAttendanceBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading attendance logs...</td></tr>';
  try {
    const res = await fetch(`/api/members/${memberId}/attendance?days=30`);
    if (!res.ok) throw new Error('Failed to fetch attendance');
    const data = await res.json();
    const { stats, logs } = data;

    if (stats) {
      const daysBadge = document.getElementById('paneAttendanceDaysBadge');
      if (daysBadge) {
        daysBadge.textContent = `30-Day Total: ${stats.daysPresent} Days`;
      }
      const summaryText = document.getElementById('paneAttendanceSummaryText');
      if (summaryText) {
        summaryText.textContent = `Member attended ${stats.daysPresent} out of the last 30 days (${stats.attendanceRate}% consistency) • Total all-time visits: ${stats.totalVisits}`;
      }
    }

    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:24px;">No gym check-in records found for this member.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(log => {
      const d = new Date(log.date + 'T00:00:00');
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const timeStr = log.check_in_time.includes(' ') ? log.check_in_time.split(' ')[1] : log.check_in_time;
      const shiftClass = log.shift === 'morning' ? 'shift-morning' : 'shift-day';
      const shiftLabel = log.shift === 'morning' ? '🌅 Morning' : '☀️ Day';

      return `
        <tr>
          <td><strong>${formatDate(log.date)}</strong></td>
          <td><span style="color:var(--text-muted); font-size:12px;">${dayName}</span></td>
          <td>${timeStr}</td>
          <td><span class="badge ${shiftClass}">${shiftLabel}</span></td>
          <td><span style="color:var(--text-muted); font-size:12px;">${escapeHtml(log.device_ip || 'Biometric Device')}</span></td>
        </tr>
      `;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--red);">Failed to load attendance logs.</td></tr>';
  }
}

// Reverse Payment Action Confirmation Trigger
function reversePaymentAction(paymentId, amount, receiptNumber) {
  const reason = prompt(`⚠️ REVERSE PAYMENT TRANSACTION\nAre you sure you want to reverse the payment of NPR ${amount} (Receipt: ${receiptNumber})?\nThis will restore the outstanding dues balance.\n\nPlease enter the reason for reversal below:`);
  
  if (reason === null) return;
  if (reason.trim() === '') {
    showToast('Reversal reason is required.', 'error');
    return;
  }
  
  confirmAction(
    'Confirm Reversal?',
    `Are you sure you want to reverse this payment of NPR ${amount}? This action will write a reversal audit block.`,
    async () => {
      try {
        const res = await fetch(`/api/payments/${paymentId}/reverse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        
        showToast('Payment transaction reversed successfully.', 'success');
        const activeMemberId = currentProfileMemberId || document.getElementById('renewMemberId')?.value;
        if (activeMemberId) {
          viewMemberProfile(activeMemberId);
        } else {
          loadMembers();
        }
      } catch (err) {
        showToast(err.message || 'Failed to reverse payment', 'error');
      }
    }
  );
}

// ─── Renew Membership Modal Behavior ───
const renewModal = document.getElementById('renewMembershipModal');
const renewForm = document.getElementById('renewMembershipForm');

async function openRenewMembershipModal(memberId, currentMembership) {
  document.getElementById('renewMemberId').value = memberId;
  renewForm.reset();
  
  let startDate = new Date();
  if (currentMembership && new Date(currentMembership.end_date) >= new Date()) {
    const end = new Date(currentMembership.end_date);
    end.setDate(end.getDate() + 1);
    startDate = end;
  }
  
  document.getElementById('renewStartDate').value = startDate.toISOString().split('T')[0];
  
  try {
    const res = await fetch('/api/plans');
    const plans = await res.json();
    const select = document.getElementById('renewPlanSelect');
    
    let html = '<option value="">-- Choose Plan --</option>';
    plans.forEach(p => {
      html += `<option value="${p.id}" data-price="${p.regular_price}" data-val="${p.duration_value}" data-type="${p.duration_type}">${escapeHtml(p.plan_name)} (NPR ${p.regular_price})</option>`;
    });
    select.innerHTML = html;
    
    select.onchange = () => {
      const opt = select.options[select.selectedIndex];
      if (!opt.value) {
        document.getElementById('renewOriginalPrice').value = '';
        document.getElementById('renewFinalPayable').value = '';
        return;
      }
      
      const price = parseFloat(opt.dataset.price);
      document.getElementById('renewOriginalPrice').value = price;
      
      const durationVal = parseInt(opt.dataset.val);
      const durationType = opt.dataset.type;
      
      const start = new Date(document.getElementById('renewStartDate').value);
      if (durationType === 'MONTH') {
        start.setMonth(start.getMonth() + durationVal);
      } else if (durationType === 'DAY') {
        start.setDate(start.getDate() + durationVal);
      } else if (durationType === 'WEEK') {
        start.setDate(start.getDate() + (durationVal * 7));
      } else if (durationType === 'YEAR') {
        start.setFullYear(start.getFullYear() + durationVal);
      }
      
      document.getElementById('renewEndDate').value = start.toISOString().split('T')[0];
      calculateRenewFinalPayable();
    };
    
    document.getElementById('renewDiscountType').onchange = calculateRenewFinalPayable;
    document.getElementById('renewDiscountAmount').oninput = calculateRenewFinalPayable;
    
    renewModal.classList.add('active');
  } catch {
    showToast('Failed to load plans list.', 'error');
  }
}

function calculateRenewFinalPayable() {
  const originalPrice = parseFloat(document.getElementById('renewOriginalPrice').value) || 0;
  const discType = document.getElementById('renewDiscountType').value;
  const discAmount = parseFloat(document.getElementById('renewDiscountAmount').value) || 0;
  
  let payable = originalPrice;
  if (discType === 'FIXED') {
    payable = Math.max(0, originalPrice - discAmount);
  } else if (discType === 'PERCENT') {
    payable = Math.max(0, originalPrice - (originalPrice * (discAmount / 100)));
  }
  
  document.getElementById('renewFinalPayable').value = Math.round(payable);
  document.getElementById('renewAmountPaid').value = Math.round(payable);
}

function closeRenewModal() {
  renewModal.classList.remove('active');
}
document.getElementById('renewModalClose')?.addEventListener('click', closeRenewModal);
document.getElementById('renewModalCancel')?.addEventListener('click', closeRenewModal);

renewForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const memberId = document.getElementById('renewMemberId').value;
  const planId = document.getElementById('renewPlanSelect').value;
  
  const payload = {
    plan_id: planId ? parseInt(planId) : null,
    start_date: document.getElementById('renewStartDate').value,
    end_date: document.getElementById('renewEndDate').value,
    original_price: parseFloat(document.getElementById('renewOriginalPrice').value) || 0,
    discount_type: document.getElementById('renewDiscountType').value,
    discount_amount: parseFloat(document.getElementById('renewDiscountAmount').value) || 0,
    final_payable_amount: parseFloat(document.getElementById('renewFinalPayable').value) || 0,
    payment_due_date: document.getElementById('renewPaymentDueDate').value || null,
    notes: document.getElementById('renewNotes').value.trim(),
    amount_paid: parseFloat(document.getElementById('renewAmountPaid').value) || 0,
    payment_method: document.getElementById('renewPaymentMethod').value,
    transaction_reference: document.getElementById('renewPaymentRef').value.trim(),
    payment_notes: 'Initial renewal deposit'
  };
  
  try {
    const res = await fetch(`/api/members/${memberId}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    showToast('Membership renewed successfully!', 'success');
    closeRenewModal();
    viewMemberProfile(memberId);
  } catch (err) {
    showToast(err.message || 'Failed to renew membership', 'error');
  }
});

// ─── Quick Edit Membership Dates Modal ───
const editDatesModal = document.getElementById('editDatesModal');
const editDatesForm = document.getElementById('editDatesForm');

function openEditMembershipDatesModal(membershipId, startDate, endDate, planName = '') {
  document.getElementById('editDatesMembershipId').value = membershipId;
  document.getElementById('editDatesPlanName').textContent = planName || 'Package';
  document.getElementById('editDatesStartDate').value = startDate || new Date().toISOString().split('T')[0];
  document.getElementById('editDatesEndDate').value = endDate || '';
  editDatesModal?.classList.add('active');
}

function closeEditDatesModal() {
  editDatesModal?.classList.remove('active');
}

document.getElementById('editDatesModalClose')?.addEventListener('click', closeEditDatesModal);
document.getElementById('editDatesModalCancel')?.addEventListener('click', closeEditDatesModal);

// Quick preset buttons (+1M, +3M, +6M, +1Y)
document.querySelectorAll('.date-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const months = parseInt(btn.dataset.months, 10);
    const startVal = document.getElementById('editDatesStartDate').value;
    if (!startVal) return;
    const s = new Date(startVal);
    s.setMonth(s.getMonth() + months);
    document.getElementById('editDatesEndDate').value = s.toISOString().split('T')[0];
  });
});

document.getElementById('btnPresetYesterday')?.addEventListener('click', () => {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  document.getElementById('editDatesEndDate').value = y.toISOString().split('T')[0];
});

editDatesForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const membershipId = document.getElementById('editDatesMembershipId').value;
  const startDate = document.getElementById('editDatesStartDate').value;
  const endDate = document.getElementById('editDatesEndDate').value;

  if (!startDate || !endDate) {
    showToast('Both Start Date and Expiry Date are required.', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/memberships/${membershipId}/dates`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: startDate, end_date: endDate })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Membership dates updated successfully!', 'success');
    closeEditDatesModal();
    loadMembers();
    if (currentProfileMemberId) {
      viewMemberProfile(currentProfileMemberId);
    }
  } catch (err) {
    showToast(err.message || 'Failed to update dates', 'error');
  }
});


// ─── Record Dues Payment Modal ───
const payModal = document.getElementById('recordPaymentModal');
const payForm = document.getElementById('recordPaymentForm');

function openRecordPaymentModal(memberId, membershipId, planName, outstandingDues, memberName = '') {
  document.getElementById('recordPayMemberId').value = memberId;
  document.getElementById('recordPayMembershipId').value = membershipId;
  document.getElementById('recordPayMemberName').textContent = memberName || 'Member';
  document.getElementById('recordPayPlanName').textContent = planName;
  document.getElementById('recordPayOutstandingBalance').textContent = `NPR ${outstandingDues.toLocaleString()}`;
  document.getElementById('recordPayAmount').value = outstandingDues;
  document.getElementById('recordPayAmount').max = outstandingDues;

  const fullBtn = document.getElementById('recordPayFullBtn');
  if (fullBtn) {
    fullBtn.onclick = () => {
      document.getElementById('recordPayAmount').value = outstandingDues;
    };
  }
  
  payModal.classList.add('active');
}

function closePayModal() {
  payModal.classList.remove('active');
}
document.getElementById('recordPaymentModalClose')?.addEventListener('click', closePayModal);
document.getElementById('recordPayModalCancel')?.addEventListener('click', closePayModal);

payForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const memberId = document.getElementById('recordPayMemberId').value;
  const membershipId = document.getElementById('recordPayMembershipId').value;
  
  const payload = {
    member_id: parseInt(memberId),
    membership_id: parseInt(membershipId),
    amount: parseFloat(document.getElementById('recordPayAmount').value),
    payment_method: document.getElementById('recordPayMethod').value,
    transaction_reference: document.getElementById('recordPayRef').value.trim(),
    notes: document.getElementById('recordPayNotes').value.trim()
  };
  
  try {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    showToast(`Payment of NPR ${payload.amount.toLocaleString()} recorded successfully!`, 'success');
    closePayModal();
    const activePage = document.querySelector('.page-section.active')?.id;
    if (activePage === 'page-member-profile' || currentProfileMemberId) {
      viewMemberProfile(memberId);
    } else {
      loadDuesPage();
    }
    loadDashboard();
  } catch (err) {
    showToast(err.message || 'Failed to save payment', 'error');
  }
});


// ─── Freeze & Unfreeze Membership Modals ───
const freezeModal = document.getElementById('freezeMembershipModal');
const freezeForm = document.getElementById('freezeMembershipForm');
const unfreezeModal = document.getElementById('unfreezeMembershipModal');

function updateFreezeLivePreview() {
  const currentExpiry = document.getElementById('freezeOriginalEndDate').value;
  const days = parseInt(document.getElementById('freezeDays').value) || 0;
  
  if (currentExpiry) {
    document.getElementById('freezeCurrentExpiryText').textContent = formatDate(currentExpiry);
    
    // Scheduled resume date (Today + days)
    const resumeDate = new Date();
    resumeDate.setDate(resumeDate.getDate() + days);
    document.getElementById('freezeResumeDateText').textContent = days > 0 ? formatDate(resumeDate.toISOString().split('T')[0]) : 'Enter days';

    // Tentative extended expiry (currentExpiry + days)
    const newExpiry = new Date(currentExpiry);
    newExpiry.setDate(newExpiry.getDate() + days);
    document.getElementById('freezeNewExpiryText').textContent = days > 0 ? formatDate(newExpiry.toISOString().split('T')[0]) : formatDate(currentExpiry);
  }
}

function openFreezeMembershipModal(membershipId, currentExpiryDate) {
  document.getElementById('freezeMembershipId').value = membershipId;
  document.getElementById('freezeOriginalEndDate').value = currentExpiryDate || '';
  freezeForm.reset();
  document.getElementById('freezeDays').value = '15';
  updateFreezeLivePreview();
  freezeModal.classList.add('active');
}

function closeFreezeModal() {
  freezeModal.classList.remove('active');
}

document.getElementById('freezeDays')?.addEventListener('input', updateFreezeLivePreview);

document.querySelectorAll('.freeze-shortcut-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const d = btn.getAttribute('data-days');
    if (d) {
      document.getElementById('freezeDays').value = d;
      updateFreezeLivePreview();
    }
  });
});

document.getElementById('freezeModalClose')?.addEventListener('click', closeFreezeModal);
document.getElementById('freezeModalCancel')?.addEventListener('click', closeFreezeModal);

freezeForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const membershipId = document.getElementById('freezeMembershipId').value;
  const days = parseInt(document.getElementById('freezeDays').value);
  const reason = document.getElementById('freezeReason').value.trim();
  
  try {
    const res = await fetch(`/api/memberships/${membershipId}/freeze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days, reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    showToast(`❄️ Membership frozen for ${days} days until ${formatDate(data.freezeEndDate)}!`, 'success');
    closeFreezeModal();
    loadMembers();
    const activeMemberId = currentProfileMemberId || document.getElementById('renewMemberId')?.value;
    if (activeMemberId) {
      viewMemberProfile(activeMemberId);
    }
  } catch (err) {
    showToast(err.message || 'Failed to freeze membership', 'error');
  }
});

// ── Unfreeze Modal & Logic ──
function openUnfreezeMembershipModal(membershipId, memberName, freezeStartDate, originalEndDate) {
  document.getElementById('unfreezeMembershipId').value = membershipId;
  document.getElementById('unfreezeMemberName').textContent = memberName || 'Member';
  
  const today = new Date();
  const start = new Date(freezeStartDate || today.toISOString().split('T')[0]);
  start.setHours(0, 0, 0, 0);
  const todayZero = new Date(today);
  todayZero.setHours(0, 0, 0, 0);

  const diffMs = todayZero - start;
  const daysElapsed = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));

  document.getElementById('unfreezeStartDate').textContent = formatDate(freezeStartDate || today.toISOString().split('T')[0]);
  document.getElementById('unfreezeDaysElapsed').textContent = daysElapsed;

  const baseDate = originalEndDate ? new Date(originalEndDate) : new Date();
  baseDate.setDate(baseDate.getDate() + daysElapsed);
  document.getElementById('unfreezeNewExpiry').textContent = formatDate(baseDate.toISOString().split('T')[0]);

  unfreezeModal.classList.add('active');
}

function closeUnfreezeModal() {
  unfreezeModal.classList.remove('active');
}

document.getElementById('unfreezeModalClose')?.addEventListener('click', closeUnfreezeModal);
document.getElementById('unfreezeModalCancel')?.addEventListener('click', closeUnfreezeModal);

document.getElementById('unfreezeConfirmBtn')?.addEventListener('click', async () => {
  const membershipId = document.getElementById('unfreezeMembershipId').value;
  if (!membershipId) return;

  const btn = document.getElementById('unfreezeConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Unfreezing...';

  try {
    const res = await fetch(`/api/memberships/${membershipId}/unfreeze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`☀️ Membership unfrozen! Extended by ${data.actualDaysFrozen} day(s) until ${formatDate(data.newEndDate)}. Door access restored!`, 'success');
    closeUnfreezeModal();
    loadMembers();
    const activeMemberId = currentProfileMemberId || document.getElementById('renewMemberId')?.value;
    if (activeMemberId) {
      viewMemberProfile(activeMemberId);
    }
  } catch (err) {
    showToast(err.message || 'Failed to unfreeze membership', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '☀️ Unfreeze & Restore Access';
  }
});


// ─── Outstanding Dues Dashboard Page ───
let currentDuesData = [];
let currentDuesFilter = 'all';

async function loadDuesPage() {
  try {
    const res = await fetch('/api/dues');
    const data = await res.json();
    
    const { stats, dues } = data;
    currentDuesData = dues || [];
    
    document.getElementById('duesStatTotal').textContent = `NPR ${stats.totalOutstandingAmount.toLocaleString()}`;
    document.getElementById('duesStatCollected').textContent = `NPR ${stats.amountCollectedToday.toLocaleString()}`;
    document.getElementById('duesStatCollectedMonth').textContent = `NPR ${stats.amountCollectedThisMonth.toLocaleString()}`;
    document.getElementById('duesStatCollectedYear').textContent = `NPR ${stats.amountCollectedThisYear.toLocaleString()}`;

    // Update filter counts
    const overdueCount = currentDuesData.filter(d => d.days_overdue > 0).length;
    const pendingCount = currentDuesData.filter(d => d.days_overdue === 0).length;
    
    const btnAll = document.getElementById('duesFilterAll');
    const btnOverdue = document.getElementById('duesFilterOverdue');
    const btnPending = document.getElementById('duesFilterPending');
    if (btnAll) btnAll.textContent = `All Dues (${currentDuesData.length})`;
    if (btnOverdue) btnOverdue.textContent = `⚠️ Overdue (${overdueCount})`;
    if (btnPending) btnPending.textContent = `⏳ Pending (${pendingCount})`;

    renderDuesTable();
  } catch {
    showToast('Failed to load outstanding dues analytics.', 'error');
  }
}

function renderDuesTable() {
  const tbody = document.getElementById('duesListBody');
  const emptyState = document.getElementById('emptyDuesList');
  const searchInput = document.getElementById('duesSearchInput');
  const query = (searchInput?.value || '').trim().toLowerCase();

  let filtered = currentDuesData.filter(d => {
    if (currentDuesFilter === 'overdue' && d.days_overdue <= 0) return false;
    if (currentDuesFilter === 'pending' && d.days_overdue > 0) return false;
    if (query) {
      const matchName = (d.full_name || '').toLowerCase().includes(query);
      const matchPhone = (d.phone || '').toLowerCase().includes(query);
      const matchCode = (d.member_code || '').toLowerCase().includes(query);
      const matchPlan = (d.plan_name_snapshot || '').toLowerCase().includes(query);
      if (!matchName && !matchPhone && !matchCode && !matchPlan) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    const emptyTitle = document.getElementById('emptyDuesTitle');
    const emptyDesc = document.getElementById('emptyDuesDesc');
    if (query || currentDuesFilter !== 'all') {
      if (emptyTitle) emptyTitle.textContent = 'No matching dues records found';
      if (emptyDesc) emptyDesc.textContent = 'Try adjusting your search query or filter tab.';
    } else {
      if (emptyTitle) emptyTitle.textContent = 'No outstanding dues!';
      if (emptyDesc) emptyDesc.textContent = 'All members have paid their active gym fees.';
    }
    return;
  }

  emptyState.style.display = 'none';
  tbody.innerHTML = filtered.map(d => {
    const overdueBadge = d.days_overdue > 0 
      ? `<span class="badge expired" style="background:#ef4444; color:white; font-size:10px; font-weight:700;">⚠️ ${d.days_overdue}d Overdue</span>`
      : `<span class="badge warning" style="background:#f59e0b; color:white; font-size:10px;">⏳ Pending</span>`;

    const codeBadge = d.member_code
      ? `<span style="display:inline-block; font-size:10px; background:#f3f4f6; color:#4b5563; padding:1px 6px; border-radius:4px; margin-top:2px; font-family:monospace;">${escapeHtml(d.member_code)}</span>`
      : '';
      
    return `
      <tr>
        <td>
          <div class="capitalize" style="font-weight:700; color:var(--text-primary); cursor:pointer;" onclick="viewMemberProfile(${d.member_id})">${escapeHtml(d.full_name)}</div>
          ${codeBadge}
        </td>
        <td>${escapeHtml(d.phone)}</td>
        <td><span class="badge active">${escapeHtml(d.plan_name_snapshot)}</span></td>
        <td>${formatDate(d.end_date)}</td>
        <td>
          <div>${d.payment_due_date ? formatDate(d.payment_due_date) : '-'}</div>
          <div style="margin-top:2px;">${overdueBadge}</div>
        </td>
        <td>Rs. ${d.final_payable_amount.toLocaleString()}</td>
        <td>Rs. ${d.total_paid.toLocaleString()}</td>
        <td><strong style="color:#ef4444; font-size:14px;">Rs. ${d.remaining_balance.toLocaleString()}</strong></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openRecordPaymentModal(${d.member_id}, ${d.id}, '${escapeHtml(d.plan_name_snapshot)}', ${d.remaining_balance}, '${escapeHtml(d.full_name)}')" style="padding:4px 12px; font-size:12px; font-weight:600; border-color:var(--green); color:var(--green);">💸 Pay</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Wire dues filter buttons
document.querySelectorAll('.dues-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dues-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDuesFilter = btn.dataset.filter;
    renderDuesTable();
  });
});

document.getElementById('duesSearchInput')?.addEventListener('input', () => {
  renderDuesTable();
});

// ─── Format Utilities ───
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
