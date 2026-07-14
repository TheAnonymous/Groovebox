import * as Tone from "tone";
import { presetDefinition, type SoundPresetDefinition } from "../domain/sound-presets";
import type { DrumVoice, SoundPresetId, Step, TrackKind } from "../domain/types";

export interface VoiceBank {
  readonly track: TrackKind;
  readonly preset: SoundPresetId;
  trigger(notes: number[], step: Step, time: number, velocity: number): void;
  release(time?: number): void;
  dispose(): void;
}

export interface MelodicExpression {
  gateSeconds: number;
  filterOctaves: number;
  detuneCents: number;
  velocity: number;
}

export const MAX_VOICE_BANKS = 15;
export const VOICE_LIMITS: Record<TrackKind, number> = {
  drums: 6,
  bass: 1,
  chords: 4,
  lead: 1,
  pad: 4,
};

export function createVoiceBank(
  track: TrackKind,
  preset: SoundPresetId,
  destination: Tone.ToneAudioNode,
): VoiceBank {
  return track === "drums"
    ? createDrumBank(preset, destination)
    : createMelodicBank(track, preset, destination);
}

export function drumLayerGain(voiceCount: number): number {
  return 1 / Math.sqrt(Math.max(1, Math.min(2, Math.round(voiceCount))));
}

export function melodicExpression(
  definition: SoundPresetDefinition,
  step: Step,
  velocity: number,
): MelodicExpression {
  if (!definition.voice) throw new Error(`Preset ${definition.id} besitzt keinen Voice-Charakter`);
  const amount = clamp01(step.variation);
  const articulation = definition.articulation;
  return {
    gateSeconds: Math.min(3.5, articulation.gate[step.length] * (1 + amount * articulation.variation.gate)),
    filterOctaves: definition.voice.filterOctaves + amount * articulation.filterMovement * articulation.variation.filter,
    detuneCents: definition.detune + amount * articulation.variation.detune,
    velocity: clamp01(velocity * (1 + amount * articulation.variation.velocity)),
  };
}

export function maximumDryTailSeconds(definition: SoundPresetDefinition): number {
  return definition.articulation.gate.long * (1 + definition.articulation.variation.gate) + definition.release;
}

