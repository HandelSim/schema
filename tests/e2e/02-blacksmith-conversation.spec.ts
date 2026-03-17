/**
 * 02-blacksmith-conversation.spec.ts
 */
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { sendBlacksmithMessage, getBlacksmithMessages } from "./helpers";

test.describe("Blacksmith Conversation", () => {
  test("Blacksmith asks clarifying questions after project creation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='project-list']")).toBeVisible({ timeout: 10000 });

    // Create project
    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Todo App Project");
    await page.fill("[data-testid='project-prompt-input']", "Build a simple todo list app with React and Express");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Todo App Project" }).waitFor({ timeout: 10000 });

    // Select the project to switch Blacksmith
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Todo App Project" }).click();

    // Wait for Blacksmith to become idle (first message may stream in)
    await page.waitForSelector("[data-testid='blacksmith-status'][data-status='idle']", { timeout: 120000 });

    // Send an initial greeting to get clarifying questions
    await sendBlacksmithMessage(page, "Hello! I need help designing a todo list app with React and Express.");

    // Check messages appeared
    const messages = await getBlacksmithMessages(page);
    expect(messages.length).toBeGreaterThanOrEqual(2); // user + assistant

    // At least one assistant message should have question marks
    const assistantMessages = await page.locator("[data-testid='blacksmith-message-assistant']").allTextContents();
    const hasQuestions = assistantMessages.some(m => m.includes("?"));
    expect(hasQuestions).toBe(true);
  });

  test("send answer and get follow-up", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("[data-testid='project-list']")).toBeVisible({ timeout: 10000 });

    await page.click("[data-testid='create-project-button']");
    await page.fill("[data-testid='project-name-input']", "Conversation Flow Test");
    await page.fill("[data-testid='project-prompt-input']", "Build a team collaboration tool");
    await page.click("[data-testid='create-project-submit']");
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Conversation Flow Test" }).waitFor({ timeout: 10000 });
    await page.locator("[data-testid='project-list-item']").filter({ hasText: "Conversation Flow Test" }).click();
    await page.waitForSelector("[data-testid='blacksmith-status'][data-status='idle']", { timeout: 120000 });

    // First message
    await sendBlacksmithMessage(page, "I want to build a task management tool for remote teams.");

    // Check we got a response
    const msgs1 = await page.locator("[data-testid='blacksmith-message']").count();
    expect(msgs1).toBeGreaterThanOrEqual(2);

    // Send answer
    await sendBlacksmithMessage(page, "The target users are software development teams, 5-50 people. We need task boards, comments, and file attachments. React frontend, Node.js backend, PostgreSQL database.");

    // Should have more messages now
    const msgs2 = await page.locator("[data-testid='blacksmith-message']").count();
    expect(msgs2).toBeGreaterThan(msgs1);
  });
});
