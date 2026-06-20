const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'game.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS stats (
    player_id TEXT PRIMARY KEY REFERENCES players(id),
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    games INTEGER DEFAULT 0
  );
`);

const getPlayer = db.prepare('SELECT * FROM players WHERE id = ?');
const insertPlayer = db.prepare('INSERT INTO players (id, name, color) VALUES (?, ?, ?)');
const insertStats = db.prepare('INSERT OR IGNORE INTO stats (player_id) VALUES (?)');
const incrementGames = db.prepare('UPDATE stats SET games = games + 1 WHERE player_id = ?');
const getLeaderboard = db.prepare(`
  SELECT p.name, p.color, s.kills, s.deaths, s.games
  FROM players p JOIN stats s ON p.id = s.player_id
  ORDER BY s.kills DESC LIMIT 20
`);

function findOrCreate(id, name, color) {
  let player = getPlayer.get(id);
  if (!player) {
    insertPlayer.run(id, name, color);
    insertStats.run(id);
    player = getPlayer.get(id);
  }
  incrementGames.run(id);
  return player;
}

module.exports = { findOrCreate, getLeaderboard };
