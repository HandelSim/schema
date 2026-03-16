import { Page, expect } from "@playwright/test";

/**
 * Wait for the tree to have at least N nodes.
 * Decomposition is async and can take 30-120 seconds.
 */
export async function waitForTreeNodes(page: Page, minCount: number, timeoutMs = 120000) {
  await page.waitForFunction(
    (min) => document.querySelectorAll('[data-testid="tree-node"]').length >= min,
    minCount,
    { timeout: timeoutMs }
  );
}

/**
 * Get the count of tree nodes currently visible.
 */
export async function getTreeNodeCount(page: Page): Promise<number> {
  return await page.locator('[data-testid="tree-node"]').count();
}

/**
 * Click a node from the node list navigator (right sidebar) by index.
 * More reliable than clicking tree-node in the React Flow canvas (which has transforms).
 */
export async function selectNode(page: Page, index: number) {
  const items = page.locator('[data-testid="node-list-item"]');
  const count = await items.count();
  if (count === 0) {
    // Fall back to tree-node clicks if the list navigator isn't visible
    const nodes = page.locator('[data-testid="tree-node"]');
    await nodes.nth(index).click();
  } else {
    await items.nth(index).click();
  }
  await page.waitForSelector('[data-testid="node-detail-panel"]', { timeout: 10000 });
}

/**
 * Get the current node's prompt text from the detail panel.
 */
export async function getNodePrompt(page: Page): Promise<string> {
  const promptEl = page.locator('[data-testid="node-prompt"]');
  return (await promptEl.textContent()) || "";
}

/**
 * Get the current node's status from the detail panel badge.
 */
export async function getNodeStatus(page: Page): Promise<string> {
  const statusEl = page.locator('[data-testid="node-status"]');
  return (await statusEl.getAttribute("data-status")) || (await statusEl.textContent()) || "";
}

/**
 * Open the create project modal and fill in the form.
 */
export async function openCreateModal(page: Page) {
  await page.waitForSelector('[data-testid="new-project-button"]', { timeout: 10000 });
  await page.click('[data-testid="new-project-button"]');
  await page.waitForSelector('[data-testid="project-prompt"]', { timeout: 5000 });
}

/**
 * Create a new project and wait for the root node to appear in the tree.
 */
export async function createProject(page: Page, name: string, prompt: string) {
  await page.goto("/");
  await openCreateModal(page);

  await page.fill('[data-testid="project-name"]', name);
  await page.fill('[data-testid="project-prompt"]', prompt);
  await page.click('[data-testid="create-project"]');

  // Wait for modal to close and root node to appear
  await page.waitForSelector('[data-testid="project-prompt"]', { state: "hidden", timeout: 15000 });
  await waitForTreeNodes(page, 1, 30000);
}

/**
 * Create a project and wait for first-level decomposition to produce children.
 * Returns when at least root + 2 children are visible (3 total).
 */
export async function createProjectAndWaitForDecomposition(page: Page, name: string, prompt: string) {
  await createProject(page, name, prompt);

  // The root node is in pending state — approve it to trigger decomposition
  // First, select it via the node list
  const items = page.locator('[data-testid="node-list-item"]');
  await items.first().click();
  await page.waitForSelector('[data-testid="node-detail-panel"]', { timeout: 10000 });

  // Click Approve & Decompose
  const approveBtn = page.locator('[data-testid="approve-button"]');
  if (await approveBtn.isVisible() && await approveBtn.isEnabled()) {
    await approveBtn.click();
  }

  // Wait for at least 3 nodes (root + 2 children from decomposition)
  await waitForTreeNodes(page, 3, 120000);
}

/**
 * Click through all config-tab-* buttons visible on the page and verify content appears.
 * Returns the number of tabs found.
 */
export async function verifyAllTabs(page: Page): Promise<number> {
  const tabs = page.locator('[data-testid^="config-tab-"]');
  const tabCount = await tabs.count();

  for (let i = 0; i < tabCount; i++) {
    const tab = tabs.nth(i);
    await tab.click();
    await page.waitForTimeout(300);

    // At least one tab-content should be visible somewhere on the page
    const tabContent = page.locator('[data-testid="tab-content"]').first();
    await expect(tabContent).toBeVisible({ timeout: 3000 });
  }

  return tabCount;
}

/**
 * Collect JavaScript console errors during a callback.
 */
export async function collectConsoleErrors(page: Page, fn: () => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  const handler = (msg: import("@playwright/test").ConsoleMessage) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  };
  page.on("console", handler);
  await fn();
  page.off("console", handler);
  return errors;
}

/** Standard test project name prefix */
export const TEST_PROJECT_NAME = "E2E Test";

/** Standard test prompt — small scope for fast decomposition */
export const TEST_PROMPT =
  "Build a simple todo list app with a React frontend and an Express REST API backend. " +
  "The frontend should have a form to add todos and a list to display them. " +
  "The API should support CRUD operations with an in-memory store.";
