// Deno entry point for the cross-runtime published-package check.
// The implementation detects the runtime itself; this file exists so the
// workflow can invoke a Deno-specific path.
export {};
import './smoke-runtime.ts';
