import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // The first-visit tour has its own test; everywhere else it would cover the controls.
  await page.addInitScript(() => localStorage.setItem("groovebox.tour.v1", "done"));
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
    if (new URL(request.url()).origin !== "http://127.0.0.1:4273") externalRequests.push(request.url());
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
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://musik.jodie-oesterling.de/Groovebox/assets/social/groovebox-preview.png");
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
    const catalog = JSON.parse(localStorage.getItem("groovebox.projects.v1")!);
    const project = JSON.parse(localStorage.getItem(`groovebox.projects.v1.project.${catalog.activeId}`)!);
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
    localStorage.clear();
    localStorage.setItem("groovebox.project.v1", raw);
    return raw;
  });
  await page.reload();
  await expect(page.getByLabel("Tempo")).toHaveValue("107");
  await expect(page.locator(".bu-toast")).toContainText("Version 2", { timeout: 2_000 });
  await expect(page.getByRole("button", { name: /Projekte verwalten, geöffnet: Mein Set/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("groovebox.project.v1"))).toBe(legacyRaw);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("groovebox.project.v2")!).schemaVersion)).toBe(2);
});

test("verwaltet mehrere Projekte und tauscht sie als Datei aus", async ({ page }, testInfo) => {
  const tempo = page.getByLabel("Tempo");
  const setTempo = (value: string) => tempo.evaluate((element: HTMLInputElement, next) => {
    element.value = next;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await setTempo("84");
  await expect(page.locator("[data-save-status]")).toContainText("gespeichert");

  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  await expect(page.getByRole("dialog", { name: "Projekte" })).toBeVisible();
  await page.getByRole("button", { name: "Neues Set" }).click();
  // Under load the dialog can still be settling after it shows; a name typed
  // too early was replaced by the default. Wait until it is ready for typing.
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Neues Set");
  await expect(page.getByRole("dialog", { name: "Neues Set" })).toBeVisible();
  await expect(async () => {
    await name.fill("Zweites Set");
    await expect(name).toHaveValue("Zweites Set", { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole("button", { name: "Set anlegen" }).click();
  await expect(page.getByRole("button", { name: /geöffnet: Zweites Set/ })).toBeVisible();
  await expect(tempo).toHaveValue("96");
  await expect(page.locator('[data-action="undo"]')).toBeDisabled();

  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Als Datei sichern" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("zweites-set.groovebox.json");
  const path = testInfo.outputPath("zweites-set.groovebox.json");
  await file.saveAs(path);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  await page.getByRole("button", { name: /Mein erstes Set/ }).click();
  await expect(tempo).toHaveValue("84");

  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  await page.locator("[data-import-input]").setInputFiles(path);
  await expect(page.getByRole("button", { name: /geöffnet: Zweites Set/ })).toBeVisible();
  await expect(page.locator(".bu-toast").last()).toContainText("Projektdatei geöffnet");

  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  await expect(page.locator(".gb-project-item")).toHaveCount(3);
  await page.getByLabel("Name des geöffneten Projekts").fill("Importiert");
  await page.getByRole("button", { name: "Umbenennen" }).click();
  await expect(page.locator(".gb-project-item.is-active")).toContainText("Importiert");
  await expect(page.getByRole("button", { name: /geöffnet: Importiert/ })).toBeAttached();
  await page.getByRole("button", { name: "Löschen …" }).click();
  await page.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(page.getByRole("dialog", { name: "Projekte" })).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/bu-scroll-locked/);
  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  await expect(page.locator(".gb-project-item")).toHaveCount(2);
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

  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  await expect(page.getByRole("dialog", { name: "Projekte" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Projekte" })).toBeHidden();
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

const LIVE_PRESET_LABELS = {
  drums: ["Neon 84", "Druck", "Nacht"],
  bass: ["Rund", "Säge", "Puls"],
  chords: ["Analog", "Glas", "Stab"],
  lead: ["Klar", "Pluck", "Laser"],
  pad: ["Samt", "Chor", "Kosmos"],
} as const;

test("Chromium-Audiosmoke liefert für alle 15 Klangfarben echte, begrenzte Spurpegel", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Echte Web-Audio-Pegel werden in Chromium geprüft");
  test.setTimeout(120_000);
  await page.locator('.gb-scene[data-scene="1"]').click();
  await page.getByRole("button", { name: "Wiedergabe starten" }).click();
  for (const [track, labels] of Object.entries(LIVE_PRESET_LABELS) as Array<[keyof typeof LIVE_PRESET_LABELS, readonly string[]]>) {
    await page.locator(`[data-action="select-track"][data-track="${track}"]`).click();
    for (const label of labels) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForTimeout(120);
      await expect.poll(async () => Number(await page.locator(`[data-meter-track="${track}"]`).getAttribute("data-track-peak")), {
        message: `Spurpegel für ${track}:${label}`,
        timeout: 12_000,
      }).toBeGreaterThan(0);
      await expect.poll(async () => Number(await page.locator("#app").getAttribute("data-audio-peak")), { timeout: 10_000 }).toBeGreaterThan(0);
      const masterPeak = Number(await page.locator("#app").getAttribute("data-audio-peak"));
      expect(masterPeak).toBeLessThanOrEqual(1);
    }
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
      const catalog = JSON.parse(localStorage.getItem("groovebox.projects.v1")!);
      const key = `groovebox.projects.v1.project.${catalog.activeId}`;
      const project = JSON.parse(localStorage.getItem(key)!);
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
      localStorage.setItem(key, JSON.stringify(project));
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

test("zeigt unterhalb der Mindestbreite eine Handy-Seite mit Rückweg", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Groovebox", exact: true })).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  await expect(page.getByRole("link", { name: "Zur Musik-Werkstatt" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: "Link für später merken" })).toBeVisible();
  const demo = page.locator("figure audio");
  await expect(demo).toBeVisible();
  for (const source of await demo.locator("source").all()) {
    const response = await page.request.get(String(await source.evaluate((element: HTMLSourceElement) => element.src)));
    expect(response.ok()).toBe(true);
    expect((await response.body()).byteLength).toBeGreaterThan(100_000);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("bleibt auf Laptops mit wenig Höhe vollständig bedienbar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 657 });
  await expect(page.locator(".gb-app-shell")).toBeVisible();
  await expect(page.locator(".gb-small-screen")).toBeHidden();
  await expect(page.getByRole("link", { name: /Musik-Werkstatt/ })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: "Wiedergabe starten" })).toBeInViewport();
  await page.locator('.gb-step[data-bar="3"][data-step="15"]').scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Wiedergabe starten" })).toBeInViewport();
});

test("exportiert den ganzen Bogen als WAV und teilt ein Set per Link", async ({ page, browserName, context }, testInfo) => {
  test.skip(browserName !== "chromium", "Export und Zwischenablage werden in Chromium geprüft");
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "4 Takte" }).click();
  await expect(page.locator(".gb-arrangement__hint")).toContainText("0:40 min");
  await page.getByRole("button", { name: /Szenenfolge aus/ }).click();
  await expect(page.getByRole("button", { name: /Szenenfolge an/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Als WAV exportieren" }).click();
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "WAV erstellen" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("mein-erstes-set-bogen.wav");
  const path = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(path);
  const { readFile } = await import("node:fs/promises");
  const wav = await readFile(path);
  expect(wav.subarray(0, 4).toString()).toBe("RIFF");
  const seconds = wav.readUInt32LE(40) / (44_100 * 2 * 2);
  expect(seconds).toBeGreaterThan(40);
  expect(seconds).toBeLessThan(46);
  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  expect(peak / 0x8000).toBeGreaterThan(0.2);
  expect(peak / 0x8000).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Link teilen" }).click();
  await expect(page.locator("[data-share-status]")).toContainText("Link kopiert");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#p=1\.[A-Za-z0-9_-]+$/);
  await page.keyboard.press("Escape");

  await page.goto(link);
  await expect(page.getByRole("dialog", { name: "Geteiltes Set öffnen?" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Geteiltes Set öffnen?" })).toContainText("Mein erstes Set");
  await page.getByRole("button", { name: "Als neues Set übernehmen" }).click();
  await expect(page.locator(".bu-toast").last()).toContainText("Geteiltes Set übernommen");
  expect(new URL(page.url()).hash).toBe("");
  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  await expect(page.locator(".gb-project-item")).toHaveCount(2);
});

test("führt beim ersten Besuch durch vier Stationen und lässt sich wieder aufrufen", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(String(baseURL));
  const card = page.getByRole("dialog", { name: "Start und Stop" });
  await expect(card).toBeVisible();
  await expect(page.locator(".gb-tour__count")).toHaveText("1 / 4");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByRole("dialog", { name: "Vier Szenen" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Das Raster" })).toBeVisible();
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.locator(".gb-tour__count")).toHaveText("4 / 4");
  await page.getByRole("button", { name: "Los geht's" }).click();
  await expect(page.locator(".gb-tour")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Wiedergabe starten" })).toBeVisible();
  await expect(page.locator(".gb-tour")).toHaveCount(0);

  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Hilfe und Tastenkürzel" });
  await expect(help).toContainText("Szene wählen");
  await help.getByRole("button", { name: "Tour starten" }).click();
  await expect(page.locator(".gb-tour__count")).toHaveText("1 / 4");
  await page.keyboard.press("Escape");
  await expect(page.locator(".gb-tour")).toHaveCount(0);
  await context.close();
});

test("folgt MIDI-Clock und Reglern eines Controllers", async ({ page }) => {
  await page.addInitScript(() => {
    const listeners: ((event: { data: Uint8Array; timeStamp: number }) => void)[] = [];
    const input = {
      name: "Test-Controller",
      state: "connected",
      set onmidimessage(handler: (event: { data: Uint8Array; timeStamp: number }) => void) { listeners.splice(0, listeners.length, handler); },
    };
    const access = { inputs: new Map([["in-1", input]]), onstatechange: null };
    Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => access });
    (window as unknown as { __midi(bytes: number[], timeStamp?: number): void }).__midi = (bytes, timeStamp = performance.now()) => {
      for (const listener of listeners) listener({ data: new Uint8Array(bytes), timeStamp });
    };
  });
  await page.reload();
  const send = (bytes: number[], timeStamp?: number) => page.evaluate(([data, time]) => (window as unknown as { __midi(bytes: number[], timeStamp?: number): void }).__midi(data as number[], time as number | undefined), [bytes, timeStamp] as const);

  await page.getByRole("button", { name: "MIDI", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "MIDI" });
  await dialog.getByRole("button", { name: "MIDI verbinden" }).click();
  await expect(dialog).toContainText("Test-Controller");
  await expect(page.locator("[data-midi-led]")).toHaveAttribute("data-state", "ready");

  for (const value of [20, 60, 100, 127]) await send([0xb0, 71, value]);
  await dialog.getByRole("button", { name: "Fertig" }).click();
  const drive = page.locator('input[data-macro="drive"]');
  await expect(drive).toHaveValue("100");
  await page.getByRole("button", { name: "Wiedergabe starten" }).focus();
  await page.keyboard.press("Control+z");
  await expect(drive).not.toHaveValue("100");
  await expect(page.locator('[data-action="undo"]')).toBeDisabled();

  await page.getByRole("button", { name: "MIDI", exact: true }).click();
  await dialog.getByRole("button", { name: "Zuweisen" }).first().click();
  await expect(dialog).toContainText("Dreh jetzt einen Regler");
  await send([0xb2, 21, 0]);
  await expect(dialog.locator(".gb-midi-map li").first()).toContainText("CC 21");

  const interval = 60_000 / 104 / 24;
  await page.evaluate((step) => {
    const midi = (window as unknown as { __midi(bytes: number[], timeStamp?: number): void }).__midi;
    for (let tick = 0; tick <= 48; tick += 1) midi([0xf8], tick * step);
  }, interval);
  await expect(dialog.locator(".gb-midi-clock")).toHaveText("Clock: 104 BPM");
  await expect(page.locator("[data-audio-status]")).toHaveText("MIDI-Clock · 104 BPM");
  await expect(dialog.locator(".gb-midi-clock")).toContainText("Keine Clock", { timeout: 3_000 });
});

test("hält den Bildschirm wach, solange Musik läuft", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Wiedergabe wird in Chromium geprüft");
  await page.addInitScript(() => {
    const calls: string[] = [];
    (window as unknown as { __wakeCalls: string[] }).__wakeCalls = calls;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async (type: string) => { calls.push(`request:${type}`); return Object.assign(new EventTarget(), { release: async () => { calls.push("release"); } }); } },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Wiedergabe starten" }).click();
  await expect(page.getByRole("button", { name: "Wiedergabe stoppen" })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wakeCalls: string[] }).__wakeCalls)).toEqual(["request:screen"]);
  await page.getByRole("button", { name: "Wiedergabe stoppen" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wakeCalls: string[] }).__wakeCalls)).toEqual(["request:screen", "release"]);
});

test("exportiert eine Szene in jedem Browser als WAV", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.getByRole("button", { name: "4 Takte" }).click();
  await page.getByRole("button", { name: "Als WAV exportieren" }).click();
  await page.locator('input[name="export-mode"][value="scene"]').check();
  const download = page.waitForEvent("download", { timeout: 100_000 });
  await page.getByRole("button", { name: "WAV erstellen" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("mein-erstes-set-auftakt.wav");
  const path = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(path);
  const { readFile } = await import("node:fs/promises");
  const wav = await readFile(path);
  expect(wav.subarray(0, 4).toString()).toBe("RIFF");
  const seconds = wav.readUInt32LE(40) / (44_100 * 2 * 2);
  expect(seconds).toBeGreaterThan(10);
  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  expect(peak).toBeGreaterThan(3_000);
});

test("nimmt das Live-Spiel als WAV auf", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Aufnahme wird in Chromium geprüft");
  test.setTimeout(60_000);
  await page.locator("body").press("a");
  await expect(page.getByRole("button", { name: "Wiedergabe stoppen" })).toBeVisible({ timeout: 10_000 });
  const record = page.locator('[data-action="toggle-record"]');
  await expect(record).toHaveAttribute("aria-pressed", "true");
  await expect(record.locator("output")).not.toHaveText("0:00", { timeout: 5_000 });
  await page.waitForTimeout(1_500);
  const download = page.waitForEvent("download");
  await page.locator("body").press("a");
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^mein-erstes-set-live-\d{4}-\d{2}-\d{2}-\d{4}\.wav$/);
  const path = testInfo.outputPath("live.wav");
  await file.saveAs(path);
  const { readFile } = await import("node:fs/promises");
  const wav = await readFile(path);
  expect(wav.subarray(0, 4).toString()).toBe("RIFF");
  const sampleRate = wav.readUInt32LE(24);
  expect(wav.readUInt32LE(40) / (sampleRate * 4)).toBeGreaterThan(1.5);
  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  expect(peak).toBeGreaterThan(2_000);
  await expect(record).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".bu-toast")).toContainText("Aufnahme gespeichert");
});

test("schaltet Spuren am Takt stumm und spielt Break, Drop und Filter", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Live-Spiel wird in Chromium geprüft");
  test.setTimeout(60_000);
  await page.getByRole("button", { name: "Wiedergabe starten" }).click();
  await expect(page.getByRole("button", { name: "Wiedergabe stoppen" })).toBeVisible({ timeout: 10_000 });
  await page.locator("body").press("p");
  await expect(page.locator('[data-action="toggle-live-keys"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("body").press("2");
  const bass = page.locator('.gb-live-mute[data-track="bass"]');
  await expect(bass).toHaveAttribute("data-pending", "");
  await expect(bass).toHaveAttribute("aria-pressed", "true", { timeout: 6_000 });
  await expect(bass).not.toHaveAttribute("data-pending", "");
  await expect(page.locator(".gb-step").first()).toBeVisible();

  const breakButton = page.locator("[data-perf-break]");
  await page.keyboard.down("b");
  await expect(breakButton).toHaveAttribute("data-state", "break");
  await page.keyboard.up("b");
  await expect(breakButton).toHaveAttribute("data-state", "drop");
  await expect(breakButton).toHaveAttribute("data-state", "idle", { timeout: 6_000 });

  const filter = page.locator("[data-perf-filter]");
  await page.keyboard.down("f");
  await expect.poll(async () => Number(await filter.inputValue())).toBeLessThan(-30);
  await page.keyboard.up("f");
  await expect(filter).toHaveValue("0");

  await page.getByRole("button", { name: "Wiedergabe stoppen" }).click();
  await expect(bass).toHaveAttribute("aria-pressed", "false");
});

test("exportiert jede Spur einzeln als Stems-ZIP", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Stems werden in Chromium geprüft");
  test.setTimeout(120_000);
  await page.getByRole("button", { name: "4 Takte" }).click();
  await page.getByRole("button", { name: "Als WAV exportieren" }).click();
  await page.locator('input[name="export-mode"][value="scene"]').check();
  await page.locator('input[name="export-stems"]').check();
  const download = page.waitForEvent("download", { timeout: 100_000 });
  await page.getByRole("button", { name: "WAV erstellen" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("mein-erstes-set-auftakt-stems.zip");
  const path = testInfo.outputPath(file.suggestedFilename());
  await file.saveAs(path);
  const { readFile } = await import("node:fs/promises");
  const zip = await readFile(path);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const names = zip.toString("latin1");
  for (const name of ["01-drums.wav", "02-bass.wav", "03-chords.wav", "04-lead.wav", "05-pad.wav"]) expect(names).toContain(name);
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  expect(zip.readUInt16LE(zip.length - 12)).toBe(5);
});

test("startet und stoppt zwei gekoppelte Tabs im Gleichtakt", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Gleichtakt wird in Chromium geprüft");
  test.setTimeout(60_000);
  const partner = await context.newPage();
  await partner.goto("./");
  for (const tab of [page, partner]) {
    await tab.getByRole("button", { name: "Gleichtakt" }).click();
    await expect(tab.getByRole("button", { name: "Gleichtakt" })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator(".gb-link-led")).toHaveAttribute("data-state", "linked");
  await expect(partner.locator(".gb-link-led")).toHaveAttribute("data-state", "linked");

  await page.getByRole("button", { name: "Wiedergabe starten" }).click();
  await expect(partner.getByRole("button", { name: "Wiedergabe stoppen" })).toBeVisible({ timeout: 10_000 });
  await expect(partner.locator("[data-audio-status]")).toHaveText("Gleichtakt mit Groovebox · 96 BPM");
  await page.getByRole("button", { name: "Wiedergabe stoppen" }).click();
  await expect(partner.getByRole("button", { name: "Wiedergabe starten" })).toBeVisible({ timeout: 5_000 });

  await partner.getByRole("button", { name: "Gleichtakt" }).click();
  await expect(page.locator(".gb-link-led")).toHaveAttribute("data-state", "waiting");
  await partner.close();
});

test("zeigt Meldungen mit Symbolen aus dem mitgelieferten Sprite", async ({ page }) => {
  await page.getByRole("button", { name: /Projekte verwalten/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Als Datei sichern" }).click();
  await download;
  // BraunUI's toasts refer to a relative icons.svg; it must be the sprite, not the app's fallback page.
  await expect(page.locator(".bu-toast use").first()).toHaveAttribute("href", "icons.svg#check");
  const sprite = await page.request.get("icons.svg");
  expect(sprite.headers()["content-type"]).toContain("image/svg+xml");
  expect(await sprite.text()).toContain('id="check"');
});
