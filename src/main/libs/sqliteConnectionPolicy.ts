import Database from 'better-sqlite3';

export const applySqliteConnectionPolicy = (db: Database.Database): void => {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -8000');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('busy_timeout = 5000');
};
