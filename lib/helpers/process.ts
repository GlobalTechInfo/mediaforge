import process from 'node:process';
import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const isWindows = process.platform === 'win32';

const _spawnedPids = new Set<number>();
// A Set (not an array) that holds only LIVE children. The previous
// implementation appended every child to an array and never removed it, so a
// long-running process leaked one entry per encode.
const _spawned = new Set<ChildProcess>();

/**
 * Track a child so it is counted as live and can be killed in bulk.
 *
 * Releases on `close`/`exit`, so the set cannot grow across a long-lived
 * process.
 */
export function trackChild(child: ChildProcess): void {
  _spawned.add(child);
  if (child.pid !== undefined) {
    _spawnedPids.add(child.pid);
  }
  const release = (): void => {
    _spawned.delete(child);
    if (child.pid !== undefined) {
      _spawnedPids.delete(child.pid);
    }
  };
  // 'close' is the reliable terminal event; 'exit' covers the case where the
  // stdio streams are inherited and never close.
  child.once('close', release);
  child.once('exit', release);
}

/**
 * Number of ffmpeg children currently being tracked (i.e. still live).
 *
 * Not part of the public API — it exists so the child-leak regression test can
 * assert that `trackChild` releases entries instead of accumulating them.
 */
export function getSpawnedCount(): number {
  return _spawned.size;
}

/**
 * Renice (change priority) of a running ffmpeg child process.
 * On Linux/macOS: uses the `renice` command. Range: -20 (highest) to 19 (lowest).
 * On Windows: uses PowerShell instead of wmic for locale-invariance.
 * Requires appropriate OS permissions for negative values on Unix.
 *
 * @example
 * const proc = ffmpeg('input.mp4').output('out.mp4').spawn();
 * renice(proc.child, 10); // lower priority
 */
export function renice(child: ChildProcess, priority: number): void {
  if (child.pid === undefined) throw new Error('Process has no PID yet');
  try {
    if (isWindows) {
      let priorityClass: string;
      if (priority <= -15)     priorityClass = 'Realtime';
      else if (priority <= -5) priorityClass = 'High';
      else if (priority <= 0)  priorityClass = 'AboveNormal';
      else if (priority <= 5)  priorityClass = 'Normal';
      else if (priority <= 10) priorityClass = 'BelowNormal';
      else                     priorityClass = 'Idle';
      execFileSync('powershell', [
        '-Command',
        `& { (Get-Process -Id ${child.pid}).PriorityClass = '${priorityClass}' }`,
      ], { stdio: 'ignore' });
    } else {
      execFileSync('renice', ['-n', String(priority), '-p', String(child.pid)], { stdio: 'ignore' });
    }
  } catch (e) {
    throw new Error(`renice failed: ${(e as Error).message}`);
  }
}

/**
 * Register cleanup handler to kill an ffmpeg process when the Node.js process exits.
 * Returns an unregister function — call it once the ffmpeg process finishes normally.
 *
 * Listens to process exit, SIGINT, SIGTERM, and beforeunload (for Deno compat).
 *
 * @example
 * const proc = ffmpeg('input.mp4').output('out.mp4').spawn();
 * const unregister = autoKillOnExit(proc.child);
 * proc.emitter.on('end', () => unregister());
 */
export function autoKillOnExit(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): () => void {
  const safeSignal = isWindows ? 'SIGKILL' : signal;
  const handler = () => {
    try { child.kill(safeSignal); } catch { /* ok */ }
    // Re-raise the signal so Node.js still exits with the default behavior
    if (!isWindows) process.kill(process.pid!, safeSignal);
  };

  process.on('exit',    handler);
  process.on('SIGINT',  handler);
  process.on('SIGTERM', handler);
  if (typeof (globalThis as Record<string, unknown>)['addEventListener'] === 'function') {
    try {
      ((globalThis as Record<string, unknown>)['addEventListener'] as (...args: unknown[]) => unknown)('beforeunload', handler);
    } catch { /* not available in all runtimes */ }
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    // 'on' is used above, so remove every registration, not just the first.
    process.removeListener('exit',    handler);
    process.removeListener('SIGINT',  handler);
    process.removeListener('SIGTERM', handler);
    if (typeof (globalThis as Record<string, unknown>)['removeEventListener'] === 'function') {
      try {
        ((globalThis as Record<string, unknown>)['removeEventListener'] as (...args: unknown[]) => unknown)('beforeunload', handler);
      } catch { /* not available in all runtimes */ }
    }
  };

  child.once('close', cleanup);

  return cleanup;
}

/**
 * Kill all tracked ffmpeg processes (only those spawned by this library).
 */
export function killAllFFmpeg(signal: NodeJS.Signals = 'SIGTERM'): void {
  // Copy first: kill() can synchronously emit 'close', which mutates the set.
  for (const child of [..._spawned]) {
    try { child.kill(signal); } catch { /* ok */ }
  }
}

// ─── Exit / signal cleanup ───────────────────────────────────────────────────

