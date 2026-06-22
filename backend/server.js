const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors   = require('cors');
const path   = require('path');
const { findOrCreate, recordGamePlayed, recordKill, getLeaderboard } = require('./db');

const app    = express();
const server = http.createServer(app);
const anyOrigin = (o, cb) => cb(null, true);
const io = new Server(server, { cors: { origin: anyOrigin, methods: ['GET','POST'] } });
app.use(cors({ origin: anyOrigin }));
app.use(express.json());

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.get('/api/health',      (_req, res) => res.json({ status: 'ok' }));
app.get('/api/leaderboard', (_req, res) => res.json(getLeaderboard.all()));

// ── World ─────────────────────────────────────────────────────────────────────
// One map is chosen per game (1500×1500 square, matching 20000×20000 source PNGs).
const WORLD_W   = 1500;
const WORLD_H   = 1500;
const SPEED     = 7;
const TICK_MS   = 50;
const MAX_PLAYERS = 10;
const COLORS = ['#e94560','#4ea8de','#50c878','#f5a623','#c678dd','#7ed6df','#ff9f43','#a8ff78'];

const TASK_RADIUS = 100;
const KILL_RADIUS = 130;
const KILL_CD_MS  = 30000;
const FIRE_MS     = 60000;
const TASKS_PER   = 3;

// Per-map configuration: tasks, sabotage zones, nuke pad.
// Russia uranium task is blocked when fire_1 (Reactor Core) is active.
const MAP_CONFIGS = {
  russia: {
    taskZones: [
      { id: 'generator', x: 340,  y: 170, name: 'Fix Generator',    difficulty: 1, duration: 4000 },
      { id: 'cooling',   x: 820,  y: 290, name: 'Repair Cooling',   difficulty: 1, duration: 4000 },
      { id: 'signals',   x: 360,  y: 625, name: 'Decode Signals',   difficulty: 2, duration: 6000 },
      { id: 'uranium',   x: 760,  y: 825, name: 'Extract Uranium',  difficulty: 3, duration: 9000 },
      { id: 'lab',       x: 1200, y: 240, name: 'Lab Analysis',     difficulty: 2, duration: 6000 },
      { id: 'calibrate', x: 1180, y: 690, name: 'Calibrate Array',  difficulty: 2, duration: 5000 },
    ],
    sabotageZones: [
      { id: 'fire_1', x: 620, y: 460, name: 'Reactor Core' },
    ],
    nuke: { x: 760, y: 1200 },
  },
  usa: {
    taskZones: [
      { id: 'fuel',      x: 400,  y: 220,  name: 'Refuel Reactor',  difficulty: 1, duration: 4000 },
      { id: 'comms',     x: 920,  y: 365,  name: 'Restore Comms',   difficulty: 2, duration: 5000 },
      { id: 'weapon',    x: 1220, y: 560,  name: 'Arm Warhead',     difficulty: 3, duration: 8000 },
      { id: 'launchpad', x: 1000, y: 990,  name: 'Launchpad Check', difficulty: 1, duration: 3000 },
      { id: 'bunker',    x: 300,  y: 800,  name: 'Secure Bunker',   difficulty: 2, duration: 5000 },
      { id: 'radar',     x: 700,  y: 1100, name: 'Radar Station',   difficulty: 1, duration: 4000 },
    ],
    sabotageZones: [
      { id: 'fire_1', x: 700, y: 670, name: 'Control Room' },
    ],
    nuke: { x: 1000, y: 1225 },
  },
};

// ── Movement bounds ──────────────────────────────────────────────────────────
// No pixel-collision walls — the map is open. Players are only kept inside the world.
const PLAYER_R = 14;
function isWalkable(wx, wy) {
  return wx >= PLAYER_R && wy >= PLAYER_R && wx <= WORLD_W - PLAYER_R && wy <= WORLD_H - PLAYER_R;
}
function canMoveX(p, dx) { return isWalkable(p.x + dx, p.y); }
function canMoveY(p, dy) { return isWalkable(p.x, p.y + dy); }

// ── Runtime state ─────────────────────────────────────────────────────────────
const players     = new Map();  // socketId → player
const roles       = new Map();  // socketId → 'alien'|'resident'
const playerTasks = new Map();  // uuid     → { assigned[], completed[], inProgress }
const killCDs     = new Map();  // socketId → lastKillTimestamp

