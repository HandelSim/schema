/**
 * 01-project-creation.spec.ts
 */
import { test, expect } from "@playwright/test";

test.describe("Project Creation", () => {
  test("landing page loads without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='project-list']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).toBeVisible();
    const critical = errors.filter(e => !e.includes("favicon") && !e.includes("404"));
    expect(critical.length).toBe(0);
  });

  test("project list is visible in left panel", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='project-list']")).toBeVisible({ timeout: 10000 });
  });

  test("creating a project shows tree and Blacksmith", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='project-list']")).toBeVisible({ timeout: 10000 });
    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Test Project Alpha");
    await page.fill("[data-testid='project-prompt-input']", "Build a simple task manager web app");
    await page.click("[data-testid='create-project-submit']");
    await expect(
      page.locator("[data-testid='project-list-item']").filter({ hasText: "Test Project Alpha" })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.locator("[data-testid='tree-canvas']")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-testid='blacksmith-terminal']")).toBeVisible({ timeout: 10000 });
  });

  test("Blacksmith is default right panel tab", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='project-list']")).toBeVisible({ timeout: 10000 });
    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Tab Test Project");
    await page.fill("[data-testid='project-prompt-input']", "Test tab visibility");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Tab Test Project" }).waitFor({ timeout: 10000 });
    await expect(page.locator("[data-testid='right-panel-tab-blacksmith']")).toBeVisible();
    await expect(page.locator("[data-testid='blacksmith-terminal']")).toBeVisible();
  });

  test("center panel has Tree tab visible by default", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='project-list']")).toBeVisible({ timeout: 10000 });
    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Center Tab Project");
    await page.fill("[data-testid='project-prompt-input']", "Test center tab");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Center Tab Project" }).waitFor({ timeout: 10000 });
    await expect(page.locator("[data-testid='center-tab-tree']")).toBeVisible();
    await expect(page.locator("[data-testid='tree-canvas']")).toBeVisible({ timeout: 10000 });
  });
});
