/** Standalone migration runner: `npm run db:migrate`. */
import { getDb, runMigrations, closeDb } from './index.js';

try {
  getDb();
  runMigrations();
  console.log('Migrations applied.');
  closeDb();
  process.exit(0);
} catch (err) {
  console.error('Migration failed:', err);
  process.exit(1);
}
