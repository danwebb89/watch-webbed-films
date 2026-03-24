const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
let compression;
try { compression = require('compression'); } catch { compression = null; }
const rateLimit = require('express-rate-limit');
const db = require('./db');
const pipeline = require('./pipeline');

const app = express();

// ---- Compression ----
if (compression) {
  app.use(compression({ filter: (req, res) => {
    // Don't compress video/audio streams
    if (req.path.match(/\.(mp4|mov|mp3|wav)$/i)) return false;
    return compression.filter(req, res);
  }}));
  console.log('[Compression] gzip/brotli enabled');
} else {
  console.log('[Compression] compression module not installed — skipping');
}

// ---- Security headers (helmet) ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null, // Disable — site is HTTP internally, HTTPS via Cloudflare tunnel
    }
  },
  frameguard: { action: 'deny' }, // X-Frame-Options: DENY
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false
}));
app.disable('x-powered-by');
app.set('trust proxy', 1); // Behind Cloudflare tunnel

// ---- Rate limiting ----
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes (reduced from 15 — less punishing for typos)
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 5 minutes.' }
});

const passwordVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a moment and try again.' }
});

const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500, // Increased from 100 — admin pages make 20+ API calls per navigation
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' }
});

app.use('/api/', (req, res, next) => {
  // Exempt chunk upload endpoints from general rate limiting
  if (req.path === '/upload/video-chunk' || req.path === '/upload/chunk') return next();
  // Exempt authenticated admin sessions from general rate limiting
  const tok = req.cookies?.session;
  if (tok && sessions.get(tok)) return next();
  generalApiLimiter(req, res, next);
});
const PORT = process.env.PORT || 3501;
// Admin password: accepts bcrypt hash or plaintext (plaintext auto-hashed on first use)
const ADMIN_PASSWORD_RAW = process.env.ADMIN_PASSWORD || 'changeme';
let ADMIN_PASSWORD_HASH = null;
if (ADMIN_PASSWORD_RAW.startsWith('$2a$') || ADMIN_PASSWORD_RAW.startsWith('$2b$')) {
  ADMIN_PASSWORD_HASH = ADMIN_PASSWORD_RAW;
} else {
  ADMIN_PASSWORD_HASH = require('bcryptjs').hashSync(ADMIN_PASSWORD_RAW, 10);
  console.log('[Security] Admin password auto-hashed. Set ADMIN_PASSWORD to a bcrypt hash in production.');
}
const VIDEO_DIR = process.env.VIDEO_DIR || path.join(__dirname, '..', 'public', 'assets', 'videos');
const THUMB_DIR = process.env.THUMB_DIR || path.join(__dirname, '..', 'public', 'assets', 'thumbs');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public');

// ---- Pipeline configuration ----
pipeline.configure({
  videoDir: VIDEO_DIR,
  thumbDir: THUMB_DIR,
  dataDir: DATA_DIR,
  publicDir: PUBLIC_DIR,
  signingSecret: process.env.SIGNING_SECRET || null,
});

// Convenience aliases from pipeline
const { VIDEOS_DIR, STAGING_DIR, UPLOADS_DIR, CHUNKS_DIR, CLIENTS_DIR, PENDING_DIR } = pipeline.config;
const SHARED_VIDEOS_DIR = pipeline.config.SHARED_VIDEOS_DIR;
const SHARED_THUMBS_DIR = pipeline.config.SHARED_THUMBS_DIR;
const { categorySlug, CATEGORY_SLUGS } = pipeline.config;
const { signUrl, verifySignature } = pipeline;
const { resolveFilmFiles, cleanupThumbOptions, relocateClientVersion } = pipeline;
const { generateImageThumbnail, generatePdfThumbnail, generateVideoThumbnail } = pipeline;
const { getVideoMetadata, getImageDimensions } = pipeline;
const { validateFileType, validateFileSize, isValidLinkUrl } = pipeline;
const transcodeJobs = pipeline.transcodeJobs;

// (Signed URLs, directories, and file validation now handled by pipeline module)

// (File placement helpers now in pipeline/paths.js)

// Sanitize filenames to prevent path traversal
function safeName(name) {
  if (!name) return null;
  const base = path.basename(name);         // strip any directory components
  if (base !== name) return null;            // reject if it had path separators
  if (base.startsWith('.')) return null;      // reject dotfiles
  return base;
}

// (Thumbnail generation, metadata extraction now in pipeline module)

// Extract video metadata and store on version record (runs in background, non-blocking)
function extractAndStoreVideoMeta(versionId, filePath) {
  if (!filePath || !versionId) return;
  const diskPath = pipeline.resolveDiskPath(filePath);
  if (!diskPath) return;
  getVideoMetadata(diskPath).then(meta => {
    if (meta) {
      db.updateClientVersion(versionId, {
        file_size: meta.file_size || null,
        width: meta.width || null,
        height: meta.height || null,
        duration: meta.duration || null,
        mime_type: 'video/mp4'
      });
      console.log(`[Meta] Version ${versionId}: ${meta.width}x${meta.height}, ${meta.duration?.toFixed(1)}s, ${meta.file_size ? (meta.file_size/1024/1024).toFixed(1)+'MB' : 'unknown'}`);
    }
  }).catch(e => console.log(`[Meta] Warning for version ${versionId}: ${e.message}`));
}

// (Transcode queue now in pipeline/transcode.js)


// Initialise SQLite database
db.init(DATA_DIR);

app.use(express.json());
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next(err);
});
app.use(cookieParser());

// ---- Auth ----

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const sessions = new Map(); // token → { created: timestamp }

function makeToken() {
  const tok = crypto.randomBytes(32).toString('hex');
  sessions.set(tok, { created: Date.now() });
  return tok;
}

function isSessionValid(tok) {
  if (!tok) return false;
  const session = sessions.get(tok);
  if (!session) return false;
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(tok);
    return false;
  }
  return true;
}

// Clean up expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [tok, session] of sessions) {
    if (now - session.created > SESSION_TTL) sessions.delete(tok);
  }
}, 60 * 60 * 1000);

function requireAuth(req, res, next) {
  const tok = req.cookies?.session;
  if (isSessionValid(tok)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

// Login page
app.get('/login', (req, res) => {
  res.send(loginPage());
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const match = await bcrypt.compare(req.body.password || '', ADMIN_PASSWORD_HASH);
  if (match) {
    const tok = makeToken();
    res.cookie('session', tok, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 86400000 });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(req.cookies?.session);
  res.clearCookie('session');
  res.json({ ok: true });
});

// ---- Health check (no auth) ----
app.get('/health', (req, res) => {
  const activeJobs = [...transcodeJobs.values()].filter(j =>
    ['queued', 'probing', 'transcoding', 'generating_thumbnail'].includes(j.status)
  ).length;

  // Disk space check on video storage
  let diskInfo = null;
  try {
    const { execSync } = require('child_process');
    const df = execSync(`df -B1 ${VIDEO_DIR} 2>/dev/null`, { encoding: 'utf8' });
    const parts = df.split('\n')[1]?.split(/\s+/);
    if (parts && parts.length >= 4) {
      diskInfo = {
        totalGB: Math.round(parseInt(parts[1]) / 1073741824),
        usedGB: Math.round(parseInt(parts[2]) / 1073741824),
        freeGB: Math.round(parseInt(parts[3]) / 1073741824),
        percentUsed: parts[4]
      };
    }
  } catch {}

  // Only expose detailed info to admin sessions
  if (isSessionValid(req.cookies?.session)) {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      activeTranscodes: activeJobs,
      disk: diskInfo,
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      timestamp: new Date().toISOString()
    });
  } else {
    res.json({ status: 'ok', activeTranscodes: activeJobs });
  }
});

// ---- Static files ----

// Serve admin UI (no cache — always get latest)
app.use('/admin-assets', express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
}));

// Favicon — serve PNG at /favicon.ico for browsers that look there
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(path.join(PUBLIC_DIR, 'assets', 'images', 'favicon.png'));
});

// ---- Static file caching (fix #9) ----
// Versioned assets (CSS/JS with ?v= busting) — cache aggressively
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), { maxAge: '1y', immutable: true }));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js'), { maxAge: '1y', immutable: true }));

// Serve shared content from webbed-films storage (with Cloudflare edge caching)
app.use('/shared/videos', express.static(SHARED_VIDEOS_DIR, {
  maxAge: '30d', etag: true, lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
  }
}));
app.use('/shared/thumbs', express.static(SHARED_THUMBS_DIR, {
  maxAge: '30d', etag: true, lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
  }
}));

// ---- Protected asset middleware ----

// Client portal assets: always require signed URL
app.use('/assets/clients', (req, res, next) => {
  const fullPath = '/assets/clients' + req.path;
  const result = verifySignature(fullPath, req.query.sig, req.query.exp);
  if (!result) {
    console.log(`[Asset Auth] DENIED: path=${fullPath} sig=${req.query.sig?.substring(0,16)}... exp=${req.query.exp} hasCookie=${!!(req.cookies?.session)}`);
  }
  if (result) return next();
  // Admin session also grants access
  if (req.cookies?.session && sessions.has(req.cookies.session)) return next();
  res.status(403).json({ error: 'Forbidden' });
});

// Video assets: require signed URL for password-protected films
app.use('/assets/videos', (req, res, next) => {
  // Signed URL always passes (reconstruct full path — signUrl signs the full /assets/videos/... path)
  const fullVideoPath = '/assets/videos' + req.path;
  if (req.query.sig && verifySignature(fullVideoPath, req.query.sig, req.query.exp)) return next();
  // Admin session always passes
  if (req.cookies?.session && sessions.has(req.cookies.session)) return next();
  // Public non-password-protected film passes
  const videoPath = `/assets/videos${req.path}`;
  const film = db.filmByVideoPath(videoPath);
  if (film && film.public && !film.password_hash) return next();
  res.status(403).json({ error: 'Forbidden' });
});

