# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0-rc.1]

> **Release candidate.** This is a prerelease — pin the exact version
> (`mediaforge@2.1.0-rc.1`). It is not published to `latest`; the stable `2.1.0`
> is cut only after this RC has been exercised in production.

Everything below is additive, so the 2.0.0 API still works unchanged.

### Added — the CLI now covers the whole library surface

The CLI shipped 31 editing commands against a library that exports 332 runtime
symbols. This release closes that gap: **52 task commands**, and a parity test
(`cli.test.ts`, `deno-tests/cli.test.ts`, `runtime-tests/battle.ts`
and `tests/unit/cli.test.ts`) that fails if a public export is neither reachable from
a command nor listed in `LIBRARY_ONLY` with a reason. A missing command is now a
decision, not an oversight.

- **`filter <name> [key=value …]`** — applies any of the **77 built-in filters**
  (51 video, 26 audio) by name, so no filter needs a bespoke command. `--list`
  prints every name with its option keys, `--print` emits the filter string without
  encoding, `--chain` applies several in order (`scale:w=160,h=90|eq:contrast=1.1`),
  and `--audio` switches from `-vf` to `-af`.
- **`graph <in> <out> --pipeline …`** — builds `-filter_complex` from a JSON step
  list (`{from, filter, args?, named?, out?}`). The final step's output label is
  mapped automatically, because a filtergraph whose last output is unmapped fails
  with ffmpeg's unhelpful "unconnected output".
- **`codec <name> [key=value …]`** — prints the encoder arguments any of the 36
  codec builders produces. `pcm` takes its sample format as a leading positional
  (`mediaforge codec pcm pcm_s16le sampleRate=48000`).
- **`map <in> <out>`** — the whole stream-mapping DSL as flags: `--all`, `--remux`,
  `--default`, `--av`, `--spec`, `--video`, `--audio`, `--subs`, `--label`,
  `--exclude`, `--disposition`, `--copy-stream`, `--codec-stream`, `--metadata`,
  `--stream-meta`, `--print`.
- **`preset [name] <in> <out>`** — `--list`, `--print`, and `--size` / `--crf`
  overrides on the named encode presets.
- **`analyze <file> [--json]`** — a structured report: format, duration, size,
  bitrate, HDR and interlacing flags, per-stream summaries with the default stream
  marked, subtitles and chapters.
- **`features`** — evaluates the `FEATURE_GATES` table against the installed
  binary, or against a version you name with `--ffmpeg-version 7.0`; `--missing`
  lists only the gates that are unavailable.
- **`hwaccel <name> <in> <out>`** — GPU transcode through `transcodeWithHwFilters`,
  with `--list`, `--check` (availability only) and `--print` (the chain only, no
  encoder and no input/output needed).
- **`args <op> [key=value …]`** — prints the exact argv any of the 55 arg builders
  produces, for inspection and for copy-paste into a script.
- **Media operations:** `stack` (hstack / vstack), `mix` (weighted amix), `loop`,
  `deinterlace`, `stabilize`, `aspect`, `lut`, `timecode`, `cropdetect`,
  `gif2mp4`, `extract-subs` and `retime-subs`.
- **`LIBRARY_ONLY`** documents the public exports deliberately left without their
  own command — process-lifecycle helpers (`autoKillOnExit`, `killAllFFmpeg`,
  `renice`) and internals every task already uses (`spawnFFmpeg`, `runFFmpeg`,
  `captureStderr`, `isDeno`) — each with the reason.
- `fixSubtitleDuration` was reachable only through an `args` builder, which was
  misleading because it really runs ffmpeg against a real subtitle file. It is now
  the `retime-subs` command.
- `buildHlsArgs` / `buildDashArgs` now take their options as
  `Omit<HlsOptions, 'input' | 'outputDir'>` and
  `Omit<DashOptions, 'input' | 'output'>` (both optional and exported), instead of
  requiring the input and output as positional parameters.

### Fixed

- **`npm run release` corrupted every prerelease version.** `bumpVersion` split the
  current version on `.` and called `Number` on each part, so `2.1.0-rc.1`
  became `[2, 1, NaN, 1]` and `patch` produced the string `2.1.NaN`. The
  accepted-argument test was an unanchored `/^\d+\.\d+\.\d+/`, so `2.1.0junk`
  and `1.2.3-` were both treated as valid versions and would have been written
  into `package.json` and pushed as a tag. Version handling now lives in
  `scripts/release-version.ts` with a real parser, covered by
  `tests/unit/release-version.test.ts` across every format the project uses or
  could ship: `2.1.0`, `2.1.0-alpha`, `2.1.0-rc.1`, `2.0.0.beta`, `2.0.1-dev`
  and `2.1.1-dev-2`. An explicit version is written back verbatim, so
  `2.0.0.beta` keeps its dot rather than being normalised to `2.0.0-beta`.
  Bumping from a prerelease now lands on that version's own final release, as
  semver requires: `2.1.0-rc.1` with `patch` gives `2.1.0`, not `2.1.NaN` and
  not `2.1.1`.
- **The release script's verification step was too narrow.** It ran only
  `test:unit`, so a release could be tagged and pushed with failing integration
  tests, a failing battle suite or a dead export. It now runs `check:types`,
  the full `test` suite and `battle:all` before committing anything.
- **`CapabilityRegistry.encoders` only listed a third of the encoders.** The set
  was built from the `(encoders: ...)` parenthetical in `ffmpeg -codecs`, which
  ffmpeg only fills in for the handful of encoders it names in a codec's
  description. On a stock build `aac`, `libmp3lame`, `flac`, `libopus` and ~135
  others were missing, so `hasCodec('aac')` and `canEncode('aac')` answered
  false for codecs the build plainly supports. The set is now merged with a full
  parse of `ffmpeg -encoders` (74 → 210 entries on this machine).
- **`onProgress` never reported a percentage.** `parseProgress: true` told the
  parser to listen for ffmpeg's `key=value` progress blocks, but nothing ever
  asked ffmpeg to emit them, and the parser has no total to divide by. `spawnFFmpeg`
  now adds `-progress pipe:2` when it is not already in the argv, and
  `concatWithTransitions`, `interpolateFrames`, `cutToScenes` and `removeSilence`
  probe their input and pass the total, so `onProgress` receives real numbers.
- **`mediaforge concat --reencode` reported "Wrote" before the file existed.**
  `concatFiles` resolves once the process is spawned, and the re-encode path (which
  needs the concat filter) was still running. The command now waits for the process
  to finish.
- **`CapabilityRegistry.hasFormat('mp4')` was always false.** The `ffmpeg -formats`
  parser required two adjacent flag characters, so every demux-only (` D `) and
  mux-only (` E`) row was silently dropped — including `mp4`, `matroska` and
  `webm`. The flags are now parsed as padded columns.
- **`mediaforge hwaccel <name> --print` demanded an input and an output.** Printing
  the filter chain is a dry run, so the positional check moved behind it.
- **`FilterGraph.from()` / `.merge()` lost the refs of a previous node.** Passing
  `g.from('0:v').split(2).out('a', 'b')` serialised `[undefined]`; both now spread
  their refs, so the result of `.out(...)` can be handed straight back in.
- **Numeric CLI options were stringified.** `args silence-remove threshold=-40`
  passed `"-40"` to `buildSilenceRemoveFilter`, which correctly rejected it as
  outside the `(-200, 0]` dB range. Numeric options keep their type; string-typed
  options still accept a number, because the CLI coerces `key=2`.
- `coerceValue` only coerces plain decimal numbers, so `0x10`, `1e3` and a padded
  `" 7 "` stay strings.
- **`buildTimestampFilename` produced the wrong name.** It added 1 to the index, so
  asking for frame 6 named frame 7; it stripped a bare `ext` as a literal
  suffix, so `frame_%04d.jpg` + `jpg` came out as `frame_0006..jpg`; and a bare
  `ext` without a dot produced `frame_0006jpg`. The index is now used as given,
  a real extension is stripped, the dot is added when it is missing, and the
  number is padded to the width the placeholder declares (`%03d` → `005`, bare
  `%d` → four digits). A pattern with no `%d` placeholder also gets the
  index now, inserted before the extension (`clip.jpg` + index 9 →
  `clip0009.jpg`); previously it was passed through unchanged, so every frame
  of a `extract-frames` run overwrote the last one. The CLI's
  `args timestamp-filename` follows.
- **`buildWaveformFilter` emitted `[0:a:undefined]`** when called without a stream
  index, because the parameter was required but the arg builder let it be
  omitted. It now defaults to the first audio stream, so a four-argument call
  produces a usable filter.
- `deno check` now covers `lib/`, `deno-tests/` **and** `runtime-tests/`; 78 type
  errors in `deno-tests/battle.test.ts` are fixed (they were real API mismatches —
  `copyStream('v', 0)`, `ss(0, 'a', 1)`, `videoFilterChain()` with no argument,
  `new GraphStream('test', 'unknown')`, `headphones {hrir, size, normalize}`,
  `silencedetect {noise: '-40dB'}`, and more — mirrored into the Node suite too).

