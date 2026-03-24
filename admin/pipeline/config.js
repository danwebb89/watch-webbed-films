'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---- Defaults (overridden by configure()) ----

let VIDEO_DIR = '';
let THUMB_DIR = '';
let DATA_DIR = '';
let PUBLIC_DIR = '';
let VIDEOS_DIR = '';
let STAGING_DIR = '';
let UPLOADS_DIR = '';
let CHUNKS_DIR = '';
let PENDING_DIR = '';
let CLIENTS_DIR = '';
let SHARED_WATCH_DIR = '/mnt/user/watch';
let SHARED_VIDEOS_DIR = '';
let SHARED_THUMBS_DIR = '';
let SIGNING_SECRET = '';

// Category slug mapping
const CATEGORY_SLUGS = {
  'Brand Film': 'brand-film',
  'Charity': 'charity',
  'Documentary': 'documentary',
  'External Communications': 'external-communications',
  'Short Films': 'short-films',
};

function categorySlug(name) {
  if (!name) return 'uncategorised';
  return CATEGORY_SLUGS[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'uncategorised';
}

// File type validation rules
const FILE_TYPE_RULES = {
  video:    { exts: ['.mp4', '.mov'], maxBytes: 5 * 1024 * 1024 * 1024 },
  document: { exts: ['.pdf', '.doc', '.docx'], maxBytes: 100 * 1024 * 1024 },
  image:    { exts: ['.png', '.jpg', '.jpeg', '.svg'], maxBytes: 50 * 1024 * 1024 },
  design:   { exts: ['.ai', '.eps', '.psd'], maxBytes: 200 * 1024 * 1024 },
  audio:    { exts: ['.wav', '.mp3'], maxBytes: 500 * 1024 * 1024 },
};

// MIME type map (shared across upload/download)
const MIME_TYPES = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ai': 'application/postscript', '.eps': 'application/postscript', '.psd': 'image/vnd.adobe.photoshop',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

function configure(opts) {
  VIDEO_DIR = opts.videoDir;
  THUMB_DIR = opts.thumbDir;
  DATA_DIR = opts.dataDir;
  PUBLIC_DIR = opts.publicDir;

  VIDEOS_DIR = path.join(VIDEO_DIR, 'videos');
  STAGING_DIR = path.join(VIDEO_DIR, 'staging');
  UPLOADS_DIR = path.join(STAGING_DIR, 'uploads');
  CHUNKS_DIR = path.join(STAGING_DIR, 'chunks');
  PENDING_DIR = path.join(DATA_DIR, 'pending');
  CLIENTS_DIR = path.join(VIDEO_DIR, 'clients');
  SHARED_WATCH_DIR = opts.sharedWatchDir || '/mnt/user/watch';
  SHARED_VIDEOS_DIR = path.join(SHARED_WATCH_DIR, 'videos');
  SHARED_THUMBS_DIR = path.join(SHARED_WATCH_DIR, 'thumbs');

  if (opts.signingSecret) {
    SIGNING_SECRET = opts.signingSecret;
  } else {
    SIGNING_SECRET = crypto.randomBytes(32).toString('hex');
    console.log('[Warning] SIGNING_SECRET not set — using random secret (signed URLs will not survive restart)');
  }

  // Ensure directories exist
  const ALL_CAT_SLUGS = [...Object.values(CATEGORY_SLUGS), 'uncategorised'];
  [VIDEO_DIR, THUMB_DIR, DATA_DIR, VIDEOS_DIR, STAGING_DIR, UPLOADS_DIR, CHUNKS_DIR, PENDING_DIR, CLIENTS_DIR].forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });
  for (const cat of ALL_CAT_SLUGS) {
    fs.mkdirSync(path.join(VIDEOS_DIR, cat), { recursive: true });
    fs.mkdirSync(path.join(THUMB_DIR, cat), { recursive: true });
  }
}

module.exports = {
  get VIDEO_DIR() { return VIDEO_DIR; },
  get THUMB_DIR() { return THUMB_DIR; },
  get DATA_DIR() { return DATA_DIR; },
  get PUBLIC_DIR() { return PUBLIC_DIR; },
  get VIDEOS_DIR() { return VIDEOS_DIR; },
  get STAGING_DIR() { return STAGING_DIR; },
  get UPLOADS_DIR() { return UPLOADS_DIR; },
  get CHUNKS_DIR() { return CHUNKS_DIR; },
  get PENDING_DIR() { return PENDING_DIR; },
  get CLIENTS_DIR() { return CLIENTS_DIR; },
  get SHARED_WATCH_DIR() { return SHARED_WATCH_DIR; },
  get SHARED_VIDEOS_DIR() { return SHARED_VIDEOS_DIR; },
  get SHARED_THUMBS_DIR() { return SHARED_THUMBS_DIR; },
  get SIGNING_SECRET() { return SIGNING_SECRET; },
  CATEGORY_SLUGS,
  categorySlug,
  FILE_TYPE_RULES,
  MIME_TYPES,
  configure,
};
