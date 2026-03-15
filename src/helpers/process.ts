import { execSync } from 'child_process';
import type { ChildProcess } from 'child_process';

const isWindows = process.platform === 'win32';

/**
 * Renice (change priority) of a running ffmpeg child process.
 * On Linux/macOS: uses the `renice` command. Range: -20 (highest) to 19 (lowest).
 * On Windows: uses `wmic process` to set priority class.
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
      // Map Unix-style -20..19 range to Windows priority classes
      let priorityClass: string;
      if (priority <= -15)     priorityClass = 'Realtime';
      else if (priority <= -5) priorityClass = 'High';
      else if (priority <= 0)  priorityClass = 'AboveNormal';
      else if (priority <= 5)  priorityClass = 'Normal';
      else if (priority <= 10) priorityClass = 'BelowNormal';
      else                     priorityClass = 'Idle';
      execSync(
        `wmic process where ProcessId=${child.pid} CALL setpriority "${priorityClass}"`,
        { stdio: 'ignore' },
      );
    } else {
      execSync(`renice -n ${priority} -p ${child.pid}`, { stdio: 'ignore' });
    }
  } catch (e) {
    throw new Error(`renice failed: ${(e as Error).message}`);
  }
}

/**
 * Register cleanup handler to kill an ffmpeg process when the Node.js process exits.
 * Returns an unregister function — call it once the ffmpeg process finishes normally.
 *
 * Listens to process exit, SIGINT, and SIGTERM only.
 * Does NOT listen to uncaughtException to avoid suppressing error reporting.
 *
 * @example
 * const proc = ffmpeg('input.mp4').output('out.mp4').spawn();
 * const unregister = autoKillOnExit(proc.child);
 * proc.emitter.on('end', () => unregister());
 */
export function autoKillOnExit(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): () => void {
  const handler = () => {
    try { child.kill(signal); } catch { /* process may have already exited */ }
  };

  process.on('exit',    handler);
  process.on('SIGINT',  handler);
  process.on('SIGTERM', handler);

  return () => {
    process.off('exit',    handler);
    process.off('SIGINT',  handler);
    process.off('SIGTERM', handler);
  };
}

/**
 * Kill all running ffmpeg processes on this system (by process name).
 * Works on Linux, macOS, and Windows.
 * Use with caution — kills ALL ffmpeg processes, not just ones started by this library.
 *
 * @example
 * killAllFFmpeg();
 */
export function killAllFFmpeg(signal: NodeJS.Signals = 'SIGTERM'): void {
  try {
    if (isWindows) {
      execSync('taskkill /IM ffmpeg.exe /F', { stdio: 'ignore' });
    } else {
      execSync(`pkill -${signal} ffmpeg`, { stdio: 'ignore' });
    }
  } catch { /* no ffmpeg processes found — that's fine */ }
}
