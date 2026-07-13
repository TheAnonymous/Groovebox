import * as Tone from "tone";
import { chordNotes, scaleDegreeMidi } from "../domain/music";
import { presetDefinition, safeEffectParameters } from "../domain/sound-presets";
import type {
  DrumVoice,
  ProjectV2,
  SoundPresetId,
  Step,
  TrackKind,
  TrackMacros,
} from "../domain/types";
import { TRACK_KINDS } from "../domain/types";
import { effectiveTrackGains } from "../store/store";
import { BarQueuedTransport, type SequencerPosition } from "./transport";

export type AudioStatus = "idle" | "starting" | "playing" | "suspended" | "error";

export interface AudioStatusEvent {
  status: AudioStatus;
  message: string;
}

export interface PlayheadEvent extends SequencerPosition {
  peak: number;
  trackPeaks: Record<TrackKind, number>;
}

export interface AudioEngine {
  initialize(): Promise<void>;
  start(scene: number): Promise<void>;
  stop(): void;
  panic(): void;
  queueScene(scene: number): number | null;
  syncProject(project: ProjectV2): void;
  onPlayhead(listener: (position: PlayheadEvent) => void): () => void;
  onStatus(listener: (status: AudioStatusEvent) => void): () => void;
  dispose(): void;
}

interface TrackStrip {
  filter: Tone.Filter;
  drive: Tone.Compressor;
  chorus: Tone.Chorus;
  delay: Tone.FeedbackDelay;
  reverb: Tone.Reverb;
  gain: Tone.Gain;
  meter: Tone.Meter;
}

interface VoiceBank {
  readonly track: TrackKind;
  readonly preset: SoundPresetId;
  trigger(notes: number[], step: Step, time: number, velocity: number): void;
  release(time?: number): void;
  dispose(): void;
}

type MelodicVoice = Tone.Synth | Tone.MonoSynth;

export const MAX_VOICE_BANKS = 15;
export const VOICE_LIMITS: Record<TrackKind, number> = {
  drums: 6,
  bass: 1,
  chords: 4,
  lead: 1,
  pad: 4,
};

export class ToneAudioEngine implements AudioEngine {
  private project: ProjectV2;
  private initialized = false;
  private graphReady: Promise<void> | null = null;
  private strips: Record<TrackKind, TrackStrip> | null = null;
  private readonly voiceBanks = new Map<string, VoiceBank>();
  private masterNodes: Tone.ToneAudioNode[] = [];
  private masterMeter: Tone.Meter | null = null;
  private scheduleId: number | null = null;
  private meterFrame: number | null = null;
  private measuredPeak = 0;
  private measuredTrackPeaks = zeroTrackPeaks();
  private readonly clock = new BarQueuedTransport();
  private readonly playheadListeners = new Set<(position: PlayheadEvent) => void>();
  private readonly statusListeners = new Set<(status: AudioStatusEvent) => void>();

  constructor(project: ProjectV2) {
    this.project = structuredClone(project);
  }

  async initialize(): Promise<void> {
    this.emitStatus("starting", "Audio wird vorbereitet …");
    await Tone.start();
    if (!this.initialized) {
      this.graphReady ??= this.createGraph().finally(() => { this.graphReady = null; });
      await this.graphReady;
    }
    if (Tone.getContext().state !== "running") {
      this.emitStatus("suspended", "Audio ist pausiert – Start erneut anklicken");
      return;
    }
    this.emitStatus("idle", "Audio bereit");
  }

  async start(scene: number): Promise<void> {
    try {
      await this.initialize();
      if (Tone.getContext().state !== "running") return;
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel();
      transport.position = 0;
      this.clock.start(scene);
      this.applyProject();
      this.scheduleId = transport.scheduleRepeat((time) => this.tick(time), "16n");
      transport.start("+0.05");
      this.emitStatus("playing", "Wiedergabe läuft");
    } catch (error) {
      this.emitStatus("error", error instanceof Error ? error.message : "Audio konnte nicht gestartet werden");
    }
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    if (this.scheduleId !== null) transport.clear(this.scheduleId);
    this.scheduleId = null;
    this.clock.reset();
    this.releaseAll();
    this.resetMeters();
    this.emitStatus("idle", "Gestoppt");
  }

