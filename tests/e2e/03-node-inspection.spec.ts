import { test, expect } from "@playwright/test";
import {
  createProjectAndWaitForDecomposition,
  selectNode,
  getNodePrompt,
  verifyAllTabs,
  TEST_PROJECT_NAME,
  TEST_PROMPT,
} from "./helpers";

test.describe("Node Inspection", () => {

  test("clicking a node opens the detail panel", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Panel", TEST_PROMPT);

    await selectNode(page, 1);

    await expect(page.locator('[data-testid="node-detail-panel"]')).toBeVisible();
  });

  test("detail panel shows node name", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Name", TEST_PROMPT);
    await selectNode(page, 1);

    const name = page.locator('[data-testid="node-name"]');
    await expect(name).toBeVisible();
    const text = await name.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test("detail panel shows node role", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Role", TEST_PROMPT);
    await selectNode(page, 1);

    const role = page.locator('[data-testid="node-role"]');
    await expect(role).toBeVisible();
    const value = await role.inputValue();
    expect(value.trim().length).toBeGreaterThan(0);
  });

  test("detail panel shows node status badge", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Badge", TEST_PROMPT);
    await selectNode(page, 1);

    const badge = page.locator('[data-testid="node-status"]');
    await expect(badge).toBeVisible();
    const status = await badge.getAttribute("data-status");
    expect(status).toBeTruthy();
  });

  test("detail panel shows node depth", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Depth", TEST_PROMPT);
    await selectNode(page, 1);

    const depth = page.locator('[data-testid="node-depth"]');
    await expect(depth).toBeVisible();
    const text = await depth.textContent();
    expect(text).toMatch(/Depth:/);
  });

  test("detail panel shows node prompt", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Prompt", TEST_PROMPT);
    await selectNode(page, 1);

    const prompt = await getNodePrompt(page);
    expect(prompt.trim().length).toBeGreaterThan(10);
  });

  test("config accordion sections are clickable", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Tabs", TEST_PROMPT);
    await selectNode(page, 1);

    const tabCount = await verifyAllTabs(page);
    // There should be multiple config tabs (at minimum the 3 NodeDetail tabs)
    expect(tabCount).toBeGreaterThanOrEqual(3);
  });

  test("switching nodes updates the detail panel content", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Switch", TEST_PROMPT);

    await selectNode(page, 1);
    const firstName = await page.locator('[data-testid="node-name"]').textContent();

    await selectNode(page, 2);
    const secondName = await page.locator('[data-testid="node-name"]').textContent();

    // Two different nodes should have different names
    expect(firstName).not.toEqual(secondName);
  });

  test("approve button is present on pending nodes", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Approve", TEST_PROMPT);
    await selectNode(page, 1);

    const approveBtn = page.locator('[data-testid="approve-button"]');
    await expect(approveBtn).toBeVisible();
  });

  test("reject button is present on pending nodes", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Reject", TEST_PROMPT);
    await selectNode(page, 1);

    const rejectBtn = page.locator('[data-testid="reject-button"]');
    await expect(rejectBtn).toBeVisible();
  });

  test("hooks editor is visible inside the hooks config tab", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Hooks", TEST_PROMPT);
    await selectNode(page, 1);

    // Open the hooks accordion section
    const hooksTab = page.locator('[data-testid="config-tab-hooks"]');
    if (await hooksTab.isVisible()) {
      await hooksTab.click();
      const hooksEditor = page.locator('[data-testid="hooks-editor"]');
      await expect(hooksEditor).toBeVisible({ timeout: 5000 });
    }
  });

  test("execution log panel is visible", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Log", TEST_PROMPT);

    const log = page.locator('[data-testid="execution-log"]');
    await expect(log).toBeVisible();
  });
});
