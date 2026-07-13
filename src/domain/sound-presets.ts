import type { SoundPresetId, TrackKind, TrackMacros } from "./types";

export interface SoundPresetDefinition {
  id: SoundPresetId;
  label: string;
  hint: string;
  level: number;
  brightness: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  oscillator: "sine" | "triangle" | "sawtooth" | "square" | "fatsawtooth" | "fmsine";
  detune: number;
}

export const SOUND_PRESET_DEFINITIONS: { [K in TrackKind]: readonly SoundPresetDefinition[] } = {
  drums: [
    { id: "neon84", label: "Neon 84", hint: "Knackige Transienten und helle, klassische Drumcomputer-Hats.", level: 0.7, brightness: 0.72, attack: 0.001, decay: 0.22, sustain: 0, release: 0.14, oscillator: "sine", detune: 0 },
    { id: "pressure", label: "Druck", hint: "Mehr Körper, kürzere Räume und ein dichter Grundton.", level: 0.61, brightness: 0.48, attack: 0.001, decay: 0.3, sustain: 0, release: 0.18, oscillator: "sine", detune: -3 },
    { id: "night", label: "Nacht", hint: "Dunkler, weicher und etwas länger ausklingend.", level: 0.66, brightness: 0.3, attack: 0.002, decay: 0.36, sustain: 0, release: 0.24, oscillator: "triangle", detune: -8 },
  ],
  bass: [
    { id: "round", label: "Rund", hint: "Weicher Sub-Bass mit ruhigem Filterverlauf.", level: 0.58, brightness: 0.3, attack: 0.008, decay: 0.2, sustain: 0.54, release: 0.18, oscillator: "triangle", detune: 0 },
    { id: "saw", label: "Säge", hint: "Kantiger Synthwave-Bass mit hörbaren Obertönen.", level: 0.46, brightness: 0.68, attack: 0.004, decay: 0.16, sustain: 0.42, release: 0.14, oscillator: "sawtooth", detune: -4 },
    { id: "pulse", label: "Puls", hint: "Straffer Rechteckpuls für rhythmische Bassfiguren.", level: 0.48, brightness: 0.52, attack: 0.003, decay: 0.11, sustain: 0.32, release: 0.1, oscillator: "square", detune: 3 },
  ],
  chords: [
    { id: "analog", label: "Analog", hint: "Breite, warme Polysynth-Akkorde.", level: 0.32, brightness: 0.48, attack: 0.018, decay: 0.25, sustain: 0.42, release: 0.58, oscillator: "fatsawtooth", detune: 6 },
    { id: "glass", label: "Glas", hint: "Helle FM-artige Akkorde mit sauberem Schimmer.", level: 0.29, brightness: 0.82, attack: 0.006, decay: 0.34, sustain: 0.22, release: 0.72, oscillator: "fmsine", detune: 0 },
    { id: "stab", label: "Stab", hint: "Kurze, trockene Akkordschläge mit klarer Kontur.", level: 0.35, brightness: 0.62, attack: 0.002, decay: 0.12, sustain: 0.12, release: 0.2, oscillator: "sawtooth", detune: -2 },
  ],
  lead: [
    { id: "clear", label: "Klar", hint: "Präsente, singende Linie mit kontrollierter Schärfe.", level: 0.4, brightness: 0.66, attack: 0.008, decay: 0.15, sustain: 0.4, release: 0.2, oscillator: "square", detune: 0 },
    { id: "pluck", label: "Pluck", hint: "Kurzer Anschlag für Arpeggios und federnde Figuren.", level: 0.44, brightness: 0.74, attack: 0.002, decay: 0.09, sustain: 0.12, release: 0.12, oscillator: "sawtooth", detune: -3 },
    { id: "laser", label: "Laser", hint: "Schmaler FM-Ton mit futuristischem Biss.", level: 0.36, brightness: 0.9, attack: 0.003, decay: 0.18, sustain: 0.28, release: 0.3, oscillator: "fmsine", detune: 5 },
  ],
  pad: [
    { id: "velvet", label: "Samt", hint: "Dunkle, weiche Fläche mit langsamem Atem.", level: 0.22, brightness: 0.28, attack: 0.28, decay: 0.55, sustain: 0.56, release: 1.6, oscillator: "fatsawtooth", detune: -5 },
    { id: "choir", label: "Chor", hint: "Hohle, chorartige Fläche mit sanfter Bewegung.", level: 0.2, brightness: 0.5, attack: 0.38, decay: 0.7, sustain: 0.52, release: 1.9, oscillator: "fmsine", detune: 4 },
    { id: "cosmos", label: "Kosmos", hint: "Breite, helle Fläche für schwebende Übergänge.", level: 0.18, brightness: 0.72, attack: 0.5, decay: 0.8, sustain: 0.48, release: 2.4, oscillator: "fatsawtooth", detune: 9 },
  ],
};

export interface SafeEffectParameters {
  cutoff: number;
  filterQ: number;
  driveThreshold: number;
  driveRatio: number;
  chorusWet: number;
  delayWet: number;
  feedback: number;
  reverbWet: number;
}

export function presetDefinition(track: TrackKind, preset: SoundPresetId): SoundPresetDefinition {
  return SOUND_PRESET_DEFINITIONS[track].find((entry) => entry.id === preset) ?? SOUND_PRESET_DEFINITIONS[track][0]!;
}

export function safeEffectParameters(
  track: TrackKind,
  preset: SoundPresetId,
  macros: TrackMacros,
): SafeEffectParameters {
  const definition = presetDefinition(track, preset);
  const baseCutoff = track === "bass" ? 720 : track === "pad" ? 4_600 : track === "drums" ? 9_200 : 7_200;
  return {
    cutoff: clamp(baseCutoff * (0.48 + definition.brightness * 0.78) * (1.18 - macros.warmth * 0.46), 180, 12_500),
    filterQ: clamp(0.6 + macros.drive * 2.4, 0.6, 3),
    driveThreshold: clamp(-8 - macros.drive * 12, -20, -8),
    driveRatio: clamp(1.2 + macros.drive * 3, 1.2, 4.2),
    chorusWet: clamp(0.04 + macros.motion * 0.26, 0.04, 0.3),
    delayWet: clamp(macros.space * 0.23, 0, 0.23),
    feedback: clamp(0.08 + macros.motion * 0.24, 0.08, 0.32),
    reverbWet: clamp(macros.space * (track === "pad" ? 0.44 : 0.29), 0, track === "pad" ? 0.44 : 0.29),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
