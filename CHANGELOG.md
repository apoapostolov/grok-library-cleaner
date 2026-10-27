# Changelog

## 1.1 — 2026-10-27

Two scan controls, so a big library can be worked in passes instead of one long walk.

### Added

- **Scan at most N pages.** Bounds how much of the list one run reads. A page holds 60 assets, so 20 pages is around 1,200 of them. Left at `0` the scan reads everything, the way 1.0 did.
- **Ask to stop after N pages with no candidates.** A page has no candidates when none of its assets would be queued, because the type is switched off, the file is over the size cap, or it is already gone. After that many pages in a row the scan pauses and asks: **Yes** stops there and goes to the confirmation with what it found, **Proceed** walks on to the page cap or the end of the list. It asks once per run, and at `0` it never asks.

### Changed

- The confirmation toast now names why the scan stopped, `stopped at 20 pages` or `stopped early: 5 pages with no candidates`, so a capped queue is not mistaken for the whole library.

## 1.0

First build, published as source only: a trash glyph on every tile, the confirmed bulk sweep with human pacing and a stop button, optional save-before-delete with prompt sidecars, the size guard, and chats and projects as removal types.
