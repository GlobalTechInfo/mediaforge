# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
