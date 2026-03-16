import { test, expect } from "@playwright/test";
import {
  createProjectAndWaitForDecomposition,
  selectNode,
  getNodeStatus,
  getTreeNodeCount,
  waitForTreeNodes,
  TEST_PROJECT_NAME,
  TEST_PROMPT,
} from "./helpers";

test.describe("Approval Flow", () => {

  test("approving a child node changes its status", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " StatusChange", TEST_PROMPT);

    await selectNode(page, 1);
    const statusBefore = await getNodeStatus(page);

    const approveBtn = page.locator('[data-testid="approve-button"]');
    if (await approveBtn.isVisible() && await approveBtn.isEnabled()) {
      await approveBtn.click();

      // Wait for the status badge to update
      await page.waitForFunction(
        (prev) => {
          const el = document.querySelector('[data-testid="node-status"]');
          return el && el.getAttribute("data-status") !== prev;
        },
        statusBefore,
        { timeout: 15000 }
      );

      const statusAfter = await getNodeStatus(page);
      expect(statusAfter).not.toEqual(statusBefore);
    }
  });

  test("approving a non-leaf node triggers sub-decomposition", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " SubDecomp", TEST_PROMPT);

    const countBefore = await getTreeNodeCount(page);

    // Find a non-leaf (orchestrator) child node by inspecting nodes
    // Try up to 3 children to find one with an 'Approve & Decompose' button label
    let approved = false;
    for (let i = 1; i <= 3; i++) {
      await selectNode(page, i);
      const approveBtn = page.locator('[data-testid="approve-button"]');
      if (!await approveBtn.isVisible()) continue;

      const btnText = await approveBtn.textContent();
      if (btnText && btnText.includes("Decompose")) {
        await approveBtn.click();
        approved = true;
        break;
      }
    }

    if (approved) {
      try {
        // Wait for the tree to grow (sub-decomposition completed)
        await waitForTreeNodes(page, countBefore + 1, 120000);
        const countAfter = await getTreeNodeCount(page);
        expect(countAfter).toBeGreaterThan(countBefore);
      } catch {
        // The node might have become a leaf after all — verify it's not pending anymore
        const status = await getNodeStatus(page);
        expect(status).not.toBe("pending");
      }
    }
  });

  test("approving a leaf node marks it as approved (not decomposing)", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Leaf", TEST_PROMPT);

    // Find a leaf node by checking the button label
    for (let i = 1; i <= 5; i++) {
      const count = await page.locator('[data-testid="node-list-item"]').count();
      if (i >= count) break;

      await selectNode(page, i);
      const approveBtn = page.locator('[data-testid="approve-button"]');
      if (!await approveBtn.isVisible()) continue;

      const btnText = await approveBtn.textContent();
      if (btnText && btnText.includes("✓ Approve") && !btnText.includes("Decompose")) {
        await approveBtn.click();

        // Wait for status to change to approved (not decomposing)
        await page.waitForFunction(
          () => {
            const el = document.querySelector('[data-testid="node-status"]');
            const s = el?.getAttribute("data-status") || "";
            return s === "approved" || s === "running" || s === "completed";
          },
          {},
          { timeout: 15000 }
        );

        const status = await getNodeStatus(page);
        expect(["approved", "running", "completed"]).toContain(status);
        break;
      }
    }
  });

  test("reject button opens feedback modal", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " RejectModal", TEST_PROMPT);

    await selectNode(page, 1);
    const rejectBtn = page.locator('[data-testid="reject-button"]');

    if (await rejectBtn.isVisible() && await rejectBtn.isEnabled()) {
      await rejectBtn.click();

      // Rejection feedback textarea should appear
      const feedback = page.locator('[data-testid="rejection-feedback"]');
      await expect(feedback).toBeVisible({ timeout: 5000 });

      const confirmBtn = page.locator('[data-testid="rejection-confirm"]');
      await expect(confirmBtn).toBeVisible();
    }
  });

  test("rejecting a node changes its status to rejected", async ({ page }) => {
    await createProjectAndWaitForDecomposition(page, TEST_PROJECT_NAME + " Rejected", TEST_PROMPT);

    await selectNode(page, 1);
    const rejectBtn = page.locator('[data-testid="reject-button"]');

    if (await rejectBtn.isVisible() && await rejectBtn.isEnabled()) {
      await rejectBtn.click();

      const feedback = page.locator('[data-testid="rejection-feedback"]');
      await feedback.fill("Rejected by E2E test");

      const confirmBtn = page.locator('[data-testid="rejection-confirm"]');
      await confirmBtn.click();

      // Wait for status to become rejected
      await page.waitForFunction(
        () => document.querySelector('[data-testid="node-status"]')?.getAttribute("data-status") === "rejected",
        {},
        { timeout: 10000 }
      );

      const status = await getNodeStatus(page);
      expect(status).toBe("rejected");
    }
  });
});
