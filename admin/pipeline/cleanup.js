'use strict';

const path = require('path');
const fs = require('fs');
const config = require('./config');

// Mark orphaned transcode jobs from previous run (delegates to db)
function markOrphanedJobs(db) {
  return db.markOrphanedJobs();
}

// Delete stale uploads that have already been transcoded
function cleanStaleUploads() {
  try {
    const uploads = fs.readdirSync(config.UPLOADS_DIR).filter(f => !f.startsWith('.'));
    const transcodedNames = new Set();
    for (const cat of fs.readdirSync(config.VIDEOS_DIR)) {
      const catPath = path.join(config.VIDEOS_DIR, cat);
      if (fs.statSync(catPath).isDirectory()) {
        for (const f of fs.readdirSync(catPath)) {
          if (f.endsWith('.mp4')) transcodedNames.add(path.parse(f).name);
        }
      }
    }
    let cleaned = 0;
    for (const orig of uploads) {
      const baseName = path.parse(orig).name;
      if (transcodedNames.has(baseName)) {
        fs.unlinkSync(path.join(config.UPLOADS_DIR, orig));
        console.log(`[Cleanup] Deleted stale upload: ${orig}`);
        cleaned++;
      }
    }
    return cleaned;
  } catch (e) {
    console.log(`[Cleanup] Warning: ${e.message}`);
    return 0;
  }
}

// Delete orphaned staging files older than 24 hours
function cleanOrphanedStaging() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  let cleaned = 0;
  for (const dir of [config.CHUNKS_DIR, config.UPLOADS_DIR]) {
    try {
      const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (Date.now() - stat.mtimeMs > ONE_DAY) {
          fs.unlinkSync(filePath);
          console.log(`[Cleanup] Deleted orphaned file: ${file} (age: ${Math.round((Date.now() - stat.mtimeMs) / 3600000)}h)`);
          cleaned++;
        }
      }
    } catch (e) {
      console.log(`[Cleanup] Warning: ${e.message}`);
    }
  }
  return cleaned;
}

// Run all startup cleanup tasks
function runStartupCleanup(db) {
  const orphaned = markOrphanedJobs(db);
  if (orphaned > 0) console.log(`[Startup] Marked ${orphaned} orphaned transcode job(s) as failed`);

  cleanStaleUploads();
  cleanOrphanedStaging();
}

module.exports = {
  markOrphanedJobs,
  cleanStaleUploads,
  cleanOrphanedStaging,
  runStartupCleanup,
};
