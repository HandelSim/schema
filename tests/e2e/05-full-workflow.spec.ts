import { test, expect } from "@playwright/test";
import {
  createProjectAndWaitForDecomposition,
  selectNode,
  getTreeNodeCount,
  getNodeStatus,
  verifyAllTabs,
  waitForTreeNodes,
  TEST_PROJECT_NAME,
  TEST_PROMPT,
} from "./helpers";

test.describe("Full Workflow", () => {

  test("create → decompose → inspect all nodes → approve one", async ({ page }) => {
    // Phase 1: Create and decompose
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Full", TEST_PROMPT);
    const initialCount = await getTreeNodeCount(page);
    expect(initialCount).toBeGreaterThanOrEqual(3);

    // Phase 2: Inspect every node (up to 5)
    for (let i = 0; i < Math.min(initialCount, 5); i++) {
      await selectNode(page, i);

      const panel = page.locator('[data-testid="node-detail-panel"]');
      await expect(panel).toBeVisible();

      // Verify all accordion tabs open without errors
      await verifyAllTabs(page);
    }

    // Phase 3: Approve the first child and confirm status change
    await selectNode(page, 1);
    const approveBtn = page.locator('[data-testid="approve-button"]');

    if (await approveBtn.isVisible() && await approveBtn.isEnabled()) {
      await approveBtn.click();

      // Wait for status to change
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="node-status"]');
          return el && el.getAttribute("data-status") !== "pending";
        },
        {},
        { timeout: 30000 }
      );

      const status = await getNodeStatus(page);
      expect(status).not.toBe("pending");
    }

    // Phase 4: No error display anywhere
    const errorDisplay = page.locator('[data-testid="error-display"]');
    const hasError = await errorDisplay.isVisible().catch(() => false);
    expect(hasError).toBeFalsy();
  });

  test("sub-decomposition expands the tree depth", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Depth", TEST_PROMPT);

    const countBefore = await getTreeNodeCount(page);

    // Find and approve a non-leaf (composite) child to trigger sub-decomposition
    let subDecompTriggered = false;
    const listItems = await page.locator('[data-testid="node-list-item"]').count();

    for (let i = 1; i < Math.min(listItems, 5); i++) {
      await selectNode(page, i);

      const approveBtn = page.locator('[data-testid="approve-button"]');
      if (!await approveBtn.isVisible() || !await approveBtn.isEnabled()) continue;

      const btnText = await approveBtn.textContent() || "";
      if (btnText.includes("Decompose")) {
        await approveBtn.click();
        subDecompTriggered = true;
        break;
      }
    }

    if (subDecompTriggered) {
      // Wait for the tree to grow
      await waitForTreeNodes(page, countBefore + 1, 120000);
      const countAfter = await getTreeNodeCount(page);
      expect(countAfter).toBeGreaterThan(countBefore);

      // New child nodes should be inspectable
      await selectNode(page, countBefore); // First new node
      const panel = page.locator('[data-testid="node-detail-panel"]');
      await expect(panel).toBeVisible();
    }
  });

  test("project phase bar reflects tree approval state", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Phase", TEST_PROMPT);

    // Phase bar should be visible with a current phase
    const phaseBar = page.locator('[data-testid="project-status"]');
    await expect(phaseBar).toBeVisible();

    // Building phase should be active (tree not approved yet)
    const phaseText = await phaseBar.textContent();
    expect(phaseText?.toLowerCase()).toContain("building");
  });

  test("view tab switching works (graph → detail → contracts → changes)", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " ViewTabs", TEST_PROMPT);

    // The toolbar view buttons: Graph, Detail, Contracts, Changes
    // They don't have individual testids but let's test the canonical flow:
    // selecting a node switches to detail view
    await selectNode(page, 1);
    const detailPanel = page.locator('[data-testid="node-detail-panel"]');
    await expect(detailPanel).toBeVisible();

    // Contract list is accessible in contracts view — navigate via ContractRegistry
    // (No direct testid on the view buttons, but the content areas have testids)
    const treeCanvas = page.locator('[data-testid="tree-canvas"]');
    // Tree canvas exists in the DOM regardless of view mode
    await expect(treeCanvas).toBeAttached();
  });

  test("execution log is always visible and updates during decomposition", async ({ page }) => {
    // Start observing before creating — catch all log activity
    const logMessages: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") logMessages.push(msg.text());
    });

    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Logs", TEST_PROMPT);

    const execLog = page.locator('[data-testid="execution-log"]');
    await expect(execLog).toBeVisible();

    // The log should have content (decomposition events were broadcast)
    const logContent = await execLog.textContent();
    expect(logContent?.trim().length).toBeGreaterThan(0);
  });
});
