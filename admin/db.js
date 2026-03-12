const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

let db;

function init(dataDir) {
  const dbPath = path.join(dataDir, 'watch.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      video TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS project_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_uuid TEXT NOT NULL REFERENCES projects(uuid) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      video TEXT NOT NULL,
      thumbnail TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing databases
  const cols = db.pragma('table_info(films)').map(c => c.name);
  if (!cols.includes('password_hash')) {
    db.exec('ALTER TABLE films ADD COLUMN password_hash TEXT');
  }

  // Migrate existing projects with video into project_versions
  const projects = db.prepare('SELECT uuid, video FROM projects WHERE video != ""').all();
  for (const p of projects) {
    const existing = db.prepare('SELECT id FROM project_versions WHERE project_uuid = ?').get(p.uuid);
    if (!existing) {
      db.prepare('INSERT INTO project_versions (project_uuid, version_number, video, note) VALUES (?, 1, ?, ?)').run(p.uuid, p.video, 'Initial version');
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
  return getDb().prepare('SELECT * FROM films WHERE public = 1 ORDER BY sort_order, id DESC').all()
    .map(f => {
      const locked = !!f.password_hash;
      const { password_hash, ...rest } = f;
      return { ...rest, public: !!f.public, eligible_for_featured: !!f.eligible_for_featured, password_protected: locked };
    });
}

function filmBySlug(slug) {
  return getDb().prepare('SELECT * FROM films WHERE slug = ?').get(slug) || null;
}

function createFilm({ slug, title, category, year, description, synopsis, credits, duration_minutes, role_description, thumbnail, video, public: isPublic, eligible_for_featured }) {
  const stmt = getDb().prepare(`
    INSERT INTO films (slug, title, category, year, description, synopsis, credits, duration_minutes, role_description, thumbnail, video, public, eligible_for_featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(slug, title, category || '', year || new Date().getFullYear(), description || '', synopsis || '', credits || '', duration_minutes || null, role_description || '', thumbnail || '', video || '', isPublic ? 1 : 0, eligible_for_featured ? 1 : 0);
  return filmBySlug(slug);
}

function updateFilm(slug, fields) {
  const film = filmBySlug(slug);
  if (!film) return null;

  const allowed = ['title', 'slug', 'category', 'year', 'description', 'synopsis', 'credits',
    'duration_minutes', 'role_description', 'thumbnail', 'video', 'public',
    'eligible_for_featured', 'sort_order'];

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
    'SELECT * FROM films WHERE public = 1 AND eligible_for_featured = 1'
  ).all();
  if (eligible.length === 0) {
    // Fall back to any public film
    const any = getDb().prepare('SELECT * FROM films WHERE public = 1 ORDER BY id DESC LIMIT 1').get();
    return any ? { ...any, public: true, eligible_for_featured: !!any.eligible_for_featured } : null;
  }
  // Use day-of-year to rotate deterministically
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const pick = eligible[dayOfYear % eligible.length];
  return { ...pick, public: true, eligible_for_featured: true };
}

function setFilmPassword(slug, password) {
  if (!password) {
    // Clear password
    getDb().prepare("UPDATE films SET password_hash = NULL, updated_at = datetime('now') WHERE slug = ?").run(slug);
  } else {
    const hash = bcrypt.hashSync(password, 10);
    getDb().prepare("UPDATE films SET password_hash = ?, updated_at = datetime('now') WHERE slug = ?").run(hash, slug);
  }
  return filmBySlug(slug);
}

function verifyFilmPassword(slug, password) {
  const film = getDb().prepare('SELECT password_hash FROM films WHERE slug = ?').get(slug);
  if (!film || !film.password_hash) return false;
  return bcrypt.compareSync(password, film.password_hash);
}

function filmIsLocked(slug) {
  const film = getDb().prepare('SELECT password_hash FROM films WHERE slug = ?').get(slug);
  return !!(film && film.password_hash);
}

function deleteFilm(slug) {
  return getDb().prepare('DELETE FROM films WHERE slug = ?').run(slug);
}

// ---- Projects ----

function allProjects() {
  return getDb().prepare('SELECT * FROM projects ORDER BY id DESC').all()
    .map(p => ({ ...p, active: !!p.active }));
}

function projectByUuid(uuid) {
  const p = getDb().prepare('SELECT * FROM projects WHERE uuid = ?').get(uuid);
  return p ? { ...p, active: !!p.active } : null;
}

function createProject({ uuid, title, video }) {
  getDb().prepare(`
    INSERT INTO projects (uuid, title, video, active, created)
    VALUES (?, ?, ?, 1, date('now'))
  `).run(uuid, title, video || '');
  return projectByUuid(uuid);
}

function updateProject(uuid, fields) {
  const project = projectByUuid(uuid);
  if (!project) return null;

  const allowed = ['title', 'video', 'active'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      updates.push(`${key} = ?`);
      values.push(key === 'active' ? (fields[key] ? 1 : 0) : fields[key]);
    }
  }
  if (updates.length === 0) return project;

  values.push(uuid);
  getDb().prepare(`UPDATE projects SET ${updates.join(', ')} WHERE uuid = ?`).run(...values);
  return projectByUuid(uuid);
}

function deleteProject(uuid) {
  return getDb().prepare('DELETE FROM projects WHERE uuid = ?').run(uuid);
}

// ---- Project Versions ----

function versionsByProject(uuid) {
  return getDb().prepare('SELECT * FROM project_versions WHERE project_uuid = ? ORDER BY version_number DESC').all(uuid);
}

function latestVersion(uuid) {
  return getDb().prepare('SELECT * FROM project_versions WHERE project_uuid = ? ORDER BY version_number DESC LIMIT 1').get(uuid) || null;
}

function createVersion({ project_uuid, video, thumbnail, note }) {
  const max = getDb().prepare('SELECT MAX(version_number) as m FROM project_versions WHERE project_uuid = ?').get(project_uuid);
  const versionNumber = (max && max.m ? max.m : 0) + 1;
  getDb().prepare('INSERT INTO project_versions (project_uuid, version_number, video, thumbnail, note) VALUES (?, ?, ?, ?, ?)').run(project_uuid, versionNumber, video, thumbnail || '', note || '');
  return getDb().prepare('SELECT * FROM project_versions WHERE project_uuid = ? AND version_number = ?').get(project_uuid, versionNumber);
}

function deleteVersion(id) {
  return getDb().prepare('DELETE FROM project_versions WHERE id = ?').run(id);
}

// ---- Access Requests ----

function createAccessRequest({ film_slug, name, email, reason }) {
  getDb().prepare(`
    INSERT INTO access_requests (film_slug, name, email, reason)
    VALUES (?, ?, ?, ?)
  `).run(film_slug, name, email, reason || '');
  return getDb().prepare('SELECT * FROM access_requests ORDER BY id DESC LIMIT 1').get();
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

module.exports = {
  init, getDb,
  allFilms, publicFilms, filmBySlug, featuredFilm, createFilm, updateFilm, deleteFilm,
  setFilmPassword, verifyFilmPassword, filmIsLocked,
  allProjects, projectByUuid, createProject, updateProject, deleteProject,
  versionsByProject, latestVersion, createVersion, deleteVersion,
  createAccessRequest, allAccessRequests, pendingAccessRequests, updateAccessRequest, deleteAccessRequest
};
