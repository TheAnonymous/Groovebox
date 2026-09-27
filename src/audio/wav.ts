export interface PcmSource {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/** Length up to the last sample above `thresholdDb`, plus a short breath, never below `minimumLength`. */
export function trimmedLength(source: PcmSource, minimumLength = 0, thresholdDb = -66): number {
  const threshold = 10 ** (thresholdDb / 20);
  const channels = Array.from({ length: source.numberOfChannels }, (_, index) => source.getChannelData(index));
  let last = 0;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (channels.some((channel) => Math.abs(channel[index] ?? 0) > threshold)) {
      last = index;
      break;
    }
  }
  const breath = Math.round(source.sampleRate * 0.25);
  return Math.min(source.length, Math.max(minimumLength, last + breath));
}

/** 16-bit PCM WAV with a 20 ms fade at the end so a trimmed tail never clicks. */
export function encodeWav(source: PcmSource, length = source.length): ArrayBuffer {
  const channels = Math.max(1, source.numberOfChannels);
  const frames = Math.max(0, Math.min(length, source.length));
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, source.sampleRate, true);
  view.setUint32(28, source.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  const data = Array.from({ length: channels }, (_, index) => source.getChannelData(Math.min(index, source.numberOfChannels - 1)));
  const fadeFrames = Math.min(frames, Math.round(source.sampleRate * 0.02));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    const fade = frame >= frames - fadeFrames ? (frames - frame) / Math.max(1, fadeFrames) : 1;
    for (const channel of data) {
      const sample = Math.max(-1, Math.min(1, (channel[frame] ?? 0) * fade));
      view.setInt16(offset, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
      offset += bytesPerSample;
    }
  }
  return buffer;
}
