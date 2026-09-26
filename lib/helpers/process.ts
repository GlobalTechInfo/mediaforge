import process from 'node:process';
import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const isWindows = process.platform === 'win32';

const _spawnedPids = new Set<number>();
// A Set (not an array) that holds only LIVE children. The previous
// implementation appended every child to an array and never removed it, so a
// long-running process leaked one entry per encode, and getSpawnedCount() had
// to scan the whole history to filter out dead entries.
const _spawned = new Set<ChildProcess>();

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
