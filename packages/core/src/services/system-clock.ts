import type { Clock, TimerHandle } from '../ports/clock.js';

export class SystemClock implements Clock {
  private handles = new Map<TimerHandle, NodeJS.Timeout>();

  now(): Date {
    return new Date();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle: TimerHandle = Symbol('timer');
    const timer = setTimeout(() => {
      this.handles.delete(handle);
      fn();
    }, ms);
    this.handles.set(handle, timer);
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    const timer = this.handles.get(handle);
    if (timer) {
      clearTimeout(timer);
      this.handles.delete(handle);
    }
  }
}
