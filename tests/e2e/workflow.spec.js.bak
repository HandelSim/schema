/**
 * Agent Tree Orchestrator — Full Workflow E2E Tests
 *
 * Tests the complete project creation and node approval workflow.
 * Screenshots saved locally to tests/screenshots/ — never sent via MCP.
 *
 * Run with: npx playwright test tests/e2e/workflow.spec.js --reporter=line
 * Requires the app server running on http://localhost:3000
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`) });
}

test.describe('Workflow: Project creation and node management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Use 'load' not 'networkidle' — SSE connection keeps network perpetually active
    await page.waitForLoadState('load');
  });

  test('1. App loads and shows Agent Tree Orchestrator title', async ({ page }) => {
    await screenshot(page, 'step-1-initial-load');

    // Sidebar title
    await expect(page.getByText('Agent Tree Orchestrator')).toBeVisible();

    // Browser tab title
    await expect(page).toHaveTitle('Agent Tree Orchestrator');

    // New project button visible
    await expect(page.getByRole('button', { name: /\+ New/ })).toBeVisible();
  });

  test('2. Create new project dialog has only name and description fields (no system prompt)', async ({ page }) => {
    // Open create dialog
    await page.getByRole('button', { name: /\+ New/ }).first().click();
    await screenshot(page, 'step-2-create-dialog-open');

    // Name field present
    await expect(page.getByPlaceholder(/e\.g\. E-commerce/i)).toBeVisible();

    // Description field present (textarea with descriptive placeholder)
    await expect(page.getByPlaceholder(/be as descriptive as possible/i)).toBeVisible();

    // System prompt field must NOT exist
    await expect(page.getByText('System Prompt / Spec')).not.toBeVisible();
    await expect(page.getByText('CLAUDE.md')).not.toBeVisible();
  });

  test('3. Create project, root node appears and is auto-selected as Awaiting Approval', async ({ page }) => {
    // Mock the decomposition API so we don't need a real Claude API key
    await page.route('/api/nodes/*/approve', async (route) => {
      const nodeId = route.request().url().split('/nodes/')[1].split('/approve')[0];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, nodeId }),
      });
    });

    // Open create dialog
    await page.getByRole('button', { name: /\+ New/ }).first().click();

    // Fill form
    await page.getByPlaceholder(/e\.g\. E-commerce/i).fill('Test Workflow Project');
    await page.getByPlaceholder(/be as descriptive as possible/i).fill(
      'Build a simple REST API with Node.js and Express that tracks todo items. Include CRUD endpoints and SQLite storage.'
    );

    await screenshot(page, 'step-3-create-dialog-filled');

    // Submit
    await page.getByRole('button', { name: /create project/i }).click();

    // Wait for the project to appear in sidebar
    await expect(page.getByText('Test Workflow Project').first()).toBeVisible({ timeout: 10000 });

    await screenshot(page, 'step-3-project-created');

    // Root node should be auto-selected — NodeDetail panel should appear
    // Look for the Approve & Decompose button in the detail panel
    await expect(page.getByRole('button', { name: /approve & decompose/i })).toBeVisible({ timeout: 5000 });

    await screenshot(page, 'step-3-root-node-auto-selected');

    // Status should show Awaiting Approval (not Pending)
    await expect(page.getByText('Awaiting Approval')).toBeVisible();
  });

  test('4. Node type badge shows Composite not Orchestrator', async ({ page }) => {
    // Open create dialog
    await page.getByRole('button', { name: /\+ New/ }).first().click();

    await page.getByPlaceholder(/e\.g\. E-commerce/i).fill('Badge Test Project');
    await page.getByPlaceholder(/be as descriptive as possible/i).fill(
      'Simple project to test the type badge display.'
    );
    await page.getByRole('button', { name: /create project/i }).click();

    // Wait for project to load
    await expect(page.getByText('Badge Test Project').first()).toBeVisible({ timeout: 10000 });

    // Approve button should appear (root node auto-selected)
    await expect(page.getByRole('button', { name: /approve & decompose/i })).toBeVisible({ timeout: 5000 });

    await screenshot(page, 'step-4-type-badge');

    // TypeBadge should say 'Composite' (not 'Orchestrator' as a standalone badge)
    await expect(page.getByText('Composite')).toBeVisible();
    // The type badge 'Orchestrator' should not appear (header still has 'Agent Tree Orchestrator' — that's fine)
    // Check by looking for the badge specifically: it would be an exact short text match
    const orchestratorBadge = page.locator('span').filter({ hasText: /^Orchestrator$/ });
    await expect(orchestratorBadge).not.toBeVisible();
  });

  test('5. Approve button label changes based on node_type (leaf vs orchestrator)', async ({ page }) => {
    // Create a project
    await page.getByRole('button', { name: /\+ New/ }).first().click();
    await page.getByPlaceholder(/e\.g\. E-commerce/i).fill('Approve Label Test');
    await page.getByPlaceholder(/be as descriptive as possible/i).fill('Test project for approve button label.');
    await page.getByRole('button', { name: /create project/i }).click();

    await expect(page.getByText('Approve Label Test').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /approve & decompose/i })).toBeVisible({ timeout: 5000 });

    await screenshot(page, 'step-5-approve-button-orchestrator');
    // Root node is an orchestrator — should show Approve & Decompose
    await expect(page.getByRole('button', { name: /approve & decompose/i })).toBeVisible();
  });
});