### Testing and coverage

- **Library statement coverage is 98.08%** (15,100 / 15,395), up from 80.2%, and
  `npm run coverage:gate` now fails the build below 98% statements / 98%
  functions / 70% branches. The gate runs in CI after `npm run coverage:battle`.
- Four new battle suites close the gap, because the existing ones spawn the built
  binary and so instrument nothing: `gaps.test.ts` (CLI task table driven in
  process against real 2-second clips), `libgaps.test.ts` (concat helpers,
  filter graphs, chains, streaming, the capability registry, the fluent builder),
  `gaps2.test.ts` (guards, hardware filters, progress parsing, metadata, HLS,
  probe internals) and `gaps3.test.ts` (progress callbacks, validation
  branches, process lifecycle, the last parse corners).
- The newly added battle suites dropped the `battle.` filename prefix:
  `battle.newfeatures.test.ts` is now `newfeatures.test.ts`, `battle.cli.test.ts`
  is `cli.test.ts`, and so on. The pre-existing `battle.test.ts` keeps its name.
  The `npm run battle:*` script names are unchanged, so only the filenames moved.
- `npm run check:scripts` fails if any test file on disk is not reachable from
  an `npm run` script or a `deno task` — a suite nobody runs is worse than no
  suite, because it still reads as coverage.
- `npm run battle:all` now runs all eight Node suites; `npm run battle:cov`,
  `:gaps`, `:lib`, `:gaps2` and `:gaps3` run one each. 1,004 assertions in total,
  all in-process for the coverage suites.
- `getSpawnedCount` is documented, `probeVersionAsync` is gone, and the changelog
  and README claim tests (`changelog.claims`, `readme.claims`) pass 62/62 and 38/38.

### Internal notes

- The `lib/cli` task table is a proxy over a lazily merged registry. `tasks.extra.ts`
  imports the library barrel and the barrel re-exports the CLI, so merging the two
  tables at module-evaluation time threw for any caller that entered the cycle
  through `tasks.extra.ts`.
- `check:dead` ignores `coerceValue` with a reason: it is the coercion step of
  `key=value` parsing, exported so the battle suites can assert the primitive
  mapping every arg builder depends on.

### Added — video quality metrics

- `measureQuality({ reference, distorted, metric?, vmaf?, minScore?, binary? })` — measure VMAF, SSIM or PSNR between two encodes, throwing when the result falls below `minScore` so it can be used directly as a CI gate. VMAF needs an ffmpeg built with libvmaf; the error says so explicitly when the filter is missing.
- `buildVmafFilter`, `buildSsimFilter`, `buildPsnrFilter` — the filter strings on their own, for dry runs and unit tests.
- `parseVmafLog`, `parseStatsFile` — decode libvmaf JSON and `stats_file` output into a `QualityScore`.
- A perfect encode scores `Infinity` on PSNR (ffmpeg reports `psnr_avg:inf`); that is carried through as a real result and clears any `minScore`.

### Added — HDR → SDR tone mapping

- `toneMapHdrToSdr({ input, output, algorithm, peak, targetPeak, parameter, desaturation, outputColorSpace, requireHdrInput })` — probes the input, refuses a non-HDR source unless `requireHdrInput: false`, and tags the result as BT.709 so players do not re-apply an HDR display transform.
- `buildToneMapFilter`, `TONE_MAP_ALGORITHMS`, `HDR_SOURCE_PROPERTIES`, `SDR_TARGET_PROPERTIES`.
- `parameter` is rejected on `hable`/`clip`/`spline`, which ignore it.

### Added — temporal editing

- `interpolateFrames` / `buildInterpolateFilter` — motion-compensated frame interpolation (`mci` | `blend` | `dup`) for slow motion and 24 → 60. `mb_size`/`mc_mode` are only emitted for `mci`, because ffmpeg rejects them otherwise.
- `cutToScenes` / `buildSceneCutArgs` — use detected scene changes as an edit decision list. The windows are `[0, s0], [s0, s1], …`; `trimStart` shortens each window from its end.
- `removeSilence` / `buildSilenceRemoveFilter`, and `writeSegments` / `buildSegmentArgs` — the segment muxer now forces keyframes at each boundary and creates the output directory, so a 2 s file with `segmentTime: 1` yields two segments rather than one.

### Added — hardware filter chains

- `buildHwUploadFilter`, `buildHwDownloadFilter`, `buildHwScaleFilter`, `buildHwFilterChain`, `transcodeWithHwFilters`, `HWACCELS` — compose upload → GPU work → download chains so frames cross the bus once.
- `buildHwScaleFilter` throws for accelerations with no GPU scaler (videotoolbox, the D3D/DXVA paths) instead of quietly emitting a software `scale`.
- `buildHwFilterChain` refuses an empty `gpuFilters`, which is always slower than staying in software.

### Added — subtitle conversion

- `convertSubtitles({ input, output, format, streamIndex, shiftSeconds, fixDuration, burn })`, `fixSubtitleDuration`, `subtitleCodecFor`, `subtitleExtensionFor`.
- `burn: true` converts to a temp sidecar, burns it, and removes the temp directory in a `finally` block.

### Added — ABR ladder

- `abrLadder`, `buildAbrLadderArgs`, `buildAbrLadderFilter`, `buildVarStreamMap`, `validateAbrVariants` — a multi-bitrate HLS ladder in one pass via `-var_stream_map`.
- Odd dimensions are rejected up front from every entry point, rather than failing deep inside the encoder.
- `masterPlaylist` is emitted as a bare filename: ffmpeg resolves `-master_pl_name` against the output directory and prepends it even to an absolute path.

### Added — delogo filter

- `delogo({ x, y, width, height, show? })` — dual standalone/chained, with geometry validation.

### Added — encode controls

- `FFmpegBuilder.preset()`, `.profile()`, `.level()`, `.movflags()`, `.keyframeInterval()`, `.fpsMode()`, `.rateControl()`, `.setColorProperties()`.
- `FPS_MODES` and `COLOR_PROPERTY_KEYS` are exported for validation.

### Added — runtime portability suite

- `runtime-tests/battle.ts` runs the whole 2.1.0 feature surface against real ffmpeg on **Node, Deno and Bun** from one source file, by importing `lib/index.ts` directly. Run it with `npm run battle:runtime`, `deno task battle:runtime`, `bun run runtime-tests/battle.ts`, or all three with `npm run battle:runtimes`.
- CI gained a Bun job and a Deno runtime-portability step.
- `deno lint` and the Deno type check now cover `runtime-tests/`.

### Added — quality gates in CI

- `npm run check:dead` (`scripts/check-dead.ts`) subtracts ts-prune's false positives — symbols re-exported through `lib/index.ts`, and helpers imported across modules, which ts-prune cannot resolve because this project uses Deno-style `./x.ts` import specifiers — then fails on anything genuinely dead. `ts-prune.ignore` records the deliberate exceptions.
- `npm run check:types` runs type coverage and the dead-export check together.
- CI enforces both.

### Added — task-oriented CLI

- 31 task commands — `trim`, `speed`, `volume`, `normalize`, `extract`, `replace-audio`, `concat`, `transitions`, `hls`, `abr`, `dash`, `segments`, `chapters`, `metadata`, `thumbnail`, `sprite`, `frames`, `gif`, `watermark`, `text`, `subtitles`, `quality`, `tonemap`, `interpolate`, `silence`, `scenes`, `waveform`, `spectrum`, `delogo`, `twopass`, `to-bitrate` — so the CLI covers the library rather than only re-exposing ffmpeg flags.
- `CLI_TASKS`, `parseTaskArgs`, `taskHelpText` and `taskDetail` are exported from the package index, so the subcommand surface can be inspected and driven programmatically.
- `mediaforge probe` now passes `-show_chapters`, so the chapters `mediaforge chapters` writes are actually visible.

### Fixed

