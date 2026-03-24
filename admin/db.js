const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

let db;

function init(dataDir) {
  const dbPath = path.join(dataDir, 'watch.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run WAL checkpoint on startup to compact
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log('[DB] WAL checkpoint completed on startup');
  } catch (err) {
    console.error('[DB] WAL checkpoint failed:', err.message);
  }

  // Periodic WAL checkpoint every 6 hours
  setInterval(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      console.log('[DB] Periodic WAL checkpoint completed');
    } catch (err) {
      console.error('[DB] Periodic WAL checkpoint failed:', err.message);
    }
  }, 6 * 60 * 60 * 1000);

  db.exec(`
    CREATE TABLE IF NOT EXISTS films (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      category TEXT DEFAULT '',
      year INTEGER DEFAULT 2026,
      description TEXT DEFAULT '',
      synopsis TEXT DEFAULT '',
      credits TEXT DEFAULT '',
      duration_minutes INTEGER,
      role_description TEXT DEFAULT '',
      thumbnail TEXT DEFAULT '',
      video TEXT DEFAULT '',
      password_hash TEXT,
      public INTEGER DEFAULT 1,
      eligible_for_featured INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      film_slug TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
      requested_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      logo TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      password_hash TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL REFERENCES clients(slug) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(client_slug, slug)
    );

    CREATE TABLE IF NOT EXISTS client_project_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_project_id INTEGER NOT NULL REFERENCES client_projects(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      file_path TEXT NOT NULL DEFAULT '',
      thumbnail TEXT DEFAULT '',
      note TEXT DEFAULT '',
      file_size INTEGER,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      duration REAL,
      transcode_status TEXT,
      transcode_progress INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_project_deliverables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_project_id INTEGER NOT NULL REFERENCES client_projects(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT DEFAULT 'video',
      aspect_ratio TEXT DEFAULT '16:9',
      sort_order INTEGER DEFAULT 0,
      is_hero INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_project_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_project_id INTEGER NOT NULL REFERENCES client_projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'other',
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_version_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES client_project_versions(id) ON DELETE CASCADE,
      viewer_name TEXT DEFAULT '',
      max_percent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_version_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES client_project_versions(id) ON DELETE CASCADE,
      timecode_seconds REAL NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      resolved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_version_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('approved', 'changes_requested')),
      author_name TEXT NOT NULL,
      comment TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transcode_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER DEFAULT 0,
      input TEXT,
      output TEXT,
      video_path TEXT,
      thumbnail TEXT,
      thumbnail_options TEXT,
      error TEXT,
      duration REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS client_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_slug TEXT NOT NULL REFERENCES clients(slug) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'other',
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing databases
  const cols = db.pragma('table_info(films)').map(c => c.name);
  if (!cols.includes('password_hash')) {
    db.exec('ALTER TABLE films ADD COLUMN password_hash TEXT');
  }

  // Add visibility column (public/unlisted/private) if missing
  if (!cols.includes('visibility')) {
    db.exec("ALTER TABLE films ADD COLUMN visibility TEXT DEFAULT 'public'");
    // Sync existing public flag: public=0 becomes 'private', public=1 stays 'public'
    db.exec("UPDATE films SET visibility = 'private' WHERE public = 0");
  }

  // Add deliverable_id to client_project_versions if missing
  const cpvCols = db.pragma('table_info(client_project_versions)').map(c => c.name);
  if (!cpvCols.includes('deliverable_id')) {
    db.exec('ALTER TABLE client_project_versions ADD COLUMN deliverable_id INTEGER REFERENCES client_project_deliverables(id)');
  }

  // Add rf_number to client_projects if missing
  const cpCols = db.pragma('table_info(client_projects)').map(c => c.name);
  if (!cpCols.includes('rf_number')) {
    db.exec("ALTER TABLE client_projects ADD COLUMN rf_number TEXT DEFAULT ''");
  }

  // Phase 1 migrations: spec v2 data model
  if (!cpCols.includes('status')) {
    db.exec("ALTER TABLE client_projects ADD COLUMN status TEXT DEFAULT 'active'");
  }

  const delivCols = db.pragma('table_info(client_project_deliverables)').map(c => c.name);
  if (!delivCols.includes('type')) {
    db.exec("ALTER TABLE client_project_deliverables ADD COLUMN type TEXT DEFAULT 'video'");
  }

  // Rename video → file_path if still using old column name
  const cpvCols2 = db.pragma('table_info(client_project_versions)').map(c => c.name);
  if (cpvCols2.includes('video') && !cpvCols2.includes('file_path')) {
    db.exec('ALTER TABLE client_project_versions RENAME COLUMN video TO file_path');
  }

  // Add metadata columns to versions
  const vCols = db.pragma('table_info(client_project_versions)').map(c => c.name);
  if (!vCols.includes('file_size')) db.exec('ALTER TABLE client_project_versions ADD COLUMN file_size INTEGER');
  if (!vCols.includes('mime_type')) db.exec('ALTER TABLE client_project_versions ADD COLUMN mime_type TEXT');
  if (!vCols.includes('width')) db.exec('ALTER TABLE client_project_versions ADD COLUMN width INTEGER');
  if (!vCols.includes('height')) db.exec('ALTER TABLE client_project_versions ADD COLUMN height INTEGER');
  if (!vCols.includes('duration')) db.exec('ALTER TABLE client_project_versions ADD COLUMN duration REAL');
  if (!vCols.includes('transcode_status')) db.exec('ALTER TABLE client_project_versions ADD COLUMN transcode_status TEXT');
  if (!vCols.includes('transcode_progress')) db.exec('ALTER TABLE client_project_versions ADD COLUMN transcode_progress INTEGER DEFAULT 0');

  // Comment threading: add parent_id for replies
  const commentCols = getDb().prepare("PRAGMA table_info(client_version_comments)").all().map(c => c.name);
  if (!commentCols.includes('parent_id')) db.exec('ALTER TABLE client_version_comments ADD COLUMN parent_id INTEGER REFERENCES client_version_comments(id) ON DELETE CASCADE');

  // Fix non-video deliverables that incorrectly have aspect_ratio set
  db.exec("UPDATE client_project_deliverables SET aspect_ratio = NULL WHERE type != 'video' AND type IS NOT NULL AND aspect_ratio IS NOT NULL");

  // External links migration
  const extLinksTable = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='external_links'").get();
  if (!extLinksTable) {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS external_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link_type TEXT NOT NULL,
        parent_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        doc_type TEXT DEFAULT 'document',
        client_visible INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // Add client_visible to resources and project files
  const resCols = db.pragma('table_info(client_resources)').map(c => c.name);
  if (!resCols.includes('client_visible')) {
    db.exec('ALTER TABLE client_resources ADD COLUMN client_visible INTEGER DEFAULT 1');
  }
  const pfCols = db.pragma('table_info(client_project_files)').map(c => c.name);
  if (!pfCols.includes('client_visible')) {
    db.exec('ALTER TABLE client_project_files ADD COLUMN client_visible INTEGER DEFAULT 1');
  }

  // Auto-create default "Widescreen" deliverable for existing client projects that have versions but no deliverables
  const clientProjects = db.prepare('SELECT id FROM client_projects').all();
  for (const cp of clientProjects) {
    const hasDeliverables = db.prepare('SELECT id FROM client_project_deliverables WHERE client_project_id = ?').get(cp.id);
    const hasVersions = db.prepare('SELECT id FROM client_project_versions WHERE client_project_id = ?').get(cp.id);
    if (!hasDeliverables && hasVersions) {
      db.prepare("INSERT INTO client_project_deliverables (client_project_id, slug, label, aspect_ratio, sort_order, is_hero) VALUES (?, 'widescreen', 'Widescreen', '16:9', 0, 1)").run(cp.id);
      const deliv = db.prepare("SELECT id FROM client_project_deliverables WHERE client_project_id = ? AND slug = 'widescreen'").get(cp.id);
      if (deliv) {
        db.prepare('UPDATE client_project_versions SET deliverable_id = ? WHERE client_project_id = ? AND deliverable_id IS NULL').run(deliv.id, cp.id);
      }
    }
  }

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialised — call init(dataDir) first');
  return db;
}

// ---- Films ----

function allFilms() {
  return getDb().prepare('SELECT * FROM films ORDER BY sort_order, id DESC').all();
}

function publicFilms() {
  return getDb().prepare("SELECT * FROM films WHERE public = 1 AND (visibility = 'public' OR visibility IS NULL) ORDER BY sort_order, id DESC").all()
    .map(f => {
      const locked = !!f.password_hash;
      const { password_hash, ...rest } = f;
      return { ...rest, public: !!f.public, eligible_for_featured: !!f.eligible_for_featured, password_protected: locked };
    });
}

function filmBySlug(slug) {
  return getDb().prepare('SELECT * FROM films WHERE slug = ?').get(slug) || null;
}

function createFilm({ slug, title, category, year, description, synopsis, credits, duration_minutes, role_description, thumbnail, video, public: isPublic, eligible_for_featured, visibility }) {
  const stmt = getDb().prepare(`
    INSERT INTO films (slug, title, category, year, description, synopsis, credits, duration_minutes, role_description, thumbnail, video, public, eligible_for_featured, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(slug, title, category || '', year || new Date().getFullYear(), description || '', synopsis || '', credits || '', duration_minutes || null, role_description || '', thumbnail || '', video || '', isPublic ? 1 : 0, eligible_for_featured ? 1 : 0, visibility || 'public');
  return filmBySlug(slug);
}

function updateFilm(slug, fields) {
  const film = filmBySlug(slug);
  if (!film) return null;

  const allowed = ['title', 'slug', 'category', 'year', 'description', 'synopsis', 'credits',
    'duration_minutes', 'role_description', 'thumbnail', 'video', 'public',
    'eligible_for_featured', 'sort_order', 'visibility'];

  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`);
      let val = fields[key];
      if (key === 'public' || key === 'eligible_for_featured') val = val ? 1 : 0;
      values.push(val);
    }
  }
  if (updates.length === 0) return film;

  updates.push("updated_at = datetime('now')");
  values.push(slug);

  getDb().prepare(`UPDATE films SET ${updates.join(', ')} WHERE slug = ?`).run(...values);

  // If slug changed, return by new slug
  return filmBySlug(fields.slug || slug);
}

function featuredFilm() {
  // Pick a deterministic "Film of the Day" from eligible public films
  const eligible = getDb().prepare(
    "SELECT * FROM films WHERE public = 1 AND eligible_for_featured = 1 AND (visibility = 'public' OR visibility IS NULL)"
  ).all();
  if (eligible.length === 0) {
    // Fall back to any public film
    const any = getDb().prepare('SELECT * FROM films WHERE public = 1 ORDER BY id DESC LIMIT 1').get();
    return any ? { ...any, public: true, eligible_for_featured: !!any.eligible_for_featured } : null;
  }
  // Use London date to rotate at midnight UK time
  const londonDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); // YYYY-MM-DD
  const [y, m, d] = londonDate.split('-').map(Number);
  const start = new Date(y, 0, 0);
  const diff = new Date(y, m - 1, d) - start;
  const dayOfYear = Math.floor(diff / 86400000);
  const pick = eligible[dayOfYear % eligible.length];
  return { ...pick, public: true, eligible_for_featured: true };
}

async function setFilmPassword(slug, password) {
  if (!password) {
    getDb().prepare("UPDATE films SET password_hash = NULL, updated_at = datetime('now') WHERE slug = ?").run(slug);
  } else {
    const hash = await bcrypt.hash(password, 10);
    getDb().prepare("UPDATE films SET password_hash = ?, updated_at = datetime('now') WHERE slug = ?").run(hash, slug);
  }
  return filmBySlug(slug);
}

async function verifyFilmPassword(slug, password) {
  const film = getDb().prepare('SELECT password_hash FROM films WHERE slug = ?').get(slug);
  if (!film || !film.password_hash) return false;
  return bcrypt.compare(password, film.password_hash);
}

function filmIsLocked(slug) {
  const film = getDb().prepare('SELECT password_hash FROM films WHERE slug = ?').get(slug);
  return !!(film && film.password_hash);
}

function filmByVideoPath(videoPath) {
  return getDb().prepare('SELECT * FROM films WHERE video = ?').get(videoPath) || null;
}

function deleteFilm(slug) {
  const db = getDb();
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM access_requests WHERE film_slug = ?').run(slug);
    return db.prepare('DELETE FROM films WHERE slug = ?').run(slug);
  });
  return txn();
}

// ---- Access Requests ----

function createAccessRequest({ film_slug, name, email, reason }) {
  const result = getDb().prepare(`
    INSERT INTO access_requests (film_slug, name, email, reason)
    VALUES (?, ?, ?, ?)
  `).run(film_slug, name, email, reason || '');
  return getDb().prepare('SELECT * FROM access_requests WHERE id = ?').get(result.lastInsertRowid);
}

function allAccessRequests() {
  return getDb().prepare('SELECT * FROM access_requests ORDER BY id DESC').all();
}

function pendingAccessRequests() {
  return getDb().prepare("SELECT * FROM access_requests WHERE status = 'pending' ORDER BY id DESC").all();
}

function updateAccessRequest(id, status) {
  getDb().prepare('UPDATE access_requests SET status = ? WHERE id = ?').run(status, id);
  return getDb().prepare('SELECT * FROM access_requests WHERE id = ?').get(id);
}

function deleteAccessRequest(id) {
  return getDb().prepare('DELETE FROM access_requests WHERE id = ?').run(id);
}

// ---- Clients (Portal) ----

function allClients() {
  return getDb().prepare('SELECT * FROM clients ORDER BY name').all()
    .map(c => ({ ...c, active: !!c.active }));
}

function clientBySlug(slug) {
  const c = getDb().prepare('SELECT * FROM clients WHERE slug = ?').get(slug);
  return c ? { ...c, active: !!c.active } : null;
}

async function createClient({ slug, name, logo, notes, password }) {
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  getDb().prepare(`
    INSERT INTO clients (slug, name, logo, notes, password_hash, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(slug, name, logo || '', notes || '', passwordHash);
  return clientBySlug(slug);
}

function updateClient(slug, fields) {
  const client = clientBySlug(slug);
  if (!client) return null;
  const allowed = ['name', 'slug', 'logo', 'notes', 'active'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`);
      values.push(key === 'active' ? (fields[key] ? 1 : 0) : fields[key]);
    }
  }
  if (updates.length === 0) return client;
  updates.push("updated_at = datetime('now')");
  values.push(slug);

  const newSlug = fields.slug;
  const slugChanging = newSlug && newSlug !== slug;

  const db = getDb();
  const txn = db.transaction(() => {
    // If slug is changing, update child table references first
    if (slugChanging) {
      db.prepare('UPDATE client_projects SET client_slug = ? WHERE client_slug = ?').run(newSlug, slug);
      db.prepare('UPDATE client_resources SET client_slug = ? WHERE client_slug = ?').run(newSlug, slug);
    }
    db.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE slug = ?`).run(...values);
  });
  txn();

  return clientBySlug(newSlug || slug);
}

