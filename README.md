<p align="center">
  <img src="assets/hero.png" width="190" height="190" alt="Grok Library Cleaner: a metal bin with its lid open, with the Grok logo going in">
</p>

<h1 align="center">Grok Library Cleaner</h1>

<p align="center">Before unsubscribing from Grok, remember to download and wipe out your creations.</p>

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

**Per-item delete.** A 26px trash glyph in the top-right corner of every tile. One click removes that asset. No menu, no dialog, and a toast in the bottom-right confirms which file went.

**Delete all.** Two clicks to arm, then a scan of the whole library and a confirm toast showing the queue size and per-class breakdown. Nothing is deleted until you press **Delete N**. During the run the toast carries a live progress bar with the count, failures, elapsed time and ETA, plus a **Stop** button. Progress bar and counts are formatted, so 15,059 does not read as 15059.

**Separate selectors** for images (`image.jpg`), edited images (`edited-image.jpg`), videos (`generated_video.mp4`) and other files, with an optional per-run cap for a first pass on a large library.

**Size guard.** "Skip files larger than N MB" keeps big renders out of a bulk purge. `sizeBytes` ships with every list row, so the guard adds no requests and no scanning time. It applies while the queue is built, before anything is deleted, and the confirm toast reports how many matches were spared. On a sample of 600 recent assets, a 1 MB cap spared 1.4% of plain images and 100% of videos. The per-tile glyph still deletes whatever you click, cap or no cap, because that click is explicit.

## Keep a copy before it goes

Turn on **Save a copy before deleting** and every item is downloaded to disk before its delete request is sent. The folder is set in the popup and lives inside your browsers Downloads folder, for example `Downloads/GrokLibrary/2026-10-21/`.

Files are named from the asset itself, so they read like a person filed them:

```
2026-10-18_2143-07_image_sunlit-portrait-unbuttoned-linen-shirt_7c41ba2e.jpg
2026-10-14_1912-55_edit_warmer-golden-hour-bare-shoulder_52d90f6b.jpg
```

That is the creation timestamp in local time, the kind (image, edit, video, file), a slug of the prompt, and the first eight characters of the asset id so a duplicate can always be traced back.

**Prompts are saved too.** Grok keeps the generation input on each asset, so the extension reads it and writes a matching `.md` beside the file: the prompt in a fenced block, plus size, dimensions, creation time, model, mode, aspect ratio and a link back to the conversation. Assets that have no prompt, such as your own uploads, get no `.md`.

Naming and prompt lookup cost one extra `GET /rest/assets/<id>` per item. A save only counts as done when the file finished and its byte size matches what the API reported, so an error page posing as a download can never authorise a delete. If a save fails, that item stays in the library and is reported in the summary.

**Test download** in the popup writes a small text file to the chosen folder and reports the exact path, so you can confirm the path works before committing to a long run.

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
- `GET /rest/assets/<assetId>` returns one asset, including `mediaGenInput` with the prompt and generation settings.
- `DELETE /rest/assets-metadata/<assetId>` removes one asset.
- `https://assets.grok.com/<key>` serves the file itself. It answers `403` without your session cookies, so downloads go through Chrome's download manager rather than a fetch.

The page also fires `POST /rest/media/post/delete` before deleting a tile and that endpoint answers `404` for library assets, so it is a no-op worth ignoring.

Tiles are found by `button[data-library-item-id]`, which carries the asset id. A `MutationObserver` keeps the glyphs in place across infinite scroll and client-side re-renders.

The extension has no backend and no analytics. It talks to `grok.com` for the library and to `assets.grok.com` for the files, and needs the `downloads` permission for the copies.

## Notes

- Deletion is permanent on Grok's side and there is no undo.
- Keep the library tab open while a run is in progress.
- Not affiliated with xAI or Grok.
