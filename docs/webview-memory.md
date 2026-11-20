# WebView2 memory

`wbmem` does not try to maintain a target number in Task Manager. It helps
WebView2 release resources after a lifecycle change without evicting hot
caches during typing or redraws.

- **Visible:** pane/buffer disposal can request one V8 collection. Requests
  coalesce and wait for two quiet seconds plus a real browser idle budget.
  A busy page can outlast the request and skip it entirely. The cooldown is
  30 seconds; a runtime failure backs off for two minutes and needs a new
  disposal before retrying. There is no recurring collection or memory poll.
- **Hidden and retained:** after five seconds, ask WebView2 for its supported
  [`LOW` memory target][target]. Restore `NORMAL` on summon, before frontend
  restore. Scripts continue running so the PTY reader can still drain output.
  Older runtimes without the API keep their default policy.
- **Destroy on hide:** cancel pending foreground maintenance and let WebView2
  teardown release its resources. Do not run another collection while
  serializing the terminal.

## Reproducing growth while scrolling Neovim

Use a release build, a fixed window size/font/DPI, one pane, and the same
runtime version per run. Compare WebGPU and WebGL in separate runs.

1. Record a baseline after opening a shell. Run `nvim --clean <file>` with a
   file long enough to scroll. Repeat the **same** scroll range several times
   before trying a different file or one with many distinct glyphs and colors.
2. Record after each pass, after settling at the same viewport, after exiting
   Neovim, and after hiding for at least five seconds. Test retained-hide and
   destroy-on-hide separately. Check that a background job keeps producing
   output on retained-hide and that quick hide/summon does not stall typing.
3. Record **live JS heap and ArrayBuffer/external allocations** separately
   from **renderer/browser/GPU private bytes and working set**, plus GPU memory
   if available. Also record the ParTTY host process separately. Use allocation
   sampling or heap snapshots in a separate diagnostic run; inspecting affects
   timing and snapshots can trigger collection. [WebView2 ETW/WPR][perf] can
   help distinguish native process growth from JS allocations.

## Where to look first

| Observation | Likely areas to inspect |
| --- | --- |
| Growth when new glyphs, styles, font sizes, or DPI appear, then a plateau | The installed WebGPU renderer keeps glyph metadata and per-page canvases **and** uploads GPU textures. Its atlas is shared by matching configurations, not by all configurations indiscriminately. It starts with 512-pixel pages and can grow/merge pages up to 4096 pixels per side (a full RGBA8 GPU page is 64 MiB before other copies). A GC cannot free atlas pages that the live renderer still needs. |
| Spikes while repainting; live heap settles afterwards | PTY ring-to-JS copies, queued xterm writes, parser/render temporaries, and browser/GPU staging allocations. The renderer reuses buffers, but some grow to a high-water mark. A normal Neovim alternate screen is viewport-sized, not scrollback that grows with each repaint; the shell's old normal buffer remains live while the TUI runs. |
| Growth in the native ParTTY process | A bounded 4 MiB replay buffer per PTY can fill even if the same alternate-screen rows keep changing; serialized scrollback in the hide stash also lives on the Rust side. A V8 collection cannot reclaim either. |
| Growth after repeatedly switching quiet tabs, rather than scrolling one pane | The current warm-tab path can replace a 2 MiB shared output ring; the old mapping may remain until the new ring writes or closes. A registered shared buffer needs explicit lifecycle cleanup, not V8 collection. |
| Repeated growth at the same viewport and glyph set, even after the workload stops | Check retained typed arrays, detached DOM, and application caches in JS; if JS is flat, inspect backing textures, compositor surfaces, native allocations, and queued GPU work. A high working set alone does not establish a leak. |

The custom V8 `--max_semi_space_size=64` launch flag is also worth a separate
A/B test if transient renderer heap growth dominates. A larger young
generation trades memory for fewer collections; reducing it without measuring
frame times may undo the responsiveness it was set for.

[target]: https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_19
[perf]: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance#webview2-etw-tracing
