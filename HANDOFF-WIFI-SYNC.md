# Handoff: Wi-Fi Sync feature (`feature/wifi-sync` branch)

**Author:** Claude (working on the companion iPhone app, MusicApp)
**Date:** 2026-07-03
**For:** Antigravity — review and merge when you're back in quota.

## Why

The iPhone companion app (MusicApp, github.com/jaimalleshk/MusicApp) mirrors
SonicStream's playlists and plays the downloaded MP3s. To get playlists + files
onto the phone without a USB cable, the phone pulls them from SonicStream's
FastAPI server over the local Wi-Fi network. SonicStream previously bound to
`127.0.0.1:<random>`, which is unreachable from other devices — this branch
adds an **opt-in** Wi-Fi Sync mode.

## Design constraints honored

- **Nothing existing was modified.** `main.py` changes are a single appended
  section (marked `Wi-Fi Sync module`) — `git diff master main.py` shows
  additions only, before the `if __name__` block. No frontend files touched
  (your uncommitted player/playlists work was snapshot-committed as-is on
  `master` before branching — commit "Snapshot: current working state").
- **Off by default.** Without `sync_config.json` saying `"enabled": true`,
  `gui.py` behaves byte-for-byte like before: loopback host, random port.
- **Token-protected.** All sync endpoints except `/api/sync/info` require a
  pairing token (`X-Sync-Token` header or `?token=`). Tokenless requests are
  only honored from 127.0.0.1 (the desktop UI itself). Token comparison uses
  `secrets.compare_digest`. `sync_config.json` is gitignored (holds the secret).

## What was added

| File | Change |
|---|---|
| `main.py` | Appended Wi-Fi Sync module: config loader + 4 endpoints (below) |
| `gui.py` | Reads sync config at launch; binds `0.0.0.0:<fixed port>` only when enabled and the port is free, else falls back to old behavior. WebView URL unchanged (`127.0.0.1`) |
| `wifi_sync_setup.py` | New CLI helper: `on` / `off` / `new-token` / status+pairing info |
| `.gitignore` | + `sync_config.json` |
| `HANDOFF-WIFI-SYNC.md` | this file |

### Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/sync/info` | none | Discovery ping: app name, sync version, enabled flag |
| `GET /api/sync/manifest` | token | All non-deleted **audio** playlists (video jobs excluded), each track with `file` = exact local filename or `null` if not downloaded. Uses the same fuzzy title→filename rule as `check_local_duplicate` (one `listdir` per folder, indexed) |
| `GET /api/sync/file/{playlist_id}/{filename}` | token | Serves one MP3 from that playlist's `download_dir`. Basename + `commonpath` containment checks against traversal |
| `POST /api/sync/export-manifest` | token | Writes `playlists_manifest.json` into the downloads folder so playlist structure travels with the files on USB/OneDrive transfers too |

### Manifest schema (v1) — the iPhone app is built against this

```json
{
  "version": 1, "app": "SonicStream", "exported_at": "ISO-8601",
  "playlists": [{
    "id": "job_1783080277", "title": "All Songs", "pinned": true,
    "track_count": 833, "available_count": 531,
    "tracks": [{ "file": "Manasa Palakave.mp3", "size": 13251658,
                 "title": "Manasa Palakave",
                 "artist": "S.P.Balasubramanyam - Topic", "duration": 311,
                 "youtube_id": "efv3iHUarxY" }]
  }]
}
```

Please treat this schema as a contract: add fields freely, but don't rename or
remove existing ones without bumping `version`.

## Verified (2026-07-03, real data: 833-track history, 407-file folder)

- `import main` clean; all 4 routes registered; existing `/api/history` unaffected
- Wrong token → 401; good token → manifest (All Songs: 531/833 files resolved)
- File download: 200, 13.2 MB MP3 streamed; `..%5C` traversal → 400
- Export writes `playlists_manifest.json` (3 playlists) into the downloads folder
- Default launch path (sync disabled): unchanged behavior confirmed by code path

