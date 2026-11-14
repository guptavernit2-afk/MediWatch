import { test, expect } from '@playwright/test';

const INITIAL_READING = '2026-11-15T08:00:00.000Z';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixturePatient() {
  const vitals = {
    heart_rate: 76,
    oxygen: 98,
    blood_pressure_sys: 118,
    blood_pressure_dia: 76,
    temperature: 36.7,
    respiratory_rate: 16,
  };
  return {
    patient_id: 'P001',
    name: 'Async Demo Person',
    age: 42,
    sex: 'Female',
    ward: 'General',
    bed: 'G-101',
    condition: 'Fictional async-state regression record',
    admitted_at: INITIAL_READING,
    updated_at: INITIAL_READING,
    status: 'normal',
    anomalies: [],
    ...vitals,
    hr_history: [76],
    history: [{ timestamp: INITIAL_READING, ...vitals }],
    recommendation: 'Local monitoring summary for the current fictional reading.',
  };
}

// Mock every API call used here. No test mutates the shared demo database.
async function mockWorkspace(page, { protectedMode = false } = {}) {
  const workspace = {
    patient: fixturePatient(),
    failNextPatientFetch: false,
    summaryHandler: null,
    summaryText: 'CURRENT_MONITORING_SUMMARY',
    protectedRequests: [],
    token: 'correct-fictional-workspace-token',
  };
  await page.addInitScript(() => {
    localStorage.setItem('mediwatch.preferences', JSON.stringify({ autoRefresh: false }));
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (json, status = 200) => route.fulfill({ status, json });
    if (path === '/api/config')
      return respond({
        demo_mode: !protectedMode,
        auth_required: protectedMode,
        ai_configured: false,
        refresh_interval: 10,
        version: '2.0.0',
      });
    if (protectedMode) {
      const authorization = request.headers().authorization || '';
      workspace.protectedRequests.push({ path, authorization });
      if (authorization !== `Bearer ${workspace.token}`)
        return respond({ detail: 'A valid API access token is required.' }, 401);
    }
    if (path === '/api/patients' && request.method() === 'GET') {
      if (workspace.failNextPatientFetch) {
        workspace.failNextPatientFetch = false;
        return route.abort('failed');
      }
      return respond([workspace.patient]);
    }
    if (path === '/api/alerts') return respond([]);
    if (path === '/api/summary')
      return respond({
        total: 1,
        normal: workspace.patient.status === 'normal' ? 1 : 0,
        warning: 0,
        critical: workspace.patient.status === 'critical' ? 1 : 0,
        active_alerts: 0,
        refreshed_at: workspace.patient.updated_at,
      });
    if (path === '/api/patients/P001' && request.method() === 'GET') return respond(workspace.patient);
    if (path === '/api/patients/P001/notes') return respond([]);
    if (path === '/api/patients/P001/readings') {
      const vitals = request.postDataJSON();
      const timestamp = new Date(Date.parse(workspace.patient.updated_at) + 60_000).toISOString();
      workspace.patient = {
        ...workspace.patient,
        ...vitals,
        updated_at: timestamp,
        history: [...workspace.patient.history, { timestamp, ...vitals }],
        hr_history: [...workspace.patient.hr_history, vitals.heart_rate],
      };
      return respond(workspace.patient, 201);
    }
    if (path === '/api/patients/P001/summary') {
      const snapshot = structuredClone(workspace.patient);
      const result = workspace.summaryHandler
        ? await workspace.summaryHandler(snapshot)
        : {
            summary: workspace.summaryText,
            source: 'rules',
            generated_at: snapshot.updated_at,
            reading_at: snapshot.updated_at,
          };
      return respond(result);
    }
    return respond({ detail: `Unexpected test API request: ${path}` }, 404);
  });
  return workspace;
}

async function openPatient(page) {
  await page.locator('.patient-monitor [data-action="open-patient"]').click();
  const drawer = page.locator('#patient-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.patient-name')).toHaveText('Async Demo Person');
  await expect(drawer.getByRole('button', { name: 'Refresh local summary' })).toBeEnabled();
  return drawer;
}

async function settleResponse(page, responsePromise) {
  const response = await responsePromise;
  await response.finished();
  // Give the fetch continuation and its DOM update a bounded rendering turn.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('a delayed summary cannot populate a closed and reopened patient drawer', async ({ page }) => {
  const workspace = await mockWorkspace(page);
  const requested = deferred(),
    release = deferred();
  workspace.summaryHandler = async (snapshot) => {
    requested.resolve();
    await release.promise;
    return {
      summary: 'STALE_CLOSED_DRAWER_SUMMARY',
      source: 'rules',
      generated_at: INITIAL_READING,
      reading_at: snapshot.updated_at,
    };
  };
  try {
    await page.goto('/');
    let drawer = await openPatient(page);
    await drawer.getByRole('button', { name: 'Refresh local summary' }).click();
    await requested.promise;
    await drawer.getByRole('button', { name: 'Close patient details' }).click();
    drawer = await openPatient(page);
    const response = page.waitForResponse('**/api/patients/P001/summary');
    release.resolve();
    await settleResponse(page, response);
    await expect(drawer.locator('.summary-box')).not.toContainText('STALE_CLOSED_DRAWER_SUMMARY');
    await expect(drawer.locator('.summary-time')).toHaveCount(0);
    workspace.summaryHandler = null;
    await drawer.getByRole('button', { name: 'Refresh local summary' }).click();
    await expect(drawer.locator('.summary-box')).toContainText('CURRENT_MONITORING_SUMMARY');
  } finally {
    release.resolve();
  }
});

