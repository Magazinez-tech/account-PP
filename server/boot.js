// One-time startup work: create tables, the first admin, the chart of accounts and missing ledger entries.
// Runs once per process. On Netlify every cold start calls ready(), which is a no-op after the first time.
import { migrate } from './db.js';
import { seedAdmin } from './auth.js';
import { seedChart, backfill } from './accounting.js';

let started = null;

export function ready() {
  if (!started) {
    started = (async () => {
      await migrate();
      await seedAdmin();
      await seedChart();
      await backfill();
    })().catch((err) => {
      started = null; // allow a retry on the next request
      throw err;
    });
  }
  return started;
}