  panic(): void {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    this.scheduleId = null;
    this.clock.reset();
    this.destroyGraph();
    this.resetMeters();
    this.emitStatus("idle", "Panik – alle Stimmen und Effekte gestoppt");
  }

  queueScene(scene: number): number | null {
    return this.clock.queue(scene);
  }

  syncProject(project: ProjectV2): void {
    this.project = structuredClone(project);
    if (this.initialized) this.applyProject();
  }

  onPlayhead(listener: (position: PlayheadEvent) => void): () => void {
    this.playheadListeners.add(listener);
    return () => this.playheadListeners.delete(listener);
  }

  onStatus(listener: (status: AudioStatusEvent) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
    this.scheduleId = null;
    this.clock.reset();
    this.destroyGraph();
    this.playheadListeners.clear();
    this.statusListeners.clear();
  }

  private async createGraph(): Promise<void> {
    const highpass = new Tone.Filter({ type: "highpass", frequency: 28, rolloff: -24 });
    const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.012, release: 0.22 });
    const limiter = new Tone.Limiter(-1.2);
    const meter = new Tone.Meter({ normalRange: false, smoothing: 0.82 });
    highpass.chain(compressor, limiter, meter, Tone.getDestination());
    this.masterNodes = [highpass, compressor, limiter, meter];
    this.masterMeter = meter;

    const strips = {} as Record<TrackKind, TrackStrip>;
    for (const track of TRACK_KINDS) {
      const filter = new Tone.Filter({ type: "lowpass", frequency: 8_000, rolloff: -12 });
      const drive = new Tone.Compressor({ threshold: -10, ratio: 1.5, attack: 0.004, release: 0.12 });
      const chorus = new Tone.Chorus({ frequency: track === "pad" ? 0.32 : 0.7, delayTime: 3.2, depth: 0.45, wet: 0.08 }).start();
      const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.18, wet: 0.1 });
      const reverb = new Tone.Reverb({ decay: track === "pad" ? 3.4 : 1.7, preDelay: 0.02, wet: 0.12 });
      const gain = new Tone.Gain(0.8);
      const trackMeter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
      filter.chain(drive, chorus, delay, reverb, gain, trackMeter, highpass);
      strips[track] = { filter, drive, chorus, delay, reverb, gain, meter: trackMeter };
    }
    this.strips = strips;
    await Promise.all(Object.values(strips).map((strip) => strip.reverb.ready));
    if (this.strips !== strips) throw new Error("Audio-Vorbereitung wurde abgebrochen");
    this.initialized = true;
    this.monitorMeters();
    this.applyProject();
  }

  private destroyGraph(): void {
    if (this.meterFrame !== null) cancelAnimationFrame(this.meterFrame);
    this.meterFrame = null;
    for (const bank of this.voiceBanks.values()) bank.dispose();
    this.voiceBanks.clear();
    Object.values(this.strips ?? {}).forEach((strip) => {
      strip.chorus.stop();
      Object.values(strip).forEach((node) => node.dispose());
    });
    this.masterNodes.forEach((node) => node.dispose());
    this.strips = null;
    this.masterNodes = [];
    this.masterMeter = null;
    this.initialized = false;
  }

  private applyProject(): void {
    const transport = Tone.getTransport();
    transport.bpm.rampTo(this.project.tempo, 0.08);
    transport.swing = this.project.swing;
    transport.swingSubdivision = "16n";
    Tone.getDestination().volume.rampTo(gainToDb(this.project.masterVolume), 0.04);
    const gains = effectiveTrackGains(this.project);
    for (const track of TRACK_KINDS) {
      const strip = this.strips?.[track];
      if (!strip) continue;
      strip.gain.gain.rampTo(gains[track], 0.03);
      const macros = this.patternFor(this.clock.runningScene, track)?.macros;
      if (macros) this.applyMacros(strip, macros, track);
    }
  }

  private applyMacros(strip: TrackStrip, macros: TrackMacros, track: TrackKind): void {
    const parameters = safeEffectParameters(track, this.project.soundPresets[track], macros);
    strip.filter.frequency.rampTo(parameters.cutoff, 0.08);
    strip.filter.Q.rampTo(parameters.filterQ, 0.08);
    strip.drive.threshold.rampTo(parameters.driveThreshold, 0.08);
    strip.drive.ratio.rampTo(parameters.driveRatio, 0.08);
    strip.chorus.wet.rampTo(parameters.chorusWet, 0.08);
    strip.delay.wet.rampTo(parameters.delayWet, 0.08);
    strip.delay.feedback.rampTo(parameters.feedback, 0.08);
    strip.reverb.wet.rampTo(parameters.reverbWet, 0.08);
  }

  private tick(time: number): void {
    if (Tone.getContext().state !== "running") {
      this.emitStatus("suspended", "Audio wurde vom Browser pausiert – Start erneut anklicken");
      return;
    }
    const position = this.clock.next();
    if (position.switched) this.applyProject();
    for (const track of TRACK_KINDS) this.triggerTrack(track, position, time);
    Tone.getDraw().schedule(() => {
      const event = { ...position, peak: this.measuredPeak, trackPeaks: { ...this.measuredTrackPeaks } };
      for (const listener of this.playheadListeners) listener(event);
    }, time);
  }

  private triggerTrack(track: TrackKind, position: SequencerPosition, time: number): void {
    const pattern = this.patternFor(position.scene, track);
    const step = pattern?.bars[position.bar]?.steps[position.step];
    const chord = this.project.scenes[position.scene]?.chords[position.bar];
    if (!pattern || !step?.enabled || !chord || effectiveTrackGains(this.project)[track] <= 0) return;
    const velocity = dynamicsVelocity(step) * (0.78 + pattern.macros.density * 0.2);
    const bank = this.bankFor(track);

    if (track === "drums") {
      bank.trigger([], step, time, velocity);
      return;
    }
    if (track === "bass") {
      bank.trigger([scaleDegreeMidi(this.project.key, this.project.scale, chord.degree, step.degreeOffset, 2)], step, time, velocity);
      return;
    }
    if (track === "lead") {
      bank.trigger([scaleDegreeMidi(this.project.key, this.project.scale, chord.degree, step.degreeOffset, 4)], step, time, velocity);
      return;
    }
    bank.trigger(chordNotes(this.project.key, this.project.scale, chord, 3).slice(0, 4), step, time, velocity);
  }

  private bankFor(track: TrackKind): VoiceBank {
    const preset = this.project.soundPresets[track];
    const key = `${track}:${preset}`;
    const existing = this.voiceBanks.get(key);
    if (existing) return existing;
    if (this.voiceBanks.size >= MAX_VOICE_BANKS) throw new Error("Maximale Zahl der Klangbänke erreicht");
    const strip = this.strips?.[track];
    if (!strip) throw new Error("Audio-Signalweg ist nicht initialisiert");
    const bank = track === "drums"
      ? createDrumBank(preset, strip.filter)
      : createMelodicBank(track, preset, strip.filter);
    this.voiceBanks.set(key, bank);
    return bank;
  }

  private patternFor(scene: number, track: TrackKind) {
    return this.project.scenes[scene]?.tracks.find((pattern) => pattern.instrument === track);
  }

  private releaseAll(): void {
    for (const bank of this.voiceBanks.values()) bank.release();
  }

  private monitorMeters(): void {
    if (!this.initialized) return;
    const peakDb = this.masterMeter?.getValue();
    const masterPeak = typeof peakDb === "number" ? Math.pow(10, peakDb / 20) : 0;
    this.measuredPeak = clamp01(Math.max(masterPeak, this.measuredPeak * 0.86));
    for (const track of TRACK_KINDS) {
      const value = this.strips?.[track].meter.getValue();
      const peak = typeof value === "number" ? value : 0;
      this.measuredTrackPeaks[track] = clamp01(Math.max(peak, this.measuredTrackPeaks[track] * 0.84));
    }
    this.meterFrame = requestAnimationFrame(() => this.monitorMeters());
  }

  private resetMeters(): void {
    this.measuredPeak = 0;
    this.measuredTrackPeaks = zeroTrackPeaks();
  }

  private emitStatus(status: AudioStatus, message: string): void {
    for (const listener of this.statusListeners) listener({ status, message });
  }
}