test('new readings discard in-flight summaries and clear previously generated summaries', async ({
  page,
}) => {
  const workspace = await mockWorkspace(page);
  const requested = deferred(),
    release = deferred();
  workspace.summaryHandler = async (snapshot) => {
    requested.resolve();
    await release.promise;
    return {
      summary: 'STALE_READING_SUMMARY',
      source: 'rules',
      generated_at: INITIAL_READING,
      reading_at: snapshot.updated_at,
    };
  };
  try {
    await page.goto('/');
    const drawer = await openPatient(page);
    await drawer.getByRole('button', { name: 'Refresh local summary' }).click();
    await requested.promise;
    await drawer.getByRole('button', { name: 'Record reading' }).click();
    await page.locator('#reading-form [name="heart_rate"]').fill('82');
    await page.getByRole('button', { name: 'Save reading' }).click();
    await expect(page.locator('#reading-form')).not.toBeVisible();
    const response = page.waitForResponse('**/api/patients/P001/summary');
    release.resolve();
    await settleResponse(page, response);
    await expect(drawer.locator('.summary-box')).not.toContainText('STALE_READING_SUMMARY');
    await expect(drawer.locator('.summary-time')).toHaveCount(0);
    await expect(page.locator('#toast-region')).toContainText('A newer reading arrived');

    workspace.summaryHandler = null;
    await drawer.getByRole('button', { name: 'Refresh local summary' }).click();
    await expect(drawer.locator('.summary-box')).toContainText('CURRENT_MONITORING_SUMMARY');
    await expect(drawer.locator('.summary-time')).toBeVisible();
    await drawer.getByRole('button', { name: 'Record reading' }).click();
    await page.locator('#reading-form [name="heart_rate"]').fill('84');
    await page.getByRole('button', { name: 'Save reading' }).click();
    await expect(drawer.locator('.summary-time')).toHaveCount(0);
    await expect(drawer.locator('.summary-box')).not.toContainText('CURRENT_MONITORING_SUMMARY');
  } finally {
    release.resolve();
  }
});

test('a temporary network failure retains the last snapshot and refresh recovers', async ({ page }) => {
  const workspace = await mockWorkspace(page);
  await page.goto('/');
  await expect(page.locator('.patient-monitor .patient-name')).toHaveText('Async Demo Person');
  workspace.failNextPatientFetch = true;
  await page.getByRole('button', { name: 'Refresh readings', exact: true }).click();
  await expect(page.locator('#connection-label')).toHaveText('Connection interrupted');
  await expect(page.locator('.patient-monitor .patient-name')).toHaveText('Async Demo Person');
  await expect(page.locator('#toast-region')).toContainText('Cannot reach the server');
  await expect(page.getByRole('heading', { name: 'A clearer picture of care.' })).toBeVisible();
  workspace.patient = { ...workspace.patient, name: 'Recovered Demo Person' };
  await page.getByRole('button', { name: 'Refresh readings', exact: true }).click();
  await expect(page.locator('.patient-monitor .patient-name')).toHaveText('Recovered Demo Person');
  await expect(page.locator('#connection-label')).toHaveText('Refresh paused');
});

test('protected workspaces reject an invalid token, accept a valid one, and forget it on reload', async ({
  page,
}) => {
  const workspace = await mockWorkspace(page, { protectedMode: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Connect to your workspace.' })).toBeVisible();
  expect(workspace.protectedRequests).toHaveLength(0);
  await page.getByLabel('Access token', { exact: true }).fill('incorrect-fictional-token');
  await page.getByRole('button', { name: 'Connect workspace' }).click();
  await expect(page.locator('#token-form .form-error')).toContainText('access token was rejected');
  await expect(page.locator('.patient-monitor')).toHaveCount(0);
  await page.getByLabel('Access token', { exact: true }).fill(workspace.token);
  await page.getByRole('button', { name: 'Connect workspace' }).click();
  await expect(page.locator('.patient-monitor .patient-name')).toHaveText('Async Demo Person');
  await expect(page.locator('#workspace-name')).toHaveText('Protected workspace');
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  expect(
    workspace.protectedRequests.some(
      (request) => request.authorization === 'Bearer incorrect-fictional-token',
    ),
  ).toBe(true);
  expect(
    workspace.protectedRequests.some((request) => request.authorization === `Bearer ${workspace.token}`),
  ).toBe(true);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(workspace.token);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connect to your workspace.' })).toBeVisible();
  await expect(page.locator('.patient-monitor')).toHaveCount(0);
});
