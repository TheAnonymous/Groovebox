export interface SequencerPosition {
  scene: number;
  bar: number;
  step: number;
  switched: boolean;
}

export class BarQueuedTransport {
  private scene = 0;
  private position = 0;
  private queued: number | null = null;
  private hasTicked = false;

  start(scene: number): void {
    this.scene = clampScene(scene);
    this.position = 0;
    this.queued = null;
    this.hasTicked = false;
  }

  queue(scene: number): number | null {
    const next = clampScene(scene);
    this.queued = next === this.scene ? null : next;
    return this.queued;
  }

  reset(): void {
    this.position = 0;
    this.queued = null;
    this.hasTicked = false;
  }

  next(): SequencerPosition {
    let switched = false;
    if (this.hasTicked && this.position % 16 === 0 && this.queued !== null) {
      this.scene = this.queued;
      this.queued = null;
      this.position = 0;
      switched = true;
    }
    const result = {
      scene: this.scene,
      bar: Math.floor(this.position / 16),
      step: this.position % 16,
      switched,
    };
    this.position = (this.position + 1) % 64;
    this.hasTicked = true;
    return result;
  }

  get runningScene(): number {
    return this.scene;
  }

  get queuedScene(): number | null {
    return this.queued;
  }
}

function clampScene(scene: number): number {
  return Math.max(0, Math.min(3, Math.round(scene)));
}
