import type { SoundPresetId, TrackKind, TrackMacros } from "./types";

interface CoreSoundPresetDefinition {
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
  voice: MelodicVoiceCharacter | null;
  drums: DrumPresetCharacter | null;
  effects: PresetEffectCharacter;
}

export interface SoundPresetDefinition extends CoreSoundPresetDefinition {
  articulation: PresetArticulation;
}

export interface PresetArticulation {
  gate: { short: number; normal: number; long: number };
  pan: number;
  highpass: number;
  transientLevel: number;
  subLevel: number;
  filterMovement: number;
  saturation: number;
  delaySubdivision: "16n" | "8n" | "8t" | "4n";
  chorusRate: number;
  eq: { low: number; mid: number; high: number };
  variation: { gate: number; filter: number; detune: number; velocity: number };
}

export interface MelodicVoiceCharacter {
  filterBase: number;
  filterOctaves: number;
  filterQ: number;
  filterRolloff: -12 | -24;
  fatCount: number;
  fatSpread: number;
  harmonicity: number;
  modulationIndex: number;
  portamento: number;
}

export interface DrumPresetCharacter {
  kickNote: "B0" | "C1";
  kickPitchDecay: number;
  kickOctaves: number;
  kickSubFrequency: number;
  kickSubLevel: number;
  snareNoise: "white" | "pink";
  snareBodyNote: "B2" | "C3" | "D3";
  snareBandFrequency: number;
  clapSpacing: number;
  clapTail: number;
  hatHarmonicity: number;
  hatResonance: number;
  hatFrequency: number;
  hatNoiseCutoff: number;
  openHatScale: number;
  tomPitchDecay: number;
  tomOctaves: number;
  tomNotes: readonly [string, string, string];
}

export interface PresetEffectCharacter {
  filterScale: number;
  resonance: number;
  chorus: number;
  delay: number;
  reverb: number;
}

const melodic = (character: Partial<MelodicVoiceCharacter> = {}): MelodicVoiceCharacter => ({
  filterBase: 180,
  filterOctaves: 3.5,
  filterQ: 1.2,
  filterRolloff: -12,
  fatCount: 2,
  fatSpread: 14,
  harmonicity: 1,
  modulationIndex: 1.5,
  portamento: 0,
  ...character,
});

const effects = (character: Partial<PresetEffectCharacter> = {}): PresetEffectCharacter => ({
  filterScale: 1,
  resonance: 0.2,
  chorus: 0.03,
  delay: 0.01,
  reverb: 0.02,
  ...character,
});

