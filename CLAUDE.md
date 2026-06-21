# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A multiplayer browser game (Among Us-style) — Residents vs Aliens. Svelte 4 frontend with canvas rendering; Express + Socket.IO backend. npm workspaces from the root. Requires **Node.js 18+**.

## Commands

From the **repo root**:

```bash
npm install            # install all workspace deps (run once, or after adding packages)
npm run dev            # starts backend (port 3000) + frontend (port 5173) concurrently
npm run dev:backend    # backend only (nodemon)
npm run dev:frontend   # frontend only (Vite)
npm run build          # production build of frontend → frontend/dist/
npm start              # production server (NODE_ENV=production serves frontend/dist/)
```

## Architecture

```
horizons-smtjh/
├── backend/
│   ├── server.js       Single-file server: REST + Socket.IO + game loop (50 ms tick)
│   └── db.js           SQLite via better-sqlite3; findOrCreate, recordKill, recordGamePlayed, getLeaderboard
└── frontend/
    ├── static/         Public assets served at / (maps, sprites, UI icons)
    └── src/
        ├── App.svelte              Root — mounts GameCanvas only
        ├── socket.js               Singleton socket.io-client
        ├── gameStore.js            Svelte stores: localPlayer, players, phase, myRole
        └── lib/GameCanvas.svelte   Full-screen canvas game loop — owns all rendering and input
```

## Game Design

**World**: 3000 × 1500. Russia = x 0–1500, USA = x 1500–3000. Each half drawn at 1500×1500 (square, matching 20000×20000 source images).

**Teams**: 2 aliens (russia_crewmate sprite), up to 8 residents (usa_crewmate sprite). Roles are public.

**Residents win** by completing all 3 assigned tasks then launching the nuke (50/50 at pad x:2500, y:1225), OR if all aliens are eliminated.

**Aliens win** by killing residents until `aliensAlive >= residentsAlive`, OR by letting a fire burn 60 s.

**Tasks**: 10 zones. 3 assigned per resident. Stand in zone → press E → auto-completes server-side. The `uranium` task is blocked while fire_1 (Reactor Core) is active — cancels mid-progress if fire starts.

**Sabotage**: Fire on a zone → 60 s timer → alien win. Reactor Core fire also blocks uranium extraction. Resident extinguishes with E.

**Kill**: Alien K key → kills nearest resident ≤130 px. 30 s cooldown. Victim leaves a dead body marker (rotated sprite + blood pool) on the map and minimap.

**Siren**: Web Audio API sawtooth oscillator sweeping 300–900 Hz starts when any fire activates, stops when all fires are out or game ends.

## Socket Events

**Server → Client**
| Event | Payload |
|-------|---------|
| `player_init` | `{ player, phase, role }` |
| `game_state` | `Player[]` (every tick) |
| `player_joined` / `player_left` | player object / uuid |
| `phase_change` | `'lobby' \| 'playing' \| 'gameover'` |
| `game_started` | `{ role }` |
| `game_setup` | `{ taskZones, sabotageZones, nukeZone, myTasks, fires, allRoles }` |
| `task_progress_update` | `{ taskId, progress }` |
| `task_completed` | `{ taskId, allDone }` |
| `task_complete_broadcast` | `{ playerId, taskId }` |
| `task_blocked` | `{ taskId, reason }` — emitted when uranium attempted during Reactor Core fire |
| `fire_update` | `[{ id, active }]` |
| `player_killed` | `{ victimId, killerId, x, y }` — x/y is exact kill position for body marker |
| `nuke_result` | `{ success }` |
| `game_over` | `{ winner, reason }` |
| `chat_message` | `{ senderId, name, color, message, channel, timestamp }` |

**Client → Server**
| Event | Payload |
|-------|---------|
| `join` | `{ playerId, name }` |
| `input` | `{ up, down, left, right }` |
| `start_game` | — |
| `task_start` | `{ taskId }` |
| `task_cancel` | — |
| `attempt_kill` | — |
| `sabotage` | `{ zoneId }` |
| `extinguish` | `{ zoneId }` |
| `launch_nuke` | — |
| `chat` | `{ message, channel }` |

## Database (`backend/db.js`)

| Function | When called |
|----------|-------------|
| `findOrCreate(id, name, color)` | On player join — creates row if new, returns existing. Does NOT increment games. |
| `recordGamePlayed(playerId)` | Once per player at `start_game` |
| `recordKill(killerId, victimId)` | On every successful kill — increments kills + deaths |
| `getLeaderboard` | Prepared statement, `.all()` returns top 20 by kills |

Stats table: `kills`, `deaths`, `games` per player_id.

## Static Assets (`frontend/static/`)

Served at `/` in dev (Vite `publicDir: 'static'`) and production.

| File | Usage |
|------|-------|
| `map_russia.png` | Left world half (20000×20000) |
| `map_usa.png` | Right world half (20000×20000) |
| `usa_crewmate.png` | Resident sprite |
| `russia_crewmate.png` | Alien sprite |
| `tool.png` | General task zone icon |
| `uranium.png` | Uranium task zone icon (shown dimmed/on fire when blocked) |
| `kill_symbol.png` | Kill button icon |
| `sabotoge.png` | Sabotage button icon (filename has typo — don't rename, static asset) |
| `fire_extingusher.png` | Shown on active fire zones and extinguish button |
| `launch.png` | Nuke launch pad icon |
| `launch_fail.png` | Available but not currently used in-canvas |
| `victory.png` | Residents win overlay |
| `defeat.png` | Aliens win overlay |

## Key Implementation Notes

- **Canvas only**: `GameCanvas.svelte` draws everything via `ctx` inside `draw()` (rAF loop). No Svelte DOM reactivity for game entities.
- **Movement**: Server-authoritative, 50 ms tick. Client lerps positions at factor 0.18/frame for smoothness.
- **World dimensions**: `WORLD_W = 3000`, `WORLD_H = 1500`. Must match in both `server.js` and `GameCanvas.svelte`.
- **Pixel collision**: `sharp` resizes each map PNG to 1500×1500 at startup, builds a `Uint8Array` (0=wall, 1=walkable). Brightness < 80 = wall. Checks 2 leading-edge points per axis at player radius 14 px. Fallback: bounds-only while loading.
- **Dead bodies**: `player_killed` includes `x, y` (exact server position). Client stores `deadBodies[]` and draws rotated sprite + blood pool ellipse. Cleared on lobby reset.
- **Siren**: Web Audio API — no audio file. `startSiren()` / `stopSiren()` controlled by `fire_update`. Also stopped on game over, lobby reset, `onDestroy`.
- **Uranium block**: Server rejects `task_start` for `'uranium'` if `fires['fire_1'].active`, emits `task_blocked`. Server tick also auto-cancels in-progress uranium task when fire_1 starts. Client shows fire glow on uranium zone + "BLOCKED" label.
- **Player keying**: `socket.id` = server Map key; player objects carry UUID `id`. `player_left` emits UUID.
- **Fog of war**: Offscreen `lightCanvas`, radial gradient composite, drawn after all entities.
- **Chat**: `channel: 'team'` → all; `channel: 'alien'` → server-filtered to alien sockets only.
- **Win condition**: Both `residentsAlive === 0` (alien win) and `aliensAlive === 0` (resident win) are checked. Also checked on player disconnect during a game.
- **DB game count**: Only incremented at `start_game`, not on every join/rejoin.

## Package Manager

Use **npm** (not pnpm). `package-lock.json` files exist in `backend/` and `frontend/`.
