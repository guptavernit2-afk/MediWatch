import { icon } from './icons.js';
import { lineChart, sparkline, acuityRing, aggregateSeries, CHART_COLORS } from './charts.js';
import {
  escapeHtml as e,
  STATUS,
  VITALS,
  statusBadge,
  patientIdentity,
  button,
  emptyState,
  countPatients,
  sortAlerts,
  filterPatients,
  timeAgo,
  dateTime,
} from './helpers.js';

const labels = {
  overview: 'Overview',
  patients: 'Patients',
  alerts: 'Alert center',
  insights: 'Insights',
  settings: 'Settings',
};
export { labels };

function pageHeader(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div><div class="page-actions">${actions}</div></div>`;
}

function demoBanner(state) {
  if (!state.config.demo_mode || state.bannerDismissed) return '';
  return `<div class="demo-banner"><span class="banner-icon">${icon('info')}</span><div class="banner-copy"><span class="banner-label">You're exploring the demo workspace.</span> Patient records are fictional. Simulated readings update every ${state.config.refresh_interval || 10} seconds.</div><button class="banner-close icon-button" data-action="dismiss-banner" aria-label="Dismiss demo message">${icon('close')}</button></div>`;
}

function stats(state) {
  const counts = countPatients(state.patients);
  return `<div class="stats-grid">${[
    ['Patients monitored', state.patients.length, 'users', 'teal', 'Across your active wards', '', ''],
    ['Critical', counts.critical, 'heart', 'red', 'Review flagged readings', 'critical', 'Needs review'],
    [
      'Need attention',
      counts.warning,
      'alert',
      'amber',
      'Outside the demo range',
      'warning',
      'Monitor closely',
    ],
    ['Stable', counts.normal, 'checkCircle', 'green', 'Within the demo range', 'normal', 'In range'],
  ]
    .map(
      ([label, value, ico, color, caption, filter, tag]) =>
        `<button class="stat-card" data-action="stat-filter" data-status="${filter}" aria-label="Show ${e(label.toLowerCase())}"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${icon(ico)}</span></div><div class="stat-value">${value.toString().padStart(2, '0')}</div><div class="stat-bottom"><span>${caption}</span>${tag ? `<span class="stat-trend ${color}"><span class="status-dot"></span>${tag}</span>` : `<span class="stat-trend teal">Active ${icon('arrow')}</span>`}</div></button>`,
    )
    .join('')}</div>`;
}

function trendPanel(state, id = 'overview') {
  const metric = state.chartMetric;
  const vital = VITALS.find((item) => item.key === metric);
  const series = aggregateSeries(state.patients, metric);
  const current = series.at(-1)?.value;
  return `<section class="panel trend-panel"><div class="panel-header"><div><h2 class="panel-title">Vital trends</h2><p class="panel-subtitle">Minute averages · ${series.length || 0} minutes with readings</p></div><div class="segmented-control" aria-label="Trend metric">${[
    ['heart_rate', 'Heart rate'],
    ['oxygen', 'SpO₂'],
    ['blood_pressure_sys', 'BP'],
  ]
    .map(
      ([key, label]) =>
        `<button data-action="chart-metric" data-metric="${key}" aria-pressed="${key === metric}" class="${key === metric ? 'active' : ''}">${label}</button>`,
    )
    .join(
      '',
    )}</div></div><div class="chart-summary"><span class="chart-current">${current == null ? '—' : Number(current.toFixed(1))}<small>${vital.unit}</small></span><span class="chart-live-label"><span class="status-dot"></span> Latest minute average</span></div><div class="trend-chart">${lineChart(series, { metric, id, label: `Average ${vital.label}`, unit: vital.unit })}</div><div class="chart-legend"><span><i class="legend-dot" style="background:${CHART_COLORS[metric]}"></i>${vital.label}</span><button class="text-link" data-action="view-chart-data">View readings ${icon('arrow')}</button></div></section>`;
}

function acuityPanel(state) {
  const counts = countPatients(state.patients);
  const total = state.patients.length;
  return `<section class="panel acuity-panel"><div class="panel-header"><div><h2 class="panel-title">Patient status</h2><p class="panel-subtitle">Your workspace at a glance</p></div><span class="panel-header-icon">${icon('users')}</span></div><div class="acuity-content"><div class="acuity-ring">${acuityRing(counts)}</div><div class="acuity-legend">${[
    ['normal', 'Stable', 'teal'],
    ['warning', 'Attention', 'amber'],
    ['critical', 'Critical', 'red'],
  ]
    .map(
      ([key, label, color]) =>
        `<button class="acuity-row" data-action="stat-filter" data-status="${key}"><span><i class="legend-dot ${color}"></i>${label}</span><strong class="acuity-value">${counts[key]}<small>${total ? Math.round((counts[key] / total) * 100) : 0}%</small></strong></button>`,
    )
    .join(
      '',
    )}</div></div><div class="panel-footnote">${icon('info')} Status follows illustrative demo thresholds.</div></section>`;
}

