import { describe, expect, it } from "vitest";
import { planSeconds, renderPlan } from "../src/audio/render";
import { audibleRange, encodePcm16Wav, encodeWav, trimmedLength, type PcmSource } from "../src/audio/wav";
import { createFactoryProject } from "../src/domain/defaults";
import { sanitizeProject } from "../src/domain/sanitize";
import { decodeShareFragment, encodeShareFragment } from "../src/transfer";

function source(channels: Float32Array[], sampleRate = 1_000): PcmSource {
  return { numberOfChannels: channels.length, sampleRate, length: channels[0]!.length, getChannelData: (index) => channels[index]! };
}

describe("Export-Plan", () => {
  it("plant den ganzen Bogen mit allen Szenen und der gewählten Länge je Szene", () => {
    const project = createFactoryProject();
    project.sceneRepeats = 2;
    const plan = renderPlan(project, { kind: "arc" });
    expect(plan).toEqual({ startScene: 0, chainRepeats: 2, steps: 4 * 2 * 64 });
    expect(planSeconds(project, plan)).toBeCloseTo(80, 5);
  });

  it("plant eine einzelne Szene als Loop ohne Szenenfolge", () => {
    const project = createFactoryProject();
    project.sceneRepeats = 4;
    project.tempo = 120;
    const plan = renderPlan(project, { kind: "scene", scene: 2 });
    expect(plan).toEqual({ startScene: 2, chainRepeats: null, steps: 256 });
    expect(planSeconds(project, plan)).toBeCloseTo(32, 5);
  });

  it("saniert unbekannte Szenenlängen auf den Werkwert", () => {
    const project = createFactoryProject() as unknown as Record<string, unknown>;
    project.sceneRepeats = 3;
    expect(sanitizeProject(project).sceneRepeats).toBe(2);
  });
});

describe("WAV", () => {
  it("schreibt einen gültigen 16-Bit-Stereo-Header und blendet das Ende aus", () => {
    const left = new Float32Array(100).fill(0.5);
    const right = new Float32Array(100).fill(-1);
    const wav = new DataView(encodeWav(source([left, right])));
    const text = (offset: number) => String.fromCharCode(...Array.from({ length: 4 }, (_, index) => wav.getUint8(offset + index)));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(wav.getUint16(22, true)).toBe(2);
    expect(wav.getUint32(24, true)).toBe(1_000);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(100 * 2 * 2);
    expect(wav.getInt16(44, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(wav.getInt16(46, true)).toBe(-0x8000);
    expect(wav.getInt16(44 + 99 * 4, true)).toBeLessThan(Math.round(0.5 * 0x7fff / 10));
  });

  it("schneidet Stille am Ende ab, aber nie in die Musik", () => {
    const channel = new Float32Array(10_000);
    channel[2_000] = 0.3;
    expect(trimmedLength(source([channel]))).toBe(2_000 + 250);
    expect(trimmedLength(source([channel]), 6_000)).toBe(6_000);
  });
});

describe("Teilen-Link", () => {
  it("packt ein Set verlustfrei in ein kompaktes Fragment", async () => {
    const project = createFactoryProject();
    project.tempo = 101;
    const fragment = await encodeShareFragment("Für Mo", project);
    expect(fragment.startsWith("p=1.")).toBe(true);
    expect(fragment.length).toBeLessThan(8_000);
    expect(/^p=1\.[A-Za-z0-9_-]+$/.test(fragment)).toBe(true);
    const shared = await decodeShareFragment(`#${fragment}`);
    expect(shared?.name).toBe("Für Mo");
    expect(shared?.project).toEqual(project);
  });

  it("ignoriert fremde Fragmente und meldet beschädigte Links", async () => {
    expect(await decodeShareFragment("#oben")).toBeNull();
    await expect(decodeShareFragment("#p=1.abc")).rejects.toThrow("beschädigt");
    await expect(decodeShareFragment("#p=2.abc")).rejects.toThrow("neueren");
    await expect(decodeShareFragment("#p=1.$$$")).rejects.toThrow("unvollständig");
  });
});

describe("Live-Aufnahme", () => {
  it("schneidet Stille vorn und hinten ab und schreibt 16-Bit-Stereo", () => {
    const left = new Int16Array(10_000);
    const right = new Int16Array(10_000);
    left[3_000] = 8_000;
    right[6_000] = -8_000;
    const pcm = { sampleRate: 1_000, left, right };
    expect(audibleRange(pcm)).toEqual({ start: 2_950, end: 6_501 });
    expect(audibleRange({ sampleRate: 1_000, left: new Int16Array(10), right: new Int16Array(10) })).toBeNull();
    const wav = new DataView(encodePcm16Wav(pcm, 2_950, 6_501));
    expect(wav.getUint16(22, true)).toBe(2);
    expect(wav.getUint32(40, true)).toBe((6_501 - 2_950) * 4);
    expect(wav.getInt16(44 + 50 * 4, true)).toBe(8_000);
    expect(wav.getInt16(44 + 3_050 * 4 + 2, true)).toBe(-8_000);
  });
});