- **`detectScenes` never detected anything** — it filtered stderr for lines containing `scene`, but ffmpeg's `showinfo` never prints the scene score, so the filter always returned `[]`. It now uses `metadata=print`, which emits `lavfi.scene_score` for each selected frame, and `cutToScenes` works as a result. The existing test only asserted the return *type*, which is why this went unnoticed.
- **`fpsMode()` broke every encode on ffmpeg < 5.1** — it always emitted `-fps_mode`, which does not exist before 5.1 (`Unrecognized option 'fps_mode'`). The flag is now chosen from the probed version: `-vsync` below 5.1, `-fps_mode` from 5.1 on. `fpsMode()` also rejects unknown modes.
- **`concatFiles({ copy: true })` always failed** — it combined `-filter_complex` with `-c copy`, and ffmpeg rejects stream copy through a filtergraph with "Filtering and streamcopy cannot be used together". Copy mode now goes through the concat demuxer, and falls back to re-encoding when the inputs are not stream-compatible.
- **`concatWithTransitions` failed with its own defaults** — the default transition was `'crossfade'`, which is not a value ffmpeg's `xfade` filter accepts (`Error setting option transition to value crossfade`). The default is now `'fade'`, and `crossfade`/`xfade` were removed from `TransitionType`.
- **`mediaforge thumbnail out.jpg` wrote a PNG** — `frameToBuffer` defaults to PNG, so the file content did not match its extension. The format now comes from `--format` or the output extension.
- **`mediaforge tonemap --force` did the opposite of what it says** — it was wired to `requireHdrInput`, so `--force` made the HDR check *stricter* and the flag was unusable on SDR input. It now passes `requireHdrInput: !force`.
- **The CLI silently ignored misspelled task flags** — `mediaforge trim --star 1` ran with defaults and exited 0. Unknown flags are now a hard error listing the valid ones.
- **`taskDetail('typo')` returned an empty string** — `mediaforge help <typo>` printed nothing at all, reading like a success. It now explains the unknown command and points at the task list.
- **`rateControl()` accepted no `max`** — it emitted `-maxrate undefined`. `max` is now required, and `bufferSize` defaults to `max` because VBV needs a buffer to look at.
- **`setColorProperties({})` silently did nothing** — it now throws, like it already did for unknown keys.
- **Two dead exports removed** — `getSpawnedCount()` and `probeVersionAsync()` were exported from their modules but never called and never re-exported from the package index, so they were unreachable dead code. `check:dead` is now wired into CI so this cannot recur.
- **Task usage lines omitted their own flags** — all 31 now list every flag they declare, and a test keeps them in sync.
- **`writeSegments` did not create its output directory** — a pattern like `out/seg%03d.ts` failed unless the directory already existed.

## [2.0.0]

### Breaking Changes

- **`concatFiles` is now `async`** — it probes each input for audio presence to avoid invalid filtergraph labels. Call sites must `await concatFiles({...})`.
- **`setStreamMetadata` signature changed** — added `fileIndex` as the first parameter: `setStreamMetadata(fileIndex, type, streamIndex, key, value)`. Old call sites passing `(type, streamIndex, key, value)` will produce wrong metadata keys.
- **`ffv1ToArgs` option `version` → `level`** — the option was renamed to match the emitted `-level` flag. Pass `{ level: 3 }` instead of `{ version: 3 }`.
- **`mapStream(fileIndex, type, streamIndex)` now returns an args tuple** — the numeric convenience form had no overload declaration and returned a **bare specifier string** (`'0:v:0'`) while the `StreamSpecifier`/string form returned `['-map', '0:v:0']`. That asymmetry made it impossible to `...mapStream(0, 'v', 0)` into an argument list. Both forms now return `['-map', spec]`: `mapStream(0, 'v', 0) // → ['-map', '0:v:0']`. Call sites that treated the result as a string (`.map(mapStream(0,'v',0))`, `args.push(mapStream(0,'v',0))`) must switch to `...mapStream(0,'v',0)`.
- **`satisfiesVersion` now requires full `VersionInfo`** — callers passing `{ major, minor }` only will get a type error; pass the full object returned by `parseVersionOutput` or `probeVersion`.

### Fixed

- **#1 ffprobe error visibility** — `buildProbeArgs` now uses `-v error` instead of `-v quiet`, so probe failures surface meaningful error messages instead of empty `ProbeError.detail` strings.
- **#2 FFmpegSpawnError.stderrOutput** — wired `captureStderr().stderrLines` into `FFmpegSpawnError` so spawn failures include ffmpeg diagnostics in `err.stderrOutput`.
- **#3 Double error event on timeout** — added a `settled` flag in `spawnFFmpeg` so the timeout handler and the process `close` handler emit exactly one `'error'` event instead of two.
- **#4 HLS segment extension** — `hlsPackage` and `adaptiveHls` already defaulted to `.ts` extensions; confirmed no regression.
- **#5 concatFiles audio-less inputs** — `concatFiles` now probes each input for audio presence and uses `[i:v][i:a]` when audio exists or a synthetic `anullsrc=channel_layout=stereo:sample_rate=44100[a${i}]` source when it does not, eliminating invalid `[i:a?]` filtergraph labels. The silent track is generated as a standalone source (not `[i:v]anullsrc[...]`, which is invalid syntax because `anullsrc` is a source filter and takes no input).
- **#6 setStreamMetadata signature** — added the missing `fileIndex` first parameter to match JSDoc; all call sites updated.
- **#7 mapStream numeric overload** — the three-argument convenience form is now declared in the public type signature as `mapStream(fileIndex: number, type?: MediaTypeChar, streamIndex?: number): ['-map', string]`, and it returns the same `['-map', spec]` tuple as the `StreamSpecifier`/string form. The two forms are now interchangeable; see the Breaking Changes note above for migrating old call sites.
- **#8 streams.ts stderr snapshot** — `pipeThrough`, `streamOutput`, and `streamToFile` now keep the `captureStderr` reference and read `stderrLines` at error time, fixing empty stderr in `FFmpegSpawnError`.
- **#9 Builder timeout forwarding** — `FFmpegBuilder.run()` and `.spawn()` now accept an optional `timeout` option and forward it to the spawn layer.
- **#10 Registry stale cache** — `CapabilityRegistry.invalidate()` now clears `_encoders` in addition to the other caches, preventing stale encoder data after `setBinary()`.
- **#11 mergeToFile mkdir** — the single-input fast path now creates the output directory with `mkdirSync({ recursive: true })` before copying.
- **#12 concatWithTransitions duplicate filtergraph labels** — the xfade chain wrote its result over the scale/pad label of the next input (`[v0][v1]xfade=…[v1]` while `[1:v]scale=…[v1]` had already defined it), which makes ffmpeg abort with `Output with label 'v1' does not exist in any defined filter graph, or was already used elsewhere` (exit code 234). Both `concatWithTransitions` and `buildConcatTransitionArgs` now keep the per-input scale/pad labels `v{i}` and write xfade results to a separate `x{i}` namespace, mapping the final `[x{n-1}]`. Audio already used the same separated scheme (`a{i}` → `atmp{i}` → `outa`). See also #51.
- **#13 Two-pass consistency** — `buildTwoPassArgs` now mirrors `twoPassEncode` exactly: uses a unique per-job temp directory, always includes `-an` in pass 1, and handles `audioCodec: 'none'` consistently in both functions.
- **#14 drawtext %{...} expansion** — added `escapeDrawtextValue()` that preserves `%{pts_hms}`-style expressions while still escaping backslashes, quotes, and other drawtext special characters. `burnTimecode` and `buildBurnTimecodeFilter` now use it.
- **#15 satisfiesVersion patch comparison** — full semver comparison now includes the patch component, and Git/nightly builds are treated as "unknown" by `satisfiesVersion` (they pass only when `minMajor`/`minMinor`/`minPatch` are all 0). `parseVersionOutput` still records `999.999.999` for such builds: that sentinel is what makes `isFeatureExpected` — and therefore `guardFeatureVersion` and `checkFeature` — pass on nightly builds, which ship the newest features.
- **#16 Negative progress percentage** — `buildProgress` now clamps `percent` to `[0, 100]` to handle negative `out_time_us` sentinels emitted by ffmpeg before the first frame.
- **#17 autoKillOnExit signal handling** — the SIGINT/SIGTERM handler now re-raises the signal after cleanup so Node.js retains its default exit behavior.
- **#18 normalizeAudio one-pass mode** — when `twoPass: false` the returned `NormalizeResult` now reports `NaN` for the measured fields instead of fabricating `inputI = targetI`. The values are genuinely unknown in single-pass mode (the source is never analysed), and `NaN` propagates honestly rather than being forced through `as unknown as number` casts on `null`.
- **#19 VideoToolbox allowFrameReordering** — removed the incorrect `-realtime` mapping; `allowFrameReordering` is no longer emitted since ffmpeg's videotoolbox does not expose a direct flag for it.
- **#20 mp3ToArgs -abr** — removed the undocumented `-abr` flag from `mp3ToArgs`; ABR is selected via `-b:a` instead.
- **#21 watermark copy filter** — replaced the `copy` filter (requires ffmpeg ≥ 4.3) with `format=rgba` as the default no-op transform in watermark pipelines.
- **#22 waveform hex colors** — `generateWaveform` now strips the leading `#` from hex colors before passing to `showwavespic` for broader compatibility.
- **#23 ffv1ToArgs option rename** — renamed the `version` option to `level` to match the actual emitted `-level` flag and reduce confusion.

### Fixed — streaming & process lifecycle