export function monitorToolbar(state, directory = false) {
  const wards = [...new Set(state.patients.map((patient) => patient.ward))].sort();
  return `<div class="monitor-toolbar"><div class="search-box">${icon('search')}<input id="patient-search" name="search" type="search" placeholder="Search patients, IDs, or beds…" value="${e(state.query)}" aria-label="Search patients" autocomplete="off"><kbd>/</kbd></div><div class="filter-controls"><select class="filter-select" id="status-filter" aria-label="Filter by patient status"><option value="">All statuses</option>${Object.entries(
    STATUS,
  )
    .map(
      ([key, label]) =>
        `<option value="${key}" ${state.statusFilter === key ? 'selected' : ''}>${label}</option>`,
    )
    .join(
      '',
    )}</select><select class="filter-select" id="ward-filter" aria-label="Filter by ward"><option value="">All wards</option>${wards.map((ward) => `<option ${state.wardFilter === ward ? 'selected' : ''}>${e(ward)}</option>`).join('')}</select>${directory ? `<select class="filter-select" id="sort-filter" aria-label="Sort patients"><option value="priority" ${state.sort === 'priority' ? 'selected' : ''}>Priority first</option><option value="name" ${state.sort === 'name' ? 'selected' : ''}>Name A–Z</option><option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest first</option></select>` : ''}<div class="view-toggle" aria-label="Patient display"><button class="icon-button ${state.patientView === 'grid' ? 'active' : ''}" data-action="patient-view" data-mode="grid" aria-label="Card view" aria-pressed="${state.patientView === 'grid'}">${icon('grid')}</button><button class="icon-button ${state.patientView === 'list' ? 'active' : ''}" data-action="patient-view" data-mode="list" aria-label="Table view" aria-pressed="${state.patientView === 'list'}">${icon('list')}</button></div></div></div>`;
}

export function patientCard(patient) {
  const color =
    patient.status === 'critical' ? '#da6572' : patient.status === 'warning' ? '#d99a38' : '#088c87';
  return `<article class="patient-monitor ${patient.status}"><div class="patient-card-header"><div class="patient-person">${patientIdentity(patient)}</div>${statusBadge(patient.status)}</div><div class="patient-condition">${e(patient.condition || 'General observation')}</div><div class="patient-waveform">${sparkline(patient.hr_history || [], color, `spark-${e(patient.patient_id)}`)}</div><div class="patient-vitals"><div class="mini-vital"><span class="vital-label">${icon('heart')} Heart rate</span><span class="vital-number">${patient.heart_rate}<small class="vital-unit">bpm</small></span></div><div class="mini-vital"><span class="vital-label">${icon('drop')} SpO₂</span><span class="vital-number">${patient.oxygen}<small class="vital-unit">%</small></span></div><div class="mini-vital"><span class="vital-label">${icon('pulse')} Blood pressure</span><span class="vital-number vital-bp">${patient.blood_pressure_sys}<span>/</span>${patient.blood_pressure_dia}<small class="vital-unit">mmHg</small></span></div></div><div class="patient-card-footer"><span class="ward-label">${icon('bed')} ${e(patient.ward)} <span>·</span> ${e(patient.bed)}</span><button class="text-link" data-action="open-patient" data-id="${e(patient.patient_id)}" aria-label="View ${e(patient.name)}">View patient ${icon('arrow')}</button></div></article>`;
}

