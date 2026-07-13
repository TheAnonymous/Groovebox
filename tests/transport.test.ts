import { describe, expect, it } from "vitest";
import { BarQueuedTransport } from "../src/audio/transport";

describe("taktgenauer Transport", () => {
  it("liefert alle 16 Steps eines Takts in stabiler Reihenfolge", () => {
    const clock = new BarQueuedTransport();
    clock.start(0);
    expect(Array.from({ length: 16 }, () => clock.next().step)).toEqual(Array.from({ length: 16 }, (_, index) => index));
    expect(clock.next()).toMatchObject({ bar: 1, step: 0 });
  });

  it("wechselt eine vorgemerkte Szene erst an der nächsten Taktgrenze", () => {
    const clock = new BarQueuedTransport();
    clock.start(0);
    for (let index = 0; index < 5; index += 1) clock.next();
    clock.queue(2);
    for (let index = 5; index < 16; index += 1) expect(clock.next().scene).toBe(0);
    expect(clock.next()).toEqual({ scene: 2, bar: 0, step: 0, switched: true });
  });

  it("wendet bei mehreren Vormerkungen nur die letzte an", () => {
    const clock = new BarQueuedTransport();
    clock.start(1);
    clock.next();
    clock.queue(2);
    clock.queue(3);
    for (let index = 1; index < 16; index += 1) clock.next();
    expect(clock.next().scene).toBe(3);
    expect(clock.queuedScene).toBeNull();
  });
});
