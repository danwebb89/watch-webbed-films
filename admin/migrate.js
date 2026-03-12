#!/usr/bin/env node
/**
 * Migration script: JSON → SQLite
 *
 * Reads existing films.json and projects.json, creates the SQLite database,
 * and inserts all existing records. Safe to run multiple times — skips
 * duplicates by slug/uuid.
 *
 * Usage: node migrate.js [dataDir]
 *   dataDir defaults to ../data (relative to this script)
 */

const path = require('path');
const fs = require('fs');
const db = require('./db');

const dataDir = process.argv[2] || path.join(__dirname, '..', 'data');

console.log(`[Migrate] Data directory: ${dataDir}`);

// Initialise database (creates tables if needed)
const sqliteDb = db.init(dataDir);
console.log(`[Migrate] Database initialised at ${path.join(dataDir, 'watch.db')}`);

// ---- Migrate films ----

const filmsPath = path.join(dataDir, 'films.json');
if (fs.existsSync(filmsPath)) {
  try {
    const films = JSON.parse(fs.readFileSync(filmsPath, 'utf-8'));
    if (Array.isArray(films) && films.length > 0) {
      let inserted = 0;
      let skipped = 0;

      for (const film of films) {
        const existing = db.filmBySlug(film.slug);
        if (existing) {
          skipped++;
          continue;
        }
        db.createFilm({
          slug: film.slug,
          title: film.title,
          category: film.category || '',
          year: film.year || new Date().getFullYear(),
          description: film.description || '',
          thumbnail: film.thumbnail || '',
          video: film.video || '',
          public: film.public !== false
        });
        inserted++;
      }

      console.log(`[Migrate] Films: ${inserted} inserted, ${skipped} skipped (already exist)`);
    } else {
      console.log('[Migrate] Films: JSON is empty, nothing to migrate');
    }
  } catch (e) {
    console.error('[Migrate] Films: Error reading JSON —', e.message);
  }
} else {
  console.log('[Migrate] Films: No films.json found, skipping');
}

// ---- Migrate projects ----

const projectsPath = path.join(dataDir, 'projects.json');
if (fs.existsSync(projectsPath)) {
  try {
    const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));
    if (Array.isArray(projects) && projects.length > 0) {
      let inserted = 0;
      let skipped = 0;

      const stmt = sqliteDb.prepare(`
        INSERT OR IGNORE INTO projects (uuid, title, video, active, created)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const project of projects) {
        const result = stmt.run(
          project.uuid,
          project.title,
          project.video || '',
          project.active ? 1 : 0,
          project.created || new Date().toISOString().split('T')[0]
        );
        if (result.changes > 0) inserted++;
        else skipped++;
      }

      console.log(`[Migrate] Projects: ${inserted} inserted, ${skipped} skipped (already exist)`);
    } else {
      console.log('[Migrate] Projects: JSON is empty, nothing to migrate');
    }
  } catch (e) {
    console.error('[Migrate] Projects: Error reading JSON —', e.message);
  }
} else {
  console.log('[Migrate] Projects: No projects.json found, skipping');
}

console.log('[Migrate] Done.');
sqliteDb.close();