export function patientTable(patients) {
  return `<div class="table-wrap"><table class="patient-table"><caption class="sr-only">Active patient readings and monitoring status</caption><thead><tr><th scope="col">Patient</th><th scope="col">Ward / bed</th><th scope="col">Status</th><th scope="col">Heart rate</th><th scope="col">SpO₂</th><th scope="col">Blood pressure</th><th scope="col">Updated</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${patients.map((patient) => `<tr><td><button class="table-person" data-action="open-patient" data-id="${e(patient.patient_id)}">${patientIdentity(patient, true)}</button></td><td><strong>${e(patient.ward)}</strong><span class="table-secondary">Bed ${e(patient.bed)}</span></td><td>${statusBadge(patient.status)}</td><td>${patient.heart_rate}<small> bpm</small></td><td>${patient.oxygen}<small>%</small></td><td>${patient.blood_pressure_sys}/${patient.blood_pressure_dia}<small> mmHg</small></td><td class="table-secondary">${timeAgo(patient.updated_at)}</td><td>${button('View', 'open-patient', 'chevron', 'btn-ghost btn-sm', `data-id="${e(patient.patient_id)}" aria-label="View ${e(patient.name)}"`)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function patientArea(state, limit = null) {
  const filtered = filterPatients(state);
  const patients = limit ? filtered.slice(0, limit) : filtered;
  if (!patients.length)
    return emptyState(
      state.patients.length ? 'No matching patients' : 'Your workspace is ready',
      state.patients.length
        ? 'Try another search or clear the filters to see everyone.'
        : 'Add your first patient to begin exploring the monitoring workspace.',
      'users',
      state.patients.length
        ? button('Clear filters', 'clear-filters', 'refresh')
        : button('Add patient', 'add-patient', 'plus', 'btn-primary'),
    );
  return `${state.patientView === 'list' ? patientTable(patients) : `<div class="patient-grid">${patients.map(patientCard).join('')}</div>`}${limit && filtered.length > limit ? `<div class="show-all-row">${button(`View all ${filtered.length} patients`, 'view-patients', 'arrow', 'btn-secondary')}</div>` : ''}`;
}

export function alertRow(alert, compact = false) {
  const severity = alert.severity === 'critical' ? 'critical' : 'warning';
  const unit = VITALS.find((vital) => vital.key === alert.vital)?.unit || '';
  const patient =
    alert.active === false
      ? `<strong>${e(alert.patient_name)}</strong>`
      : `<button class="text-link" data-action="open-patient" data-id="${e(alert.patient_id)}">${e(alert.patient_name)}</button>`;
  return `<article class="alert-row ${severity} ${alert.acknowledged ? 'is-acknowledged' : ''}"><span class="alert-symbol">${icon(alert.acknowledged || alert.active === false ? 'checkCircle' : 'alert')}</span><div class="alert-body"><div class="alert-heading">${patient}<span class="alert-time">${timeAgo(alert.created_at)}</span></div><div class="alert-description">${e(alert.message || `${alert.label}: ${alert.value}`)}</div><div class="alert-meta"><span class="alert-severity ${severity}">${severity === 'critical' ? 'Critical' : 'Attention'}</span><span>·</span><span>${e(alert.value)} ${unit}</span><span>·</span><span>${e(alert.patient_id)}</span>${alert.active === false ? '<span>·</span><span>Resolved</span>' : ''}${alert.acknowledged ? `<span>·</span><span>Reviewed ${dateTime(alert.acknowledged_at)}</span>` : ''}</div></div><div class="alert-actions">${alert.acknowledged ? `<span class="reviewed-label">${icon('check')} Reviewed</span>` : `<button class="${compact ? 'icon-button' : 'btn btn-secondary btn-sm'}" data-action="acknowledge-alert" data-id="${e(alert.alert_id)}" aria-label="Mark alert for ${e(alert.patient_name)} as reviewed" title="Mark reviewed">${icon('check')}${compact ? '' : 'Mark reviewed'}</button>`}</div></article>`;
}

function recentAlerts(state) {
  const open = sortAlerts(state.alerts).filter((alert) => alert.active !== false && !alert.acknowledged);
  const alerts = open.slice(0, 3);
  return `<section class="panel"><div class="panel-header"><div><h2 class="panel-title">Needs your review <span class="count-pill">${open.length}</span></h2><p class="panel-subtitle">Most recent unreviewed alerts</p></div><button class="text-link" data-action="view-alerts">View all ${icon('arrow')}</button></div><div class="alert-list">${alerts.length ? alerts.map((alert) => alertRow(alert, true)).join('') : emptyState('All caught up', 'There are no unreviewed alerts in your workspace.', 'checkCircle')}</div></section>`;
}

function recentActivity(state) {
  const latest = [...state.patients]
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 4);
  return `<section class="panel"><div class="panel-header"><div><h2 class="panel-title">Latest readings</h2><p class="panel-subtitle">Recent activity across your wards</p></div><span class="panel-header-icon">${icon('activity')}</span></div><div class="activity-list">${latest.length ? latest.map((patient) => `<div class="activity-item"><span class="activity-dot ${patient.status}">${icon('pulse')}</span><div class="activity-content"><button class="text-link" data-action="open-patient" data-id="${e(patient.patient_id)}">${e(patient.name)}</button><p>Reading received <span>·</span> ${e(patient.ward)}, bed ${e(patient.bed)}</p></div><span class="activity-time">${timeAgo(patient.updated_at)}</span></div>`).join('') : emptyState('No readings yet', 'Your latest patient readings will appear here.', 'activity')}</div><div class="panel-footnote">${icon('clock')} Times are shown in your local timezone.</div></section>`;
}

export function overview(state) {
  const date = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return `${pageHeader(e(date.toUpperCase()), 'A clearer picture of care.', 'Every patient. Every signal. One connected workspace.', button('Export report', 'export', 'download') + button('Add patient', 'add-patient', 'plus', 'btn-primary'))}${demoBanner(state)}${stats(state)}<div class="overview-grid">${trendPanel(state)}${acuityPanel(state)}</div><section class="monitor-section"><div class="section-header"><div><h2 class="section-title">Patient monitors <span class="count-pill">${state.patients.length}</span></h2><p class="section-description">Prioritized by the readings that need attention.</p></div><span class="live-indicator"><span class="status-dot"></span>${state.preferences.autoRefresh ? 'Auto-refresh on' : 'Refresh paused'}</span></div>${monitorToolbar(state)}<div id="patient-area">${patientArea(state, 6)}</div></section><div class="bottom-grid">${recentAlerts(state)}${recentActivity(state)}</div>`;
}

export function patients(state) {
  return `${pageHeader('PATIENT DIRECTORY', 'People at the center of care.', 'Find a patient, review their story, and follow every reading.', button('Export patients', 'export', 'download') + button('Add patient', 'add-patient', 'plus', 'btn-primary'))}${demoBanner(state)}<div class="directory-summary"><span><strong>${state.patients.length}</strong> active patients</span><span><i class="legend-dot teal"></i>${[...new Set(state.patients.map((p) => p.ward))].length} wards</span><span>${icon('shield')} ${state.config.demo_mode ? 'Fictional demo records' : 'Authenticated workspace'}</span></div><section class="directory-panel">${monitorToolbar(state, true)}<div id="patient-area">${patientArea(state)}</div><p class="results-count" id="results-count">Showing ${filterPatients(state).length} of ${state.patients.length} active patients</p></section>`;
}

export function alerts(state) {
  let filtered = sortAlerts(state.alerts).filter(
    (alert) =>
      state.alertFilter === 'all' ||
      (state.alertFilter === 'reviewed' ? alert.acknowledged : alert.active !== false && !alert.acknowledged),
  );
  if (state.alertSeverity) filtered = filtered.filter((alert) => alert.severity === state.alertSeverity);
  const open = state.alerts.filter((alert) => alert.active !== false && !alert.acknowledged);
  return `${pageHeader('STAY AHEAD OF THE SIGNAL', 'A little attention goes a long way.', 'Review threshold alerts and keep a clear record of what you’ve seen.', button('Refresh alerts', 'refresh', 'refresh'))}<div class="alert-summary-grid"><div class="alert-summary-card"><span class="stat-icon red">${icon('bell')}</span><div><strong>${open.length}</strong><span>Unreviewed alerts</span></div></div><div class="alert-summary-card"><span class="stat-icon amber">${icon('users')}</span><div><strong>${new Set(open.map((alert) => alert.patient_id)).size}</strong><span>Patients with open alerts</span></div></div><div class="alert-summary-card"><span class="stat-icon teal">${icon('checkCircle')}</span><div><strong>${state.alerts.filter((alert) => alert.acknowledged).length}</strong><span>Reviewed alerts</span></div></div></div><div class="demo-banner alert-explainer"><span class="banner-icon">${icon('info')}</span><div class="banner-copy">Marking an alert reviewed records your acknowledgement. The patient’s status continues to follow their latest reading.</div></div><section class="panel"><div class="panel-header"><div class="segmented-control">${[
    ['open', 'Unreviewed'],
    ['reviewed', 'Reviewed'],
    ['all', 'All alerts'],
  ]
    .map(
      ([key, label]) =>
        `<button data-action="alert-filter" data-filter="${key}" class="${state.alertFilter === key ? 'active' : ''}" aria-pressed="${state.alertFilter === key}">${label}</button>`,
    )
    .join(
      '',
    )}</div><select class="filter-select" id="alert-severity" aria-label="Filter alerts by severity"><option value="">All severities</option><option value="critical" ${state.alertSeverity === 'critical' ? 'selected' : ''}>Critical</option><option value="warning" ${state.alertSeverity === 'warning' ? 'selected' : ''}>Attention</option></select></div><div class="alert-list alert-list-full">${filtered.length ? filtered.map((alert) => alertRow(alert)).join('') : emptyState('Nothing needs your review here', 'New threshold alerts will appear here as readings are recorded.', 'checkCircle')}</div></section><p class="view-footnote">Showing ${filtered.length} alert${filtered.length === 1 ? '' : 's'}. Alerts are educational threshold flags, not diagnoses.</p>`;
}

export function insights(state) {
  const counts = countPatients(state.patients);
  const wards = [...new Set(state.patients.map((patient) => patient.ward))].sort();
  const means = ['heart_rate', 'oxygen', 'temperature']
    .map((key) => {
      const vital = VITALS.find((item) => item.key === key);
      const values = state.patients.map((patient) => patient[key]).filter(Number.isFinite);
      const value = values.length
        ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))
        : '—';
      return `<article class="insight-card"><div class="stat-top"><span class="stat-label">Average ${vital.label.toLowerCase()}</span><span class="stat-icon teal">${icon(vital.icon)}</span></div><div class="metric-big">${value}<small>${vital.unit}</small></div><p>Latest reading across ${values.length} active patients</p></article>`;
    })
    .join('');
  return `${pageHeader('A WIDER PERSPECTIVE', 'See the patterns behind the signals.', 'A descriptive snapshot of your active monitoring workspace.', button('Export snapshot', 'export', 'download'))}<div class="insights-grid">${means}</div><div class="overview-grid">${trendPanel(state, 'insights')}${acuityPanel(state)}</div><div class="bottom-grid"><section class="panel"><div class="panel-header"><div><h2 class="panel-title">Across your wards</h2><p class="panel-subtitle">Patient distribution and current status</p></div><span class="panel-header-icon">${icon('bed')}</span></div><div class="ward-list">${
    wards.length
      ? wards
          .map((ward) => {
            const patients = state.patients.filter((p) => p.ward === ward);
            const wardCounts = countPatients(patients);
            return `<div class="ward-row"><div class="ward-heading"><button class="text-link" data-action="ward-patients" data-ward="${e(ward)}">${e(ward)}</button><span>${patients.length} patient${patients.length === 1 ? '' : 's'}</span></div><div class="ward-stacked-bar" role="img" aria-label="${e(ward)}: ${wardCounts.normal} stable, ${wardCounts.warning} attention, ${wardCounts.critical} critical">${['normal', 'warning', 'critical'].map((status) => `<span class="${status}" style="width:${(wardCounts[status] / patients.length) * 100}%"></span>`).join('')}</div><div class="ward-caption">${wardCounts.normal} stable <span>·</span> ${wardCounts.warning} attention <span>·</span> ${wardCounts.critical} critical</div></div>`;
          })
          .join('')
      : emptyState('No active wards', 'Ward distribution appears when patients are added.', 'bed')
  }</div></section><section class="panel"><div class="panel-header"><div><h2 class="panel-title">About these insights</h2><p class="panel-subtitle">Useful context for a clearer picture</p></div><span class="panel-header-icon">${icon('info')}</span></div><div class="insight-context"><div>${icon('chart')}<div><h3>Descriptive, never predictive</h3><p>Averages describe stored readings. They do not predict outcomes or establish a diagnosis.</p></div></div><div>${icon('clock')}<div><h3>A rolling view of the readings</h3><p>Trend charts use the most recent available history, rather than a fixed reporting period. Hover over a point to inspect its value.</p></div></div><div>${icon('shield')}<div><h3>Built for learning</h3><p>${state.config.demo_mode ? 'This workspace uses fictional patients and simulated readings. ' : ''}Thresholds are illustrative and are not a validated clinical scoring system.</p></div></div></div></section></div><p class="view-footnote">${state.patients.length} active patients · ${counts.critical} critical flags · Updated ${state.lastSync ? dateTime(state.lastSync) : '—'}</p>`;
}