// Serve videos and thumbs from category subdirs (with Cloudflare edge caching)
app.use('/assets/videos', express.static(VIDEOS_DIR, {
  maxAge: '30d', etag: true, lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
  }
}));
app.use('/assets/thumbs', express.static(THUMB_DIR, {
  maxAge: '30d', etag: true, lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
  }
}));

// Fallback: serve from shared/legacy location if not found in primary dirs
app.use('/assets/videos', express.static(SHARED_VIDEOS_DIR, {
  maxAge: '30d', etag: true, lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
  }
}));
app.use('/assets/thumbs', express.static(SHARED_THUMBS_DIR, {
  maxAge: '30d', etag: true, lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=2592000, s-maxage=2592000');
  }
}));

// Images, fonts, and other assets — cache 30 days
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), {
  maxAge: '30d',
  etag: true,
  lastModified: true
}));

// HTML and other files — no cache (always fresh)
app.use(express.static(PUBLIC_DIR, {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ---- Public API (no auth required) ----

// Sanitize helpers — strip internal DB columns from public responses
function sanitizeFilmForPublic(film) {
  const locked = film.password_protected !== undefined ? !!film.password_protected : !!film.password_hash;
  const result = {
    slug: film.slug,
    title: film.title,
    category: film.category,
    year: film.year,
    thumbnail: film.thumbnail,
    description: film.description,
    duration: film.duration_minutes || null,
    password_protected: locked,
    eligible_for_featured: !!film.eligible_for_featured,
    video: locked ? '' : (film.video || '')
  };
  return result;
}

function sanitizeFeaturedFilm(film) {
  const locked = !!film.password_hash;
  return {
    slug: film.slug,
    title: film.title,
    category: film.category,
    year: film.year,
    thumbnail: film.thumbnail,
    description: film.description,
    duration: film.duration_minutes || null,
    video: locked ? '' : (film.video || '')
  };
}

function sanitizeFilmDetail(film) {
  const base = sanitizeFilmForPublic(film);
  base.synopsis = film.synopsis || '';
  base.credits = film.credits || '';
  base.role_description = film.role_description || '';
  return base;
}

app.get('/sitemap.xml', (req, res) => {
  const films = db.publicFilms();
  const categories = [...new Set(films.map(f => f.category).filter(Boolean))];
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += '  <url><loc>https://watch.webbedfilms.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n';
  for (const cat of categories) {
    const slug = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    xml += `  <url><loc>https://watch.webbedfilms.com/category/${slug}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
  }
  for (const film of films) {
    xml += `  <url><loc>https://watch.webbedfilms.com/watch/${film.slug}</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n`;
  }
  xml += '</urlset>';
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(xml);
});

app.get('/api/public/featured', (req, res) => {
  const film = db.featuredFilm();
  if (!film) return res.json(null);
  res.set('Cache-Control', 'public, max-age=600, s-maxage=120');
  res.json(sanitizeFeaturedFilm(film));
});

app.get('/api/public/films', (req, res) => {
  const films = db.publicFilms().map(f => sanitizeFilmForPublic(f));
  res.set('Cache-Control', 'public, max-age=300, s-maxage=60');
  res.json(films);
});

app.get('/api/public/films/:slug', (req, res) => {
  const film = db.filmBySlug(req.params.slug);
  if (!film || (!film.public && film.visibility !== 'unlisted')) return res.status(404).json({ error: 'Not found' });
  res.json(sanitizeFilmDetail(film));
});

app.post('/api/public/films/:slug/verify-password', passwordVerifyLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const film = db.filmBySlug(req.params.slug);
  if (!film || !film.public) return res.status(404).json({ error: 'Not found' });
  if (!film.password_hash) {
    return res.json({ ok: true, video: film.video });
  }
  if (await db.verifyFilmPassword(req.params.slug, password)) {
    return res.json({ ok: true, video: signUrl(film.video) });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/public/access-request', (req, res) => {
  const { film_slug, name, email, reason } = req.body;
  if (!film_slug || !name || !email) return res.status(400).json({ error: 'Name, email, and film are required' });
  // Verify the film exists and is password-protected
  const film = db.filmBySlug(film_slug);
  if (!film || !film.public) return res.status(404).json({ error: 'Film not found' });
  if (!film.password_hash) return res.status(400).json({ error: 'Film is not password protected' });
  const request = db.createAccessRequest({ film_slug, name, email, reason });
  res.json({ ok: true, id: request.id });
});

// ---- File Upload ----

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const prefix = crypto.randomBytes(4).toString('hex');
      cb(null, `${prefix}_${safe}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50GB
});

const thumbUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(THUMB_DIR, 'uncategorised')),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const prefix = crypto.randomBytes(4).toString('hex');
      cb(null, `${prefix}_${safe}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ---- API Routes (all require auth) ----

app.post('/api/upload/video', requireAuth, (req, res, next) => {
  // No timeout for video uploads (files can be multi-GB)
  req.setTimeout(0);
  res.setTimeout(0);
  next();
}, videoUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const result = pipeline.startTranscode(req.file, db);
  res.json(result);
});

// ---- Chunked Upload ----

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CHUNKS_DIR),
    filename: (req, file, cb) => {
      // Use a temp name — we'll rename after multer parses all fields
      cb(null, `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB per chunk
});

// Both routes use the same chunk handler — video-chunk for backward compat, chunk for generic files
app.post('/api/upload/video-chunk', requireAuth, chunkUpload.single('chunk'), (req, res) => pipeline.handleChunkUpload(req, res));
app.post('/api/upload/chunk', requireAuth, chunkUpload.single('chunk'), (req, res) => pipeline.handleChunkUpload(req, res));

app.post('/api/upload/video-assemble', requireAuth, express.json(), async (req, res) => {
  const { uploadId, filename } = req.body;
  if (!uploadId || !filename) return res.status(400).json({ error: 'Missing uploadId or filename' });

  try {
    const result = await pipeline.assembleAndTranscode(uploadId, filename, db);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[Upload] Assembly error:', err);
    res.status(500).json({ error: 'Failed to assemble: ' + err.message });
  }
});

// ---- Generic chunked file assembly (non-video) ----

app.post('/api/upload/file-assemble', requireAuth, express.json(), async (req, res) => {
  const { uploadId, filename, category } = req.body;
  if (!uploadId || !filename) return res.status(400).json({ error: 'Missing uploadId or filename' });

  try {
    const result = await pipeline.assembleFile(uploadId, filename);
    if (result.error) return res.status(400).json({ error: result.error });

    // Validate file type if category specified
    if (category) {
      const typeCheck = validateFileType(result.filename, category);
      if (!typeCheck.valid) {
        try { fs.unlinkSync(result.assembledPath); } catch {}
        return res.status(400).json({ error: typeCheck.error });
      }
      const sizeCheck = validateFileSize(result.fileSize, category);
      if (!sizeCheck.valid) {
        try { fs.unlinkSync(result.assembledPath); } catch {}
        return res.status(400).json({ error: sizeCheck.error });
      }
    }

    const ext = path.extname(result.filename).toLowerCase();
    const mime = pipeline.resolveMimeType(ext);

    res.json({
      filename: result.filename,
      stagingPath: result.assembledPath,
      file_size: result.fileSize,
      mime_type: mime,
      ext: ext
    });
  } catch (err) {
    console.error('[Upload] File assembly error:', err);
    res.status(500).json({ error: 'Failed to assemble: ' + err.message });
  }
});

// Save pending film metadata for server-side auto-save after transcode
app.post('/api/transcode/:id/pending', requireAuth, (req, res) => {
  const job = transcodeJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const pendingFile = path.join(PENDING_DIR, req.params.id + '.json');
  try {
    fs.writeFileSync(pendingFile, JSON.stringify(req.body));
  } catch (err) {
    console.error('[Pending] Failed to write pending file:', err.message);
    return res.status(500).json({ error: 'Failed to save pending metadata' });
  }
  console.log(`[Pending] Saved metadata for transcode ${req.params.id}: "${req.body.title}"`);
  res.json({ ok: true });
});

// Transcode status (falls back to DB for historical/restarted jobs)
app.get('/api/transcode/:id', requireAuth, (req, res) => {
  let job = pipeline.getJob(req.params.id);
  if (!job) job = db.getTranscodeJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/transcode', requireAuth, (req, res) => {
  res.json(pipeline.getAllJobs());
});

app.post('/api/upload/thumb', requireAuth, thumbUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ filename: req.file.filename, path: `/assets/thumbs/uncategorised/${req.file.filename}` });
});

// List uploaded files (recurse through category subdirs)
app.get('/api/files/videos', requireAuth, (req, res) => {
  try {
    const files = [];
    const subdirs = fs.readdirSync(VIDEOS_DIR).filter(d => {
      try { return fs.statSync(path.join(VIDEOS_DIR, d)).isDirectory(); } catch { return false; }
    });
    for (const subdir of subdirs) {
      const dirPath = path.join(VIDEOS_DIR, subdir);
      try {
        const dirFiles = fs.readdirSync(dirPath).filter(f => !f.startsWith('.') && !f.endsWith('.db') && !f.endsWith('.db-shm') && !f.endsWith('.db-wal') && fs.statSync(path.join(dirPath, f)).isFile());
        for (const f of dirFiles) {
          files.push({
            name: f,
            category: subdir,
            path: `/assets/videos/${subdir}/${f}`,
            size: fs.statSync(path.join(dirPath, f)).size
          });
        }
      } catch { /* skip unreadable subdirs */ }
    }
    res.json(files);
  } catch (err) {
    console.error('[Files] Error listing videos:', err.message);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// List thumbnail options for a given video filename base (searches all category subdirs)
app.get('/api/files/thumb-options/:videoBase', requireAuth, (req, res) => {
  const base = req.params.videoBase.replace(/\.[^.]+$/, '') + '_thumb';
  const options = [];
  const subdirs = fs.readdirSync(THUMB_DIR).filter(d => {
    try { return fs.statSync(path.join(THUMB_DIR, d)).isDirectory(); } catch { return false; }
  });
  for (const subdir of subdirs) {
    const dirPath = path.join(THUMB_DIR, subdir);
    const files = fs.readdirSync(dirPath).filter(f => f.startsWith(base + '_opt_'));
    options.push(...files.sort().map(f => `/assets/thumbs/${subdir}/${f}`));
  }
  res.json(options);
});

app.get('/api/files/thumbs', requireAuth, (req, res) => {
  const files = [];
  const subdirs = fs.readdirSync(THUMB_DIR).filter(d => {
    try { return fs.statSync(path.join(THUMB_DIR, d)).isDirectory(); } catch { return false; }
  });
  for (const subdir of subdirs) {
    const dirPath = path.join(THUMB_DIR, subdir);
    const dirFiles = fs.readdirSync(dirPath).filter(f => !f.startsWith('.') && !f.startsWith('_candidate_'));
    for (const f of dirFiles) {
      files.push({
        name: f,
        category: subdir,
        path: `/assets/thumbs/${subdir}/${f}`,
        size: fs.statSync(path.join(dirPath, f)).size
      });
    }
  }
  res.json(files);
});

// ---- Internal cross-post from webbed-films ----
const CROSS_POST_SECRET = process.env.CROSS_POST_SECRET || '';

app.post('/api/internal/cross-post', express.json(), (req, res) => {
  if (!CROSS_POST_SECRET || req.body.secret !== CROSS_POST_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }
  const film = req.body.film;
  if (!film || !film.title || !film.slug) {
    return res.status(400).json({ error: 'Film data with title and slug required' });
  }

  const existing = db.filmBySlug(film.slug);
  if (existing) {
    db.updateFilm(film.slug, film);
    console.log(`[CrossPost] Updated film: "${film.title}"`);
  } else {
    db.createFilm({
      slug: film.slug,
      title: film.title,
      category: film.category || '',
      year: parseInt(film.year) || new Date().getFullYear(),
      description: film.description || '',
      thumbnail: film.thumbnail || '',
      video: film.video || '',
      public: film.public !== false,
      eligible_for_featured: !!film.eligible_for_featured,
      visibility: film.visibility || 'public'
    });
    console.log(`[CrossPost] Created film: "${film.title}"`);
  }
  res.json({ ok: true });
});

// ---- Films CRUD ----

app.get('/api/films', requireAuth, (req, res) => {
  res.json(db.allFilms());
});

app.post('/api/films', requireAuth, (req, res) => {
  let { title, slug, category, year, description, thumbnail, video, eligible_for_featured, visibility } = req.body;
  const isPublic = req.body.public !== undefined ? req.body.public : true;
  if (!title || !slug) return res.status(400).json({ error: 'Title and slug required' });
  if (db.filmBySlug(slug)) return res.status(409).json({ error: 'Slug already exists' });

  // Move files from uncategorised to correct category folder
  if (video || thumbnail) {
    const resolved = resolveFilmFiles(video, thumbnail, category || '');
    video = resolved.video;
    thumbnail = resolved.thumbnail;
  }

  try {
    const film = db.createFilm({ slug, title, category, year: parseInt(year) || new Date().getFullYear(), description, thumbnail, video, public: isPublic, visibility: visibility || 'public', eligible_for_featured });
    res.json(film);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'A film with this slug already exists' });
    console.error('[Film] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create film' });
  }
});

// Regenerate thumbnail options for an existing film
app.post('/api/films/:slug/regenerate-thumbs', requireAuth, async (req, res) => {
  const film = db.filmBySlug(req.params.slug);
  if (!film) return res.status(404).json({ error: 'Not found' });
  if (!film.video) return res.status(400).json({ error: 'No video path' });

  // Resolve video path from category subdir
  const videoRelPath = film.video.replace(/^\/assets\/videos\//, '');
  const videoPath = path.join(VIDEOS_DIR, videoRelPath);
  if (!fs.existsSync(videoPath)) return res.status(400).json({ error: 'Video file not found on disk' });

  // Determine category subfolder for thumbnails
  const catSlug = categorySlug(film.category);
  const thumbName = path.parse(path.basename(film.video)).name + '_thumb.jpg';
  const result = await generateVideoThumbnail(videoPath, thumbName, catSlug);

  if (result && typeof result === 'object') {
    // Update film thumbnail to the best pick
    db.updateFilm(req.params.slug, { thumbnail: result.selected });
    res.json({ thumbnail: result.selected, options: result.options });
  } else {
    res.status(500).json({ error: 'Failed to generate thumbnails' });
  }
});

app.put('/api/films/:slug', requireAuth, (req, res) => {
  const existingFilm = db.filmBySlug(req.params.slug);
  if (!existingFilm) return res.status(404).json({ error: 'Not found' });

  // If category is changing, relocate files on disk
  if (req.body.category !== undefined && req.body.category !== existingFilm.category) {
    const resolved = resolveFilmFiles(
      existingFilm.video,
      existingFilm.thumbnail,
      req.body.category
    );
    req.body.video = resolved.video;
    req.body.thumbnail = resolved.thumbnail;
  }

  const film = db.updateFilm(req.params.slug, req.body);
  if (!film) return res.status(404).json({ error: 'Not found' });
  res.json(film);
});

app.delete('/api/films/:slug', requireAuth, (req, res) => {
  const result = db.deleteFilm(req.params.slug);
  if (!result.changes) return res.status(404).json({ error: 'Film not found' });
  res.json({ ok: true });
});

// Clean up unused thumbnail options for a film (keeps only the selected thumbnail)
app.post('/api/films/:slug/cleanup-thumbs', requireAuth, (req, res) => {
  const film = db.filmBySlug(req.params.slug);
  if (!film) return res.status(404).json({ error: 'Not found' });
  if (!film.thumbnail) return res.json({ ok: true, removed: 0 });
  cleanupThumbOptions(film.thumbnail);
  res.json({ ok: true });
});

app.put('/api/films/:slug/password', requireAuth, async (req, res) => {
  const { password } = req.body;
  const film = await db.setFilmPassword(req.params.slug, password || null);
  if (!film) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, password_protected: !!film.password_hash });
});

// ---- Access Requests (admin) ----

app.get('/api/access-requests', requireAuth, (req, res) => {
  res.json(db.allAccessRequests());
});

app.put('/api/access-requests/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['approved', 'denied'].includes(status)) return res.status(400).json({ error: 'Status must be approved or denied' });
  const request = db.updateAccessRequest(parseInt(req.params.id), status);
  if (!request) return res.status(404).json({ error: 'Not found' });
  res.json(request);
});

app.delete('/api/access-requests/:id', requireAuth, (req, res) => {
  db.deleteAccessRequest(parseInt(req.params.id));
  res.json({ ok: true });
});

// ---- Client Portal Public API ----

// Client asset directories (created by pipeline.configure)

// Serve client assets (videos, resources, logos)
app.use('/assets/clients', express.static(CLIENTS_DIR, { maxAge: '30d', etag: true, lastModified: true }));

// Resource upload handler
const resourceUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // Save to staging dir first — category may not be in req.body yet
      const dir = path.join(CLIENTS_DIR, req.params.slug, 'resources', '_staging');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const prefix = crypto.randomBytes(4).toString('hex');
      cb(null, `${prefix}_${safe}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

app.get('/api/public/portal/:slug', (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });

  const locked = !!client.password_hash;
  const result = {
    name: client.name,
    slug: client.slug,
    logo: client.logo ? signUrl(client.logo) : '',
    password_protected: locked
  };

  // If password-protected, check for valid portal session cookie first
  if (locked) {
    const portalTok = req.cookies?.portal_session;
    const ps = portalTok ? portalSessions.get(portalTok) : null;
    const hasValidSession = ps && ps.clientSlug === client.slug && Date.now() - ps.created < SESSION_TTL;
    if (!hasValidSession) {
      return res.json(result); // Return minimal info, frontend shows password gate
    }
    // Fall through to return full data
  } else {
    // For unprotected clients, set a portal session cookie so downloads work
    const existingTok = req.cookies?.portal_session;
    const existingSession = existingTok ? portalSessions.get(existingTok) : null;
    if (!existingSession || existingSession.clientSlug !== client.slug) {
      const portalTok = crypto.randomBytes(32).toString('hex');
      portalSessions.set(portalTok, { clientSlug: client.slug, created: Date.now() });
      res.cookie('portal_session', portalTok, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 86400000 });
    }
  }

  // Return full portal data
  const projects = db.clientProjectsByClient(client.slug).map(p => {
    const versions = db.clientVersionsByProject(p.id);
    const latest = versions[0] || null;
    return {
      slug: p.slug,
      title: p.title,
      description: p.description,
      version_count: versions.length,
      latest_thumbnail: latest && latest.thumbnail ? signUrl(latest.thumbnail) : '',
      updated_at: p.updated_at,
      max_view_percent: db.maxViewForProject(p.id) || 0
    };
  });

  const resources = db.clientResourcesByClient(client.slug);
  const resourceCounts = {};
  for (const r of resources) {
    resourceCounts[r.category] = (resourceCounts[r.category] || 0) + 1;
  }

  result.projects = projects;
  result.resource_counts = resourceCounts;
  res.json(result);
});

app.post('/api/public/portal/:slug/verify-password', passwordVerifyLimiter, async (req, res) => {
  const { password } = req.body;
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });

  if (!client.password_hash) {
    // Set portal session even for unprotected clients (for consistent auth)
    const portalTok = crypto.randomBytes(32).toString('hex');
    portalSessions.set(portalTok, { clientSlug: client.slug, created: Date.now() });
    res.cookie('portal_session', portalTok, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 86400000 });
    return res.json({ ok: true });
  }
  if (await db.verifyClientPassword(req.params.slug, password)) {
    // Set portal session cookie — replaces ?pw= query param approach
    const portalTok = crypto.randomBytes(32).toString('hex');
    portalSessions.set(portalTok, { clientSlug: client.slug, created: Date.now() });
    res.cookie('portal_session', portalTok, { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 86400000 });

    // Return full portal data
    const projects = db.clientProjectsByClient(client.slug).map(p => {
      const versions = db.clientVersionsByProject(p.id);
      const latest = versions[0] || null;
      return {
        slug: p.slug,
        title: p.title,
        description: p.description,
        version_count: versions.length,
        latest_thumbnail: latest && latest.thumbnail ? signUrl(latest.thumbnail) : '',
        updated_at: p.updated_at,
        max_view_percent: db.maxViewForProject(p.id) || 0
      };
    });
    const resources = db.clientResourcesByClient(client.slug);
    const resourceCounts = {};
    for (const r of resources) {
      resourceCounts[r.category] = (resourceCounts[r.category] || 0) + 1;
    }
    return res.json({ ok: true, projects, resource_counts: resourceCounts });
  }
  res.status(401).json({ error: 'Wrong password' });
});

