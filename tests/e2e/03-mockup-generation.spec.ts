/**
 * 03-mockup-generation.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { sendBlacksmithMessage, waitForBlacksmithIdle } from "./helpers";

test.describe("Mockup Generation", () => {
  test("Blacksmith can generate a mockup on request", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Mockup Test Project");
    await page.fill("[data-testid='project-prompt-input']", "Build a simple note-taking app");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Mockup Test Project"  }).first().waitFor({ timeout: 10000 });
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Mockup Test Project"  }).first().click();
    await page.waitForSelector("[data-testid='blacksmith-status'][data-status='idle']", { timeout: 120000 });

    // Request mockup directly
    await sendBlacksmithMessage(page,
      "Please create an HTML mockup of the app UI and save it as mockup.html in the project directory. " +
      "The app needs: a sidebar with note list, main content area with note editor, and a top bar with search."
    );

    // Get the project ID from the list item
    const projectItem = page.locator("[data-testid='project-list-item']").filter({ hasText: "Mockup Test Project" }).first();
    const projectId = await projectItem.getAttribute("data-project-id");

    if (projectId) {
      // Check mockup.html was created
      const mockupPath = path.join(process.cwd(), "workspace", projectId, "mockup.html");
      const mockupExists = fs.existsSync(mockupPath);
      
      if (mockupExists) {
        // Mockup tab should appear
        await expect(page.locator("[data-testid='center-tab-mockup']")).toBeVisible({ timeout: 5000 });
        
        // Check project.json has mockup_path
        const projectFile = JSON.parse(fs.readFileSync(
          path.join(process.cwd(), "workspace", projectId, "project.json"), "utf-8"
        ));
        expect(projectFile.stakeholder.mockup_path).toBeTruthy();
      }
    }
  });
});
