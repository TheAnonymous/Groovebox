import { describe, expect, it } from "vitest";
import { drumLayerGain, MAX_VOICE_BANKS, VOICE_LIMITS } from "../src/audio/engine";
import { createFactoryProject } from "../src/domain/defaults";
import { SOUND_PRESET_DEFINITIONS, safeEffectParameters } from "../src/domain/sound-presets";
import { SOUND_PRESETS, TRACK_KINDS, type TrackMacros } from "../src/domain/types";

describe("kuratierte Klangfarben", () => {
  it("stellt für jedes Instrument genau drei kalibrierte Presets bereit", () => {
    for (const track of TRACK_KINDS) {
      expect(SOUND_PRESETS[track]).toHaveLength(3);
      expect(SOUND_PRESET_DEFINITIONS[track].map((preset) => preset.id)).toEqual(SOUND_PRESETS[track]);
      for (const preset of SOUND_PRESET_DEFINITIONS[track]) {
        expect(preset.level).toBeGreaterThanOrEqual(0.18);
        expect(preset.level).toBeLessThanOrEqual(0.7);
        expect(preset.release).toBeGreaterThan(0);
        expect(preset.release).toBeLessThanOrEqual(2.4);
      }
    }
    expect(new Set(TRACK_KINDS.flatMap((track) => SOUND_PRESETS[track])).size).toBe(15);
  });

  it("hält alle Makro-Extrema innerhalb der Audio-Sicherheitsgrenzen", () => {
    const extrema: TrackMacros[] = [
      { warmth: 0, drive: 0, space: 0, motion: 0, density: 0 },
      { warmth: 1, drive: 1, space: 1, motion: 1, density: 1 },
    ];
    for (const track of TRACK_KINDS) {
      for (const preset of SOUND_PRESETS[track]) {
        for (const macros of extrema) {
          const parameters = safeEffectParameters(track, preset, macros);
          expect(parameters.cutoff).toBeGreaterThanOrEqual(180);
          expect(parameters.cutoff).toBeLessThanOrEqual(12_500);
          expect(parameters.filterQ).toBeGreaterThanOrEqual(0.6);
          expect(parameters.filterQ).toBeLessThanOrEqual(3);
          expect(parameters.driveThreshold).toBeGreaterThanOrEqual(-20);
          expect(parameters.driveThreshold).toBeLessThanOrEqual(-8);
          expect(parameters.driveRatio).toBeGreaterThanOrEqual(1.2);
          expect(parameters.driveRatio).toBeLessThanOrEqual(4.2);
          expect(parameters.feedback).toBeLessThanOrEqual(0.32);
          expect(parameters.delayWet).toBeLessThanOrEqual(0.23);
          expect(parameters.chorusWet).toBeLessThanOrEqual(0.3);
          expect(parameters.reverbWet).toBeLessThanOrEqual(track === "pad" ? 0.44 : 0.29);
        }
      }
    }
  });

  it("senkt zwei Drumrollen leistungsgerecht ab", () => {
    expect(drumLayerGain(1)).toBe(1);
    expect(drumLayerGain(2)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(drumLayerGain(20)).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("begrenzt die lazy Preset-Bänke und Stimmen pro Instrument", () => {
    expect(MAX_VOICE_BANKS).toBe(15);
    expect(VOICE_LIMITS).toEqual({ drums: 6, bass: 1, chords: 4, lead: 1, pad: 4 });
    expect(Math.max(...Object.values(VOICE_LIMITS))).toBeLessThanOrEqual(6);
  });

  it("liefert gültige projektweite Werkspresets", () => {
    const project = createFactoryProject();
    for (const track of TRACK_KINDS) expect(SOUND_PRESETS[track]).toContain(project.soundPresets[track]);
  });
});
