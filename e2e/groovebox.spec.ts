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
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/Groovebox/favicon.svg");
  await expect(page.locator(".gb-step")).toHaveCount(64);
  await expect(page.locator(".gb-scene")).toHaveCount(4);
  await expect(page.locator(".gb-scene__art")).toHaveCount(4);
  await expect(page.locator(".gb-channel")).toHaveCount(5);
  await expect(page.locator(".gb-channel__art")).toHaveCount(5);
  await expect(page.locator(".gb-preset-option__art")).toHaveCount(3);
  const sceneArt = await page.locator(".gb-scene__art").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundImage));
  expect(sceneArt).toHaveLength(4);
  expect(sceneArt.every((image) => image.includes("/assets/scenes/") && image.endsWith('.webp\")'))).toBe(true);
  const trackArt = await page.locator(".gb-channel__art").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundImage));
  expect(trackArt).toHaveLength(5);
  expect(trackArt.every((image) => image.includes("/assets/tracks/") && image.endsWith('.webp\")'))).toBe(true);
  const presetArt = await page.locator(".gb-preset-option__art").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundImage));
  expect(presetArt).toHaveLength(3);
  expect(presetArt.every((image) => image.includes("/assets/presets/drums-") && image.endsWith('.webp\")'))).toBe(true);
  await expect.poll(() => page.locator(".gb-section-heading").evaluate((element) => getComputedStyle(element, "::before").backgroundImage)).toContain("/assets/promo/performance-wide.webp");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://theanonymous.github.io/Groovebox/assets/social/groovebox-preview.png");
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("bearbeitet Steps, Details und stellt Autosave nach Reload wieder her", async ({ page }) => {
  const step = page.locator('.gb-step[data-bar="0"][data-step="1"]');
  await step.click();
  await expect(step).toHaveClass(/is-selected/);
  await expect(step).toHaveClass(/gb-step--off/);
  await expect(page.getByRole("heading", { name: "Step-Details" })).toBeVisible();
  await step.click();
  await expect(step).toHaveClass(/gb-step--normal/);
  await page.getByLabel("Dynamik").selectOption("accent");
  await expect(page.locator('.gb-step[data-bar="0"][data-step="1"]')).toHaveClass(/gb-step--accent/);
  await expect(page.locator("[data-save-status]")).toContainText("gespeichert", { timeout: 2_000 });

  await page.reload();
  await expect(page.locator('.gb-step[data-bar="0"][data-step="1"]')).toHaveClass(/gb-step--accent/);
});

test("speichert projektweite Klangfarben und bietet verständliche Tooltips", async ({ page }) => {
  const presetArtwork = new Set<string>();
  for (const track of ["drums", "bass", "chords", "lead", "pad"]) {
    await page.locator(`[data-action="select-track"][data-track="${track}"]`).click();
    const artwork = await page.locator(".gb-preset-option__art").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundImage));
    expect(artwork).toHaveLength(3);
    expect(artwork.every((image) => image.includes(`/assets/presets/${track}-`))).toBe(true);
    artwork.forEach((image) => presetArtwork.add(image));
  }
  expect(presetArtwork.size).toBe(15);

  await page.locator('[data-action="select-track"][data-track="lead"]').click();
  const laser = page.getByRole("button", { name: "Laser" });
  await expect(laser).toHaveAttribute("title", /futuristischem Biss/);
  await laser.click();
  await expect(laser).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Gilt für alle Szenen.")).toBeVisible();
  await page.locator('.gb-scene[data-scene="3"]').click();
  await expect(page.getByRole("button", { name: "Laser" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-save-status]")).toContainText("gespeichert", { timeout: 2_000 });

  await page.reload();
  await page.locator('[data-action="select-track"][data-track="lead"]').click();
  await expect(page.getByRole("button", { name: "Laser" })).toHaveAttribute("aria-pressed", "true");
});

test("bedient sechs Drumrollen mit Konflikten, Layer-Limit und Fokus", async ({ page }) => {
  const step = page.locator('.gb-step[data-bar="0"][data-step="0"]');
  const initialTone = (await step.getAttribute("class"))!.match(/gb-step--\w+/)![0];
  await step.click();
  await expect(step).toHaveClass(new RegExp(initialTone));
  await expect(step).toHaveAttribute("title", /Erneuter Klick/);
  await expect(page.getByRole("heading", { name: "Step-Details" })).toBeVisible();
  const kick = page.getByRole("button", { name: "Kick" });
  const closed = page.getByRole("button", { name: "Closed Hat" });
  const tom = page.getByRole("button", { name: "Tom" });
  const clap = page.getByRole("button", { name: "Clap" });
  await expect(kick).toHaveAttribute("aria-pressed", "true");
  await expect(closed).toHaveAttribute("aria-pressed", "true");
  await expect(clap).toBeDisabled();
  await closed.click();
  await expect(tom).toBeDisabled();
  await expect(kick).toBeDisabled();
  await clap.click();
  await expect(clap).toBeFocused();
  await expect(page.getByText("2/2")).toBeVisible();
  await kick.click();
  await expect(clap).toBeDisabled();
  await expect(clap).toHaveAttribute("title", /Handclap-Transient/);
});

