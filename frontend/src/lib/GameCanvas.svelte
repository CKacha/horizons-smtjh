<script>
  import { onMount, onDestroy } from 'svelte';
  import socket from '../socket.js';
  import { localPlayer, players } from '../gameStore.js';

  const WORLD_W = 3000;
  const WORLD_H = 3000;

  let canvas;
  let ctx;
  let animId;

  let camX = 0;
  let camY = 0;

  // Raw server positions (snap targets for lerp)
  const targets = new Map();
  // Smoothed render positions
  const lerped = new Map();

  let localVal = null;
  let playersVal = new Map();

  const unsubLocal = localPlayer.subscribe((v) => (localVal = v));
  const unsubPlayers = players.subscribe((v) => (playersVal = v));

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
  socket.on('player_init', (p) => {
    localPlayer.set(p);
    targets.set(p.id, { x: p.x, y: p.y });
    lerped.set(p.id, { x: p.x, y: p.y });
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
    lerped.set(p.id, { x: p.x, y: p.y });
  });

  socket.on('player_left', (id) => {
    players.update((map) => { map.delete(id); return map; });
    targets.delete(id);
    lerped.delete(id);
  });

  // Drawing helpers
  function lerp(a, b, t) { return a + (b - a) * t; }

  function drawMap() {
    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, 0, w, h);

    // Grid
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

    // World border
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 4;
    ctx.strokeRect(0 - camX, 0 - camY, WORLD_W, WORLD_H);

    // Corneers
    ctx.fillStyle = '#e94560';
    const corners = [[0, 0], [WORLD_W, 0], [0, WORLD_H], [WORLD_W, WORLD_H]];
    corners.forEach(([cx2, cy2]) => {
      ctx.beginPath();
      ctx.arc(cx2 - camX, cy2 - camY, 8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

//temp body
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
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
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
      if (l) {
        camX = l.x - w / 2;
        camY = l.y - h / 2;
      }
    }

    drawMap();

    // Draw other players first, then local player on top
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

    // Player count HUD
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(`players: ${playersVal.size}`, 12, 20);

    animId = requestAnimationFrame(draw);
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    socket.emit('join', { name: `crew_${Math.random().toString(36).slice(2, 6)}` });
    draw();
  });

  onDestroy(() => {
    cancelAnimationFrame(animId);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    unsubLocal();
    unsubPlayers();
    socket.off('player_init');
    socket.off('game_state');
    socket.off('player_joined');
    socket.off('player_left');
  });
</script>

<canvas bind:this={canvas} />

<style>
  canvas { display: block; }
</style>
