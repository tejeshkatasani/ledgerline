/**
 * Production start script.
 * Runs migrations then starts the server.
 * Used by Render's startCommand so DATABASE_URL is available at runtime.
 */
const { execSync } = require('child_process');

console.log('Running database migrations...');
try {
  execSync('node dist/db/migrate.js', { stdio: 'inherit' });
  console.log('Migrations complete. Starting server...');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
}

require('./dist/index.js');
