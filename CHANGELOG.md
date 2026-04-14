# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] — 2026-04-14

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
- **`mapStream(fileIndex, type, streamIndex?)`** — new three-argument overload returning a plain string; original single-argument tuple form unchanged
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

---

## [0.1.0] — 2026-04-07

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

## [0.0.1] — 2026-03-24

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