const ARTICULATION: Record<SoundPresetId, PresetArticulation> = {
  neon84: { gate: { short: 0.06, normal: 0.16, long: 0.34 }, pan: 0, highpass: 24, transientLevel: 0.34, subLevel: 0.42, filterMovement: 0.42, saturation: 0.09, delaySubdivision: "16n", chorusRate: 0.74, eq: { low: 0.4, mid: 0.7, high: 0.9 }, variation: { gate: 0.22, filter: 0.34, detune: 2, velocity: 0.1 } },
  pressure: { gate: { short: 0.08, normal: 0.22, long: 0.42 }, pan: 0, highpass: 24, transientLevel: 0.22, subLevel: 0.72, filterMovement: 0.26, saturation: 0.18, delaySubdivision: "8n", chorusRate: 0.55, eq: { low: 1.4, mid: 0.4, high: -0.7 }, variation: { gate: 0.28, filter: 0.22, detune: 1, velocity: 0.14 } },
  night: { gate: { short: 0.11, normal: 0.3, long: 0.56 }, pan: 0, highpass: 24, transientLevel: 0.14, subLevel: 0.58, filterMovement: 0.18, saturation: 0.07, delaySubdivision: "8t", chorusRate: 0.31, eq: { low: 0.8, mid: -0.4, high: -1.2 }, variation: { gate: 0.34, filter: 0.18, detune: 3, velocity: 0.12 } },
  round: { gate: { short: 0.11, normal: 0.28, long: 0.54 }, pan: 0, highpass: 24, transientLevel: 0.02, subLevel: 0.38, filterMovement: 0.26, saturation: 0.08, delaySubdivision: "8n", chorusRate: 0.38, eq: { low: 1.2, mid: 0.1, high: -1 }, variation: { gate: 0.28, filter: 0.3, detune: 2, velocity: 0.12 } },
  saw: { gate: { short: 0.07, normal: 0.2, long: 0.4 }, pan: 0, highpass: 25, transientLevel: 0.06, subLevel: 0.24, filterMovement: 0.72, saturation: 0.16, delaySubdivision: "16n", chorusRate: 0.67, eq: { low: 0.5, mid: 0.8, high: 0.2 }, variation: { gate: 0.24, filter: 0.58, detune: 7, velocity: 0.16 } },
  pulse: { gate: { short: 0.055, normal: 0.14, long: 0.3 }, pan: 0, highpass: 26, transientLevel: 0.08, subLevel: 0.18, filterMovement: 0.48, saturation: 0.12, delaySubdivision: "8t", chorusRate: 0.84, eq: { low: 0.2, mid: 1.1, high: -0.2 }, variation: { gate: 0.2, filter: 0.46, detune: 4, velocity: 0.18 } },
  analog: { gate: { short: 0.18, normal: 0.72, long: 1.42 }, pan: -0.1, highpass: 72, transientLevel: 0.03, subLevel: 0, filterMovement: 0.42, saturation: 0.1, delaySubdivision: "8n", chorusRate: 0.42, eq: { low: 0.4, mid: 0.7, high: -0.5 }, variation: { gate: 0.22, filter: 0.42, detune: 8, velocity: 0.12 } },
  glass: { gate: { short: 0.14, normal: 0.58, long: 1.18 }, pan: 0.11, highpass: 105, transientLevel: 0.07, subLevel: 0, filterMovement: 0.66, saturation: 0.04, delaySubdivision: "8t", chorusRate: 0.61, eq: { low: -0.7, mid: 0.2, high: 1 }, variation: { gate: 0.3, filter: 0.58, detune: 5, velocity: 0.16 } },
  stab: { gate: { short: 0.045, normal: 0.11, long: 0.24 }, pan: -0.08, highpass: 92, transientLevel: 0.16, subLevel: 0, filterMovement: 0.82, saturation: 0.15, delaySubdivision: "16n", chorusRate: 0.82, eq: { low: -0.3, mid: 1.2, high: 0.3 }, variation: { gate: 0.38, filter: 0.72, detune: 6, velocity: 0.2 } },
  clear: { gate: { short: 0.075, normal: 0.28, long: 0.62 }, pan: 0.08, highpass: 96, transientLevel: 0.05, subLevel: 0, filterMovement: 0.48, saturation: 0.08, delaySubdivision: "8n", chorusRate: 0.58, eq: { low: -0.5, mid: 1, high: 0.1 }, variation: { gate: 0.26, filter: 0.52, detune: 7, velocity: 0.16 } },
  pluck: { gate: { short: 0.035, normal: 0.09, long: 0.19 }, pan: -0.12, highpass: 118, transientLevel: 0.24, subLevel: 0, filterMovement: 0.88, saturation: 0.11, delaySubdivision: "8t", chorusRate: 0.76, eq: { low: -0.8, mid: 0.6, high: 1.2 }, variation: { gate: 0.42, filter: 0.82, detune: 10, velocity: 0.22 } },
  laser: { gate: { short: 0.065, normal: 0.23, long: 0.52 }, pan: 0.13, highpass: 132, transientLevel: 0.1, subLevel: 0, filterMovement: 0.96, saturation: 0.07, delaySubdivision: "8n", chorusRate: 0.94, eq: { low: -1.1, mid: 0.5, high: 1.1 }, variation: { gate: 0.3, filter: 0.9, detune: 12, velocity: 0.18 } },
  velvet: { gate: { short: 0.65, normal: 1.7, long: 2.5 }, pan: -0.16, highpass: 88, transientLevel: 0, subLevel: 0, filterMovement: 0.24, saturation: 0.04, delaySubdivision: "4n", chorusRate: 0.24, eq: { low: 0.5, mid: 0.3, high: -1.2 }, variation: { gate: 0.18, filter: 0.22, detune: 9, velocity: 0.08 } },
  choir: { gate: { short: 0.72, normal: 1.85, long: 2.55 }, pan: 0.14, highpass: 112, transientLevel: 0, subLevel: 0, filterMovement: 0.36, saturation: 0.03, delaySubdivision: "8t", chorusRate: 0.3, eq: { low: -0.1, mid: 0.8, high: -0.5 }, variation: { gate: 0.2, filter: 0.32, detune: 7, velocity: 0.1 } },
  cosmos: { gate: { short: 0.78, normal: 1.95, long: 2.5 }, pan: 0.18, highpass: 124, transientLevel: 0.02, subLevel: 0, filterMovement: 0.52, saturation: 0.035, delaySubdivision: "4n", chorusRate: 0.2, eq: { low: -0.4, mid: 0.1, high: 0.8 }, variation: { gate: 0.22, filter: 0.48, detune: 12, velocity: 0.1 } },
};

