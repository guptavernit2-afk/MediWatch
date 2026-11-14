import { icon } from './icons.js';
import { lineChart } from './charts.js';
import {
  escapeHtml as e,
  VITALS,
  statusBadge,
  patientIdentity,
  dateTime,
  timeAgo,
  button,
  emptyState,
} from './helpers.js';

function drawerOverview(state, patient) {
  const metric = VITALS.find((vital) => vital.key === state.drawerMetric) || VITALS[0];
  const summary = state.drawerSummary;
  const abnormal = new Map((patient.anomalies || []).map((anomaly) => [anomaly.vital, anomaly]));
  return `<div class="detail-vitals">${VITALS.map((vital) => `<div class="detail-vital ${abnormal.has(vital.key) ? 'is-abnormal' : ''}"><span class="vital-label">${icon(vital.icon)}${vital.short}</span><div class="detail-value">${patient[vital.key] ?? '—'}<small>${vital.unit}</small></div><span class="detail-vital-caption">${abnormal.has(vital.key) ? 'Outside demo range' : 'Within demo range'}</span></div>`).join('')}</div><section class="detail-section"><div class="panel-header"><div><h3 class="panel-title">Reading history</h3><p class="panel-subtitle">${(patient.history || []).length} stored readings</p></div><select class="filter-select" id="drawer-metric" aria-label="Patient trend metric">${VITALS.map((vital) => `<option value="${vital.key}" ${vital.key === metric.key ? 'selected' : ''}>${vital.short}</option>`).join('')}</select></div><div class="trend-chart detail-chart">${lineChart(
    (patient.history || []).map((reading) => ({ timestamp: reading.timestamp, value: reading[metric.key] })),
    { metric: metric.key, id: 'patient-detail', label: metric.label, unit: metric.unit, compact: true },
  )}</div></section><section class="detail-section"><div class="panel-header"><h3 class="panel-title">Threshold observations</h3><span class="count-pill">${patient.anomalies?.length || 0}</span></div>${patient.anomalies?.length ? `<div class="threshold-list">${patient.anomalies.map((anomaly) => `<div class="threshold-row"><span class="alert-symbol ${anomaly.severity}">${icon('alert')}</span><div><strong>${e(anomaly.label || anomaly.vital)}</strong><p>Measured ${e(anomaly.value)} · illustrative range ${e(anomaly.min)}–${e(anomaly.max)}</p></div><span class="alert-severity ${anomaly.severity === 'critical' ? 'critical' : 'warning'}">${anomaly.severity === 'critical' ? 'Critical' : 'Attention'}</span></div>`).join('')}</div>` : `<div class="in-range-message">${icon('checkCircle')} Latest readings are within the illustrative demo ranges.</div>`}</section><section class="detail-section"><div class="panel-header"><h3 class="panel-title">${icon('sparkles')} Monitoring summary</h3><span class="info-tag">${summary ? (summary.source === 'groq' ? 'AI generated' : 'Local rules') : 'Local rules'}</span></div><div class="summary-box"><p>${e(summary?.summary || patient.recommendation || 'Record a reading to generate a monitoring summary.')}</p>${summary ? `<span class="summary-time">Generated ${dateTime(summary.generated_at)}</span>` : ''}</div><p class="summary-disclaimer">For learning only. This is not a diagnosis or treatment recommendation. ${state.config.ai_configured ? 'Generating an AI summary sends deidentified vital readings to Groq; names and patient IDs are excluded.' : 'Summaries are generated locally. No external service is used without a configured API key.'}</p>${button(state.config.ai_configured ? 'Generate AI summary' : 'Refresh local summary', 'generate-summary', 'sparkles', 'btn-secondary btn-sm', state.summaryLoading ? 'disabled aria-busy="true"' : '')}</section><section class="detail-section patient-record-meta"><h3 class="panel-title">Patient record</h3><dl><div><dt>Observation context</dt><dd>${e(patient.condition || 'General observation')}</dd></div><div><dt>Admitted</dt><dd>${dateTime(patient.admitted_at)}</dd></div><div><dt>Record</dt><dd>${e(patient.patient_id)}</dd></div></dl><button class="text-link danger-text" data-action="discharge-patient" data-id="${e(patient.patient_id)}">${icon('logout')} Discharge patient</button></section>`;
}

