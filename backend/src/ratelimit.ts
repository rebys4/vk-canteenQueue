type Bucket = { tokens: number; lastRefill: number };

export function makeRateLimiter({
  capacity = 5,
  refillPerSec = 1,   
} = {}) {
  const buckets = new Map<string, Bucket>();

  return function hit(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: capacity, lastRefill: now };
    const delta = (now - b.lastRefill) / 1000;
    if (delta > 0) {
      b.tokens = Math.min(capacity, b.tokens + delta * refillPerSec);
      b.lastRefill = now;
    }
    if (b.tokens >= cost) {
      b.tokens -= cost;
      buckets.set(key, b);
      return true;
    }
    buckets.set(key, b);
    return false;
  };
}