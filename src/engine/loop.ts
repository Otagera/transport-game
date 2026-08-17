export const SIM_DT = 1 / 30;

// Caps how much wall-clock time one frame can feed the accumulator, so a
// stalled tab (backgrounded, breakpoint, GC pause) resumes at a bounded
// number of ticks instead of spiraling through hours of catch-up.
const MAX_FRAME_TIME = 0.25;

export class Accumulator {
  private acc = 0;

  constructor(private readonly dt: number = SIM_DT) {}

  /**
   * Advances the accumulator by `elapsedSeconds` of wall-clock time, calling
   * `onTick` once per whole `dt` step. Returns the interpolation alpha
   * (0..1) for the leftover, sub-step time, for render-side interpolation.
   */
  advance(elapsedSeconds: number, onTick: (dt: number) => void): number {
    this.acc += Math.min(elapsedSeconds, MAX_FRAME_TIME);

    while (this.acc >= this.dt) {
      onTick(this.dt);
      this.acc -= this.dt;
    }

    return this.acc / this.dt;
  }
}
