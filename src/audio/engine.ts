import * as Tone from "tone";
import { chordNotes, scaleDegreeMidi } from "../domain/music";
import { allowsRatchet, loopPosition, sceneSteps, stepChance, stepRatchet } from "../domain/patterns";
import type { ProjectV2, Step, TrackKind } from "../domain/types";
import { TRACK_KINDS } from "../domain/types";
import { effectiveTrackGains } from "../store/store";
import { applyTrackMacros, createMasterGraph, createTrackGraph, type MasterGraph, type TrackGraph } from "./graph";
import { BarQueuedTransport, type SequencerPosition } from "./transport";
import { createVoiceBank, MAX_VOICE_BANKS, type VoiceBank } from "./voices";
import { MasterRecorder, type Recording } from "./recorder";
import { playThroughSilentSwitch } from "./ios-audio";

export { drumLayerGain, MAX_VOICE_BANKS, VOICE_LIMITS } from "./voices";

export type AudioStatus = "idle" | "starting" | "playing" | "suspended" | "error";

export interface AudioStatusEvent {
  status: AudioStatus;
  message: string;
}

export interface PlayheadEvent extends SequencerPosition {
  peak: number;
  trackPeaks: Record<TrackKind, number>;
  chainNext: number | null;
}

export interface AudioEngine {
  initialize(): Promise<void>;
  /** `at` (milliseconds since the epoch) starts in step with a coupled app. */
  start(scene: number, at?: number): Promise<void>;
  stop(): void;
  panic(): void;
  queueScene(scene: number): number | null;
  setSceneChain(repeats: number | null): void;
  setTempoOverride(bpm: number | null): void;
  setPerformanceMute(track: TrackKind, muted: boolean): void;
  setBreak(active: boolean): void;
  setPerformanceFilter(value: number): void;
  onPerformance(listener: (state: PerformanceState) => void): () => void;
  startRecording(): Promise<void>;
  stopRecording(): Promise<Recording>;
  readonly recordingSeconds: number;
  syncProject(project: ProjectV2): void;
  onPlayhead(listener: (position: PlayheadEvent) => void): () => void;
  onStatus(listener: (status: AudioStatusEvent) => void): () => void;
  dispose(): void;
}

/** Live-only layer on top of the project: nothing here is saved or undoable. */
export interface PerformanceState {
  /** Tracks silenced right now. */
  muted: TrackKind[];
  /** Tracks whose mute changes at the next bar line. */
  pending: TrackKind[];
  breakActive: boolean;
  /** The break ends (the drop) at the next bar line. */
  dropPending: boolean;
}

export interface EngineOptions {
  /** Renders inside Tone.Offline: no context-state checks, meters or draw callbacks. */
  offline?: boolean;
  /** Offline only: each track's stereo output on its own channel pair instead of the master mix. */
  stems?: boolean;
}

/** What an offline render plays: the start scene, the chain setting and the number of sixteenth steps. */
export interface RenderPlan {
  startScene: number;
  chainRepeats: number | null;
  steps: number;
}

export class ToneAudioEngine implements AudioEngine {
  private project: ProjectV2;
  private initialized = false;
  private graphReady: Promise<void> | null = null;
  private strips: Record<TrackKind, TrackGraph> | null = null;
  private readonly voiceBanks = new Map<string, VoiceBank>();
  private master: MasterGraph | null = null;
  private scheduleId: number | null = null;
  private meterFrame: number | null = null;
  private measuredPeak = 0;
  private measuredTrackPeaks = zeroTrackPeaks();
  private readonly clock = new BarQueuedTransport();
  private tempoOverride: number | null = null;
  private readonly performanceMuted = new Set<TrackKind>();
  private readonly performancePending = new Map<TrackKind, boolean>();
  private breakActive = false;
  private dropPending = false;
  private readonly performanceListeners = new Set<(state: PerformanceState) => void>();
  private readonly recorder = new MasterRecorder(() => undefined);
  private readonly playheadListeners = new Set<(position: PlayheadEvent) => void>();
  private readonly statusListeners = new Set<(status: AudioStatusEvent) => void>();

  constructor(project: ProjectV2, private readonly options: EngineOptions = {}) {
    this.project = structuredClone(project);
  }

