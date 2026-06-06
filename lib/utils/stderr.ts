import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { FFmpegEmitter } from '../process/events.ts';
import type { ProgressParser } from '../process/progress.ts';

const MAX_STDERR_LINES = 1000;

class RingBuffer {
  private buffer: string[];
  private head: number = 0;
  private size: number = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(line: string): void {
    this.buffer[this.head] = line;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  toArray(): string[] {
    const result = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      result[i] = this.buffer[(this.head - this.size + i + this.capacity) % this.capacity]!;
    }
    return result;
  }
}

export function captureStderr(
  stderr: Readable,
  emitter: FFmpegEmitter,
  progressParser?: ProgressParser | null,
): { stderrLines: string[]; close: () => void } {
  const ring = new RingBuffer(MAX_STDERR_LINES);
  const rl = createInterface({ input: stderr, crlfDelay: Infinity });
  rl.on('line', (line) => {
    ring.push(line);
    emitter.emit('stderr', line);
    progressParser?.push(line);
  });
  const close = () => {
    rl.close();
  };
  return {
    get stderrLines(): string[] { return ring.toArray(); },
    close,
  };
}
