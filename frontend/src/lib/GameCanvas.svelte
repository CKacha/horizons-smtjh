<script>
  import { onMount, onDestroy } from 'svelte';
  import socket from '../socket.js';
  import { localPlayer, players, phase, myRole } from '../gameStore.js';
  import { ROOMS, CORRIDORS, MINIMAP } from '../mapData.js';

  let canvas;
  let ctx;
  let animId;

  let camX = 0;
  let camY = 0;

  const targets = new Map();
  const lerped  = new Map();

  let localVal   = null;
  let playersVal = new Map();
  let phaseVal   = 'lobby';
  let roleVal    = null;
  let showRoleReveal = false;
  let roleRevealTimer = null;

  const unsubLocal   = localPlayer.subscribe((v) => (localVal = v));
  const unsubPlayers = players.subscribe((v) => (playersVal = v));
  const unsubPhase   = phase.subscribe((v) => (phaseVal = v));
  const unsubRole    = myRole.subscribe((v) => (roleVal = v));

  // Input
  const keys = { up: false, down: false, left: false, right: false };

  function keyMap(key) {
    if (key === 'ArrowUp'    || key === 'w' || key === 'W') return 'up';
    if (key === 'ArrowDown'  || key === 's' || key === 'S') return 'down';
    if (key === 'ArrowLeft'  || key === 'a' || key === 'A') return 'left';
    if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right';
    return null;
  }

  function onKeyDown(e) {
    const k = keyMap(e.key);
    if (k && !keys[k]) { keys[k] = true; socket.emit('input', { ...keys }); }
  }

  function onKeyUp(e) {
    const k = keyMap(e.key);
    if (k) { keys[k] = false; socket.emit('input', { ...keys }); }
  }

  // Socket events
  socket.on('player_init', ({ player, phase: p, role }) => {
    localPlayer.set(player);
    phase.set(p || 'lobby');
    if (role) myRole.set(role);
    targets.set(player.id, { x: player.x, y: player.y });
    lerped.set(player.id,  { x: player.x, y: player.y });
  });

  socket.on('game_state', (all) => {
    const map = new Map();
    all.forEach((p) => {
      map.set(p.id, p);
      const t = targets.get(p.id);
      if (t) { t.x = p.x; t.y = p.y; }
      else { targets.set(p.id, { x: p.x, y: p.y }); lerped.set(p.id, { x: p.x, y: p.y }); }
    });
    players.set(map);
  });

  socket.on('player_joined', (p) => {
    players.update((map) => { map.set(p.id, p); return map; });
    targets.set(p.id, { x: p.x, y: p.y });
    lerped.set(p.id,  { x: p.x, y: p.y });
  });

  socket.on('player_left', (id) => {
    players.update((map) => { map.delete(id); return map; });
    targets.delete(id);
    lerped.delete(id);
  });

  socket.on('phase_change', (p) => phase.set(p));

  socket.on('game_started', ({ role }) => {
    myRole.set(role);
    phase.set('playing');
    showRoleReveal = true;
    clearTimeout(roleRevealTimer);
    roleRevealTimer = setTimeout(() => (showRoleReveal = false), 3000);
  });

  // Drawing
  function lerp(a, b, t) { return a + (b - a) * t; }

  const ROOM_COLORS = {
    hub:     '#1e2a3a',
    crew:    '#1a2e1e',
    reactor: '#3a1a1a',
    lab:     '#1a1a2e',
    medical: '#1a2a2a',
    control: '#2a1a2e',
  };

  function drawMap() {
    const w = canvas.width;
    const h = canvas.height;

    // Background void
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, w, h);

    // Corridors
    ctx.fillStyle = '#1c1c28';
    CORRIDORS.forEach(({ x, y, w: rw, h: rh }) => {
      ctx.fillRect(x - camX, y - camY, rw, rh);
    });

    // Corridor borders
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 2;
    CORRIDORS.forEach(({ x, y, w: rw, h: rh }) => {
      ctx.strokeRect(x - camX, y - camY, rw, rh);
    });

    // Rooms
    ROOMS.forEach((room) => {
      const sx = room.x - camX;
      const sy = room.y - camY;

      ctx.fillStyle = ROOM_COLORS[room.id] || '#1e1e2e';
      ctx.fillRect(sx, sy, room.w, room.h);

      ctx.strokeStyle = '#3a3a50';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, room.w, room.h);

      // Room label
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillText(room.name.toUpperCase(), sx + room.w / 2, sy + room.h / 2 + 5);
    });
  }

  function drawCrewmate(x, y, color, name, isLocal) {
    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 20, 26, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.arc(x, y - 16, 18, 0, Math.PI * 2);
    ctx.fill();

    // Visor
    ctx.fillStyle = isLocal ? '#a8d8ea' : '#0d0d1a';
    ctx.beginPath();
    ctx.arc(x + 7, y - 19, 10, 0, Math.PI * 2);
    ctx.fill();

    if (isLocal) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(x + 4, y - 23, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Backpack
    ctx.fillStyle = color;
    ctx.fillRect(x + 17, y + 2, 9, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + 17, y + 2, 9, 18);

    // Name tag
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(name).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - tw / 2, y - 50, tw, 16);
    ctx.fillStyle = isLocal ? '#a8d8ea' : '#ffffff';
    ctx.fillText(name, x, y - 38);

    if (isLocal) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y - 56);
      ctx.lineTo(x - 6, y - 66);
      ctx.lineTo(x + 6, y - 66);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawMinimap() {
    const pad = 16;
    const mx = canvas.width  - MINIMAP.w - pad;
    const my = canvas.height - MINIMAP.h - pad;
    const { originX, originY, scale, w: mw, h: mh } = MINIMAP;

    function toMM(wx, wy) {
      return { x: mx + (wx - originX) * scale, y: my + (wy - originY) * scale };
    }

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 4, my - 4, mw + 8, mh + 8);

    // Corridors
    ctx.fillStyle = '#1c1c28';
    CORRIDORS.forEach(({ x, y, w, h }) => {
      const p = toMM(x, y);
      ctx.fillRect(p.x, p.y, w * scale, h * scale);
    });

    // Rooms
    ROOMS.forEach((room) => {
      const p = toMM(room.x, room.y);
      ctx.fillStyle = ROOM_COLORS[room.id] || '#1e1e2e';
      ctx.fillRect(p.x, p.y, room.w * scale, room.h * scale);
      ctx.strokeStyle = '#3a3a50';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(p.x, p.y, room.w * scale, room.h * scale);
    });

    // Players
    playersVal.forEach((p, id) => {
      const l = lerped.get(id);
      if (!l) return;
      const isLocal = localVal && id === localVal.id;
      const pos = toMM(l.x, l.y);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isLocal ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isLocal ? '#ffffff' : p.color;
      ctx.fill();
    });

    // Label
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('MAP', mx - 2, my - 7);
  }

  function draw() {
    if (!ctx) { animId = requestAnimationFrame(draw); return; }

    const w = canvas.width;
    const h = canvas.height;

    // Update lerped positions
    playersVal.forEach((_, id) => {
      const t = targets.get(id);
      const l = lerped.get(id);
      if (!t || !l) return;
      l.x = lerp(l.x, t.x, 0.18);
      l.y = lerp(l.y, t.y, 0.18);
    });

    // Camera follows local player
    if (localVal) {
      const l = lerped.get(localVal.id);
      if (l) { camX = l.x - w / 2; camY = l.y - h / 2; }
    }

    drawMap();

    // Other players
    playersVal.forEach((p, id) => {
      if (localVal && id === localVal.id) return;
      const l = lerped.get(id);
      if (!l) return;
      drawCrewmate(l.x - camX, l.y - camY, p.color, p.name, false);
    });

    // Local player on top
    if (localVal) {
      const l = lerped.get(localVal.id);
      const p = playersVal.get(localVal.id);
      if (l && p) drawCrewmate(l.x - camX, l.y - camY, p.color, p.name, true);
    }

    drawMinimap();

    // HUD — player count + phase
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(`players: ${playersVal.size}/10`, 12, 20);
    if (phaseVal === 'lobby') {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillText('LOBBY', 12, 36);
    }

    animId = requestAnimationFrame(draw);
  }

  function resize() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    let playerId   = localStorage.getItem('playerId');
    let playerName = localStorage.getItem('playerName');
    if (!playerId) {
      playerId   = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      playerName = `crew_${Math.random().toString(36).slice(2, 6)}`;
      localStorage.setItem('playerId',   playerId);
      localStorage.setItem('playerName', playerName);
    }
    socket.emit('join', { playerId, name: playerName });
    draw();
  });

  onDestroy(() => {
    cancelAnimationFrame(animId);
    clearTimeout(roleRevealTimer);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    unsubLocal(); unsubPlayers(); unsubPhase(); unsubRole();
    socket.off('player_init');
    socket.off('game_state');
    socket.off('player_joined');
    socket.off('player_left');
    socket.off('phase_change');
    socket.off('game_started');
  });

  function startGame() {
    socket.emit('start_game');
  }
