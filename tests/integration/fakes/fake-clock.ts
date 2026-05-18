import type { Clock, TimerHandle } from '@kairos-symphony/core';

interface Pending {
  handle: TimerHandle;
  fireAt: number;
  fn: () => void;
}

export class FakeClock implements Clock {
  private currentMs: number;
  private pending: Pending[] = [];

  constructor(start: Date = new Date('2026-05-18T10:00:00Z')) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle: TimerHandle = Symbol('fake-timer');
    this.pending.push({ handle, fireAt: this.currentMs + ms, fn });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.pending = this.pending.filter((p) => p.handle !== handle);
  }

  advance(ms: number): void {
    const target = this.currentMs + ms;
    while (true) {
      const next = this.pending
        .filter((p) => p.fireAt <= target)
        .sort((a, b) => a.fireAt - b.fireAt)[0];
      if (!next) break;
      this.currentMs = next.fireAt;
      this.pending = this.pending.filter((p) => p.handle !== next.handle);
      next.fn();
    }
    this.currentMs = target;
  }
}
