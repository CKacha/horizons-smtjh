const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sharp = require('sharp');
const path = require('path');

const app = express();
const server = http.createServer(app);
const CORS_ORIGIN = /^http:\/\/localhost:\d+$/;

const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

const WORLD_W = 3000;
const WORLD_H = 3000;
const SPEED = 4;
const TICK_MS = 50;
const PLAYER_RADIUS = 16;

// Resolution of the server-side collision grid
const COLL_SIZE = 1500;

const COLORS = ['#e94560', '#4ea8de', '#50c878', '#f5a623', '#c678dd', '#7ed6df', '#ff9f43', '#a8ff78'];
const players = new Map();

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ---- Collision map ----
let collData = null; // Uint8Array, RGB, COLL_SIZE × COLL_SIZE

async function loadCollisionMap() {
  const mapPath = path.join(__dirname, '..', 'frontend', 'static', 'map.png');
  try {
    const { data } = await sharp(mapPath)
      .resize(COLL_SIZE, COLL_SIZE, { fit: 'fill' })
      .flatten({ background: '#000000' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    collData = data;
    console.log(`collision map loaded (${COLL_SIZE}×${COLL_SIZE})`);
  } catch (err) {
    console.error('failed to load collision map:', err.message);
  }
}

function isWalkable(wx, wy) {
  if (!collData) return true;
  const cx = Math.floor((wx / WORLD_W) * COLL_SIZE);
  const cy = Math.floor((wy / WORLD_H) * COLL_SIZE);
  if (cx < 0 || cy < 0 || cx >= COLL_SIZE || cy >= COLL_SIZE) return false;
  const idx = (cy * COLL_SIZE + cx) * 3;
  return (collData[idx] + collData[idx + 1] + collData[idx + 2]) > 30;
}

function randomWalkablePos() {
  for (let i = 0; i < 2000; i++) {
    const x = 200 + Math.random() * (WORLD_W - 400);
    const y = 200 + Math.random() * (WORLD_H - 400);
    if (isWalkable(x, y)) return { x, y };
  }
  // Systematic scan as last resort
  for (let x = 100; x < WORLD_W - 100; x += 30) {
    for (let y = 100; y < WORLD_H - 100; y += 30) {
      if (isWalkable(x, y)) return { x, y };
    }
  }
  return { x: WORLD_W / 2, y: WORLD_H / 2 };
}

// ---- Socket.IO ----
io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join', ({ name }) => {
    const { x, y } = randomWalkablePos();
    const player = {
      id: socket.id,
      name: (name || 'Player').slice(0, 16),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      x,
      y,
      input: { up: false, down: false, left: false, right: false },
    };
    players.set(socket.id, player);
    socket.emit('player_init', player);
    socket.emit('game_state', Array.from(players.values()));
    socket.broadcast.emit('player_joined', player);
  });

  socket.on('input', (input) => {
    const p = players.get(socket.id);
    if (p) p.input = input;
  });

  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id);
    players.delete(socket.id);
    io.emit('player_left', socket.id);
  });
});

// ---- Game loop ----
setInterval(() => {
  if (players.size === 0) return;
  players.forEach((p) => {
    const dx = (p.input.right ? SPEED : 0) - (p.input.left ? SPEED : 0);
    const dy = (p.input.down ? SPEED : 0) - (p.input.up ? SPEED : 0);

    const nx = clamp(p.x + dx, 30, WORLD_W - 30);
    const ny = clamp(p.y + dy, 30, WORLD_H - 30);

    // Check x axis: centre + top/bottom edges of player circle
    const xOk = isWalkable(nx, p.y)
              && isWalkable(nx, p.y - PLAYER_RADIUS)
              && isWalkable(nx, p.y + PLAYER_RADIUS);

    // Check y axis: centre + left/right edges of player circle
    const yOk = isWalkable(p.x, ny)
              && isWalkable(p.x - PLAYER_RADIUS, ny)
              && isWalkable(p.x + PLAYER_RADIUS, ny);

    if (xOk) p.x = nx;
    if (yOk) p.y = ny;
  });
  io.emit('game_state', Array.from(players.values()));
}, TICK_MS);

// ---- Start (after collision map is ready) ----
const PORT = process.env.PORT || 3000;
loadCollisionMap().finally(() => {
  server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`));
});
