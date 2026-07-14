import type {
  AppUiState,
  ChordSlot,
  GrooveIntent,
  PhraseContour,
  ProjectV2,
  Scene,
  TrackKind,
  TrackMacros,
  TrackPattern,
  TransportState,
} from "./types";
import { SCHEMA_VERSION, TRACK_KINDS } from "./types";
import { emptyStep, generateTypicalPattern } from "./patterns";
import { chordNotes } from "./music";

const SCENE_META = [
  { name: "Auftakt", subtitle: "Luft und Erwartung", density: 0.34 },
  { name: "Fahrt", subtitle: "Der Puls greift", density: 0.56 },
  { name: "Höhepunkt", subtitle: "Alles leuchtet", density: 0.78 },
  { name: "Ausklang", subtitle: "Lichter ziehen vorbei", density: 0.28 },
] as const;

const PROGRESSIONS: readonly (readonly ChordSlot[])[] = [
  [
    { degree: 1, inversion: 0, color: "open" },
    { degree: 6, inversion: 0, color: "triad" },
    { degree: 3, inversion: 1, color: "rich" },
    { degree: 7, inversion: 0, color: "suspended" },
  ],
  [
    { degree: 1, inversion: 0, color: "triad" },
    { degree: 7, inversion: 0, color: "open" },
    { degree: 6, inversion: 1, color: "triad" },
    { degree: 7, inversion: 0, color: "rich" },
  ],
  [
    { degree: 1, inversion: 1, color: "rich" },
    { degree: 3, inversion: 0, color: "open" },
    { degree: 6, inversion: 1, color: "rich" },
    { degree: 7, inversion: 0, color: "suspended" },
  ],
  [
    { degree: 6, inversion: 0, color: "open" },
    { degree: 3, inversion: 1, color: "triad" },
    { degree: 7, inversion: 0, color: "suspended" },
    { degree: 1, inversion: 0, color: "open" },
  ],
];

const TRACK_INTENTS: Record<TrackKind, readonly GrooveIntent[]> = {
  drums: ["spacious", "steady", "driving", "spacious"],
  bass: ["steady", "driving", "driving", "spacious"],
  chords: ["spacious", "steady", "driving", "spacious"],
  lead: ["spacious", "playful", "driving", "spacious"],
  pad: ["spacious", "steady", "playful", "spacious"],
};

const TRACK_CONTOURS: Record<TrackKind, readonly PhraseContour[]> = {
  drums: ["balanced", "balanced", "balanced", "balanced"],
  bass: ["balanced", "rising", "callResponse", "falling"],
  chords: ["balanced", "balanced", "rising", "falling"],
  lead: ["rising", "callResponse", "rising", "falling"],
  pad: ["balanced", "rising", "callResponse", "falling"],
};

function macrosFor(track: TrackKind, sceneIndex: number): TrackMacros {
  const sceneDensity = SCENE_META[sceneIndex]?.density ?? 0.5;
  const values: Record<TrackKind, TrackMacros> = {
    drums: { warmth: 0.52, drive: 0.58, space: 0.18, motion: 0.3, density: sceneDensity },
    bass: { warmth: 0.68, drive: 0.46, space: 0.12, motion: 0.34, density: sceneDensity },
    chords: { warmth: 0.72, drive: 0.24, space: 0.48, motion: 0.46, density: sceneDensity },
    lead: { warmth: 0.44, drive: 0.3, space: 0.54, motion: 0.62, density: sceneDensity },
    pad: { warmth: 0.76, drive: 0.12, space: 0.72, motion: 0.52, density: sceneDensity },
  };
  return values[track];
}

