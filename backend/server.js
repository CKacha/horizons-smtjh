const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { findOrCreate, getLeaderboard } = require('./db');
const { SPAWN, isWalkable } = require('./mapData');

const app = express();
const server = http.createServer(app);
const CORS_ORIGIN = /^http:\/\/localhost:\d+$/;

const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/leaderboard', (_req, res) => res.json(getLeaderboard.all()));

const SPEED = 4;
const TICK_MS = 50;
const COLORS = ['#e94560', '#4ea8de', '#50c878', '#f5a623', '#c678dd', '#7ed6df', '#ff9f43', '#a8ff78'];
const MAX_PLAYERS = 10;

const players = new Map();   // socketId → player runtime state
const roles   = new Map();   // socketId → 'alien' | 'resident'
let phase = 'lobby';         // 'lobby' | 'playing'

function assignRoles() {
  const ids = [...players.keys()];
  const shuffled = ids.sort(() => Math.random() - 0.5);
  const alienCount = Math.min(2, Math.max(1, Math.floor(ids.length / 3)));
  roles.clear();
  shuffled.forEach((id, i) => roles.set(id, i < alienCount ? 'alien' : 'resident'));
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join', ({ playerId, name }) => {
    if (players.size >= MAX_PLAYERS) { socket.emit('error', 'Game full'); return; }

    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const id = playerId || socket.id;
    const saved = findOrCreate(id, (name || 'Player').slice(0, 16), color);

    const spread = 100;
    const player = {
      id,
      name: saved.name,
      color: saved.color,
      x: SPAWN.x + (Math.random() - 0.5) * spread,
      y: SPAWN.y + (Math.random() - 0.5) * spread,
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
    if (p && p.alive && phase === 'playing') p.input = input;
  });

  socket.on('start_game', () => {
    if (phase !== 'lobby' || players.size < 2) return;
    phase = 'playing';
    assignRoles();
    players.forEach((_, sid) => {
      io.to(sid).emit('game_started', { role: roles.get(sid) });
    });
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
  if (players.size === 0 || phase !== 'playing') return;

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
server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`));
