/**
 * トークンバケット方式の帯域制限。
 * bytesPerSec <= 0 の場合は無制限として即座に consume() が解決する。
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private readonly bytesPerSec: number) {
    this.tokens = bytesPerSec;
    this.lastRefill = Date.now();
  }

  async consume(bytes: number): Promise<void> {
    if (this.bytesPerSec <= 0) return;
    while (true) {
      this.refill();
      if (this.tokens >= bytes) {
        this.tokens -= bytes;
        return;
      }
      const shortfall = bytes - this.tokens;
      const waitMs = (shortfall / this.bytesPerSec) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(Math.max(waitMs, 10), 1000)));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.bytesPerSec, this.tokens + elapsedSec * this.bytesPerSec);
    this.lastRefill = now;
  }
}
