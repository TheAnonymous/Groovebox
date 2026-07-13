import { createFactoryProject } from "./defaults";
import { emptyStep, isAnchor } from "./patterns";
import type {
  BarPattern,
  ChordColor,
  ChordSlot,
  DrumVoice,
  GrooveIntent,
  MixChannel,
  PhraseContour,
  ProjectV2,
  RootNote,
  Scale,
  Scene,
  Step,
  StepDynamics,
  StepLength,
  TrackKind,
  TrackMacros,
  TrackPattern,
} from "./types";
import {
  BARS_PER_SCENE,
  CHORD_COLORS,
  CONTOURS,
  DYNAMICS,
  DRUM_VOICES,
  INTENTS,
  MAX_SWING,
  MAX_TEMPO,
  MIN_TEMPO,
  ROOT_NOTES,
  SCALES,
  SCENE_COUNT,
  SCHEMA_VERSION,
  SOUND_PRESETS,
  STEP_LENGTHS,
  STEPS_PER_BAR,
  TRACK_KINDS,
} from "./types";
import { safeDegreeOffset } from "./music";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function sanitizeDrumVoices(value: unknown, fallback: readonly DrumVoice[] = ["kick"]): DrumVoice[] {
  const candidates = Array.isArray(value)
    ? value.filter((voice): voice is DrumVoice => typeof voice === "string" && DRUM_VOICES.includes(voice as DrumVoice))
    : [...fallback];
  const unique: DrumVoice[] = [];
  for (const voice of candidates) {
    if (unique.includes(voice)) continue;
    if ((voice === "kick" && unique.includes("tom")) || (voice === "tom" && unique.includes("kick"))) continue;
    if ((voice === "closedHat" && unique.includes("openHat")) || (voice === "openHat" && unique.includes("closedHat"))) continue;
    unique.push(voice);
    if (unique.length === 2) break;
  }
  return unique.length ? unique : sanitizeDrumVoices(fallback.length ? [...fallback] : ["kick"], ["kick"]);
}

function legacyDrumVoice(variation: unknown): DrumVoice {
  const value = finite(variation, 0, 0, 1);
  if (value >= 0.72) return "closedHat";
  if (value >= 0.3) return "snare";
  return "kick";
}

function sanitizeStep(
  value: unknown,
  fallback: Step,
  track: TrackKind,
  stepIndex: number,
  legacy: boolean,
): Step {
  const source = record(value);
  const enabled = typeof source.enabled === "boolean" ? source.enabled : fallback.enabled;
  if (!enabled) return emptyStep();
  const clean: Step = {
    enabled,
    dynamics: enumValue(source.dynamics, DYNAMICS, fallback.dynamics) as StepDynamics,
    variation: finite(source.variation, fallback.variation, 0, 1),
    degreeOffset: safeDegreeOffset(track, stepIndex, finite(source.degreeOffset, fallback.degreeOffset, -2, 4)),
    length: enumValue(source.length, STEP_LENGTHS, fallback.length) as StepLength,
    drumVoices: track === "drums"
      ? legacy
        ? [legacyDrumVoice(source.variation)]
        : sanitizeDrumVoices(source.drumVoices, fallback.drumVoices)
      : [],
  };
  if (legacy && track === "drums") clean.variation = 0;
  if (isAnchor(track, stepIndex, clean) && clean.dynamics === "ghost") clean.dynamics = "normal";
  return clean;
}

function sanitizeBar(value: unknown, fallback: BarPattern, track: TrackKind, legacy: boolean): BarPattern {
  const steps = Array.isArray(record(value).steps) ? (record(value).steps as unknown[]) : [];
  return {
    steps: Array.from({ length: STEPS_PER_BAR }, (_, index) =>
      sanitizeStep(steps[index], fallback.steps[index] ?? emptyStep(), track, index, legacy),
    ),
  };
}

function sanitizeMacros(value: unknown, fallback: TrackMacros): TrackMacros {
  const source = record(value);
  return {
    warmth: finite(source.warmth, fallback.warmth, 0, 1),
    drive: finite(source.drive, fallback.drive, 0, 1),
    space: finite(source.space, fallback.space, 0, 1),
    motion: finite(source.motion, fallback.motion, 0, 1),
    density: finite(source.density, fallback.density, 0, 1),
  };
}

