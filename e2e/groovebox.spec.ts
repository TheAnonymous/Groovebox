import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
});

test("zeigt das vollständige Desktop-Instrument ohne Laufzeitfehler", async ({ page }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => errors.push(`Request fehlgeschlagen: ${request.url()}`));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:4173") externalRequests.push(request.url());
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "Mixer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Drums" })).toBeVisible();
  await expect(page.locator(".gb-step")).toHaveCount(64);
  await expect(page.locator(".gb-scene")).toHaveCount(4);
  await expect(page.locator(".gb-channel")).toHaveCount(5);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("bearbeitet Steps, Details und stellt Autosave nach Reload wieder her", async ({ page }) => {
  const step = page.locator('.gb-step[data-bar="0"][data-step="1"]');
  await step.click();
  await expect(step).toHaveClass(/gb-step--normal/);
  await expect(page.getByRole("heading", { name: "Step-Details" })).toBeVisible();
  await page.getByLabel("Dynamik").selectOption("accent");
  await expect(page.locator('.gb-step[data-bar="0"][data-step="1"]')).toHaveClass(/gb-step--accent/);
  await expect(page.locator("[data-save-status]")).toContainText("gespeichert", { timeout: 2_000 });

  await page.reload();
  await expect(page.locator('.gb-step[data-bar="0"][data-step="1"]')).toHaveClass(/gb-step--accent/);
});

test("bedient Spuren, Szenen und Undo mit Tastatur", async ({ page }) => {
  await page.keyboard.press("5");
  await expect(page.getByRole("heading", { name: "Pad / FX" })).toBeVisible();
  await page.keyboard.press("Shift+3");
  await expect(page.locator('.gb-scene[data-scene="2"]')).toHaveClass(/is-selected/);
  const step = page.locator('.gb-step[data-bar="0"][data-step="0"]');
  const original = await step.getAttribute("class");
  const originalTone = original!.match(/gb-step--\w+/)?.[0];
  await step.click();
  await page.keyboard.press("Control+z");
  await expect(step).toHaveClass(new RegExp(originalTone!));
});

test("öffnet die Brams-Dialoge mit Fokusfalle und speichert einen sicheren Akkord", async ({ page }) => {
  await page.locator(".gb-chord").nth(1).click();
  const dialog = page.getByRole("dialog", { name: /Akkord/ });
  await expect(dialog).toBeVisible();
  await page.locator("#chord-degree").selectOption("4");
  await page.locator("#chord-color").selectOption("open");
  await page.getByRole("button", { name: "Akkord übernehmen" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".gb-chord").nth(1)).toContainText("iv");

  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await expect(page.getByRole("dialog", { name: "Neues Projekt beginnen?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Neues Projekt beginnen?" })).toBeHidden();
});

test("markiert eine laufende und die zuletzt vorgemerkte Szene", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Audio-Smoke wird einmal in Chromium ausgeführt");
  await page.getByRole("button", { name: "Wiedergabe starten" }).click();
  await expect(page.locator("[data-audio-status]")).toContainText("Wiedergabe läuft", { timeout: 5_000 });
  await expect.poll(async () => Number(await page.locator("#app").getAttribute("data-audio-peak")), { timeout: 5_000 }).toBeGreaterThan(0);
  expect(Number(await page.locator("#app").getAttribute("data-audio-peak"))).toBeLessThanOrEqual(1);
  await page.getByLabel("Tempo").evaluate((element: HTMLInputElement) => {
    element.value = "110";
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByLabel("Swing").evaluate((element: HTMLInputElement) => {
    element.value = "25";
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("[data-audio-status]")).toContainText("Wiedergabe läuft");
  await page.locator('.gb-scene[data-scene="1"]').click();
  await page.locator('.gb-scene[data-scene="2"]').click();
  await expect(page.locator('.gb-scene[data-scene="2"]')).toHaveClass(/is-queued/);
  await expect(page.locator('.gb-scene[data-scene="1"]')).not.toHaveClass(/is-queued/);
  await expect(page.locator(".gb-step.is-playing")).toHaveCount(1, { timeout: 5_000 });
  await page.getByRole("button", { name: "Panik" }).click();
  await expect(page.locator("[data-audio-status]")).toContainText("Panik");
  await expect(page.locator(".gb-step.is-playing")).toHaveCount(0);
});

test("fängt beschädigte gespeicherte Daten verständlich ab", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("groovebox.project.v1", "{kaputt");
    localStorage.setItem("groovebox.project.v1.backup", "ebenfalls kaputt");
  });
  await page.reload();
  await expect(page.locator(".gb-scene")).toHaveCount(4);
  await expect(page.locator(".bu-toast")).toContainText("Werkprojekt", { timeout: 2_000 });
});

test("zeigt unterhalb der Mindestfläche einen Desktop-Hinweis", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.getByRole("heading", { name: "Groovebox braucht etwas Platz." })).toBeVisible();
  await expect(page.locator(".gb-app-shell")).toBeHidden();
});