function drawerNotes(state) {
  return `<section class="detail-section"><h3 class="panel-title">Add an observation</h3><p class="panel-subtitle">Keep a simple, timestamped record for this patient.</p><form class="note-compose" id="note-form"><label class="field"><span class="sr-only">Observation</span><textarea name="content" rows="3" minlength="2" maxlength="2000" required placeholder="What would you like to record?"></textarea></label><div class="note-compose-footer"><label class="field author-field">Recorded by<input name="author" maxlength="80" required value="Workspace operator" autocomplete="off"></label>${button('Save observation', '', 'plus', 'btn-primary btn-sm', 'type="submit"')}</div><p class="form-error" data-form-error role="alert" hidden></p></form></section><section class="detail-section"><div class="panel-header"><h3 class="panel-title">Observation log</h3><span class="count-pill">${state.notes.length}</span></div><div class="note-list">${state.notesLoading ? '<div class="loading-state">Loading observations…</div>' : state.notes.length ? state.notes.map((note) => `<article class="note-card"><div class="note-heading"><strong>${e(note.author)}</strong><time datetime="${e(note.created_at)}">${dateTime(note.created_at)}</time></div><p class="note-text">${e(note.content)}</p></article>`).join('') : emptyState('The story starts here', 'New observations are saved with the patient record.', 'file')}</div></section>`;
}

function drawerHistory(patient) {
  const readings = [...(patient.history || [])].reverse();
  return `<section class="detail-section"><div class="panel-header"><div><h3 class="panel-title">Every recorded signal</h3><p class="panel-subtitle">Most recent readings first · local time</p></div></div><div class="table-wrap"><table class="patient-table history-table"><caption class="sr-only">Stored vital readings for ${e(patient.name)}</caption><thead><tr><th>Time</th><th>HR<br><small>bpm</small></th><th>SpO₂<br><small>%</small></th><th>BP<br><small>mmHg</small></th><th>Temp<br><small>°C</small></th><th>Resp<br><small>/min</small></th></tr></thead><tbody>${readings.map((reading) => `<tr><td>${dateTime(reading.timestamp)}</td><td>${reading.heart_rate}</td><td>${reading.oxygen}</td><td>${reading.blood_pressure_sys}/${reading.blood_pressure_dia}</td><td>${reading.temperature}</td><td>${reading.respiratory_rate}</td></tr>`).join('')}</tbody></table></div>${!readings.length ? emptyState('No readings yet', 'Record the first set of vitals for this patient.', 'pulse') : ''}</section>`;
}

export function drawer(state) {
  const patient = state.selectedPatient;
  if (!patient)
    return `<div class="drawer-header"><h2 id="drawer-title">Loading patient…</h2><button class="icon-button" data-action="close-drawer" aria-label="Close patient details">${icon('close')}</button></div><div class="drawer-body"><div class="loading-state">Retrieving patient record…</div></div>`;
  return `<div class="drawer-header"><div><span class="eyebrow">PATIENT PROFILE</span><h2 id="drawer-title">A closer look.</h2></div><button class="icon-button" data-action="close-drawer" aria-label="Close patient details">${icon('close')}</button></div><div class="drawer-identity"><div class="patient-person">${patientIdentity(patient)}</div>${statusBadge(patient.status)}</div><div class="drawer-context"><span>${icon('bed')} ${e(patient.ward)} · Bed ${e(patient.bed)}</span><span>${icon('clock')} ${timeAgo(patient.updated_at)}</span></div><div class="drawer-primary-action">${button('Record reading', 'record-reading', 'plus', 'btn-primary btn-sm', `data-id="${e(patient.patient_id)}"`)}<span class="reading-source">${state.config.demo_mode ? 'Fictional demo record' : 'Protected patient record'}</span></div><div class="drawer-tabs" role="tablist" aria-label="Patient details">${[
    ['overview', 'Overview'],
    ['notes', `Observations${state.notes.length ? ` (${state.notes.length})` : ''}`],
    ['history', 'History'],
  ]
    .map(
      ([key, label]) =>
        `<button role="tab" id="tab-${key}" aria-controls="drawer-tabpanel" aria-selected="${state.drawerTab === key}" tabindex="${state.drawerTab === key ? 0 : -1}" data-action="drawer-tab" data-tab="${key}" class="${state.drawerTab === key ? 'active' : ''}">${label}</button>`,
    )
    .join(
      '',
    )}</div><div class="drawer-body" id="drawer-tabpanel" role="tabpanel" aria-labelledby="tab-${state.drawerTab}">${state.drawerTab === 'notes' ? drawerNotes(state) : state.drawerTab === 'history' ? drawerHistory(patient) : drawerOverview(state, patient)}</div>`;
}

