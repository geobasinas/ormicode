CREATE TABLE session_prices(
  session TEXT NOT NULL,
  model TEXT NOT NULL,
  version TEXT NOT NULL,
  input REAL NOT NULL,
  output REAL NOT NULL,
  cache_read REAL,
  cache_write REAL,
  PRIMARY KEY(session, model)
);
