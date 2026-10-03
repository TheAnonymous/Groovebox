import { encodeWav, trimmedLength, type PcmSource } from "klangwerk";
import { zipStored } from "../zip";

/** The stereo stem of track `index` in a stems render (one channel pair per track). */
export function stemSource(buffer: PcmSource, index: number): PcmSource {
  return {
    numberOfChannels: 2,
    sampleRate: buffer.sampleRate,
    length: buffer.length,
    getChannelData: (channel) => buffer.getChannelData(index * 2 + Math.min(1, channel)),
  };
}

/**
 * One WAV per audible track, all cut to the same length so they line up in a
 * DAW, packed into a ZIP. Silent tracks (muted, or with nothing to play) are
 * left out and named in `silent`.
 */
export function stemsArchive(buffer: PcmSource, tracks: readonly string[], musicFrames: number): { archive: Blob; included: string[]; silent: string[] } {
  const length = trimmedLength(buffer, musicFrames);
  const files: { name: string; data: Uint8Array }[] = [];
  const included: string[] = [];
  const silent: string[] = [];
  tracks.forEach((track, index) => {
    const source = stemSource(buffer, index);
    if (isSilent(source, length)) {
      silent.push(track);
      return;
    }
    included.push(track);
    files.push({ name: `${String(index + 1).padStart(2, "0")}-${track}.wav`, data: new Uint8Array(encodeWav(source, length)) });
  });
  return { archive: zipStored(files), included, silent };
}

function isSilent(source: PcmSource, length: number, thresholdDb = -66): boolean {
  const threshold = 10 ** (thresholdDb / 20);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = source.getChannelData(channel);
    for (let index = 0; index < length; index += 1) if (Math.abs(data[index] ?? 0) > threshold) return false;
  }
  return true;
}
