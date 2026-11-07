import app from './app';
import { config } from './utils/config';
import { pool } from './db/pool';

async function start() {
  // Verify DB connectivity
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');
  } catch (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(
      `LedgerLine running on port ${config.port} [${config.nodeEnv}]`
    );
  });
}

start();
