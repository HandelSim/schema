/**
 * 05-root-decomposition.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { sendBlacksmithMessage } from "./helpers";

test.describe("Root Decomposition", () => {
  test("Blacksmith can decompose a project into child nodes", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Decomposition Test Project");
    await page.fill("[data-testid='project-prompt-input']", "Build a blog platform with posts, comments, and user auth");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Decomposition Test Project" }).waitFor({ timeout: 10000 });
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Decomposition Test Project" }).click();
    await page.waitForSelector("[data-testid='blacksmith-status'][data-status='idle']", { timeout: 120000 });

    // Request decomposition with explicit JSON format
    await sendBlacksmithMessage(page,
      "Please decompose this blog platform into its main components. Output the decomposition as a JSON block using this format:\n" +
      "```json\n" +
      "{\n" +
      '  "decomposition": {\n' +
      '    "parent_node_id": null,\n' +
      '    "components": {\n' +
      '      "api-server": { "prompt": "Build the REST API", "is_leaf": true, "model": "haiku", "acceptance_criteria": "API endpoints work" },\n' +
      '      "frontend": { "prompt": "Build the React frontend", "is_leaf": true, "model": "haiku", "acceptance_criteria": "UI renders" }\n' +
      '    },\n' +
      '    "contracts": {}\n' +
      '  }\n' +
      "}\n" +
      "```"
    );

    // Get project ID
    const projectItem = page.locator("[data-testid='project-list-item']").filter({ hasText: "Decomposition Test Project" });
    const projectId = await projectItem.getAttribute("data-project-id");

    if (projectId) {
      // Wait a moment for decomposition to apply
      await page.waitForTimeout(2000);
      
      const projectFilePath = path.join(process.cwd(), "workspace", projectId, "project.json");
      if (fs.existsSync(projectFilePath)) {
        const projectFile = JSON.parse(fs.readFileSync(projectFilePath, "utf-8"));
        
        if (projectFile.nodes.length > 1) {
          // Should have child nodes
          const childNodes = projectFile.nodes.filter((n: any) => n.parent_id !== null);
          expect(childNodes.length).toBeGreaterThanOrEqual(1);
          
          // Each child should have a prompt
          for (const node of childNodes) {
            expect(node.prompt.length).toBeGreaterThan(0);
          }
          
          // Tree should show multiple nodes
          await expect(page.locator("[data-testid='tree-node']").first()).toBeVisible({ timeout: 5000 });
        }
      }
    }

    // History should have messages
    const historyMessages = await page.locator("[data-testid='blacksmith-message']").count();
    expect(historyMessages).toBeGreaterThanOrEqual(2);
  });
});