// Helper: verify portal password from ?pw= query param
// Portal sessions: Map of token → { clientSlug, created }
const portalSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [tok, s] of portalSessions) {
    if (now - s.created > SESSION_TTL) portalSessions.delete(tok);
  }
}, 60 * 60 * 1000);

async function verifyPortalPassword(client, req) {
  if (!client.password_hash) return true;
  // Check portal session cookie
  const portalTok = req.cookies?.portal_session;
  if (portalTok) {
    const ps = portalSessions.get(portalTok);
    if (ps && ps.clientSlug === client.slug && Date.now() - ps.created < SESSION_TTL) return true;
  }
  return false;
}

app.get('/api/public/portal/:slug/projects/:projectSlug', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) {
    return res.status(401).json({ error: 'Password required', password_protected: true });
  }
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Build formats (deliverables) with nested versions
  let deliverables = db.deliverablesByProject(project.id);

  // If no deliverables exist but versions do, wrap in a synthetic "Widescreen" format
  const allVersions = db.clientVersionsByProject(project.id);
  if (deliverables.length === 0 && allVersions.length > 0) {
    deliverables = [{ id: null, slug: 'widescreen', label: 'Widescreen', aspect_ratio: '16:9', is_hero: 1 }];
  }

  const formats = deliverables.map(d => {
    const versions = d.id ? db.clientVersionsByDeliverable(d.id) : allVersions;
    const links = d.id ? db.externalLinksByParent('deliverable', d.id, true) : [];
    return {
      id: d.id,
      slug: d.slug,
      label: d.label,
      type: d.type || 'video',
      aspect_ratio: d.aspect_ratio,
      is_hero: !!d.is_hero,
      links,
      versions: versions.map(v => {
        const approval = db.approvalByVersion(v.id);
        return {
          id: v.id,
          version_number: v.version_number,
          file_path: v.file_path ? signUrl(v.file_path) : '',
          thumbnail: v.thumbnail ? signUrl(v.thumbnail) : '',
          note: v.note,
          file_size: v.file_size,
          mime_type: v.mime_type,
          width: v.width,
          height: v.height,
          duration: v.duration,
          transcode_status: v.transcode_status,
          created_at: v.created_at,
          approval_status: approval ? approval.status : null
        };
      })
    };
  });

  // Project files (portal: only client-visible)
  const files = db.projectFilesByProject(project.id, null, true).map(f => ({
    id: f.id,
    category: f.category,
    original_name: f.original_name,
    file_path: f.file_path ? signUrl(f.file_path) : '',
    file_size: f.file_size,
    mime_type: f.mime_type,
    created_at: f.created_at
  }));

  // Project-level external links (client visible only)
  const project_links = db.externalLinksByParent('project_file', project.id, true);

  res.json({
    slug: project.slug,
    title: project.title,
    description: project.description,
    formats,
    files,
    project_links
  });
});

