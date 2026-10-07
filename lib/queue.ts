/**
 * Bounded concurrency for ffmpeg jobs.
 *
 * Each encode is a CPU- and memory-hungry subprocess. A service that accepts
 * uploads and spawns one ffmpeg per request will, past a handful of concurrent
 * jobs, spend all its time in the scheduler: every encode gets a fraction of
 * the cores, memory pressure starts swapping, and total throughput *drops*.
 * Often the last few jobs are slower than running them one at a time would have
 * been.
 *
 * {@link FFmpegQueue} caps how many run at once and queues the rest, which
 * keeps throughput at its maximum and makes back-pressure explicit.
 */
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { FFmpegError } from './errors.ts';

export interface QueueOptions {
  /**
   * Maximum concurrent jobs. Defaults to 1.
   *
   * One is the right default for an encode queue: a single ffmpeg already
   * saturates the machine it runs on, so serialising is faster than thrashing.
   */
  concurrency?: number;
  /**
   * Refuse a job once this many are waiting. Defaults to unbounded.
   *
   * Back-pressure as a number: with a queue that accepts work forever, an
   * overloaded service converts a slowdown into an out-of-memory crash.
   */
  maxPending?: number;
}

export interface QueueStats {
  /** Jobs currently running. */
  running: number;
  /** Jobs waiting for a slot. */
  pending: number;
  /** Jobs accepted over this queue's lifetime. */
  completed: number;
  /** Jobs that failed over this queue's lifetime. */
  failed: number;
  /** Jobs rejected before running because the queue was full. */
  rejected: number;
}

interface Job<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}

/**
 * A promise-returning job queue with a fixed concurrency limit.
 *
 * @example
 * const queue = new FFmpegQueue({ concurrency: 2 });
 * await Promise.all([
 *   queue.run(() => transcode('a.mp4', 'a-out.mp4')),
 *   queue.run(() => transcode('b.mp4', 'b-out.mp4')),
 *   queue.run(() => transcode('c.mp4', 'c-out.mp4')),
 * ]);
 * // At most two ran at once.
 */
export class FFmpegQueue {
  readonly #concurrency: number;
  readonly #maxPending: number;
  readonly #running = new Set<Promise<unknown>>();
  #queue: Job<unknown>[] = [];
  #completed = 0;
  #failed = 0;
  #rejected = 0;

