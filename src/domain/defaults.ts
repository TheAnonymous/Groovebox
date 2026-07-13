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

  return { instrument: track, intent, contour, bars, macros: macrosFor(track, sceneIndex) };
}

export function createFactoryProject(): ProjectV2 {
  const scenes: Scene[] = SCENE_META.map((meta, sceneIndex) => ({
    name: meta.name,
    subtitle: meta.subtitle,
    chords: (PROGRESSIONS[sceneIndex] ?? PROGRESSIONS[0]!).map((chord) => ({ ...chord })),
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
