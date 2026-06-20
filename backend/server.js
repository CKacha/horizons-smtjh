const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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

const COLORS = ['#e94560', '#4ea8de', '#50c878', '#f5a623', '#c678dd', '#7ed6df', '#ff9f43', '#a8ff78'];

const players = new Map();

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join', ({ name }) => {
    const player = {
      id: socket.id,
      name: (name || 'Player').slice(0, 16),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      x: Math.random() * (WORLD_W - 400) + 200,
      y: Math.random() * (WORLD_H - 400) + 200,
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

setInterval(() => {
  if (players.size === 0) return;
  players.forEach((p) => {
    if (p.input.up)    p.y -= SPEED;
    if (p.input.down)  p.y += SPEED;
    if (p.input.left)  p.x -= SPEED;
    if (p.input.right) p.x += SPEED;
    p.x = clamp(p.x, 30, WORLD_W - 30);
    p.y = clamp(p.y, 30, WORLD_H - 30);
  });
  io.emit('game_state', Array.from(players.values()));
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`));
