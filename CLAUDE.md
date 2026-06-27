# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **purely static**, client-side web tool suite ("easy web tools" / 웹 도구 모음). Everything runs in the browser — no file is ever uploaded to a server. There is **no build step, no bundler, and no framework**. The entire app is `public/index.html` plus vanilla JS modules in `public/js/`, styled with TailwindCSS (CDN) + a hand-written `public/css/styles.css`.

The UI language is Korean. Match the existing Korean wording in user-facing strings and comments.

## Commands

```bash
# Local dev (no build — just serve the public/ dir)
python3 -m http.server 8765 --directory public
# → http://localhost:8765

# Manual deploy to Cloudflare Pages
npx wrangler pages deploy public --project-name easywebtools --branch main
```

There is **no test suite** (`npm test` is a placeholder that exits 1) and no lint step. Verification is manual in the browser.

Deployment is automatic: pushing to `main` triggers `.github/workflows/deploy.yml`, which deploys `public/` to Cloudflare Pages and sends a Telegram notification. `wrangler.jsonc` sets `pages_build_output_dir: ./public` with no build command.

## Architecture

Five independent tools, each a tab/panel in the single-page `public/index.html`, each backed by exactly one JS module:

| Tab | Module | Tech |
|-----|--------|------|
| MP3 편집 (trim) | `js/audio.js` + `js/waveform.js` | Web Audio API, `lamejs` (MP3 encode) |
| 이미지 리사이즈 (batch resize) | `js/image.js` | Canvas |
| 이미지 편집 (filters/crop/text) | `js/editor.js` | **Photon WASM** (`js/vendor/`) |
| 도장 찍기 (stamp compositing) | `js/stamp.js` | Canvas |
| PDF ↔ PNG | `js/pdf-tools.js` | pdf.js, jsPDF, JSZip |

Shared modules:
- `js/app.js` — tab switching only (toggles `.active` on `.tab`/`.panel`).
- `js/utils.js` — global helpers attached to `window`: `wireDropzone`, `downloadBlob`, `setStatus`, `stripExt`, `formatTime`, `refreshIcons`.
- `js/heic.js` — `window.isHeicFile` / `window.heicToCanvas`; lazy-loads libheif-js WASM from CDN on first HEIC input. Consumed by `image.js`.
- `js/select.js` — progressively enhances every native `<select>` into a button segment control; keeps the real `<select>` hidden as the source of truth and dispatches `change`.

### Key conventions (important)

- **No module system except `editor.js`.** All scripts are loaded as classic `<script>` tags and each wraps itself in an IIFE, exposing anything shared via `window.*`. `editor.js` is the lone `<script type="module">` because it `import`s the Photon WASM glue. Do not add `import`/`export` to other modules.
- **Cache busting is manual.** Every local CSS/JS `<script src>`/`<link href>` in `index.html` carries a `?v=N` query string (currently `?v=13`). **When you change a JS or CSS file, bump the `?v=` number on its tag** (and typically bump all of them together) or Cloudflare/browsers will serve stale assets.
- **Vendored & patched WASM glue.** `js/vendor/photon_rs_bg.js` is wasm-bindgen output that has been hand-patched to drop the static `wasm` import so it works without a bundler. `editor.js` calls `fetch("js/vendor/photon_rs_bg.wasm")` → `WebAssembly.instantiate` → `photon.__wbg_set_wasm(instance.exports)`. Do not regenerate this file from `wasm-pack` without re-applying that patch.
- **Heavy libs come from CDN** (`unpkg`/`cdnjs`/`jsdelivr`): Tailwind, Lucide icons, pdf.js, jsPDF, JSZip, lamejs, libheif. They are global (`window.jspdf`, `JSZip`, `lamejs`, `pdfjsLib`, `lucide`, etc.), not imported.
- **Icons:** Lucide `<i data-lucide="...">`. After injecting DOM with new icons, call `refreshIcons()` (from utils) so they render.
- **Status pattern:** each tool has a `<div class="status" id="...Status">`; report progress/errors with `setStatus(el, msg, "work"|"err"|"ok")`.

### Adding or changing a tool

1. Add the tab button (`.tab[data-tab=...]`) and `<section class="panel">` in `index.html`.
2. Create one IIFE module in `public/js/`, wire its dropzone with `wireDropzone`, do all processing on Canvas/WASM/Web Audio client-side, and download results via `downloadBlob`.
3. Add its `<script src="js/yourtool.js?v=N">` near the bottom of `index.html` and bump the `?v=` versions.