  constructor(options: QueueOptions = {}) {
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError(`concurrency must be a positive integer, got ${concurrency}`);
    }
    if (options.maxPending !== undefined && (!Number.isInteger(options.maxPending) || options.maxPending < 0)) {
      throw new RangeError(`maxPending must be a non-negative integer, got ${options.maxPending}`);
    }
    this.#concurrency = concurrency;
    this.#maxPending = options.maxPending ?? Number.POSITIVE_INFINITY;
  }

  /** Maximum jobs that may run at once. */
  get concurrency(): number {
    return this.#concurrency;
  }

  /** Current queue depth. */
  stats(): QueueStats {
    return {
      running: this.#running.size,
      pending: this.#queue.length,
      completed: this.#completed,
      failed: this.#failed,
      rejected: this.#rejected,
    };
  }

  /**
   * Enqueue a job, resolving when it has run.
   *
   * @param signal Abort only the queue *wait*, not a running job. Callers that
   *               want to stop the encode itself should pass an AbortSignal to
   *               the underlying spawn.
   * @throws {FFmpegError} `VALIDATION_FAILED` when `maxPending` is exceeded.
   */
  run<T>(run: () => Promise<T>, options: { signal?: AbortSignal } = {}): Promise<T> {
    if (this.#queue.length >= this.#maxPending) {
      this.#rejected++;
      return Promise.reject(
        new FFmpegError(
          `FFmpeg queue is full: ${this.#running.size} running, ${this.#queue.length} pending ` +
            `(maxPending ${this.#maxPending}). Reject the request or raise maxPending.`,
          'VALIDATION_FAILED',
        ),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const job: Job<T> = {
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      };

      if (options.signal?.aborted === true) {
        reject(signalError(options.signal.reason));
        return;
      }
      options.signal?.addEventListener(
        'abort',
        () => {
          const index = this.#queue.indexOf(job as unknown as Job<unknown>);
          if (index !== -1) {
            this.#queue.splice(index, 1);
            reject(signalError(options.signal?.reason));
          }
        },
        { once: true },
      );

      this.#queue.push(job as unknown as Job<unknown>);
      this.#drain();
    });
  }

  /** Wait until every queued and running job has settled. */
  async onIdle(): Promise<void> {
    while (this.#running.size > 0 || this.#queue.length > 0) {
      await Promise.allSettled([...this.#running]);
      if (this.#queue.length > 0) await delay(1);
    }
  }

  /** Start as many queued jobs as the concurrency limit allows. */
  #drain(): void {
    while (this.#running.size < this.#concurrency && this.#queue.length > 0) {
      const job = this.#queue.shift();
      if (job === undefined) return;

      const started = Promise.resolve()
        .then(job.run)
        .then(
          (value) => {
            this.#completed++;
            job.resolve(value);
          },
          (error: unknown) => {
            this.#failed++;
            job.reject(error);
          },
        )
        .finally(() => {
          this.#running.delete(started);
          // A finished slot may unblock the next waiter.
          this.#drain();
        });

      this.#running.add(started);
    }
  }
}

function signalError(reason: unknown): FFmpegError {
  return new FFmpegError('queued ffmpeg job was aborted before it started', 'ABORTED', {
    cause: reason,
  });
}

/**
 * Process-wide default queue.
 *
 * A convenience for the common case of one service, one ffmpeg capacity limit.
 * Set `MEDIAFORGE_CONCURRENCY` to tune it.
 */
let _defaultQueue: FFmpegQueue | undefined;
/** Options the current default was built with, so a repeat request can be honoured. */
let _defaultSettings: QueueOptions | undefined;

/**
 * Resolve the process-wide queue, creating or resizing it only when needed.
 *
 * Passing the same `concurrency` again must return the *existing* queue. Creating
 * a fresh one per call looked equivalent but was the opposite of the intent: a
 * handler that writes `queued(job, { concurrency: 2 })` on every request would
 * get a new, empty queue each time, so every job started immediately and the cap
 * was never enforced — precisely the unbounded fan-out this module exists to
 * prevent. Verified: 10 jobs at `concurrency: 2` reached a peak of 10 before this
 * was fixed.
 */
export function getDefaultQueue(options: QueueOptions | number = {}): FFmpegQueue {
  const requested: QueueOptions = typeof options === 'number'
    ? { concurrency: options }
    : options;

  if (requested.concurrency === undefined) {
    if (_defaultQueue === undefined) {
      const fromEnv = Number(process.env['MEDIAFORGE_CONCURRENCY'] ?? '');
      const concurrency = Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 1;
      _defaultQueue = new FFmpegQueue({ concurrency });
      _defaultSettings = { concurrency };
    }
    return _defaultQueue;
  }

  // Reuse when the requested settings match what this queue already enforces.
  const sameConcurrency = _defaultSettings?.concurrency === requested.concurrency;
  const samePending = requested.maxPending === undefined
    || requested.maxPending === _defaultSettings?.maxPending;
  if (_defaultQueue !== undefined && sameConcurrency && samePending) {
    return _defaultQueue;
  }

  _defaultQueue = new FFmpegQueue(requested);
  _defaultSettings = { ...requested };
  return _defaultQueue;
}

/** Replace the process-wide queue. Intended for tests. */
export function setDefaultQueue(queue: FFmpegQueue | undefined): void {
  _defaultQueue = queue;
  _defaultSettings = undefined;
}

/**
 * Run `fn` through the process-wide queue.
 *
 * Sugar for {@link getDefaultQueue}. Pass `concurrency` once, or on every call —
 * the same value reuses the same queue, so the cap is actually enforced:
 *
 * @example
 * // Set it once at startup:
 * getDefaultQueue({ concurrency: 4 });
 *
 * // or per call, with the same value:
 * await queued(() => transcode(a));
 * await queued(() => transcode(b));
 */
export function queued<T>(
  fn: () => Promise<T>,
  options: QueueOptions & { signal?: AbortSignal } = {},
): Promise<T> {
  return getDefaultQueue(options).run(fn, {
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
}