function sanitizeTrack(value: unknown, fallback: TrackPattern, track: TrackKind, legacy: boolean): TrackPattern {
  const source = record(value);
  const bars = Array.isArray(source.bars) ? source.bars : [];
  return {
    instrument: track,
    intent: enumValue(source.intent, INTENTS, fallback.intent) as GrooveIntent,
    contour: enumValue(source.contour, CONTOURS, fallback.contour) as PhraseContour,
    bars: Array.from({ length: BARS_PER_SCENE }, (_, index) =>
      sanitizeBar(bars[index], fallback.bars[index]!, track, legacy),
    ),
    macros: sanitizeMacros(source.macros, fallback.macros),
  };
}

function sanitizeChord(value: unknown, fallback: ChordSlot): ChordSlot {
  const source = record(value);
  return {
    degree: Math.round(finite(source.degree, fallback.degree, 1, 7)),
    inversion: Math.round(finite(source.inversion, fallback.inversion, -2, 2)),
    color: enumValue(source.color, CHORD_COLORS, fallback.color) as ChordColor,
  };
}

function sanitizeScene(value: unknown, fallback: Scene, legacy: boolean): Scene {
  const source = record(value);
  const chords = Array.isArray(source.chords) ? source.chords : [];
  const tracks = Array.isArray(source.tracks) ? source.tracks : [];
  return {
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim().slice(0, 40) : fallback.name,
    subtitle:
      typeof source.subtitle === "string" && source.subtitle.trim()
        ? source.subtitle.trim().slice(0, 80)
        : fallback.subtitle,
    chords: Array.from({ length: BARS_PER_SCENE }, (_, index) =>
      sanitizeChord(chords[index], fallback.chords[index]!),
    ),
    tracks: TRACK_KINDS.map((track) => {
      const candidate = tracks.find((entry) => record(entry).instrument === track);
      return sanitizeTrack(candidate, fallback.tracks.find((entry) => entry.instrument === track)!, track, legacy);
    }),
  };
}

function sanitizeMix(value: unknown, fallback: MixChannel, track: TrackKind): MixChannel {
  const source = record(value);
  const muted = typeof source.muted === "boolean" ? source.muted : fallback.muted;
  const solo = typeof source.solo === "boolean" ? source.solo : fallback.solo;
  return {
    instrument: track,
    muted,
    solo: muted ? false : solo,
    volume: finite(source.volume, fallback.volume, 0, 1),
  };
}

export function looksLikeProject(value: unknown): boolean {
  const source = record(value);
  return (
    source.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(source.scenes) &&
    source.scenes.length > 0 &&
    Array.isArray(source.mix)
  );
}

export function looksLikeLegacyProject(value: unknown): boolean {
  const source = record(value);
  return source.schemaVersion === 1 && Array.isArray(source.scenes) && source.scenes.length > 0 && Array.isArray(source.mix);
}

export function sanitizeProject(value: unknown): ProjectV2 {
  const fallback = createFactoryProject();
  const source = record(value);
  const scenes = Array.isArray(source.scenes) ? source.scenes : [];
  const mix = Array.isArray(source.mix) ? source.mix : [];
  const legacy = source.schemaVersion === 1;
  const rawPresets = record(source.soundPresets);
  return {
    schemaVersion: SCHEMA_VERSION,
    soundPresets: Object.fromEntries(TRACK_KINDS.map((track) => [
      track,
      enumValue(rawPresets[track], SOUND_PRESETS[track], fallback.soundPresets[track]),
    ])) as ProjectV2["soundPresets"],
    tempo: finite(source.tempo, fallback.tempo, MIN_TEMPO, MAX_TEMPO),
    key: enumValue(source.key, ROOT_NOTES, fallback.key) as RootNote,
    scale: enumValue(source.scale, SCALES, fallback.scale) as Scale,
    swing: finite(source.swing, fallback.swing, 0, MAX_SWING),
    masterVolume: finite(source.masterVolume, fallback.masterVolume, 0, 1),
    mix: TRACK_KINDS.map((track) =>
      sanitizeMix(mix.find((entry) => record(entry).instrument === track), fallback.mix.find((entry) => entry.instrument === track)!, track),
    ),
    scenes: Array.from({ length: SCENE_COUNT }, (_, index) =>
      sanitizeScene(scenes[index], fallback.scenes[index]!, legacy),
    ),
  };
}

export function isValidProject(value: unknown): value is ProjectV2 {
  if (!looksLikeProject(value)) return false;
  const sanitized = sanitizeProject(value);
  return JSON.stringify(sanitized) === JSON.stringify(value);
}
