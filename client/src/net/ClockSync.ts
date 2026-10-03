// Estimates server time from ping/pong samples. Keeps the lowest RTT samples and smooths the offset.

interface Sample {
  rtt: number;
  offset: number;
}

export class ClockSync {
  offset = 0; // serverTime - performance.now()
  rtt = 0;
  private samples: Sample[] = [];
  private smooth = false;

  /** Initialise from a known server time (JOINED). */
  init(serverTime: number): void {
    this.offset = serverTime - performance.now();
    this.samples = [];
    this.smooth = false;
  }

  now(): number {
    return performance.now() + this.offset;
  }

  onPong(sentAt: number, serverTime: number): void {
    const t = performance.now();
    const rtt = t - sentAt;
    const offset = serverTime + rtt / 2 - t;
    this.samples.push({ rtt, offset });
    if (this.samples.length > 8) this.samples.shift();
    let best = this.samples[0] as Sample;
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.rtt = this.rtt === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
    if (!this.smooth) {
      this.offset = best.offset;
      this.smooth = true;
    } else {
      this.offset += (best.offset - this.offset) * 0.15;
    }
  }
}