let currentMap    = null;       // 'russia' | 'usa' — set at start_game
let activeConfig  = null;       // MAP_CONFIGS[currentMap]
let fires         = {};         // { fire_1: { active, timer } }
let phase         = 'lobby';
let gameOver      = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function randomPos() {
  const margin = 100;
  let x, y, tries = 0;
  do {
    x = margin + Math.random() * (WORLD_W - margin * 2);
    y = margin + Math.random() * (WORLD_H - margin * 2);
    tries++;
  } while (!isWalkable(x, y) && tries < 300);
  return { x, y };
}

function firesPayload() {
  return Object.entries(fires).map(([id, f]) => ({ id, active: f.active }));
}

function allRolesPayload() {
  const out = {};
  players.forEach((p, sid) => { if (roles.has(sid)) out[p.id] = roles.get(sid); });
  return out;
}

function assignRoles() {
  const ids = [...players.keys()].sort(() => Math.random() - 0.5);
  const alienCount = Math.min(2, Math.max(1, Math.floor(ids.length / 3)));
  roles.clear();
  ids.forEach((id, i) => roles.set(id, i < alienCount ? 'alien' : 'resident'));
}

function assignTasks() {
  playerTasks.clear();
  players.forEach((player, sid) => {
    if (roles.get(sid) !== 'resident') return;
    const shuffled = [...activeConfig.taskZones].sort(() => Math.random() - 0.5);
    playerTasks.set(player.id, {
      assigned:   shuffled.slice(0, TASKS_PER).map(t => t.id),
      completed:  [],
      inProgress: null,
    });
  });
}

function resetFireState() {
  Object.values(fires).forEach(f => { if (f.timer) clearTimeout(f.timer); });
  fires = {};
  if (activeConfig) {
    activeConfig.sabotageZones.forEach(z => { fires[z.id] = { active: false, timer: null }; });
  }
}

function checkWinCondition() {
  if (gameOver || roles.size === 0) return;
  let residentsAlive = 0, aliensAlive = 0;
  players.forEach((p, sid) => {
    if (!p.alive) return;
    if (roles.get(sid) === 'resident') residentsAlive++; else aliensAlive++;
  });
  if (residentsAlive === 0) { endGame('aliens',    'All residents eliminated'); return; }
  if (aliensAlive === 0)    { endGame('residents', 'All aliens eliminated');    return; }
  if (aliensAlive >= residentsAlive) endGame('aliens', 'Aliens outnumber residents');
}

function endGame(winner, reason) {
  if (gameOver) return;
  gameOver = true; phase = 'gameover';
  resetFireState();
  io.emit('game_over', { winner, reason });
  setTimeout(() => {
    phase = 'lobby'; gameOver = false;
    playerTasks.clear(); killCDs.clear();
    io.emit('phase_change', 'lobby');
  }, 12000);
}

