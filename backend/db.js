const Database = require('better-sqlite3');
const path = require('path');

let db;
try {
  db = new Database(path.join(__dirname, 'game.db'));
} catch (err) {
  console.error('Failed to open database:', err);
  process.exit(1);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS stats (
    player_id TEXT PRIMARY KEY REFERENCES players(id),
    kills  INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    games  INTEGER DEFAULT 0
  );
`);

const stmts = {
  getPlayer:      db.prepare('SELECT * FROM players WHERE id = ?'),
  insertPlayer:   db.prepare('INSERT INTO players (id, name, color) VALUES (?, ?, ?)'),
  insertStats:    db.prepare('INSERT OR IGNORE INTO stats (player_id) VALUES (?)'),
  addGame:        db.prepare('UPDATE stats SET games  = games  + 1 WHERE player_id = ?'),
  addKill:        db.prepare('UPDATE stats SET kills  = kills  + 1 WHERE player_id = ?'),
  addDeath:       db.prepare('UPDATE stats SET deaths = deaths + 1 WHERE player_id = ?'),
  getLeaderboard: db.prepare(`
    SELECT p.name, p.color, s.kills, s.deaths, s.games
    FROM players p JOIN stats s ON p.id = s.player_id
    ORDER BY s.kills DESC LIMIT 20
  `),
};

// Finds or creates a player row — does NOT increment game count (call recordGamePlayed separately).
function findOrCreate(id, name, color) {
  let player = stmts.getPlayer.get(id);
  if (!player) {
    stmts.insertPlayer.run(id, name, color);
    stmts.insertStats.run(id);
    player = stmts.getPlayer.get(id);
  }
  return player;
}

function recordGamePlayed(playerId) {
  try { stmts.addGame.run(playerId); } catch (_) {}
}

function recordKill(killerId, victimId) {
  try {
    stmts.addKill.run(killerId);
    stmts.addDeath.run(victimId);
  } catch (_) {}
}

module.exports = { findOrCreate, recordGamePlayed, recordKill, getLeaderboard: stmts.getLeaderboard };
