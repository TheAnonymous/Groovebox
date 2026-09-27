import * as Tone from "tone";
import { LeanFilter, SleepyOutput } from "./lean";
import { LeanEnvelope, LeanTone, NoiseVoice, OneShotTone, type BasicWave, type ToneSpec } from "./lean-voices";
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

export interface VoiceBankOptions {
  /** Offline renders keep every voice connected; live banks sleep while silent. */
  alwaysAwake?: boolean;
}

/** Margin after an envelope has fully released before a voice is disconnected. */
const SLEEP_MARGIN_SECONDS = 0.15;

export function createVoiceBank(
  track: TrackKind,
  preset: SoundPresetId,
  destination: Tone.ToneAudioNode,
  options: VoiceBankOptions = {},
): VoiceBank {
  return track === "drums"
    ? createDrumBank(preset, destination, options.alwaysAwake ?? false)
    : createMelodicBank(track, preset, destination, options.alwaysAwake ?? false);
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

function createDrumBank(preset: SoundPresetId, destination: Tone.ToneAudioNode, alwaysAwake: boolean): VoiceBank {
  const definition = presetDefinition("drums", preset);
  const character = definition.drums;
  if (!character) throw new Error(`Drum-Preset ${preset} besitzt keinen Drum-Charakter`);
  const output = new Tone.Gain(definition.level).connect(destination);
  const kickBus = new Tone.Gain(1);
  // Tone.MembraneSynth: exponential attack, pitch falling from f·2^octaves to f.
  const kickPitch = new OneShotTone({ kind: "basic", type: definition.oscillator === "triangle" ? "triangle" : "sine" }, {
    pitch: { octaves: character.kickOctaves, pitchDecay: character.kickPitchDecay },
    envelope: { attack: definition.attack, decay: definition.decay, sustain: 0.01, release: definition.release, attackCurve: "exponential" },
  }).connect(kickBus);
  const kickSub = new OneShotTone({ kind: "basic", type: "sine" }, {
    pitch: { octaves: Math.max(2.4, character.kickOctaves * 0.48), pitchDecay: character.kickPitchDecay * 1.35 },
    envelope: { attack: 0.001, decay: definition.decay * 1.2, sustain: 0.015, release: definition.release, attackCurve: "exponential" },
  }).connect(kickBus);
  const kickClickFilter = new LeanFilter({ type: "highpass", frequency: 3_800, Q: 0.45, rolloff: -12 }).connect(kickBus);
  const kickClick = new NoiseVoice("white", { attack: 0.001, decay: 0.012, sustain: 0, release: 0.008 }).connect(kickClickFilter);

  const snarePanner = new Tone.Panner(-0.04);
  const snareFilter = new LeanFilter({ type: "bandpass", frequency: character.snareBandFrequency, Q: 0.72, rolloff: -12 }).connect(snarePanner);
  const snareNoise = new NoiseVoice(character.snareNoise === "pink" ? "pink" : "white", {
    attack: 0.001, decay: 0.11 + definition.decay * 0.32, sustain: 0, release: definition.release * 0.55,
  }).connect(snareFilter);
  const snareBody = new OneShotTone({ kind: "basic", type: "triangle" }, {
    envelope: { attack: 0.001, decay: 0.09 + definition.decay * 0.18, sustain: 0, release: 0.05 },
  }).connect(snarePanner);

  const clapPanner = new Tone.Panner(0.08);
  const clapFilter = new LeanFilter({ type: "highpass", frequency: Math.max(1_100, character.snareBandFrequency * 0.72), Q: 0.5, rolloff: -12 }).connect(clapPanner);
  const clapParts = Array.from({ length: 3 }, () => new NoiseVoice("white", {
    attack: 0.001, decay: character.clapTail, sustain: 0, release: character.clapTail * 0.7,
  }).connect(clapFilter));

  const closedHatPanner = new Tone.Panner(-0.14);
  const openHatPanner = new Tone.Panner(0.16);
  const closedHatNoiseFilter = new LeanFilter({ type: "highpass", frequency: character.hatNoiseCutoff, Q: 0.45, rolloff: -12 }).connect(closedHatPanner);
  const openHatNoiseFilter = new LeanFilter({ type: "highpass", frequency: character.hatNoiseCutoff, Q: 0.45, rolloff: -12 }).connect(openHatPanner);
  const closedHatNoise = new NoiseVoice("white", { attack: 0.001, decay: 0.075, sustain: 0, release: 0.035 }).connect(closedHatNoiseFilter);
  const openHatNoise = new NoiseVoice(definition.brightness > 0.5 ? "white" : "pink", {
    attack: 0.001, decay: (0.32 + definition.decay * 0.3) * character.openHatScale, sustain: 0, release: 0.12 * character.openHatScale,
  }).connect(openHatNoiseFilter);

  const tomPanner = new Tone.Panner(0);
  const tom = new OneShotTone({ kind: "basic", type: "triangle" }, {
    pitch: { octaves: character.tomOctaves, pitchDecay: character.tomPitchDecay },
    envelope: { attack: 0.002, decay: 0.22 + definition.decay * 0.4, sustain: 0.02, release: 0.16, attackCurve: "exponential" },
  }).connect(tomPanner);
  const groups = {
    kick: new SleepyOutput(kickBus, output, alwaysAwake),
    snare: new SleepyOutput(snarePanner, output, alwaysAwake),
    clap: new SleepyOutput(clapPanner, output, alwaysAwake),
    closedHat: new SleepyOutput(closedHatPanner, output, alwaysAwake),
    openHat: new SleepyOutput(openHatPanner, output, alwaysAwake),
    tom: new SleepyOutput(tomPanner, output, alwaysAwake),
  } satisfies Record<DrumVoice, SleepyOutput>;
  const nodes: Tone.ToneAudioNode[] = [
    kickBus,
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
    const clapSpread = 2 * character.clapSpacing * (0.88 + expression * 0.24);
    const tails: Record<DrumVoice, number> = {
      kick: 0.3 * length + definition.release,
      snare: 0.24 * length + definition.release,
      clap: clapSpread + (character.clapTail + 0.07) * length + character.clapTail * 0.7,
      closedHat: 0.15 * length + 0.08,
      openHat: (0.52 * length + 0.12) * character.openHatScale + (0.28 + definition.decay * 0.5) * character.openHatScale * 0.45,
      tom: 0.38 * length + 0.16,
    };
    groups[voice].wake(time, time + tails[voice] + SLEEP_MARGIN_SECONDS);
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
      openHatNoise.triggerRelease(time);
      closedHatNoise.triggerAttackRelease((0.06 + expression * 0.06) * length, time, velocity * 0.24);
    } else if (voice === "openHat") {
      openHatNoise.triggerAttackRelease((0.2 + expression * 0.32) * character.openHatScale * length, time, velocity * 0.2);
    } else {
      const noteIndex = expression > 0.66 ? 2 : expression > 0.33 ? 1 : 0;
      tomPanner.pan.setValueAtTime([-0.18, 0, 0.18][noteIndex] ?? 0, time);
      tom.triggerAttackRelease(Tone.Frequency(character.tomNotes[noteIndex] ?? "C2").toFrequency(), (0.16 + expression * 0.22) * length, time, velocity * 0.58);
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
      closedHatNoise.triggerRelease(time);
      openHatNoise.triggerRelease(time);
      tom.triggerRelease(time);
    },
    dispose: () => {
      Object.values(groups).forEach((group) => group.dispose());
      nodes.forEach((node) => node.dispose());
    },
  };
}

