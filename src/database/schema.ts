import type Database from "better-sqlite3";

export function createTables(db: Database.Database) {
	db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      tx_hash TEXT PRIMARY KEY,
      block_number INTEGER NOT NULL,
      from_address TEXT NOT NULL,
      gas_used TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_block_number ON logs(block_number);
    CREATE INDEX IF NOT EXISTS idx_from_address ON logs(from_address);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON logs(timestamp);

    CREATE TABLE IF NOT EXISTS fees (
      tx_hash TEXT PRIMARY KEY,
      fee_wei TEXT NOT NULL,
      FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_fee_tx_hash ON fees(tx_hash);

    CREATE TABLE IF NOT EXISTS token_metadata (
      address TEXT PRIMARY KEY,
      decimals INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      coingecko_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_token_metadata_address ON token_metadata(address);

    CREATE TABLE IF NOT EXISTS token_prices (
      address TEXT PRIMARY KEY,
      price_usd REAL NOT NULL,
      last_updated INTEGER NOT NULL,
      FOREIGN KEY(address) REFERENCES token_metadata(address)
    );
    CREATE INDEX IF NOT EXISTS idx_token_prices_address ON token_prices(address);
    
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      network TEXT NOT NULL,
      mode TEXT NOT NULL,
      start_block INTEGER,
      end_block INTEGER,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      processed_logs INTEGER NOT NULL DEFAULT 0,
      processed_swaps INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_runs_status ON scan_runs(status);
    CREATE INDEX IF NOT EXISTS idx_scan_runs_started_at ON scan_runs(started_at);

    CREATE TABLE IF NOT EXISTS indexer_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      network TEXT,
      stage TEXT NOT NULL,
      block_start INTEGER,
      block_end INTEGER,
      block_number INTEGER,
      tx_hash TEXT,
      item TEXT,
      error_message TEXT NOT NULL,
      error_stack TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(run_id) REFERENCES scan_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_indexer_errors_run_id ON indexer_errors(run_id);
    CREATE INDEX IF NOT EXISTS idx_indexer_errors_stage ON indexer_errors(stage);
    CREATE INDEX IF NOT EXISTS idx_indexer_errors_status ON indexer_errors(status);
    CREATE INDEX IF NOT EXISTS idx_indexer_errors_created_at ON indexer_errors(created_at);
  `);

	try {
		const cols = db.prepare("PRAGMA table_info(indexer_errors)").all() as Array<{
			name: string;
		}>;
		const hasColumn = (name: string) => cols.some((c) => c.name.toLowerCase() === name);
		if (!hasColumn("status")) {
			db.exec("ALTER TABLE indexer_errors ADD COLUMN status TEXT NOT NULL DEFAULT 'open';");
		}
		if (!hasColumn("retry_count")) {
			db.exec(
				"ALTER TABLE indexer_errors ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;"
			);
		}
		if (!hasColumn("last_seen_at")) {
			db.exec(
				"ALTER TABLE indexer_errors ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;"
			);
			db.exec("UPDATE indexer_errors SET last_seen_at = created_at WHERE last_seen_at = 0;");
		}
		db.exec("CREATE INDEX IF NOT EXISTS idx_indexer_errors_status ON indexer_errors(status);");
	} catch {}

	// Migration logic for swap_events
	try {
		const cols = db.prepare("PRAGMA table_info(swap_events)").all() as Array<{ name: string }>;
		const tableExists = cols.length > 0;
		const hasLogIndex = cols.some((c) => c.name.toLowerCase() === "log_index");
		const hasId = cols.some((c) => c.name.toLowerCase() === "id");
		if (!tableExists) {
			db.exec(`
            CREATE TABLE IF NOT EXISTS swap_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tx_hash TEXT NOT NULL,
              log_index INTEGER NOT NULL,
              block_number INTEGER NOT NULL,
              sender TEXT NOT NULL,
              amount_in TEXT NOT NULL,
              amount_out TEXT NOT NULL,
              token_in TEXT NOT NULL,
              token_out TEXT NOT NULL,
              destination TEXT NOT NULL,
              timestamp INTEGER NOT NULL,
              FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
            );
            `);
		} else if (!hasLogIndex || !hasId) {
			db.exec(`
            CREATE TABLE IF NOT EXISTS swap_events_v2 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              tx_hash TEXT NOT NULL,
              log_index INTEGER NOT NULL,
              block_number INTEGER NOT NULL,
              sender TEXT NOT NULL,
              amount_in TEXT NOT NULL,
              amount_out TEXT NOT NULL,
              token_in TEXT NOT NULL,
              token_out TEXT NOT NULL,
              destination TEXT NOT NULL,
              timestamp INTEGER NOT NULL,
              FOREIGN KEY(tx_hash) REFERENCES logs(tx_hash)
            );
            `);
			try {
				db.exec(`
                  INSERT INTO swap_events_v2 (tx_hash, log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp)
                  SELECT tx_hash, 0 as log_index, block_number, sender, amount_in, amount_out, token_in, token_out, destination, timestamp
                  FROM swap_events;
                `);
			} catch {}
			db.exec(`
              DROP TABLE IF EXISTS swap_events;
              ALTER TABLE swap_events_v2 RENAME TO swap_events;
            `);
		}
		db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_swap_tx_log ON swap_events(tx_hash, log_index);
          CREATE INDEX IF NOT EXISTS idx_token_pair ON swap_events(token_in, token_out);
          CREATE INDEX IF NOT EXISTS idx_sender ON swap_events(sender);
        `);
	} catch {}

	try {
		const cols = db.prepare("PRAGMA table_info(swap_events)").all() as Array<{ name: string }>;
		const hasSlippage = cols.some((c) => c.name.toLowerCase() === "amount_out_min");
		if (!hasSlippage) {
			db.exec(`
				ALTER TABLE swap_events ADD COLUMN amount_out_min TEXT;
				ALTER TABLE swap_events ADD COLUMN execution_quality REAL;
			`);
		}
	} catch {} // This catch block was missing for the previous try block

	try {
		const cols = db.prepare("PRAGMA table_info(token_metadata)").all() as Array<{
			name: string;
		}>;
		const hasCgId = cols.some((c) => c.name.toLowerCase() === "coingecko_id");
		if (!hasCgId) {
			db.exec("ALTER TABLE token_metadata ADD COLUMN coingecko_id TEXT;");
			db.exec(
				"CREATE INDEX IF NOT EXISTS idx_token_metadata_cg_id ON token_metadata(coingecko_id);"
			);
		}
	} catch {}
}
