import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const compactViolations = (results) =>
  results.violations.map(({ id, nodes }) => ({
    id,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  }));

test('primary workspace views and the patient drawer meet automated WCAG AA checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.patient-monitor')).toHaveCount(6);
  for (const view of ['overview', 'patients', 'alerts', 'insights', 'settings']) {
    await page.locator(`a[data-view="${view}"]`).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(compactViolations(results), `Accessibility violations in ${view}`).toEqual([]);
  }
  await page.locator('a[data-view="patients"]').click();
  await page.locator('[data-action="open-patient"]').first().click();
  await expect(page.locator('#patient-drawer')).toBeVisible();
  await page.locator('#patient-drawer [role="tab"]').first().focus();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(compactViolations(results), 'Accessibility violations in patient details').toEqual([]);
});

test('mobile overview and dark theme remain accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.patient-monitor')).toHaveCount(6);
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(compactViolations(results), 'Mobile accessibility violations').toEqual([]);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(compactViolations(results), 'Dark theme accessibility violations').toEqual([]);
});
