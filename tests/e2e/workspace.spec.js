import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A clearer picture of care.' })).toBeVisible();
  await expect(page.locator('.patient-monitor')).toHaveCount(6);
});

test('overview charts, metric controls, theme and export are functional', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByText("You're exploring the demo workspace.")).toBeVisible();
  await expect(page.locator('.stat-value').first()).toHaveText('08');
  await expect(page.locator('.chart-svg')).toHaveAttribute('aria-label', /Average Heart rate/);
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'SpO₂', exact: true }).click();
  await expect(page.locator('.chart-svg')).toHaveAttribute('aria-label', /Oxygen saturation/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^mediwatch-patients-.*\.csv$/);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/overview-dark.png', fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('directory search, combined filters, table view and empty state work', async ({ page }) => {
  await page.locator('a[data-view="patients"]').click();
  await expect(page.locator('.patient-monitor')).toHaveCount(8);
  await page.getByRole('searchbox', { name: 'Search patients' }).fill('Raj Sharma');
  await expect(page.locator('.patient-monitor')).toHaveCount(1);
  await page.getByLabel('Filter by patient status').selectOption('critical');
  await expect(page.getByRole('heading', { name: 'No matching patients' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.patient-monitor')).toHaveCount(8);
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.locator('.patient-table tbody tr')).toHaveCount(8);
  await page.getByLabel('Filter by ward').selectOption('ICU');
  await expect(page.locator('.patient-table tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Card view' }).click();
  await expect(page.locator('.patient-monitor')).toHaveCount(2);
});

test('alert review persists and does not change patient acuity', async ({ page }) => {
  await page.locator('a[data-view="alerts"]').click();
  const before = await page.locator('.alert-list-full .alert-row').count();
  expect(before).toBeGreaterThan(0);
  await page.locator('.alert-list-full [data-action="acknowledge-alert"]').first().click();
  await expect(page.locator('.alert-list-full .alert-row')).toHaveCount(before - 1);
  await page.getByRole('button', { name: 'Reviewed', exact: true }).click();
  await expect(page.locator('.reviewed-label').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A little attention goes a long way.' })).toBeVisible();
  await page.getByRole('button', { name: 'Reviewed', exact: true }).click();
  await expect(page.locator('.alert-list-full .is-acknowledged')).toHaveCount(1);
  const patients = await (await page.request.get('/api/patients')).json();
  expect(patients.filter((patient) => patient.status === 'critical')).toHaveLength(2);
});

test('patient admission, observations, readings, summary and discharge form a complete workflow', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add patient', exact: true }).click();
  await page.getByLabel('Full name').fill('UI Test Person');
  await page.getByLabel('Age', { exact: true }).fill('36');
  await page.getByLabel('Bed identifier').fill('UI-001');
  await page.getByLabel('Observation context').fill('Fictional browser regression record');
  await page.locator('#patient-form button[type="submit"]').click();
  const drawer = page.getByRole('dialog', { name: 'A closer look.' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('UI Test Person', { exact: true })).toBeVisible();
  await drawer.getByRole('tab', { name: /Observations/ }).click();
  await drawer
    .getByLabel('Observation', { exact: true })
    .fill('Fictional observation saved during an end-to-end test.');
  await drawer.getByRole('button', { name: 'Save observation' }).click();
  await expect(drawer.locator('.note-text')).toContainText([
    'Fictional observation saved during an end-to-end test.',
  ]);
  await drawer.getByRole('tab', { name: 'Overview', exact: true }).click();
  await drawer.getByRole('button', { name: 'Record reading' }).click();
  await page.locator('#reading-form [name="oxygen"]').fill('88.6');
  await page.getByRole('button', { name: 'Save reading' }).click();
  await expect(drawer.locator('.status-badge')).toHaveText('Critical');
  await drawer.getByRole('button', { name: 'Refresh local summary' }).click();
  await expect(drawer.locator('.summary-time')).toBeVisible();
  await drawer.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(drawer.locator('.history-table tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close patient details' }).click();
  await page.reload();
  await page.locator('a[data-view="patients"]').click();
  await page.getByRole('searchbox', { name: 'Search patients' }).fill('UI Test Person');
  await page.getByRole('button', { name: 'View UI Test Person', exact: true }).click();
  await drawer.getByRole('tab', { name: /Observations/ }).click();
  await expect(drawer.locator('.note-text')).toContainText([
    'Fictional observation saved during an end-to-end test.',
  ]);
  await drawer.getByRole('tab', { name: 'Overview', exact: true }).click();
  await drawer.getByRole('button', { name: 'Discharge patient', exact: true }).click();
  await page.locator('#discharge-form button[type="submit"]').click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'No matching patients' })).toBeVisible();
});

test('mobile navigation, drawer focus and responsive page widths work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar')).not.toBeInViewport();
  await page.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.locator('.sidebar')).toBeInViewport();
  await page.locator('a[data-view="patients"]').click();
  await expect(page.locator('body')).not.toHaveClass(/sidebar-open/);
  await page.locator('[data-action="open-patient"]').first().click();
  const drawer = page.locator('#patient-drawer');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keyboard shortcuts, tab navigation and settings preferences work', async ({ page }) => {
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search patients' })).toBeFocused();
  await page.getByRole('searchbox', { name: 'Search patients' }).fill('Amit');
  await page.locator('[data-action="open-patient"]').first().click();
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Observations/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await page.locator('a[data-view="settings"]').click();
  await page.getByRole('checkbox', { name: 'Automatic refresh' }).uncheck();
  await expect(page.locator('#connection-label')).toHaveText('Refresh paused');
  await page.getByRole('checkbox', { name: 'Dark appearance' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Automatic refresh' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
