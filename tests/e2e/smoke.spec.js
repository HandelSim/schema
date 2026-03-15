const { test, expect } = require("@playwright/test");

test("page loads without errors", async ({ page }) => {
  const errors = [];
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);

  const body = await page.textContent("body");
  expect(body.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("page has a title", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  const title = await page.title();
  expect(title.length).toBeGreaterThan(0);
});

test("key UI elements are present", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000);
  const buttons = await page.locator("button").count();
  const inputs = await page.locator("input, textarea").count();
  expect(buttons + inputs).toBeGreaterThan(0);
});
