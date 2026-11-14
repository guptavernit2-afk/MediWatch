import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateSeries, lineChart, sparkline, acuityRing } from '../web/charts.js';
import {
  escapeHtml,
  filterPatients,
  countPatients,
  sortAlerts,
  statusBadge,
  timeAgo,
  dateTime,
} from '../web/helpers.js';
import { drawer, readingForm, dischargeForm, chartData } from '../web/detail.js';
import * as views from '../web/views.js';

const timestamp = '2026-11-15T08:00:00.000Z';

function patient(overrides = {}) {
  return {
    patient_id: 'P001',
    name: 'Demo Person',
    age: 42,
    sex: 'Female',
    ward: 'General',
    bed: 'G-101',
    condition: 'Observation',
    admitted_at: timestamp,
    updated_at: timestamp,
    status: 'normal',
    heart_rate: 76,
    oxygen: 98,
    blood_pressure_sys: 118,
    blood_pressure_dia: 76,
    temperature: 36.7,
    respiratory_rate: 16,
    anomalies: [],
    history: [
      {
        timestamp,
        heart_rate: 76,
        oxygen: 98,
        blood_pressure_sys: 118,
        blood_pressure_dia: 76,
        temperature: 36.7,
        respiratory_rate: 16,
      },
    ],
    hr_history: [74, 76],
    recommendation: 'Fictional readings for review.',
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    patients: [],
    alerts: [],
    config: { demo_mode: true, ai_configured: false, refresh_interval: 10, version: '2.0.0' },
    preferences: { autoRefresh: true, theme: 'light', sound: false },
    query: '',
    statusFilter: '',
    wardFilter: '',
    sort: 'priority',
    patientView: 'grid',
    chartMetric: 'heart_rate',
    alertFilter: 'open',
    alertSeverity: '',
    bannerDismissed: false,
    selectedPatient: null,
    drawerTab: 'overview',
    drawerMetric: 'heart_rate',
    drawerSummary: null,
    notes: [],
    notesLoading: false,
    summaryLoading: false,
    lastSync: timestamp,
    ...overrides,
  };
}

function assertSafeHtml(html, unsafe) {
  assert.ok(!html.includes(unsafe), 'raw untrusted markup must not reach rendered HTML');
  assert.ok(html.includes(escapeHtml(unsafe)), 'untrusted text should remain readable after escaping');
}

test('escaping covers text and quoted attribute boundaries without dropping content', () => {
  assert.equal(
    escapeHtml(`<script a="x">O'Reilly & Co</script>`),
    '&lt;script a=&quot;x&quot;&gt;O&#39;Reilly &amp; Co&lt;/script&gt;',
  );
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(0), '0');
});

test('patient names, context, ward and bed are escaped in cards, tables and profile actions', () => {
  const unsafe = `<img src=x onerror="alert('test')">`;
  const record = patient({ name: unsafe, condition: unsafe, ward: unsafe, bed: unsafe });
  for (const html of [
    views.patientCard(record),
    views.patientTable([record]),
    drawer(state({ selectedPatient: record })),
    readingForm(record),
    dischargeForm(record),
    chartData(state({ patients: [record] })),
  ])
    assertSafeHtml(html, unsafe);
});

test('notes and generated summaries remain plain escaped text', () => {
  const unsafe = `<script>alert("test")</script>`;
  const record = patient();
  const notes = drawer(
    state({
      selectedPatient: record,
      drawerTab: 'notes',
      notes: [{ content: unsafe, author: unsafe, created_at: timestamp }],
    }),
  );
  const summary = drawer(
    state({
      selectedPatient: record,
      drawerSummary: {
        summary: unsafe,
        source: 'groq',
        generated_at: timestamp,
      },
    }),
  );
  assertSafeHtml(notes, unsafe);
  assertSafeHtml(summary, unsafe);
});

test('record form accepts fractional simulator oxygen and the backend numeric bounds', () => {
  const html = readingForm(
    patient({
      heart_rate: 250,
      oxygen: 97.8,
      blood_pressure_sys: 300,
      blood_pressure_dia: 200,
      temperature: 43,
      respiratory_rate: 70,
    }),
  );
  const inputs = [...html.matchAll(/<input\b([^>]+)>/g)]
    .map((match) =>
      Object.fromEntries(
        [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]]),
      ),
    )
    .filter((input) => input.type === 'number');
  assert.equal(inputs.length, 6);
  for (const input of inputs) {
    const value = Number(input.value),
      min = Number(input.min),
      max = Number(input.max),
      step = Number(input.step);
    assert.ok(value >= min && value <= max, `${input.name} should accept valid API values`);
    const steps = (value - min) / step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-8, `${input.name} has an invalid native browser step`);
  }
});

test('alert messages, patient names and access errors are escaped', () => {
  const unsafe = `"><svg onload="alert('test')">`;
  const alert = {
    alert_id: 'A001',
    patient_id: 'P001',
    patient_name: unsafe,
    message: unsafe,
    severity: 'critical',
    acknowledged: false,
    created_at: timestamp,
  };
  assertSafeHtml(views.alertRow(alert), unsafe);
  assertSafeHtml(views.lockedView(unsafe), unsafe);
  assertSafeHtml(views.errorView(unsafe), unsafe);
});

