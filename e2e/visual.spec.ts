import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Referenzbilder werden in Chromium gepflegt");
  await page.addInitScript(() => localStorage.setItem("groovebox.tour.v1", "done"));
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".gb-scene__art, .gb-channel__art, .gb-preset-option__art").evaluateAll(async (elements) => {
    const sources = elements.map((element) => getComputedStyle(element).backgroundImage.slice(5, -2));
    const performance = document.querySelector(".gb-section-heading");
    if (performance) sources.push(getComputedStyle(performance, "::before").backgroundImage.slice(5, -2));
    await Promise.all(sources.map((source) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error(`Artwork konnte nicht geladen werden: ${source}`)), { once: true });
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
  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  await expect(page).toHaveScreenshot("performance-dialog.png", { animations: "disabled", fullPage: true, mask: [page.locator(".gb-project-item span")] });
});

test("Laptop 1366 × 657", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 657 });
  await expect(page).toHaveScreenshot("laptop-1366.png", { animations: "disabled" });
});

test("Handy-Seite", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".gb-small-screen__art").evaluate((image: HTMLImageElement) => image.decode());
  await expect(page).toHaveScreenshot("phone.png", { animations: "disabled" });
});
