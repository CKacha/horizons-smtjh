const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sharp = require('sharp');
const path = require('path');
const { findOrCreate, getLeaderboard } = require('./db');

const app = express();
const server = http.createServer(app);

// Accept any origin so LAN devices work without CORS errors
const anyOrigin = (origin, cb) => cb(null, true);
const io = new Server(server, { cors: { origin: anyOrigin, methods: ['GET', 'POST'] } });
app.use(cors({ origin: anyOrigin }));
app.use(express.json());

app.get('/api/health',     (_req, res) => res.json({ status: 'ok' }));
app.get('/api/leaderboard', (_req, res) => res.json(getLeaderboard.all()));

const WORLD_W = 3000;
const WORLD_H = 3000;
const SPEED = 7;
const TICK_MS = 50;
const COLL_SIZE = 1500;
const MAX_PLAYERS = 10;
const COLORS = ['#e94560', '#4ea8de', '#50c878', '#f5a623', '#c678dd', '#7ed6df', '#ff9f43', '#a8ff78'];

const players = new Map();
const roles   = new Map();
let phase = 'lobby';

// Image-based collision map (loaded from map.png at startup)
let collData = null;

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
    console.error('failed to load collision map — movement unrestricted:', err.message);
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
  for (let x = 100; x < WORLD_W - 100; x += 30)
    for (let y = 100; y < WORLD_H - 100; y += 30)
      if (isWalkable(x, y)) return { x, y };
  return { x: WORLD_W / 2, y: WORLD_H / 2 };
}

function assignRoles() {
  const ids = [...players.keys()].sort(() => Math.random() - 0.5);
  const alienCount = Math.min(2, Math.max(1, Math.floor(ids.length / 3)));
  roles.clear();
  ids.forEach((id, i) => roles.set(id, i < alienCount ? 'alien' : 'resident'));
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join', ({ playerId, name }) => {
    if (players.size >= MAX_PLAYERS) { socket.emit('error', 'Game full'); return; }

    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const id = playerId || socket.id;
    const saved = findOrCreate(id, (name || 'Player').slice(0, 16), color);
    const pos = randomWalkablePos();

    const player = {
      id,
      name: saved.name,
      color: saved.color,
      x: pos.x,
      y: pos.y,
      input: { up: false, down: false, left: false, right: false },
      alive: true,
    };

    players.set(socket.id, player);
    socket.emit('player_init', { player, phase, role: roles.get(socket.id) || null });
    socket.emit('game_state', Array.from(players.values()));
    socket.broadcast.emit('player_joined', player);
  });

  socket.on('input', (input) => {
    const p = players.get(socket.id);
    if (p && p.alive) p.input = input;
  });

  socket.on('start_game', () => {
    if (phase !== 'lobby' || players.size < 2) return;
    phase = 'playing';
    assignRoles();
    players.forEach((_, sid) => io.to(sid).emit('game_started', { role: roles.get(sid) }));
    io.emit('phase_change', 'playing');
    console.log('game started — roles:', Object.fromEntries(roles));
  });

  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id);
    players.delete(socket.id);
    roles.delete(socket.id);
    io.emit('player_left', socket.id);
    if (phase === 'playing' && players.size < 2) {
      phase = 'lobby';
      io.emit('phase_change', 'lobby');
    }
  });
});

setInterval(() => {
  if (players.size === 0) return;
  players.forEach((p) => {
    if (!p.alive) return;
    const dx = (p.input.right ? SPEED : 0) - (p.input.left ? SPEED : 0);
    const dy = (p.input.down  ? SPEED : 0) - (p.input.up   ? SPEED : 0);
    if (dx !== 0 && isWalkable(p.x + dx, p.y)) p.x += dx;
    if (dy !== 0 && isWalkable(p.x, p.y + dy)) p.y += dy;
  });
  io.emit('game_state', Array.from(players.values()));
}, TICK_MS);

const PORT = process.env.PORT || 3000;
loadCollisionMap().then(() => {
  server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`));
});
