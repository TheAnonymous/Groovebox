import type {
  ChordColor,
  ChordSlot,
  RoleOption,
  RootNote,
  Scale,
  Step,
  TrackKind,
} from "./types";
import { ROOT_NOTES } from "./types";

const SCALE_OFFSETS: Record<Scale, readonly number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  minorPentatonic: [0, 3, 5, 7, 10],
};

const CHORD_POSITIONS: Record<ChordColor, readonly number[]> = {
  triad: [0, 2, 4],
  open: [0, 4, 9],
  suspended: [0, 3, 4],
  rich: [0, 2, 4, 6],
};

export const KEY_LABELS: Record<RootNote, string> = {
  C: "C",
  "C#": "C♯",
  D: "D",
  "D#": "D♯",
  E: "E",
  F: "F",
  "F#": "F♯",
  G: "G",
  "G#": "G♯",
  A: "A",
  "A#": "A♯",
  B: "B",
};

export const SCALE_LABELS: Record<Scale, string> = {
  minor: "Moll",
  minorPentatonic: "Moll-Pentatonik",
};

export const DEGREE_LABELS = ["i", "ii°", "III", "iv", "v", "VI", "VII"] as const;

export function scaleOffsets(scale: Scale): readonly number[] {
  return SCALE_OFFSETS[scale];
}

export function rootSemitone(root: RootNote): number {
  return ROOT_NOTES.indexOf(root);
}

export function scaleDegreeMidi(
  root: RootNote,
  scale: Scale,
  degree: number,
  degreeOffset = 0,
  octave = 3,
): number {
  const offsets = scaleOffsets(scale);
  const base = Math.min(offsets.length - 1, Math.max(0, Math.round(degree) - 1));
  const position = base + Math.round(degreeOffset);
  const wrapped = ((position % offsets.length) + offsets.length) % offsets.length;
  const octaveShift = Math.floor(position / offsets.length);
  return 12 + octave * 12 + rootSemitone(root) + (offsets[wrapped] ?? 0) + octaveShift * 12;
}

export function isScaleTone(root: RootNote, scale: Scale, midi: number): boolean {
  const pitchClass = ((Math.round(midi) - rootSemitone(root)) % 12 + 12) % 12;
  return scaleOffsets(scale).includes(pitchClass);
}

export function quantizePitch(root: RootNote, scale: Scale, midi: number): number {
  const target = Math.round(midi);
  let best = target;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let candidate = target - 12; candidate <= target + 12; candidate += 1) {
    if (!isScaleTone(root, scale, candidate)) continue;
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function chordNotes(
  root: RootNote,
  scale: Scale,
  chord: ChordSlot,
  baseOctave = 3,
): number[] {
  const offsets = scaleOffsets(scale);
  const basePosition = Math.min(offsets.length - 1, Math.max(0, Math.round(chord.degree) - 1));
  const positions = CHORD_POSITIONS[chord.color];
  const notes = positions.map((offsetPosition) => {
    const position = basePosition + offsetPosition;
    const wrapped = position % offsets.length;
    const octaveShift = Math.floor(position / offsets.length);
    return 12 + baseOctave * 12 + rootSemitone(root) + (offsets[wrapped] ?? 0) + octaveShift * 12;
  });
  const inversion = Math.max(-2, Math.min(2, Math.round(chord.inversion)));
  for (let index = 0; index < Math.abs(inversion); index += 1) {
    notes.sort((a, b) => a - b);
    if (inversion > 0) notes[0] = (notes[0] ?? 0) + 12;
    else notes[notes.length - 1] = (notes[notes.length - 1] ?? 0) - 12;
  }
  return notes.sort((a, b) => a - b);
}

export function noteName(midi: number): string {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const rounded = Math.round(midi);
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function safeDegreeOffset(track: TrackKind, stepIndex: number, value: number): number {
  if (track === "drums" || track === "chords" || track === "pad") return 0;
  const clamped = Math.max(-2, Math.min(4, Math.round(value)));
  if (track === "bass" && stepIndex % 8 === 0) return Math.max(0, clamped);
  return clamped;
}

export function roleOptions(track: TrackKind): RoleOption[] {
  switch (track) {
    case "drums":
      return [
        { value: "kick", label: "Kick", degreeOffset: 0 },
        { value: "snare", label: "Snare", degreeOffset: 0 },
        { value: "clap", label: "Clap", degreeOffset: 0 },
        { value: "closedHat", label: "Closed Hat", degreeOffset: 0 },
        { value: "openHat", label: "Open Hat", degreeOffset: 0 },
        { value: "tom", label: "Tom", degreeOffset: 0 },
      ];
    case "bass":
      return [
        { value: "root", label: "Grundton", degreeOffset: 0 },
        { value: "below", label: "Tiefe Antwort", degreeOffset: -1 },
        { value: "up", label: "Hohe Antwort", degreeOffset: 2 },
        { value: "octave", label: "Oktavsprung", degreeOffset: 4 },
      ];
    case "chords":
      return [{ value: "chord", label: "Akkord", degreeOffset: 0 }];
    case "lead":
      return [
        { value: "root", label: "Grundton", degreeOffset: 0 },
        { value: "low", label: "Tief", degreeOffset: -2 },
        { value: "third", label: "Akkordton", degreeOffset: 2 },
        { value: "high", label: "Hoch", degreeOffset: 4 },
      ];
    case "pad":
      return [{ value: "cloud", label: "Akkordfläche", degreeOffset: 0 }];
  }
}

export function currentRole(track: TrackKind, step: Step): RoleOption {
  const options = roleOptions(track);
  if (track === "drums") {
    return options.find((option) => option.value === step.drumVoices[0]) ?? options[0]!;
  }
  return options.find((option) => option.degreeOffset === step.degreeOffset) ?? options[0]!;
}

export function chordLabel(root: RootNote, scale: Scale, chord: ChordSlot): string {
  const degree = DEGREE_LABELS[Math.max(0, Math.min(6, chord.degree - 1))] ?? "i";
  return `${degree} · ${chordNotes(root, scale, chord).map(noteName).join("–")}`;
}
