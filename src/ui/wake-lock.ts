/**
 * Keeps the screen on while music plays, so a laptop does not dim or lock in
 * the middle of a set. Browsers drop the lock when the tab is hidden; it is
 * taken again when the tab comes back and the music still plays.
 */
export class PlaybackWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private requesting = false;

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (this.wanted && document.visibilityState === "visible") void this.acquire();
    });
  }

  set playing(playing: boolean) {
    if (playing === this.wanted) return;
    this.wanted = playing;
    if (playing) void this.acquire();
    else this.release();
  }

  get held(): boolean {
    return this.sentinel !== null;
  }

  private async acquire(): Promise<void> {
    if (this.sentinel || this.requesting || typeof navigator.wakeLock?.request !== "function") return;
    this.requesting = true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!this.wanted) {
        void sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // Denied (battery saver, hidden tab, policy): the screen simply may dim.
    } finally {
      this.requesting = false;
    }
  }

  private release(): void {
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => undefined);
  }
}