test('search matches all useful patient fields regardless of case and outer whitespace', () => {
  const records = [
    patient({
      name: 'Ananya Mehta',
      patient_id: 'P042',
      ward: 'Cardiology',
      bed: 'C-17',
      condition: 'Post-procedure observation',
    }),
  ];
  for (const query of [' ANANYA ', 'p042', 'CARDIOLOGY', 'c-17', 'post-procedure']) {
    assert.equal(filterPatients(state({ patients: records, query })).length, 1, query);
  }
  assert.deepEqual(filterPatients(state({ patients: records, query: 'not-present' })), []);
});

test('status and ward filters combine with search and sorting never mutates input', () => {
  const records = [
    patient({ patient_id: 'P001', name: 'Zara', status: 'normal', ward: 'General' }),
    patient({ patient_id: 'P002', name: 'Beena', status: 'critical', ward: 'ICU' }),
    patient({ patient_id: 'P003', name: 'Amit', status: 'critical', ward: 'ICU' }),
    patient({ patient_id: 'P004', name: 'Dev', status: 'warning', ward: 'General' }),
  ];
  const original = records.map((record) => record.patient_id);
  assert.deepEqual(
    filterPatients(state({ patients: records })).map((record) => record.name),
    ['Amit', 'Beena', 'Dev', 'Zara'],
  );
  assert.deepEqual(
    filterPatients(
      state({ patients: records, wardFilter: 'ICU', statusFilter: 'critical', query: 'beena' }),
    ).map((record) => record.name),
    ['Beena'],
  );
  assert.deepEqual(
    filterPatients(state({ patients: records, wardFilter: 'General', statusFilter: 'critical' })),
    [],
  );
  assert.deepEqual(
    records.map((record) => record.patient_id),
    original,
  );
});

test('directory sort supports alphabetical and newest admissions', () => {
  const records = [
    patient({ name: 'Zara', admitted_at: '2026-11-15T09:00:00Z' }),
    patient({ name: 'Amit', admitted_at: '2026-11-15T10:00:00Z' }),
    patient({ name: 'Beena', admitted_at: '2026-11-15T08:00:00Z' }),
  ];
  assert.deepEqual(
    filterPatients(state({ patients: records, sort: 'name' })).map((record) => record.name),
    ['Amit', 'Beena', 'Zara'],
  );
  assert.deepEqual(
    filterPatients(state({ patients: records, sort: 'newest' })).map((record) => record.name),
    ['Amit', 'Zara', 'Beena'],
  );
});

test('status counts and badges provide all three readable categories', () => {
  assert.deepEqual(
    countPatients([
      patient(),
      patient({ status: 'warning' }),
      patient({ status: 'critical' }),
      patient({ status: 'unknown' }),
    ]),
    { normal: 1, warning: 1, critical: 1 },
  );
  assert.match(statusBadge('normal'), /Stable/);
  assert.match(statusBadge('warning'), /Attention/);
  assert.match(statusBadge('critical'), /Critical/);
  assert.doesNotMatch(statusBadge('<script>'), /<script>/);
});

test('empty workspace views stay useful and never render invalid numeric values', () => {
  for (const name of Object.keys(views.labels)) {
    const html = views[name](state());
    assert.ok(html.includes('<h1'), `${name} needs an accessible page heading`);
    assert.doesNotMatch(html, /\bNaN\b|\bundefined\b|Infinity/, name);
  }
  assert.match(views.patientArea(state()), /Add your first patient/);
  assert.match(views.patientArea(state({ patients: [patient()], query: 'missing' })), /No matching patients/);
  assert.match(drawer(state()), /Loading patient/);
});

test('alert view combines review state and severity without leaking filtered rows', () => {
  const records = [
    {
      alert_id: 'A001',
      patient_id: 'P001',
      patient_name: 'UnreviewedCritical',
      severity: 'critical',
      acknowledged: false,
      active: true,
      created_at: timestamp,
    },
    {
      alert_id: 'A002',
      patient_id: 'P002',
      patient_name: 'ReviewedCritical',
      severity: 'critical',
      acknowledged: true,
      active: true,
      created_at: timestamp,
      acknowledged_at: timestamp,
    },
    {
      alert_id: 'A003',
      patient_id: 'P003',
      patient_name: 'UnreviewedWarning',
      severity: 'warning',
      acknowledged: false,
      active: true,
      created_at: timestamp,
    },
  ];
  const critical = views.alerts(state({ alerts: records, alertSeverity: 'critical' }));
  assert.match(critical, />UnreviewedCritical</);
  assert.doesNotMatch(critical, />ReviewedCritical<|>UnreviewedWarning</);
  const reviewed = views.alerts(state({ alerts: records, alertFilter: 'reviewed' }));
  assert.match(reviewed, />ReviewedCritical</);
  assert.doesNotMatch(reviewed, />UnreviewedCritical<|>UnreviewedWarning</);
});

