# mediaforge 1.0.0 — audit findings

Audited package: `mediaforge@1.0.0` (installed at `node_modules/mediaforge`).
All paths below are relative to `node_modules/mediaforge/dist/esm/` unless noted.

Status legend:
- **verified** — reproduced by running the installed package.
- **inspected** — confirmed by reading the source, not reproduced at runtime.
- **uncertain** — suspected, depends on ffmpeg build/version; needs confirmation.

We are **not** using mediaforge in this project (see `package.json`); this file records
the defects found so they can be reported/fixed upstream.

---

## Critical / high

### 1. `ffprobe` always runs with `-v quiet`, so all probe errors are empty
- **File:** `probe/ffprobe.js` (`buildProbeArgs`)
- **Status:** verified
- **What's wrong:** probe args always include `-v quiet`. When ffprobe fails (bad
  path, unsupported container, permission error) the reason is suppressed, and
  `ProbeError.detail` is `""`.
- **Repro:** `probeAsync('/nonexistent-input-xyz.mp4')` →
  message `ffprobe failed for "/nonexistent-input-xyz.mp4": ` (trailing space, no reason).
  Sync `probe()` only has the generic
  `Command failed: ffprobe -v quiet -print_format json -show_format -show_streams -show_chapters <path>`.
- **Impact:** impossible to diagnose probe failures in production.
- **Fix:** drop `-v quiet` (use `-v error`), or pass `-v quiet` only for the JSON pass
  and re-run without it on failure to capture stderr.

### 2. `FFmpegSpawnError.stderrOutput` is always empty
- **File:** `process/spawn.js` (~line 70)
- **Status:** verified
- **What's wrong:** the error path hardcodes `const stderr = '';` and never reads the
  `stderrLines` captured by `captureStderr` (`utils/stderr.js`). So
  `FFmpegSpawnError.stderrOutput` is `''` and the message is
  `FFmpeg exited with code 254:\n` with no ffmpeg diagnostics.
- **Repro:** `runFFmpeg` on a bad input → `err.stderrOutput.length === 0`.
- **Fix:** wire `captureStderr().stderrLines` into the error object/message.

### 3. Timeout path emits two `error` events
- **File:** `process/spawn.js`
- **Status:** inspected
- **What's wrong:** the timeout handler emits `'error'` itself, then the process
  `'close'` handler emits a second `FFmpegSpawnError`. Listeners that don't expect a
  second `error` can crash or double-handle (`emitter.emit('error')` with no listener
  throws).
- **Fix:** emit exactly one error; track a `settled` flag and let the timeout path
  suppress the close-path error (or vice-versa).

### 4. HLS segments are named `*.js` by default
- **File:** `helpers/hls.js`
- **Status:** inspected
- **What's wrong:** `hlsPackage` defaults `segmentFilename = 'segment%03d.js'` and
  `adaptiveHls` defaults `segmentPattern = '%v_seg%03d.js'`. The generated segments
  are MPEG-TS (or fMP4), never JavaScript. The `.js` extension breaks player MIME
  detection and CDN/static-server caching.
- **Fix:** default to `segment%03d.ts` (and `%v_seg%03d.ts`), or `.m4s` for fMP4 mode.

### 5. `concatFiles` emits invalid filtergraph labels for audio-less inputs
- **File:** `helpers/concat.js` (`concatFiles`)
- **Status:** inspected
- **What's wrong:** builds labels like `[i:v][i:a?]`. `?` is a stream-specifier
  placeholder used in `-map`/`-filter_complex` option syntax, **not** a valid
  filtergraph pad name. Inputs missing audio make the graph fail to parse.
- **Fix:** probe each input and branch between `[i:v][i:a]` and `[i:v]` + `anullsrc`,
  or reject heterogeneous inputs with a clear error.

### 6. `setStreamMetadata` runtime arity disagrees with its JSDoc
- **File:** `helpers/mapping.js`
- **Status:** inspected
- **What's wrong:** implementation is `(type, streamIndex, key, value)`, but the JSDoc
  documents `(fileIndex, type, streamIndex, key, value)`. Calling it per the docs
  shifts every argument, producing nonsense such as `-metadata:s:0:a` = `0=language`.
- **Fix:** make signature and docs match (and update the `.d.ts`).

---

## Medium

### 7. `mapStream()` returns a bare string, not an args array
- **File:** `helpers/mapping.js`
- **Status:** inspected
- **What's wrong:** `mapStream(0, 'v', 0)` returns a single string, while the
  documented contract (and every other mapping/serializer in the package) is
  "returns a string array" to be spread into `.addInputOption(...)`. Spreading a
  string produces one arg per character.