app.get('/api/public/portal/:slug/resources', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) {
    return res.status(401).json({ error: 'Password required', password_protected: true });
  }
  const category = req.query.category || null;
  const resources = db.clientResourcesByClient(req.params.slug, category, true);
  const links = db.externalLinksByParent('client_resource', client.id, true);
  res.json({
    files: resources.map(r => ({
      id: r.id,
      category: r.category,
      original_name: r.original_name,
      file_path: r.file_path ? signUrl(r.file_path) : '',
      file_size: r.file_size,
      mime_type: r.mime_type,
      created_at: r.created_at
    })),
    links
  });
});

// ---- Project Overview (bundled for landing page) ----
app.get('/api/public/portal/:slug/projects/:projectSlug/overview', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) {
    return res.status(401).json({ error: 'Password required', password_protected: true });
  }
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  let rawDeliverables = db.deliverablesByProject(project.id);
  const allVersions = db.clientVersionsByProject(project.id);
  if (rawDeliverables.length === 0 && allVersions.length > 0) {
    rawDeliverables = [{ id: null, slug: 'widescreen', label: 'Widescreen', aspect_ratio: '16:9', is_hero: 1 }];
  }

  const deliverables = rawDeliverables.map(d => {
    const versions = d.id ? db.clientVersionsByDeliverable(d.id) : allVersions;
    const links = d.id ? db.externalLinksByParent('deliverable', d.id, true) : [];
    let commentCount = 0, unresolvedCount = 0;
    const mappedVersions = versions.map(v => {
      const approval = db.approvalByVersion(v.id);
      const comments = db.commentsByVersion(v.id);
      commentCount += comments.length;
      unresolvedCount += comments.filter(c => !c.resolved).length;
      return {
        id: v.id,
        version_number: v.version_number,
        file_path: v.file_path ? signUrl(v.file_path) : '',
        thumbnail: v.thumbnail ? signUrl(v.thumbnail) : '',
        note: v.note,
        file_size: v.file_size,
        mime_type: v.mime_type,
        width: v.width,
        height: v.height,
        duration: v.duration,
        created_at: v.created_at,
        approval_status: approval ? approval.status : null
      };
    });
    const latestVersion = mappedVersions.length > 0 ? mappedVersions[0] : null;
    const latestApproval = latestVersion ? latestVersion.approval_status : null;
    return {
      id: d.id,
      label: d.label,
      slug: d.slug,
      type: d.type || 'video',
      aspect_ratio: d.aspect_ratio,
      is_hero: !!d.is_hero,
      versions: mappedVersions,
      latest_version: latestVersion,
      approval_status: latestApproval,
      comment_count: commentCount,
      unresolved_count: unresolvedCount,
      links
    };
  });

  const files = db.projectFilesByProject(project.id, null, true).map(f => ({
    id: f.id,
    category: f.category,
    original_name: f.original_name,
    file_path: f.file_path ? signUrl(f.file_path) : '',
    file_size: f.file_size,
    mime_type: f.mime_type,
    created_at: f.created_at
  }));

  const projectLinks = db.externalLinksByParent('project_file', project.id, true);
  const clientResources = db.clientResourcesByClient(req.params.slug, null, true).map(r => ({
    id: r.id,
    category: r.category,
    original_name: r.original_name,
    file_path: r.file_path ? signUrl(r.file_path) : '',
    file_size: r.file_size,
    mime_type: r.mime_type,
    created_at: r.created_at
  }));
  const clientResourceLinks = db.externalLinksByParent('client_resource', client.id, true);

  res.json({
    project: {
      title: project.title,
      slug: project.slug,
      rf_number: project.rf_number || '',
      description: project.description || ''
    },
    deliverables,
    project_files: files,
    project_links: projectLinks,
    client_resources: clientResources,
    client_resource_links: clientResourceLinks
  });
});

// ---- Version ownership check ----
// Verify a version belongs to a project owned by the given client
function versionBelongsToClient(versionId, clientSlug) {
  return db.getDb().prepare(`
    SELECT v.id FROM client_project_versions v
    JOIN client_project_deliverables d ON v.deliverable_id = d.id
    JOIN client_projects p ON d.client_project_id = p.id
    WHERE v.id = ? AND p.client_slug = ?
  `).get(versionId, clientSlug);
}

// ---- View Tracking (public) ----

app.post('/api/public/portal/:slug/projects/:projectSlug/versions/:versionId/view', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) return res.status(401).json({ error: 'Authentication required' });
  const versionId = parseInt(req.params.versionId);
  if (!versionBelongsToClient(versionId, req.params.slug)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { viewer_name, max_percent } = req.body;
  const view = db.trackView({
    version_id: versionId,
    viewer_name: viewer_name || '',
    max_percent: Math.min(100, Math.max(0, parseInt(max_percent) || 0))
  });
  res.json(view);
});

// ---- Comments & Approvals (public) ----

app.get('/api/public/portal/:slug/projects/:projectSlug/versions/:versionId/comments', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) return res.status(401).json({ error: 'Password required' });
  const versionId = parseInt(req.params.versionId);
  if (!versionBelongsToClient(versionId, req.params.slug)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(db.commentsByVersion(versionId));
});

app.post('/api/public/portal/:slug/projects/:projectSlug/versions/:versionId/comments', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) return res.status(401).json({ error: 'Password required' });
  const versionId = parseInt(req.params.versionId);
  if (!versionBelongsToClient(versionId, req.params.slug)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { timecode_seconds, author_name, text, parent_id } = req.body;
  if (timecode_seconds === undefined || !author_name || !text) {
    return res.status(400).json({ error: 'timecode_seconds, author_name, and text are required' });
  }
  if (typeof text === 'string' && text.trim().length === 0) {
    return res.status(400).json({ error: 'Comment text cannot be empty' });
  }
  const tc = parseFloat(timecode_seconds);
  if (isNaN(tc) || tc < 0 || tc > 86400) {
    return res.status(400).json({ error: 'timecode_seconds must be between 0 and 86400' });
  }
  // Deduplicate: reject identical comment within 5 seconds
  const sanitize = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const sanitizedText = sanitize(text);
  const sanitizedAuthor = sanitize(author_name);
  const recentDupe = db.getDb().prepare(`
    SELECT id FROM client_version_comments
    WHERE version_id = ? AND author_name = ? AND text = ? AND timecode_seconds = ?
    AND created_at > datetime('now', '-5 seconds')
  `).get(versionId, sanitizedAuthor, sanitizedText, tc);
  if (recentDupe) {
    return res.status(409).json({ error: 'Duplicate comment', id: recentDupe.id });
  }
  const comment = db.createComment({
    version_id: versionId,
    timecode_seconds: tc,
    author_name: sanitizedAuthor,
    text: sanitizedText,
    parent_id: parent_id ? parseInt(parent_id) : null
  });
  res.json(comment);
});

