import { expect, test, type Page } from "@playwright/test";

interface Metrics {
  samplePeak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  crestDb: number;
  dcOffset: number;
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  spectralCentroid: number;
  stereoCorrelation: number;
  tailSeconds: number;
}

type Track = "drums" | "bass" | "chords" | "lead" | "pad";
type Profile = "minimum" | "nominal" | "maximum";

const PRESETS = {
  drums: ["neon84", "pressure", "night"],
  bass: ["round", "saw", "pulse"],
  chords: ["analog", "glass", "stab"],
  lead: ["clear", "pluck", "laser"],
  pad: ["velvet", "choir", "cosmos"],
} as const;

const nominalMetrics = new Map<string, Metrics>();

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/audio-lab.html");
  await page.waitForFunction(() => "__grooveboxAudioLab" in window);
});

test("stellt das ausschließlich lokale Hörlabor vollständig und ohne Export bereit", async ({ page }) => {
  await expect(page).toHaveTitle(/lokales Sound-Lab/);
  await expect(page.locator(".preset")).toHaveCount(15);
  await expect(page.locator("#drum-audition option")).toHaveCount(10);
  await expect(page.locator("#macro-profile option")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Vier-Szenen-Mix rendern" })).toBeVisible();
  await expect(page.locator("a[download]")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
});

test("rendert alle 15 Presets ohne Schweigen, DC oder unkontrollierte Peaks und Fahnen", async ({ page }) => {
  test.setTimeout(300_000);
  for (const [track, presets] of Object.entries(PRESETS) as Array<[Track, readonly string[]]>) {
    for (const preset of presets) {
      const metrics = await renderPreset(page, track, preset, "nominal", "full");
      assertOfflineContract(metrics, `${track}:${preset}`);
      nominalMetrics.set(`${track}:${preset}`, metrics);
    }
  }
});

test("prüft sechs Drumrollen, typische Layer und höchstens drei Dezibel Layer-Sprung", async ({ page }) => {
  test.setTimeout(240_000);
  const roles = ["kick", "snare", "clap", "closedHat", "openHat", "tom"];
  const layers = ["kick+closedHat", "snare+clap", "tom+clap"];
  const metrics = new Map<string, Metrics>();
  for (const role of [...roles, ...layers]) {
    const result = await renderPreset(page, "drums", "neon84", "nominal", role);
    assertOfflineContract(result, role);
    metrics.set(role, result);
  }
  for (const [layer, sources] of [
    ["kick+closedHat", ["kick", "closedHat"]],
    ["snare+clap", ["snare", "clap"]],
    ["tom+clap", ["tom", "clap"]],
  ] as const) {
    const reference = Math.max(...sources.map((source) => metrics.get(source)!.samplePeak));
    const jump = 20 * Math.log10(metrics.get(layer)!.samplePeak / reference);
    expect(jump, layer).toBeLessThanOrEqual(3);
  }
});

test("hält Makro-Minimum und -Maximum je Instrument im sicheren Offline-Vertrag", async ({ page }) => {
  test.setTimeout(240_000);
  for (const [track, presets] of Object.entries(PRESETS) as Array<[Track, readonly string[]]>) {
    for (const profile of ["minimum", "maximum"] as const) {
      const metrics = await renderPreset(page, track, presets[0]!, profile, "full");
      assertOfflineContract(metrics, `${track}:${profile}`);
    }
  }
});

test("trennt die drei Presets jedes Instruments nach Hörpegelabgleich in mindestens zwei Merkmalen", () => {
  for (const [track, presets] of Object.entries(PRESETS) as Array<[Track, readonly string[]]>) {
    for (let left = 0; left < presets.length; left += 1) {
      for (let right = left + 1; right < presets.length; right += 1) {
        const a = nominalMetrics.get(`${track}:${presets[left]}`)!;
        const b = nominalMetrics.get(`${track}:${presets[right]}`)!;
        const changed = [
          relativeDifference(a.crestDb, b.crestDb),
          relativeDifference(a.spectralCentroid, b.spectralCentroid),
          Math.max(
            relativeDifference(a.lowEnergy, b.lowEnergy, 0.02),
            relativeDifference(a.midEnergy, b.midEnergy, 0.02),
            relativeDifference(a.highEnergy, b.highEnergy, 0.02),
          ),
          relativeDifference(a.tailSeconds, b.tailSeconds, 0.05),
        ].filter((difference) => difference >= 0.1).length;
        expect(changed, `${track}:${presets[left]}↔${presets[right]}`).toBeGreaterThanOrEqual(2);
      }
    }
  }
});

test("hält den vollständigen Werkmix im Mastervertrag", async ({ page }) => {
  test.setTimeout(120_000);
  const metrics = await page.evaluate(async () => {
    const api = (window as unknown as { __grooveboxAudioLab: { renderMix(): Promise<Metrics> } }).__grooveboxAudioLab;
    return api.renderMix();
  });
  expect(metrics.rmsDb).toBeGreaterThanOrEqual(-22);
  expect(metrics.rmsDb).toBeLessThanOrEqual(-12);
  expect(metrics.crestDb).toBeGreaterThanOrEqual(5);
  expect(metrics.crestDb).toBeLessThanOrEqual(18);
  expect(metrics.stereoCorrelation).toBeGreaterThanOrEqual(0);
  expect(metrics.samplePeak).toBeLessThanOrEqual(10 ** (-1.2 / 20));
  expect(metrics.dcOffset).toBeLessThan(0.005);
});

async function renderPreset(
  page: Page,
  track: Track,
  preset: string,
  profile: Profile,
  drums: string,
): Promise<Metrics> {
  return page.evaluate(async ([selectedTrack, selectedPreset, selectedProfile, selectedDrums]) => {
    const api = (window as unknown as {
      __grooveboxAudioLab: {
        renderPreset(track: Track, preset: string, profile: Profile, drums: string): Promise<Metrics>;
      };
    }).__grooveboxAudioLab;
    return api.renderPreset(selectedTrack as Track, selectedPreset, selectedProfile as Profile, selectedDrums);
  }, [track, preset, profile, drums] as const);
}

function assertOfflineContract(metrics: Metrics, label: string): void {
  expect(metrics.rms, `${label}: Signal`).toBeGreaterThan(0.0005);
  expect(metrics.dcOffset, `${label}: DC`).toBeLessThan(0.005);
  expect(metrics.samplePeak, `${label}: Peak`).toBeLessThanOrEqual(0.88);
  expect(metrics.tailSeconds, `${label}: Fahne`).toBeLessThan(6);
  expect(metrics.stereoCorrelation, `${label}: Korrelation`).toBeGreaterThanOrEqual(0);
}

function relativeDifference(left: number, right: number, floor = 0.001): number {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), floor);
}