function createDrumBank(preset: SoundPresetId, destination: Tone.ToneAudioNode): VoiceBank {
  const definition = presetDefinition("drums", preset);
  const character = definition.drums;
  if (!character) throw new Error(`Drum-Preset ${preset} besitzt keinen Drum-Charakter`);
  const output = new Tone.Gain(definition.level).connect(destination);
  const kickPitch = new Tone.MembraneSynth({
    pitchDecay: character.kickPitchDecay,
    octaves: character.kickOctaves,
    oscillator: { type: definition.oscillator === "triangle" ? "triangle" : "sine" },
    envelope: { attack: definition.attack, decay: definition.decay, sustain: 0.01, release: definition.release },
  }).connect(output);
  const kickSub = new Tone.MembraneSynth({
    pitchDecay: character.kickPitchDecay * 1.35,
    octaves: Math.max(2.4, character.kickOctaves * 0.48),
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: definition.decay * 1.2, sustain: 0.015, release: definition.release },
  }).connect(output);
  const kickClickFilter = new Tone.Filter({ type: "highpass", frequency: 3_800, Q: 0.45, rolloff: -12 }).connect(output);
  const kickClick = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.012, sustain: 0, release: 0.008 },
  }).connect(kickClickFilter);

  const snarePanner = new Tone.Panner(-0.04).connect(output);
  const snareFilter = new Tone.Filter({ type: "bandpass", frequency: character.snareBandFrequency, Q: 0.72, rolloff: -12 }).connect(snarePanner);
  const snareNoise = new Tone.NoiseSynth({
    noise: { type: character.snareNoise },
    envelope: { attack: 0.001, decay: 0.11 + definition.decay * 0.32, sustain: 0, release: definition.release * 0.55 },
  }).connect(snareFilter);
  const snareBody = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.001, decay: 0.09 + definition.decay * 0.18, sustain: 0, release: 0.05 },
  }).connect(snarePanner);

  const clapPanner = new Tone.Panner(0.08).connect(output);
  const clapFilter = new Tone.Filter({ type: "highpass", frequency: Math.max(1_100, character.snareBandFrequency * 0.72), Q: 0.5, rolloff: -12 }).connect(clapPanner);
  const clapParts = Array.from({ length: 3 }, () => new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: character.clapTail, sustain: 0, release: character.clapTail * 0.7 },
  }).connect(clapFilter));

  const closedHatPanner = new Tone.Panner(-0.14).connect(output);
  const openHatPanner = new Tone.Panner(0.16).connect(output);
  const closedHat = makeHat(0.045 + definition.brightness * 0.025, definition).connect(closedHatPanner);
  const openHat = makeHat((0.28 + definition.decay * 0.5) * character.openHatScale, definition).connect(openHatPanner);
  const closedHatNoiseFilter = new Tone.Filter({ type: "highpass", frequency: character.hatNoiseCutoff, Q: 0.45, rolloff: -12 }).connect(closedHatPanner);
  const openHatNoiseFilter = new Tone.Filter({ type: "highpass", frequency: character.hatNoiseCutoff, Q: 0.45, rolloff: -12 }).connect(openHatPanner);
  const closedHatNoise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.075, sustain: 0, release: 0.035 },
  }).connect(closedHatNoiseFilter);
  const openHatNoise = new Tone.NoiseSynth({
    noise: { type: definition.brightness > 0.5 ? "white" : "pink" },
    envelope: { attack: 0.001, decay: (0.32 + definition.decay * 0.3) * character.openHatScale, sustain: 0, release: 0.12 * character.openHatScale },
  }).connect(openHatNoiseFilter);

  const tomPanner = new Tone.Panner(0).connect(output);
  const tom = new Tone.MembraneSynth({
    pitchDecay: character.tomPitchDecay,
    octaves: character.tomOctaves,
    oscillator: { type: "triangle" },
    envelope: { attack: 0.002, decay: 0.22 + definition.decay * 0.4, sustain: 0.02, release: 0.16 },
  }).connect(tomPanner);
  const nodes: Tone.ToneAudioNode[] = [
    kickPitch,
    kickSub,
    kickClickFilter,
    kickClick,
    snarePanner,
    snareFilter,
    snareNoise,
    snareBody,
    clapPanner,
    clapFilter,
    ...clapParts,
    closedHatPanner,
    openHatPanner,
    closedHat,
    openHat,
    closedHatNoiseFilter,
    openHatNoiseFilter,
    closedHatNoise,
    openHatNoise,
    tomPanner,
    tom,
    output,
  ];

  const triggerVoice = (voice: DrumVoice, step: Step, time: number, velocity: number) => {
    const expression = clamp01(step.variation);
    const length = step.length === "short" ? 0.72 : step.length === "long" ? 1.35 : 1;
    if (voice === "kick") {
      const tunedKick = Tone.Frequency(character.kickNote).toFrequency() * (1 + expression * 0.035);
      kickPitch.triggerAttackRelease(tunedKick, (0.12 + expression * 0.12) * length, time, velocity * 0.76);
      kickSub.triggerAttackRelease(character.kickSubFrequency, (0.18 + expression * 0.1) * length, time, velocity * definition.articulation.subLevel);
      kickClick.triggerAttackRelease(0.014, time, velocity * definition.articulation.transientLevel);
    } else if (voice === "snare") {
      snareNoise.triggerAttackRelease((0.08 + expression * 0.16) * length, time, velocity * 0.6);
      const tunedBody = Tone.Frequency(character.snareBodyNote).toFrequency() * (1 + expression * 0.08);
      snareBody.triggerAttackRelease(tunedBody, (0.06 + expression * 0.08) * length, time, velocity * 0.38);
    } else if (voice === "clap") {
      clapParts.forEach((part, index) => part.triggerAttackRelease(
        (character.clapTail + expression * 0.07) * length,
        time + index * character.clapSpacing * (0.88 + expression * 0.24),
        velocity * (0.36 - index * 0.04),
      ));
    } else if (voice === "closedHat") {
      openHat.triggerRelease(time);
      openHatNoise.triggerRelease(time);
      closedHat.triggerAttackRelease((0.07 + expression * 0.08) * length, time, velocity * 0.46);
      closedHatNoise.triggerAttackRelease((0.06 + expression * 0.06) * length, time, velocity * 0.24);
    } else if (voice === "openHat") {
      openHat.triggerAttackRelease((0.18 + expression * 0.34) * character.openHatScale * length, time, velocity * 0.3);
      openHatNoise.triggerAttackRelease((0.2 + expression * 0.32) * character.openHatScale * length, time, velocity * 0.2);
    } else {
      const noteIndex = expression > 0.66 ? 2 : expression > 0.33 ? 1 : 0;
      tomPanner.pan.setValueAtTime([-0.18, 0, 0.18][noteIndex] ?? 0, time);
      tom.triggerAttackRelease(character.tomNotes[noteIndex], (0.16 + expression * 0.22) * length, time, velocity * 0.58);
    }
  };

  return {
    track: "drums",
    preset,
    trigger: (_notes, step, time, velocity) => {
      const gain = drumLayerGain(step.drumVoices.length);
      step.drumVoices.forEach((voice) => triggerVoice(voice, step, time, velocity * gain));
    },
    release: (time) => {
      kickPitch.triggerRelease(time);
      kickSub.triggerRelease(time);
      kickClick.triggerRelease(time);
      snareNoise.triggerRelease(time);
      snareBody.triggerRelease(time);
      clapParts.forEach((part) => part.triggerRelease(time));
      closedHat.triggerRelease(time);
      openHat.triggerRelease(time);
      closedHatNoise.triggerRelease(time);
      openHatNoise.triggerRelease(time);
      tom.triggerRelease(time);
    },
    dispose: () => nodes.forEach((node) => node.dispose()),
  };
}

