import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLink, fitTempo, LINK_START_DELAY_MS, wallClock, type LinkEvents } from "../src/link";
import { crc32, zipStored } from "../src/zip";

const links: AppLink[] = [];

function events(): LinkEvents & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: (at, bpm, from) => calls.push(`start ${bpm} ${from.app} ${Math.round(at - wallClock())}`),
    stop: (from) => calls.push(`stop ${from.app}`),
    tempo: (bpm) => calls.push(`tempo ${bpm}`),
    peers: (peers) => calls.push(`peers ${peers.map((peer) => peer.app).join(",")}`),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("Gleichtakt", () => {
  afterEach(() => {
    links.splice(0).forEach((link) => link.disable());
    vi.useRealTimers();
  });

  it("bringt fremde Tempi mit Verdoppeln oder Halbieren in den eigenen Bereich", () => {
    expect(fitTempo(150, 80, 120)).toBe(75);
    expect(fitTempo(96, 120, 180)).toBe(192);
    expect(fitTempo(160, 80, 120)).toBe(80);
    expect(fitTempo(128, 80, 120)).toBe(128);
    expect(fitTempo(100, 80, 120)).toBe(100);
  });

  it("findet die andere App und startet, stoppt und folgt dem Tempo gemeinsam", async () => {
    const grooveboxEvents = events();
    const kittyEvents = events();
    const groovebox = new AppLink("groovebox", grooveboxEvents);
    const kitty = new AppLink("kitty", kittyEvents);
    links.push(groovebox, kitty);
    groovebox.enable();
    kitty.enable();
    await settle();
    expect(groovebox.peers.map((peer) => peer.app)).toEqual(["kitty"]);
    expect(kitty.peers.map((peer) => peer.app)).toEqual(["groovebox"]);

    const at = kitty.announceStart(150);
    expect(at - wallClock()).toBeGreaterThan(LINK_START_DELAY_MS - 20);
    kitty.announceTempo(152);
    kitty.announceStop();
    await settle();
    expect(grooveboxEvents.calls.filter((call) => !call.startsWith("peers"))).toEqual([
      expect.stringMatching(/^start 150 kitty 1\d\d$/),
      "tempo 152",
      "stop kitty",
    ]);
    expect(kittyEvents.calls.filter((call) => !call.startsWith("peers"))).toEqual([]);

    kitty.disable();
    await settle();
    expect(groovebox.peers).toEqual([]);
  });
});

describe("ZIP", () => {
  it("packt Dateien unkomprimiert mit gültigen Prüfsummen", async () => {
    const hello = new TextEncoder().encode("hello");
    expect(crc32(hello)).toBe(0x3610a686);
    const zip = new DataView(await zipStored([{ name: "01-drums.wav", data: hello }, { name: "02-bass.wav", data: new Uint8Array(3) }]).arrayBuffer());
    expect(zip.getUint32(0, true)).toBe(0x04034b50);
    expect(zip.getUint32(14, true)).toBe(0x3610a686);
    expect(zip.getUint32(18, true)).toBe(5);
    const end = zip.byteLength - 22;
    expect(zip.getUint32(end, true)).toBe(0x06054b50);
    expect(zip.getUint16(end + 10, true)).toBe(2);
    const centralOffset = zip.getUint32(end + 16, true);
    expect(zip.getUint32(centralOffset, true)).toBe(0x02014b50);
  });
});