- **#24 `streamOutput` stderr deadlock** — `streamOutput` piped stderr but never read it. Once the 64 KB OS pipe buffer filled, ffmpeg blocked on write and the transcode hung forever. stderr is now drained into a bounded 8 KB tail used for diagnostics. A 4000-line (~300 KB) stderr run now completes in ~40 ms.
- **#25 `streamOutput` reported failures as success** — the internal `PassThrough` emitted `end` when the child's stdout drained, which happens before the child's `close` event, so a non-zero exit surfaced as a clean success. stdout is now piped with `{ end: false }` and `end()` is deferred to the `close` handler, so failures reliably emit an `FFmpegSpawnError` (with the captured stderr attached).
- **#26 `streamOutput` orphaned ffmpeg processes** — destroying or closing the returned stream did not kill the child. The stream's `close` event now terminates a still-running child.
- **#27 `'start'` event was unobservable** — `spawnFFmpeg` and `pipeThrough` emitted `'start'` synchronously, before the caller could attach a listener. Both now emit on a microtask so `proc.emitter.on('start', ...)` actually fires.
- **#28 stderr reader leak on timeout and spawn error** — the `close` handler early-returns once `settled` is set, so the timeout and `'error'` paths never called `captureStderr().close()`, leaking the readline interface and its stream listeners. stderr is now released exactly once on every exit path.
- **#29 `pipeThrough` double terminal event** — `'error'` is always followed by `'close'`, which emitted a second `end`/`error` on the same emitter. A `settled` guard now guarantees exactly one terminal event.
- **#30 `streamToFile` double settle and file-descriptor leak** — both code paths could resolve/reject twice, and the temp-buffer error paths removed the temp directory without destroying the write stream, leaving the fd open and pending writes pointed at a deleted path. The write stream is now destroyed before cleanup and both paths are guarded.

### Fixed — memory & resource leaks

- **#31 unbounded child-tracking leak** — `trackChild` appended every child to a module-level array and never removed it, so a long-running process leaked one entry per encode and `getSpawnedCount()` scanned the whole history. Tracking is now a `Set` of live children, pruned on `close`/`exit`; `killAllFFmpeg` iterates a snapshot because killing can mutate the set synchronously.
- **#32 `autoKillOnExit` leaked signal listeners** — the handler was registered with `process.once` but removed with `process.off`, which only removes one registration, so repeated calls left orphaned SIGINT/SIGTERM handlers behind. Now registered with `process.on` and removed with `removeListener`.
- **#33 `buildTwoPassArgs` leaked a temp directory** — the dry-run arg builder called `mkdtempSync` on every invocation and never cleaned up. The directory is now documented as intentionally retained (the returned `passlog` path must stay valid for a manual run) and callers that do not run the passes are told to remove it.
- **#34 `writeMetadata` leaked a temp directory on failure** — the chapter file was written outside the `try` block, so a write failure left the temp dir behind. It is now cleaned up on error.
- **#35 unbounded progress block** — if ffmpeg never emitted `progress=`, every `key=value` stderr line accumulated in the parser for the life of the process. The block is now capped at 64 keys.
- **#36 `CapabilityRegistry` could block forever** — the internal `spawnSync` had no timeout, so a wedged binary would hang the event loop indefinitely. It now has a 15 s timeout, a `SIGKILL` kill signal, and a 32 MB output cap.

### Fixed — correctness

- **#37 `probeAsync` never settled on success** — the success path left `settled` false and never cleared the timeout, so a completed probe left a live timer that later killed an already-reaped child. Both paths now settle exactly once and clear the timer.
- **#38 `probeVersionAsync` could exit before resolving** — the child was `unref()`'d immediately after spawn while the function was waiting for its `close` event, so the process could exit with the promise unsettled; the timeout was meanwhile *not* unref'd, so it alone held the loop open. The child now stays referenced and only the timer is unref'd.
- **#39 `getDefaultRegistry` ignored its `binary` argument** — a single cached instance was returned for every call after the first, handing back capabilities probed from a different binary. Registries are now cached per binary path.
- **#40 `ProgressInfo` fields could be `NaN`** — `parseInt`/`parseFloat` on ffmpeg's `N/A` sentinels produced `NaN` for `frame`, `fps`, `outTimeUs`, `dupFrames` and `dropFrames`, and `NaN` propagated into `percent` and any downstream arithmetic. `N/A` and unparsable values now normalise to `0`.
- **#41 `parseFrameRate` returned `NaN` values** — `"1/abc"` produced `{ num: 1, den: NaN, value: NaN }` instead of `null`. Non-finite components and `N/A` are now rejected; `summarizeAudioStream` likewise guards a non-numeric `sample_rate`.
- **#42 `extractJsonBlock` was quadratic** — it attempted a `JSON.parse` for every `{`…`}` candidate, which became a CPU sink on large stderr dumps (e.g. `loudnorm` over a long file). Replaced with a single-pass brace matcher that is string- and escape-aware.
- **#43 multi-byte UTF-8 corruption in child stdout** — `chunk.toString()` per chunk splits characters that straddle chunk boundaries, corrupting non-ASCII metadata and titles. `probeAsync` and `probeVersionAsync` now reassemble the byte stream with `StringDecoder`.
- **#44 `isBinaryAvailableAsync` could reject** — `spawn()` throws synchronously on invalid input (e.g. an embedded NUL), but the signature promises `Promise<boolean>`. It now resolves `false` instead, and the timeout path no longer aborts and kills redundantly.
- **#45 `trimVideo` emitted a negative duration** — `end <= start` produced `-t <negative>`, which ffmpeg rejects with an opaque error. Now validated with a clear message.
- **#46 `stackVideos` built `amix` from optional pads** — `[i:a?]` pads are dropped by ffmpeg, so `amix=inputs=N` could receive fewer inputs than declared, and when no input had audio the `[audio]` label was never created. Inputs are now probed first and the audio graph is only added when at least one input has audio (otherwise `-an` is used).
- **#47 `adaptiveHls` accepted malformed resolutions** — `Number('')` is `0`, not `NaN`, so `"1920x"` passed validation and emitted `scale=1920:0`. Empty, non-finite and non-positive dimensions are now rejected, and an empty `variants` array (which produced an invalid `split=0`) throws.

### Security

- **#48 chapter title injection (FFMETADATA)** — chapter titles were interpolated into the generated `FFMETADATA1` file unescaped, so a title containing a newline could inject arbitrary metadata keys and `[CHAPTER]` sections into the output. Backslashes are escaped, newlines are flattened to spaces, and leading `#`/`;` comment markers are neutralised.
- **#49 `burnTimecode` font path injection** — the font file path was interpolated into the `drawtext` filter unescaped, so a path containing a quote broke out of the filter option. It now uses `escapeDrawtextValue`, matching what `buildBurnTimecodeFilter` already did.
- **#50 `concatFiles` probed with the wrong binary** — the ffmpeg binary was passed where the *ffprobe* binary is expected, so every probe failed silently and audio was always assumed present (defeating #5). It now resolves `resolveProbe()`.
- **#51 Transition filtergraph ended with a stray `;`** — `concatWithTransitions` and `buildConcatTransitionArgs` terminated every `-filter_complex` link with `;`, leaving an empty trailing filterchain. ffmpeg 5+ tolerates it, but ffmpeg 4.x (still shipped by Ubuntu 20.04/22.04 and most distro packages) parses the empty chain as a filter with an empty name and aborts with `No such filter: ''` (exit code 1). Both now build the graph through a shared `buildTransitionGraph` helper that joins links instead of terminating them, which also removed the duplicated graph-building code.