</script>

<div class="root">
  <canvas bind:this={canvas} />

  <!-- Lobby overlay -->
  {#if phaseVal === 'lobby'}
    <div class="overlay lobby">
      <p class="lobby-title">WAITING IN LOBBY</p>
      <p class="lobby-sub">{playersVal.size} / 10 players connected</p>
      <button on:click={startGame} disabled={playersVal.size < 2}>
        START GAME
      </button>
      {#if playersVal.size < 2}
        <p class="lobby-hint">Need at least 2 players to start</p>
      {/if}
    </div>
  {/if}

  <!-- Role reveal overlay -->
  {#if showRoleReveal && roleVal}
    <div class="overlay role-reveal {roleVal}">
      <p class="role-label">YOU ARE</p>
      <p class="role-name">{roleVal === 'alien' ? 'AN ALIEN' : 'A RESIDENT'}</p>
      <p class="role-hint">
        {roleVal === 'alien'
          ? 'Kill residents. Sabotage. Survive.'
          : 'Complete tasks. Find the aliens. Launch the nuke.'}
      </p>
    </div>
  {/if}

  <!-- Role badge (persistent during game) -->
  {#if phaseVal === 'playing' && roleVal && !showRoleReveal}
    <div class="role-badge {roleVal}">{roleVal.toUpperCase()}</div>
  {/if}
</div>

<style>
  .root {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  canvas {
    display: block;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    pointer-events: none;
  }

  .lobby {
    background: rgba(0, 0, 0, 0.6);
    pointer-events: all;
  }

  .lobby-title {
    font: bold 28px monospace;
    color: #fff;
    letter-spacing: 4px;
  }

  .lobby-sub {
    font: 14px monospace;
    color: rgba(255,255,255,0.5);
  }

  .lobby-hint {
    font: 11px monospace;
    color: rgba(255,255,255,0.3);
  }

  .lobby button {
    margin-top: 8px;
    padding: 12px 36px;
    background: #e94560;
    color: #fff;
    border: none;
    font: bold 15px monospace;
    letter-spacing: 2px;
    cursor: pointer;
    pointer-events: all;
  }

  .lobby button:disabled {
    background: #444;
    color: #888;
    cursor: not-allowed;
  }

  .lobby button:not(:disabled):hover {
    background: #ff6080;
  }

  .role-reveal {
    pointer-events: none;
  }

  .role-reveal.alien {
    background: rgba(80, 0, 0, 0.85);
  }

  .role-reveal.resident {
    background: rgba(0, 30, 80, 0.85);
  }

  .role-label {
    font: 14px monospace;
    color: rgba(255,255,255,0.6);
    letter-spacing: 4px;
  }

  .role-name {
    font: bold 48px monospace;
    color: #fff;
    letter-spacing: 6px;
  }

  .role-hint {
    font: 13px monospace;
    color: rgba(255,255,255,0.5);
    margin-top: 8px;
  }

  .role-badge {
    position: absolute;
    top: 12px;
    right: 12px;
    padding: 4px 12px;
    font: bold 11px monospace;
    letter-spacing: 2px;
    border-radius: 3px;
    pointer-events: none;
  }

  .role-badge.alien    { background: #7a0000; color: #ff6666; }
  .role-badge.resident { background: #00207a; color: #66aaff; }
</style>
