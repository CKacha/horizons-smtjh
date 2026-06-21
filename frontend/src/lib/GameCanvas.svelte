<script>
  import { onMount, onDestroy } from 'svelte';
  import socket from '../socket.js';
  import { localPlayer, players, phase, myRole } from '../gameStore.js';

  const WORLD_W = 3000;
  const WORLD_H = 3000;
  const COLL_W = 600;
  const COLL_H = 600;
  const NUM_RAYS = 360;
  const VISION_RADIUS = 320;
  const RAY_STEP = 5;

  let canvas;
  let ctx;
  let animId;
  let camX = 0;
  let camY = 0;

  // Map / lighting
  let mapImage = null;
  let mapLoaded = false;
  let collisionData = null;
  let lightCanvas = null;
  let lightCtx = null;

  const targets = new Map();
  const lerped  = new Map();

  let localVal   = null;
  let playersVal = new Map();
  let phaseVal   = 'lobby';
  let roleVal    = null;
  let showRoleReveal = false;
  let roleRevealTimer = null;
  let isMobile = false;

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
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = keyMap(e.key);
    if (k && !keys[k]) { keys[k] = true; socket.emit('input', { ...keys }); }
  }

  function onKeyUp(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = keyMap(e.key);
    if (k) { keys[k] = false; socket.emit('input', { ...keys }); }
  }

  function setKey(dir, val) {
    keys[dir] = val;
    socket.emit('input', { ...keys });
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

  // Helpers
  function lerp(a, b, t) { return a + (b - a) * t; }

  function isWalkableClient(wx, wy) {
    if (!collisionData) return true;
    const cx = Math.floor((wx / WORLD_W) * COLL_W);
    const cy = Math.floor((wy / WORLD_H) * COLL_H);
    if (cx < 0 || cy < 0 || cx >= COLL_W || cy >= COLL_H) return false;
    const idx = (cy * COLL_W + cx) * 4;
    return (collisionData[idx] + collisionData[idx + 1] + collisionData[idx + 2]) > 30;
  }

  // Drawing
  function drawMap() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, 0, w, h);

    if (mapLoaded && mapImage) {
      ctx.drawImage(mapImage, -camX, -camY, WORLD_W, WORLD_H);
    } else {
      const gs = 100;
      ctx.strokeStyle = '#1c1c30';
      ctx.lineWidth = 1;
      const gx0 = Math.floor(camX / gs) * gs;
      const gy0 = Math.floor(camY / gs) * gs;
      for (let x = gx0; x < camX + w; x += gs) {
        ctx.beginPath(); ctx.moveTo(x - camX, 0); ctx.lineTo(x - camX, h); ctx.stroke();
      }
      for (let y = gy0; y < camY + h; y += gs) {
        ctx.beginPath(); ctx.moveTo(0, y - camY); ctx.lineTo(w, y - camY); ctx.stroke();
      }
    }

    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 4;
    ctx.strokeRect(-camX, -camY, WORLD_W, WORLD_H);
  }

  function drawCrewmate(x, y, color, name, isLocal) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 20, 26, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y - 16, 18, 0, Math.PI * 2);
    ctx.fill();

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

    ctx.fillStyle = color;
    ctx.fillRect(x + 17, y + 2, 9, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x + 17, y + 2, 9, 18);

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

  function castRays() {
    if (!localVal || !collisionData) return null;
    const l = lerped.get(localVal.id);
    if (!l) return null;
    const px = l.x - camX;
    const py = l.y - camY;
    const points = [];
    for (let i = 0; i < NUM_RAYS; i++) {
      const angle = (i / NUM_RAYS) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      let dist = 0;
      while (dist < VISION_RADIUS) {
        dist += RAY_STEP;
        if (!isWalkableClient(l.x + cosA * dist, l.y + sinA * dist)) {
          dist = Math.max(0, dist - RAY_STEP);
          break;
        }
      }
      points.push({ sx: px + cosA * dist, sy: py + sinA * dist });
    }
    return { points, px, py };
  }

  function drawLighting() {
    if (!lightCanvas) return;
    const w = canvas.width;
    const h = canvas.height;
    if (lightCanvas.width !== w || lightCanvas.height !== h) {
      lightCanvas.width = w;
      lightCanvas.height = h;
    }
    lightCtx.clearRect(0, 0, w, h);
    lightCtx.fillStyle = 'rgba(0,0,0,0.6)';
    lightCtx.fillRect(0, 0, w, h);

    const result = castRays();
    if (result) {
      const { points, px, py } = result;
      const grad = lightCtx.createRadialGradient(px, py, 0, px, py, VISION_RADIUS);
      grad.addColorStop(0,    'rgba(0,0,0,1)');
      grad.addColorStop(0.65, 'rgba(0,0,0,0.9)');
      grad.addColorStop(1,    'rgba(0,0,0,0)');
      lightCtx.globalCompositeOperation = 'destination-out';
      lightCtx.beginPath();
      lightCtx.moveTo(points[0].sx, points[0].sy);
      for (let i = 1; i < points.length; i++) lightCtx.lineTo(points[i].sx, points[i].sy);
      lightCtx.closePath();
      lightCtx.fillStyle = grad;
      lightCtx.fill();
      lightCtx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(lightCanvas, 0, 0);
  }

  function drawMinimap() {
    const pad = 16;
    const mw = 180, mh = 90;
    const mx = canvas.width  - mw - pad;
    const my = canvas.height - mh - pad;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(mx - 4, my - 4, mw + 8, mh + 8);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 4, my - 4, mw + 8, mh + 8);

    if (mapLoaded && mapImage) {
      ctx.globalAlpha = 0.7;
      ctx.drawImage(mapImage, mx, my, mw, mh);
      ctx.globalAlpha = 1;
    }

    playersVal.forEach((p, id) => {
      const l = lerped.get(id);
      if (!l) return;
      const isLocal = localVal && id === localVal.id;
      const dotX = mx + (l.x / WORLD_W) * mw;
      const dotY = my + (l.y / WORLD_H) * mh;
      ctx.beginPath();
      ctx.arc(dotX, dotY, isLocal ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isLocal ? '#ffffff' : p.color;
      ctx.fill();
    });

    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('MAP', mx - 2, my - 7);
  }

  function draw() {
    if (!ctx) { animId = requestAnimationFrame(draw); return; }
    const w = canvas.width;
    const h = canvas.height;

    playersVal.forEach((_, id) => {
      const t = targets.get(id);
      const l = lerped.get(id);
      if (!t || !l) return;
      l.x = lerp(l.x, t.x, 0.18);
      l.y = lerp(l.y, t.y, 0.18);
    });

    if (localVal) {
      const l = lerped.get(localVal.id);
      if (l) { camX = l.x - w / 2; camY = l.y - h / 2; }
    }

    drawMap();

    playersVal.forEach((p, id) => {
      if (localVal && id === localVal.id) return;
      const l = lerped.get(id);
      if (!l) return;
      drawCrewmate(l.x - camX, l.y - camY, p.color, p.name, false);
    });

    if (localVal) {
      const l = lerped.get(localVal.id);
      const p = playersVal.get(localVal.id);
      if (l && p) drawCrewmate(l.x - camX, l.y - camY, p.color, p.name, true);
    }

    drawLighting();
    drawMinimap();

    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`players: ${playersVal.size}/10`, 12, 20);
    if (phaseVal === 'lobby') {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
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
    isMobile = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Load map image and build client-side collision grid for raycasting
    const img = new Image();
    img.src = '/map.png';
    img.onload = () => {
      mapImage = img;
      mapLoaded = true;
      const off = document.createElement('canvas');
      off.width = COLL_W; off.height = COLL_H;
      const offCtx = off.getContext('2d');
      offCtx.drawImage(img, 0, 0, COLL_W, COLL_H);
      collisionData = offCtx.getImageData(0, 0, COLL_W, COLL_H).data;
    };

    lightCanvas = document.createElement('canvas');
    lightCanvas.width  = canvas.width;
    lightCanvas.height = canvas.height;
    lightCtx = lightCanvas.getContext('2d');

    let playerId   = localStorage.getItem('playerId');
    let playerName = localStorage.getItem('playerName');
    if (!playerId) {
      playerId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
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

  function startGame() { socket.emit('start_game'); }
</script>

<div class="root">
  <canvas bind:this={canvas} />

  {#if phaseVal === 'lobby'}
    <div class="overlay lobby">
      <p class="lobby-title">WAITING IN LOBBY</p>
      <p class="lobby-sub">{playersVal.size} / 10 players connected</p>
      <button on:click={startGame} disabled={playersVal.size < 2}>START GAME</button>
      {#if playersVal.size < 2}
        <p class="lobby-hint">Need at least 2 players to start</p>
      {/if}
    </div>
  {/if}

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

  {#if phaseVal === 'playing' && roleVal && !showRoleReveal}
    <div class="role-badge {roleVal}">{roleVal.toUpperCase()}</div>
  {/if}

  {#if isMobile && phaseVal === 'playing'}
    <div class="dpad">
      <button class="dpad-btn up"
        on:touchstart|preventDefault={() => setKey('up', true)}
        on:touchend|preventDefault={() => setKey('up', false)}
        on:touchcancel={() => setKey('up', false)}>▲</button>
      <button class="dpad-btn left"
        on:touchstart|preventDefault={() => setKey('left', true)}
        on:touchend|preventDefault={() => setKey('left', false)}
        on:touchcancel={() => setKey('left', false)}>◀</button>
      <div class="dpad-center" />
      <button class="dpad-btn right"
        on:touchstart|preventDefault={() => setKey('right', true)}
        on:touchend|preventDefault={() => setKey('right', false)}
        on:touchcancel={() => setKey('right', false)}>▶</button>
      <button class="dpad-btn down"
        on:touchstart|preventDefault={() => setKey('down', true)}
        on:touchend|preventDefault={() => setKey('down', false)}
        on:touchcancel={() => setKey('down', false)}>▼</button>
    </div>
  {/if}
</div>

<style>
  .root { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
  canvas { display: block; }

  .overlay {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; pointer-events: none;
  }

  .lobby { background: rgba(0,0,0,0.65); pointer-events: all; }
  .lobby-title { font: bold 28px monospace; color: #fff; letter-spacing: 4px; }
  .lobby-sub   { font: 14px monospace; color: rgba(255,255,255,0.5); }
  .lobby-hint  { font: 11px monospace; color: rgba(255,255,255,0.3); }

  .lobby button {
    margin-top: 8px; padding: 12px 36px;
    background: #e94560; color: #fff;
    border: none; font: bold 15px monospace; letter-spacing: 2px; cursor: pointer;
  }
  .lobby button:disabled { background: #444; color: #888; cursor: not-allowed; }
  .lobby button:not(:disabled):hover { background: #ff6080; }

  .role-reveal { pointer-events: none; }
  .role-reveal.alien    { background: rgba(80,0,0,0.85); }
  .role-reveal.resident { background: rgba(0,30,80,0.85); }
  .role-label { font: 14px monospace; color: rgba(255,255,255,0.6); letter-spacing: 4px; }
  .role-name  { font: bold 48px monospace; color: #fff; letter-spacing: 6px; }
  .role-hint  { font: 13px monospace; color: rgba(255,255,255,0.5); margin-top: 8px; }

  .role-badge {
    position: absolute; top: 12px; right: 12px;
    padding: 4px 12px; font: bold 11px monospace; letter-spacing: 2px;
    border-radius: 3px; pointer-events: none;
  }
  .role-badge.alien    { background: #7a0000; color: #ff6666; }
  .role-badge.resident { background: #00207a; color: #66aaff; }

  .dpad {
    position: absolute;
    bottom: 36px;
    left: 36px;
    display: grid;
    grid-template-columns: 64px 64px 64px;
    grid-template-rows: 64px 64px 64px;
    gap: 4px;
    pointer-events: all;
  }

  .dpad-btn {
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.25);
    color: #fff;
    font-size: 22px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .dpad-btn:active { background: rgba(255,255,255,0.35); }

  .dpad-btn.up    { grid-column: 2; grid-row: 1; }
  .dpad-btn.left  { grid-column: 1; grid-row: 2; }
  .dpad-center    { grid-column: 2; grid-row: 2; }
  .dpad-btn.right { grid-column: 3; grid-row: 2; }
  .dpad-btn.down  { grid-column: 2; grid-row: 3; }
</style>
