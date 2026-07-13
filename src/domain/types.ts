export const SCHEMA_VERSION = 2 as const;
export const LEGACY_SCHEMA_VERSION = 1 as const;
export const SCENE_COUNT = 4;
export const TRACK_COUNT = 5;
export const BARS_PER_SCENE = 4;
export const STEPS_PER_BAR = 16;
export const MIN_TEMPO = 80;
export const MAX_TEMPO = 120;
export const MAX_SWING = 0.4;

export const ROOT_NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const SCALES = ["minor", "minorPentatonic"] as const;
export const TRACK_KINDS = ["drums", "bass", "chords", "lead", "pad"] as const;
export const DYNAMICS = ["ghost", "normal", "accent"] as const;
export const STEP_LENGTHS = ["short", "normal", "long"] as const;
export const INTENTS = ["steady", "driving", "spacious", "playful"] as const;
export const CONTOURS = ["balanced", "rising", "falling", "callResponse"] as const;
export const CHORD_COLORS = ["triad", "open", "suspended", "rich"] as const;
export const MACRO_KINDS = ["warmth", "drive", "space", "motion", "density"] as const;
export const VARIATION_AMOUNTS = ["subtle", "lively", "bold"] as const;
export const DRUM_VOICES = ["kick", "snare", "clap", "closedHat", "openHat", "tom"] as const;

export const SOUND_PRESETS = {
  drums: ["neon84", "pressure", "night"],
  bass: ["round", "saw", "pulse"],
  chords: ["analog", "glass", "stab"],
  lead: ["clear", "pluck", "laser"],
  pad: ["velvet", "choir", "cosmos"],
} as const;

export type RootNote = (typeof ROOT_NOTES)[number];
export type Scale = (typeof SCALES)[number];
export type TrackKind = (typeof TRACK_KINDS)[number];
export type StepDynamics = (typeof DYNAMICS)[number];
export type StepLength = (typeof STEP_LENGTHS)[number];
export type GrooveIntent = (typeof INTENTS)[number];
export type PhraseContour = (typeof CONTOURS)[number];
export type ChordColor = (typeof CHORD_COLORS)[number];
export type MacroKind = (typeof MACRO_KINDS)[number];
export type VariationAmount = (typeof VARIATION_AMOUNTS)[number];
export type DrumVoice = (typeof DRUM_VOICES)[number];
export type SoundPresetId = (typeof SOUND_PRESETS)[TrackKind][number];
export type SoundPresetMap = { [K in TrackKind]: (typeof SOUND_PRESETS)[K][number] };

export interface Step {
  enabled: boolean;
  dynamics: StepDynamics;
  variation: number;
  degreeOffset: number;
  length: StepLength;
  drumVoices: DrumVoice[];
}

export interface BarPattern {
  steps: Step[];
}

export interface TrackMacros {
  warmth: number;
  drive: number;
  space: number;
  motion: number;
  density: number;
}

export interface TrackPattern {
  instrument: TrackKind;
  intent: GrooveIntent;
  contour: PhraseContour;
  bars: BarPattern[];
  macros: TrackMacros;
}

export interface ChordSlot {
  degree: number;
  inversion: number;
  color: ChordColor;
}

export interface Scene {
  name: string;
  subtitle: string;
  chords: ChordSlot[];
  tracks: TrackPattern[];
}

export interface MixChannel {
  instrument: TrackKind;
  muted: boolean;
  solo: boolean;
  volume: number;
}

interface ProjectBase {
  tempo: number;
  key: RootNote;
  scale: Scale;
  swing: number;
  masterVolume: number;
  mix: MixChannel[];
}

export interface ProjectV2 extends ProjectBase {
  schemaVersion: typeof SCHEMA_VERSION;
  soundPresets: SoundPresetMap;
  scenes: Scene[];
}

export interface StepV1 extends Omit<Step, "drumVoices"> {}
export interface BarPatternV1 { steps: StepV1[]; }
export interface TrackPatternV1 extends Omit<TrackPattern, "bars"> { bars: BarPatternV1[]; }
export interface SceneV1 extends Omit<Scene, "tracks"> { tracks: TrackPatternV1[]; }

export interface ProjectV1 extends ProjectBase {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION;
  scenes: SceneV1[];
}

export interface SelectedStep {
  bar: number;
  step: number;
}

export interface AppUiState {
  selectedScene: number;
  selectedTrack: TrackKind;
  selectedStep: SelectedStep | null;
  variationAmount: VariationAmount;
  locks: Record<TrackKind, [boolean, boolean, boolean, boolean]>;
}

export interface TransportState {
  status: "idle" | "starting" | "playing" | "suspended" | "error";
  runningScene: number;
  queuedScene: number | null;
  bar: number;
  step: number;
  peak: number;
  trackPeaks: Record<TrackKind, number>;
  message: string;
}

export interface AppState {
  project: ProjectV2;
  ui: AppUiState;
  transport: TransportState;
  canUndo: boolean;
  canRedo: boolean;
  autosave: "ready" | "saving" | "saved" | "error";
}

export interface RoleOption {
  value: string;
  label: string;
  degreeOffset: number;
  variation?: number;
}
