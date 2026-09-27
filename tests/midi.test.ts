import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MidiLink } from "../src/midi";

const clock = new Uint8Array([0xf8]);

describe("MIDI", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("folgt dem Tempo einer MIDI-Clock und merkt, wenn sie verstummt", () => {
    vi.useFakeTimers();
    const tempos: (number | null)[] = [];
    const link = new MidiLink("test.midi", { clockTempo: (bpm) => tempos.push(bpm) });
    const interval = 60_000 / 128 / 24;
    for (let tick = 0; tick <= 48; tick += 1) link.handleMessage(clock, tick * interval);
    expect(tempos).toEqual([128]);
    for (let tick = 49; tick <= 96; tick += 1) link.handleMessage(clock, tick * interval + (tick % 2 ? 0.3 : -0.3));
    expect(tempos).toEqual([128]);
    vi.advanceTimersByTime(700);
    expect(tempos).toEqual([128, null]);
    expect(link.clockBpm).toBeNull();
  });

  it("startet und stoppt nur, wenn die Clock geführt werden darf", () => {
    const calls: string[] = [];
    const link = new MidiLink("test.midi", { start: () => calls.push("start"), stop: () => calls.push("stop") });
    link.handleMessage(new Uint8Array([0xfa]), 0);
    link.handleMessage(new Uint8Array([0xfc]), 1);
    link.setFollowClock(false);
    link.handleMessage(new Uint8Array([0xfb]), 2);
    expect(calls).toEqual(["start", "stop"]);
  });

  it("steuert Makros über CC 70–74 und lernt eigene Regler", () => {
    const controls: [number, number][] = [];
    const learned: [number, number][] = [];
    const link = new MidiLink("test.midi", { control: (index, value) => controls.push([index, value]), learned: (index, cc) => learned.push([index, cc]) });
    link.resetMapping();
    link.handleMessage(new Uint8Array([0xb0, 71, 127]), 0);
    link.handleMessage(new Uint8Array([0xb5, 74, 0]), 0);
    link.handleMessage(new Uint8Array([0xb0, 1, 64]), 0);
    expect(controls).toEqual([[1, 1], [4, 0]]);

    link.learn(0);
    link.handleMessage(new Uint8Array([0xb3, 21, 5]), 0);
    expect(learned).toEqual([[0, 21]]);
    expect(link.mapping[0]).toBe(21);
    link.handleMessage(new Uint8Array([0xb0, 21, 127]), 0);
    expect(controls.at(-1)).toEqual([0, 1]);

    link.learn(1);
    link.handleMessage(new Uint8Array([0xb0, 21, 64]), 0);
    expect(link.mapping.slice(0, 2)).toEqual([-1, 21]);
    expect(new MidiLink("test.midi").mapping.slice(0, 2)).toEqual([-1, 21]);
  });
});
