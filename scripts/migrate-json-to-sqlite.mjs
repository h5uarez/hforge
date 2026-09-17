#!/usr/bin/env node
/* One-shot, idempotent JSON -> SQLite migration (Phase 1).
   Reads db.json + state-<uid>.json from DATA_DIR, normalizes through the existing
   normalizeInactivityReminders / preparePersistedState modules (via api/db.js) and
   upserts into <DATA_DIR>/app.db, preserving sv, lastReminder and the canonical
   state document (unknown fields kept) plus hot-column projections.

   Usage: DATA_DIR=... node scripts/migrate-json-to-sqlite.mjs
   Re-running converges without duplicating (upserts / OR IGNORE / OR REPLACE by PK).
   secret and vapid.json are NOT migrated — they stay as files. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, importLegacyData } from '../api/db.js';

const DATA_DIR = process.env.DATA_DIR || '/data';

const store = createDatabase(DATA_DIR);
const counts = importLegacyData(store, DATA_DIR);
store.close();

console.log(`migrated ${path.join(DATA_DIR, 'app.db')}: ${JSON.stringify(counts)}`);