- **Fix:** return `['-map', spec]`.

### 8. `streams.js` snapshots the stderr getter before ffmpeg runs
- **File:** `helpers/streams.js` (`pipeThrough`, `streamToFile`)
- **Status:** inspected
- **What's wrong:** `const captured = captureStderr(...); stderrLines = captured.stderrLines;`
  evaluates the `stderrLines` getter immediately, when it is still empty. The error
  object therefore always carries `stderrOutput: ''`.
- **Fix:** keep the `captured` reference and read `captured.stderrLines` at error time.

### 9. Builder never forwards `timeout` to the spawn layer
- **File:** `FFmpeg.js` (`run`/`spawn`), `process/spawn.js`
- **Status:** inspected
- **What's wrong:** `SpawnOptions.timeout` exists and is honored by `spawnFFmpeg`, but
  `FFmpegBuilder.run()` accepts only `{ parseProgress, totalDurationUs }`, so a
  builder-created job can never actually time out.
- **Fix:** forward `timeout`/`timeoutMs` and abort the child when exceeded.

### 10. Encoder registry caches stale results after `setBinary()`
- **File:** `codecs/registry.js`
- **Status:** inspected
- **What's wrong:** `invalidate()` does not clear `_encoders`, so after `setBinary()`
  the registry keeps reporting encoders from the previous ffmpeg. Separately,
  `getDefaultRegistry(binary)` ignores `binary` on any call after the first, so a
  different binary is silently served the default registry.
- **Fix:** clear `_encoders` in `invalidate()`; key the singleton by resolved binary
  path (or drop the `binary` parameter).

### 11. `mergeToFile` single-input fast path can write to a missing directory
- **File:** `helpers/concat.js` (`mergeToFile`)
- **Status:** inspected
- **What's wrong:** when there is one input it does `fs.copyFileSync(src, output)`
  without `mkdir`-ing `dirname(output)`, unlike the multi-input path. Also
  `reencode:false` blindly stream-copies, which fails or produces corrupt output for
  mismatched codecs/timescales (should probe first or force a re-encode on mismatch).
- **Fix:** ensure the output directory exists; validate stream compatibility before
  stream-copying.

### 12. `concatWithTransitions` reuses an existing pad label (`[v1]`)
- **File:** `helpers/concat.js` (`buildConcatTransitionArgs`)
- **Status:** inspected
- **What's wrong:** the xfade output label collides with an input label used earlier
  in the chain, producing a duplicate-pad filtergraph error.
- **Fix:** use unique output labels (`[xv1]`, `[xv2]`, …) that cannot collide with
  input pads.

### 13. Two-pass helpers are inconsistent and collide on temp paths
- **File:** `helpers/twopass.js`
- **Status:** inspected
- **What's wrong:**
  - `twoPassEncode` adds `-an` when `audioCodec==='none'`, but `buildTwoPassArgs`
    adds nothing in that case, so pass 2 re-introduces audio with defaults.
  - Pass files use fixed `tmpdir()` names (`mediaforge-passlog` / `mediaforge-pass1.mkv`),
    so concurrent encodes clobber each other, and cleanup only removes `passlog-0.log`
    (not `.mbtree` siblings in all codecs).
- **Fix:** make the two arg builders agree; use a unique per-job temp directory and
  clean the whole passlog set.

### 14. `escapeFilterValue()` breaks drawtext `%{...}` expansion
- **File:** `utils/filter.js`, used by `helpers/normalize.js` (`burnTimecode`)
- **Status:** inspected
- **What's wrong:** it escapes `%` → `\%`, which disables ffmpeg drawtext's
  `%{pts_hms}`-style expansion. Timecode burn-in therefore renders literal
  `%{pts_hms}` (or fails).
