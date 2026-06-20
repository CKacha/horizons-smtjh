# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A multiplayer browser game (Among Us-style) built with a Svelte frontend and an Express + Socket.IO backend. The two packages are managed as npm workspaces from the root.

## Commands

To start localhost, run both of these from the **repo root**:

```bash
npm install     # install all workspace dependencies (run once, or after adding packages)
npm run dev     # starts backend (port 3000) and frontend (port 5173+) concurrently
```

That's it — `concurrently` handles both processes in one terminal.

If you need to run them separately:

```bash
npm run dev:backend       # backend only (nodemon, port 3000)
npm run dev:frontend      # frontend only (Vite, port 5173)
```

Build the frontend for production:

```bash
cd frontend && npm run build
```

## Architecture

```
horizons-smtjh/
├── backend/        Express + Socket.IO server (CommonJS, Node.js)
│   └── server.js   Single-file server; REST health check + Socket.IO connection handling
└── frontend/       Svelte 4 + Vite app (ESM)
    └── src/
        ├── App.svelte              Root component — mounts GameCanvas
        ├── socket.js               Singleton socket.io-client instance
        ├── gameStore.js            Svelte writable stores: localPlayer, players (Map)
        └── lib/GameCanvas.svelte   Full-screen canvas game loop, camera, input, rendering
```

**Communication**: The frontend connects to the backend via Socket.IO (`socket.io-client`). CORS allows any `localhost` port in development (regex `^http://localhost:\d+$`), so Vite picking 5173 or 5174 both work fine.

**Frontend rendering**: `GameCanvas.svelte` owns the entire canvas game loop. It draws directly to a `<canvas>` element via the 2D context, not via Svelte's DOM reactivity. New game entities should be drawn inside the `draw()` function and driven by the frame counter `t`.

**Backend state**: `server.js` is the single source of truth for server-side game state. Socket.IO event handlers go inside the `io.on('connection', ...)` block.

## Package Manager

This project uses **npm** (not pnpm) — `package-lock.json` files are present in both `backend/` and `frontend/`. Use `npm install`, not `pnpm install`.