test("migriert einen gespeicherten V1-Stand im Browser ohne ihn zu überschreiben", async ({ page }) => {
  await page.getByLabel("Tempo").evaluate((element: HTMLInputElement) => {
    element.value = "107";
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("[data-save-status]")).toContainText("gespeichert", { timeout: 2_000 });
  const legacyRaw = await page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem("groovebox.project.v2")!);
    project.schemaVersion = 1;
    delete project.soundPresets;
    for (const scene of project.scenes) {
      for (const track of scene.tracks) {
        for (const bar of track.bars) {
          for (const step of bar.steps) {
            if (track.instrument === "drums") {
              const voice = step.drumVoices?.[0];
              step.variation = voice === "snare" || voice === "clap" ? 0.5 : voice === "closedHat" || voice === "openHat" ? 0.85 : 0;
            }
            delete step.drumVoices;
          }
        }
      }
    }
    const raw = JSON.stringify(project);
    localStorage.setItem("groovebox.project.v1", raw);
    localStorage.removeItem("groovebox.project.v2");
    return raw;
  });
  await page.reload();
  await expect(page.getByLabel("Tempo")).toHaveValue("107");
  await expect(page.locator(".bu-toast")).toContainText("Version 2", { timeout: 2_000 });
  expect(await page.evaluate(() => localStorage.getItem("groovebox.project.v1"))).toBe(legacyRaw);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("groovebox.project.v2")!).schemaVersion)).toBe(2);
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
  await expect(step).toHaveClass(new RegExp(originalTone!));
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
  test.setTimeout(45_000);
  await page.getByRole("button", { name: "Wiedergabe starten" }).click();
  await expect(page.locator("[data-audio-status]")).toContainText("Wiedergabe läuft", { timeout: 10_000 });
  await expect.poll(async () => Number(await page.locator("#app").getAttribute("data-audio-peak")), { timeout: 10_000 }).toBeGreaterThan(0);
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
  await expect(page.locator(".gb-step.is-playing")).toHaveCount(1, { timeout: 10_000 });
  await page.getByRole("button", { name: "Panik" }).click();
  await expect(page.locator("[data-audio-status]")).toContainText("Panik");
  await expect(page.locator(".gb-step.is-playing")).toHaveCount(0);
  await page.getByRole("button", { name: "Wiedergabe starten" }).click();
  await expect(page.locator("[data-audio-status]")).toContainText("Wiedergabe läuft", { timeout: 10_000 });
  await expect.poll(async () => Number(await page.locator("#app").getAttribute("data-audio-peak")), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Panik" }).click();
});

test("Chromium-Audiosmoke liefert für alle 15 Klangfarben echte, begrenzte Spurpegel", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Echte Web-Audio-Pegel werden in Chromium geprüft");
  test.setTimeout(90_000);
  await page.locator('.gb-scene[data-scene="1"]').click();
  const presets = {
    drums: ["Neon 84", "Druck", "Nacht"],
    bass: ["Rund", "Säge", "Puls"],
    chords: ["Analog", "Glas", "Stab"],
    lead: ["Klar", "Pluck", "Laser"],
    pad: ["Samt", "Chor", "Kosmos"],
  } as const;
  let previous: keyof typeof presets | null = null;
  for (const [track, labels] of Object.entries(presets) as Array<[keyof typeof presets, readonly string[]]>) {
    await page.locator(`[data-action="select-track"][data-track="${track}"]`).click();
    if (previous) await page.locator(`[data-action="solo"][data-track="${previous}"]`).click();
    await page.locator(`[data-action="solo"][data-track="${track}"]`).click();
    if (!previous) await page.getByRole("button", { name: "Wiedergabe starten" }).click();
    for (const label of labels) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect.poll(async () => Number(await page.locator(`[data-meter-track="${track}"]`).getAttribute("data-track-peak")), { timeout: 10_000 }).toBeGreaterThan(0);
      await expect.poll(async () => Number(await page.locator("#app").getAttribute("data-audio-peak")), { timeout: 10_000 }).toBeGreaterThan(0);
      const masterPeak = Number(await page.locator("#app").getAttribute("data-audio-peak"));
      expect(masterPeak).toBeLessThanOrEqual(1);
    }
    previous = track;
  }
  await page.getByRole("button", { name: "Panik" }).click();
});

test("Chromium-Audiosmoke prüft sechs Drumrollen einzeln und Snare/Clap gelayert", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Echte Web-Audio-Pegel werden in Chromium geprüft");
  test.setTimeout(90_000);
  await page.getByLabel("Tempo").evaluate((element: HTMLInputElement) => {
    element.value = "97";
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("[data-save-status]")).toContainText("gespeichert", { timeout: 2_000 });
  const variants = [["kick"], ["snare"], ["clap"], ["closedHat"], ["openHat"], ["tom"], ["snare", "clap"]];
  for (const voices of variants) {
    await page.evaluate((selectedVoices) => {
      const project = JSON.parse(localStorage.getItem("groovebox.project.v2")!);
      for (const mix of project.mix) {
        mix.muted = mix.instrument !== "drums";
        mix.solo = false;
      }
      for (const scene of project.scenes) {
        const drums = scene.tracks.find((track: { instrument: string }) => track.instrument === "drums");
        for (const bar of drums.bars) {
          for (const step of bar.steps) {
            step.enabled = true;
            step.dynamics = "normal";
            step.variation = 0.5;
            step.drumVoices = selectedVoices;
          }
        }
      }
      localStorage.setItem("groovebox.project.v2", JSON.stringify(project));
    }, voices);
    await page.reload();
    await page.getByRole("button", { name: "Wiedergabe starten" }).click();
    await expect.poll(async () => Number(await page.locator('[data-meter-track="drums"]').getAttribute("data-track-peak")), {
      message: `Drum-Signal für ${voices.join("+")}`,
      timeout: 10_000,
    }).toBeGreaterThan(0);
    await expect.poll(async () => Number(await page.locator("#app").getAttribute("data-audio-peak")), { timeout: 10_000 }).toBeGreaterThan(0);
    const peak = Number(await page.locator("#app").getAttribute("data-audio-peak"));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Panik" }).click();
  }
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
