/*
 * Web MIDI input: follows an external MIDI clock (tempo, start, stop) and maps
 * control changes to the five macros of the selected track. Framework-free;
 * the app decides what tempo, start, stop and a macro value mean.
 */

/** Sound controllers 1–5 (CC 70–74): the controller numbers meant for sound parameters. */
export const DEFAULT_MACRO_CCS = [70, 71, 72, 73, 74] as const;

const CLOCKS_PER_BEAT = 24;
const TEMPO_WINDOW_TICKS = 48;
const CLOCK_TIMEOUT_MS = 600;

export type MidiState = "unsupported" | "off" | "connecting" | "ready" | "denied" | "error";

export interface MidiStatus {
  state: MidiState;
  inputs: string[];
}

export interface MidiEvents {
  status?(status: MidiStatus): void;
  /** Tempo of the incoming clock in BPM, or `null` when the clock stopped. */
  clockTempo?(bpm: number | null): void;
  start?(): void;
  stop?(): void;
  /** A mapped control moved: macro index and value 0–1. */
  control?(index: number, value: number): void;
  learned?(index: number, controller: number): void;
}

interface StoredSettings {
  enabled: boolean;
  followClock: boolean;
  mapping: number[];
}

export class MidiLink {
  private access: MIDIAccess | null = null;
  private state: MidiState;
  private settings: StoredSettings;
  private learning: number | null = null;
  private ticks: number[] = [];
  private tempo: number | null = null;
  private clockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly storageKey: string, private readonly events: MidiEvents = {}) {
    this.state = MidiLink.supported() ? "off" : "unsupported";
    this.settings = readSettings(storageKey);
  }

  static supported(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  }

  get status(): MidiStatus {
    return { state: this.state, inputs: this.inputNames() };
  }

  get mapping(): readonly number[] {
    return this.settings.mapping;
  }

  get followClock(): boolean {
    return this.settings.followClock;
  }

  get learningIndex(): number | null {
    return this.learning;
  }

  get clockBpm(): number | null {
    return this.tempo;
  }

  /** Reconnects without a prompt when MIDI was on before and the browser still grants it. */
  async restore(): Promise<void> {
    if (!this.settings.enabled || this.state !== "off") return;
    try {
      const permission = await navigator.permissions?.query({ name: "midi" as PermissionName });
      if (permission?.state === "granted") await this.connect();
    } catch {
      // Permission queries for MIDI are not available everywhere; wait for a click.
    }
  }

  async connect(): Promise<void> {
    if (this.state === "unsupported" || this.state === "ready" || this.state === "connecting") return;
    this.setState("connecting");
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (error) {
      this.setState(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "error");
      return;
    }
    this.access.onstatechange = () => {
      this.attachInputs();
      this.emitStatus();
    };
    this.attachInputs();
    this.save({ enabled: true });
    this.setState("ready");
  }

  disconnect(): void {
    if (this.access) {
      this.access.onstatechange = null;
      for (const input of this.access.inputs.values()) input.onmidimessage = null;
    }
    this.access = null;
    this.learning = null;
    this.stopClock();
    this.save({ enabled: false });
    this.setState(MidiLink.supported() ? "off" : "unsupported");
  }

  setFollowClock(follow: boolean): void {
    this.save({ followClock: follow });
    if (!follow) this.stopClock();
  }

  /** The next control change is assigned to macro `index`; `null` cancels. */
  learn(index: number | null): void {
    this.learning = index;
  }

  resetMapping(): void {
    this.save({ mapping: [...DEFAULT_MACRO_CCS] });
  }

  handleMessage(data: Uint8Array, timeStamp: number): void {
    const status = data[0];
    if (status === undefined) return;
    if (status === 0xf8) return this.clockTick(timeStamp);
    if (status === 0xfa || status === 0xfb) {
      if (this.settings.followClock) this.events.start?.();
      return;
    }
    if (status === 0xfc) {
      if (this.settings.followClock) this.events.stop?.();
      return;
    }
    if ((status & 0xf0) !== 0xb0 || data.length < 3) return;
    const controller = data[1]!;
    const value = data[2]!;
    if (this.learning !== null) {
      const index = this.learning;
      const mapping = this.settings.mapping.map((current) => (current === controller ? -1 : current));
      mapping[index] = controller;
      this.learning = null;
      this.save({ mapping });
      this.events.learned?.(index, controller);
      return;
    }
    const index = this.settings.mapping.indexOf(controller);
    if (index >= 0) this.events.control?.(index, value / 127);
  }

  private clockTick(timeStamp: number): void {
    if (!this.settings.followClock) return;
    this.ticks.push(timeStamp);
    if (this.ticks.length > TEMPO_WINDOW_TICKS + 1) this.ticks.shift();
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    this.clockTimer = setTimeout(() => this.stopClock(), CLOCK_TIMEOUT_MS);
    if (this.ticks.length < CLOCKS_PER_BEAT + 1) return;
    const interval = (this.ticks.at(-1)! - this.ticks[0]!) / (this.ticks.length - 1);
    if (interval <= 0) return;
    const bpm = Math.round((60_000 / (interval * CLOCKS_PER_BEAT)) * 10) / 10;
    if (this.tempo !== null && Math.abs(bpm - this.tempo) < 0.5) return;
    this.tempo = Math.round(bpm);
    this.events.clockTempo?.(this.tempo);
  }

  private stopClock(): void {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    this.ticks = [];
    if (this.tempo === null) return;
    this.tempo = null;
    this.events.clockTempo?.(null);
  }

  private attachInputs(): void {
    for (const input of this.access?.inputs.values() ?? []) {
      input.onmidimessage = (event) => {
        if (event.data) this.handleMessage(event.data, event.timeStamp);
      };
    }
  }

  private inputNames(): string[] {
    return [...(this.access?.inputs.values() ?? [])].filter((input) => input.state === "connected").map((input) => input.name ?? "MIDI-Eingang");
  }

  private setState(state: MidiState): void {
    this.state = state;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.events.status?.(this.status);
  }

  private save(change: Partial<StoredSettings>): void {
    this.settings = { ...this.settings, ...change };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
    } catch {
      // Settings stay for this visit only.
    }
  }
}

function readSettings(key: string): StoredSettings {
  const fallback: StoredSettings = { enabled: false, followClock: true, mapping: [...DEFAULT_MACRO_CCS] };
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<StoredSettings> | null;
    if (!value || typeof value !== "object") return fallback;
    const mapping = Array.isArray(value.mapping) && value.mapping.length === DEFAULT_MACRO_CCS.length
      && value.mapping.every((entry) => Number.isInteger(entry) && entry >= -1 && entry <= 127)
      ? value.mapping as number[]
      : fallback.mapping;
    return {
      enabled: value.enabled === true,
      followClock: value.followClock !== false,
      mapping,
    };
  } catch {
    return fallback;
  }
}