app.put('/api/public/portal/:slug/projects/:projectSlug/versions/:versionId/comments/:commentId/resolve', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) return res.status(401).json({ error: 'Password required' });
  const versionId = parseInt(req.params.versionId);
  if (!versionBelongsToClient(versionId, req.params.slug)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { resolved } = req.body;
  const comment = db.resolveComment(parseInt(req.params.commentId), resolved ? 1 : 0);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  res.json(comment);
});

app.get('/api/public/portal/:slug/projects/:projectSlug/versions/:versionId/approval', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) return res.status(401).json({ error: 'Password required' });
  const versionId = parseInt(req.params.versionId);
  if (!versionBelongsToClient(versionId, req.params.slug)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const approval = db.approvalByVersion(versionId);
  res.json(approval || { status: null });
});

app.post('/api/public/portal/:slug/projects/:projectSlug/versions/:versionId/approval', async (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client || !client.active) return res.status(404).json({ error: 'Not found' });
  if (!await verifyPortalPassword(client, req)) return res.status(401).json({ error: 'Password required' });
  const versionId = parseInt(req.params.versionId);
  if (!versionBelongsToClient(versionId, req.params.slug)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { status, author_name, comment } = req.body;
  if (!status || !['approved', 'changes_requested'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or changes_requested' });
  }
  if (!author_name) return res.status(400).json({ error: 'author_name required' });
  if (status === 'changes_requested' && !comment) {
    return res.status(400).json({ error: 'comment required when requesting changes' });
  }
  const sanitize = s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') : s;
  const approval = db.setVersionApproval({
    version_id: versionId, status,
    author_name: sanitize(author_name),
    comment: comment ? sanitize(comment) : ''
  });
  res.json(approval);
});

// ---- Comments Admin ----

app.get('/api/clients/:slug/projects/:projectSlug/feedback', requireAuth, (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const deliverables = db.deliverablesByProject(project.id);
  const formats = deliverables.map(d => {
    const versions = db.clientVersionsByDeliverable(d.id);
    return {
      label: d.label, slug: d.slug,
      versions: versions.map(v => ({
        version_number: v.version_number, id: v.id,
        approval: db.approvalByVersion(v.id),
        comments: db.commentsByVersion(v.id)
      }))
    };
  });
  res.json({ formats });
});

app.put('/api/clients/:slug/projects/:projectSlug/comments/:commentId/resolve', requireAuth, (req, res) => {
  const comment = db.resolveComment(parseInt(req.params.commentId), !!req.body.resolved);
  if (!comment) return res.status(404).json({ error: 'Not found' });
  res.json(comment);
});

app.delete('/api/clients/:slug/projects/:projectSlug/comments/:commentId', requireAuth, (req, res) => {
  db.deleteComment(parseInt(req.params.commentId));
  res.json({ ok: true });
});

// ---- Client Portal Admin API ----

app.get('/api/clients', requireAuth, (req, res) => {
  const clients = db.allClients().map(c => {
    const projects = db.clientProjectsByClient(c.slug);
    const resources = db.clientResourcesByClient(c.slug);
    const comments = db.openCommentCountByClient(c.slug);
    return {
      ...c,
      password_protected: !!c.password_hash,
      project_count: projects.length,
      resource_count: resources.length,
      comment_count: comments.total,
      open_comment_count: comments.open
    };
  });
  res.json(clients);
});

app.post('/api/clients', requireAuth, async (req, res) => {
  let { name, slug, logo, notes, password } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Client name is required' });
  name = name.trim();
  if (!slug) {
    slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  // Truncate slug to prevent ENAMETOOLONG filesystem errors
  slug = slug.substring(0, 200);
  if (!slug) return res.status(400).json({ error: 'Client name must contain at least one alphanumeric character' });
  if (db.clientBySlug(slug)) return res.status(409).json({ error: 'Client slug already exists' });

  // Create client directory structure
  const clientDir = path.join(CLIENTS_DIR, slug);
  try {
    fs.mkdirSync(path.join(clientDir, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(clientDir, 'resources'), { recursive: true });
  } catch (err) {
    console.error('[Client] Directory creation error:', err.message);
    return res.status(400).json({ error: 'Could not create client directory' });
  }

  try {
    const client = await db.createClient({ slug, name, logo, notes, password });
    res.json(client);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Client slug already exists' });
    console.error('[Client] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

app.get('/api/clients/:slug', requireAuth, (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(client);
});

app.put('/api/clients/:slug', requireAuth, (req, res) => {
  const client = db.updateClient(req.params.slug, req.body);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(client);
});

app.delete('/api/clients/:slug', requireAuth, (req, res) => {
  const slug = req.params.slug;
  let result;
  try { result = db.deleteClient(slug); } catch (err) {
    console.error('[Client] Delete error:', err.message);
    return res.status(500).json({ error: 'Failed to delete client' });
  }
  if (!result.changes) return res.status(404).json({ error: 'Client not found' });
  // Clean up client directory on disk
  const clientDir = path.join(CLIENTS_DIR, slug);
  if (fs.existsSync(clientDir)) {
    try {
      fs.rmSync(clientDir, { recursive: true, force: true });
      console.log(`[Cleanup] Removed client directory: ${slug}`);
    } catch (err) {
      console.error(`[Cleanup] Failed to remove client dir ${slug}:`, err.message);
    }
  }
  res.json({ ok: true });
});

// Client logo upload
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(CLIENTS_DIR, req.params.slug);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, 'logo' + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

app.post('/api/clients/:slug/logo', requireAuth, logoUpload.single('file'), (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const logoPath = `/assets/clients/${req.params.slug}/${req.file.filename}`;
  db.updateClient(req.params.slug, { logo: logoPath });
  res.json({ ok: true, logo: logoPath });
});

app.put('/api/clients/:slug/password', requireAuth, async (req, res) => {
  const { password } = req.body;
  const client = await db.setClientPassword(req.params.slug, password || null);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, password_protected: !!client.password_hash });
});

// Client Projects
app.get('/api/clients/:slug/projects', requireAuth, (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const projects = db.clientProjectsByClient(req.params.slug).map(p => {
    const versions = db.clientVersionsByProject(p.id);
    const latest = versions[0] || null;
    return { ...p, version_count: versions.length, latest_thumbnail: latest ? latest.thumbnail : '' };
  });
  res.json(projects);
});

app.post('/api/clients/:slug/projects', requireAuth, (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  let { title, slug: projectSlug, description, rf_number } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  if (!projectSlug) {
    projectSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  if (db.clientProjectBySlug(req.params.slug, projectSlug)) {
    return res.status(409).json({ error: 'Project slug already exists for this client' });
  }

  // Create project directory
  const projectDir = path.join(CLIENTS_DIR, req.params.slug, 'projects', projectSlug);
  fs.mkdirSync(projectDir, { recursive: true });

  try {
    const project = db.createClientProject({ client_slug: req.params.slug, slug: projectSlug, title, description, rf_number });
    res.json(project);
  } catch (err) {
    console.error('[Project] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.put('/api/clients/:slug/projects/:projectSlug', requireAuth, (req, res) => {
  const project = db.updateClientProject(req.params.slug, req.params.projectSlug, req.body);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

app.delete('/api/clients/:slug/projects/:projectSlug', requireAuth, (req, res) => {
  try {
    const result = db.deleteClientProject(req.params.slug, req.params.projectSlug);
    if (!result.changes) return res.status(404).json({ error: 'Project not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Project] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// Client Project Versions
app.get('/api/clients/:slug/projects/:projectSlug/versions', requireAuth, (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(db.clientVersionsByProject(project.id));
});

app.post('/api/clients/:slug/projects/:projectSlug/versions', requireAuth, (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { file_path: filePath, video, thumbnail, note } = req.body;
  const inputPath = filePath || video; // backward compat
  if (!inputPath) return res.status(400).json({ error: 'File path required' });

  // Ensure a default deliverable exists and use it
  const deliverable = db.ensureDefaultDeliverable(project.id);
  const version = db.createClientVersion({ client_project_id: project.id, deliverable_id: deliverable.id, file_path: inputPath, thumbnail, note });

  // Relocate files to organised path
  const relocated = relocateClientVersion(inputPath, req.params.slug, req.params.projectSlug, deliverable.slug, version.version_number);
  const finalPath = relocated.file_path || inputPath;
  const finalThumb = relocated.thumbnail || thumbnail || '';
  if (finalPath !== inputPath || finalThumb) {
    db.updateClientVersion(version.id, { file_path: finalPath, thumbnail: finalThumb });
  }

  // Extract video metadata in background (non-blocking)
  extractAndStoreVideoMeta(version.id, finalPath);

  res.json({ ...version, file_path: finalPath, thumbnail: finalThumb });
});

app.delete('/api/clients/:slug/projects/:projectSlug/versions/:id', requireAuth, (req, res) => {
  try {
    const result = db.deleteClientVersion(parseInt(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Version not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Version] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete version' });
  }
});

// Client Project Formats (Deliverables)
app.get('/api/clients/:slug/projects/:projectSlug/formats', requireAuth, (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const formats = db.deliverablesByProject(project.id).map(d => {
    const versions = db.clientVersionsByDeliverable(d.id);
    return { ...d, is_hero: !!d.is_hero, version_count: versions.length };
  });
  res.json(formats);
});

app.post('/api/clients/:slug/projects/:projectSlug/formats', requireAuth, (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  let { label, slug: formatSlug, type, aspect_ratio, sort_order, is_hero } = req.body;
  if (!label) return res.status(400).json({ error: 'Label required' });
  if (!formatSlug) {
    formatSlug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  try {
    const format = db.createDeliverable({
      client_project_id: project.id, slug: formatSlug, label, type, aspect_ratio, sort_order, is_hero
    });
    res.json(format);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Deliverable slug already exists' });
    console.error('[Format] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create deliverable' });
  }
});

app.put('/api/clients/:slug/projects/:projectSlug/formats/:formatId', requireAuth, (req, res) => {
  const format = db.updateDeliverable(parseInt(req.params.formatId), req.body);
  if (!format) return res.status(404).json({ error: 'Not found' });
  res.json(format);
});

app.delete('/api/clients/:slug/projects/:projectSlug/formats/:formatId', requireAuth, (req, res) => {
  db.deleteDeliverable(parseInt(req.params.formatId));
  res.json({ ok: true });
});

// List versions for a specific format
app.get('/api/clients/:slug/projects/:projectSlug/formats/:formatId/versions', requireAuth, (req, res) => {
  const format = db.deliverableById(parseInt(req.params.formatId));
  if (!format) return res.status(404).json({ error: 'Format not found' });
  res.json(db.clientVersionsByDeliverable(format.id));
});

// Add version to a specific format (supports video and non-video files)
app.post('/api/clients/:slug/projects/:projectSlug/formats/:formatId/versions', requireAuth, async (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const format = db.deliverableById(parseInt(req.params.formatId));
  if (!format) return res.status(404).json({ error: 'Format not found' });
  const { file_path: filePath, video, thumbnail, note, staging_file, file_size, mime_type } = req.body;
  const inputPath = filePath || video; // backward compat for video

  // Non-video: accept staging_file from generic assembly
  if (staging_file) {
    const safeStagingFile = safeName(staging_file);
    if (!safeStagingFile) return res.status(400).json({ error: 'Invalid staging file name' });

    // Move assembled file from staging to deliverable path
    const ext = path.extname(safeStagingFile).toLowerCase();
    const destDir = path.join(CLIENTS_DIR, req.params.slug, 'projects', req.params.projectSlug, 'formats', format.slug);
    fs.mkdirSync(destDir, { recursive: true });

    // Determine version number
    const existingVersions = db.clientVersionsByDeliverable(format.id);
    const versionNumber = (existingVersions.length > 0 ? Math.max(...existingVersions.map(v => v.version_number)) : 0) + 1;
    const vName = `v${versionNumber}${ext}`;
    const destPath = path.join(destDir, vName);

    // Move file
    const srcPath = path.join(UPLOADS_DIR, safeStagingFile);
    if (!fs.existsSync(srcPath)) {
      return res.status(400).json({ error: 'Staging file not found' });
    }
    fs.renameSync(srcPath, destPath);

    const finalFilePath = `/assets/clients/${req.params.slug}/projects/${req.params.projectSlug}/formats/${format.slug}/${vName}`;
    let thumbPath = thumbnail || '';

    // Generate thumbnail for images
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      try {
        const thumbName = `v${versionNumber}_thumb.jpg`;
        const thumbDest = path.join(destDir, thumbName);
        await generateImageThumbnail(destPath, thumbDest);
        thumbPath = `/assets/clients/${req.params.slug}/projects/${req.params.projectSlug}/formats/${format.slug}/${thumbName}`;
      } catch (e) { console.error('[Thumb] Image thumbnail error:', e.message); }
    }

    // Generate thumbnail for PDFs
    if (ext === '.pdf') {
      try {
        const thumbName = `v${versionNumber}_thumb.jpg`;
        const thumbDest = path.join(destDir, thumbName);
        await generatePdfThumbnail(destPath, thumbDest);
        thumbPath = `/assets/clients/${req.params.slug}/projects/${req.params.projectSlug}/formats/${format.slug}/${thumbName}`;
      } catch (e) { console.error('[Thumb] PDF thumbnail error:', e.message); }
    }

    // Get image dimensions if applicable
    let width = null, height = null;
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      try {
        const dims = await getImageDimensions(destPath);
        width = dims.width;
        height = dims.height;
      } catch {}
    }

    const version = db.createClientVersion({
      client_project_id: project.id, deliverable_id: format.id,
      file_path: finalFilePath, thumbnail: thumbPath, note,
      file_size: file_size || fs.statSync(destPath).size,
      mime_type: mime_type || 'application/octet-stream',
      width, height
    });
    return res.json(version);
  }

  // Video path (from transcode pipeline)
  if (!inputPath) return res.status(400).json({ error: 'File path required' });
  const version = db.createClientVersion({
    client_project_id: project.id, deliverable_id: format.id, file_path: inputPath, thumbnail, note
  });

  // Relocate files to organised path
  const relocated = relocateClientVersion(inputPath, req.params.slug, req.params.projectSlug, format.slug, version.version_number);
  const finalPath = relocated.file_path || inputPath;
  const finalThumb = relocated.thumbnail || thumbnail || '';
  if (finalPath !== inputPath || finalThumb) {
    db.updateClientVersion(version.id, { file_path: finalPath, thumbnail: finalThumb });
  }

  // Extract video metadata in background (non-blocking)
  extractAndStoreVideoMeta(version.id, finalPath);

  res.json({ ...version, file_path: finalPath, thumbnail: finalThumb });
});

// Client Project Files
const projectFileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(CLIENTS_DIR, req.params.slug, 'projects', req.params.projectSlug, 'files');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const prefix = crypto.randomBytes(4).toString('hex');
      cb(null, `${prefix}_${safe}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

app.get('/api/clients/:slug/projects/:projectSlug/files', requireAuth, (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(db.projectFilesByProject(project.id, req.query.category));
});

app.post('/api/clients/:slug/projects/:projectSlug/files', requireAuth, projectFileUpload.single('file'), (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const category = req.body.category || 'other';
  const filePath = `/assets/clients/${req.params.slug}/projects/${req.params.projectSlug}/files/${req.file.filename}`;

  const fileRecord = db.createProjectFile({
    client_project_id: project.id,
    category,
    filename: req.file.filename,
    original_name: req.file.originalname,
    file_path: filePath,
    file_size: req.file.size,
    mime_type: req.file.mimetype
  });
  res.json(fileRecord);
});

app.delete('/api/clients/:slug/projects/:projectSlug/files/:fileId', requireAuth, (req, res) => {
  const file = db.projectFileById(parseInt(req.params.fileId));
  if (file) {
    // Try with category subdirectory first (from-assembly uploads), then without (legacy multer uploads)
    const pathWithCategory = path.join(CLIENTS_DIR, req.params.slug, 'projects', req.params.projectSlug, 'files', file.category || '', file.filename);
    const pathWithout = path.join(CLIENTS_DIR, req.params.slug, 'projects', req.params.projectSlug, 'files', file.filename);
    try { fs.unlinkSync(pathWithCategory); } catch {
      try { fs.unlinkSync(pathWithout); } catch {}
    }
  }
  db.deleteProjectFile(parseInt(req.params.fileId));
  res.json({ ok: true });
});

// Toggle project file visibility
app.put('/api/clients/:slug/projects/:projectSlug/files/:fileId/visibility', requireAuth, express.json(), (req, res) => {
  db.setProjectFileVisibility(parseInt(req.params.fileId), req.body.client_visible);
  res.json({ ok: true });
});

// Toggle resource visibility
app.put('/api/clients/:slug/resources/:resourceId/visibility', requireAuth, express.json(), (req, res) => {
  db.setResourceVisibility(parseInt(req.params.resourceId), req.body.client_visible);
  res.json({ ok: true });
});

// Create resource from chunked upload assembly
app.post('/api/clients/:slug/resources/from-assembly', requireAuth, express.json(), (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const { staging_file, category, original_name } = req.body;
  if (!staging_file) return res.status(400).json({ error: 'Missing staging_file' });

  const safe = safeName(staging_file);
  if (!safe) return res.status(400).json({ error: 'Invalid staging file name' });

  const srcPath = path.join(UPLOADS_DIR, safe);
  if (!fs.existsSync(srcPath)) return res.status(400).json({ error: 'Staging file not found' });

  const cat = category || 'other';
  const finalDir = path.join(CLIENTS_DIR, req.params.slug, 'resources', cat);
  fs.mkdirSync(finalDir, { recursive: true });
  const finalPath = path.join(finalDir, safe);
  fs.renameSync(srcPath, finalPath);

  const filePath = `/assets/clients/${req.params.slug}/resources/${cat}/${safe}`;
  const fileSize = fs.statSync(finalPath).size;
  const ext = path.extname(safe).toLowerCase();

  const resource = db.createClientResource({
    client_slug: req.params.slug, category: cat,
    filename: safe, original_name: original_name || safe,
    file_path: filePath, file_size: fileSize,
    mime_type: pipeline.resolveMimeType(ext)
  });
  res.json(resource);
});

// Create project file from chunked upload assembly
app.post('/api/clients/:slug/projects/:projectSlug/files/from-assembly', requireAuth, express.json(), (req, res) => {
  const project = db.clientProjectBySlug(req.params.slug, req.params.projectSlug);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { staging_file, category, original_name } = req.body;
  if (!staging_file) return res.status(400).json({ error: 'Missing staging_file' });

  const safe = safeName(staging_file);
  if (!safe) return res.status(400).json({ error: 'Invalid staging file name' });

  const srcPath = path.join(UPLOADS_DIR, safe);
  if (!fs.existsSync(srcPath)) return res.status(400).json({ error: 'Staging file not found' });

  const cat = category || 'other';
  const finalDir = path.join(CLIENTS_DIR, req.params.slug, 'projects', req.params.projectSlug, 'files', cat);
  fs.mkdirSync(finalDir, { recursive: true });
  const finalPath = path.join(finalDir, safe);
  fs.renameSync(srcPath, finalPath);

  const filePath = `/assets/clients/${req.params.slug}/projects/${req.params.projectSlug}/files/${cat}/${safe}`;
  const fileSize = fs.statSync(finalPath).size;
  const ext = path.extname(safe).toLowerCase();

  const fileRecord = db.createProjectFile({
    client_project_id: project.id, category: cat,
    filename: safe, original_name: original_name || safe,
    file_path: filePath, file_size: fileSize,
    mime_type: pipeline.resolveMimeType(ext)
  });
  res.json(fileRecord);
});

// Also serve project files statically (already covered by /assets/clients static mount)

// Client Resources
app.get('/api/clients/:slug/resources', requireAuth, (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const category = req.query.category || null;
  res.json(db.clientResourcesByClient(req.params.slug, category));
});

app.post('/api/clients/:slug/resources', requireAuth, resourceUpload.single('file'), (req, res) => {
  const client = db.clientBySlug(req.params.slug);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const category = req.body.category || 'other';

  // Move from staging to correct category dir
  const finalDir = path.join(CLIENTS_DIR, req.params.slug, 'resources', category);
  fs.mkdirSync(finalDir, { recursive: true });
  const stagingPath = req.file.path;
  const finalPath = path.join(finalDir, req.file.filename);
  fs.renameSync(stagingPath, finalPath);

  const filePath = `/assets/clients/${req.params.slug}/resources/${category}/${req.file.filename}`;

  const resource = db.createClientResource({
    client_slug: req.params.slug,
    category,
    filename: req.file.filename,
    original_name: req.file.originalname,
    file_path: filePath,
    file_size: req.file.size,
    mime_type: req.file.mimetype
  });
  res.json(resource);
});

app.delete('/api/clients/:slug/resources/:id', requireAuth, (req, res) => {
  const resource = db.clientResourceById(parseInt(req.params.id));
  if (resource) {
    // Delete file from disk
    const diskPath = path.join(CLIENTS_DIR, req.params.slug, 'resources', resource.category, resource.filename);
    try { fs.unlinkSync(diskPath); } catch {}
  }
  db.deleteClientResource(parseInt(req.params.id));
  res.json({ ok: true });
});

// ---- External Links ----

// (URL validation now in pipeline/validate.js)

app.post('/api/external-links', requireAuth, (req, res) => {
  const { link_type, parent_id, url, title, doc_type, client_visible } = req.body;
  if (!link_type || !parent_id || !url || !title) {
    return res.status(400).json({ error: 'link_type, parent_id, url, and title are required' });
  }
  if (!isValidLinkUrl(url)) {
    return res.status(400).json({ error: 'URL must use http, https, or mailto protocol' });
  }
  const link = db.createExternalLink({ link_type, parent_id: parseInt(parent_id), url, title, doc_type, client_visible });
  res.json(link);
});

app.get('/api/external-links', requireAuth, (req, res) => {
  const { type, parent_id } = req.query;
  if (!type || !parent_id) return res.status(400).json({ error: 'type and parent_id required' });
  const links = db.externalLinksByParent(type, parseInt(parent_id), false);
  res.json(links);
});

app.get('/api/external-links/:id', requireAuth, (req, res) => {
  const link = db.externalLinkById(parseInt(req.params.id));
  if (!link) return res.status(404).json({ error: 'Not found' });
  res.json(link);
});

app.put('/api/external-links/:id', requireAuth, (req, res) => {
  if (req.body.url && !isValidLinkUrl(req.body.url)) {
    return res.status(400).json({ error: 'URL must use http, https, or mailto protocol' });
  }
  const link = db.updateExternalLink(parseInt(req.params.id), req.body);
  if (!link) return res.status(404).json({ error: 'Not found' });
  res.json(link);
});

app.delete('/api/external-links/:id', requireAuth, (req, res) => {
  db.deleteExternalLink(parseInt(req.params.id));
  res.json({ success: true });
});

// ---- Download endpoints ----

// Helper: verify client portal access for downloads
function verifyDownloadAccess(req, clientSlug) {
  // Admin session always has access
  if (isSessionValid(req.cookies?.session)) return true;
  // Portal session cookie — must match the client that owns the file
  const portalTok = req.cookies?.portal_session;
  if (portalTok && clientSlug) {
    const ps = portalSessions.get(portalTok);
    if (ps && ps.clientSlug === clientSlug && Date.now() - ps.created < SESSION_TTL) return true;
  }
  // Signed URL access
  if (req.query.sig && req.query.exp) {
    return verifySignature(req.path, req.query.sig, req.query.exp);
  }
  return false;
}

app.get('/api/download/version/:versionId', async (req, res) => {
  const version = db.getDb().prepare('SELECT * FROM client_project_versions WHERE id = ?').get(parseInt(req.params.versionId));
  if (!version) return res.status(404).json({ error: 'Version not found' });

  // Find which client this belongs to for auth
  const project = db.getDb().prepare('SELECT * FROM client_projects WHERE id = ?').get(version.client_project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (!verifyDownloadAccess(req, project.client_slug)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const filePath = version.file_path;
  if (!filePath) return res.status(404).json({ error: 'No file path' });

  const diskPath = pipeline.resolveDiskPath(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = pipeline.resolveMimeType(ext, version.mime_type);

  // Build descriptive filename
  const deliverable = version.deliverable_id ? db.deliverableById(version.deliverable_id) : null;
  const delivName = deliverable ? deliverable.label.replace(/[^a-zA-Z0-9_-]/g, '-') : 'file';
  const downloadName = `${delivName}-v${version.version_number}${ext}`;

  pipeline.serveDownload(diskPath, downloadName, mimeType, req, res);
});

app.get('/api/download/resource/:resourceId', (req, res) => {
  const resource = db.clientResourceById(parseInt(req.params.resourceId));
  if (!resource) return res.status(404).json({ error: 'Resource not found' });

  if (!verifyDownloadAccess(req, resource.client_slug)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const filePath = resource.file_path;
  if (!filePath) return res.status(404).json({ error: 'No file path' });

  const diskPath = pipeline.resolveDiskPath(filePath);
  const mimeType = resource.mime_type || 'application/octet-stream';
  const downloadName = resource.original_name || resource.filename;

  pipeline.serveDownload(diskPath, downloadName, mimeType, req, res);
});

app.get('/api/download/file/:fileId', (req, res) => {
  const file = db.projectFileById(parseInt(req.params.fileId));
  if (!file) return res.status(404).json({ error: 'File not found' });

  // Find which client this belongs to
  const project = db.getDb().prepare('SELECT * FROM client_projects WHERE id = ?').get(file.client_project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (!verifyDownloadAccess(req, project.client_slug)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const filePath = file.file_path;
  if (!filePath) return res.status(404).json({ error: 'No file path' });

  const diskPath = pipeline.resolveDiskPath(filePath);
  const mimeType = file.mime_type || 'application/octet-stream';
  const downloadName = file.original_name || file.filename;

  pipeline.serveDownload(diskPath, downloadName, mimeType, req, res);
});

// ---- Admin dashboard route ----

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Catch-all: serve index.html for SPA-style routes ----

// Legacy redirect — clients.html → /portal
app.get('/clients.html', (req, res) => {
  res.redirect(301, '/portal');
});

// Legacy redirect — screening.html?id=UUID → /portal/UUID
app.get('/screening.html', (req, res) => {
  const id = req.query.id;
  if (id) {
    res.redirect(301, `/portal/${encodeURIComponent(id)}`);
  } else {
    res.redirect(301, '/portal');
  }
});

// Clean watch URL with server-side meta tag rendering
app.get('/watch/:slug', (req, res) => {
  const film = db.filmBySlug(req.params.slug);
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'watch.html'), 'utf8');
  if (film) {
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const title = esc(film.title);
    const desc = esc(film.description || (film.title + ' — ' + film.category));
    html = html.replace('<title>Watch — Webbed Films</title>', `<title>${title} — Webbed Films</title>`);
    html = html.replace('content="Watch — Webbed Films"', `content="${title} — Webbed Films"`);
    html = html.replace('content="Webbed Films Screening Room."', `content="${desc}"`);
    if (film.thumbnail) {
      html = html.replace('content="/assets/images/watch-logo.png"', `content="${esc(film.thumbnail)}"`);
    }
    html = html.replace('content="https://watch.webbedfilms.com/watch.html"', `content="https://watch.webbedfilms.com/watch/${esc(film.slug)}"`);
  }
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(html);
});

// Legacy watch.html redirect to clean URL
app.get('/watch.html', (req, res) => {
  const slug = req.query.film;
  if (slug) return res.redirect(301, `/watch/${slug}`);
  res.sendFile(path.join(PUBLIC_DIR, 'watch.html'));
});

app.get('/category/:slug', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'category.html'));
});

// Client Portal routes — all serve the same SPA-style HTML
app.get('/portal', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'portal.html'));
});

app.get('/portal/:slug', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'portal-dashboard.html'));
});

app.get('/portal/:slug/project/:projectSlug', (req, res) => {
  if (req.query.view) {
    return res.sendFile(path.join(PUBLIC_DIR, 'portal-project.html'));
  }
  if (req.query.review) {
    return res.sendFile(path.join(PUBLIC_DIR, 'portal-review.html'));
  }
  res.sendFile(path.join(PUBLIC_DIR, 'portal-project-landing.html'));
});

// Legacy review URL redirect → new query param format
app.get('/portal/:slug/project/:projectSlug/review', (req, res) => {
  res.redirect(`/portal/${req.params.slug}/project/${req.params.projectSlug}?review=hero`);
});

app.get('/portal/:slug/resources', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'portal-dashboard.html'));
});

// ---- Login page HTML ----

function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin — Webbed Films</title>
  <link rel="icon" type="image/png" href="/assets/images/favicon.png?v=4">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@300;400;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@300;400;500&display=swap">
  <link rel="stylesheet" href="/css/style.css?v=59">
</head>
<body>
  <div class="work-bg-overlay"></div>

  <header class="site-header">
    <a href="/" class="logo-link"><img src="/assets/images/watch-logo.png" alt="Watch Webbed Films" class="logo"></a>
    <nav class="site-nav">
      <a href="/">Films</a>
      <a href="/portal">Client Portal</a>
      <a href="https://www.webbedfilms.com" target="_blank" rel="noopener noreferrer">Main Site</a>
    </nav>
  </header>

  <div class="page-content">
    <main class="clients-body">
      <div class="portal-entry">
        <img src="/assets/images/watch-logo.png" alt="Webbed Films" class="portal-entry-logo">
        <h1 class="portal-entry-title">Admin</h1>
        <p class="portal-entry-subtitle">Enter admin password to continue.</p>
        <form id="login-form" class="portal-entry-form">
          <input type="password" id="password" placeholder="Password" autofocus aria-label="Admin password">
          <button type="submit" class="btn">Enter</button>
        </form>
        <p id="login-error" class="portal-error"></p>
      </div>
    </main>
    <footer class="site-footer">
      <div class="footer-row">
        <span class="footer-copy">&copy; 2026 Webbed Films</span>
        <span class="footer-tagline">Integrity &middot; Quality &middot; Effort</span>
        <div class="footer-social">
          <a href="mailto:hello@webbedfilms.com" aria-label="Email"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg></a>
          <a href="https://www.instagram.com/webbedfilms/" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg></a>
          <a href="https://www.linkedin.com/company/webbed-films" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>
        </div>
      </div>
    </footer>
  </div>

  <script defer src="/js/dynamics.js?v=4"></script>
  <script>
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = document.getElementById('password').value;
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      if (res.ok) {
        window.location.href = '/admin';
      } else {
        document.getElementById('login-error').textContent = 'Wrong password';
      }
    });
  </script>
</body>
</html>`;
}

// ---- Storage migration (flat → category structure) ----

function migrateStorage() {
  // Check if there are MP4 files loose in VIDEO_DIR root (old flat structure)
  const rootFiles = fs.readdirSync(VIDEO_DIR).filter(f => {
    if (f.startsWith('.') || ['videos', 'thumbs', 'staging', 'originals', 'chunks'].includes(f)) return false;
    const fullPath = path.join(VIDEO_DIR, f);
    try {
      const stat = fs.lstatSync(fullPath);
      // Skip broken symlinks and directories
      if (stat.isSymbolicLink()) {
        try { fs.statSync(fullPath); } catch { return false; } // broken symlink
      }
      return stat.isFile() || stat.isSymbolicLink();
    } catch { return false; }
  });

  // Also check for thumbnails directly in THUMB_DIR (not in subdirs)
  const rootThumbs = fs.readdirSync(THUMB_DIR).filter(f => {
    if (f.startsWith('.') || f.startsWith('_candidate_')) return false;
    const fullPath = path.join(THUMB_DIR, f);
    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        try { fs.statSync(fullPath); } catch { return false; }
      }
      return stat.isFile() || stat.isSymbolicLink();
    } catch { return false; }
  });

  if (rootFiles.length === 0 && rootThumbs.length === 0) {
    // Even if no flat files to migrate, still convert any remaining symlinks
    convertSymlinksToShared();
    return;
  }

  console.log(`[Migration] Found ${rootFiles.length} root video files and ${rootThumbs.length} root thumbnails — migrating to category structure...`);

  // Build a map: filename → category (from DB)
  const films = db.allFilms();
  const videoToCat = {};
  const thumbToCat = {};

  for (const film of films) {
    const catSlug = categorySlug(film.category);
    if (film.video) {
      const filename = path.basename(film.video);
      videoToCat[filename] = catSlug;
      // Map related thumb files to this category
      const videoBase = path.parse(filename).name;
      thumbToCat[videoBase] = catSlug;
    }
    if (film.thumbnail) {
      const thumbFilename = path.basename(film.thumbnail);
      const thumbBase = path.parse(thumbFilename).name;
      // Use video-based mapping if available, otherwise use thumb directly
      if (!thumbToCat[thumbBase.replace(/_thumb$/, '')]) {
        thumbToCat[thumbBase.replace(/_thumb$/, '')] = catSlug;
      }
    }
  }

  // Move video files
  for (const file of rootFiles) {
    const catSlug = videoToCat[file] || 'uncategorised';
    const destDir = path.join(VIDEOS_DIR, catSlug);
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(path.join(VIDEO_DIR, file), path.join(destDir, file));
    console.log(`[Migration] Video: ${file} → videos/${catSlug}/`);
  }

  // Move thumbnail files
  for (const file of rootThumbs) {
    // Determine category from the thumb's video base name
    const thumbBase = path.parse(file).name;
    // Strip _thumb, _thumb_opt_N suffixes to get the video base
    const videoBase = thumbBase.replace(/_thumb(_opt_\d+)?$/, '');
    const catSlug = thumbToCat[videoBase] || 'uncategorised';
    const destDir = path.join(THUMB_DIR, catSlug);
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(path.join(THUMB_DIR, file), path.join(destDir, file));
  }
  if (rootThumbs.length > 0) console.log(`[Migration] Moved ${rootThumbs.length} thumbnails to category folders`);

  // Update DB paths for all films
  for (const film of films) {
    const catSlug = categorySlug(film.category);
    const updates = {};
    if (film.video) {
      const filename = path.basename(film.video);
      const newPath = `/assets/videos/${catSlug}/${filename}`;
      if (film.video !== newPath) updates.video = newPath;
    }
    if (film.thumbnail) {
      const filename = path.basename(film.thumbnail);
      const newPath = `/assets/thumbs/${catSlug}/${filename}`;
      if (film.thumbnail !== newPath) updates.thumbnail = newPath;
    }
    if (Object.keys(updates).length > 0) {
      db.updateFilm(film.slug, updates);
    }
  }

  // Update project_versions DB paths
  try {
    const allProjects = db.allProjects();
    for (const project of allProjects) {
      const versions = db.versionsByProject(project.uuid);
      for (const v of versions) {
        const updates = {};
        if (v.video) {
          const filename = path.basename(v.video);
          // Project versions don't have categories — put in uncategorised
          const newPath = `/assets/videos/uncategorised/${filename}`;
          if (v.video !== newPath) updates.video = newPath;
        }
        if (v.thumbnail) {
          const filename = path.basename(v.thumbnail);
          const newPath = `/assets/thumbs/uncategorised/${filename}`;
          if (v.thumbnail !== newPath) updates.thumbnail = newPath;
        }
        if (Object.keys(updates).length > 0) {
          // Direct DB update for project versions
          const setClauses = Object.keys(updates).map(k => `${k} = ?`);
          const values = Object.values(updates);
          values.push(v.id);
          db.getDb().prepare(`UPDATE project_versions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
        }
      }
    }
  } catch (e) {
    console.log(`[Migration] Warning: project versions update — ${e.message}`);
  }

  // Move old originals/ and chunks/ contents to staging/ if they exist
  for (const oldDir of ['originals', 'chunks']) {
    const oldPath = path.join(VIDEO_DIR, oldDir);
    if (fs.existsSync(oldPath)) {
      const destDir = oldDir === 'originals' ? UPLOADS_DIR : CHUNKS_DIR;
      const files = fs.readdirSync(oldPath).filter(f => !f.startsWith('.'));
      for (const f of files) {
        fs.renameSync(path.join(oldPath, f), path.join(destDir, f));
      }
      // Remove old directory if empty
      try { fs.rmdirSync(oldPath); } catch { /* not empty or other error */ }
    }
  }

  convertSymlinksToShared();

  console.log('[Migration] Storage migration complete.');
}

// Convert symlinks pointing to webbed-films into /shared/ paths
function convertSymlinksToShared() {
  try {
    const allFilms = db.allFilms();
    let converted = 0;
    for (const film of allFilms) {
      const updates = {};
      if (film.video && film.video.startsWith('/assets/videos/')) {
        const relPath = film.video.replace(/^\/assets\/videos\//, '');
        const fullPath = path.join(VIDEOS_DIR, relPath);
        try {
          const stat = fs.lstatSync(fullPath);
          if (stat.isSymbolicLink()) {
            const target = fs.readlinkSync(fullPath);
            if (target.includes('/mnt/user/watch/')) {
              const match = target.match(/\/mnt\/user\/watch\/videos\/(.+)$/);
              if (match) {
                updates.video = `/shared/videos/${match[1]}`;
                fs.unlinkSync(fullPath);
                converted++;
              }
            }
          }
        } catch {}
      }
      if (film.thumbnail && film.thumbnail.startsWith('/assets/thumbs/')) {
        const relPath = film.thumbnail.replace(/^\/assets\/thumbs\//, '');
        const fullPath = path.join(THUMB_DIR, relPath);
        try {
          const stat = fs.lstatSync(fullPath);
          if (stat.isSymbolicLink()) {
            const target = fs.readlinkSync(fullPath);
            if (target.includes('/mnt/user/watch/')) {
              const match = target.match(/\/mnt\/user\/watch\/thumbs\/(.+)$/);
              if (match) {
                updates.thumbnail = `/shared/thumbs/${match[1]}`;
                fs.unlinkSync(fullPath);
                converted++;
              }
            }
          }
        } catch {}
      }
      if (Object.keys(updates).length > 0) {
        db.updateFilm(film.slug, updates);
      }
    }
    if (converted > 0) console.log(`[Migration] Converted ${converted} symlinks to /shared/ paths`);
  } catch (e) {
    console.log(`[Migration] Symlink conversion warning: ${e.message}`);
  }
}

// ---- Start ----

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Watch Admin] Running on port ${PORT}`);
  console.log(`[Watch Admin] VIDEO_DIR: ${VIDEO_DIR}`);
  console.log(`[Watch Admin] DATA_DIR: ${DATA_DIR}`);

  // Run pipeline startup cleanup (orphaned jobs, stale uploads, old staging files)
  pipeline.runStartupCleanup(db);

  // Run storage migration if needed (flat → category structure)
  try { migrateStorage(); } catch (err) {
    console.error('[Migration] Storage migration failed (non-fatal):', err.message);
  }
});

// ---- Error handling ----

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message, err.stack);
  // Don't exit — let the process continue serving
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason instanceof Error ? reason.stack : reason);
  // Don't exit — let the process continue serving
});

// Admin SPA catch-all — serve index.html for all /admin/* routes
app.get('/admin/*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Prevent browsers/CDN from caching 404 responses (especially for assets)
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404);
  if (req.path.startsWith('/api/')) return res.json({ error: 'Not found' });
  if (req.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|svg|otf|ttf|woff2?)$/i)) return res.end();
  res.send('Not found');
});

// Express error middleware — must be last
app.use((err, req, res, next) => {
  console.error('[Error]', err.message, err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send('Internal server error');
});

// Allow large uploads — disable default 2-minute timeout
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