- **#52 `scripts/build.ts` silently corrupted HLS segment extensions** — the build copied `lib/` to a temp directory and ran a global `sed "s/\.ts'/.js'/g"` over every source file to rewrite `.ts` import specifiers for the ESM/CJS output. That rewrote *any* string ending in `.ts`, not just import paths, so `hls.ts`'s `segmentFilename = 'segment%03d.ts'` and `segmentPattern = '%v_seg%03d.ts'` shipped as `.js` in the published package. The result was that npm/Deno consumers got `.js`-named HLS segments while source consumers (and the whole test suite, which imports from source) got `.ts` — the library behaved differently depending on how it was loaded. The temp-copy-and-`sed` step is gone entirely; both build targets now use TypeScript's native `rewriteRelativeImportExtensions` (with `allowImportingTsExtensions`), which rewrites import specifiers in the emitted output and cannot touch string literals.
- **#53 `hlsPackage` wrote nothing and reported success** — neither ffmpeg's `hls` muxer nor `dashPackage`'s muxer creates the output directory. If `outputDir` did not exist, ffmpeg's HLS muxer **exited 0 and produced no files at all**, so `hlsPackage(...).run()` silently did nothing. `hlsPackage` now creates the output directory (and `dashPackage` the manifest's parent) up front, matching `adaptiveHls`. The battle tests had pre-created the directory themselves, which is why this was never caught.
- **#54 `hlsVersion` was accepted but never emitted** — the option was documented as non-existent while real callers (including both battle tests) passed it, and it was silently dropped. `hlsPackage` now emits `-hls_version` and validates it as an integer in 3–8. Note it is a top-level muxer option: `hlsFlags: 'hls_version=3'` makes ffmpeg abort with `Unable to parse option value "hls_version=3"`.
- **#55 `showspectrum` colour accepted CSS colours it cannot parse** — `generateSpectrum`/`buildSpectrumFilter` typed `color` as a free `string` and passed it to the `showspectrum` filter, whose `color` option is an integer enum of named palettes. Any CSS colour (`'red'`, `'#ff0000'`) made ffmpeg fail with `Undefined constant or missing '(' in 'red'`. The option is now typed `SpectrumColor` and validated against the exported `SPECTRUM_COLORS` list, with an error that names the valid palettes. (`generateWaveform`'s colour genuinely *is* a CSS colour and is unchanged — the two are easy to confuse.)
- **#56 `buildLoudnormFilter` emitted `offset=undefined`** — the `measured` parameter required a `targetOffset` field that `parseLoudnorm()` never returns, so the obvious composition `buildLoudnormFilter(-16, 11, -1.5, await parseLoudnorm(...))` was a type error, and forcing it at runtime produced `offset=undefined`, which ffmpeg rejects. `targetOffset` is now optional and `offset=` is omitted when absent. Both the camelCase `EbuR128Result` shape and the snake_case spelling ffmpeg prints (`input_i`, `input_lra`, …) are accepted, and unusable values raise a clear error instead of silently emitting `undefined`.
- **#57 `addChapters` accepted unusable chapter definitions** — a missing or misspelled start key silently wrote `START=NaN` (chapters then all read back as `0`), and out-of-order chapters made ffmpeg fail with `Chapter end time 1000 before start 2000` / `Cannot allocate memory`. `addChapters` now resolves `start` (or the `startSec` alias, matching `ChapterMeta`) and validates that every start is a finite non-negative number and that chapters are in ascending order. Empty lists and blank titles are rejected too.
- **#58 `formatDuration` emitted garbage for invalid input** — negative values produced `"-1:-1:-5.000"`, and `NaN`/`Infinity` produced `"NaN:NaN:000NaN"`. It now throws a `RangeError` for non-finite or negative input.
- **#59 `parseDuration` could not read clock notation** — despite the name it only handled a plain seconds string, so `"00:01:30.5"` parsed as `0` and `"1:30"` as `1`. It now accepts both forms ffmpeg emits: JSON seconds (`"120.042000"`) and text clock notation (`"00:02:00.042"`, `"2:00"`, `"-5"`), still returning `null` for absent/`'N/A'`/junk input.
- **#60 `parseFrameRate` accepted negative rates** — `"-30/1"` returned `{ value: -30 }`, which is not a usable frame rate. Negative numerators now return `null`.

### Known limitations

- **`hlsVersion` requires ffmpeg 5 or newer.** `-hls_version` does not exist in the HLS muxer of ffmpeg 4.x (e.g. Ubuntu 20.04/22.04). Passing `hlsVersion` to `hlsPackage` on such a build makes ffmpeg exit non-zero with `Unrecognized option 'hls_version'`. Omit the option on ffmpeg 4.x and let ffmpeg choose.
- **`VideoToolboxOptions.allowFrameReordering` is accepted but ignored.** FFmpeg's `videotoolbox` encoder exposes no direct flag for it, so the option is never emitted (see #19). It remains in the public type for backwards compatibility; passing it has no effect.
- **An unhandled `'error'` event throws.** `FFmpegEmitter` extends `EventEmitter`, so emitting `'error'` with no attached listener raises an uncaught exception. Always attach an `'error'` listener to the emitter returned by `spawnFFmpeg()`, `pipeThrough()` and `concatFiles()`. `FFmpegEmitter` sets `captureRejections: true`, which handles rejected listener promises but does *not* suppress the unhandled-`'error'` throw.

### Documentation

The README was audited line-by-line against the source and every claim was verified by executing the library. **32 defects** were corrected:

- **Non-functional examples.** `extractFrames({ pattern, quality })` (neither option exists — it is `filename`/`format`), `detectSilence({ noiseLevel, silenceOnly })` plus the wrong `silence.startTimes` return shape, `parseLoudnorm({ measures })` returning `{ normalized }`, `addChapters({ startSec, endSec })` (that shape belongs to `writeMetadata`; `addChapters` takes `{ title, start }`), and `videoFilterChain('scale=1280:720')` — the factory takes no arguments, so the filter string was silently discarded and `toString()` returned `""`.
- **Filter overloads were documented backwards.** The README claimed "all filter functions work in two modes". In fact only 8 of 26 audio filters and 10 of 50 video filters are dual-style; the rest require a `FilterChain` as their first argument and throw a `TypeError` otherwise. Examples such as `highpass({ frequency: 80 })`, `dynaudnorm()` and `compand()` crashed. Both sections now carry verified dual/chained tables.
- **Repeated `.videoFilter()`/`.audioFilter()` calls.** Each call appends another `-vf`/`-af` pair and FFmpeg only honours the last, so several documented examples silently dropped filters. Now documented as an explicit footgun.
- **Wrong factual claims corrected:** the fabricated `hlsVersion` option; `generateWaveform`'s `backgroundColor`/`mode` being described as "emitted when non-default" when they are deprecated no-ops; `ss(0,'a','eng')` documented as a language selector; `mapAVS` missing its optional `0:s?` pad; `buildLoudnormFilter` shown in uppercase when it emits lowercase keys; `buildScreenshotArgs` shown with the wrong flag order; `resetLabelCounter` described as functional when it is a deprecated no-op; `streamToUrl`'s `format` described as required when it is inferred from the URL scheme; and "75 built-in filters" when the real count is 76.
- **`levels()` mis-described.** It was documented as FFmpeg 7.x's `levels` filter, but it is a deprecated alias for `colorlevels`, which exists in FFmpeg 6 and 7.
- **New coverage added:** 15 previously undocumented builder methods; the full CLI surface (5 of ~20 flags were documented); 14 Table-of-Contents entries; corrected Deno permissions; and repaired malformed markdown in the codec-serializer tables.
- **`tests/unit/readme.claims.test.ts`** (38 assertions) locks every documented claim to the source, so the docs cannot drift again. It also verifies that all 76 exported filters appear in the inventory, that no markdown table is ragged, that every TOC link resolves, and that every public builder method is documented.

---

## [0.3.0]

### Added

#### New analysis helpers (`src/helpers/normalize.ts`)

| Helper | Description |
|--------|-------------|
| `detectSilence(opts)` | Parse `silencedetect` filter output into structured timestamp arrays |
| `detectScenes(opts)` | Scene change detection using `select` filter + `showinfo` metadata |
| `cropDetect(opts)` | Letterbox/pillarbox detection helper; returns crop detection results |
| `burnTimecode(opts)` | Draw timecode using `drawtext` with timecode expression |
| `parseLoudnorm(opts)` | Parse EBU R128 loudnorm output with integrated/loudness/dynamic metadata |

#### New export helpers (`src/helpers/screenshots.ts`)

| Helper | Description |
|--------|-------------|
| `extractFrames(opts)` | Export all frames as images with fps control and filename templating |

#### New concat features (`src/helpers/concat.ts`)

| Helper | Description |
|--------|-------------|
| `concatWithTransitions(opts)` | Concatenate video clips with crossfade/xfade transitions between them |

#### New metadata helpers (`src/helpers/metadata.ts`)

| Helper | Description |
|--------|-------------|
| `addChapters(opts)` | Convenience wrapper over `writeMetadata` for chapter timestamps |

#### New video filters (`src/filters/video/index.ts`)

| Filter | FFmpeg filter | Notes |
|--------|--------------|-------|
| `drawbox(chain, opts?)` | `drawbox` | Draw colored boxes/frames on video |
| `drawgrid(chain, opts?)` | `drawgrid` | Draw a grid overlay |
| `vignette(chain, opts?)` | `vignette` | Apply vignette effect |
| `vaguedenoiser(chain, opts?)` | `vaguedenoiser` | Wavelet-based denoising |

#### New audio filters (`src/filters/audio/index.ts`)

| Filter | FFmpeg filter | Notes |
|--------|--------------|-------|
| `headphones(chain, opts?)` | `headphones` | Virtual headphone Surround sound from stereo |
| `sofalizer(chain, opts?)` | `sofalizer` | SOFA file-based 3D audio virtualization |

#### FFmpegBuilder improvements

- `FFmpegBuilder.dry()` - Return CLI arguments without executing (for debugging/preview)
- `FFmpegBuilder.dryCommand()` - Return CLI string without executing

#### Battle test additions

- Section 28: New helpers (extractFrames, concatWithTransitions, detectSilence, detectScenes, cropDetect, burnTimecode, parseLoudnorm)
- Section 29: New video filters (drawbox, drawgrid, vignette, vaguedenoiser)
- Section 30: New audio filters (headphones, sofalizer)
- Section 31: FFmpegBuilder.dry() and dryCommand()

