/*
 * Gleichtakt: Groovebox and Kitty open in two tabs of the same browser start,
 * stop and change tempo together. The tabs talk over a BroadcastChannel (same
 * origin, nothing leaves the browser) and agree on a wall-clock start time,
 * which each app maps onto its own audio clock.
 */

const CHANNEL = "musik-werkstatt-gleichtakt";
const HEARTBEAT_MS = 4_000;
const PEER_TIMEOUT_MS = 10_000;
/** Lead time for a joint start, so the other tab can schedule it. */
export const LINK_START_DELAY_MS = 180;

export interface LinkPeer {
  id: string;
  app: string;
}

type Message =
  | { kind: "hello" | "here" | "bye"; from: LinkPeer }
  | { kind: "start"; from: LinkPeer; bpm: number; at: number }
  | { kind: "stop"; from: LinkPeer }
  | { kind: "tempo"; from: LinkPeer; bpm: number };

export interface LinkEvents {
  /** A partner started: play from `at` (milliseconds since the epoch) at the partner's `bpm`. */
  start(at: number, bpm: number, from: LinkPeer): void;
  stop(from: LinkPeer): void;
  tempo(bpm: number, from: LinkPeer): void;
  peers(peers: LinkPeer[]): void;
}

/** Milliseconds since the epoch on the high-resolution clock all tabs share. */
export function wallClock(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * The partner's tempo as close to this app's range as whole-bar doubling or
 * halving gets it: 150 BPM from Kitty becomes 75 in the Groovebox, 96 from the
 * Groovebox becomes 192 in Kitty. Bar lines stay aligned either way.
 */
export function fitTempo(bpm: number, min: number, max: number): number {
  const distance = (value: number) => (value < min ? min - value : value > max ? value - max : 0);
  return [bpm, bpm * 2, bpm / 2].reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
}

export class AppLink {
  private channel: BroadcastChannel | null = null;
  private readonly self: LinkPeer;
  private readonly known = new Map<string, { peer: LinkPeer; seen: number }>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(app: string, private readonly events: LinkEvents) {
    this.self = { id: `${app}-${Math.random().toString(36).slice(2, 10)}`, app };
  }

  static supported(): boolean {
    return typeof BroadcastChannel === "function";
  }

  get enabled(): boolean {
    return this.channel !== null;
  }

  get peers(): LinkPeer[] {
    return [...this.known.values()].map((entry) => entry.peer);
  }

  enable(): void {
    if (this.channel || !AppLink.supported()) return;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (event: MessageEvent<Message>) => this.receive(event.data);
    this.post({ kind: "hello", from: this.self });
    this.heartbeat = setInterval(() => {
      this.post({ kind: "here", from: this.self });
      this.expire();
    }, HEARTBEAT_MS);
  }

  disable(): void {
    if (!this.channel) return;
    this.post({ kind: "bye", from: this.self });
    this.channel.close();
    this.channel = null;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.known.clear();
    this.events.peers([]);
  }

  /** Announces a joint start and returns the wall-clock time everyone starts at. */
  announceStart(bpm: number): number {
    const at = wallClock() + LINK_START_DELAY_MS;
    this.post({ kind: "start", from: this.self, bpm, at });
    return at;
  }

  announceStop(): void {
    this.post({ kind: "stop", from: this.self });
  }

  announceTempo(bpm: number): void {
    this.post({ kind: "tempo", from: this.self, bpm });
  }

  private receive(message: Message): void {
    if (!message || message.from?.id === this.self.id) return;
    if (message.kind === "bye") {
      if (this.known.delete(message.from.id)) this.events.peers(this.peers);
      return;
    }
    const isNew = !this.known.has(message.from.id);
    this.known.set(message.from.id, { peer: message.from, seen: Date.now() });
    if (isNew) this.events.peers(this.peers);
    if (message.kind === "hello") this.post({ kind: "here", from: this.self });
    else if (message.kind === "start") this.events.start(message.at, message.bpm, message.from);
    else if (message.kind === "stop") this.events.stop(message.from);
    else if (message.kind === "tempo") this.events.tempo(message.bpm, message.from);
  }

  private expire(): void {
    const before = this.known.size;
    for (const [id, entry] of this.known) if (Date.now() - entry.seen > PEER_TIMEOUT_MS) this.known.delete(id);
    if (this.known.size !== before) this.events.peers(this.peers);
  }

  private post(message: Message): void {
    this.channel?.postMessage(message);
  }
}
