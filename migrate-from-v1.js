#!/usr/bin/env node
/**
 * migrate-from-v1.js
 * Migrates data from the old Watch Webbed Films (v1) database to the new v2 schema.
 *
 * What it does:
 *   1. Copies all films (preserving slugs, UUIDs, passwords, visibility, sort order)
 *   2. Copies the legacy "projects" table into the new "clients" system
 *      - Each old project becomes a client with the UUID as its slug
 *      - Project versions become client_project_versions under a default deliverable
 *   3. Copies access_requests as-is (same schema)
 *
 * What it does NOT do:
 *   - Touch any video files (they stay on the Unraid share at /mnt/user/watch)
 *   - Modify the source database
 *   - Run automatically — you must review the dry-run output first
 *
 * Usage:
 *   node migrate-from-v1.js --dry-run    # Show what would happen (no writes)
 *   node migrate-from-v1.js --execute    # Actually run the migration
 */

const Database = require('better-sqlite3');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

if (!DRY_RUN && !EXECUTE) {
  console.log('Usage:');
  console.log('  node migrate-from-v1.js --dry-run    # Preview migration');
  console.log('  node migrate-from-v1.js --execute     # Run migration');
  process.exit(1);
}

// Paths — adjust if running from a different location
const sourceIdx = process.argv.indexOf('--source');
const V1_DB = sourceIdx !== -1 && process.argv[sourceIdx + 1]
  ? path.resolve(process.argv[sourceIdx + 1])
  : path.join(__dirname, '..', 'watch-webbed-films', 'data', 'watch.db');
const V2_DB = path.join(__dirname, 'data', 'watch.db');

console.log(`Source (v1): ${V1_DB}`);
console.log(`Target (v2): ${V2_DB}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}\n`);

// Open databases
const src = new Database(V1_DB, { readonly: true });
const dst = DRY_RUN ? null : new Database(V2_DB);

if (dst) {
  dst.pragma('journal_mode = WAL');
  dst.pragma('foreign_keys = ON');
}

// ── 1. Migrate films ─────────────────────────────────────
const films = src.prepare('SELECT * FROM films ORDER BY id').all();
console.log(`Films to migrate: ${films.length}`);

if (films.length > 0) {
  // Map "Original" category to "Short Films" (v2 doesn't have "Original")
  const categoryMap = {
    'Original': 'Short Films',
  };

  const filmInsert = dst?.prepare(`
    INSERT OR IGNORE INTO films (
      slug, title, category, year, description, synopsis, credits,
      duration_minutes, role_description, thumbnail, video,
      password_hash, public, eligible_for_featured, sort_order,
      created_at, updated_at, visibility
    ) VALUES (
      @slug, @title, @category, @year, @description, @synopsis, @credits,
      @duration_minutes, @role_description, @thumbnail, @video,
      @password_hash, @public, @eligible_for_featured, @sort_order,
      @created_at, @updated_at, @visibility
    )
  `);

  let migrated = 0;
  for (const film of films) {
    const category = categoryMap[film.category] || film.category;
    const visibility = film.visibility || (film.public ? 'public' : 'private');

    if (DRY_RUN) {
      console.log(`  [film] ${film.slug} — "${film.title}" (${category}, ${visibility})`);
    } else {
      filmInsert.run({
        ...film,
        category,
        visibility,
      });
    }
    migrated++;
  }
  console.log(`  → ${migrated} films ${DRY_RUN ? 'would be' : ''} migrated\n`);
}

// ── 2. Migrate legacy projects → clients system ──────────
const projects = src.prepare('SELECT * FROM projects ORDER BY id').all();
console.log(`Legacy projects to migrate: ${projects.length}`);

