import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Poller } from './poller.js';

describe('Poller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses the delay returned by the task for the next run', async () => {
    const delays = [1_000, 5_000, 1_000];
    const task = vi.fn(async () => delays.shift() ?? 60_000);
    const poller = new Poller('test', task, { error: vi.fn() });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(task).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('keeps running after a failure, with the error delay', async () => {
    const logger = { error: vi.fn() };
    const task = vi.fn<() => Promise<number>>().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(10_000);
    const poller = new Poller('test', task, logger, 30_000);

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledWith('test poll failed', expect.any(Error));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('stops scheduling after stop()', async () => {
    const task = vi.fn(async () => 1_000);
    const poller = new Poller('test', task, { error: vi.fn() });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(poller.running).toBe(false);
  });

  it('never overlaps runs of a slow task', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const task = vi.fn(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5_000));
      concurrent--;
      return 100;
    });
    const poller = new Poller('slow', task, { error: vi.fn() });

    poller.start();
    await vi.advanceTimersByTimeAsync(20_000);
    poller.stop();
    expect(maxConcurrent).toBe(1);
  });
});