function settingSwitch(id, label, caption, checked) {
  return `<div class="setting-row"><div><h3>${label}</h3><p class="setting-description">${caption}</p></div><label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} aria-label="${label}"><span></span></label></div>`;
}

export function settings(state) {
  return `${pageHeader('MAKE YOURSELF AT HOME', 'Your workspace, your way.', 'Small preferences that make monitoring feel more natural.')}<div class="settings-grid"><section class="panel settings-section"><div class="panel-header"><div><h2 class="panel-title">Workspace preferences</h2><p class="panel-subtitle">Saved on this browser</p></div><span class="panel-header-icon">${icon('settings')}</span></div>${settingSwitch('setting-refresh', 'Automatic refresh', `Fetch the latest stored readings every ${state.config.refresh_interval || 10} seconds. Pausing changes this browser only.`, state.preferences.autoRefresh)}${settingSwitch('setting-dark', 'Dark appearance', 'Use a darker palette with the same clear status colors.', state.preferences.theme === 'dark')}${settingSwitch('setting-sound', 'Sound for new critical alerts', 'A brief tone when a new critical alert arrives. Off by default.', state.preferences.sound)}<div class="setting-row"><div><h3>Start with a clean view</h3><p class="setting-description">Reset search, filters, and display preferences.</p></div>${button('Reset', 'reset-preferences', 'refresh', 'btn-secondary btn-sm')}</div></section><section class="panel settings-section"><div class="panel-header"><div><h2 class="panel-title">Workspace information</h2><p class="panel-subtitle">The things behind the scenes</p></div><span class="panel-header-icon">${icon('shield')}</span></div><dl class="workspace-info"><div><dt>Workspace mode</dt><dd>${state.config.demo_mode ? '<span class="info-tag">Fictional demo</span>' : '<span class="info-tag">Protected workspace</span>'}</dd></div><div><dt>Application version</dt><dd>${e(state.config.version || '2.0.0')}</dd></div><div><dt>Reading source</dt><dd>${state.config.demo_mode ? 'Demo simulator + manual entries' : 'Manual entries / sensor API'}</dd></div><div><dt>AI summaries</dt><dd>${state.config.ai_configured ? 'Groq configured · on demand' : 'Local rule-based summaries'}</dd></div><div><dt>Storage</dt><dd>SQLite · server-side persistence</dd></div><div><dt>Last synchronized</dt><dd>${state.lastSync ? dateTime(state.lastSync) : '—'}</dd></div></dl></section><section class="panel settings-section"><div class="panel-header"><div><h2 class="panel-title">Data & exports</h2><p class="panel-subtitle">Take your workspace snapshot with you</p></div><span class="panel-header-icon">${icon('download')}</span></div><div class="settings-content"><p>Download the current active patient readings as a CSV file. Exports include names, ward assignments, status, and latest vitals.</p>${button('Download patient CSV', 'export', 'download', 'btn-primary')}<p class="form-hint">Exports reflect stored readings at download time. Browser preferences do not affect server data.</p></div></section><section class="panel settings-section"><div class="panel-header"><div><h2 class="panel-title">Thoughtful use</h2><p class="panel-subtitle">An educational project with clear boundaries</p></div><span class="panel-header-icon">${icon('info')}</span></div><div class="settings-content"><p>MediWatch is a learning and portfolio application. It is not a medical device, emergency service, or substitute for a qualified clinician.</p><p>AI summaries are optional, generated only when requested, and may be inaccurate. ${state.config.ai_configured ? 'Generating a summary sends deidentified vital readings to Groq. Names and patient IDs are excluded.' : 'Without an API key, summaries are generated locally from illustrative thresholds.'}</p><a class="text-link" href="https://github.com/guptavernit2-afk/MediWatch" target="_blank" rel="noopener noreferrer">Explore the project ${icon('external')}</a></div></section></div>`;
}

export function lockedView(message = '') {
  return `${pageHeader('PROTECTED WORKSPACE', 'Connect to your workspace.', 'Enter the access token configured by the server administrator.')}<section class="panel auth-panel"><div class="empty-icon">${icon('lock')}</div><h2>Workspace access</h2><p>The token is held in memory for this session and sent only to this application.</p><form id="token-form"><label class="field">Access token<input type="password" name="token" required autocomplete="off" placeholder="Enter your workspace token"></label><p class="form-error" role="alert">${e(message)}</p>${button('Connect workspace', '', 'arrow', 'btn-primary', 'type="submit"')}</form></section>`;
}

export function errorView(message) {
  return `${pageHeader('LET’S RECONNECT', 'Your workspace is a refresh away.', 'We couldn’t retrieve the latest workspace data.')}<section class="panel">${emptyState('Connection interrupted', message, 'refresh', button('Try again', 'refresh', 'refresh', 'btn-primary'))}</section>`;
}
