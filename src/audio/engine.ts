import { Cues, MasterRecorder, playThroughSilentSwitch, Transport, type Recording } from "klangwerk";
import { atStep, connect, currentSound, Gain, now, setBpm, soundContext, SoundNode, swapSound, useContext, type Sound } from "klangwerk/tone";
import { chordNotes, scaleDegreeMidi } from "../domain/music";
import { allowsRatchet, loopPosition, sceneSteps, stepChance, stepRatchet } from "../domain/patterns";
import type { ProjectV2, Step, TrackKind } from "../domain/types";
import { TRACK_KINDS } from "../domain/types";
import { effectiveTrackGains } from "../store/store";
import { applyTrackMacros, createMasterGraph, createTrackGraph, type MasterGraph, type TrackGraph } from "./graph";
import { BarQueuedTransport, type SequencerPosition } from "./transport";
import { createVoiceBank, MAX_VOICE_BANKS, type VoiceBank } from "./voices";

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
  /** Renders in the current offline context: no context-state checks, meters or draw callbacks. */
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
  /** Steps an offline render still plays (`null` live). */
  private offlineSteps: number | null = null;
  /** The context this engine plays in (made current while it builds or schedules, as Tone's global one was). */
  private sound: Sound | null = null;
  private ownContext: AudioContext | null = null;
  private cues: Cues | null = null;
  private readonly transport = new Transport({
    step: (_step, time) => this.withSound(() => atStep(this.transport.nextTime, () => this.tick(time))),
    stepDuration: () => 60 / (this.tempoOverride ?? this.project.tempo) / 4,
    // Tone's swing on sixteenths: the odd ones lean back by swing · 2/3 of a sixteenth.
    swing: () => (this.project.swing * 2) / 3,
    lookahead: 0.1,
  });
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
    if (this.initialized && this.sound?.context.state === "running") return;
    this.emitStatus("starting", "Audio wird vorbereitet …");
    // iPhones and iPads: play even with the ring/silent switch on silent (live sound only).
    if (!this.options.offline) playThroughSilentSwitch();
    this.attachContext();
    if (this.ownContext && this.ownContext.state !== "running") await this.ownContext.resume().catch(() => undefined);
    if (!this.initialized) {
      this.graphReady ??= this.withSound(() => this.createGraph()).finally(() => { this.graphReady = null; });
      await this.graphReady;
    }
    if (this.context.state !== "running" && !(this.context instanceof OfflineAudioContext)) {
      this.emitStatus("suspended", "Audio ist pausiert – Start erneut anklicken");
      return;
    }
    this.emitStatus("idle", "Audio bereit");
  }

  async start(scene: number, at?: number): Promise<void> {
    try {
      await this.initialize();
      if (this.context.state !== "running") return;
      this.transport.halt();
      this.clock.start(scene);
      this.withSound(() => {
        this.applyProject();
        // The first steps come with the clock's next beat, as with Tone's transport.
        this.transport.begin(this.context, at === undefined ? now() + 0.05 : contextTimeAt(at));
      });
      this.emitStatus("playing", "Wiedergabe läuft");
    } catch (error) {
      this.emitStatus("error", error instanceof Error ? error.message : "Audio konnte nicht gestartet werden");
    }
  }

  stop(): void {
    this.resetPerformance();
    this.transport.halt();
    this.cues?.cancel();
    this.clock.reset();
    if (this.sound) this.withSound(() => this.releaseAll());
    this.resetMeters();
    this.emitStatus("idle", "Gestoppt");
  }

  panic(): void {
    this.transport.halt();
    this.cues?.cancel();
    this.clock.reset();
    if (this.sound) this.withSound(() => this.destroyGraph());
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
    if (this.initialized) this.withSound(() => setBpm(this.tempoOverride ?? this.project.tempo));
  }

  /** Builds the full signal path in the current (offline) context and schedules `plan` on its transport. */
  async scheduleOffline(plan: RenderPlan): Promise<void> {
    if (!this.options.offline) throw new Error("scheduleOffline braucht eine Offline-Engine");
    this.attachContext();
    // The graph is built at the context's starting tempo (120 BPM), as before with Tone's transport.
    await this.withSound(() => this.createGraph());
    this.withSound(() => {
      setBpm(this.project.tempo);
      this.clock.setChain(plan.chainRepeats);
      this.clock.start(plan.startScene);
      this.applyProject();
    });
    this.offlineSteps = plan.steps;
    this.transport.begin(this.context, 0);
  }

  /** Schedules an offline render up to `seconds` (see `scheduleOffline`). */
  renderUntil(seconds: number): void {
    this.transport.renderUntil(seconds);
  }

  syncProject(project: ProjectV2): void {
    this.project = structuredClone(project);
    if (this.initialized) {
      this.withSound(() => {
        this.prepareSelectedVoiceBanks();
        this.applyProject();
      });
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
    this.transport.halt();
    this.cues?.cancel();
    this.clock.reset();
    if (this.sound) this.withSound(() => this.destroyGraph());
    this.transport.dispose();
    this.playheadListeners.clear();
    this.statusListeners.clear();
  }

  private async createGraph(): Promise<void> {
    // Stems skip the master: its output goes nowhere and each strip feeds its own channel pair.
    const master = createMasterGraph(this.options.stems ? new Gain(0) : undefined);
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
    // The transport reads tempo and swing for every step; note values follow the tempo from here.
    setBpm(this.tempoOverride ?? this.project.tempo);
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
    if (!this.transport.running) this.applyPendingMutes();
    this.emitPerformance();
  }

  setBreak(active: boolean): void {
    if (!this.sound) return this.setBreakAt(active, 0);
    this.withSound(() => this.setBreakAt(active, now()));
  }

  private setBreakAt(active: boolean, now: number): void {
    if (active) {
      this.breakActive = true;
      this.dropPending = false;
      this.master?.performance.startRise(now, (2 * 240) / (this.tempoOverride ?? this.project.tempo));
    } else if (this.breakActive) {
      this.dropPending = true;
      if (!this.transport.running) this.drop(now);
    }
    this.emitPerformance();
  }

  setPerformanceFilter(value: number): void {
    if (this.sound) this.withSound(() => this.master?.performance.setFilter(value));
  }

  onPerformance(listener: (state: PerformanceState) => void): () => void {
    this.performanceListeners.add(listener);
    return () => this.performanceListeners.delete(listener);
  }

  async startRecording(): Promise<void> {
    if (!this.initialized) await this.initialize();
    const fader = this.master?.fader;
    if (this.context.state !== "running" || !(this.context instanceof AudioContext) || !fader) throw new Error("Audio ist pausiert");
    await this.recorder.start(this.context, fader.output);
  }

  stopRecording(): Promise<Recording> {
    return this.recorder.stop();
  }

  get recordingSeconds(): number {
    return this.recorder.active ? this.recorder.seconds : 0;
  }

  private tick(time: number): void {
    if (this.offlineSteps !== null) {
      if (this.offlineSteps <= 0) return;
      this.offlineSteps -= 1;
    }
    if (!this.options.offline && this.context.state !== "running") {
      this.emitStatus("suspended", "Audio wurde vom Browser pausiert – Start erneut anklicken");
      return;
    }
    const position = this.clock.next();
    if (position.switched) this.applyProject();
    if (position.step === 0 && (this.performancePending.size > 0 || this.dropPending)) {
      this.applyPendingMutes();
      if (this.dropPending) this.drop(time);
      this.cues?.at(time, () => this.emitPerformance());
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
    this.cues?.at(time, () => {
      const event = { ...position, peak: this.measuredPeak, trackPeaks: { ...this.measuredTrackPeaks }, chainNext: this.clock.chainNext };
      for (const listener of this.playheadListeners) listener(event);
    });
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
    if (this.sound) {
      this.withSound(() => {
        if (this.breakActive || this.dropPending) this.drop(now());
        this.master?.performance.setFilter(0);
      });
    }
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

  /**
   * The context this engine plays in: offline engines take the current one
   * (made current by the render or lab); live ones make an AudioContext on the
   * first tap and keep it current, as Tone's global context was.
   */
  private attachContext(): void {
    if (this.sound) return;
    if (!this.options.offline) {
      const context = new AudioContext({ latencyHint: "interactive" });
      this.ownContext = context;
      useContext(context);
      this.cues = new Cues(() => context.currentTime);
    }
    this.sound = currentSound();
  }

  private get context(): BaseAudioContext {
    if (!this.sound) throw new Error("initialize() first");
    return this.sound.context;
  }

  /** Runs `action` with this engine's context current. */
  private withSound<T>(action: () => T): T {
    const previous = swapSound(this.sound);
    try {
      return action();
    } finally {
      swapSound(previous);
    }
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
  const raw = soundContext() as AudioContext;
  const stamp = typeof raw.getOutputTimestamp === "function" ? raw.getOutputTimestamp() : null;
  const target = stamp?.contextTime !== undefined && stamp.performanceTime
    ? stamp.contextTime + (epochMs - (performance.timeOrigin + stamp.performanceTime)) / 1000
    : raw.currentTime + (epochMs - (performance.timeOrigin + performance.now())) / 1000;
  return Math.max(raw.currentTime + 0.03, target);
}

/** Routes each stereo output to its own channel pair of the (offline) destination. */
function connectStems(outputs: readonly SoundNode[]): void {
  const raw = soundContext();
  const merger = raw.createChannelMerger(outputs.length * 2);
  outputs.forEach((output, index) => {
    const splitter = raw.createChannelSplitter(2);
    connect(output, splitter);
    splitter.connect(merger, 0, index * 2);
    splitter.connect(merger, 1, index * 2 + 1);
  });
  merger.connect(raw.destination);
}