  async initialize(): Promise<void> {
    // Already prepared (e.g. recording or MIDI while music plays): report nothing new.
    if (this.initialized && Tone.getContext().state === "running") return;
    this.emitStatus("starting", "Audio wird vorbereitet …");
    // iPhones and iPads: play even with the ring/silent switch on silent (live sound only).
    if (!this.options.offline) playThroughSilentSwitch();
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

  async start(scene: number, at?: number): Promise<void> {
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
      transport.start(at === undefined ? "+0.05" : contextTimeAt(at));
      this.emitStatus("playing", "Wiedergabe läuft");
    } catch (error) {
      this.emitStatus("error", error instanceof Error ? error.message : "Audio konnte nicht gestartet werden");
    }
  }

  stop(): void {
    this.resetPerformance();
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

  setSceneChain(repeats: number | null): void {
    this.clock.setChain(repeats);
  }

  /** An external MIDI clock's tempo replaces the project tempo until `null`; the project keeps its own. */
  setTempoOverride(bpm: number | null): void {
    this.tempoOverride = bpm === null ? null : Math.max(40, Math.min(240, bpm));
    if (this.initialized) Tone.getTransport().bpm.rampTo(this.tempoOverride ?? this.project.tempo, 0.08);
  }

  /** Builds the full signal path in the current (offline) context and schedules `plan` on its transport. */
  async scheduleOffline(plan: RenderPlan): Promise<void> {
    if (!this.options.offline) throw new Error("scheduleOffline braucht eine Offline-Engine");
    await this.createGraph();
    const transport = Tone.getTransport();
    transport.bpm.value = this.project.tempo;
    this.clock.setChain(plan.chainRepeats);
    this.clock.start(plan.startScene);
    this.applyProject();
    let remaining = plan.steps;
    transport.scheduleRepeat((time) => {
      if (remaining <= 0) return;
      remaining -= 1;
      this.tick(time);
    }, "16n", 0);
  }

  syncProject(project: ProjectV2): void {
    this.project = structuredClone(project);
    if (this.initialized) {
      this.prepareSelectedVoiceBanks();
      this.applyProject();
    }
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
    // Stems skip the master: its output goes nowhere and each strip feeds its own channel pair.
    const master = createMasterGraph(this.options.stems ? new Tone.Gain(0) : undefined);
    const strips = {} as Record<TrackKind, TrackGraph>;
    this.master = master;
    for (const track of TRACK_KINDS) strips[track] = createTrackGraph(track, master.input);
    this.strips = strips;
    if (this.options.stems) connectStems(TRACK_KINDS.map((track) => strips[track].channelFader));
    await Promise.all(Object.values(strips).map((strip) => strip.ready));
    if (this.strips !== strips || this.master !== master) throw new Error("Audio-Vorbereitung wurde abgebrochen");
    this.prepareSelectedVoiceBanks();
    this.initialized = true;
    if (!this.options.offline) this.monitorMeters();
    this.applyProject();
  }

  private destroyGraph(): void {
    if (this.meterFrame !== null) cancelAnimationFrame(this.meterFrame);
    this.meterFrame = null;
    for (const bank of this.voiceBanks.values()) bank.dispose();
    this.voiceBanks.clear();
    Object.values(this.strips ?? {}).forEach((strip) => strip.dispose());
    this.master?.dispose();
    this.strips = null;
    this.master = null;
    this.initialized = false;
  }

  private applyProject(): void {
    const transport = Tone.getTransport();
    transport.bpm.rampTo(this.tempoOverride ?? this.project.tempo, 0.08);
    transport.swing = this.project.swing;
    transport.swingSubdivision = "16n";
    this.master?.fader.gain.rampTo(this.project.masterVolume, 0.04);
    const gains = effectiveTrackGains(this.project);
    for (const track of TRACK_KINDS) {
      const strip = this.strips?.[track];
      if (!strip) continue;
      strip.channelFader.gain.rampTo(gains[track], 0.03);
      const macros = this.patternFor(this.clock.runningScene, track)?.macros;
      if (macros) applyTrackMacros(strip, track, this.project.soundPresets[track], macros);
    }
  }

  setPerformanceMute(track: TrackKind, muted: boolean): void {
    if (this.performanceMuted.has(track) === muted) this.performancePending.delete(track);
    else this.performancePending.set(track, muted);
    // Without a running transport there is no bar line to wait for.
    if (this.scheduleId === null) this.applyPendingMutes();
    this.emitPerformance();
  }

  setBreak(active: boolean): void {
    const now = Tone.now();
    if (active) {
      this.breakActive = true;
      this.dropPending = false;
      this.master?.performance.startRise(now, (2 * 240) / (this.tempoOverride ?? this.project.tempo));
    } else if (this.breakActive) {
      this.dropPending = true;
      if (this.scheduleId === null) this.drop(now);
    }
    this.emitPerformance();
  }

  setPerformanceFilter(value: number): void {
    this.master?.performance.setFilter(value);
  }

  onPerformance(listener: (state: PerformanceState) => void): () => void {
    this.performanceListeners.add(listener);
    return () => this.performanceListeners.delete(listener);
  }

  async startRecording(): Promise<void> {
    if (!this.initialized) await this.initialize();
    if (Tone.getContext().state !== "running") throw new Error("Audio ist pausiert");
    await this.recorder.start(Tone.getDestination());
  }

  stopRecording(): Promise<Recording> {
    return this.recorder.stop();
  }

  get recordingSeconds(): number {
    return this.recorder.active ? this.recorder.seconds : 0;
  }

  private tick(time: number): void {
    if (!this.options.offline && Tone.getContext().state !== "running") {
      this.emitStatus("suspended", "Audio wurde vom Browser pausiert – Start erneut anklicken");
      return;
    }
    const position = this.clock.next();
    if (position.switched) this.applyProject();
    if (position.step === 0 && (this.performancePending.size > 0 || this.dropPending)) {
      this.applyPendingMutes();
      if (this.dropPending) this.drop(time);
      Tone.getDraw().schedule(() => this.emitPerformance(), time);
    }
    for (const track of TRACK_KINDS) {
      try {
        this.triggerTrack(track, position, time);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Klang konnte nicht ausgelöst werden";
        this.emitStatus("error", `${track}: ${message}`);
      }
    }
    if (this.options.offline) return;
    Tone.getDraw().schedule(() => {
      const event = { ...position, peak: this.measuredPeak, trackPeaks: { ...this.measuredTrackPeaks }, chainNext: this.clock.chainNext };
      for (const listener of this.playheadListeners) listener(event);
    }, time);
  }

  private triggerTrack(track: TrackKind, position: SequencerPosition, time: number): void {
    const pattern = this.patternFor(position.scene, track);
    // A track with its own loop length runs on against the scene; harmony follows the scene's bar.
    const at = loopPosition(pattern?.loopSteps, sceneSteps(position));
    const step = pattern?.bars[at.bar]?.steps[at.step];
    const chord = this.project.scenes[position.scene]?.chords[position.bar];
    if (!pattern || !step?.enabled || !chord || effectiveTrackGains(this.project)[track] <= 0) return;
    if (this.performanceMuted.has(track) || (this.breakActive && track === "bass")) return;
    if (stepChance(step) < 1 && Math.random() >= stepChance(step)) return;
    // The break takes the kick out; the rest of the kit keeps the pulse.
    const played = this.breakActive && track === "drums" ? { ...step, drumVoices: step.drumVoices.filter((voice) => voice !== "kick") } : step;
    if (played.drumVoices.length === 0 && track === "drums") return;
    const velocity = dynamicsVelocity(step) * densityBodyGain(track, pattern.macros.density);
    const bank = this.bankFor(track);
    const notes = track === "drums" ? []
      : track === "bass" ? [scaleDegreeMidi(this.project.key, this.project.scale, chord.degree, step.degreeOffset, 2)]
        : track === "lead" ? [scaleDegreeMidi(this.project.key, this.project.scale, chord.degree, step.degreeOffset, 4)]
          : chordNotes(this.project.key, this.project.scale, chord, 3).slice(0, 4);
    const hits = allowsRatchet(track) ? stepRatchet(played) : 1;
    if (hits === 1) {
      bank.trigger(notes, played, time, velocity);
      return;
    }
    // A ratchet splits the sixteenth into even, slightly softer repeats with short gates.
    const spacing = 60 / (this.tempoOverride ?? this.project.tempo) / 4 / hits;
    const short: Step = { ...played, length: "short" };
    for (let hit = 0; hit < hits; hit += 1) {
      bank.trigger(notes, short, time + hit * spacing, velocity * (hit === 0 ? 1 : 0.84), spacing * 0.8);
    }
  }

  private bankFor(track: TrackKind): VoiceBank {
    const preset = this.project.soundPresets[track];
    const key = `${track}:${preset}`;
    const existing = this.voiceBanks.get(key);
    if (existing) return existing;
    if (this.voiceBanks.size >= MAX_VOICE_BANKS) throw new Error("Maximale Zahl der Klangbänke erreicht");
    const strip = this.strips?.[track];
    if (!strip) throw new Error("Audio-Signalweg ist nicht initialisiert");
    const bank = createVoiceBank(track, preset, strip.input, { alwaysAwake: this.options.offline ?? false });
    this.voiceBanks.set(key, bank);
    return bank;
  }

  private prepareSelectedVoiceBanks(): void {
    for (const track of TRACK_KINDS) {
      const preset = this.project.soundPresets[track];
      for (const [key, bank] of this.voiceBanks) {
        if (bank.track === track && bank.preset !== preset) {
          bank.release();
          bank.dispose();
          this.voiceBanks.delete(key);
        }
      }
      this.bankFor(track);
    }
  }

  private applyPendingMutes(): void {
    for (const [track, muted] of this.performancePending) {
      if (muted) this.performanceMuted.add(track);
      else this.performanceMuted.delete(track);
    }
    this.performancePending.clear();
  }

  private drop(time: number): void {
    this.breakActive = false;
    this.dropPending = false;
    this.master?.performance.endRise(time);
  }

  private resetPerformance(): void {
    this.performanceMuted.clear();
    this.performancePending.clear();
    if (this.breakActive || this.dropPending) this.drop(Tone.now());
    this.master?.performance.setFilter(0);
    this.emitPerformance();
  }

  private emitPerformance(): void {
    const state: PerformanceState = {
      muted: [...this.performanceMuted],
      pending: [...this.performancePending.keys()],
      breakActive: this.breakActive,
      dropPending: this.dropPending,
    };
    for (const listener of this.performanceListeners) listener(state);
  }

  private patternFor(scene: number, track: TrackKind) {
    return this.project.scenes[scene]?.tracks.find((pattern) => pattern.instrument === track);
  }

  private releaseAll(): void {
    for (const bank of this.voiceBanks.values()) bank.release();
  }

  private monitorMeters(): void {
    if (!this.initialized) return;
    const peakDb = this.master?.meter.getValue();
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

export function densityBodyGain(track: TrackKind, density: number): number {
  const depth: Record<TrackKind, number> = { drums: 0.14, bass: 0.18, chords: 0.1, lead: 0.12, pad: 0.08 };
  return 0.82 + clamp01(density) * depth[track];
}

function dynamicsVelocity(step: Step): number {
  if (step.dynamics === "ghost") return 0.42;
  if (step.dynamics === "accent") return 1;
  return 0.72;
}

function zeroTrackPeaks(): Record<TrackKind, number> {
  return Object.fromEntries(TRACK_KINDS.map((track) => [track, 0])) as Record<TrackKind, number>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Maps a wall-clock time (milliseconds since the epoch) onto this context's
 * clock via its output timestamp, so two tabs on the same audio device sound
 * at the same moment. Times already past start as soon as possible.
 */
export function contextTimeAt(epochMs: number): number {
  const raw = Tone.getContext().rawContext as unknown as AudioContext;
  const stamp = typeof raw.getOutputTimestamp === "function" ? raw.getOutputTimestamp() : null;
  const target = stamp?.contextTime !== undefined && stamp.performanceTime
    ? stamp.contextTime + (epochMs - (performance.timeOrigin + stamp.performanceTime)) / 1000
    : raw.currentTime + (epochMs - (performance.timeOrigin + performance.now())) / 1000;
  return Math.max(raw.currentTime + 0.03, target);
}

/** Routes each stereo output to its own channel pair of the (offline) destination. */
function connectStems(outputs: readonly Tone.ToneAudioNode[]): void {
  const raw = Tone.getContext().rawContext;
  const merger = raw.createChannelMerger(outputs.length * 2);
  outputs.forEach((output, index) => {
    const splitter = raw.createChannelSplitter(2);
    Tone.connect(output, splitter as unknown as AudioNode);
    splitter.connect(merger, 0, index * 2);
    splitter.connect(merger, 1, index * 2 + 1);
  });
  merger.connect(raw.destination);
}