### Not implemented (deferred to future releases)

- **Browser/edge runtime compatibility** — fetch-based ffprobe, no child_process. Requires significant refactoring of process spawning layer.
- **Plugin/middleware system** — for custom filters. Requires design work for safe extensibility.

### Fixed

- Lint warning: unused `formatVersion` variable in FFmpegBuilder
- **`cropDetect`** — `cropdetect` filter used invalid option `reset_count` (removed in FFmpeg 7+). Filter is now `cropdetect=limit=24:round=2` which works on FFmpeg 6, 7, and 8.
- **`concatWithTransitions`** — `scale=iw` is not a valid FFmpeg filter size when no resolution specified. Changed to `scale=iw:ih` (no-op passthrough) when `resolution` option is omitted.
- **`aacToArgs`** — added missing `profile` option (`-profile:a`) to `AacOptions` interface (`aac_low`, `aac_he`, `aac_he_v2`, `aac_ld`, `aac_eld`).
- **`vp9ToArgs`** — added missing `deadline` option (`-deadline`) to `Vp9Options` interface (`best`, `good`, `realtime`).
- **`truehdToArgs`** — `profile` option was incorrectly inserted into `TruehdOptions` (TypeScript error: property does not exist). Removed.
- **README** — `detectScenes` docs referenced non-existent `minFrames` option and `scenes.timestamps` property. Fixed to match actual API: `SceneChange[]` with `{timestamp, sceneNumber}`.
- **README** — `detectSilence` docs used `minDuration` which does not exist; correct option is `duration`.
- **README** — filter count corrected from 54 to 75 (49 video + 26 audio).
- **README** — `drawbox`, `drawgrid`, `vignette`, `vaguedenoiser` incorrectly documented as chain-only (❌ standalone); all four have standalone overloads (✅).
- **Battle tests** — comprehensive real-FFmpeg test suite covering all 286 exports (559 Node.js tests, 422 Deno tests). Previous tests only verified exports existed.

---

## [0.3.0-rc.1]

### Added

#### High-level edit helpers (`src/helpers/edit.ts`)

13 new production-ready helpers covering the most common post-production tasks:

| Helper | Description |
|--------|-------------|
| `trimVideo(opts)` | Cut a video by time range — instant stream copy (default) or frame-accurate re-encode |
| `changeSpeed(opts)` | Change playback speed with pitch-corrected audio; chains multiple `atempo` filters for values outside 0.5–2.0 |
| `buildAtempoChain(speed)` | Build a chained atempo filter string for any speed value (exported utility) |
| `extractAudio(opts)` | Extract audio from any video/audio file; auto-detects codec from output extension |
| `replaceAudio(opts)` | Swap or add an audio track to a video |
| `mixAudio(opts)` | Combine multiple audio inputs with per-track volume weights via `amix` |
| `loopVideo(opts)` | Loop a video N times (`-stream_loop`); supports duration cap and infinite loop |
| `deinterlace(opts)` | Deinterlace using `yadif` with configurable mode/parity/deint settings |
| `cropToRatio(opts)` | Center-crop to a target aspect ratio (`16:9`, `1:1`, `9:16`, etc.) without probing |
| `stackVideos(opts)` | Stack 2+ videos side-by-side (`hstack`), top-to-bottom (`vstack`), or in a grid (`xstack`) |
| `generateSprite(opts)` | Generate a thumbnail sprite sheet for video-player seek previews |
| `applyLUT(opts)` | Apply a `.cube` or `.3dl` 3D LUT colour grade via `lut3d` filter |
| `stabilizeVideo(opts)` | Two-pass video stabilization using `vidstabdetect` + `vidstabtransform` |
| `streamToUrl(opts)` | Push a file to an RTMP, SRT, UDP, or RTP destination; auto-detects container format |

#### New video filters

| Filter | FFmpeg filter | Notes |
|--------|--------------|-------|
| `curves(opts)` | `curves` | Tone curve adjustment; supports named presets and custom R/G/B curves. Standalone + chained |
| `levels(opts)` | `levels` | Input/output range + gamma adjustment. Standalone + chained |
| `deband(chain, opts?)` | `deband` | Remove banding artifacts from flat regions |
| `deshake(chain, opts?)` | `deshake` | Camera shake stabilization (no library required) |
| `deflicker(chain, opts?)` | `deflicker` | Reduce temporal flicker (time-lapses, broadcast) |
| `smartblur(chain, opts?)` | `smartblur` | Edge-preserving smoothing |
| `hstack(chain, n)` | `hstack` | Stack N videos horizontally |
| `vstack(chain, n)` | `vstack` | Stack N videos vertically |
| `xstack(chain, opts)` | `xstack` | Arrange N videos in a custom grid layout |
| `colorSource(chain, opts?)` | `color` | Solid colour source frame |

#### New hardware codec helpers

| Helper | Encoder | Platform |
|--------|---------|----------|
| `amfToArgs(opts, codec?)` | `h264_amf`, `hevc_amf`, `av1_amf` | AMD GPUs (Windows/Linux via libamf) |
| `videotoolboxToArgs(opts, codec?)` | `h264_videotoolbox`, `hevc_videotoolbox` | Apple macOS/iOS hardware encoder |

#### Battle test: sections 25–27 (node) / sections 21–23 (deno)

Node battle test extended with 22 new integration tests (sections 25–27). Deno battle test extended with 34 new integration tests (sections 21–23) importing directly from `lib/`.

---

## [0.2.0]

### Breaking Changes

#### `buildWaveformFilter` — `draw` and `backgroundColor` parameters are now no-ops

**Affects:** `buildWaveformFilter(width, height, color, scale, mode, streamIndex, backgroundColor?)` and `generateWaveform({ mode, backgroundColor })`.

FFmpeg 7.x completely removed the `bgcolor` and `draw` options from `showwavespic`. Passing them causes an immediate error. Both parameters are now silently ignored — the `mode` argument and `backgroundColor` option are accepted for API compatibility but have no effect on the generated filter string.

If your code relied on `draw=point` or `draw=p2p` modes for waveform rendering, you will need to use the `showwaves` filter (which still supports these modes) via `ffmpeg().complexFilter()` directly.

Tests that asserted `f.includes('draw=p2p')` have been updated to assert `!f.includes('draw=')`.

---



#### Typed codec serializers — video (8 new helpers)

Previously the library had typed helpers for only 4 video encoders (libx264, libx265, libsvtav1, libvpx-vp9).
Both FFmpeg v7 and v8 ship all of the following on every tested platform.

| Helper | Encoder string | Use case |
|--------|----------------|----------|
| `proResToArgs(opts?, encoder?)` | `prores_ks`, `prores_aw`, `prores` | Apple ProRes — professional mastering |
| `dnxhdToArgs(opts?)` | `dnxhd` | Avid DNxHD/DNxHR — Avid workflows |
| `mjpegToArgs(opts?)` | `mjpeg` | Motion JPEG — frame editing, surveillance |
| `mpeg2ToArgs(opts?)` | `mpeg2video` | MPEG-2 — broadcast/DVD/Blu-ray |
| `mpeg4ToArgs(opts?, encoder?)` | `mpeg4`, `libxvid` | MPEG-4 Part 2 — legacy wide compat |
| `vp8ToArgs(opts?)` | `libvpx` | VP8 — WebM, WebRTC |
| `theoraToArgs(opts?)` | `libtheora` | Ogg Theora — patent-free |
| `ffv1ToArgs(opts?)` | `ffv1` | FFV1 — lossless archival |

All functions are exported from the top-level package and fully documented with TypeDoc.

#### Typed codec serializers — audio (7 new helpers)

| Helper | Encoder string | Use case |
|--------|----------------|----------|
| `alacToArgs(opts?)` | `alac` | Apple Lossless — Apple ecosystem |
| `eac3ToArgs(opts?)` | `eac3` | Dolby Digital Plus — Netflix/Amazon |
| `truehdToArgs(opts?)` | `truehd` | Dolby TrueHD — Blu-ray lossless |
| `vorbisToArgs(opts?)` | `libvorbis` | Ogg Vorbis — open/patent-free |
| `wavpackToArgs(opts?)` | `wavpack` | WavPack — hybrid lossless |
| `pcmToArgs(format, opts?)` | `pcm_s16le`, `pcm_s24le`, `pcm_f32le`, … | Raw PCM — WAV masters, 16 variants |
| `mp2ToArgs(opts?)` | `mp2` | MPEG Audio Layer 2 — DVB broadcast |

#### Typed codec serializers — hardware (2 new helpers)

| Helper | Codec strings | Platform |
|--------|--------------|----------|
| `mediacodecVideoToArgs(opts, codec?)` | `h264_mediacodec`, `hevc_mediacodec`, `av1_mediacodec`, `mpeg4_mediacodec`, `vp8_mediacodec`, `vp9_mediacodec` | Android (FFmpeg v8 / Termux) |
| `vulkanVideoToArgs(opts, codec?)` | `h264_vulkan`, `hevc_vulkan`, `av1_vulkan`, `ffv1_vulkan`, `prores_ks_vulkan` | Linux + Android Vulkan |

