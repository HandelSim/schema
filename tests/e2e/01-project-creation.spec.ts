import { test, expect } from "@playwright/test";
import {
  openCreateModal,
  createProject,
  getTreeNodeCount,
  collectConsoleErrors,
  TEST_PROJECT_NAME,
  TEST_PROMPT,
} from "./helpers";

test.describe("Project Creation", () => {

  test("landing page loads without console errors", async ({ page }) => {
    const errors = await collectConsoleErrors(page, async () => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
    });

    // Filter out known non-critical browser warnings
    const realErrors = errors.filter(
      (e) => !e.includes("Warning:") && !e.includes("DevTools") && !e.includes("favicon")
    );
    expect(realErrors).toEqual([]);
  });

  test("sidebar has a New Project button", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const btn = page.locator('[data-testid="new-project-button"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test("clicking New opens the create project modal", async ({ page }) => {
    await page.goto("/");
    await openCreateModal(page);

    await expect(page.locator('[data-testid="project-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="project-prompt"]')).toBeVisible();
    await expect(page.locator('[data-testid="create-project"]')).toBeVisible();
    await expect(page.locator('[data-testid="cancel-button"]')).toBeVisible();
  });

  test("cancel button closes the modal without creating a project", async ({ page }) => {
    await page.goto("/");
    const projectsBefore = await page.locator('[data-testid="project-item"]').count();

    await openCreateModal(page);
    await page.fill('[data-testid="project-name"]', "Will Not Be Created");
    await page.click('[data-testid="cancel-button"]');

    // Modal should be gone
    await expect(page.locator('[data-testid="project-name"]')).not.toBeVisible();

    // No new project created
    const projectsAfter = await page.locator('[data-testid="project-item"]').count();
    expect(projectsAfter).toEqual(projectsBefore);
  });

  test("submit button is disabled when fields are empty", async ({ page }) => {
    await page.goto("/");
    await openCreateModal(page);

    const submitBtn = page.locator('[data-testid="create-project"]');
    await expect(submitBtn).toBeDisabled();
  });

  test("creating a project shows it in the sidebar", async ({ page }) => {
    await createProject(page, TEST_PROJECT_NAME + " Sidebar", TEST_PROMPT);

    const items = page.locator('[data-testid="project-item"]');
    await expect(items.first()).toBeVisible();
  });

  test("creating a project shows the tree canvas", async ({ page }) => {
    await createProject(page, TEST_PROJECT_NAME + " Canvas", TEST_PROMPT);

    const treeCanvas = page.locator('[data-testid="tree-canvas"]');
    await expect(treeCanvas).toBeVisible();
  });

  test("creating a project produces at least one tree node", async ({ page }) => {
    await createProject(page, TEST_PROJECT_NAME + " Nodes", TEST_PROMPT);

    const count = await getTreeNodeCount(page);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("project status bar is visible after creation", async ({ page }) => {
    await createProject(page, TEST_PROJECT_NAME + " Status", TEST_PROMPT);

    const status = page.locator('[data-testid="project-status"]');
    await expect(status).toBeVisible();
  });
});
