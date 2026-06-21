<script>
  import { onMount, onDestroy } from 'svelte';
  import socket from '../socket.js';
  import { localPlayer, players as playersStore } from '../gameStore.js';

  // ── Constants ──────────────────────────────────────────────────────────
  const WORLD_W = 1500, WORLD_H = 1500;
  const LERP = 0.18, TASK_R = 100, KILL_R = 130, FOG_R = 300;

  // ── Canvas ─────────────────────────────────────────────────────────────
  let canvas, ctx;
  let W = 800, H = 600;
  let lightCanvas, lightCtx;

  // ── Images ─────────────────────────────────────────────────────────────
  let imgs = {};
  let imgsLoaded = false;

  function loadImg(key, src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { imgs[key] = img; resolve(); };
      img.onerror = () => { imgs[key] = null; resolve(); };
      img.src = src;
    });
  }

  async function loadAllImages() {
    await Promise.all([
      loadImg('mapRussia',    '/map_russia.png'),
      loadImg('mapUSA',       '/map_usa.png'),
      loadImg('playerRussia', '/russia_crewmate.png'),
      loadImg('playerUSA',    '/usa_crewmate.png'),
      loadImg('deadRussia',   '/dead_russia.png'),
      loadImg('deadUSA',      '/dead_usa.png'),
      loadImg('russiaAlien',  '/russia_alien_start.png'),
      loadImg('russiaCrew',   '/russia_crew_start.png'),
      loadImg('usaAlien',     '/usa_alien_start.png'),
      loadImg('usaCrew',      '/usa_crewmate_start.png'),
      loadImg('russiaKill',   '/russia_kill.png'),
      loadImg('usaKill',      '/usa_kill.png'),
      loadImg('russiaNuke',   '/russia_nuke_launch.png'),
      loadImg('usaNuke',      '/usa_nuke_launch.png'),
      loadImg('fire',         '/fire.png'),
      loadImg('siren',        '/siren.png'),
      loadImg('fireExt',      '/fire_extingusher.png'),
      loadImg('tool',         '/tool.png'),
      loadImg('uranium',      '/uranium.png'),
      loadImg('uraniumCont',  '/uranium_container.png'),
      loadImg('killSym',      '/kill_symbol.png'),
      loadImg('sabotageIcon', '/sabotoge.png'),
      loadImg('launch',       '/launch.png'),
      loadImg('launchFail',   '/launch_fail.png'),
      loadImg('victory',      '/victory.png'),
      loadImg('defeat',       '/defeat.png'),
    ]);
    imgsLoaded = true;
  }

  // ── Session ────────────────────────────────────────────────────────────
  let myId = null, myName = 'Player', myColor = '#4ea8de';
  let phase = 'lobby';
  let myRole = null;       // 'resident' | 'alien' | 'ghost' | null
  let currentMap = null;   // 'russia' | 'usa'

  // ── Game data ──────────────────────────────────────────────────────────
  let taskZones = [], sabotageZones = [], nukeZone = null;
  let myTasks = null;   // { assigned[], completed[], inProgress }
  let allRoles = {};
  let fires = {};       // { fire_1: { active } }

  // ── Players ────────────────────────────────────────────────────────────
  let serverPlayers = new Map();
  let lerpedPos     = new Map();
  let camX = 0, camY = 0;

  // ── Dead bodies ────────────────────────────────────────────────────────
  let deadBodies = [];  // { victimId, killerId, x, y }

  // ── Task progress ──────────────────────────────────────────────────────
  let taskProgress = { taskId: null, progress: 0 };

  // ── Kill CD ────────────────────────────────────────────────────────────
  let killCDMs = 0;
  let killCDInterval = null;

  // ── Audio ──────────────────────────────────────────────────────────────
  let audioCtx = null;
  let sirenActive = false;
  let sirenNodes  = null;

  // ── Overlays ───────────────────────────────────────────────────────────
  let introImgKey  = null;
  let introTimer   = null;
  let killFlashKey = null;
  let killFlashTimer = null;
  let blockedMsg   = null;
  let blockedTimer = null;
  let nukeMsg      = null;  // { imgKey, ok }
  let nukeMsgTimer = null;
  let gameOverMsg  = null;  // { winner, reason }

  // ── Chat (DOM) ─────────────────────────────────────────────────────────
  let chatLog = [];
  let chatInput = '';
  let chatChannel = 'global';
  let chatEl;
  let chatFocused = false;

  // ── Name entry ─────────────────────────────────────────────────────────
  let nameInput = '';
  let nameEntered = false;

  // ── Input ──────────────────────────────────────────────────────────────
  const keys = {};
  let prevSent = {};

  // ── Frame ──────────────────────────────────────────────────────────────
  let t = 0;
  let animId = null;

  // ════════════════════════════════════════════════════════════════════════
  // Siren
  // ════════════════════════════════════════════════════════════════════════
  function startSiren() {
    if (sirenActive) return;
    sirenActive = true;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start();
      sirenNodes = { osc, gain };
      (function sweep() {
        if (!sirenActive || !sirenNodes) return;
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.linearRampToValueAtTime(900, now + 0.7);
        osc.frequency.linearRampToValueAtTime(300, now + 1.4);
        setTimeout(sweep, 1400);
      })();
    } catch (_) {}
  }

  function stopSiren() {
    if (!sirenActive) return;
    sirenActive = false;
    if (sirenNodes) {
      try { sirenNodes.gain.gain.setValueAtTime(0, audioCtx.currentTime); sirenNodes.osc.stop(); } catch (_) {}
      sirenNodes = null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Reset
  // ════════════════════════════════════════════════════════════════════════
  function resetClientState() {
    deadBodies = []; taskProgress = { taskId: null, progress: 0 };
    taskZones = []; sabotageZones = []; nukeZone = null;
    myTasks = null; allRoles = {}; fires = {};
    introImgKey = null; killFlashKey = null; blockedMsg = null;
    nukeMsg = null; gameOverMsg = null;
    stopSiren();
    if (killCDInterval)  { clearInterval(killCDInterval);  killCDInterval  = null; } killCDMs = 0;
    if (introTimer)      { clearTimeout(introTimer);        introTimer      = null; }
    if (killFlashTimer)  { clearTimeout(killFlashTimer);    killFlashTimer  = null; }
    if (blockedTimer)    { clearTimeout(blockedTimer);      blockedTimer    = null; }
    if (nukeMsgTimer)    { clearTimeout(nukeMsgTimer);      nukeMsgTimer    = null; }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Socket
  // ════════════════════════════════════════════════════════════════════════
  function introKey(map, role) {
    if (map === 'russia') return role === 'alien' ? 'russiaAlien' : 'russiaCrew';
    if (map === 'usa')    return role === 'alien' ? 'usaAlien'    : 'usaCrew';
    return null;
  }

  function wireSocket() {
    socket.on('player_init', ({ player, phase: p, role, map }) => {
      myId = player.id; myName = player.name; myColor = player.color;
      phase = p; myRole = role; currentMap = map;
      localPlayer.set(player);
    });

    socket.on('game_state', (list) => {
      const next = new Map();
      for (const p of list) {
        next.set(p.id, p);
        if (!lerpedPos.has(p.id)) lerpedPos.set(p.id, { x: p.x, y: p.y });
      }
      for (const id of serverPlayers.keys()) { if (!next.has(id)) lerpedPos.delete(id); }
      serverPlayers = next;
      playersStore.set(serverPlayers);
    });

    socket.on('player_joined', (p) => { serverPlayers.set(p.id, p); lerpedPos.set(p.id, { x: p.x, y: p.y }); });
    socket.on('player_left',   (id) => { serverPlayers.delete(id); lerpedPos.delete(id); });

    socket.on('phase_change', (p) => {
      phase = p;
      if (p === 'lobby') { resetClientState(); currentMap = null; myRole = null; }
    });

    socket.on('game_started', ({ role, map }) => {
      myRole = role; currentMap = map;
      const k = introKey(map, role);
      if (k) {
        introImgKey = k;
        if (introTimer) clearTimeout(introTimer);
        introTimer = setTimeout(() => { introImgKey = null; introTimer = null; }, 4000);
      }
    });

    socket.on('game_setup', ({ map, taskZones: tz, sabotageZones: sz, nukeZone: nz, myTasks: mt, fires: fs, allRoles: ar }) => {
      currentMap    = map;
      taskZones     = tz || [];
      sabotageZones = sz || [];
      nukeZone      = nz || null;
      myTasks       = mt ? { ...mt } : null;
      allRoles      = ar || {};
      fires         = {};
      if (fs) fs.forEach(({ id, active }) => { fires[id] = { active }; });
    });

    socket.on('fire_update', (list) => {
      const prev = { ...fires };
      fires = {};
      list.forEach(({ id, active }) => { fires[id] = { active }; });
      const anyNow = Object.values(fires).some(f => f.active);
      const anyWas = Object.values(prev).some(f => f.active);
      if (anyNow && !anyWas) startSiren();
      if (!anyNow && anyWas) stopSiren();
    });

    socket.on('task_progress_update', ({ taskId, progress }) => {
      taskProgress = { taskId, progress };
      if (myTasks) myTasks.inProgress = taskId || null;
    });

    socket.on('task_completed', ({ taskId }) => {
      if (!myTasks) return;
      if (!myTasks.completed.includes(taskId)) myTasks.completed = [...myTasks.completed, taskId];
      myTasks.inProgress = null;
      taskProgress = { taskId: null, progress: 0 };
    });

    socket.on('task_blocked', ({ reason }) => {
      blockedMsg = reason;
      taskProgress = { taskId: null, progress: 0 };
      if (blockedTimer) clearTimeout(blockedTimer);
      blockedTimer = setTimeout(() => { blockedMsg = null; }, 2500);
    });

    socket.on('player_killed', ({ victimId, killerId, x, y }) => {
      const victim = serverPlayers.get(victimId);
      if (victim) victim.alive = false;
      deadBodies = [...deadBodies, { victimId, killerId, x, y }];

      if (killerId === myId) {
        killFlashKey = currentMap === 'russia' ? 'russiaKill' : 'usaKill';
        if (killFlashTimer) clearTimeout(killFlashTimer);
        killFlashTimer = setTimeout(() => { killFlashKey = null; }, 1500);
        killCDMs = 30000;
        if (killCDInterval) clearInterval(killCDInterval);
        killCDInterval = setInterval(() => {
          killCDMs = Math.max(0, killCDMs - 100);
          if (killCDMs <= 0) { clearInterval(killCDInterval); killCDInterval = null; }
        }, 100);
      }
      if (victimId === myId) myRole = 'ghost';
    });

    socket.on('nuke_result', ({ success }) => {
      const imgKey = success ? (currentMap === 'russia' ? 'russiaNuke' : 'usaNuke') : 'launchFail';
      nukeMsg = { imgKey, ok: success };
      if (nukeMsgTimer) clearTimeout(nukeMsgTimer);
      nukeMsgTimer = setTimeout(() => { nukeMsg = null; }, 5000);
    });

    socket.on('game_over', ({ winner, reason }) => {
      gameOverMsg = { winner, reason };
      stopSiren();
    });

    socket.on('chat_message', (msg) => {
      chatLog = [...chatLog.slice(-49), msg];
      if (chatEl) setTimeout(() => { chatEl.scrollTop = chatEl.scrollHeight; }, 0);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Input
  // ════════════════════════════════════════════════════════════════════════
  function onKeyDown(e) {
    if (chatFocused) return;
    keys[e.key.toLowerCase()] = true;

    if (e.key === 'e' || e.key === 'E') handleInteract();

    if ((e.key === 'k' || e.key === 'K') && phase === 'playing' && myRole === 'alien') {
      socket.emit('attempt_kill');
    }

    if (e.key === 'Escape') {
      if (taskProgress.taskId) socket.emit('task_cancel');
      if (introImgKey) { introImgKey = null; if (introTimer) { clearTimeout(introTimer); introTimer = null; } }
    }

    if (e.key === ' ') {
      if (introImgKey) { introImgKey = null; if (introTimer) { clearTimeout(introTimer); introTimer = null; } }
      e.preventDefault();
    }

    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
  }

  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }

  function sendInput() {
    if (phase !== 'playing') return;
    const input = {
      up:    !!(keys['w'] || keys['arrowup']),
      down:  !!(keys['s'] || keys['arrowdown']),
      left:  !!(keys['a'] || keys['arrowleft']),
      right: !!(keys['d'] || keys['arrowright']),
    };
    if (input.up !== prevSent.up || input.down !== prevSent.down ||
        input.left !== prevSent.left || input.right !== prevSent.right) {
      socket.emit('input', input);
      prevSent = input;
    }
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function handleInteract() {
    if (phase !== 'playing') return;
    const me = serverPlayers.get(myId);
    if (!me || !me.alive) return;

    if (myRole === 'resident') {
      for (const sz of sabotageZones) {
        if (fires[sz.id]?.active && dist(me, sz) < TASK_R) {
          socket.emit('extinguish', { zoneId: sz.id }); return;
        }
      }
      if (myTasks) {
        for (const tz of taskZones) {
          if (myTasks.assigned.includes(tz.id) && !myTasks.completed.includes(tz.id) && dist(me, tz) < TASK_R) {
            socket.emit('task_start', { taskId: tz.id }); return;
          }
        }
      }
      if (myTasks && nukeZone && dist(me, nukeZone) < TASK_R && myTasks.completed.length >= myTasks.assigned.length) {
        socket.emit('launch_nuke'); return;
      }
    }

    if (myRole === 'alien') {
      for (const sz of sabotageZones) {
        if (!fires[sz.id]?.active && dist(me, sz) < TASK_R) {
          socket.emit('sabotage', { zoneId: sz.id }); return;
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Draw helpers
  // ════════════════════════════════════════════════════════════════════════
  function ws(wx, wy) { return { sx: wx - camX, sy: wy - camY }; }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); }
    else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawMap
  // ════════════════════════════════════════════════════════════════════════
  function drawMap() {
    const img = imgs[currentMap === 'russia' ? 'mapRussia' : 'mapUSA'];
    if (img) { ctx.drawImage(img, -camX, -camY, WORLD_W, WORLD_H); }
    else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(-camX, -camY, WORLD_W, WORLD_H);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawDeadBodies
  // ════════════════════════════════════════════════════════════════════════
  function drawDeadBodies() {
    const dImg = imgs[currentMap === 'russia' ? 'deadRussia' : 'deadUSA'];
    deadBodies.forEach(b => {
      const { sx, sy } = ws(b.x, b.y);
      if (dImg) {
        ctx.drawImage(dImg, sx - 28, sy - 24, 56, 48);
      } else {
        ctx.save();
        ctx.globalAlpha = 0.65; ctx.fillStyle = '#8b0000';
        ctx.beginPath(); ctx.ellipse(sx, sy + 6, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.font = '24px serif'; ctx.textAlign = 'center'; ctx.fillText('☠', sx, sy + 8);
      }
      const victim = serverPlayers.get(b.victimId);
      if (victim) {
        ctx.font = '10px monospace'; ctx.fillStyle = 'rgba(255,120,120,0.9)';
        ctx.textAlign = 'center'; ctx.fillText(victim.name, sx, sy + 40);
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawPlayers
  // ════════════════════════════════════════════════════════════════════════
  function drawPlayers() {
    const pImg = imgs[currentMap === 'russia' ? 'playerRussia' : 'playerUSA'];
    serverPlayers.forEach((p) => {
      if (!p.alive) return;
      const lp = lerpedPos.get(p.id) || p;
      const sx = lp.x - camX, sy = lp.y - camY;
      const isMe = p.id === myId;
      const canSeeAlien = allRoles[p.id] === 'alien' && (myRole === 'alien' || myRole === 'ghost') && !isMe;

      ctx.save();
      ctx.beginPath(); ctx.arc(sx, sy, 18, 0, Math.PI * 2);
      ctx.fillStyle = p.color; ctx.fill();
      if (isMe) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); }
      ctx.restore();

      if (pImg) ctx.drawImage(pImg, sx - 22, sy - 22, 44, 44);

      if (canSeeAlien) {
        ctx.save(); ctx.font = '13px monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = '#c678dd'; ctx.fillText('▲', sx, sy - 26); ctx.restore();
      }

      ctx.save(); ctx.font = isMe ? 'bold 11px monospace' : '11px monospace';
      ctx.fillStyle = isMe ? '#ffe066' : '#fff'; ctx.textAlign = 'center';
      ctx.fillText(p.name, sx, sy + 32); ctx.restore();
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawTaskZones
  // ════════════════════════════════════════════════════════════════════════
  function drawTaskZones() {
    if (!myTasks) return;
    const me = serverPlayers.get(myId);
    taskZones.forEach(tz => {
      if (!myTasks.assigned.includes(tz.id)) return;
      const { sx, sy } = ws(tz.x, tz.y);
      const done    = myTasks.completed.includes(tz.id);
      const blocked = tz.id === 'uranium' && fires['fire_1']?.active;
      const inRange = me ? dist(me, tz) < TASK_R : false;

      ctx.beginPath(); ctx.arc(sx, sy, 38, 0, Math.PI * 2);
      ctx.strokeStyle = done ? '#50c878' : blocked ? '#ff4444' : inRange ? '#ffe066' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = done ? 3 : 2; ctx.stroke();

      const iconKey = (tz.id === 'uranium' || tz.id === 'weapon') ? 'uraniumCont' : 'tool';
      const icon = imgs[iconKey] || imgs['tool'];
      if (icon) {
        ctx.save(); ctx.globalAlpha = done ? 0.3 : 1;
        ctx.drawImage(icon, sx - 20, sy - 20, 40, 40); ctx.restore();
      }

      ctx.save(); ctx.textAlign = 'center'; ctx.font = '11px monospace';
      ctx.fillStyle = done ? '#50c878' : inRange ? '#ffe066' : 'rgba(255,255,255,0.7)';
      ctx.fillText(tz.name + (done ? ' ✓' : ''), sx, sy + 54);
      if (blocked) { ctx.fillStyle = '#ff4444'; ctx.fillText('FIRE — BLOCKED', sx, sy + 68); }
      else if (inRange && !done) { ctx.fillStyle = '#ffe066'; ctx.fillText('[E] Start', sx, sy + 68); }
      ctx.restore();
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawSabotageZones
  // ════════════════════════════════════════════════════════════════════════
  function drawSabotageZones() {
    const me = serverPlayers.get(myId);
    sabotageZones.forEach(sz => {
      const { sx, sy } = ws(sz.x, sz.y);
      const fire    = fires[sz.id];
      const inRange = me && me.alive ? dist(me, sz) < TASK_R : false;

      if (fire?.active) {
        const scale = 1 + 0.18 * Math.sin(t * 0.13);
        const fw = 72 * scale, fh = 72 * scale;
        const fImg = imgs['fire'];
        if (fImg) {
          ctx.save(); ctx.globalAlpha = 0.9;
          ctx.drawImage(fImg, sx - fw / 2, sy - fh / 2, fw, fh); ctx.restore();
        } else {
          const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, 38 * scale);
          g.addColorStop(0, 'rgba(255,240,80,0.95)');
          g.addColorStop(0.45, 'rgba(255,100,0,0.75)');
          g.addColorStop(1, 'rgba(200,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 38 * scale, 0, Math.PI * 2); ctx.fill();
        }
        ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#ff6644'; ctx.fillText(sz.name, sx, sy + 50); ctx.restore();

        if (myRole === 'resident' && inRange) {
          const eImg = imgs['fireExt'];
          ctx.save();
          ctx.fillStyle = 'rgba(200,30,30,0.4)'; ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 2;
          roundRect(sx - 74, sy + 60, 148, 32, 6); ctx.fill(); ctx.stroke();
          if (eImg) ctx.drawImage(eImg, sx - 68, sy + 65, 22, 22);
          ctx.fillStyle = '#ff6644'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
          ctx.fillText('[E] Extinguish', sx + 6, sy + 80); ctx.restore();
        }
      } else {
        if (myRole === 'alien' && inRange) {
          const sImg = imgs['sabotageIcon'];
          ctx.save();
          ctx.fillStyle = 'rgba(120,20,180,0.35)'; ctx.strokeStyle = '#c678dd'; ctx.lineWidth = 2;
          roundRect(sx - 70, sy - 18, 140, 32, 6); ctx.fill(); ctx.stroke();
          if (sImg) ctx.drawImage(sImg, sx - 64, sy - 13, 22, 22);
          ctx.fillStyle = '#c678dd'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
          ctx.fillText('[E] Sabotage', sx + 6, sy + 4); ctx.restore();
        }
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawNukeZone
  // ════════════════════════════════════════════════════════════════════════
  function drawNukeZone() {
    if (!nukeZone || myRole !== 'resident') return;
    const { sx, sy } = ws(nukeZone.x, nukeZone.y);
    const me      = serverPlayers.get(myId);
    const allDone = myTasks && myTasks.completed.length >= myTasks.assigned.length;
    const inRange = me ? dist(me, nukeZone) < TASK_R : false;
    const lImg    = imgs['launch'];

    ctx.save(); ctx.globalAlpha = allDone ? 1 : 0.3;
    if (lImg) ctx.drawImage(lImg, sx - 32, sy - 32, 64, 64);
    ctx.restore();

    ctx.save(); ctx.textAlign = 'center'; ctx.font = '11px monospace';
    ctx.fillStyle = allDone ? '#ffe066' : 'rgba(255,255,100,0.3)';
    ctx.fillText('Launch Nuke', sx, sy + 50);
    if (allDone && inRange) { ctx.fillStyle = '#ffe066'; ctx.fillText('[E] Launch', sx, sy + 64); }
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawFog
  // ════════════════════════════════════════════════════════════════════════
  function drawFog() {
    const me = serverPlayers.get(myId);
    if (!me || !lightCanvas) return;
    lightCanvas.width = W; lightCanvas.height = H;
    lightCtx.clearRect(0, 0, W, H);
    lightCtx.fillStyle = 'rgba(0,0,0,0.94)'; lightCtx.fillRect(0, 0, W, H);
    lightCtx.globalCompositeOperation = 'destination-out';
    const lp = lerpedPos.get(myId) || me;
    const g  = lightCtx.createRadialGradient(lp.x - camX, lp.y - camY, 0, lp.x - camX, lp.y - camY, FOG_R);
    g.addColorStop(0.4, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    lightCtx.fillStyle = g; lightCtx.fillRect(0, 0, W, H);
    lightCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(lightCanvas, 0, 0);
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawFireBanner
  // ════════════════════════════════════════════════════════════════════════
  function drawFireBanner() {
    const active = sabotageZones.filter(z => fires[z.id]?.active);
    if (!active.length) return;
    const flash = Math.sin(t * 0.18) > 0;
    ctx.save();
    ctx.fillStyle = flash ? 'rgba(200,30,30,0.9)' : 'rgba(130,15,15,0.9)';
    ctx.fillRect(0, 0, W, 46);
    const si = imgs['siren'];
    if (si) { ctx.drawImage(si, 8, 4, 38, 38); ctx.drawImage(si, W - 46, 4, 38, 38); }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillText('⚠ FIRE — ' + active.map(z => z.name).join(' & ') + ' — EXTINGUISH NOW ⚠', W / 2, 30);
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawHUD
  // ════════════════════════════════════════════════════════════════════════
  function drawHUD() {
    if (taskProgress.taskId) {
      const bw = 280, bh = 20, bx = W / 2 - bw / 2, by = H - 100;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; roundRect(bx - 6, by - 22, bw + 12, bh + 40, 8); ctx.fill();
      const tz = taskZones.find(z => z.id === taskProgress.taskId);
      ctx.fillStyle = '#aaa'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
      ctx.fillText(tz?.name || taskProgress.taskId, bx, by - 6);
      ctx.fillStyle = '#222'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#50c878'; ctx.fillRect(bx, by, bw * taskProgress.progress, bh);
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = '#aaa'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText('Hold position — ESC to cancel', W / 2, by + bh + 14);
      ctx.restore();
    }

    if (myRole === 'alien') {
      const bx = W - 116, by = H - 116;
      const cd = killCDMs > 0;
      ctx.save();
      ctx.fillStyle = cd ? 'rgba(50,15,15,0.85)' : 'rgba(180,25,25,0.92)';
      ctx.strokeStyle = cd ? '#553333' : '#ff4444'; ctx.lineWidth = 2;
      roundRect(bx, by, 96, 80, 10); ctx.fill(); ctx.stroke();
      const ki = imgs['killSym'];
      if (ki) ctx.drawImage(ki, bx + 8, by + 6, 40, 40);
      ctx.fillStyle = cd ? '#885555' : '#fff'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText('[K] Kill', bx + 48, by + 58);
      if (cd) {
        ctx.fillStyle = 'rgba(255,80,80,0.18)';
        const pct = killCDMs / 30000;
        const fillH = 80 * (1 - pct);
        ctx.fillRect(bx, by + 80 - fillH, 96, fillH);
        ctx.fillStyle = '#aaa'; ctx.font = '10px monospace';
        ctx.fillText(`${(killCDMs / 1000).toFixed(1)}s`, bx + 48, by + 72);
      }
      ctx.restore();
    }

    if ((myRole === 'resident' || myRole === 'ghost') && myTasks) {
      const rows = myTasks.assigned.length;
      const ph = rows * 18 + 48, px = 14, py = H - ph - 14;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; roundRect(px, py, 190, ph, 8); ctx.fill();
      ctx.fillStyle = '#aaa'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`Tasks (${myTasks.completed.length}/${myTasks.assigned.length})`, px + 8, py + 18);
      myTasks.assigned.forEach((id, i) => {
        const tz = taskZones.find(z => z.id === id), done = myTasks.completed.includes(id);
        ctx.fillStyle = done ? '#50c878' : '#ccc';
        ctx.font = `${done ? 'bold ' : ''}11px monospace`;
        ctx.fillText((done ? '✓ ' : '○ ') + (tz?.name || id), px + 8, py + 36 + i * 18);
      });
      ctx.restore();
    }

    if (myRole === 'ghost') {
      ctx.save(); ctx.fillStyle = 'rgba(140,140,200,0.75)';
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.fillText('☠  You are a ghost — spectating', W / 2, 34); ctx.restore();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawMinimap
  // ════════════════════════════════════════════════════════════════════════
  function drawMinimap() {
    const mw = 200, mh = 200, mx = W - mw - 14, my = H - mh - 14;
    const scx = mw / WORLD_W, scy = mh / WORLD_H;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; roundRect(mx - 4, my - 4, mw + 8, mh + 8, 6); ctx.fill();
    const mImg = imgs[currentMap === 'russia' ? 'mapRussia' : 'mapUSA'];
    if (mImg) { ctx.globalAlpha = 0.45; ctx.drawImage(mImg, mx, my, mw, mh); ctx.globalAlpha = 1; }
    deadBodies.forEach(b => {
      ctx.fillStyle = '#8b0000';
      ctx.beginPath(); ctx.arc(mx + b.x * scx, my + b.y * scy, 2.5, 0, Math.PI * 2); ctx.fill();
    });
    serverPlayers.forEach((p) => {
      if (!p.alive) return;
      const lp = lerpedPos.get(p.id) || p;
      ctx.fillStyle = p.id === myId ? '#ffe066' : p.color;
      ctx.beginPath(); ctx.arc(mx + lp.x * scx, my + lp.y * scy, p.id === myId ? 4 : 3, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + camX * scx, my + camY * scy, W * scx, H * scy);
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Overlay drawers
  // ════════════════════════════════════════════════════════════════════════
  function drawBlockedMsg() {
    if (!blockedMsg) return;
    ctx.save();
    ctx.fillStyle = 'rgba(180,25,25,0.9)';
    roundRect(W / 2 - 230, H / 2 - 28, 460, 56, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillText('⛔  ' + blockedMsg, W / 2, H / 2 + 6); ctx.restore();
  }

  function drawKillFlash() {
    if (!killFlashKey) return;
    const img = imgs[killFlashKey]; if (!img) return;
    const aw = Math.min(img.width, W * 0.55), ah = aw * (img.height / img.width);
    ctx.save(); ctx.globalAlpha = 0.88;
    ctx.drawImage(img, W / 2 - aw / 2, H / 2 - ah / 2, aw, ah); ctx.restore();
  }

  function drawNukeResult() {
    if (!nukeMsg) return;
    const img = imgs[nukeMsg.imgKey]; if (!img) return;
    ctx.save(); ctx.globalAlpha = 0.92; ctx.drawImage(img, 0, 0, W, H); ctx.restore();
  }

  function drawIntro() {
    if (!introImgKey) return;
    ctx.save();
    const img = imgs[introImgKey];
    if (img) {
      // Scale to fit while preserving aspect ratio
      const scale = Math.min(W / img.width, H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, W / 2 - dw / 2, H / 2 - dh / 2, dw, dh);
    } else {
      // Text fallback when image hasn't loaded
      const isAlien = myRole === 'alien';
      const mapLabel = currentMap === 'russia' ? 'RUSSIA' : 'USA';
      ctx.fillStyle = 'rgba(0,0,0,0.96)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = isAlien ? '#c678dd' : '#50c878';
      ctx.font = 'bold 52px monospace';
      ctx.fillText(isAlien ? 'ALIEN' : 'RESIDENT', W / 2, H / 2 - 30);
      ctx.fillStyle = '#888'; ctx.font = '20px monospace';
      ctx.fillText('Map: ' + mapLabel, W / 2, H / 2 + 18);
      ctx.fillStyle = isAlien ? '#c678dd' : '#50c878';
      ctx.font = '15px monospace';
      ctx.fillText(
        isAlien ? 'Sabotage fires • Kill residents [K] • Outnumber them'
                : 'Complete your 3 tasks • Then launch the nuke [E]',
        W / 2, H / 2 + 56
      );
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
    ctx.fillText('Press SPACE or ESC to continue', W / 2, H - 28);
    ctx.restore();
  }

  // Ambient zone labels for all players (drawn before fog — hidden when far away).
  // Assigned task zones are skipped: drawTaskZones already labels those with an action prompt.
  function drawZoneLabels() {
    ctx.save();
    ctx.textAlign = 'center'; ctx.font = 'bold 11px monospace';
    taskZones.forEach(tz => {
      if (myTasks?.assigned.includes(tz.id)) return;  // already drawn by drawTaskZones
      const { sx, sy } = ws(tz.x, tz.y);
      ctx.fillStyle = 'rgba(180,180,180,0.45)';
      ctx.fillText(tz.name, sx, sy - 30);
    });
    sabotageZones.forEach(sz => {
      if (fires[sz.id]?.active) return;  // fire label handled by drawSabotageZones
      const { sx, sy } = ws(sz.x, sz.y);
      ctx.fillStyle = 'rgba(190,110,110,0.5)';
      ctx.fillText(sz.name, sx, sy - 30);
    });
    ctx.restore();
  }

  function drawGameOver() {
    if (!gameOverMsg) return;
    const { winner, reason } = gameOverMsg;
    const iWon = (myRole === 'alien' && winner === 'aliens') ||
                 (myRole === 'resident' && winner === 'residents');
    const img = imgs[iWon ? 'victory' : 'defeat'];
    ctx.save();
    if (img) { ctx.globalAlpha = 0.94; ctx.drawImage(img, 0, 0, W, H); ctx.globalAlpha = 1; }
    else {
      ctx.fillStyle = iWon ? 'rgba(20,80,20,0.92)' : 'rgba(80,20,20,0.92)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 38px monospace'; ctx.textAlign = 'center';
    ctx.fillText(iWon ? 'VICTORY' : 'DEFEAT', W / 2, H / 2 - 24);
    ctx.font = '18px monospace'; ctx.fillStyle = '#ddd';
    ctx.fillText(reason, W / 2, H / 2 + 18);
    ctx.font = '13px monospace'; ctx.fillStyle = '#aaa';
    ctx.fillText((winner === 'aliens' ? 'Aliens' : 'Residents') + ' win — lobby in 12s', W / 2, H / 2 + 46);
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════════════════
  // drawLobby
  // ════════════════════════════════════════════════════════════════════════
  function drawLobby() {
    const bgImg = imgs['mapRussia'] || imgs['mapUSA'];
    if (bgImg) { ctx.save(); ctx.globalAlpha = 0.12; ctx.drawImage(bgImg, 0, 0, W, H); ctx.restore(); }
    ctx.fillStyle = 'rgba(8,8,18,0.84)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffe066'; ctx.font = 'bold 34px monospace'; ctx.textAlign = 'center';
    ctx.fillText('HORIZONS', W / 2, 82);
    ctx.fillStyle = '#888'; ctx.font = '13px monospace';
    ctx.fillText('Residents vs. Aliens — Nuclear Launch Protocol', W / 2, 108);

    const cnt = Math.min(serverPlayers.size, 10);
    const px = W / 2 - 130, py = 136;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(px - 10, py - 20, 270, cnt * 26 + 46, 8); ctx.fill();
    ctx.fillStyle = '#666'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`Players (${serverPlayers.size}/10):`, px, py - 4);
    let row = 0;
    serverPlayers.forEach(p => {
      ctx.fillStyle = p.color; ctx.fillRect(px, py + row * 26 + 6, 12, 12);
      ctx.fillStyle = p.id === myId ? '#ffe066' : '#ccc';
      ctx.font = p.id === myId ? 'bold 13px monospace' : '13px monospace';
      ctx.fillText(p.name + (p.id === myId ? ' (you)' : ''), px + 20, py + row * 26 + 18);
      row++;
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // Main loop
  // ════════════════════════════════════════════════════════════════════════
  function draw() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, W, H);

    const me = serverPlayers.get(myId);
    if (me) {
      const lp = lerpedPos.get(myId) || me;
      camX += (lp.x - W / 2 - camX) * 0.12;
      camY += (lp.y - H / 2 - camY) * 0.12;
      // When the viewport is larger than the world, center the world instead of clamping negative.
      camX = WORLD_W <= W ? (WORLD_W - W) / 2 : Math.max(0, Math.min(WORLD_W - W, camX));
      camY = WORLD_H <= H ? (WORLD_H - H) / 2 : Math.max(0, Math.min(WORLD_H - H, camY));
    }
    serverPlayers.forEach((p) => {
      const cur = lerpedPos.get(p.id) || { x: p.x, y: p.y };
      lerpedPos.set(p.id, { x: cur.x + (p.x - cur.x) * LERP, y: cur.y + (p.y - cur.y) * LERP });
    });

    if (phase === 'lobby') {
      drawLobby();
    } else {
      drawMap();
      drawDeadBodies();
      drawSabotageZones();
      if (myRole === 'resident' || myRole === 'ghost') drawTaskZones();
      if (myRole === 'resident') drawNukeZone();
      drawZoneLabels();   // area names for all players, hidden by fog at distance
      drawPlayers();
      drawFog();
      drawFireBanner();
      drawHUD();
      drawBlockedMsg();
      drawMinimap();
      drawNukeResult();
      drawGameOver();
    }
    // Fullscreen overlays render on top regardless of phase
    drawIntro();
    drawKillFlash();

    t++;
    sendInput();
    animId = requestAnimationFrame(draw);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Join / chat helpers
  // ════════════════════════════════════════════════════════════════════════
  function joinGame() {
    const n = nameInput.trim().slice(0, 16) || 'Player';
    const id = localStorage.getItem('horizons_player_id') || crypto.randomUUID();
    localStorage.setItem('horizons_player_name', n);
    localStorage.setItem('horizons_player_id',   id);
    nameEntered = true;
    socket.emit('join', { playerId: id, name: n });
  }

  function onNameKey(e) { if (e.key === 'Enter') joinGame(); }

  function sendChat() {
    const msg = chatInput.trim(); if (!msg) return;
    socket.emit('chat', { message: msg, channel: chatChannel });
    chatInput = '';
  }

  function onChatKey(e) { if (e.key === 'Enter') sendChat(); }

  // ════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ════════════════════════════════════════════════════════════════════════
  onMount(async () => {
    ctx         = canvas.getContext('2d');
    lightCanvas = document.createElement('canvas');
    lightCtx    = lightCanvas.getContext('2d');

    await loadAllImages();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    wireSocket();

    const storedName = localStorage.getItem('horizons_player_name');
    if (storedName) {
      nameInput   = storedName;
      nameEntered = true;
      const storedId = localStorage.getItem('horizons_player_id') || crypto.randomUUID();
      localStorage.setItem('horizons_player_id', storedId);
      socket.emit('join', { playerId: storedId, name: storedName });
    }

    draw();
  });

  onDestroy(() => {
    if (animId) cancelAnimationFrame(animId);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup',   onKeyUp);
    stopSiren();
    if (killCDInterval) clearInterval(killCDInterval);
    if (introTimer)     clearTimeout(introTimer);
    if (killFlashTimer) clearTimeout(killFlashTimer);
    if (blockedTimer)   clearTimeout(blockedTimer);
    if (nukeMsgTimer)   clearTimeout(nukeMsgTimer);
    ['player_init','game_state','player_joined','player_left','phase_change',
     'game_started','game_setup','fire_update','task_progress_update','task_completed',
     'task_blocked','player_killed','nuke_result','game_over','chat_message']
      .forEach(ev => socket.off(ev));
  });
</script>

{#if !nameEntered}
<div class="name-modal">
  <h2>HORIZONS</h2>
  <p>Enter your name to join</p>
  <input bind:value={nameInput} placeholder="Player" maxlength="16" on:keydown={onNameKey} />
  <button on:click={joinGame}>Join Game</button>
</div>
{/if}

<canvas bind:this={canvas} />

{#if nameEntered}
<div class="dom-hud">
  {#if phase === 'lobby' && serverPlayers.size >= 2}
    <button class="btn-start" on:click={() => socket.emit('start_game')}>▶ Start Game</button>
  {:else if phase === 'lobby'}
    <div class="waiting">Waiting for more players…</div>
  {/if}
</div>

<div class="chat-wrap">
  <div class="chat-log" bind:this={chatEl}>
    {#each chatLog as msg}
      <div class="chat-msg">
        <span style="color:{msg.color}">{msg.name}</span>
        {#if msg.channel === 'alien'}<span class="ch-alien"> [ALIEN]</span>{/if}:
        {msg.message}
      </div>
    {/each}
  </div>
  <div class="chat-input-row">
    {#if myRole === 'alien'}
      <select bind:value={chatChannel} class="ch-select">
        <option value="global">All</option>
        <option value="alien">Alien</option>
      </select>
    {/if}
    <input class="chat-in" bind:value={chatInput} placeholder="Chat…" maxlength="200"
      on:keydown={onChatKey} on:focus={() => chatFocused = true} on:blur={() => chatFocused = false} />
    <button class="chat-send" on:click={sendChat}>➤</button>
  </div>
</div>
{/if}

<style>
  :global(body) { margin: 0; overflow: hidden; background: #0a0a14; }

  canvas {
    position: fixed;
    top: 0; left: 0;
    display: block;
  }

  .name-modal {
    position: fixed; inset: 0; z-index: 200;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(8,8,20,0.97); gap: 14px; color: #fff; font-family: monospace;
  }
  .name-modal h2 { font-size: 2.4rem; color: #ffe066; margin: 0; letter-spacing: 4px; }
  .name-modal p  { color: #888; margin: 0; }
  .name-modal input {
    background: #111; border: 2px solid #444; color: #fff;
    font-family: monospace; font-size: 1.1rem;
    padding: 10px 18px; border-radius: 6px; outline: none; width: 220px; text-align: center;
  }
  .name-modal input:focus { border-color: #ffe066; }
  .name-modal button {
    background: #ffe066; color: #111; border: none; cursor: pointer;
    font-family: monospace; font-size: 1rem; font-weight: bold;
    padding: 10px 32px; border-radius: 6px;
  }
  .name-modal button:hover { background: #ffd633; }

  .dom-hud {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    pointer-events: none; z-index: 10;
  }
  .btn-start {
    pointer-events: all;
    background: #50c878; color: #0a0a14; border: none; cursor: pointer;
    font-family: monospace; font-size: 1.1rem; font-weight: bold;
    padding: 14px 40px; border-radius: 8px; letter-spacing: 1px;
    box-shadow: 0 0 20px rgba(80,200,120,0.4);
  }
  .btn-start:hover { background: #3daf62; }
  .waiting { pointer-events: none; color: #555; font-family: monospace; font-size: 0.9rem; }

  .chat-wrap {
    position: fixed; top: 56px; left: 14px; width: 290px; z-index: 20;
    display: flex; flex-direction: column; gap: 4px;
  }
  .chat-log {
    background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; padding: 6px 8px; max-height: 110px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 2px;
    font-family: monospace; font-size: 11px; color: #ccc;
  }
  .chat-msg { word-break: break-word; }
  .ch-alien { color: #c678dd; font-size: 10px; }
  .chat-input-row { display: flex; gap: 4px; }
  .ch-select {
    background: #111; color: #ccc; border: 1px solid #444;
    border-radius: 4px; font-family: monospace; font-size: 11px; padding: 2px 4px;
  }
  .chat-in {
    flex: 1; background: rgba(0,0,0,0.65); color: #fff;
    border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
    font-family: monospace; font-size: 11px; padding: 5px 8px; outline: none;
  }
  .chat-in:focus { border-color: #ffe066; }
  .chat-send {
    background: rgba(255,255,255,0.12); color: #fff;
    border: 1px solid rgba(255,255,255,0.2); border-radius: 4px;
    cursor: pointer; padding: 0 10px; font-size: 12px;
  }
  .chat-send:hover { background: rgba(255,255,255,0.22); }
</style>