function makeHat(decay: number, definition: SoundPresetDefinition): Tone.Synth {
  const character = definition.drums;
  if (!character) throw new Error(`Preset ${definition.id} besitzt keinen Drum-Charakter`);
  const hat = new Tone.Synth({
    oscillator: {
      type: "fmsquare",
      harmonicity: character.hatHarmonicity,
      modulationIndex: 12 + definition.brightness * 7,
    },
    envelope: { attack: 0.001, decay, sustain: 0, release: decay * 0.45 },
  });
  hat.frequency.value = character.hatFrequency;
  hat.volume.value = -5;
  return hat;
}

function createMelodicBank(
  track: Exclude<TrackKind, "drums">,
  preset: SoundPresetId,
  destination: Tone.ToneAudioNode,
): VoiceBank {
  const definition = presetDefinition(track, preset);
  const character = definition.voice;
  if (!character) throw new Error(`Melodisches Preset ${preset} besitzt keinen Voice-Charakter`);
  const output = new Tone.Gain(definition.level).connect(destination);
  const voices = Array.from({ length: VOICE_LIMITS[track] }, () => {
    const oscillator = new Tone.OmniOscillator({ frequency: 440, ...melodicOscillator(definition) });
    const filter = new Tone.Filter({
      type: "lowpass",
      frequency: character.filterBase,
      Q: character.filterQ,
      rolloff: character.filterRolloff,
    });
    const envelope = new Tone.AmplitudeEnvelope({
      attack: definition.attack,
      decay: definition.decay,
      sustain: definition.sustain,
      release: definition.release,
    });
    oscillator.chain(filter, envelope, output).start();
    return { oscillator, filter, envelope, hasTriggered: false };
  });
  const subVoices = track === "bass"
    ? Array.from({ length: VOICE_LIMITS[track] }, () => {
        const oscillator = new Tone.OmniOscillator({ frequency: 55, type: "sine" });
        const filter = new Tone.Filter({ type: "lowpass", frequency: 145, Q: 0.5, rolloff: -24 });
        const envelope = new Tone.AmplitudeEnvelope({
          attack: Math.max(0.004, definition.attack),
          decay: definition.decay,
          sustain: 0.58,
          release: definition.release,
        });
        oscillator.chain(filter, envelope, output).start();
        return { oscillator, filter, envelope, hasTriggered: false };
      })
    : [];
  const transientFilter = definition.articulation.transientLevel >= 0.15
    ? new Tone.Filter({ type: "highpass", frequency: track === "lead" ? 3_200 : 2_200, Q: 0.6, rolloff: -12 }).connect(output)
    : null;
  const transient = transientFilter
    ? new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.018, sustain: 0, release: 0.012 } }).connect(transientFilter)
    : null;
  const nodes: Tone.ToneAudioNode[] = [
    ...voices.flatMap((voice) => [voice.oscillator, voice.filter, voice.envelope]),
    ...subVoices.flatMap((voice) => [voice.oscillator, voice.filter, voice.envelope]),
    ...(transientFilter ? [transientFilter] : []),
    ...(transient ? [transient] : []),
    output,
  ];

  return {
    track,
    preset,
    trigger: (notes, step, time, velocity) => {
      const expression = melodicExpression(definition, step, velocity);
      voices.forEach((voice, index) => {
        const note = notes[index];
        if (note === undefined) return;
        const frequency = toHz(note);
        const openCutoff = Math.min(14_000, character.filterBase * 2 ** Math.min(6, expression.filterOctaves));
        const bodyCutoff = Math.min(8_000, character.filterBase * (1.25 + definition.brightness * 1.4));
        voice.filter.frequency.cancelAndHoldAtTime(time);
        voice.filter.frequency.setValueAtTime(openCutoff, time);
        voice.filter.frequency.exponentialRampTo(bodyCutoff, Math.max(0.04, definition.attack + definition.decay * 0.72), time);
        voice.oscillator.detune.setValueAtTime(expression.detuneCents, time);
        if (preset === "laser") {
          const sweepRatio = 1.055 + clamp01(step.variation) * 0.035;
          voice.oscillator.frequency.setValueAtTime(frequency * sweepRatio, time);
          voice.oscillator.frequency.exponentialRampTo(frequency, Math.min(0.052, expression.gateSeconds * 0.3), time);
        } else if (voice.hasTriggered && character.portamento > 0) {
          voice.oscillator.frequency.exponentialRampTo(frequency, character.portamento, time);
        } else {
          voice.oscillator.frequency.setValueAtTime(frequency, time);
        }
        voice.hasTriggered = true;
        voice.envelope.triggerAttackRelease(expression.gateSeconds, time, expression.velocity);
        const sub = subVoices[index];
        if (sub) {
          sub.oscillator.frequency.setValueAtTime(frequency, time);
          sub.envelope.triggerAttackRelease(expression.gateSeconds, time, expression.velocity * definition.articulation.subLevel);
          sub.hasTriggered = true;
        }
      });
      transient?.triggerAttackRelease(0.02, time, expression.velocity * definition.articulation.transientLevel);
    },
    release: (time) => {
      voices.forEach((voice) => voice.envelope.triggerRelease(time));
      subVoices.forEach((voice) => voice.envelope.triggerRelease(time));
      transient?.triggerRelease(time);
    },
    dispose: () => nodes.forEach((node) => node.dispose()),
  };
}

function melodicOscillator(definition: SoundPresetDefinition) {
  const character = definition.voice;
  if (!character) return { type: "sine" as const };
  if (definition.oscillator === "fatsawtooth") {
    return { type: "fatsawtooth" as const, count: character.fatCount, spread: character.fatSpread, detune: definition.detune };
  }
  if (definition.oscillator === "fmsine") {
    return { type: "fmsine" as const, harmonicity: character.harmonicity, modulationIndex: character.modulationIndex, detune: definition.detune };
  }
  return { type: definition.oscillator, detune: definition.detune };
}

function toHz(midi: number): number {
  return Tone.Frequency(midi, "midi").toFrequency();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
