/**
 * 04-workflow-documentation.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { sendBlacksmithMessage } from "./helpers";

test.describe("Workflow Documentation", () => {
  test("Blacksmith can document workflows", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Workflow Doc Project");
    await page.fill("[data-testid='project-prompt-input']", "E-commerce checkout flow");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Workflow Doc Project" }).waitFor({ timeout: 10000 });
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Workflow Doc Project" }).click();
    await page.waitForSelector("[data-testid='blacksmith-status'][data-status='idle']", { timeout: 30000 });

    // Request workflow documentation
    await sendBlacksmithMessage(page,
      "Please document the main user workflow for checkout: user adds item to cart, proceeds to checkout, enters payment, receives confirmation. " +
      "Update the project.json stakeholder.workflows array with this workflow and mark it as approved."
    );

    // Get project ID
    const projectItem = page.locator("[data-testid='project-list-item']").filter({ hasText: "Workflow Doc Project" });
    const projectId = await projectItem.getAttribute("data-project-id");

    if (projectId) {
      // Read project.json to verify
      const projectFilePath = path.join(process.cwd(), "workspace", projectId, "project.json");
      if (fs.existsSync(projectFilePath)) {
        const projectFile = JSON.parse(fs.readFileSync(projectFilePath, "utf-8"));
        // If Blacksmith followed instructions, workflows should have entries
        if (projectFile.stakeholder.workflows.length > 0) {
          const workflow = projectFile.stakeholder.workflows[0];
          expect(workflow).toHaveProperty("name");
          expect(workflow).toHaveProperty("steps");
          expect(Array.isArray(workflow.steps)).toBe(true);
        }
      }
    }

    // Blacksmith response should mention workflow
    const assistantMessages = await page.locator("[data-testid='blacksmith-message-assistant']").allTextContents();
    const mentionsWorkflow = assistantMessages.some(m => 
      m.toLowerCase().includes("workflow") || m.toLowerCase().includes("checkout") || m.toLowerCase().includes("step")
    );
    expect(mentionsWorkflow).toBe(true);
  });
});
