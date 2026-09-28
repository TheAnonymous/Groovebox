// AudioWorklet processor of the live recorder. A plain file, so the build emits
// it as a same-origin asset: the page's CSP allows scripts and fetches only
// from 'self', and the worklet loader fetches its module.
/* global AudioWorkletProcessor, registerProcessor */
class MasterRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 8192;
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.filled = 0;
    this.recording = true;
    this.port.onmessage = (event) => {
      if (event.data !== "stop") return;
      if (this.filled > 0) this.port.postMessage({ left: this.left.slice(0, this.filled), right: this.right.slice(0, this.filled) });
      this.recording = false;
      this.port.postMessage({ done: true });
    };
  }

  process(inputs) {
    if (!this.recording) return false;
    const input = inputs[0] || [];
    const left = input[0];
    const right = input[1] || input[0];
    const frames = left ? left.length : 128;
    for (let index = 0; index < frames; index += 1) {
      this.left[this.filled] = left ? left[index] : 0;
      this.right[this.filled] = right ? right[index] : 0;
      this.filled += 1;
      if (this.filled === this.size) {
        this.port.postMessage({ left: this.left, right: this.right }, [this.left.buffer, this.right.buffer]);
        this.left = new Float32Array(this.size);
        this.right = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("musik-master-recorder", MasterRecorder);