function vitalFields(patient = {}) {
  const defaults = {
    heart_rate: 76,
    blood_pressure_sys: 120,
    blood_pressure_dia: 80,
    oxygen: 98,
    temperature: 36.8,
    respiratory_rate: 16,
  };
  return VITALS.map(
    (vital) =>
      `<label class="field">${vital.label}<span class="input-unit-wrap"><input type="number" name="${vital.key}" min="${vital.min}" max="${vital.max}" step="${vital.step}" value="${patient[vital.key] ?? defaults[vital.key]}" required><span>${vital.unit}</span></span></label>`,
  ).join('');
}

export function patientForm() {
  return `<form id="patient-form"><div class="modal-header"><div><div class="eyebrow">GROW YOUR WORKSPACE</div><h2 id="modal-title">Add a patient</h2><p>Start a record with an initial set of readings.</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Close add patient">${icon('close')}</button></div><div class="modal-body"><h3 class="form-section-title">Patient details</h3><label class="field">Full name<input name="name" required maxlength="100" minlength="2" placeholder="e.g. Ananya Mehta" autocomplete="off"></label><div class="form-grid"><label class="field">Age<input name="age" type="number" min="18" max="120" required placeholder="Years"></label><label class="field">Sex<select name="sex"><option>Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label><label class="field">Ward<select name="ward"><option>General</option><option>ICU</option><option>Cardiology</option><option>Recovery</option></select></label><label class="field">Bed identifier<input name="bed" required maxlength="20" placeholder="e.g. G-09" autocomplete="off"></label></div><label class="field">Observation context<input name="condition" maxlength="180" placeholder="e.g. Routine observation" autocomplete="off"></label><p class="form-hint">This prototype uses illustrative adult ranges (ages 18+). Each active ward and bed combination must be unique.</p><h3 class="form-section-title">Initial reading</h3><div class="form-grid">${vitalFields()}</div><p class="form-error" data-form-error role="alert" hidden></p></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">${icon('plus')} Add patient</button></div></form>`;
}

export function readingForm(patient) {
  return `<form id="reading-form" data-id="${e(patient.patient_id)}"><div class="modal-header"><div><div class="eyebrow">A NEW SET OF SIGNALS</div><h2 id="modal-title">Record a reading</h2><p>${e(patient.name)} · ${e(patient.patient_id)}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close reading form">${icon('close')}</button></div><div class="modal-body"><div class="form-grid">${vitalFields(patient)}</div><p class="form-hint">Confirm the values before saving. The new reading updates the patient’s status and may create threshold alerts.</p><p class="form-error" data-form-error role="alert" hidden></p></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">${icon('check')} Save reading</button></div></form>`;
}

export function dischargeForm(patient) {
  return `<form id="discharge-form" data-id="${e(patient.patient_id)}"><div class="modal-header"><div><div class="eyebrow">COMPLETE THE OBSERVATION</div><h2 id="modal-title">Discharge ${e(patient.name)}?</h2></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Close discharge confirmation">${icon('close')}</button></div><div class="modal-body"><p>This removes the patient from the active monitors and makes bed ${e(patient.bed)} in ${e(patient.ward)} available again.</p><p class="form-hint">Their readings and observations remain in the database. This action does not delete the record.</p><p class="form-error" data-form-error role="alert" hidden></p></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-action="close-modal">Keep monitoring</button><button type="submit" class="btn btn-danger">${icon('logout')} Discharge patient</button></div></form>`;
}

export function chartData(state) {
  return `<div class="modal-header"><div><div class="eyebrow">BEHIND THE TREND</div><h2 id="modal-title">Workspace readings</h2><p>Latest values for each active patient. CSV includes the full snapshot.</p></div><button class="icon-button" data-action="close-modal" aria-label="Close readings">${icon('close')}</button></div><div class="modal-body"><div class="table-wrap"><table class="patient-table"><thead><tr><th>Patient</th><th>HR <small>bpm</small></th><th>SpO₂ <small>%</small></th><th>BP <small>mmHg</small></th><th>Time</th></tr></thead><tbody>${state.patients.map((patient) => `<tr><td>${e(patient.name)}</td><td>${patient.heart_rate}</td><td>${patient.oxygen}</td><td>${patient.blood_pressure_sys}/${patient.blood_pressure_dia}</td><td>${dateTime(patient.updated_at)}</td></tr>`).join('')}</tbody></table></div></div><div class="modal-footer">${button('Download CSV', 'export', 'download', 'btn-primary')}</div>`;
}