function createMelodicBank(
  track: Exclude<TrackKind, "drums">,
  preset: SoundPresetId,
  destination: Tone.ToneAudioNode,
  alwaysAwake: boolean,
): VoiceBank {
  const definition = presetDefinition(track, preset);
  const character = definition.voice;
  if (!character) throw new Error(`Melodisches Preset ${preset} besitzt keinen Voice-Charakter`);
  const output = new Tone.Gain(definition.level).connect(destination);
  const startAt = output.context.currentTime;
  const voices = Array.from({ length: VOICE_LIMITS[track] }, () => {
    const oscillator = new LeanTone(output.context, melodicSpec(definition), 440, definition.detune).start(startAt);
    const filter = new LeanFilter({
      type: "lowpass",
      frequency: character.filterBase,
      Q: character.filterQ,
      rolloff: character.filterRolloff,
    });
    const envelope = new LeanEnvelope({
      attack: definition.attack,
      decay: definition.decay,
      sustain: definition.sustain,
      release: definition.release,
    });
    oscillator.output.connect(filter.input);
    filter.connect(envelope);
    return { oscillator, filter, envelope, hasTriggered: false, sleep: new SleepyOutput(envelope, output, alwaysAwake) };
  });
  const subVoices = track === "bass"
    ? Array.from({ length: VOICE_LIMITS[track] }, () => {
        const oscillator = new LeanTone(output.context, { kind: "basic", type: "sine" }, 55).start(startAt);
        const filter = new LeanFilter({ type: "lowpass", frequency: 145, Q: 0.5, rolloff: -24 });
        const envelope = new LeanEnvelope({
          attack: Math.max(0.004, definition.attack),
          decay: definition.decay,
          sustain: 0.58,
          release: definition.release,
        });
        oscillator.output.connect(filter.input);
        filter.connect(envelope);
        return { oscillator, filter, envelope, hasTriggered: false, sleep: new SleepyOutput(envelope, output, alwaysAwake) };
      })
    : [];
  const transientFilter = definition.articulation.transientLevel >= 0.15
    ? new LeanFilter({ type: "highpass", frequency: track === "lead" ? 3_200 : 2_200, Q: 0.6, rolloff: -12 })
    : null;
  const transientSleep = transientFilter ? new SleepyOutput(transientFilter, output, alwaysAwake) : null;
  const transient = transientFilter
    ? new NoiseVoice("pink", { attack: 0.001, decay: 0.018, sustain: 0, release: 0.012 }).connect(transientFilter)
    : null;
  const nodes: Tone.ToneAudioNode[] = [
    ...voices.flatMap((voice) => [voice.filter, voice.envelope]),
    ...subVoices.flatMap((voice) => [voice.filter, voice.envelope]),
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
        voice.sleep.wake(time, time + expression.gateSeconds + definition.release + SLEEP_MARGIN_SECONDS);
        voice.envelope.triggerAttackRelease(expression.gateSeconds, time, expression.velocity);
        const sub = subVoices[index];
        if (sub) {
          sub.sleep.wake(time, time + expression.gateSeconds + definition.release + SLEEP_MARGIN_SECONDS);
          sub.oscillator.frequency.setValueAtTime(frequency, time);
          sub.envelope.triggerAttackRelease(expression.gateSeconds, time, expression.velocity * definition.articulation.subLevel);
          sub.hasTriggered = true;
        }
      });
      transientSleep?.wake(time, time + 0.04 + SLEEP_MARGIN_SECONDS);
      transient?.triggerAttackRelease(0.02, time, expression.velocity * definition.articulation.transientLevel);
    },
    release: (time) => {
      voices.forEach((voice) => voice.envelope.triggerRelease(time));
      subVoices.forEach((voice) => voice.envelope.triggerRelease(time));
      transient?.triggerRelease(time);
    },
    dispose: () => {
      [...voices, ...subVoices].forEach((voice) => {
        voice.sleep.dispose();
        voice.oscillator.stop(output.context.currentTime);
        voice.oscillator.dispose();
      });
      transientSleep?.dispose();
      nodes.forEach((node) => node.dispose());
    },
  };
}

/** The OmniOscillator settings of a melodic preset as a lean tone spec (FM modulators are square, as in Tone). */
function melodicSpec(definition: SoundPresetDefinition): ToneSpec {
  const character = definition.voice;
  if (!character) return { kind: "basic", type: "sine" };
  if (definition.oscillator === "fatsawtooth") return { kind: "fat", type: "sawtooth", count: character.fatCount, spread: character.fatSpread };
  if (definition.oscillator === "fmsine") {
    return { kind: "fm", type: "sine", modulationType: "square", harmonicity: character.harmonicity, modulationIndex: character.modulationIndex };
  }
  return { kind: "basic", type: definition.oscillator as BasicWave };
}

function toHz(midi: number): number {
  return Tone.Frequency(midi, "midi").toFrequency();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
