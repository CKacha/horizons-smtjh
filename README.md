# Horizons

A multiplayer browser game in the style of Among Us — **Residents vs Aliens** set during the Cold War. Two aliens hide among up to eight residents. Residents complete tasks and launch a nuke; aliens kill and sabotage to stop them.

## Requirements

- **Node.js 18+** (required by `sharp` and `better-sqlite3`)
- npm 9+ (comes with Node 18)

`sharp` uses native binaries distributed as prebuilds — no compiler needed on Windows, macOS, or common Linux distros. If you're on an unusual platform and `npm install` fails for sharp, see [sharp's installation docs](https://sharp.pixelplumbing.com/install).

## Setup

```bash
npm install       # install all workspace deps (run once from repo root)
npm run dev       # start backend (port 3000) + frontend (port 5173) concurrently
```

Open `http://localhost:5173`. Any player can click **START GAME** once 2+ players have joined.

### Production

```bash
npm run build                       # builds frontend → frontend/dist/
NODE_ENV=production npm start       # Express serves frontend/dist + API + Socket.IO on port 3000
```

---

## Gameplay

### Teams

| Team | Max players | Sprite |
|------|-------------|--------|
| Residents | 8 | USA crewmate (blue/green) |
| Aliens | 2 | Russia crewmate (red ushanka) |

Roles are **visible** — this is a coordination game, not a deduction game.

### Win Conditions

| Winner | Condition |
|--------|-----------|
| Residents | All 3 tasks per resident completed → nuke launched (50/50 gamble at launch pad) |
| Aliens | Kill residents until aliens ≥ residents alive, OR all aliens eliminated → residents win |
| Aliens | Let a sabotage fire burn unchecked for 60 seconds → nuclear explosion |

### Tasks

Each resident is assigned **3 tasks** from 10 zones spread across both map halves. Stand in a zone circle and press **E** to begin; the task auto-completes server-side while you stay in range.

**Uranium extraction is special**: it is blocked while the Reactor Core fire is active. Extinguish the fire first.

### Sabotage (Aliens)

Press **E** near a sabotage zone to ignite a fire. A siren alarm and flashing banner warn all players. If unchecked for **60 seconds** the aliens win immediately.

- **Reactor Core** (Russia side, x 620, y 460) — also blocks uranium extraction while burning
- **Control Room** (USA side, x 2200, y 670)

Residents press **E** near an active fire (or use the Extinguish button) to put it out.

### Kill (Aliens only)

Press **K** to kill the nearest resident within 130 px world units. 30-second cooldown shown as a draining bar. The victim's body stays on the map as a visual marker and appears on the minimap.

### Nuke Launch

Once a resident completes all 3 of their tasks the launch pad activates for them. Walk to the pad and press **E** — **50% chance of success**. Failure resets the cooldown; keep trying until it fires.

---

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow keys | Move |
| E | Interact — start/cancel task · extinguish fire · launch nuke · sabotage (aliens) |
| K | Kill nearest resident (aliens only, 30 s cooldown) |

Mobile d-pad shown automatically on touch devices.

## Chat

| Channel | Visible to |
|---------|-----------|
| Team | All players |
| Alien | Aliens only (secret) |

Toggle the chat panel with the **CHAT** button (bottom-right, playing phase only).

---

## Map

World: **3000 × 1500**. Left half (x 0–1500) is Russia; right half (x 1500–3000) is the USA. Each half is drawn square (1500 × 1500) to match the 20000 × 20000 source images.

```
Russia (x 0–1500)               USA (x 1500–3000)
────────────────────────────────┼─────────────────────────────
Fix Generator    340,  170      │ Refuel Reactor   1900,  220
Repair Cooling   820,  290      │ Restore Comms    2420,  365
Decode Signals   360,  625      │ Arm Warhead      2720,  560
Extract Uranium  760,  825 *    │ Launchpad Check  2500,  990
Lab Analysis    1200,  240      │   └─ NUKE PAD    2500, 1225
Calibrate Array 1180,  690      │
                                │
FIRE: Reactor Core  620,  460 * │ FIRE: Control Room  2200, 670
```

`*` Reactor Core fire blocks uranium extraction

Black/dark-gray pixels on the map images act as walls (collision grid built at server startup via `sharp`).

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Svelte 4 + Vite, full-screen `<canvas>` (no DOM entities) |
| Backend | Express + Socket.IO (CommonJS, Node.js) |
| Persistence | SQLite via `better-sqlite3` — player names, colors, kills, deaths, games |
| Image processing | `sharp` — resizes 20000×20000 PNGs to collision grids at startup |
| Audio | Web Audio API — procedural siren generated in-browser, no audio files needed |
| Transport | Socket.IO WebSocket; Vite dev proxy forwards `/socket.io` and `/api` to port 3000 |