export function drumLayerGain(voiceCount: number): number {
  return 1 / Math.sqrt(Math.max(1, Math.min(2, Math.round(voiceCount))));
}

function createDrumBank(preset: SoundPresetId, destination: Tone.ToneAudioNode): VoiceBank {
  const definition = presetDefinition("drums", preset);
  const output = new Tone.Gain(definition.level).connect(destination);
  const kickPitch = new Tone.MembraneSynth({
    pitchDecay: 0.035 + definition.decay * 0.05,
    octaves: 6 + definition.brightness * 2,
    oscillator: { type: definition.oscillator === "triangle" ? "triangle" : "sine" },
    envelope: { attack: definition.attack, decay: definition.decay, sustain: 0.01, release: definition.release },
  }).connect(output);
  const kickSub = new Tone.MembraneSynth({
    pitchDecay: 0.06,
    octaves: 3.2,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: definition.decay * 1.2, sustain: 0.015, release: definition.release },
  }).connect(output);
  const snareNoise = new Tone.NoiseSynth({
    noise: { type: definition.brightness > 0.6 ? "white" : "pink" },
    envelope: { attack: 0.001, decay: 0.11 + definition.decay * 0.32, sustain: 0, release: definition.release * 0.55 },
  }).connect(output);
  const snareBody = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.001, decay: 0.09 + definition.decay * 0.18, sustain: 0, release: 0.05 },
  }).connect(output);
  const clapParts = Array.from({ length: 3 }, () => new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.045 + definition.decay * 0.08, sustain: 0, release: 0.035 },
  }).connect(output));
  const closedHat = makeHat(0.045 + definition.brightness * 0.025, definition).connect(output);
  const openHat = makeHat(0.28 + definition.decay * 0.5, definition).connect(output);
  const closedHatNoise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.075, sustain: 0, release: 0.035 },
  }).connect(output);
  const openHatNoise = new Tone.NoiseSynth({
    noise: { type: definition.brightness > 0.5 ? "white" : "pink" },
    envelope: { attack: 0.001, decay: 0.32 + definition.decay * 0.3, sustain: 0, release: 0.12 },
  }).connect(output);
  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.025,
    octaves: 2.6,
    oscillator: { type: "triangle" },
    envelope: { attack: 0.002, decay: 0.22 + definition.decay * 0.4, sustain: 0.02, release: 0.16 },
  }).connect(output);
  const nodes: Tone.ToneAudioNode[] = [kickPitch, kickSub, snareNoise, snareBody, ...clapParts, closedHat, openHat, closedHatNoise, openHatNoise, tom, output];

  const triggerVoice = (voice: DrumVoice, step: Step, time: number, velocity: number) => {
    const expression = clamp01(step.variation);
    const length = step.length === "short" ? 0.72 : step.length === "long" ? 1.35 : 1;
    if (voice === "kick") {
      kickPitch.triggerAttackRelease(expression > 0.66 ? "D1" : "C1", (0.12 + expression * 0.12) * length, time, velocity * 0.78);
      kickSub.triggerAttackRelease("C0", (0.18 + expression * 0.1) * length, time, velocity * 0.54);
    } else if (voice === "snare") {
      snareNoise.triggerAttackRelease((0.08 + expression * 0.16) * length, time, velocity * 0.62);
      snareBody.triggerAttackRelease(expression > 0.55 ? "D3" : "C3", (0.06 + expression * 0.08) * length, time, velocity * 0.38);
    } else if (voice === "clap") {
      clapParts.forEach((part, index) => part.triggerAttackRelease((0.045 + expression * 0.08) * length, time + index * 0.012, velocity * (0.36 - index * 0.04)));
    } else if (voice === "closedHat") {
      openHat.triggerRelease(time);
      openHatNoise.triggerRelease(time);
      closedHat.triggerAttackRelease((0.07 + expression * 0.08) * length, time, velocity * 0.46);
      closedHatNoise.triggerAttackRelease((0.06 + expression * 0.06) * length, time, velocity * 0.24);
    } else if (voice === "openHat") {
      openHat.triggerAttackRelease((0.18 + expression * 0.34) * length, time, velocity * 0.3);
      openHatNoise.triggerAttackRelease((0.2 + expression * 0.32) * length, time, velocity * 0.2);
    } else {
      tom.triggerAttackRelease(expression > 0.66 ? "A1" : expression > 0.33 ? "G1" : "E1", (0.16 + expression * 0.22) * length, time, velocity * 0.58);
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

function makeHat(decay: number, definition: ReturnType<typeof presetDefinition>): Tone.MetalSynth {
  const hat = new Tone.MetalSynth({
    harmonicity: 4.7 + definition.brightness,
    modulationIndex: 22 + definition.brightness * 8,
    resonance: 2_800 + definition.brightness * 1_800,
    octaves: 1.2 + definition.brightness * 0.6,
    envelope: { attack: 0.001, decay, release: decay * 0.45 },
  });
  hat.frequency.value = 210 + definition.brightness * 70;
  return hat;
}

function createMelodicBank(track: Exclude<TrackKind, "drums">, preset: SoundPresetId, destination: Tone.ToneAudioNode): VoiceBank {
  const definition = presetDefinition(track, preset);
  const output = new Tone.Gain(definition.level).connect(destination);
  const voices: MelodicVoice[] = Array.from({ length: VOICE_LIMITS[track] }, () => {
    if (track === "bass" || track === "lead") {
      return new Tone.MonoSynth({
        oscillator: { type: definition.oscillator },
        filter: { type: "lowpass", Q: track === "bass" ? 2.2 : 1.6, rolloff: track === "bass" ? -24 : -12 },
        filterEnvelope: {
          attack: definition.attack,
          decay: definition.decay,
          sustain: definition.sustain,
          release: definition.release,
          baseFrequency: track === "bass" ? 80 : 320,
          octaves: 2.2 + definition.brightness * 1.8,
        },
        envelope: {
          attack: definition.attack,
          decay: definition.decay,
          sustain: definition.sustain,
          release: definition.release,
        },
      }).connect(output);
    }
    return new Tone.Synth({
      oscillator: definition.oscillator === "fatsawtooth"
        ? { type: "fatsawtooth", count: 2, spread: 14 + Math.abs(definition.detune) }
        : { type: definition.oscillator },
      envelope: {
        attack: definition.attack,
        decay: definition.decay,
        sustain: definition.sustain,
        release: definition.release,
      },
    }).connect(output);
  });
  const nodes: Tone.ToneAudioNode[] = [...voices, output];

  return {
    track,
    preset,
    trigger: (notes, step, time, velocity) => {
      const duration = track === "pad"
        ? step.length === "short" ? "8n" : step.length === "long" ? "1m" : "2n"
        : stepDuration(step);
      voices.forEach((voice, index) => {
        const note = notes[index];
        if (note === undefined) return;
        voice.triggerAttackRelease(toHz(note), duration, time, velocity);
      });
    },
    release: (time) => voices.forEach((voice) => voice.triggerRelease(time)),
    dispose: () => nodes.forEach((node) => node.dispose()),
  };
}

function dynamicsVelocity(step: Step): number {
  if (step.dynamics === "ghost") return 0.42;
  if (step.dynamics === "accent") return 1;
  return 0.72;
}

function stepDuration(step: Step): Tone.Unit.Time {
  if (step.length === "short") return "32n";
  if (step.length === "long") return "8n";
  return "16n";
}

function toHz(midi: number): number {
  return Tone.Frequency(midi, "midi").toFrequency();
}

function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

function zeroTrackPeaks(): Record<TrackKind, number> {
  return Object.fromEntries(TRACK_KINDS.map((track) => [track, 0])) as Record<TrackKind, number>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