#### Battle test suite (`battle.test.mjs`)

The external battle test that covers every documented export has been incorporated into the repository root. Run with `npm run battle`. The suite also covers all 22 new codec helpers added in this release.

#### Coverage tests

Unit test coverage added for all 17 new codec serializers in `tests/unit/codecs/codecs.serializers.test.ts`.

### Fixed (runtime — discovered during battle test)

- **`CapabilityRegistry.hasCodec` returned false for encoder names** — `ffmpeg -codecs` lists codec *family* names (`h264`, `mp3`) while users pass individual *encoder* names (`libx264`, `h264_nvenc`, `libmp3lame`) to `-c:v`/`-c:a`. The `guardCodec` function calls `hasCodec` first; when it returned false, `canEncode` was never reached and every encoder-named codec was marked unavailable. Fixed by: (1) parsing the `(encoders: libx264 h264_nvenc ...)` parenthetical from `ffmpeg -codecs` output into an encoder name set, and (2) making `hasCodec` check both the codec-family map and the encoder-name set. `selectVideoCodec`/`selectBestCodec` now correctly resolve `libx264` and all other encoder-named codecs. **This also fixes `checkCodec('libx264', 'encode')` returning `available: false`.**

- **`streamToFile`** — added `-fflags +genpts` alongside `-analyzeduration 100M -probesize 100M` for better frame timestamp recovery when piping non-faststart MP4 files
- **`adaptiveHls`** — now calls `mkdirSync` on each variant subdirectory before running FFmpeg; FFmpeg silently fails if output dirs do not exist
- **`dashPackage`** — removed `min_buffer_time`, `use_template`, `use_timeline`; all removed from FFmpeg DASH muxer in v7.x
- **`parseFrameRate`** — return type changed from `ParsedFrameRate | null` (`{num,den,value}` object) to `number | null`. `ParsedFrameRate` is now a `type` alias for `number` (**breaking**: code accessing `.value`/`.num`/`.den` must use the value directly)
- **`selectBestCodec`** — now returns the last no-`featureKey` candidate as software fallback instead of `null`, so `selectVideoCodec` always resolves to a string on any machine
- **`mapStream(fileIndex, type, streamIndex?)`** — new three-argument overload added; original single-argument tuple form unchanged. (In 2.x the numeric overload returned a bare specifier string; it returns the same `['-map', spec]` tuple as the string form since 2.0.0.)
- **`scale`, `crop`, `overlay`, `drawtext`, `fade`** — standalone call form added: `scale({w:320,h:180})` returns a serialized string. `ScaleOptions`/`CropOptions` accept `w`/`h` shorthand
- **`volume`, `loudnorm`, `equalizer`, `atempo`** — standalone call form added: `loudnorm({i:-16,lra:11,tp:-1.5})` returns serialized string
- **`FFmpegBuilder.videoFilter` / `.audioFilter`** — accept `string | FilterChain | {toString()}` so standalone filter results pass directly: `.videoFilter(scale({w:320,h:180}))`

### Added (testing)

- **`deno-tests/battle.test.ts`** — full Deno battle test mirroring `battle.test.mjs`, imports from `lib/` TypeScript sources. Run: `deno task battle`
- **`deno task battle`** in `deno.json`

### Fixed (carried forward from 0.1.x patch series)

- **`streamToFile`** — no longer routes through `pipeThrough()`, which incorrectly appended `pipe:1` alongside the file path output, causing FFmpeg to error with `Unable to choose an output format for 'pipe:1'`
- **`addWatermark`** — fixed trailing-comma bug in filter chain builder that produced an empty filter name `''`, rejected by FFmpeg 8.x with `No such filter: ''`
- **`generateWaveform`** — `bgcolor` and `draw` parameters removed entirely; FFmpeg 7.x+ removed both from `showwavespic`. The `backgroundColor` and `mode` options are kept in the interface for API compatibility but are now deprecated no-ops
- **Version parser** (`parseVersionOutput`) — regex updated to handle 2-component version strings like `8.1` (FFmpeg 8.x), fixing `major` returning `0` which broke all version-gated features
- **`hlsPackage` / `adaptiveHls`** — `-hls_version` flag removed; FFmpeg 8.x removed this option entirely
- **`twoPassEncode`** — pass 1 output changed from `-f null /dev/null` to a temporary MKV file, fixing `ratecontrol_init: can't open stats file` on ARM Linux (both Android Termux FFmpeg 8.x and Ubuntu ARM FFmpeg 7.x)
- **`dashPackage`** — `min_buffer_time`, `use_template`, `use_timeline` flags removed; all were dropped from the DASH muxer in FFmpeg 8.x

### Complete API surface (v0.2.0)

#### Process & Builder
`ffmpeg`, `FFmpegBuilder`, `spawnFFmpeg`, `runFFmpeg`, `FFmpegSpawnError`, `FFmpegEmitter`, `ProgressParser`, `parseAllProgress`

#### Binary utilities
`resolveBinary`, `resolveProbe`, `validateBinary`, `isBinaryAvailable`, `BinaryNotFoundError`, `BinaryNotExecutableError`

#### Version utilities
`probeVersion`, `parseVersionOutput`, `satisfiesVersion`, `formatVersion`

#### Probe (`ffprobe`)
`probe`, `probeAsync`, `ProbeError`, `parseFrameRate`, `parseDuration`, `parseBitrate`, `getVideoStreams`, `getAudioStreams`, `getSubtitleStreams`, `getDefaultVideoStream`, `getDefaultAudioStream`, `getMediaDuration`, `durationToMicroseconds`, `summarizeVideoStream`, `summarizeAudioStream`, `getStreamLanguage`, `findStreamByLanguage`, `formatDuration`, `isHdr`, `isInterlaced`, `getChapterList`

#### Capability registry
`CapabilityRegistry`, `getDefaultRegistry`

#### Compatibility guards
`guardVersion`, `guardFeatureVersion`, `guardCodec`, `guardFilter`, `guardHwaccel`, `guardCodecFull`, `assertCodec`, `assertHwaccel`, `assertFeatureVersion`, `GuardError`, `selectBestCodec`, `selectBestHwaccel`, `isFeatureExpected`, `availableFeatures`, `unavailableFeatures`, `FEATURE_GATES`

#### Codec serializers — video
`x264ToArgs`, `x265ToArgs`, `svtav1ToArgs`, `vp9ToArgs`, `proResToArgs`, `dnxhdToArgs`, `mjpegToArgs`, `mpeg2ToArgs`, `mpeg4ToArgs`, `vp8ToArgs`, `theoraToArgs`, `ffv1ToArgs`

#### Codec serializers — audio
`aacToArgs`, `opusToArgs`, `mp3ToArgs`, `flacToArgs`, `ac3ToArgs`, `alacToArgs`, `eac3ToArgs`, `truehdToArgs`, `vorbisToArgs`, `wavpackToArgs`, `pcmToArgs`, `mp2ToArgs`

#### Hardware codec serializers
`nvencToArgs`, `vaapiToArgs`, `qsvToArgs`, `mediacodecToArgs`, `mediacodecVideoToArgs`, `vulkanToArgs`, `vulkanVideoToArgs`

#### Filters — video
`scale`, `crop`, `overlay`, `drawtext`, `fps`, `setpts`, `trim`, `format`, `setsar`, `setdar`, `vflip`, `hflip`, `rotate`, `transpose`, `unsharp`, `gblur`, `boxblur`, `eq`, `hue`, `colorbalance`, `yadif`, `hqdn3d`, `nlmeans`, `thumbnail`, `select`, `concat`, `split`, `tile`, `colorkey`, `chromakey`, `subtitles`, `avgblurVulkan`, `nlmeansVulkan`, `fade`, `zoompan`

#### Filters — audio
`volume`, `loudnorm`, `equalizer`, `bass`, `treble`, `afade`, `asetpts`, `atrim`, `amerge`, `amix`, `pan`, `channelmap`, `channelsplit`, `aresample`, `dynaudnorm`, `compand`, `aecho`, `highpass`, `lowpass`, `asplit`, `silencedetect`, `rubberband`, `atempo`, `agate`

#### Filter graph (complex filters)
`FilterChain`, `FilterGraph`, `GraphNode`, `GraphStream`, `VideoFilterChain`, `AudioFilterChain`, `videoFilterChain`, `audioFilterChain`, `filterGraph`, `resetLabelCounter`, `serializeNode`, `serializeLink`, `pad`

