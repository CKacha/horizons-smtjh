<script>
  import { onMount, onDestroy } from 'svelte';

  let canvas;
  let ctx;
  let animationId;
  let width = window.innerWidth;
  let height = window.innerHeight;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }

  let t = 0;

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;

    // Pulsing ring to confirm animation loop is running
    const pulse = Math.sin(t * 0.05) * 10;
    ctx.beginPath();
    ctx.arc(cx, cy, 60 + pulse, 0, Math.PI * 2);
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Simple crewmate body
    ctx.fillStyle = '#e94560';
    ctx.beginPath();
    ctx.arc(cx, cy + 10, 35, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.beginPath();
    ctx.arc(cx, cy - 20, 25, 0, Math.PI * 2);
    ctx.fill();

    // Visor
    ctx.fillStyle = '#16213e';
    ctx.beginPath();
    ctx.arc(cx + 8, cy - 22, 14, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('aiden do your thing', cx, cy + 80);

    t++;
    animationId = requestAnimationFrame(draw);
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    resize();
    draw();
    window.addEventListener('resize', resize);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', resize);
  });
</script>

<canvas bind:this={canvas} />

<style>
  canvas {
    display: block;
  }
</style>
