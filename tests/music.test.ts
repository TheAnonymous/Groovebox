import { describe, expect, it } from "vitest";
import {
  chordNotes,
  isScaleTone,
  quantizePitch,
  scaleDegreeMidi,
  safeDegreeOffset,
} from "../src/domain/music";
import { createFactoryProject } from "../src/domain/defaults";
import {
  cycleStep,
  emptyStep,
  generateTypicalPattern,
  setPatternContour,
  setPatternIntent,
  varyPattern,
} from "../src/domain/patterns";
import { isValidProject, sanitizeProject } from "../src/domain/sanitize";
import { ROOT_NOTES, SCALES, TRACK_KINDS } from "../src/domain/types";

describe("musikalische Sicherheitsregeln", () => {
  it("erzeugt über alle Tonarten, Skalen und Akkordfarben nur Skalentöne", () => {
    for (const root of ROOT_NOTES) {
      for (const scale of SCALES) {
        for (const color of ["triad", "open", "suspended", "rich"] as const) {
          for (let degree = 1; degree <= 7; degree += 1) {
            const notes = chordNotes(root, scale, { degree, inversion: 1, color });
            expect(notes.length).toBeGreaterThanOrEqual(3);
            expect(notes.every((note) => isScaleTone(root, scale, note))).toBe(true);
            expect(Math.max(...notes) - Math.min(...notes)).toBeLessThanOrEqual(36);
          }
        }
      }
    }
  });

  it("quantisiert abwärts bei Gleichstand und verschiebt Stufen ohne Chromatik", () => {
    expect(quantizePitch("C", "minor", 61)).toBe(60);
    for (const root of ROOT_NOTES) {
      for (const scale of SCALES) {
        for (let offset = -2; offset <= 4; offset += 1) {
          expect(isScaleTone(root, scale, scaleDegreeMidi(root, scale, 1, offset, 3))).toBe(true);
        }
      }
    }
    expect(safeDegreeOffset("drums", 7, 4)).toBe(0);
    expect(safeDegreeOffset("bass", 0, -2)).toBe(0);
  });

  it("durchläuft Aus → Normal → Akzent → Variation → Aus", () => {
    const off = emptyStep();
    const normal = cycleStep(off, "lead", 3);
    const accent = cycleStep(normal, "lead", 3);
    const variation = cycleStep(accent, "lead", 3);
    const reset = cycleStep(variation, "lead", 3);
    expect(normal).toMatchObject({ enabled: true, dynamics: "normal", variation: 0 });
    expect(accent).toMatchObject({ enabled: true, dynamics: "accent" });
    expect(variation).toMatchObject({ enabled: true, dynamics: "normal", variation: 1 });
    expect(reset).toEqual(off);
  });
});

describe("typische Pattern und kontrollierte Variation", () => {
  it("hält instrumenttypische Dichtebereiche ein", () => {
    const ranges = {
      drums: [8, 12],
      bass: [6, 8],
      chords: [1, 4],
      lead: [4, 8],
      pad: [1, 2],
    } satisfies Record<(typeof TRACK_KINDS)[number], [number, number]>;
    for (const track of TRACK_KINDS) {
      const pattern = generateTypicalPattern(track, "balanced", "steady", 42);
      for (const bar of pattern) {
        const active = bar.steps.filter((step) => step.enabled).length;
        expect(active).toBeGreaterThanOrEqual(ranges[track][0]);
        expect(active).toBeLessThanOrEqual(ranges[track][1]);
      }
    }
  });

  it("respektiert Sperren und begrenzt Lebendig auf einen, Mutig auf zwei Takte", () => {
    const factory = createFactoryProject();
    for (const [amount, maxBars] of [["lively", 1], ["bold", 2]] as const) {
      const pattern = structuredClone(factory.scenes[1]!.tracks.find((entry) => entry.instrument === "lead")!);
      const before = structuredClone(pattern.bars);
      expect(varyPattern(pattern, amount, [true, false, false, false])).toBe(true);
      const changed = pattern.bars.filter((bar, index) => JSON.stringify(bar) !== JSON.stringify(before[index])).length;
      expect(changed).toBeLessThanOrEqual(maxBars);
      expect(pattern.bars[0]).toEqual(before[0]);
    }
  });

  it("ändert Dezent nur Ausdruck in höchstens einem Takt", () => {
    const pattern = structuredClone(createFactoryProject().scenes[2]!.tracks[1]!);
    const before = structuredClone(pattern.bars);
    expect(varyPattern(pattern, "subtle", [false, false, false, false])).toBe(true);
    const changed = pattern.bars.filter((bar, index) => JSON.stringify(bar) !== JSON.stringify(before[index])).length;
    expect(changed).toBe(1);
    pattern.bars.forEach((bar, index) => {
      expect(bar.steps.map((step) => step.enabled)).toEqual(before[index]!.steps.map((step) => step.enabled));
    });
  });

  it("wendet Absicht und Verlauf nur auf freie Takte an", () => {
    const pattern = structuredClone(createFactoryProject().scenes[1]!.tracks[1]!);
    const locked = structuredClone(pattern.bars[0]);
    expect(setPatternIntent(pattern, "spacious", [true, false, false, false])).toBe(true);
    expect(setPatternContour(pattern, "falling", [true, false, false, false])).toBe(true);
    expect(pattern.bars[0]).toEqual(locked);
    expect(pattern.bars.slice(1).flatMap((bar) => bar.steps).filter((step) => step.enabled).every((step) => step.length === "long")).toBe(true);
  });
});

describe("Werkprojekt und Sanitizing", () => {
  it("erzeugt vier deterministische, unterschiedliche Startszenen", () => {
    const first = createFactoryProject();
    const second = createFactoryProject();
    expect(first).toEqual(second);
    expect(first.scenes.map((scene) => scene.name)).toEqual(["Auftakt", "Fahrt", "Höhepunkt", "Ausklang"]);
    expect(new Set(first.scenes.map((scene) => JSON.stringify(scene.tracks))).size).toBe(4);
    expect(sanitizeProject(first)).toEqual(first);
    expect(isValidProject(first)).toBe(true);
  });

  it("klemmt alle externen Zahlen und rekonstruiert die feste Struktur", () => {
    const damaged = createFactoryProject() as unknown as Record<string, unknown>;
    damaged.tempo = 900;
    damaged.swing = -3;
    damaged.masterVolume = Number.NaN;
    damaged.mix = [];
    damaged.scenes = [];
    const clean = sanitizeProject(damaged);
    expect(clean.tempo).toBe(120);
    expect(clean.swing).toBe(0);
    expect(clean.masterVolume).toBe(0.78);
    expect(clean.mix).toHaveLength(5);
    expect(clean.scenes).toHaveLength(4);
    expect(clean.scenes.every((scene) => scene.tracks.every((track) => track.bars.every((bar) => bar.steps.length === 16)))).toBe(true);
  });
});
