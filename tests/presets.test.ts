import { describe, expect, it } from "vitest";
import { densityBodyGain, drumLayerGain, MAX_VOICE_BANKS, VOICE_LIMITS } from "../src/audio/engine";
import { MASTER_SIGNAL_FLOW, PARALLEL_SEND_CONTRACT, TRACK_SIGNAL_FLOW } from "../src/audio/graph";
import { maximumDryTailSeconds, melodicExpression } from "../src/audio/voices";
import { createFactoryProject } from "../src/domain/defaults";
import { SOUND_PRESET_DEFINITIONS, safeEffectParameters } from "../src/domain/sound-presets";
import { emptyStep } from "../src/domain/patterns";
import { SOUND_PRESETS, TRACK_KINDS, type TrackKind, type TrackMacros } from "../src/domain/types";

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
        expect(preset.articulation.gate.short).toBeLessThan(preset.articulation.gate.normal);
        expect(preset.articulation.gate.normal).toBeLessThan(preset.articulation.gate.long);
        expect(preset.articulation.pan).toBeGreaterThanOrEqual(-0.2);
        expect(preset.articulation.pan).toBeLessThanOrEqual(0.2);
        expect(preset.articulation.highpass).toBeGreaterThanOrEqual(24);
        expect(preset.articulation.highpass).toBeLessThanOrEqual(140);
        expect(preset.articulation.saturation).toBeGreaterThanOrEqual(0.03);
        expect(preset.articulation.saturation).toBeLessThanOrEqual(0.2);
        expect(["16n", "8n", "8t", "4n"]).toContain(preset.articulation.delaySubdivision);
        expect(maximumDryTailSeconds(preset)).toBeLessThanOrEqual(6);
        expect(preset.effects.filterScale).toBeGreaterThanOrEqual(0.5);
        expect(preset.effects.filterScale).toBeLessThanOrEqual(1.4);
        expect(preset.effects.chorus).toBeGreaterThanOrEqual(0);
        expect(preset.effects.chorus).toBeLessThanOrEqual(0.2);
        expect(preset.effects.delay).toBeGreaterThanOrEqual(0);
        expect(preset.effects.delay).toBeLessThanOrEqual(0.07);
        expect(preset.effects.reverb).toBeGreaterThanOrEqual(0);
        expect(preset.effects.reverb).toBeLessThanOrEqual(0.13);
        if (track === "drums") {
          expect(preset.voice).toBeNull();
          expect(preset.drums).not.toBeNull();
          expect(preset.drums!.kickSubLevel).toBeGreaterThanOrEqual(0.4);
          expect(preset.drums!.kickSubLevel).toBeLessThanOrEqual(0.75);
          expect(preset.drums!.kickSubFrequency).toBeGreaterThanOrEqual(38);
          expect(preset.drums!.kickSubFrequency).toBeLessThanOrEqual(55);
          expect(preset.drums!.hatNoiseCutoff).toBeGreaterThanOrEqual(3_000);
          expect(preset.drums!.hatNoiseCutoff).toBeLessThanOrEqual(7_000);
        } else {
          expect(preset.drums).toBeNull();
          expect(preset.voice).not.toBeNull();
          expect(preset.voice!.filterBase).toBeGreaterThanOrEqual(40);
          expect(preset.voice!.filterBase).toBeLessThanOrEqual(400);
          expect(preset.voice!.filterOctaves).toBeGreaterThanOrEqual(2);
          expect(preset.voice!.filterOctaves).toBeLessThanOrEqual(6);
          expect(preset.voice!.filterQ).toBeGreaterThanOrEqual(0.5);
          expect(preset.voice!.filterQ).toBeLessThanOrEqual(3);
          expect(preset.voice!.portamento).toBeGreaterThanOrEqual(0);
          expect(preset.voice!.portamento).toBeLessThanOrEqual(0.06);
        }
      }
    }
    expect(new Set(TRACK_KINDS.flatMap((track) => SOUND_PRESETS[track])).size).toBe(15);
  });

  it("gibt jeder Klangfarbe einen eigenständigen Synthese- und Effektcharakter", () => {
    const neutral: TrackMacros = { warmth: 0.5, drive: 0.5, space: 0.5, motion: 0.5, density: 0.5 };
    for (const track of TRACK_KINDS) {
      const definitions = SOUND_PRESET_DEFINITIONS[track];
      const synthesisSignatures = definitions.map((preset) => JSON.stringify({
        oscillator: preset.oscillator,
        detune: preset.detune,
        voice: preset.voice,
        drums: preset.drums,
      }));
      const effectSignatures = definitions.map((preset) => JSON.stringify(safeEffectParameters(track, preset.id, neutral)));
      expect(new Set(synthesisSignatures).size).toBe(3);
      expect(new Set(effectSignatures).size).toBe(3);
    }
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
          expect(parameters.highpass).toBeGreaterThanOrEqual(24);
          expect(parameters.highpass).toBeLessThanOrEqual(140);
          expect(parameters.distortion).toBeGreaterThanOrEqual(0.02);
          expect(parameters.distortion).toBeLessThanOrEqual(0.5);
          expect(parameters.compressorThreshold).toBeGreaterThanOrEqual(-12);
          expect(parameters.compressorThreshold).toBeLessThanOrEqual(-6);
          expect(parameters.compressorRatio).toBeGreaterThanOrEqual(1.15);
          expect(parameters.compressorRatio).toBeLessThanOrEqual(1.85);
          expect(parameters.feedback).toBeLessThanOrEqual(0.3);
          expect(parameters.delaySend).toBeLessThanOrEqual(0.24);
          expect(parameters.chorusSend).toBeLessThanOrEqual(0.28);
          expect(parameters.reverbSend).toBeLessThanOrEqual(track === "pad" ? 0.38 : 0.26);
          expect(Math.max(Math.abs(parameters.eqLow), Math.abs(parameters.eqMid), Math.abs(parameters.eqHigh))).toBeLessThanOrEqual(2.5);
        }
      }
    }
  });

  it("bildet die fünf Makros ausschließlich auf ihre vereinbarten Klangaufgaben ab", () => {
    const base: TrackMacros = { warmth: 0.5, drive: 0.5, space: 0.5, motion: 0.5, density: 0 };
    const warmth = safeEffectParameters("chords", "analog", { ...base, warmth: 1 });
    const drive = safeEffectParameters("chords", "analog", { ...base, drive: 1 });
    const space = safeEffectParameters("chords", "analog", { ...base, space: 1 });
    const motion = safeEffectParameters("chords", "analog", { ...base, motion: 1 });
    const nominal = safeEffectParameters("chords", "analog", base);
    expect(warmth.cutoff).not.toBe(nominal.cutoff);
    expect(warmth.eqHigh).not.toBe(nominal.eqHigh);
    expect(drive.distortion).toBeGreaterThan(nominal.distortion);
    expect(drive.compressorRatio).toBeGreaterThan(nominal.compressorRatio);
    expect(space.delaySend).toBeGreaterThan(nominal.delaySend);
    expect(space.reverbSend).toBeGreaterThan(nominal.reverbSend);
    expect(motion.chorusRate).toBeGreaterThan(nominal.chorusRate);
    expect(motion.feedback).toBeGreaterThan(nominal.feedback);
    expect(safeEffectParameters("chords", "analog", { ...base, density: 1 })).toEqual(nominal);
    for (const track of TRACK_KINDS) expect(densityBodyGain(track, 1)).toBeGreaterThan(densityBodyGain(track, 0));
  });

  it("macht melodische Step-Variation deterministisch über Gate, Filter, Detune und Anschlag hörbar", () => {
    const base = { ...emptyStep(), enabled: true, length: "normal" as const };
    for (const track of TRACK_KINDS.filter((candidate): candidate is Exclude<TrackKind, "drums"> => candidate !== "drums")) {
      for (const definition of SOUND_PRESET_DEFINITIONS[track]) {
        const plain = melodicExpression(definition, { ...base, variation: 0 }, 0.7);
        const varied = melodicExpression(definition, { ...base, variation: 1 }, 0.7);
        expect(varied.gateSeconds).toBeGreaterThan(plain.gateSeconds);
        expect(varied.filterOctaves).toBeGreaterThan(plain.filterOctaves);
        expect(varied.detuneCents).toBeGreaterThan(plain.detuneCents);
        expect(varied.velocity).toBeGreaterThan(plain.velocity);
        expect(melodicExpression(definition, { ...base, variation: 1 }, 0.7)).toEqual(varied);
      }
    }
  });

  it("dokumentiert den seriellen Produktionsweg, parallele Vollnass-Sends und das finale Mastermeter", () => {
    expect(TRACK_SIGNAL_FLOW).toEqual([
      "highpass", "filter", "eq3", "saturation-2x", "compressor", "pan", "parallel-sends", "channel-fader", "meter",
    ]);
    expect(MASTER_SIGNAL_FLOW).toEqual([
      "highpass-25hz", "correction-eq", "glue-1.6", "limiter--1.2dbfs", "master-fader", "final-meter",
    ]);
    expect(PARALLEL_SEND_CONTRACT).toEqual({
      chorusWet: 1,
      delayWet: 1,
      reverbWet: 1,
      channelFaderAfterReturns: true,
    });
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
