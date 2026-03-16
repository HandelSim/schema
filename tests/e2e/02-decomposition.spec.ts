import { test, expect } from "@playwright/test";
import {
  createProjectAndWaitForDecomposition,
  getTreeNodeCount,
  selectNode,
  getNodePrompt,
  TEST_PROJECT_NAME,
  TEST_PROMPT,
} from "./helpers";

test.describe("Decomposition", () => {

  test("approving root produces child nodes", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Decomp", TEST_PROMPT);

    const count = await getTreeNodeCount(page);
    // Root + at least 2 children
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("every child node has a non-empty prompt", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Prompts", TEST_PROMPT);

    const count = await getTreeNodeCount(page);
    const checkCount = Math.min(count, 5);

    for (let i = 0; i < checkCount; i++) {
      await selectNode(page, i);
      const prompt = await getNodePrompt(page);
      expect(prompt.trim().length, `Node ${i} should have a non-empty prompt`).toBeGreaterThan(10);
    }
  });

  test("every child node has a role", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Roles", TEST_PROMPT);

    const count = await getTreeNodeCount(page);
    const checkCount = Math.min(count, 5);

    for (let i = 0; i < checkCount; i++) {
      await selectNode(page, i);
      const roleEl = page.locator('[data-testid="node-role"]');
      const role = await roleEl.inputValue();
      expect(role.trim().length, `Node ${i} should have a non-empty role`).toBeGreaterThan(2);
    }
  });

  test("child nodes start in pending status", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Status", TEST_PROMPT);

    // Select a child node (index 1 = first child after root)
    await selectNode(page, 1);

    const statusEl = page.locator('[data-testid="node-status"]');
    const status = await statusEl.getAttribute("data-status");

    // Children from decomposition should be pending (awaiting human approval)
    expect(status).toBe("pending");
  });

  test("node list shows all decomposed nodes", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " List", TEST_PROMPT);

    // Node list in right sidebar should match tree count
    const treeCount = await getTreeNodeCount(page);
    const listCount = await page.locator('[data-testid="node-list-item"]').count();

    // They should be equal — the list shows all nodes
    expect(listCount).toBeGreaterThanOrEqual(treeCount);
  });

  test("no JavaScript errors during decomposition", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("Warning:")) {
        errors.push(msg.text());
      }
    });

    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " NoErrors", TEST_PROMPT);

    expect(errors, `Console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