function makeTrack(track: TrackKind, sceneIndex: number): TrackPattern {
  const intent = TRACK_INTENTS[track][sceneIndex] ?? "steady";
  const contour = TRACK_CONTOURS[track][sceneIndex] ?? "balanced";
  const bars = generateTypicalPattern(track, contour, intent, 0x47524f4f + sceneIndex * 97);

  if (sceneIndex === 0 && (track === "lead" || track === "drums")) {
    bars.forEach((bar, barIndex) => {
      if (barIndex < 2) bar.steps.forEach((step, stepIndex) => {
        if (stepIndex % 4 !== 0) Object.assign(step, emptyStep());
      });
    });
  }
  if (sceneIndex === 3 && track === "lead") {
    bars.forEach((bar) => bar.steps.forEach((step, stepIndex) => {
      if (stepIndex !== 0 && stepIndex !== 8) Object.assign(step, emptyStep());
    }));
  }

  bars.forEach((bar, barIndex) => {
    const active = bar.steps.filter((step) => step.enabled);
    if (track === "chords" || track === "pad") {
      active.forEach((step) => { step.length = "long"; });
    }
    if (track === "bass") {
      bar.steps.forEach((step, stepIndex) => {
        if (!step.enabled) return;
        step.dynamics = stepIndex === 0 || stepIndex === 8 ? "accent" : stepIndex % 3 === 0 ? "ghost" : "normal";
        step.length = stepIndex === 0 || stepIndex === 8 ? "normal" : "short";
      });
    }
    if (track === "lead") {
      bar.steps.forEach((step, stepIndex) => {
        if (!step.enabled) return;
        const inReply = stepIndex >= 8;
        step.dynamics = inReply && stepIndex % 3 === 2 ? "ghost" : step.dynamics;
        step.length = stepIndex % 4 === 3 ? "short" : "normal";
      });
      const last = active[active.length - 1];
      if (last) last.variation = Math.max(last.variation, 0.72);
    }
    if (track === "drums" && barIndex === 3 && sceneIndex >= 1) {
      const penultimate = bar.steps[14];
      const last = bar.steps[15];
      if (penultimate) Object.assign(penultimate, { enabled: true, dynamics: "ghost", drumVoices: ["tom"], variation: 0.38, length: "short" });
      if (last) Object.assign(last, { enabled: true, dynamics: "normal", drumVoices: sceneIndex === 2 ? ["tom", "clap"] : ["openHat"], variation: 0.78, length: "long" });
    }
  });

  return { instrument: track, intent, contour, bars, macros: macrosFor(track, sceneIndex) };
}

export function voiceLeadingDistance(previous: readonly number[], next: readonly number[]): number {
  if (!previous.length || !next.length) return 0;
  const nearestMotion = next.reduce((sum, note) => sum + Math.min(...previous.map((prior) => Math.abs(note - prior))), 0) / next.length;
  const previousCenter = previous.reduce((sum, note) => sum + note, 0) / previous.length;
  const nextCenter = next.reduce((sum, note) => sum + note, 0) / next.length;
  return nearestMotion + Math.abs(previousCenter - nextCenter) * 0.35;
}

export function smoothFactoryProgression(progression: readonly ChordSlot[]): ChordSlot[] {
  const result: ChordSlot[] = [];
  let previousNotes: number[] | null = null;
  for (const source of progression) {
    if (!previousNotes) {
      const first = { ...source, inversion: 0 };
      result.push(first);
      previousNotes = chordNotes("A", "minor", first, 3);
      continue;
    }
    const candidates = [-1, 0, 1].map((inversion) => ({ ...source, inversion }));
    candidates.sort((left, right) => {
      const distance = voiceLeadingDistance(previousNotes!, chordNotes("A", "minor", left, 3))
        - voiceLeadingDistance(previousNotes!, chordNotes("A", "minor", right, 3));
      return distance || Math.abs(left.inversion) - Math.abs(right.inversion);
    });
    const selected = candidates[0]!;
    result.push(selected);
    previousNotes = chordNotes("A", "minor", selected, 3);
  }
  return result;
}

export function createFactoryProject(): ProjectV2 {
  const scenes: Scene[] = SCENE_META.map((meta, sceneIndex) => ({
    name: meta.name,
    subtitle: meta.subtitle,
    chords: smoothFactoryProgression(PROGRESSIONS[sceneIndex] ?? PROGRESSIONS[0]!),
    tracks: TRACK_KINDS.map((track) => makeTrack(track, sceneIndex)),
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    soundPresets: {
      drums: "neon84",
      bass: "round",
      chords: "analog",
      lead: "clear",
      pad: "velvet",
    },
    tempo: 96,
    key: "A",
    scale: "minor",
    swing: 0.12,
    masterVolume: 0.78,
    mix: TRACK_KINDS.map((instrument) => ({
      instrument,
      muted: false,
      solo: false,
      volume: instrument === "pad" ? 0.68 : instrument === "lead" ? 0.74 : 0.82,
    })),
    scenes,
  };
}

export function createUiState(): AppUiState {
  return {
    selectedScene: 0,
    selectedTrack: "drums",
    selectedStep: null,
    variationAmount: "lively",
    locks: Object.fromEntries(TRACK_KINDS.map((track) => [track, [false, false, false, false]])) as AppUiState["locks"],
  };
}

export function createTransportState(): TransportState {
  return {
    status: "idle",
    runningScene: 0,
    queuedScene: null,
    bar: 0,
    step: 0,
    peak: 0,
    trackPeaks: Object.fromEntries(TRACK_KINDS.map((track) => [track, 0])) as TransportState["trackPeaks"],
    message: "Bereit – Start aktiviert den Klang",
  };
}
