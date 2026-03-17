import { Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

export function testProjectDir(testName: string): string {
  const dir = path.join(process.cwd(), "test-projects", "test-" + testName + "-" + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function createProject(page: Page, name: string, prompt: string): Promise<string> {
  await page.click('[data-testid="create-project-button"]');
  await page.fill('[data-testid="project-name-input"]', name);
  await page.fill('[data-testid="project-prompt-input"]', prompt);
  await page.click('[data-testid="create-project-submit"]');
  // Wait for project to appear in list
  const item = page.locator('[data-testid="project-list-item"]').filter({ hasText: name }).first();
  await item.waitFor({ timeout: 10000 });
  const projectId = await item.getAttribute("data-project-id");
  return projectId || "";
}

export async function selectProject(page: Page, projectId: string): Promise<void> {
  const item = page.locator('[data-project-id="' + projectId + '"]');
  await item.click();
}

export async function sendBlacksmithMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('[data-testid="blacksmith-input"]');
  await input.fill(message);
  await input.press("Enter");
  // Wait for idle status
  await page.waitForSelector('[data-testid="blacksmith-status"][data-status="idle"]', { timeout: 120000 });
}

export async function getBlacksmithMessages(page: Page): Promise<string[]> {
  const messages = page.locator('[data-testid="blacksmith-message"]');
  const count = await messages.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    texts.push(await messages.nth(i).textContent() || "");
  }
  return texts;
}

export async function waitForBlacksmithIdle(page: Page, timeout = 120000): Promise<void> {
  await page.waitForSelector('[data-testid="blacksmith-status"][data-status="idle"]', { timeout });
}