- **Fix:** don't escape `%` for values that feed `text=` expansion; escape `\`, `'`,
  `:`, `,`, `[`, `]` as needed per drawtext rules instead.

### 15. `satisfiesVersion` ignores patch / git-build sentinel
- **File:** `utils/version.js`
- **Status:** inspected
- **What's wrong:** version comparison ignores the patch component, and git/nightly
  builds are forced to `999.999.999`, so feature gates pass even when the build
  genuinely lacks the feature. `probeVersionAsync` is documented but not exported
  from `index.d.ts` (dead API surface).
- **Fix:** compare full semver (optionally with an opt-out), treat unknown nightly
  versions as "unknown" rather than "infinitely new", and export or remove
  `probeVersionAsync`.

### 16. `buildProgress` can emit a negative percentage
- **File:** `process/progress.js` (`buildProgress`)
- **Status:** inspected
- **What's wrong:** ffmpeg may report a negative `out_time_us` sentinel
  (e.g. `-9223372036854775808`) before the first frame; there is no
  `Math.max(0, …)` clamp, so consumers see a negative `percent`.
- **Fix:** clamp to `[0, 1]` (or `[0, 100]`).

### 17. `autoKillOnExit` suppresses default SIGINT/SIGTERM handling
- **File:** `helpers/process.js` (`autoKillOnExit`)
- **Status:** inspected
- **What's wrong:** it installs `process.once('SIGINT'/'SIGTERM', …)`. Merely adding a
  listener removes Node's default "exit on Ctrl+C" behavior, so a CLI that uses
  `autoKillOnExit` no longer terminates on SIGINT unless it re-raises. Also
  `_spawnedList` is never pruned in `trackChild` (unbounded growth) and
  `_spawnedPids` is written but never read.
- **Fix:** do not swallow the default signal action (re-raise after cleanup), prune
  `_spawnedList` on close, and either use or remove `_spawnedPids`.

### 18. `normalizeAudio` fabricates measurements in one-pass mode
- **File:** `helpers/normalize.js`
- **Status:** inspected
- **What's wrong:** with `twoPass:false` the returned object reports
  `inputI = targetI`, i.e. it claims the input already matched the target, rather than
  reporting "not measured".
- **Fix:** return `null`/`measured:false` for unmeasured fields.

### 19. VideoToolbox option maps to the wrong flag
- **File:** `codecs/hardware.js` (`videotoolboxToArgs`)
- **Status:** inspected
- **What's wrong:** `allowFrameReordering` is emitted as `-realtime`, which is an
  unrelated latency flag. Frame reordering is not controlled by `-realtime`.
- **Fix:** map to the correct VideoToolbox option, or omit it if ffmpeg exposes none.

---

## Low / uncertain

### 20. `mp3ToArgs` uses `-abr`
- **File:** `codecs/audio.js` (`mp3ToArgs`)
- **Status:** uncertain
- **Note:** `-abr` is not a documented libmp3lame ffmpeg option; ABR is usually
  selected via `-b:a`. Passing `-abr` may be rejected by some ffmpeg builds.

### 21. `watermark` requires the `copy` video filter
- **File:** `helpers/watermark.js`
- **Status:** uncertain
- **Note:** `[1:v]copy[wm]` needs the `copy` filter (ffmpeg ≥ 4.3). Older builds fail
  with "No such filter: 'copy'". Consider `null` or `format=rgba`.

### 22. Hex colors passed to `showwavespic`
- **File:** `helpers/waveform.js`
- **Status:** uncertain
- **Note:** `colors=${color}` with values like `#00ff00` may need to be
  `0x00ff00` / omitted quoting depending on the build.

### 23. Custom `binary` not always honored
- **File:** `helpers/concat.js` (`concatWithTransitions`) and other helpers
- **Status:** inspected
- **Note:** several helpers call `resolveProbe()`/`probeAsync()` without threading a
  caller-supplied `binary`, so a custom ffprobe is silently ignored.

### 24. `ffv1ToArgs` names the option `version` but emits `-level`
- **File:** `codecs/video.js` (`ffv1ToArgs`)
- **Status:** inspected
- **Note:** works for current ffmpeg, but the naming is confusing and the accepted
  values differ from `-level` semantics in other codecs.

---

## Things that are fine (checked)
- Probe and builder **do work on valid inputs** (verified on a real MP4:
  h264 + aac, duration ~1.03s, `isHdr:false`; `ffmpeg(...).dry()` returns args).
- `getPreset`/`applyPreset`, `proResToArgs`, most `*ToArgs` serializers, `runFFmpeg`
  success path, and `captureStderr`'s core buffering behave as documented.

## Note on a false negative during the audit
Searching for `\b` as a word boundary in GNU `grep` (BRE) does not work; an early
"these helpers don't exist" conclusion was wrong. `mergeToFile`, `concatFiles`,
`pipeThrough`, `streamOutput`, `streamToFile`, `normalizeAudio`, `adjustVolume`,
`extractAudio`, `replaceAudio`, `mixAudio`, and the codec `*ToArgs` functions all
exist in 1.0.0.