## User-facing flow (current, no UI)

1. `python wifi_sync_setup.py on` → prints server URL + token
2. Restart SonicStream (allow the one-time Windows Firewall prompt)
3. In the iPhone app: enter `http://<pc-ip>:8765` + token → pulls manifest, downloads tracks

## Later additions (2026-07-03)

- Manifest tracks now include `size` (bytes, nullable) — the phone skips large
  files before downloading (user setting, default: skip > 30 MB).
- Bug fix: `import_playlist` now records `download_dir = folder_path`; before
  this, folder-imported playlists resolved to `file: null` for every track in
  the sync manifest (found while building the phone-side sync).
- A small "Sync Test" playlist (4 generated tones from
  `C:\Users\jaima\Music\MusicAppTest`) exists in history — it's the standing
  sample for end-to-end sync tests; please leave it in place.

## Suggested follow-ups for you (not done, by design)

- Settings UI section: Wi-Fi Sync toggle, show IP/port/token, QR code for pairing
  *(done — see 05013a4 and the Settings modal)*
- Call `POST /api/sync/export-manifest` automatically after each completed download job
- Optional: mDNS/Bonjour advertisement so the phone can discover the PC without typing an IP

## Session 2026-07-03 (later): Antigravity WIP completed + UI requirements

Antigravity ran out of quota mid-task; its uncommitted work was preserved as
snapshot commit `bc140cf`. That WIP plus this session together implement the
user's requirements list. Status:

**Already in Antigravity's WIP (`bc140cf`), verified working:**
- Active Job HUD moved above the playlist grid, outside the playlist card,
  with a distinct cyan-tinted background (`.active-job-hud` in `style.css`)
- HUD shows playlist title first, then `↳ <current file>` (new
  `playlist_title` field in `download_state` and the SSE payload)
- Persistent **Individual Downloads** playlist (`id: individual_downloads`):
  single-link downloads route into it in `/api/download`; legacy single-track
  jobs are migrated into it on first `/api/history` call
- Pause counter / player status font doubled (0.65rem → 1.3rem)
- Playlist sidebar stretches to match the grid panel height
  (removed min/max-height constraints; verified bottoms align)

**Added this session (uncommitted on `feature/wifi-sync`):**
- `--text-muted` redefined from gray `#64748b` to `var(--neon-blue)` in
  `style.css` — fixes low-contrast text app-wide via the one variable
- Sidebar track-count line (and % badge) 0.65rem → 0.8rem (`app.js`)
- **Error Details** column after Status in the items grid, populated from
  `error_detail` and updated live from the SSE stream (colspans bumped 8 → 9,
  table min-width 900 → 1080px)
- **All Downloads** virtual playlist now aggregates **audio jobs only**
  (`get_history` skips `format == "video"`); it remains computed-on-request,
  hence permanent and non-deletable by construction
- Individual Downloads records `download_dir` on each queue so the sync
  manifest can resolve its files (same class of bug as the folder-import fix)
- Removed the dead History modal from `index.html` (its open button was
  already gone in the WIP; it held the obsolete Playlists/Single-Files split)
- `.claude/launch.json` added for browser preview via
  `uvicorn main:app --port 8971`

**Note for next session:** the requirement "remove the playlist and individual
download tabs" had no literal match in the UI (sidebar tabs are
Pinned/All/Trash and were left alone); the History modal removal was the
closest fit. Re-check with the user if they meant something else.

**MusicApp direction (documented in memory, not implemented here):** docs will
position the phone app as paired-with-server but standalone-capable — point it
at a folder and import `playlists_manifest.json` (schema v1, same contract as
Wi-Fi Sync). Pipeline: direct YouTube sync with ~2-track lookahead (no full
pre-download), then OneDrive/Google Drive via their APIs.