// ── Socket handlers ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join', ({ playerId, name }) => {
    if (players.size >= MAX_PLAYERS) { socket.emit('error', 'Game full'); return; }
    const id       = (typeof playerId === 'string' && playerId.length <= 64) ? playerId : socket.id;
    const safeName = (typeof name === 'string' ? name : 'Player').replace(/[<>]/g, '').slice(0, 16) || 'Player';
    const color    = COLORS[Math.floor(Math.random() * COLORS.length)];
    let saved;
    try { saved = findOrCreate(id, safeName, color); }
    catch (err) { console.error('db error:', err); saved = { name: safeName, color }; }
    const pos    = randomPos();
    const player = { id, name: saved.name, color: saved.color, x: pos.x, y: pos.y,
                     input: { up: false, down: false, left: false, right: false }, alive: true };
    players.set(socket.id, player);
    socket.emit('player_init', { player, phase, role: roles.get(socket.id) || null, map: currentMap });
    socket.emit('game_state', Array.from(players.values()));
    if (phase === 'playing' && activeConfig) {
      socket.emit('game_setup', {
        map: currentMap,
        taskZones:     activeConfig.taskZones,
        sabotageZones: activeConfig.sabotageZones,
        nukeZone:      activeConfig.nuke,
        myTasks:       playerTasks.get(player.id) || null,
        fires:         firesPayload(),
        allRoles:      allRolesPayload(),
      });
    }
    socket.broadcast.emit('player_joined', player);
  });

  socket.on('input', (input) => {
    const p = players.get(socket.id);
    if (p && p.alive && input && typeof input === 'object') p.input = input;
  });

  socket.on('start_game', () => {
    if (phase !== 'lobby' || players.size < 2) return;

    // Pick map for this game
    currentMap   = Math.random() < 0.5 ? 'russia' : 'usa';
    activeConfig = MAP_CONFIGS[currentMap];

    phase = 'playing'; gameOver = false;
    playerTasks.clear(); killCDs.clear();

    // Initialise fire state for chosen map
    fires = {};
    activeConfig.sabotageZones.forEach(z => { fires[z.id] = { active: false, timer: null }; });

    assignRoles();
    assignTasks();
    players.forEach(p => { try { recordGamePlayed(p.id); } catch (_) {} });

    const allRoles = allRolesPayload();
    players.forEach((player, sid) => {
      const role = roles.get(sid);
      io.to(sid).emit('game_started', { role, map: currentMap });
      io.to(sid).emit('game_setup', {
        map:           currentMap,
        taskZones:     activeConfig.taskZones,
        sabotageZones: activeConfig.sabotageZones,
        nukeZone:      activeConfig.nuke,
        myTasks:       role === 'resident' ? (playerTasks.get(player.id) || null) : null,
        fires:         firesPayload(),
        allRoles,
      });
    });
    io.emit('phase_change', 'playing');
    console.log(`game started — map: ${currentMap}, roles:`, Object.fromEntries(roles));
  });

  socket.on('task_start', ({ taskId }) => {
    if (phase !== 'playing' || gameOver) return;
    const player = players.get(socket.id);
    if (!player || !player.alive || roles.get(socket.id) !== 'resident') return;
    const tasks = playerTasks.get(player.id);
    if (!tasks || !tasks.assigned.includes(taskId) || tasks.completed.includes(taskId)) return;
    if (taskId === 'uranium' && fires['fire_1']?.active) {
      socket.emit('task_blocked', { taskId, reason: 'Reactor Core is on fire!' }); return;
    }
    const zone = activeConfig.taskZones.find(z => z.id === taskId);
    if (!zone || dist(player, zone) > TASK_RADIUS) return;
    tasks.inProgress = { taskId, startedAt: Date.now(), duration: zone.duration };
  });

  socket.on('task_cancel', () => {
    const player = players.get(socket.id);
    if (!player) return;
    const tasks = playerTasks.get(player.id);
    if (tasks) tasks.inProgress = null;
    socket.emit('task_progress_update', { taskId: null, progress: 0 });
  });

  socket.on('attempt_kill', () => {
    if (phase !== 'playing' || gameOver) return;
    const killer = players.get(socket.id);
    if (!killer || !killer.alive || roles.get(socket.id) !== 'alien') return;
    if (Date.now() - (killCDs.get(socket.id) || 0) < KILL_CD_MS) return;
    let victim = null, best = Infinity;
    players.forEach((p, sid) => {
      if (!p.alive || roles.get(sid) !== 'resident') return;
      const d = dist(killer, p);
      if (d < KILL_RADIUS && d < best) { victim = p; best = d; }
    });
    if (!victim) return;
    victim.alive = false;
    killCDs.set(socket.id, Date.now());
    const tasks = playerTasks.get(victim.id);
    if (tasks) tasks.inProgress = null;
    recordKill(killer.id, victim.id);
    io.emit('player_killed', { victimId: victim.id, killerId: killer.id, x: victim.x, y: victim.y });
    checkWinCondition();
  });

  socket.on('sabotage', ({ zoneId }) => {
    if (phase !== 'playing' || gameOver) return;
    const player = players.get(socket.id);
    if (!player || !player.alive || roles.get(socket.id) !== 'alien') return;
    const zone = activeConfig.sabotageZones.find(z => z.id === zoneId);
    if (!zone || dist(player, zone) > TASK_RADIUS) return;
    const fire = fires[zoneId];
    if (!fire || fire.active) return;
    fire.active = true;
    io.emit('fire_update', firesPayload());
    fire.timer = setTimeout(() => {
      if (fires[zoneId]?.active) endGame('aliens', `${zone.name} meltdown — nuclear explosion`);
    }, FIRE_MS);
  });

  socket.on('extinguish', ({ zoneId }) => {
    if (phase !== 'playing' || gameOver) return;
    const player = players.get(socket.id);
    if (!player || !player.alive || roles.get(socket.id) !== 'resident') return;
    const zone = activeConfig.sabotageZones.find(z => z.id === zoneId);
    if (!zone || dist(player, zone) > TASK_RADIUS) return;
    const fire = fires[zoneId];
    if (!fire || !fire.active) return;
    fire.active = false;
    if (fire.timer) { clearTimeout(fire.timer); fire.timer = null; }
    io.emit('fire_update', firesPayload());
  });

  socket.on('launch_nuke', () => {
    if (phase !== 'playing' || gameOver) return;
    const player = players.get(socket.id);
    if (!player || !player.alive || roles.get(socket.id) !== 'resident') return;
    const tasks = playerTasks.get(player.id);
    if (!tasks || tasks.completed.length < tasks.assigned.length) return;
    if (dist(player, activeConfig.nuke) > TASK_RADIUS) return;
    const success = Math.random() < 0.5;
    socket.emit('nuke_result', { success });
    if (success) endGame('residents', 'Nuke successfully launched!');
  });

  socket.on('chat', ({ message, channel }) => {
    const sender = players.get(socket.id);
    if (!sender) return;
    const text = (typeof message === 'string' ? message : '').trim().slice(0, 200);
    if (!text) return;
    const payload = { senderId: sender.id, name: sender.name, color: sender.color, message: text, channel, timestamp: Date.now() };
    if (channel === 'alien') {
      players.forEach((_, sid) => { if (roles.get(sid) === 'alien') io.to(sid).emit('chat_message', payload); });
    } else {
      io.emit('chat_message', payload);
    }
  });

  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id);
    const p = players.get(socket.id);
    if (p) io.emit('player_left', p.id);
    players.delete(socket.id); roles.delete(socket.id); killCDs.delete(socket.id);
    if (phase === 'playing' && !gameOver) {
      if (players.size < 2) {
        phase = 'lobby'; resetFireState(); io.emit('phase_change', 'lobby');
      } else {
        checkWinCondition();
      }
    }
  });
});

