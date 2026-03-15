const { test, expect } = require('@playwright/test');

// Example test — replace with actual product tests
test('Kingdom Bridge dashboard loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Kingdom/);
  await expect(page.locator('header h1')).toBeVisible();
});
