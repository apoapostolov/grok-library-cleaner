# Changelog

## 1.2.0 — 2026-11-27

Sidebar chats get their own trash button and a background delete queue. Thanks to @luciotato for the proposal and the first implementation of these controls.

### Added

- **Trash on sidebar chats.** Each chat under Chats in the left sidebar has a trash icon. One click deletes that conversation directly, and the toast confirms which chat went. The title still opens the chat.
- **Select chats.** A checkbox on the left of each chat. **Delete selected** appears in the sidebar footer, above the account row, only while chats are checked. It hides the checked rows and deletes them in the background, with the same progress toast and **Stop** button as the library. Checking more chats and clicking again appends them to the queue. A chat that fails to delete is allowed back the next time the list redraws.

### Changed

- Chrome shows one new permission when you reload the extension. It lets the sidebar controls tell which chat each row is, and it applies only on grok.com.

### Fixed

- The trash button and the checkbox act on the chat you clicked, even when you click two rows quickly or Grok redraws the sidebar while you work.
- When Grok reuses a row for another chat, a checkbox tick on the old chat clears with it.

## 1.1.2 — 2026-11-26

Select tiles and delete them in the background, without waiting for the previous batch to finish.

### Added

- **Click a tile to select it.** A checkbox and an eye sit at the top-left of each tile. The image click toggles selection and draws a red outline. The eye opens the item. The trash icon stays at the top-right and still deletes that one tile immediately. Selection stays with the tile you clicked even when the library scrolls and reuses that tile for another item.
- **Delete selected.** A header button next to **Delete all**. It hides the checked tiles immediately and deletes them in the background at the usual pace. The bottom toast shows the count, failures, elapsed time, a progress bar, and **Stop**. Stopping cancels the item in progress, and tiles that were not deleted come back on the next library redraw. An expired session stops the queue instead of sending more doomed requests. Checking more tiles and clicking **Delete selected** again appends them to the same queue, and the toast total grows with them.

## 1.1.1 — 2026-10-27

### Added

- **Only younger than.** A text field that takes a compact age — `1d 6h`, `3m`, `2y 1m 3d`, any mix of years, months, weeks, days and hours — and spares everything older, so a run can clear the last day of experiments and leave the rest of the library alone. Empty means every age. The placeholder shows the format rather than a value, and an age the extension cannot read stops the run before anything is scanned.

### Changed

- The settings popup is one form grid: a fixed label column with a control column beside it, so every input starts on the same vertical line and the two-value rows line up on a second one. It measures 340x537.
- Every limit includes its edge. A 20-page cap reads page 20, a per-run cap of 3 queues the third item, a 3 MB cap keeps a file of exactly 3 MB, an age of 5d keeps a file created five days ago, and five pages with no candidates asks on the fifth page rather than the sixth.
- The size limit reads *Skip files over N MB* instead of *Skip files larger than N MB*.

### Fixed

- The popup no longer scrolls. Chrome caps a popup at 600px tall and the added rows pushed the form past it; the limits now share one label column and the popup fits at 340x537 with every control on screen.
- A run no longer fails on a tab that was open before the extension was reloaded. That tab keeps a content script whose extension context is gone, so it can never answer; the run leaves it untouched, opens its own library tab, and says to reload the extension when even that tab stays silent.

## 1.1 — 2026-10-27

Two scan controls, so a big library can be worked in passes instead of one long walk.

### Added

- **Scan at most N pages.** Bounds how much of the list one run reads. A page holds 60 assets, so 20 pages is around 1,200 of them. Left at `0` the scan reads everything, the way 1.0 did.
- **Ask to stop after N pages with no candidates.** A page has no candidates when none of its assets would be queued, because the type is switched off, the file is over the size cap, or it is already gone. After that many pages in a row the scan pauses and asks: **Yes** stops there and goes to the confirmation with what it found, **Proceed** walks on to the page cap or the end of the list. It asks once per run, and at `0` it never asks.

### Changed

- The confirmation toast now names why the scan stopped, `stopped at 20 pages` or `stopped early: 5 pages with no candidates`, so a capped queue is not mistaken for the whole library.

## 1.0

First build, published as source only: a trash glyph on every tile, the confirmed bulk sweep with human pacing and a stop button, optional save-before-delete with prompt sidecars, the size guard, and chats and projects as removal types.
