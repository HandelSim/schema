/**
 * 08-persistence.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { sendBlacksmithMessage } from "./helpers";

test.describe("Persistence", () => {
  test("project persists after page refresh", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Create project
    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Persist Test Project");
    await page.fill("[data-testid='project-prompt-input']", "This should persist after refresh");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Persist Test Project" }).waitFor({ timeout: 10000 });

    const projectId = await page.locator("[data-testid='project-list-item']")
      .filter({ hasText: "Persist Test Project" })
      .getAttribute("data-project-id");

    // Full page refresh
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Project should still be in list
    await expect(
      page.locator("[data-testid='project-list-item']").filter({ hasText: "Persist Test Project" })
    ).toBeVisible({ timeout: 10000 });

    // project.json should exist on disk
    if (projectId) {
      const projectFilePath = path.join(process.cwd(), "workspace", projectId, "project.json");
      expect(fs.existsSync(projectFilePath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(projectFilePath, "utf-8"));
      expect(data.project.name).toBe("Persist Test Project");
    }
  });

  test("conversation history persists across page refresh", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "History Persist Project");
    await page.fill("[data-testid='project-prompt-input']", "Testing conversation persistence");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "History Persist Project" }).waitFor({ timeout: 10000 });
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "History Persist Project" }).click();

    await page.waitForSelector("[data-testid='blacksmith-status'][data-status='idle']", { timeout: 120000 });

    // Send a message
    await sendBlacksmithMessage(page, "Remember this: the secret codeword is PERSISTENCE.");

    const projectId = await page.locator("[data-testid='project-list-item']")
      .filter({ hasText: "History Persist Project" })
      .getAttribute("data-project-id");

    // Check history file was written
    if (projectId) {
      const historyPath = path.join(process.cwd(), "workspace", projectId, "blacksmith-history.json");
      expect(fs.existsSync(historyPath)).toBe(true);

      const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      expect(history.messages.length).toBeGreaterThanOrEqual(1);
    }

    // Page refresh
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Re-select project
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "History Persist Project" }).click();
    await page.waitForTimeout(2000);

    // History should be restored
    const messageCount = await page.locator("[data-testid='blacksmith-message']").count();
    expect(messageCount).toBeGreaterThanOrEqual(1);
  });

  test("blacksmith-session.json is created with project", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Session File Project");
    await page.fill("[data-testid='project-prompt-input']", "Test session file creation");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Session File Project" }).waitFor({ timeout: 10000 });

    const projectId = await page.locator("[data-testid='project-list-item']")
      .filter({ hasText: "Session File Project" })
      .getAttribute("data-project-id");

    if (projectId) {
      // Both session and history files should exist
      const sessionPath = path.join(process.cwd(), "workspace", projectId, "blacksmith-session.json");
      const historyPath = path.join(process.cwd(), "workspace", projectId, "blacksmith-history.json");
      const claudeMdPath = path.join(process.cwd(), "workspace", projectId, "CLAUDE.md");

      expect(fs.existsSync(sessionPath)).toBe(true);
      expect(fs.existsSync(historyPath)).toBe(true);
      expect(fs.existsSync(claudeMdPath)).toBe(true);

      // CLAUDE.md should contain Blacksmith identity
      const claudeMd = fs.readFileSync(claudeMdPath, "utf-8");
      expect(claudeMd).toContain("Blacksmith");
    }
  });
});