function enrichPreset(definition: CoreSoundPresetDefinition): SoundPresetDefinition {
  return { ...definition, articulation: ARTICULATION[definition.id] };
}

function presets(...definitions: CoreSoundPresetDefinition[]): SoundPresetDefinition[] {
  return definitions.map(enrichPreset);
}

export const SOUND_PRESET_DEFINITIONS: { [K in TrackKind]: readonly SoundPresetDefinition[] } = {
  drums: presets(
    { id: "neon84", label: "Neon 84", hint: "Knackige Transienten und helle, klassische Drumcomputer-Hats.", level: 0.68, brightness: 0.78, attack: 0.001, decay: 0.2, sustain: 0, release: 0.12, oscillator: "sine", detune: 0, voice: null, effects: effects({ filterScale: 1.08, resonance: 0.22, chorus: 0.025, delay: 0.008, reverb: 0.018 }), drums: { kickNote: "C1", kickPitchDecay: 0.025, kickOctaves: 7.4, kickSubFrequency: 48, kickSubLevel: 0.42, snareNoise: "white", snareBodyNote: "D3", snareBandFrequency: 2_600, clapSpacing: 0.009, clapTail: 0.042, hatHarmonicity: 5.5, hatResonance: 4_300, hatFrequency: 275, hatNoiseCutoff: 6_500, openHatScale: 0.8, tomPitchDecay: 0.018, tomOctaves: 3.2, tomNotes: ["F1", "A1", "C2"] } },
    { id: "pressure", label: "Druck", hint: "Mehr Körper, kürzere Räume und ein dichter Grundton.", level: 0.58, brightness: 0.45, attack: 0.001, decay: 0.32, sustain: 0, release: 0.17, oscillator: "sine", detune: -3, voice: null, effects: effects({ filterScale: 0.78, resonance: 0.12, chorus: 0.015, delay: 0.004, reverb: 0.012 }), drums: { kickNote: "B0", kickPitchDecay: 0.052, kickOctaves: 5.4, kickSubFrequency: 42, kickSubLevel: 0.72, snareNoise: "pink", snareBodyNote: "C3", snareBandFrequency: 1_750, clapSpacing: 0.013, clapTail: 0.064, hatHarmonicity: 4.8, hatResonance: 3_300, hatFrequency: 230, hatNoiseCutoff: 4_800, openHatScale: 0.72, tomPitchDecay: 0.035, tomOctaves: 2.4, tomNotes: ["D1", "F1", "A1"] } },
    { id: "night", label: "Nacht", hint: "Dunkler, weicher und etwas länger ausklingend.", level: 0.62, brightness: 0.28, attack: 0.002, decay: 0.4, sustain: 0, release: 0.28, oscillator: "triangle", detune: -8, voice: null, effects: effects({ filterScale: 0.58, resonance: 0.08, chorus: 0.07, delay: 0.045, reverb: 0.075 }), drums: { kickNote: "C1", kickPitchDecay: 0.07, kickOctaves: 4.2, kickSubFrequency: 39, kickSubLevel: 0.58, snareNoise: "pink", snareBodyNote: "B2", snareBandFrequency: 1_250, clapSpacing: 0.018, clapTail: 0.095, hatHarmonicity: 4.3, hatResonance: 2_600, hatFrequency: 200, hatNoiseCutoff: 3_600, openHatScale: 1.3, tomPitchDecay: 0.045, tomOctaves: 2, tomNotes: ["C1", "E1", "G1"] } },
  ),
  bass: presets(
    { id: "round", label: "Rund", hint: "Weicher Sub-Bass mit ruhigem Filterverlauf.", level: 0.56, brightness: 0.28, attack: 0.012, decay: 0.28, sustain: 0.62, release: 0.3, oscillator: "triangle", detune: -2, voice: melodic({ filterBase: 55, filterOctaves: 2.5, filterQ: 0.8, filterRolloff: -24, portamento: 0.045 }), drums: null, effects: effects({ filterScale: 0.78, resonance: 0.12, chorus: 0.025, delay: 0.004, reverb: 0.012 }) },
    { id: "saw", label: "Säge", hint: "Kantiger Synthwave-Bass mit hörbaren Obertönen.", level: 0.4, brightness: 0.72, attack: 0.003, decay: 0.14, sustain: 0.38, release: 0.14, oscillator: "fatsawtooth", detune: -5, voice: melodic({ filterBase: 130, filterOctaves: 5.5, filterQ: 1.2, filterRolloff: -12, fatCount: 2, fatSpread: 18, portamento: 0.012 }), drums: null, effects: effects({ filterScale: 1.35, resonance: 0.32, chorus: 0.045, delay: 0.01, reverb: 0.015 }) },
    { id: "pulse", label: "Puls", hint: "Straffer Rechteckpuls für rhythmische Bassfiguren.", level: 0.46, brightness: 0.5, attack: 0.002, decay: 0.1, sustain: 0.28, release: 0.09, oscillator: "square", detune: 2, voice: melodic({ filterBase: 60, filterOctaves: 2.4, filterQ: 2.7, filterRolloff: -24 }), drums: null, effects: effects({ filterScale: 0.68, resonance: 0.65, chorus: 0.012, delay: 0.022, reverb: 0.01 }) },
  ),
  chords: presets(
    { id: "analog", label: "Analog", hint: "Breite, warme Polysynth-Akkorde.", level: 0.28, brightness: 0.46, attack: 0.025, decay: 0.32, sustain: 0.48, release: 0.65, oscillator: "fatsawtooth", detune: 5, voice: melodic({ filterBase: 110, filterOctaves: 3.5, filterQ: 0.9, filterRolloff: -24, fatCount: 3, fatSpread: 22 }), drums: null, effects: effects({ filterScale: 0.78, resonance: 0.22, chorus: 0.11, delay: 0.012, reverb: 0.025 }) },
    { id: "glass", label: "Glas", hint: "Helle FM-artige Akkorde mit sauberem Schimmer.", level: 0.26, brightness: 0.84, attack: 0.004, decay: 0.42, sustain: 0.18, release: 0.85, oscillator: "fmsine", detune: 0, voice: melodic({ filterBase: 380, filterOctaves: 6, filterQ: 1.4, filterRolloff: -12, harmonicity: 3.01, modulationIndex: 7.5 }), drums: null, effects: effects({ filterScale: 1.4, resonance: 0.35, chorus: 0.055, delay: 0.06, reverb: 0.13 }) },
    { id: "stab", label: "Stab", hint: "Kurze, trockene Akkordschläge mit klarer Kontur.", level: 0.32, brightness: 0.66, attack: 0.001, decay: 0.09, sustain: 0.07, release: 0.16, oscillator: "sawtooth", detune: -2, voice: melodic({ filterBase: 130, filterOctaves: 5.4, filterQ: 2.4, filterRolloff: -24 }), drums: null, effects: effects({ filterScale: 1.1, resonance: 0.62, chorus: 0.022, delay: 0.01, reverb: 0.015 }) },
  ),
  lead: presets(
    { id: "clear", label: "Klar", hint: "Präsente, singende Linie mit kontrollierter Schärfe.", level: 0.38, brightness: 0.64, attack: 0.01, decay: 0.18, sustain: 0.44, release: 0.26, oscillator: "square", detune: 0, voice: melodic({ filterBase: 260, filterOctaves: 3.8, filterQ: 1.5, portamento: 0.025 }), drums: null, effects: effects({ filterScale: 1.05, resonance: 0.34, chorus: 0.04, delay: 0.038, reverb: 0.03 }) },
    { id: "pluck", label: "Pluck", hint: "Kurzer Anschlag für Arpeggios und federnde Figuren.", level: 0.4, brightness: 0.76, attack: 0.001, decay: 0.075, sustain: 0.06, release: 0.1, oscillator: "sawtooth", detune: -3, voice: melodic({ filterBase: 180, filterOctaves: 5.2, filterQ: 2.6, filterRolloff: -24, portamento: 0.005 }), drums: null, effects: effects({ filterScale: 1.15, resonance: 0.72, chorus: 0.02, delay: 0.052, reverb: 0.015 }) },
    { id: "laser", label: "Laser", hint: "Schmaler FM-Ton mit futuristischem Biss.", level: 0.32, brightness: 0.92, attack: 0.002, decay: 0.16, sustain: 0.3, release: 0.34, oscillator: "fmsine", detune: 4, voice: melodic({ filterBase: 380, filterOctaves: 5.7, filterQ: 2, harmonicity: 1.5, modulationIndex: 6.5, portamento: 0.055 }), drums: null, effects: effects({ filterScale: 1.35, resonance: 0.62, chorus: 0.03, delay: 0.068, reverb: 0.04 }) },
  ),
  pad: presets(
    { id: "velvet", label: "Samt", hint: "Dunkle, weiche Fläche mit langsamem Atem.", level: 0.22, brightness: 0.25, attack: 0.38, decay: 0.75, sustain: 0.62, release: 2.1, oscillator: "fatsawtooth", detune: -5, voice: melodic({ filterBase: 180, filterOctaves: 4, filterQ: 0.7, filterRolloff: -24, fatCount: 3, fatSpread: 25 }), drums: null, effects: effects({ filterScale: 0.72, resonance: 0.12, chorus: 0.15, delay: 0.012, reverb: 0.105 }) },
    { id: "choir", label: "Chor", hint: "Hohle, chorartige Fläche mit sanfter Bewegung.", level: 0.21, brightness: 0.48, attack: 0.52, decay: 0.9, sustain: 0.56, release: 2.4, oscillator: "fmsine", detune: 3, voice: melodic({ filterBase: 230, filterOctaves: 4.5, filterQ: 1.6, harmonicity: 0.5, modulationIndex: 2.4 }), drums: null, effects: effects({ filterScale: 0.9, resonance: 0.34, chorus: 0.18, delay: 0.022, reverb: 0.125 }) },
    { id: "cosmos", label: "Kosmos", hint: "Breite, helle Fläche für schwebende Übergänge.", level: 0.2, brightness: 0.74, attack: 0.65, decay: 1.1, sustain: 0.52, release: 2.4, oscillator: "fatsawtooth", detune: 8, voice: melodic({ filterBase: 280, filterOctaves: 5, filterQ: 0.9, fatCount: 4, fatSpread: 36 }), drums: null, effects: effects({ filterScale: 1.12, resonance: 0.18, chorus: 0.2, delay: 0.06, reverb: 0.12 }) },
  ),
};