test('resolved alerts remain in history without returning to the open review queue', () => {
  const resolved = {
    alert_id: 'A001',
    patient_id: 'P001',
    patient_name: 'ResolvedPatient',
    message: 'Oxygen flag resolved by a later reading.',
    severity: 'critical',
    active: false,
    acknowledged: false,
    created_at: timestamp,
  };
  assert.doesNotMatch(views.alerts(state({ alerts: [resolved] })), />ResolvedPatient</);
  assert.match(views.alerts(state({ alerts: [resolved], alertFilter: 'all' })), />ResolvedPatient</);
});

test('timestamp aggregation averages the latest reading per patient in each minute', () => {
  const result = aggregateSeries(
    [
      {
        history: [
          { timestamp: '2026-11-15T08:00:02Z', heart_rate: 70 },
          { timestamp: '2026-11-15T08:00:48Z', heart_rate: 90 },
          { timestamp: '2026-11-15T08:01:10Z', heart_rate: 100 },
        ],
      },
      {
        history: [
          { timestamp: '2026-11-15T07:59:51Z', heart_rate: 50 },
          { timestamp: '2026-11-15T08:00:39Z', heart_rate: 80 },
        ],
      },
    ],
    'heart_rate',
  );
  assert.deepEqual(
    result.map((point) => point.value),
    [50, 85, 100],
  );
  assert.deepEqual(
    result.map((point) => point.count),
    [1, 2, 1],
  );
  assert.deepEqual(
    result.map((point) => new Date(point.timestamp).toISOString()),
    ['2026-11-15T07:59:00.000Z', '2026-11-15T08:00:00.000Z', '2026-11-15T08:01:00.000Z'],
  );
});

test('aggregation uses timestamps rather than the order in which history arrived', () => {
  const result = aggregateSeries(
    [
      {
        patient_id: 'P001',
        history: [
          { timestamp: '2026-11-15T08:00:58Z', heart_rate: 90 },
          { timestamp: '2026-11-15T08:00:10Z', heart_rate: 70 },
        ],
      },
    ],
    'heart_rate',
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 90);
});

test('aggregation handles missing histories, invalid timestamps and non-finite measurements', () => {
  const result = aggregateSeries(
    [
      {},
      { history: [] },
      {
        history: [
          { timestamp, oxygen: 98 },
          { timestamp: 'invalid', oxygen: 99 },
          { timestamp: '2026-11-15T08:01:00Z', oxygen: NaN },
        ],
      },
      {
        history: [
          { timestamp, oxygen: 96 },
          { timestamp: '2026-11-15T08:01:00Z', heart_rate: 70 },
        ],
      },
    ],
    'oxygen',
  );
  assert.deepEqual(
    result.map((point) => point.value),
    [97],
  );
  assert.deepEqual(aggregateSeries([], 'heart_rate'), []);
  assert.ok(
    result.every(
      (point) => Number.isFinite(point.value) && Number.isFinite(new Date(point.timestamp).valueOf()),
    ),
  );
});

test('empty, flat, single-point and partially missing charts have finite SVG coordinates', () => {
  const charts = [
    sparkline([]),
    sparkline([76]),
    sparkline([76, NaN, undefined, 76, Infinity]),
    lineChart([]),
    lineChart([{ timestamp, value: 76 }]),
    lineChart([
      { timestamp, value: 76 },
      { timestamp, value: NaN },
      { timestamp, value: 76 },
    ]),
    lineChart(
      [
        { timestamp, value: 98 },
        { timestamp, value: 98 },
      ],
      { metric: 'oxygen', unit: '%' },
    ),
    acuityRing({ normal: 0, warning: 0, critical: 0 }),
    acuityRing({ normal: 4, warning: 2, critical: 2 }),
  ];
  for (const html of charts) assert.doesNotMatch(html, /\bNaN\b|\bundefined\b|Infinity/);
  assert.match(charts[1], /role="img"/);
  assert.match(charts[8], /4 stable, 2 need attention, 2 critical/);
});

test('invalid dates and absent readings receive readable fallback labels', () => {
  assert.equal(timeAgo(null), 'No reading');
  assert.equal(timeAgo('invalid'), 'Unknown time');
  assert.equal(dateTime('invalid'), '—');
});

test('review queue puts active unreviewed critical alerts first without changing history', () => {
  const alerts = [
    { alert_id: 'warning', active: true, acknowledged: false, severity: 'warning', created_at: timestamp },
    { alert_id: 'resolved', active: false, acknowledged: false, severity: 'critical', created_at: timestamp },
    { alert_id: 'reviewed', active: true, acknowledged: true, severity: 'critical', created_at: timestamp },
    { alert_id: 'critical', active: true, acknowledged: false, severity: 'critical', created_at: timestamp },
  ];
  assert.deepEqual(
    sortAlerts(alerts).map((alert) => alert.alert_id),
    ['critical', 'warning', 'reviewed', 'resolved'],
  );
  assert.equal(alerts[0].alert_id, 'warning');
});
