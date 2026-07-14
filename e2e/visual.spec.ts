import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Referenzbilder werden in Chromium gepflegt");
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".gb-scene__art").evaluateAll(async (elements) => {
    const sources = elements.map((element) => getComputedStyle(element).backgroundImage.slice(5, -2));
    await Promise.all(sources.map((source) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error(`Szenenbild konnte nicht geladen werden: ${source}`)), { once: true });
      image.src = source;
    })));
  });
});

test("Desktop 1440 × 900", async ({ page }) => {
  await expect(page).toHaveScreenshot("desktop-1440.png", { animations: "disabled", fullPage: true });
});

test("Desktop 1024 × 720", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await expect(page).toHaveScreenshot("desktop-1024.png", { animations: "disabled", fullPage: true });
});

test("Playhead, Warteschlange und Dialog", async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector('.gb-step[data-bar="1"][data-step="8"]')?.classList.add("is-playing");
    document.querySelector('.gb-scene[data-scene="0"]')?.classList.add("is-running");
    document.querySelector('.gb-scene[data-scene="2"]')?.classList.add("is-queued");
  });
  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await expect(page).toHaveScreenshot("performance-dialog.png", { animations: "disabled", fullPage: true });
});

test("zu kleine Arbeitsfläche", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page).toHaveScreenshot("small-viewport.png", { animations: "disabled" });
});