export interface SafeEffectParameters {
  highpass: number;
  cutoff: number;
  filterQ: number;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  distortion: number;
  compressorThreshold: number;
  compressorRatio: number;
  chorusSend: number;
  delaySend: number;
  reverbSend: number;
  chorusRate: number;
  delaySubdivision: PresetArticulation["delaySubdivision"];
  pan: number;
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
  const character = definition.effects;
  const articulation = definition.articulation;
  const baseCutoff = track === "bass" ? 720 : track === "pad" ? 4_600 : track === "drums" ? 9_200 : 7_200;
  const highpass = articulation.highpass;
  const cutoff = clamp(baseCutoff * character.filterScale * (0.44 + definition.brightness * 0.82) * (1.18 - macros.warmth * 0.46), 180, 12_500);
  const filterQ = clamp(0.6 + character.resonance + macros.warmth * 0.36, 0.6, 3);
  const distortion = clamp(articulation.saturation + macros.drive * 0.32, 0.02, 0.5);
  const compressorThreshold = clamp(-6 - macros.drive * 6, -12, -6);
  const compressorRatio = clamp(1.15 + macros.drive * 0.7, 1.15, 1.85);
  const chorusSend = clamp(character.chorus + macros.space * 0.09 + macros.motion * 0.025, 0, 0.28);
  const delaySend = clamp(character.delay + macros.space * 0.16, 0, 0.24);
  const reverbSend = clamp(character.reverb + macros.space * (track === "pad" ? 0.25 : 0.18), 0, track === "pad" ? 0.38 : 0.26);
  const chorusRate = clamp(articulation.chorusRate * (0.62 + macros.motion * 0.92), 0.1, 1.5);
  const feedback = clamp(0.06 + character.delay * 0.7 + macros.motion * 0.2, 0.06, 0.3);
  return {
    highpass,
    cutoff,
    filterQ,
    eqLow: clamp(articulation.eq.low + (macros.warmth - 0.5) * 1.8, -2.5, 2.5),
    eqMid: clamp(articulation.eq.mid + (macros.warmth - 0.5) * 0.45, -2.5, 2.5),
    eqHigh: clamp(articulation.eq.high - (macros.warmth - 0.5) * 2.1, -2.5, 2.5),
    distortion,
    compressorThreshold,
    compressorRatio,
    chorusSend,
    delaySend,
    reverbSend,
    chorusRate,
    delaySubdivision: articulation.delaySubdivision,
    pan: articulation.pan,
    driveThreshold: compressorThreshold,
    driveRatio: compressorRatio,
    chorusWet: chorusSend,
    delayWet: delaySend,
    feedback,
    reverbWet: reverbSend,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
