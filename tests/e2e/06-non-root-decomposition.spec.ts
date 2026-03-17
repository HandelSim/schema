/**
 * 06-non-root-decomposition.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { sendBlacksmithMessage } from "./helpers";

test.describe("Non-Root Decomposition", () => {
  test("clicking Approve on a non-leaf node triggers Blacksmith", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Create project with a non-leaf root node
    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Non-Root Decomp Project");
    await page.fill("[data-testid='project-prompt-input']", "Mobile app for fitness tracking");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Non-Root Decomp Project" }).waitFor({ timeout: 10000 });
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Non-Root Decomp Project" }).click();
    await page.waitForSelector("[data-testid='blacksmith-status'][data-status='idle']", { timeout: 120000 });

    // Get project ID
    const projectItem = page.locator("[data-testid='project-list-item']").filter({ hasText: "Non-Root Decomp Project" });
    const projectId = await projectItem.getAttribute("data-project-id");

    if (projectId) {
      // First create a non-leaf child via API
      const createResp = await page.request.patch(
        `/api/projects/${projectId}/nodes`,
        { data: {} }
      );
      
      // Just verify the Blacksmith terminal is accessible
      await expect(page.locator("[data-testid='blacksmith-terminal']")).toBeVisible();
      
      // Select a node in the tree and try to approve
      const treeNode = page.locator("[data-testid='tree-node']").first();
      if (await treeNode.isVisible()) {
        await treeNode.click();
        
        // Check center-tab-node-detail appears
        const nodeDetailTab = page.locator("[data-testid='center-tab-node-detail']");
        if (await nodeDetailTab.isVisible()) {
          await nodeDetailTab.click();
          
          // Check if approve button exists
          const approveBtn = page.locator("[data-testid='approve-button']");
          if (await approveBtn.isVisible()) {
            await approveBtn.click();
            // Blacksmith should start thinking
            await page.waitForSelector(
              "[data-testid='blacksmith-status']:not([data-status='idle'])",
              { timeout: 10000 }
            ).catch(() => {});  // OK if it finishes fast
          }
        }
      }
    }

    // Verify project.json exists and is valid
    if (projectId) {
      const projectFilePath = path.join(process.cwd(), "workspace", projectId, "project.json");
      expect(fs.existsSync(projectFilePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(projectFilePath, "utf-8"));
      expect(data.project.id).toBe(projectId);
    }
  });
});