/**
 * Children registered for automatic cleanup.
 *
 * Kept separate from `_spawned` so `autoCleanup: false` really does opt out.
 */
const _cleanupChildren = new Set<ChildProcess>();

/**
 * One set of process listeners for the whole library, installed lazily on the
 * first spawn and removed once nothing is left to protect.
 *
 * Registering `process.on('SIGINT')` per child would be a bug twice over: a
 * long-running server spawning thousands of encodes would trip Node's
 * `MaxListenersExceededWarning` at 11, and every one of those handlers would
 * have to be torn down individually. A single handler consulting a Set cannot
 * leak listeners, because the count does not grow with the number of jobs.
 */
let cleanupInstalled = false;

function installCleanupHandlers(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;

  /** Kill every registered child. Safe to call more than once. */
  const killAll = (): void => {
    // SIGKILL on Windows: there is no SIGTERM-equivalent that a child can trap,
    // and a native addon may not route the signal at all.
    const safeSignal = isWindows ? 'SIGKILL' : 'SIGTERM';
    for (const child of [..._cleanupChildren]) {
      try {
        // Prefer the process group: these children are spawned detached, so a
        // terminal Ctrl-C never reaches anything they started themselves.
        if (!isWindows && child.pid !== undefined) {
          process.kill(-child.pid, safeSignal);
          continue;
        }
        child.kill(safeSignal);
      } catch {
        try {
          child.kill(safeSignal);
        } catch {
          // Already gone.
        }
      }
    }
  };

  /**
   * Handle a termination signal.
   *
   * Installing a `SIGINT`/`SIGTERM` listener *removes Node's default behaviour* of
   * terminating on those signals. Without restoring it here, a server holding a
   * registered encode would ignore `systemctl stop` and a Ctrl-C would kill only
   * ffmpeg while the host carried on — the supervisor would then have to escalate
   * to SIGKILL. Measured: a host with one registered encode survived SIGTERM
   * indefinitely.
   *
   * So after cleaning up, put the default back — but only when this library is
   * the *sole* owner of the signal. If the application installed its own handler,
   * exiting is that handler's decision, and yanking the process out from under it
   * would be worse than the original problem.
   */
  const signalHandler = (signal?: NodeJS.Signals): void => {
    killAll();
    if (signal !== 'SIGINT' && signal !== 'SIGTERM') return;
    removeCleanupHandlers();
    if (process.listenerCount(signal) > 0) return; // the application owns it
    // Default disposition restored by re-raising on ourselves.
    process.kill(process.pid, signal);
  };

  // 'exit' must never re-raise: the process is already on its way out.
  process.on('exit', killAll);
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);
  if (typeof (globalThis as Record<string, unknown>)['beforeunload'] === 'function') {
    try {
      ((globalThis as Record<string, unknown>)['addEventListener'] as (...a: unknown[]) => unknown)(
        'beforeunload',
        killAll,
      );
    } catch {
      // Not every runtime exposes it.
    }
  }

  _cleanupHandlers = { killAll, signalHandler };
}

let _cleanupHandlers:
  | { killAll: () => void; signalHandler: (signal?: NodeJS.Signals) => void }
  | undefined;

/**
 * Ensure a child cannot outlive this process.
 *
 * Without this a `SIGTERM` delivered to the host alone leaves ffmpeg running
 * and still writing to the output path — which is the normal case for a
 * systemd stop, a container shutdown, or a CI cancellation.
 */
export function registerExitCleanup(child: ChildProcess): void {
  installCleanupHandlers();
  _cleanupChildren.add(child);
  const release = (): void => {
    _cleanupChildren.delete(child);
    if (_cleanupChildren.size === 0) removeCleanupHandlers();
  };
  child.once('close', release);
  child.once('exit', release);
}

/**
 * Drop the global handlers once the last registered child has exited, so a
 * finished encode leaves no listeners behind to keep a short-lived process
 * alive or to fire during unrelated later work.
 *
 * Called from the signal path too, so that re-raising sees the default
 * disposition rather than this library's own handler.
 */
function removeCleanupHandlers(): void {
  if (_cleanupHandlers === undefined) return;
  const { killAll, signalHandler } = _cleanupHandlers;
  process.removeListener('exit', killAll);
  process.removeListener('SIGINT', signalHandler);
  process.removeListener('SIGTERM', signalHandler);
  if (typeof (globalThis as Record<string, unknown>)['removeEventListener'] === 'function') {
    try {
      ((globalThis as Record<string, unknown>)['removeEventListener'] as (...a: unknown[]) => unknown)(
        'beforeunload',
        killAll,
      );
    } catch {
      // Not every runtime exposes it.
    }
  }
  _cleanupHandlers = undefined;
  cleanupInstalled = false;
}

/**
 * Number of children currently registered for exit cleanup.
 *
 * Exists so a regression test can assert the registration set drains — an
 * entry left behind after a job finishes would keep a process-level handler
 * alive forever. Not part of the public API.
 */
export function getCleanupCount(): number {
  return _cleanupChildren.size;
}