if (projects.length > 0) {
  for (const proj of projects) {
    const versions = src.prepare(
      'SELECT * FROM project_versions WHERE project_uuid = ? ORDER BY version_number'
    ).all(proj.uuid);

    if (DRY_RUN) {
      console.log(`  [project] UUID: ${proj.uuid} — "${proj.title}" (active: ${proj.active})`);
      console.log(`    → ${versions.length} version(s)`);
      for (const v of versions) {
        console.log(`      v${v.version_number}: ${v.video} ${v.note ? `(${v.note})` : ''}`);
      }
    } else {
      // Create a client using the project UUID as the slug (preserves screening links)
      dst.prepare(`
        INSERT OR IGNORE INTO clients (slug, name, active, created_at)
        VALUES (?, ?, ?, ?)
      `).run(proj.uuid, proj.title, proj.active, proj.created || new Date().toISOString());

      // Create a default project under that client
      dst.prepare(`
        INSERT OR IGNORE INTO client_projects (client_slug, slug, title, status, created_at)
        VALUES (?, 'main', ?, ?, ?)
      `).run(proj.uuid, proj.title, proj.active ? 'active' : 'completed', proj.created || new Date().toISOString());

      // Get the client_project ID
      const cp = dst.prepare(
        "SELECT id FROM client_projects WHERE client_slug = ? AND slug = 'main'"
      ).get(proj.uuid);

      if (cp && versions.length > 0) {
        // Create a default deliverable
        dst.prepare(`
          INSERT OR IGNORE INTO client_project_deliverables (client_project_id, slug, label, is_hero)
          VALUES (?, 'main', 'Main Cut', 1)
        `).run(cp.id);

        // Insert versions
        const vInsert = dst.prepare(`
          INSERT INTO client_project_versions (client_project_id, version_number, file_path, thumbnail, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const v of versions) {
          vInsert.run(cp.id, v.version_number, v.video, v.thumbnail || '', v.note || '', v.created_at);
        }
      }
    }
  }
  console.log(`  → ${projects.length} project(s) ${DRY_RUN ? 'would be' : ''} migrated\n`);
}

// ── 3. Migrate access requests ───────────────────────────
const requests = src.prepare('SELECT * FROM access_requests ORDER BY id').all();
console.log(`Access requests to migrate: ${requests.length}`);

if (requests.length > 0) {
  const reqInsert = dst?.prepare(`
    INSERT OR IGNORE INTO access_requests (film_slug, name, email, reason, status, requested_at)
    VALUES (@film_slug, @name, @email, @reason, @status, @requested_at)
  `);

  for (const req of requests) {
    if (DRY_RUN) {
      console.log(`  [request] ${req.film_slug} — ${req.name} (${req.status})`);
    } else {
      reqInsert.run(req);
    }
  }
  console.log(`  → ${requests.length} request(s) ${DRY_RUN ? 'would be' : ''} migrated\n`);
}

// ── Summary ──────────────────────────────────────────────
console.log('=== MIGRATION SUMMARY ===');
console.log(`Films:           ${films.length}`);
console.log(`Projects:        ${projects.length}`);
console.log(`Access requests: ${requests.length}`);

if (projects.length > 0) {
  console.log(`\nScreening link preservation:`);
  for (const proj of projects) {
    console.log(`  watch.webbedfilms.com/portal/${proj.uuid} → client portal for "${proj.title}"`);
  }
  console.log(`\nNote: Old screening links (/screening.html?id=UUID) will need a redirect`);
  console.log(`to the new portal URL (/portal/UUID). Add this in server.js if needed.`);
}

if (!DRY_RUN && dst) {
  console.log('\nVerifying...');
  const fCount = dst.prepare('SELECT COUNT(*) as c FROM films').get().c;
  const cCount = dst.prepare('SELECT COUNT(*) as c FROM clients').get().c;
  console.log(`  Films in v2 DB: ${fCount}`);
  console.log(`  Clients in v2 DB: ${cCount}`);
}

console.log(`\n${DRY_RUN ? 'Dry run complete — no changes made.' : 'Migration complete!'}`);

src.close();
if (dst) dst.close();
