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
    expect(clock.next()).toEqual({ scene: 2, bar: 0, step: 0, switched: true, pass: 0 });
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

  it("spielt als Szenenfolge jede Szene mit der gewählten Zahl an Durchläufen und beginnt danach von vorn", () => {
    const clock = new BarQueuedTransport();
    clock.setChain(2);
    clock.start(0);
    const scenes: number[] = [];
    for (let index = 0; index < 64 * 2 * 4 + 1; index += 1) {
      const position = clock.next();
      if (position.step === 0 && position.bar === 0) scenes.push(position.scene);
    }
    expect(scenes).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0]);
    expect(clock.chainNext).toBe(1);
  });

  it("zählt Durchläufe und lässt eine manuelle Wahl in der Folge Vorrang haben", () => {
    const clock = new BarQueuedTransport();
    clock.setChain(4);
    clock.start(1);
    for (let index = 0; index < 64; index += 1) clock.next();
    expect(clock.next()).toMatchObject({ scene: 1, pass: 1, bar: 0, step: 0 });
    clock.queue(3);
    for (let index = 1; index < 16; index += 1) clock.next();
    expect(clock.next()).toMatchObject({ scene: 3, pass: 0, switched: true });
    expect(clock.chainNext).toBe(0);
  });

  it("läuft ohne Szenenfolge in derselben Szene weiter", () => {
    const clock = new BarQueuedTransport();
    clock.start(2);
    for (let index = 0; index < 64 * 3; index += 1) expect(clock.next().scene).toBe(2);
    expect(clock.chainNext).toBeNull();
  });
});
