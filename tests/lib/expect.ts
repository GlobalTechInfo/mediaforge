/**
 * Re-export of the shared assertion shim.
 *
 * This file previously held its own byte-identical copy of `expect()`. Two
 * copies meant a fix to one silently did not apply to the other, and nothing
 * detected the divergence. The single implementation now lives in
 * `testkit/expect.ts`.
 */
export { expect } from '../../testkit/expect.ts';