// ── Game tick ─────────────────────────────────────────────────────────────────
setInterval(() => {
  if (players.size === 0) return;

  players.forEach((p) => {
    if (!p.alive) return;
    const dx = (p.input.right ? SPEED : 0) - (p.input.left ? SPEED : 0);
    const dy = (p.input.down  ? SPEED : 0) - (p.input.up   ? SPEED : 0);
    if (dx !== 0 && canMoveX(p, dx)) p.x += dx;
    if (dy !== 0 && canMoveY(p, dy)) p.y += dy;
  });

  if (phase === 'playing' && !gameOver && activeConfig) {
    const now = Date.now();
    playerTasks.forEach((tasks, uuid) => {
      if (!tasks.inProgress) return;
      const { taskId, startedAt, duration } = tasks.inProgress;
      // Auto-cancel uranium if fire starts mid-progress
      if (taskId === 'uranium' && fires['fire_1']?.active) {
        tasks.inProgress = null;
        let pSid = null;
        players.forEach((p, sid) => { if (p.id === uuid) pSid = sid; });
        if (pSid) {
          io.to(pSid).emit('task_progress_update', { taskId: null, progress: 0 });
          io.to(pSid).emit('task_blocked', { taskId, reason: 'Reactor Core fire interrupted uranium extraction!' });
        }
        return;
      }
      let pObj = null, pSid = null;
      players.forEach((p, sid) => { if (p.id === uuid) { pObj = p; pSid = sid; } });
      if (!pObj || !pObj.alive) { tasks.inProgress = null; return; }
      const zone = activeConfig.taskZones.find(z => z.id === taskId);
      if (!zone || dist(pObj, zone) > TASK_RADIUS * 1.5) {
        tasks.inProgress = null;
        if (pSid) io.to(pSid).emit('task_progress_update', { taskId: null, progress: 0 });
        return;
      }
      const progress = Math.min((now - startedAt) / duration, 1);
      if (pSid) io.to(pSid).emit('task_progress_update', { taskId, progress });
      if (progress >= 1) {
        tasks.inProgress = null;
        if (!tasks.completed.includes(taskId)) tasks.completed.push(taskId);
        const allDone = tasks.completed.length >= tasks.assigned.length;
        if (pSid) io.to(pSid).emit('task_completed', { taskId, allDone });
        io.emit('task_complete_broadcast', { playerId: uuid, taskId });
      }
    });
  }

  io.emit('game_state', Array.from(players.values()));
}, TICK_MS);

// ── Startup ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`server on http://0.0.0.0:${PORT}`));
