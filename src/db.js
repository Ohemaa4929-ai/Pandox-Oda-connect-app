const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

db.exec(`CREATE TABLE IF NOT EXISTS listing_media (id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE, file_path TEXT NOT NULL, media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')), mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, original_name TEXT, is_cover INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
module.exports = { db };