#### High-level helpers
`twoPassEncode`, `buildTwoPassArgs`, `hlsPackage`, `adaptiveHls`, `dashPackage`, `screenshots`, `frameToBuffer`, `mergeToFile`, `concatFiles`, `buildConcatList`, `toGif`, `gifToMp4`, `buildGifArgs`, `buildGifPalettegenFilter`, `buildGifPaletteuseFilter`, `normalizeAudio`, `adjustVolume`, `buildLoudnormFilter`, `addWatermark`, `addTextWatermark`, `buildWatermarkFilter`, `buildTextWatermarkFilter`, `burnSubtitles`, `extractSubtitles`, `buildBurnSubtitlesFilter`, `writeMetadata`, `stripMetadata`, `buildMetadataArgs`, `buildChapterContent`, `generateWaveform`, `generateSpectrum`, `buildWaveformFilter`, `buildSpectrumFilter`, `getPreset`, `listPresets`, `applyPreset`, `pipeThrough`, `streamOutput`, `streamToFile`, `buildPipeThroughArgs`, `buildStreamOutputArgs`

#### Stream mapping
`mapStream`, `mapAll`, `mapAllVideo`, `mapAllAudio`, `mapAllSubtitles`, `mapVideo`, `mapAudio`, `mapSubtitle`, `mapLabel`, `negateMap`, `setStreamMetadata`, `setMetadata`, `setDisposition`, `streamCodec`, `copyStream`, `remuxAll`, `mapDefaultStreams`, `mapAVS`, `copyAudioAndSubs`, `serializeSpecifier`, `ss`

#### Process management
`renice`, `autoKillOnExit`, `killAllFFmpeg`

---

## [0.1.0]

### Fixed

- Version parser regex now handles `8.1` (2-component) FFmpeg version strings
- `showwavespic` `bgcolor` conditional emission (skipped when default black)
- `buildHlsArgs` — `-f hls` now correctly precedes all `hls_*` flags
- `pipeThrough` — auto-injects `frag_keyframe+empty_moov` for MP4/MOV pipe output
- `pipeThrough` — auto-injects `analyzeduration`/`probesize` for MP4/MOV pipe input
- `twoPassEncode` `videoCodec`/`videoBitrate` conditional args (no more `undefined` encoder)
- `deno.json` permissions moved from `test` block to `tasks` entries (Deno 2.x compatibility)
- `tsconfig.json` scoped to `src/` only — tests no longer type-checked against missing `dist/`
- All GitHub Actions updated to `@v5` (Node.js 20 deprecation)

---



### Fixed

#### `showwavespic` filter — removed unsupported `bgcolor` and `draw` parameters (FFmpeg 7.x)

FFmpeg 7.1 removed the `bgcolor` parameter from `showwavespic` and changed the
`draw` parameter name in some builds. The library was hard-coding both regardless
of whether they were needed, causing errors of the form:

```
Error applying option 'bgcolor' to filter 'showwavespic': Option not found
```

**Changes in `src/helpers/waveform.ts` and `lib/helpers/waveform.ts`:**

- `generateWaveform`: Filter string is now built conditionally. `bgcolor` is only
  emitted when the caller explicitly sets a non-default (non-black) background.
  `draw` is only emitted when the mode is not the default `'line'`.
- `buildWaveformFilter`: Same conditional logic applied. Signature extended with
  an optional `backgroundColor` parameter.

#### Version parser — 2-component version strings (FFmpeg 8.x)

FFmpeg 8.x changed its version string from `7.1.1` (3 components) to `8.1`
(2 components). The regex `(\d+)\.(\d+)\.(\d+)` failed to match, leaving
`major` at `0` and breaking all version-gated features and tests:

```
AssertionError: 0 > 0  (probeVersion returns major >= 4)
```

**Changes in `src/utils/version.ts` and `lib/utils/version.ts`:**
- `RELEASE_RE` updated to `(\d+)\.(\d+)(?:\.(\d+))?` — the patch component is
  now optional. `raw` is formatted accordingly (`8.1` vs `7.1.1`).

#### `hlsPackage` / `adaptiveHls` — removed `-hls_version` (FFmpeg 8.x)

FFmpeg 8.x removed the `-hls_version` option from the HLS muxer entirely.
Passing it causes an immediate failure:

```
Unrecognized option 'hls_version'.
Error splitting the argument list: Option not found
```

**Changes in `src/helpers/hls.ts` and `lib/helpers/hls.ts`:**
- `-hls_version` removed from `hlsPackage`, `adaptiveHls`, and `buildHlsArgs`.
  The `hlsVersion` option is kept in the interface for API compatibility but is
  silently ignored — FFmpeg 8.x determines HLS version automatically.

#### `twoPassEncode` / `buildTwoPassArgs` — `undefined` encoder guard

When `videoCodec` or `videoBitrate` were not provided, they were passed directly
into the args array as `undefined`, which Node.js serialised to the string
`"undefined"`, causing FFmpeg to fail with `Unknown encoder 'undefined'`.

**Changes in `src/helpers/twopass.ts` and `lib/helpers/twopass.ts`:**
- `videoArgs` is now built conditionally: `-c:v` only added when `videoCodec` is
  set, `-b:v` only added when `videoBitrate` is set.



FFmpeg only recognises `hls_*` options when the HLS muxer is already active. If
these flags appear before `-f hls` they are treated as global options and rejected:

```
Unrecognized option 'hls_version'
```

**Changes in `src/helpers/hls.ts` and `lib/helpers/hls.ts`:**

- `buildHlsArgs`: `-f hls` is now inserted **before** `-hls_time`,
  `-hls_list_size`, `-hls_version`, and `-hls_flags`.
- `hlsVersion` (defaulting to `3`) is now included in the built args, which was
  previously omitted entirely.

#### `pipeThrough` — automatic `frag_keyframe` movflags for MP4/MOV pipe output

MP4 and MOV files require FFmpeg to seek backwards after writing all frames, in
order to place the `moov` atom at the beginning of the file. This is impossible
when writing to a pipe (`stdout`), causing FFmpeg to fail silently or produce
unplayable output.

**Changes in `src/helpers/streams.ts` and `lib/helpers/streams.ts`:**

- `pipeThrough`: When `outputFormat` is `'mp4'` or `'mov'` and the caller has not
  already set `-movflags`, the library now automatically appends:
  ```
  -movflags frag_keyframe+empty_moov+default_base_moof
  ```
  This produces a fragmented MP4 that is fully streamable with no seeking required.
  Users who supply their own `-movflags` are not affected.
- `buildPipeThroughArgs`: The same automatic injection is applied in the pure
  arg-builder function so tests and manual arg construction benefit from the fix.

#### `pipeThrough` — automatic `analyzeduration`/`probesize` hints for MP4/MOV pipe input

Standard (non-faststart) MP4 and MOV files store the `moov` atom at the **end**
of the file. When the file is piped into FFmpeg via `pipe:0`, FFmpeg cannot seek
backwards to find it, and fails with:

```
Could not find codec parameters for stream 0: unspecified pixel format
Consider increasing the value for the 'analyzeduration' and 'probesize' options
```

**Changes in `src/helpers/streams.ts` and `lib/helpers/streams.ts`:**

- `pipeThrough`: When `inputFormat` is `'mp4'`, `'mov'`, or `'m4v'`, the library
  now automatically prepends `-analyzeduration 100M -probesize 100M` to the
  FFmpeg args. This causes FFmpeg to buffer up to 100 MB of input data before
  giving up on stream parameter detection, which is sufficient for most files
  whose `moov` atom is near or at the end.
- `buildPipeThroughArgs`: Same automatic hint injection applied.

> **Note:** For very large MP4 files or files with the moov at the absolute end,
> the best long-term solution is to pre-process them with `-movflags +faststart`
> so the moov is at the start. For pipe use cases, MKV or WebM containers are
> inherently seekable and do not have this limitation.

---

## [0.0.1]

Initial release.

- Fluent `FFmpegBuilder` API
- `FFmpegBuilder.run()` with typed progress events
- HLS / adaptive HLS / DASH packaging helpers
- Stream I/O helpers (`pipeThrough`, `streamOutput`, `streamToFile`)
- Waveform and spectrum visualisation helpers
- `ffprobe` wrapper with typed output
- Stream mapping DSL (`mapAVS`, `setMetadata`, `mapLabel`, …)
- GIF and concat helpers
- Codec / hardware acceleration registry
- FFmpeg compatibility guards (v6 / v7 / v8)
- Full TypeScript types, dual ESM + CJS build

[2.0.0]: https://github.com/GlobalTechInfo/mediaforge/releases/tag/v2.0.0
[0.3.0]: https://github.com/GlobalTechInfo/mediaforge/releases/tag/v0.3.0
[0.3.0-rc.1]: https://github.com/GlobalTechInfo/mediaforge/releases/tag/v0.3.0-rc.1
[0.2.0]: https://github.com/GlobalTechInfo/mediaforge/releases/tag/v0.2.0
[0.1.0]: https://github.com/GlobalTechInfo/mediaforge/releases/tag/v0.1.0
[0.0.1]: https://github.com/GlobalTechInfo/mediaforge/releases/tag/v0.0.1
