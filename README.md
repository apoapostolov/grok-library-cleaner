<p align="center">
  <img src="assets/icon-128.png" width="104" height="104" alt="Grok Library Cleaner icon: a white bin swallowing a red X">
</p>

<h1 align="center">Grok Library Cleaner</h1>

<p align="center">Clear your Grok image library one item at a time, or in one paced sweep.</p>

<p align="center">
  <img src="https://img.shields.io/badge/type-chrome_extension-4285F4" alt="Type: Chrome extension">
  <img src="https://img.shields.io/badge/manifest-v3-1f6feb" alt="Manifest V3">
  <img src="https://img.shields.io/badge/version-1.0-2fbf71" alt="Version 1.0">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-97ca00" alt="License: MIT"></a>
</p>

Grok keeps every image it generates. Removing them on `grok.com/library` means opening a hover menu and clicking through a confirmation dialog for each one. This extension adds a delete glyph to the corner of every tile, plus a **Delete all** button in the library header that scans the library, shows you exactly what it found, and then works through the queue at a human pace.

## Install

```bash
git clone https://github.com/apoapostolov/grok-library-cleaner.git
```

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Choose **Load unpacked** and select the cloned folder.
3. Reload any open `grok.com/library` tab.

## What you get

**Per-item delete.** A 26px trash glyph in the top-right corner of every tile. One click removes that asset. No menu, no dialog.

**Delete all.** Two clicks to arm, then a scan of the whole library and a summary panel with the queue size and a per-class breakdown. Nothing is deleted until you confirm with **Delete N**, and **Stop** is always one click away. The run reports progress, failures, elapsed time and a live ETA.

**Separate selectors** for images (`image.jpg`), edited images (`edited-image.jpg`), videos (`generated_video.mp4`) and other files, with an optional per-run cap for a first pass on a large library.

## Pacing

The library endpoints rate limit, and the limiter answers `429` with no `Retry-After` header, so the extension spaces its own work:

| Behaviour | Default |
| --- | --- |
| Gap between deletes | 800 to 2400 ms, randomized per item |
| Long break | every 6 to 14 items, 3.5 to 9 s |
| Cooldown on 429 | 18 to 32 s with jitter, then retry |
| Scan page gap | 1200 to 2000 ms, 60 assets per page |
| Failed request retries | 4 attempts, then counted and skipped |

All of it is adjustable in the toolbar popup.

## How it works

The extension drives the same REST endpoints the page uses, with your existing session cookies:

- `GET /rest/assets` lists the library, newest first, paginated by `pageToken`.
- `DELETE /rest/assets-metadata/<assetId>` removes one asset.

The page also fires `POST /rest/media/post/delete` before deleting a tile and that endpoint answers `404` for library assets, so it is a no-op worth ignoring.

Tiles are found by `button[data-library-item-id]`, which carries the asset id. A `MutationObserver` keeps the glyphs in place across infinite scroll and client-side re-renders.

The extension has no backend, no analytics, and makes no requests anywhere except `grok.com`.

## Notes

- Deletion is permanent on Grok's side and there is no undo.
- Keep the library tab open while a run is in progress.
- Not affiliated with xAI or Grok.