function deleteClient(slug) {
  const db = getDb();
  // Get all projects for this client before deleting
  const projects = db.prepare('SELECT id FROM client_projects WHERE client_slug = ?').all(slug);
  const projectIds = projects.map(p => p.id);

  if (projectIds.length > 0) {
    // Get all version IDs across all projects
    const placeholders = projectIds.map(() => '?').join(',');
    const versions = db.prepare(`SELECT id FROM client_project_versions WHERE client_project_id IN (${placeholders})`).all(...projectIds);
    const versionIds = versions.map(v => v.id);

    // Clean up approvals (no cascade defined)
    if (versionIds.length > 0) {
      const vPlaceholders = versionIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM client_version_approvals WHERE version_id IN (${vPlaceholders})`).run(...versionIds);
    }

    // Clean up external links (no foreign key)
    for (const pid of projectIds) {
      db.prepare("DELETE FROM external_links WHERE link_type = 'project' AND parent_id = ?").run(pid);
    }
  }

  // Clean up client-level external links
  const client = db.prepare('SELECT id FROM clients WHERE slug = ?').get(slug);
  if (client) {
    db.prepare("DELETE FROM external_links WHERE link_type = 'client' AND parent_id = ?").run(client.id);
  }

  // Now delete the client — cascades handle projects, versions, comments, resources, views, deliverables, files
  return db.prepare('DELETE FROM clients WHERE slug = ?').run(slug);
}

async function setClientPassword(slug, password) {
  if (!password) {
    getDb().prepare("UPDATE clients SET password_hash = NULL, updated_at = datetime('now') WHERE slug = ?").run(slug);
  } else {
    const hash = await bcrypt.hash(password, 10);
    getDb().prepare("UPDATE clients SET password_hash = ?, updated_at = datetime('now') WHERE slug = ?").run(hash, slug);
  }
  return clientBySlug(slug);
}

async function verifyClientPassword(slug, password) {
  const c = getDb().prepare('SELECT password_hash FROM clients WHERE slug = ?').get(slug);
  if (!c || !c.password_hash) return false;
  return bcrypt.compare(password, c.password_hash);
}

function clientIsLocked(slug) {
  const c = getDb().prepare('SELECT password_hash FROM clients WHERE slug = ?').get(slug);
  return !!(c && c.password_hash);
}

// ---- Client Projects ----

function clientProjectsByClient(clientSlug) {
  return getDb().prepare('SELECT * FROM client_projects WHERE client_slug = ? ORDER BY sort_order, id DESC').all(clientSlug);
}

function clientProjectBySlug(clientSlug, projectSlug) {
  return getDb().prepare('SELECT * FROM client_projects WHERE client_slug = ? AND slug = ?').get(clientSlug, projectSlug) || null;
}

function createClientProject({ client_slug, slug, title, description, rf_number }) {
  getDb().prepare(`
    INSERT INTO client_projects (client_slug, slug, title, description, rf_number)
    VALUES (?, ?, ?, ?, ?)
  `).run(client_slug, slug, title, description || '', rf_number || '');
  return clientProjectBySlug(client_slug, slug);
}

function updateClientProject(clientSlug, projectSlug, fields) {
  const project = clientProjectBySlug(clientSlug, projectSlug);
  if (!project) return null;
  const allowed = ['title', 'slug', 'description', 'sort_order', 'rf_number', 'status'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (updates.length === 0) return project;
  updates.push("updated_at = datetime('now')");
  values.push(project.id);
  getDb().prepare(`UPDATE client_projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return clientProjectBySlug(clientSlug, fields.slug || projectSlug);
}

function deleteClientProject(clientSlug, projectSlug) {
  const db = getDb();
  const project = db.prepare('SELECT id FROM client_projects WHERE client_slug = ? AND slug = ?').get(clientSlug, projectSlug);
  if (project) {
    // Clean up approvals for all versions in this project
    const versions = db.prepare('SELECT id FROM client_project_versions WHERE client_project_id = ?').all(project.id);
    const versionIds = versions.map(v => v.id);
    if (versionIds.length > 0) {
      const placeholders = versionIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM client_version_approvals WHERE version_id IN (${placeholders})`).run(...versionIds);
    }
    // Clean up external links
    db.prepare("DELETE FROM external_links WHERE link_type = 'project' AND parent_id = ?").run(project.id);
  }
  return db.prepare('DELETE FROM client_projects WHERE client_slug = ? AND slug = ?').run(clientSlug, projectSlug);
}

// ---- Client Project Versions ----

function clientVersionsByProject(projectId) {
  return getDb().prepare('SELECT * FROM client_project_versions WHERE client_project_id = ? ORDER BY version_number DESC').all(projectId);
}

function clientVersionsByDeliverable(deliverableId) {
  return getDb().prepare(`
    SELECT v.*,
      a.status AS approval_status,
      a.author_name AS approval_author,
      (SELECT COUNT(*) FROM client_version_comments c WHERE c.version_id = v.id) AS comment_count,
      (SELECT COUNT(*) FROM client_version_comments c WHERE c.version_id = v.id AND c.resolved = 0) AS open_comment_count
    FROM client_project_versions v
    LEFT JOIN client_version_approvals a ON a.version_id = v.id
    WHERE v.deliverable_id = ?
    ORDER BY v.version_number DESC
  `).all(deliverableId);
}

function createClientVersion({ client_project_id, deliverable_id, file_path, thumbnail, note, file_size, mime_type, width, height, duration, transcode_status, transcode_progress }) {
  const db = getDb();
  // Atomic read-then-write to prevent duplicate version numbers
  const txn = db.transaction(() => {
    let max;
    if (deliverable_id) {
      max = db.prepare('SELECT MAX(version_number) as m FROM client_project_versions WHERE deliverable_id = ?').get(deliverable_id);
    } else {
      max = db.prepare('SELECT MAX(version_number) as m FROM client_project_versions WHERE client_project_id = ?').get(client_project_id);
    }
    const versionNumber = (max && max.m ? max.m : 0) + 1;
    const result = db.prepare(`INSERT INTO client_project_versions
      (client_project_id, deliverable_id, version_number, file_path, thumbnail, note, file_size, mime_type, width, height, duration, transcode_status, transcode_progress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      client_project_id, deliverable_id || null, versionNumber, file_path || '', thumbnail || '', note || '',
      file_size || null, mime_type || null, width || null, height || null, duration || null,
      transcode_status || null, transcode_progress || 0
    );
    return db.prepare('SELECT * FROM client_project_versions WHERE id = ?').get(result.lastInsertRowid);
  });
  return txn();
}

function updateClientVersion(id, fields) {
  const allowed = ['file_path', 'thumbnail', 'note', 'file_size', 'mime_type', 'width', 'height', 'duration', 'transcode_status', 'transcode_progress'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (updates.length === 0) return null;
  values.push(id);
  getDb().prepare(`UPDATE client_project_versions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getDb().prepare('SELECT * FROM client_project_versions WHERE id = ?').get(id);
}

function deleteClientVersion(id) {
  return getDb().prepare('DELETE FROM client_project_versions WHERE id = ?').run(id);
}

function latestClientVersion(projectId) {
  return getDb().prepare('SELECT * FROM client_project_versions WHERE client_project_id = ? ORDER BY version_number DESC LIMIT 1').get(projectId) || null;
}

// ---- Client Project Deliverables (Formats) ----

function deliverablesByProject(projectId) {
  return getDb().prepare('SELECT * FROM client_project_deliverables WHERE client_project_id = ? ORDER BY sort_order, id').all(projectId);
}

function deliverableById(id) {
  return getDb().prepare('SELECT * FROM client_project_deliverables WHERE id = ?').get(id) || null;
}

function createDeliverable({ client_project_id, slug, label, type, aspect_ratio, sort_order, is_hero }) {
  const delivType = type || 'video';
  // Only video deliverables have aspect ratios
  const ar = delivType === 'video' ? (aspect_ratio || '16:9') : null;
  getDb().prepare(`
    INSERT INTO client_project_deliverables (client_project_id, slug, label, type, aspect_ratio, sort_order, is_hero)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(client_project_id, slug, label, delivType, ar, sort_order || 0, is_hero ? 1 : 0);
  return getDb().prepare('SELECT * FROM client_project_deliverables WHERE client_project_id = ? AND slug = ?').get(client_project_id, slug);
}

function updateDeliverable(id, fields) {
  const d = deliverableById(id);
  if (!d) return null;
  const allowed = ['label', 'slug', 'type', 'aspect_ratio', 'sort_order', 'is_hero'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`);
      values.push(key === 'is_hero' ? (fields[key] ? 1 : 0) : fields[key]);
    }
  }
  if (updates.length === 0) return d;
  values.push(id);
  getDb().prepare(`UPDATE client_project_deliverables SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return deliverableById(id);
}

function deleteDeliverable(id) {
  return getDb().prepare('DELETE FROM client_project_deliverables WHERE id = ?').run(id);
}

// Ensure a project has at least a default deliverable; returns the hero/first one
function ensureDefaultDeliverable(projectId) {
  const existing = getDb().prepare('SELECT * FROM client_project_deliverables WHERE client_project_id = ? ORDER BY sort_order, id LIMIT 1').get(projectId);
  if (existing) return existing;
  getDb().prepare("INSERT INTO client_project_deliverables (client_project_id, slug, label, aspect_ratio, sort_order, is_hero) VALUES (?, 'widescreen', 'Widescreen', '16:9', 0, 1)").run(projectId);
  return getDb().prepare("SELECT * FROM client_project_deliverables WHERE client_project_id = ? AND slug = 'widescreen'").get(projectId);
}

// ---- Client Project Files ----

function projectFilesByProject(projectId, category, clientVisibleOnly) {
  const vis = clientVisibleOnly ? ' AND client_visible = 1' : '';
  if (category && category !== 'all') {
    return getDb().prepare(`SELECT * FROM client_project_files WHERE client_project_id = ? AND category = ?${vis} ORDER BY created_at DESC`).all(projectId, category);
  }
  return getDb().prepare(`SELECT * FROM client_project_files WHERE client_project_id = ?${vis} ORDER BY created_at DESC`).all(projectId);
}

function createProjectFile({ client_project_id, category, filename, original_name, file_path, file_size, mime_type }) {
  const result = getDb().prepare(`
    INSERT INTO client_project_files (client_project_id, category, filename, original_name, file_path, file_size, mime_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(client_project_id, category || 'other', filename, original_name, file_path, file_size || 0, mime_type || '');
  return getDb().prepare('SELECT * FROM client_project_files WHERE id = ?').get(result.lastInsertRowid);
}

function projectFileById(id) {
  return getDb().prepare('SELECT * FROM client_project_files WHERE id = ?').get(id) || null;
}

function deleteProjectFile(id) {
  return getDb().prepare('DELETE FROM client_project_files WHERE id = ?').run(id);
}

// ---- Client Resources ----

function clientResourcesByClient(clientSlug, category, clientVisibleOnly) {
  const vis = clientVisibleOnly ? ' AND client_visible = 1' : '';
  if (category && category !== 'all') {
    return getDb().prepare(`SELECT * FROM client_resources WHERE client_slug = ? AND category = ?${vis} ORDER BY created_at DESC`).all(clientSlug, category);
  }
  return getDb().prepare(`SELECT * FROM client_resources WHERE client_slug = ?${vis} ORDER BY created_at DESC`).all(clientSlug);
}

function createClientResource({ client_slug, category, filename, original_name, file_path, file_size, mime_type }) {
  const result = getDb().prepare(`
    INSERT INTO client_resources (client_slug, category, filename, original_name, file_path, file_size, mime_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(client_slug, category || 'other', filename, original_name, file_path, file_size || 0, mime_type || '');
  return getDb().prepare('SELECT * FROM client_resources WHERE id = ?').get(result.lastInsertRowid);
}

function deleteClientResource(id) {
  return getDb().prepare('DELETE FROM client_resources WHERE id = ?').run(id);
}

function clientResourceById(id) {
  return getDb().prepare('SELECT * FROM client_resources WHERE id = ?').get(id) || null;
}

function setResourceVisibility(id, clientVisible) {
  getDb().prepare('UPDATE client_resources SET client_visible = ? WHERE id = ?').run(clientVisible ? 1 : 0, id);
}

function setProjectFileVisibility(id, clientVisible) {
  getDb().prepare('UPDATE client_project_files SET client_visible = ? WHERE id = ?').run(clientVisible ? 1 : 0, id);
}

// ---- View Tracking ----

function trackView({ version_id, viewer_name, max_percent }) {
  // Upsert: one row per version+viewer, update max_percent if higher
  const existing = getDb().prepare('SELECT * FROM client_version_views WHERE version_id = ? AND viewer_name = ?').get(version_id, viewer_name || '');
  if (existing) {
    if (max_percent > existing.max_percent) {
      getDb().prepare("UPDATE client_version_views SET max_percent = ?, updated_at = datetime('now') WHERE id = ?").run(max_percent, existing.id);
    }
    return getDb().prepare('SELECT * FROM client_version_views WHERE id = ?').get(existing.id);
  }
  const result = getDb().prepare('INSERT INTO client_version_views (version_id, viewer_name, max_percent) VALUES (?, ?, ?)').run(version_id, viewer_name || '', max_percent || 0);
  return getDb().prepare('SELECT * FROM client_version_views WHERE id = ?').get(result.lastInsertRowid);
}

function viewsByVersion(versionId) {
  return getDb().prepare('SELECT * FROM client_version_views WHERE version_id = ? ORDER BY updated_at DESC').all(versionId);
}

function viewsByProject(projectId) {
  return getDb().prepare(`
    SELECT v.*, cpv.version_number, cpv.deliverable_id
    FROM client_version_views v
    JOIN client_project_versions cpv ON cpv.id = v.version_id
    WHERE cpv.client_project_id = ?
    ORDER BY v.updated_at DESC
  `).all(projectId);
}

function maxViewForProject(projectId) {
  // Returns the highest max_percent across all versions in a project
  const row = getDb().prepare(`
    SELECT MAX(v.max_percent) as max_pct
    FROM client_version_views v
    JOIN client_project_versions cpv ON cpv.id = v.version_id
    WHERE cpv.client_project_id = ?
  `).get(projectId);
  return row ? row.max_pct : 0;
}

// ---- Comments & Approvals ----

function createComment({ version_id, timecode_seconds, author_name, text, parent_id }) {
  const result = getDb().prepare(`
    INSERT INTO client_version_comments (version_id, timecode_seconds, author_name, text, parent_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(version_id, timecode_seconds, author_name, text, parent_id || null);
  return getDb().prepare('SELECT * FROM client_version_comments WHERE id = ?').get(result.lastInsertRowid);
}

function commentsByVersion(versionId) {
  return getDb().prepare('SELECT * FROM client_version_comments WHERE version_id = ? ORDER BY timecode_seconds ASC').all(versionId);
}

function resolveComment(id, resolved) {
  getDb().prepare('UPDATE client_version_comments SET resolved = ? WHERE id = ?').run(resolved ? 1 : 0, id);
  return getDb().prepare('SELECT * FROM client_version_comments WHERE id = ?').get(id);
}

function deleteComment(id) {
  return getDb().prepare('DELETE FROM client_version_comments WHERE id = ?').run(id);
}

function setVersionApproval({ version_id, status, author_name, comment }) {
  getDb().prepare(`
    INSERT INTO client_version_approvals (version_id, status, author_name, comment)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(version_id) DO UPDATE SET status = excluded.status, author_name = excluded.author_name, comment = excluded.comment, updated_at = datetime('now')
  `).run(version_id, status, author_name, comment || '');
  return getDb().prepare('SELECT * FROM client_version_approvals WHERE version_id = ?').get(version_id);
}

function approvalByVersion(versionId) {
  return getDb().prepare('SELECT * FROM client_version_approvals WHERE version_id = ?').get(versionId) || null;
}

// ---- External Links ----

function createExternalLink({ link_type, parent_id, url, title, doc_type, client_visible }) {
  const result = getDb().prepare(`
    INSERT INTO external_links (link_type, parent_id, url, title, doc_type, client_visible)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(link_type, parent_id, url, title, doc_type || 'document', client_visible !== undefined ? (client_visible ? 1 : 0) : 1);
  return getDb().prepare('SELECT * FROM external_links WHERE id = ?').get(result.lastInsertRowid);
}

function updateExternalLink(id, fields) {
  const allowed = ['title', 'url', 'doc_type', 'client_visible', 'sort_order'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`);
      values.push(key === 'client_visible' ? (fields[key] ? 1 : 0) : fields[key]);
    }
  }
  if (updates.length === 0) return null;
  values.push(id);
  getDb().prepare(`UPDATE external_links SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getDb().prepare('SELECT * FROM external_links WHERE id = ?').get(id);
}

function deleteExternalLink(id) {
  return getDb().prepare('DELETE FROM external_links WHERE id = ?').run(id);
}

function externalLinksByParent(linkType, parentId, clientVisibleOnly) {
  if (clientVisibleOnly) {
    return getDb().prepare('SELECT * FROM external_links WHERE link_type = ? AND parent_id = ? AND client_visible = 1 ORDER BY sort_order, id').all(linkType, parentId);
  }
  return getDb().prepare('SELECT * FROM external_links WHERE link_type = ? AND parent_id = ? ORDER BY sort_order, id').all(linkType, parentId);
}

function externalLinkById(id) {
  return getDb().prepare('SELECT * FROM external_links WHERE id = ?').get(id) || null;
}

// ---- Transcode Jobs ----

function createTranscodeJob(id, data) {
  getDb().prepare(`
    INSERT INTO transcode_jobs (id, status, progress, input, output, video_path, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.status || 'queued', data.progress || 0, data.input || '', data.output || '', data.videoPath || '', data.error || null);
}

function updateTranscodeJob(id, data) {
  const updates = [];
  const values = [];
  const allowed = { status: 'status', progress: 'progress', input: 'input', output: 'output',
    videoPath: 'video_path', thumbnail: 'thumbnail', thumbnailOptions: 'thumbnail_options',
    error: 'error', duration: 'duration' };
  for (const [jsKey, dbCol] of Object.entries(allowed)) {
    if (jsKey in data && data[jsKey] !== undefined) {
      updates.push(`${dbCol} = ?`);
      const val = jsKey === 'thumbnailOptions' ? JSON.stringify(data[jsKey]) : data[jsKey];
      values.push(val);
    }
  }
  if (updates.length === 0) return;
  updates.push("updated_at = datetime('now')");
  values.push(id);
  getDb().prepare(`UPDATE transcode_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

function getTranscodeJob(id) {
  const row = getDb().prepare('SELECT * FROM transcode_jobs WHERE id = ?').get(id);
  if (!row) return null;
  return {
    status: row.status,
    progress: row.progress,
    input: row.input,
    output: row.output,
    videoPath: row.video_path,
    thumbnail: row.thumbnail,
    thumbnailOptions: row.thumbnail_options ? JSON.parse(row.thumbnail_options) : [],
    error: row.error,
    duration: row.duration,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function allTranscodeJobs() {
  return getDb().prepare('SELECT * FROM transcode_jobs ORDER BY created_at DESC').all().map(row => ({
    id: row.id,
    status: row.status,
    progress: row.progress,
    input: row.input,
    output: row.output,
    videoPath: row.video_path,
    thumbnail: row.thumbnail,
    thumbnailOptions: row.thumbnail_options ? JSON.parse(row.thumbnail_options) : [],
    error: row.error,
    duration: row.duration,
    created_at: row.created_at
  }));
}

function markOrphanedJobs() {
  const result = getDb().prepare(`
    UPDATE transcode_jobs SET status = 'error', error = 'Server restarted during transcode', updated_at = datetime('now')
    WHERE status IN ('queued', 'probing', 'transcoding', 'generating_thumbnail')
  `).run();
  return result.changes;
}

function openCommentCountByClient(clientSlug) {
  const row = getDb().prepare(`
    SELECT COUNT(*) as total, SUM(CASE WHEN c.resolved = 0 THEN 1 ELSE 0 END) as open
    FROM client_version_comments c
    JOIN client_project_versions v ON v.id = c.version_id
    JOIN client_projects p ON p.id = v.client_project_id
    WHERE p.client_slug = ?
  `).get(clientSlug);
  return { total: row?.total || 0, open: row?.open || 0 };
}

module.exports = {
  init, getDb,
  allFilms, publicFilms, filmBySlug, filmByVideoPath, featuredFilm, createFilm, updateFilm, deleteFilm,
  setFilmPassword, verifyFilmPassword, filmIsLocked,
  createAccessRequest, allAccessRequests, pendingAccessRequests, updateAccessRequest, deleteAccessRequest,
  // Client Portal
  allClients, clientBySlug, createClient, updateClient, deleteClient,
  setClientPassword, verifyClientPassword, clientIsLocked,
  clientProjectsByClient, clientProjectBySlug, createClientProject, updateClientProject, deleteClientProject,
  clientVersionsByProject, clientVersionsByDeliverable, createClientVersion, updateClientVersion, deleteClientVersion, latestClientVersion,
  deliverablesByProject, deliverableById, createDeliverable, updateDeliverable, deleteDeliverable, ensureDefaultDeliverable,
  projectFilesByProject, createProjectFile, projectFileById, deleteProjectFile, setProjectFileVisibility,
  clientResourcesByClient, createClientResource, deleteClientResource, clientResourceById, setResourceVisibility,
  // View Tracking
  trackView, viewsByVersion, viewsByProject, maxViewForProject,
  // Comments & Approvals
  createComment, commentsByVersion, resolveComment, deleteComment, openCommentCountByClient,
  setVersionApproval, approvalByVersion,
  // Transcode Jobs
  createTranscodeJob, updateTranscodeJob, getTranscodeJob, allTranscodeJobs, markOrphanedJobs,
  // External Links
  createExternalLink, updateExternalLink, deleteExternalLink, externalLinksByParent, externalLinkById
};
