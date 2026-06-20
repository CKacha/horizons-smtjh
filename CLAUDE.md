# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A multiplayer browser game (Among Us-style) built with a Svelte frontend and an Express + Socket.IO backend. The two packages are managed as npm workspaces from the root.

## Commands

Run from the repo root (uses npm workspaces):

```bash
npm run dev:frontend      # Start Vite dev server (http://localhost:5173)
npm run dev:backend       # Start backend with nodemon (http://localhost:3000)
npm run start:backend     # Start backend without hot-reload
```

Or run directly from each subdirectory:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
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
        ├── App.svelte           Root component — mounts GameCanvas
        └── lib/GameCanvas.svelte  Full-screen canvas game loop with requestAnimationFrame
```

**Communication**: The frontend connects to the backend via Socket.IO (`socket.io-client`). CORS is locked to `http://localhost:5173` in development — update `backend/server.js` when deploying.

**Frontend rendering**: `GameCanvas.svelte` owns the entire canvas game loop. It draws directly to a `<canvas>` element via the 2D context, not via Svelte's DOM reactivity. New game entities should be drawn inside the `draw()` function and driven by the frame counter `t`.

**Backend state**: `server.js` is the single source of truth for server-side game state. Socket.IO event handlers go inside the `io.on('connection', ...)` block.

## Package Manager

This project uses **npm** (not pnpm) — `package-lock.json` files are present in both `backend/` and `frontend/`. Use `npm install`, not `pnpm install`.
