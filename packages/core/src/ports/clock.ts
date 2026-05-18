export type TimerHandle = symbol;

export interface Clock {
  now(): Date;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}
