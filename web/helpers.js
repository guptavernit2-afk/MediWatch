import { icon } from './icons.js';

export const STATUS = { normal: 'Stable', warning: 'Attention', critical: 'Critical' };
export const SEVERITY_ORDER = { critical: 0, warning: 1, normal: 2 };
export const VITALS = [
  {
    key: 'heart_rate',
    label: 'Heart rate',
    short: 'Heart rate',
    unit: 'bpm',
    icon: 'heart',
    step: '1',
    min: 20,
    max: 250,
  },
  {
    key: 'oxygen',
    label: 'Oxygen saturation',
    short: 'SpO₂',
    unit: '%',
    icon: 'drop',
    step: '0.1',
    min: 50,
    max: 100,
  },
  {
    key: 'blood_pressure_sys',
    label: 'Systolic pressure',
    short: 'Systolic BP',
    unit: 'mmHg',
    icon: 'pulse',
    step: '1',
    min: 40,
    max: 300,
  },
  {
    key: 'blood_pressure_dia',
    label: 'Diastolic pressure',
    short: 'Diastolic BP',
    unit: 'mmHg',
    icon: 'pulse',
    step: '1',
    min: 20,
    max: 200,
  },
  {
    key: 'temperature',
    label: 'Temperature',
    short: 'Temperature',
    unit: '°C',
    icon: 'thermometer',
    step: '0.1',
    min: 30,
    max: 43,
  },
  {
    key: 'respiratory_rate',
    label: 'Respiratory rate',
    short: 'Respiration',
    unit: '/min',
    icon: 'lungs',
    step: '1',
    min: 4,
    max: 70,
  },
];

export function escapeHtml(value = '') {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

export function initials(name = '') {
  return String(name)
    .trim()
    .split(/\s+/)
    .map((part) => part[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function timeAgo(value) {
  if (!value) return 'No reading';
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(value).valueOf()) / 1000));
  if (!Number.isFinite(elapsed)) return 'Unknown time';
  if (elapsed < 10) return 'Just now';
  if (elapsed < 60) return `${elapsed}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

export function dateTime(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  });
}

export function countPatients(patients) {
  return patients.reduce(
    (counts, patient) => {
      if (Object.hasOwn(counts, patient.status)) counts[patient.status]++;
      return counts;
    },
    { normal: 0, warning: 0, critical: 0 },
  );
}

export function sortAlerts(alerts) {
  return [...alerts].sort(
    (a, b) =>
      Number(a.active === false) - Number(b.active === false) ||
      Number(a.acknowledged) - Number(b.acknowledged) ||
      (SEVERITY_ORDER[a.severity] ?? 1) - (SEVERITY_ORDER[b.severity] ?? 1) ||
      new Date(b.created_at).valueOf() - new Date(a.created_at).valueOf(),
  );
}

export function statusBadge(status) {
  const safe = Object.hasOwn(STATUS, status) ? status : 'normal';
  return `<span class="status-badge ${safe}"><span class="status-dot"></span>${STATUS[safe]}</span>`;
}

export function patientIdentity(patient, compact = false) {
  return `<span class="patient-avatar avatar-${SEVERITY_ORDER[patient.status] ?? 2}">${escapeHtml(initials(patient.name))}</span><span class="patient-identity"><strong class="patient-name">${escapeHtml(patient.name)}</strong><span class="patient-meta">${escapeHtml(patient.patient_id)}${compact ? '' : ` <span>·</span> ${patient.age} yrs <span>·</span> ${escapeHtml(patient.sex || 'Not specified')}`}</span></span>`;
}

export function button(label, action, iconName, cls = 'btn-secondary', extra = '') {
  return `<button class="btn ${cls}" data-action="${action}" ${extra}>${iconName ? icon(iconName) : ''}${label}</button>`;
}

export function emptyState(title, message, iconName = 'users', action = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p>${action}</div>`;
}

export function filterPatients(state) {
  const query = state.query.trim().toLocaleLowerCase();
  return state.patients
    .filter(
      (patient) =>
        (!query ||
          [patient.name, patient.patient_id, patient.ward, patient.bed, patient.condition]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)) &&
        (!state.statusFilter || patient.status === state.statusFilter) &&
        (!state.wardFilter || patient.ward === state.wardFilter),
    )
    .sort((a, b) =>
      state.sort === 'name'
        ? a.name.localeCompare(b.name)
        : state.sort === 'newest'
          ? new Date(b.admitted_at) - new Date(a.admitted_at)
          : SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status] || a.name.localeCompare(b.name),
    );
}
