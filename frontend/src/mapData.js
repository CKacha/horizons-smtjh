export const ROOMS = [
  { id: 'hub',     name: 'Central Hub',   x: 1325, y: 1150, w: 350, h: 350 },
  { id: 'crew',    name: 'Crew Quarters', x: 600,  y: 1150, w: 350, h: 350 },
  { id: 'reactor', name: 'Reactor',       x: 2050, y: 1150, w: 350, h: 350 },
  { id: 'lab',     name: 'Lab',           x: 600,  y: 1700, w: 350, h: 350 },
  { id: 'medical', name: 'Medical Bay',   x: 1325, y: 1700, w: 350, h: 350 },
  { id: 'control', name: 'Control Room',  x: 2050, y: 1700, w: 350, h: 350 },
];

export const CORRIDORS = [
  { x: 950,  y: 1275, w: 375, h: 100 },
  { x: 1675, y: 1275, w: 375, h: 100 },
  { x: 950,  y: 1825, w: 375, h: 100 },
  { x: 1675, y: 1825, w: 375, h: 100 },
  { x: 725,  y: 1500, w: 100, h: 200 },
  { x: 1450, y: 1500, w: 100, h: 200 },
  { x: 2175, y: 1500, w: 100, h: 200 },
];

// Scale: 0.1 — map area 1800×900 → minimap 180×90
export const MINIMAP = { originX: 600, originY: 1150, scale: 0.1, w: 180, h: 90 };
