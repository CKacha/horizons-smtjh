<script>
  import { onMount, onDestroy } from 'svelte';
  import socket from '../socket.js';
  import { localPlayer, players } from '../gameStore.js';

  const WORLD_W = 3000;
  const WORLD_H = 3000;

  // Lighting / collision constants
  const COLL_W = 600;
  const COLL_H = 600;
  const NUM_RAYS = 360;
  const VISION_RADIUS = 320; // world units
  const RAY_STEP = 5;        // world units per ray step

  let canvas;
  let ctx;
  let animId;

  let camX = 0;
  let camY = 0;

  // Map
  let mapImage = null;
  let mapLoaded = false;
  let collisionData = null; // Uint8ClampedArray RGBA, COLL_W × COLL_H

  // Lighting
  let lightCanvas = null;
  let lightCtx = null;

  // Server position targets + smoothed render positions
  const targets = new Map();
  const lerped  = new Map();

  let localVal    = null;
  let playersVal  = new Map();

  const unsubLocal   = localPlayer.subscribe((v) => (localVal = v));
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

  // ---- Helpers ----
  function lerp(a, b, t) { return a + (b - a) * t; }

  /**
   * Sample the pre-built collision grid to check if a world-space
   * position is on a walkable (non-black) pixel.
   */
  function isWalkableClient(wx, wy) {
    if (!collisionData) return true;
    const cx = Math.floor((wx / WORLD_W) * COLL_W);
    const cy = Math.floor((wy / WORLD_H) * COLL_H);
    if (cx < 0 || cy < 0 || cx >= COLL_W || cy >= COLL_H) return false;
    const idx = (cy * COLL_W + cx) * 4;
    return (collisionData[idx] + collisionData[idx + 1] + collisionData[idx + 2]) > 30;
  }

  // ---- Drawing ----

  function drawMap() {
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, 0, w, h);

    if (mapLoaded && mapImage) {
      ctx.drawImage(mapImage, -camX, -camY, WORLD_W, WORLD_H);
    } else {
      // Fallback grid while map loads
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

    ctx.fillStyle = '#e94560';
    [[0, 0], [WORLD_W, 0], [0, WORLD_H], [WORLD_W, WORLD_H]].forEach(([cx2, cy2]) => {
      ctx.beginPath();
      ctx.arc(cx2 - camX, cy2 - camY, 8, 0, Math.PI * 2);
      ctx.fill();
    });
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

  /**
   * Cast rays outward from the local player in world space,
   * stopping at black pixels in the collision grid.
   * Returns screen-space polygon points and player screen position.
   */
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

  /**
   * Composite a dark vignette over the scene, with the player's
   * raycasted visible area cut out using a radial gradient.
   * This creates shadowed walls and a torch/flashlight feel.
   */
  function drawLighting() {
    if (!lightCanvas) return;

    const w = canvas.width;
    const h = canvas.height;

    // Keep light canvas in sync with main canvas size
    if (lightCanvas.width !== w || lightCanvas.height !== h) {
      lightCanvas.width = w;
      lightCanvas.height = h;
    }

    lightCtx.clearRect(0, 0, w, h);
    // Dark overlay — slight transparency so unlit areas aren't pitch black
    lightCtx.fillStyle = 'rgba(0,0,0,0.88)';
    lightCtx.fillRect(0, 0, w, h);

    const result = castRays();
    if (result) {
      const { points, px, py } = result;

      // Radial gradient: fully transparent at player, fades to opaque at vision edge
      const grad = lightCtx.createRadialGradient(px, py, 0, px, py, VISION_RADIUS);
      grad.addColorStop(0,    'rgba(0,0,0,1)');
      grad.addColorStop(0.65, 'rgba(0,0,0,0.9)');
      grad.addColorStop(1,    'rgba(0,0,0,0)');

      // destination-out erases the dark overlay inside the visible polygon
      lightCtx.globalCompositeOperation = 'destination-out';
      lightCtx.beginPath();
      lightCtx.moveTo(points[0].sx, points[0].sy);
      for (let i = 1; i < points.length; i++) {
        lightCtx.lineTo(points[i].sx, points[i].sy);
      }
      lightCtx.closePath();
      lightCtx.fillStyle = grad;
      lightCtx.fill();
      lightCtx.globalCompositeOperation = 'source-over';
    }

    ctx.drawImage(lightCanvas, 0, 0);
  }

  function draw() {
    if (!ctx) { animId = requestAnimationFrame(draw); return; }

    const w = canvas.width;
    const h = canvas.height;

    // Lerp all player positions toward server targets
    playersVal.forEach((_, id) => {
      const t = targets.get(id);
      const l = lerped.get(id);
      if (!t || !l) return;
      l.x = lerp(l.x, t.x, 0.18);
      l.y = lerp(l.y, t.y, 0.18);
    });

    // Camera tracks local player
    if (localVal) {
      const l = lerped.get(localVal.id);
      if (l) {
        camX = l.x - w / 2;
        camY = l.y - h / 2;
      }
    }

    drawMap();

    // Other players behind local
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

    // Lighting overlay (drawn over world + players)
    drawLighting();

    // HUD always visible above lighting
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
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

    // Load map image; build collision grid once decoded
    const img = new Image();
    img.src = '/map.png';
    img.onload = () => {
      mapImage = img;
      mapLoaded = true;

      // Downsample to collision grid for fast per-pixel lookups
      const offCanvas = document.createElement('canvas');
      offCanvas.width = COLL_W;
      offCanvas.height = COLL_H;
      const offCtx = offCanvas.getContext('2d');
      offCtx.drawImage(img, 0, 0, COLL_W, COLL_H);
      collisionData = offCtx.getImageData(0, 0, COLL_W, COLL_H).data;
    };

    // Separate offscreen canvas for the dark lighting layer
    lightCanvas = document.createElement('canvas');
    lightCanvas.width = canvas.width;
    lightCanvas.height = canvas.height;
    lightCtx = lightCanvas.getContext('2d');

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
