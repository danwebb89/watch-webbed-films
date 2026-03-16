const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const { spawn } = require('child_process');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3500;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const VIDEO_DIR = process.env.VIDEO_DIR || path.join(__dirname, '..', 'public', 'assets', 'videos');
const THUMB_DIR = process.env.THUMB_DIR || path.join(__dirname, '..', 'public', 'assets', 'thumbs');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public');

// Organised storage structure
const VIDEOS_DIR = path.join(VIDEO_DIR, 'videos');       // transcoded videos by category
const STAGING_DIR = path.join(VIDEO_DIR, 'staging');      // temporary upload area
const UPLOADS_DIR = path.join(STAGING_DIR, 'uploads');    // raw uploaded files
const CHUNKS_DIR = path.join(STAGING_DIR, 'chunks');      // chunked upload assembly

// Category slug mapping
const CATEGORY_SLUGS = {
  'Feature Films': 'feature-films',
  'Short Films': 'short-films',
  'Documentary': 'documentary',
  'Media Zoo': 'media-zoo',
  'Ratcliffe Studios': 'ratcliffe-studios',
  'Revelstoke Films': 'revelstoke-films',
  'Showreels': 'showreels',
  'Trailers and BTS': 'trailers-and-bts',
  'Webbed Films': 'webbed-films',
  'Corporate': 'corporate',
};

function categorySlug(name) {
  if (!name) return 'uncategorised';
  return CATEGORY_SLUGS[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'uncategorised';
}

// Ensure directories exist
const ALL_CAT_SLUGS = [...Object.values(CATEGORY_SLUGS), 'uncategorised'];
[VIDEO_DIR, THUMB_DIR, DATA_DIR, VIDEOS_DIR, STAGING_DIR, UPLOADS_DIR, CHUNKS_DIR].forEach(dir => {
  fs.mkdirSync(dir, { recursive: true });
});
for (const cat of ALL_CAT_SLUGS) {
  fs.mkdirSync(path.join(VIDEOS_DIR, cat), { recursive: true });
  fs.mkdirSync(path.join(THUMB_DIR, cat), { recursive: true });
}

// ---- File placement helpers ----

// Move video + thumbnails from one category folder to another, return updated paths
function resolveFilmFiles(videoPath, thumbnailPath, category) {
  const catSlug = categorySlug(category);
  let finalVideo = videoPath;
  let finalThumb = thumbnailPath;

  if (videoPath) {
    const parts = videoPath.replace(/^\/assets\/videos\//, '').split('/');
    if (parts.length === 2) {
      const [currentCat, filename] = parts;
      if (currentCat !== catSlug) {
        const srcPath = path.join(VIDEOS_DIR, currentCat, filename);
        const destDir = path.join(VIDEOS_DIR, catSlug);
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, filename);
        if (fs.existsSync(srcPath)) {
          fs.renameSync(srcPath, destPath);
          console.log(`[Files] Moved video: ${currentCat}/${filename} → ${catSlug}/`);
        }
        finalVideo = `/assets/videos/${catSlug}/${filename}`;
      }
    }
  }

  if (thumbnailPath) {
    const parts = thumbnailPath.replace(/^\/assets\/thumbs\//, '').split('/');
    if (parts.length === 2) {
      const [currentCat, filename] = parts;
      if (currentCat !== catSlug) {
        const srcDir = path.join(THUMB_DIR, currentCat);
        const destDir = path.join(THUMB_DIR, catSlug);
        fs.mkdirSync(destDir, { recursive: true });

        // Move main thumbnail
        const srcPath = path.join(srcDir, filename);
        if (fs.existsSync(srcPath)) {
          fs.renameSync(srcPath, path.join(destDir, filename));
          console.log(`[Files] Moved thumb: ${currentCat}/${filename} → ${catSlug}/`);
        }
        finalThumb = `/assets/thumbs/${catSlug}/${filename}`;

        // Move thumbnail options
        const thumbBase = path.parse(filename).name; // e.g. 'file_thumb'
        try {
          const optFiles = fs.readdirSync(srcDir).filter(f => f.startsWith(thumbBase + '_opt_'));
          for (const optFile of optFiles) {
            fs.renameSync(path.join(srcDir, optFile), path.join(destDir, optFile));
          }
          if (optFiles.length > 0) console.log(`[Files] Moved ${optFiles.length} thumb options → ${catSlug}/`);
        } catch (e) { /* source dir may not exist */ }
      }
    }
  }

  return { video: finalVideo, thumbnail: finalThumb };
}

// Clean up unused thumbnail options for a film
function cleanupThumbOptions(thumbnailPath) {
  if (!thumbnailPath) return;
  const parts = thumbnailPath.replace(/^\/assets\/thumbs\//, '').split('/');
  if (parts.length !== 2) return;
  const [catSlug, filename] = parts;
  const thumbDir = path.join(THUMB_DIR, catSlug);
  const thumbBase = path.parse(filename).name; // e.g. 'file_thumb'
  try {
    const optFiles = fs.readdirSync(thumbDir).filter(f => f.startsWith(thumbBase + '_opt_'));
    for (const optFile of optFiles) {
      fs.unlinkSync(path.join(thumbDir, optFile));
    }
    if (optFiles.length > 0) console.log(`[Cleanup] Removed ${optFiles.length} unused thumb options for ${filename}`);
  } catch (e) { /* ignore */ }
}

// ---- Transcode queue ----

const transcodeJobs = new Map(); // id -> { status, progress, input, output, error }
const PENDING_DIR = path.join(DATA_DIR, 'pending');
fs.mkdirSync(PENDING_DIR, { recursive: true });

function probeduration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => resolve(parseFloat(out) || 0));
    proc.on('error', () => resolve(0));
  });
}

async function transcodeVideo(jobId, inputPath, outputPath) {
  const job = transcodeJobs.get(jobId);
  job.status = 'probing';

  const duration = await probeEnabled() ? await probeFor(inputPath) : 0;

  job.status = 'transcoding';
  job.duration = duration;

  // Intel QuickSync HEVC hardware encoding (i7-10700K)
  const args = [
    '-hwaccel', 'qsv',
    '-hwaccel_output_format', 'qsv',
    '-i', inputPath,
    '-c:v', 'hevc_qsv',
    '-preset', 'slow',
    '-global_quality', '20',
    '-tag:v', 'hvc1',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    '-progress', 'pipe:1',
    outputPath
  ];

  const proc = spawn('ffmpeg', args);
  job.pid = proc.pid;

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('out_time_us=')) {
        const us = parseInt(line.split('=')[1]);
        if (duration > 0 && us > 0) {
          job.progress = Math.min(99, Math.round((us / 1000000 / duration) * 100));
        }
      }
    }
  });

  proc.stderr.on('data', (data) => {
    job.lastLog = data.toString().slice(-200);
  });

  proc.on('close', async (code) => {
    if (code === 0) {
      job.status = 'generating_thumbnail';
      job.progress = 100;
      console.log(`[Transcode] Complete: ${path.basename(outputPath)}`);

      // Auto-generate thumbnails (5 options + best pick)
      const thumbName = path.parse(path.basename(outputPath)).name + '_thumb.jpg';
      const thumbResult = await generateThumbnail(outputPath, thumbName);
      if (thumbResult && typeof thumbResult === 'object') {
        job.thumbnail = thumbResult.selected;
        job.thumbnailOptions = thumbResult.options;
      } else {
        job.thumbnail = thumbResult;
        job.thumbnailOptions = [];
      }

      // Delete the original from staging/uploads/
      try {
        if (fs.existsSync(inputPath) && inputPath.includes('staging')) {
          fs.unlinkSync(inputPath);
          console.log(`[Transcode] Deleted original: ${path.basename(inputPath)}`);
        }
      } catch (e) {
        console.log(`[Transcode] Warning: failed to delete original — ${e.message}`);
      }

      // Server-side auto-save: if pending film metadata exists, create the film now
      const pendingFile = path.join(PENDING_DIR, jobId + '.json');
      if (fs.existsSync(pendingFile)) {
        try {
          const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
          let videoPath = job.videoPath || `/assets/videos/uncategorised/${job.output}`;
          let thumbnail = job.thumbnail || '';
          const filmCategory = pending.category || '';

          // Move files to correct category folder
          const resolved = resolveFilmFiles(videoPath, thumbnail, filmCategory);
          videoPath = resolved.video;
          thumbnail = resolved.thumbnail;

          if (!db.filmBySlug(pending.slug)) {
            db.createFilm({
              slug: pending.slug,
              title: pending.title,
              category: filmCategory,
              year: parseInt(pending.year) || new Date().getFullYear(),
              description: pending.description || '',
              thumbnail,
              video: videoPath,
              public: pending.public !== false,
              eligible_for_featured: !!pending.eligible_for_featured
            });
            console.log(`[AutoSave] Film "${pending.title}" saved to database`);
          }
          fs.unlinkSync(pendingFile);
        } catch (e) {
          console.log(`[AutoSave] Warning: failed to auto-save film — ${e.message}`);
        }
      }

      job.status = 'done';
    } else {
      job.status = 'error';
      job.error = `ffmpeg exited with code ${code}`;
      console.log(`[Transcode] Failed: ${path.basename(inputPath)} — code ${code}`);
    }
  });

  proc.on('error', (err) => {
    job.status = 'error';
    job.error = err.message;
  });
}

async function generateThumbnail(videoPath, thumbName, thumbSubdir = 'uncategorised') {
  const duration = await probeFor(videoPath);
  const thumbDir = path.join(THUMB_DIR, thumbSubdir);
  fs.mkdirSync(thumbDir, { recursive: true });
  const outputPath = path.join(thumbDir, thumbName);

  // Detect black bars so thumbnails fill the frame
  const cropFilter = await detectCrop(videoPath, duration);

  // Generate 10 candidates at different points and pick the best one
  const percentages = [0.08, 0.16, 0.24, 0.32, 0.40, 0.50, 0.58, 0.66, 0.76, 0.88];
  const candidates = [];

  for (let i = 0; i < percentages.length; i++) {
    const seekTo = duration > 0 ? Math.max(1, Math.floor(duration * percentages[i])) : 2;
    const candidatePath = path.join(thumbDir, `_candidate_${i}_${thumbName}`);

    const args = [
      '-ss', String(seekTo),
      '-i', videoPath,
      ...(cropFilter ? ['-vf', cropFilter] : []),
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      candidatePath
    ];

    const ok = await new Promise((resolve) => {
      const proc = spawn('ffmpeg', args);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });

    if (ok) {
      try {
        const stat = fs.statSync(candidatePath);
        // Use ffprobe to get average brightness (signalstats)
        const brightness = await probeFrameBrightness(candidatePath);
        candidates.push({ path: candidatePath, size: stat.size, pct: percentages[i], brightness });
      } catch {}
    }
  }

  if (candidates.length === 0) {
    console.log(`[Thumbnail] Failed for ${thumbName} — no candidates`);
    return null;
  }

  // Score each candidate: prefer medium brightness (not too dark/bright) + larger file size (more detail)
  for (const c of candidates) {
    // Brightness score: 0-1, peaks at ~110 (good midtone exposure), penalise extremes
    const brightTarget = 110;
    const brightDist = Math.abs(c.brightness - brightTarget);
    c.brightScore = Math.max(0, 1 - brightDist / 128);
    // Size score: normalised 0-1 relative to largest
    c.sizeNorm = c.size;
  }
  const maxSize = Math.max(...candidates.map(c => c.sizeNorm));
  for (const c of candidates) {
    c.sizeScore = maxSize > 0 ? c.sizeNorm / maxSize : 0;
    // Combined: 60% brightness quality, 40% detail/size
    c.score = c.brightScore * 0.6 + c.sizeScore * 0.4;
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Keep the best as the default thumbnail
  fs.copyFileSync(best.path, outputPath);

  // Rename candidates to persistent names (thumb_opt_0.jpg ... thumb_opt_4.jpg)
  const baseName = path.parse(thumbName).name; // e.g. "in_bloom__2007___720p__thumb"
  const candidatePaths = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const optName = `${baseName}_opt_${i}.jpg`;
    const optPath = path.join(thumbDir, optName);
    fs.renameSync(c.path, optPath);
    candidatePaths.push(`/assets/thumbs/${thumbSubdir}/${optName}`);
  }

  console.log(`[Thumbnail] Generated: ${thumbName} + ${candidatePaths.length} options (best at ${Math.round(best.pct * 100)}%, brightness=${best.brightness.toFixed(0)}, score=${best.score.toFixed(2)})`);
  return { selected: `/assets/thumbs/${thumbSubdir}/${thumbName}`, options: candidatePaths };
}

async function probeEnabled() {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-version']);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function probeFor(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath
    ]);
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.on('close', () => resolve(parseFloat(out) || 0));
    proc.on('error', () => resolve(0));
  });
}

// Detect black bars (letterboxing/pillarboxing) and return a crop filter string
async function detectCrop(videoPath, duration) {
  const seekTo = duration > 0 ? Math.max(1, Math.floor(duration * 0.3)) : 2;
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-ss', String(seekTo),
      '-i', videoPath,
      '-vframes', '10',
      '-vf', 'cropdetect=24:2:0',
      '-f', 'null',
      '-'
    ]);
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', () => {
      // Parse the last cropdetect line (most stable detection)
      const matches = [...stderr.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)];
      if (matches.length === 0) return resolve(null);
      const lastCrop = matches[matches.length - 1][1];
      // Only apply crop if it actually removes something
      const [w, h] = lastCrop.split(':').map(Number);
      if (w > 0 && h > 0) {
        return resolve(`crop=${lastCrop}`);
      }
      resolve(null);
    });
    proc.on('error', () => resolve(null));
  });
}

// Probe average brightness of an image (0-255) using ffmpeg signalstats
async function probeFrameBrightness(imagePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-i', imagePath,
      '-vf', 'signalstats',
      '-f', 'null',
      '-v', 'info',
      '-'
    ]);
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', () => {
      // Parse YAVG from signalstats output
      const match = stderr.match(/YAVG:(\d+\.?\d*)/);
      resolve(match ? parseFloat(match[1]) : 128);
    });
    proc.on('error', () => resolve(128));
  });
}

// Initialise SQLite database
db.init(DATA_DIR);

// ---- Security: Helmet ----
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
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false
}));
app.disable('x-powered-by');

app.use(express.json());
app.use(cookieParser());

// ---- Security: Rate Limiting ----

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' }
});

const passwordVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' }
});

const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

app.use('/api/', (req, res, next) => {
  // Skip rate limiting for upload endpoints (chunked uploads send many requests)
  if (req.path.startsWith('/upload/')) return next();
  generalApiLimiter(req, res, next);
});

// ---- Auth ----

const sessions = new Set();

function makeToken() {
  const tok = crypto.randomBytes(32).toString('hex');
  sessions.add(tok);
  return tok;
}

function requireAuth(req, res, next) {
  const tok = req.cookies?.session;
  if (tok && sessions.has(tok)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

// Login page
app.get('/login', (req, res) => {
  res.send(loginPage());
});

app.post('/api/login', loginLimiter, (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const tok = makeToken();
    res.cookie('session', tok, { httpOnly: true, sameSite: 'lax', maxAge: 86400000 });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(req.cookies?.session);
  res.clearCookie('session');
  res.json({ ok: true });
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

// Favicon
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=2592000');
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(path.join(PUBLIC_DIR, 'assets', 'images', 'favicon.png'));
});

// Versioned CSS/JS — cache forever (busted by ?v= param)
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css'), {
  maxAge: '1y',
  immutable: true
}));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js'), {
  maxAge: '1y',
  immutable: true
}));

// Images and static assets — cache 30 days
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), {
  maxAge: '30d',
  etag: true,
  lastModified: true
}));

// HTML and other files — no-cache (revalidate each time)
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ---- Public API helpers ----

function sanitizeFilmForPublic(film) {
  const isPrivate = film.visibility === 'private';
  return {
    slug: film.slug,
    title: film.title,
    category: film.category,
    year: film.year,
    thumbnail: film.thumbnail,
    description: film.description,
    duration: film.duration_minutes,
    password_protected: isPrivate,
    eligible_for_featured: !!film.eligible_for_featured,
    video: isPrivate ? '' : (film.video || '')
  };
}

function sanitizeFeaturedFilm(film) {
  return {
    slug: film.slug,
    title: film.title,
    category: film.category,
    year: film.year,
    thumbnail: film.thumbnail,
    description: film.description,
    duration: film.duration_minutes,
    video: film.video || ''
  };
}

// ---- Public API (no auth required) ----

app.get('/api/public/featured', (req, res) => {
  const film = db.featuredFilm();
  if (!film) return res.json(null);
  res.set('Cache-Control', 'public, max-age=600, s-maxage=120');
  res.json(sanitizeFeaturedFilm(film));
});

app.get('/api/public/films', (req, res) => {
  const films = db.publicFilms().map(sanitizeFilmForPublic);
  res.set('Cache-Control', 'public, max-age=300, s-maxage=60');
  res.json(films);
});

app.get('/api/public/films/:slug', (req, res) => {
  const film = db.filmBySlug(req.params.slug);
  if (!film || film.visibility === 'client') return res.status(404).json({ error: 'Not found' });
  res.json(sanitizeFilmForPublic(film));
});

app.post('/api/public/films/:slug/verify-password', passwordVerifyLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const film = db.filmBySlug(req.params.slug);
  if (!film || film.visibility === 'client') return res.status(404).json({ error: 'Not found' });
  if (!film.password_hash) {
    // No password set — just grant access
    return res.json({ ok: true, video: film.video });
  }
  if (db.verifyFilmPassword(req.params.slug, password)) {
    return res.json({ ok: true, video: film.video });
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

app.get('/api/public/projects/:uuid', (req, res) => {
  const project = db.projectByUuid(req.params.uuid);
  if (!project || !project.active) return res.status(404).json({ error: 'Not found' });
  // Serve latest version's video/thumbnail
  const latest = db.latestVersion(req.params.uuid);
  if (latest) {
    project.video = latest.video;
    project.thumbnail = latest.thumbnail || '';
  }
  res.json(project);
});

// Serve videos and thumbs from category subdirs (with caching)
app.use('/assets/videos', express.static(VIDEOS_DIR, {
  maxAge: '30d',
  etag: true,
  lastModified: true
}));
app.use('/assets/thumbs', express.static(THUMB_DIR, {
  maxAge: '30d',
  etag: true,
  lastModified: true
}));

// ---- File Upload ----

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, safe);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50GB
});

const thumbUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(THUMB_DIR, 'uncategorised')),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, safe);
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

  const originalPath = path.join(UPLOADS_DIR, req.file.filename);
  const baseName = path.parse(req.file.filename).name;
  const outputName = baseName + '.mp4';
  const outputPath = path.join(VIDEOS_DIR, 'uncategorised', outputName);

  const jobId = crypto.randomBytes(8).toString('hex');
  transcodeJobs.set(jobId, {
    status: 'queued',
    progress: 0,
    input: req.file.filename,
    output: outputName,
    videoPath: `/assets/videos/uncategorised/${outputName}`,
    error: null
  });

  // Start transcode in background
  transcodeVideo(jobId, originalPath, outputPath);

  res.json({
    filename: outputName,
    path: `/assets/videos/uncategorised/${outputName}`,
    videoPath: `/assets/videos/uncategorised/${outputName}`,
    transcodeId: jobId,
    original: req.file.filename
  });
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

app.post('/api/upload/video-chunk', requireAuth, chunkUpload.single('chunk'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No chunk' });
  const { uploadId, chunkIndex, totalChunks } = req.body;

  // Rename temp file to proper name now that we have the form fields
  const properName = `${uploadId}_chunk_${chunkIndex.padStart(6, '0')}`;
  const properPath = path.join(CHUNKS_DIR, properName);
  fs.renameSync(req.file.path, properPath);

  console.log(`[Upload] Chunk ${parseInt(chunkIndex)+1}/${totalChunks} for ${uploadId}`);
  res.json({ ok: true, chunkIndex: parseInt(chunkIndex) });
});

app.post('/api/upload/video-assemble', requireAuth, express.json(), async (req, res) => {
  const { uploadId, filename } = req.body;
  if (!uploadId || !filename) return res.status(400).json({ error: 'Missing uploadId or filename' });

  // Find all chunks for this uploadId
  const allFiles = fs.readdirSync(CHUNKS_DIR);
  const chunkFiles = allFiles
    .filter(f => f.startsWith(uploadId + '_chunk_'))
    .sort();

  if (chunkFiles.length === 0) return res.status(400).json({ error: 'No chunks found' });

  try {
    // Assemble into staging uploads dir
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const assembledPath = path.join(UPLOADS_DIR, safe);
    const writeStream = fs.createWriteStream(assembledPath);

    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(CHUNKS_DIR, chunkFile);
      await new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(chunkPath);
        readStream.on('error', reject);
        readStream.on('end', resolve);
        readStream.pipe(writeStream, { end: false });
      });
    }

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      writeStream.end();
    });

    // Clean up chunks
    for (const chunkFile of chunkFiles) {
      fs.unlinkSync(path.join(CHUNKS_DIR, chunkFile));
    }

    console.log(`[Upload] Assembled ${chunkFiles.length} chunks → ${safe} (${(fs.statSync(assembledPath).size / 1024 / 1024).toFixed(1)} MB)`);

    // Start transcode (same as regular upload)
    const baseName = path.parse(safe).name;
    const outputName = baseName + '.mp4';
    const outputPath = path.join(VIDEOS_DIR, 'uncategorised', outputName);

    const jobId = crypto.randomBytes(8).toString('hex');
    transcodeJobs.set(jobId, {
      status: 'queued',
      progress: 0,
      input: safe,
      output: outputName,
      videoPath: `/assets/videos/uncategorised/${outputName}`,
      error: null
    });

    transcodeVideo(jobId, assembledPath, outputPath);

    res.json({
      filename: outputName,
      path: `/assets/videos/uncategorised/${outputName}`,
      videoPath: `/assets/videos/uncategorised/${outputName}`,
      transcodeId: jobId,
      original: safe
    });
  } catch (err) {
    console.error('[Upload] Assembly error:', err);
    res.status(500).json({ error: 'Failed to assemble: ' + err.message });
  }
});

// Save pending film metadata for server-side auto-save after transcode
app.post('/api/transcode/:id/pending', requireAuth, (req, res) => {
  const job = transcodeJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const pendingFile = path.join(PENDING_DIR, req.params.id + '.json');
  fs.writeFileSync(pendingFile, JSON.stringify(req.body));
  console.log(`[Pending] Saved metadata for transcode ${req.params.id}: "${req.body.title}"`);
  res.json({ ok: true });
});

// Transcode status
app.get('/api/transcode/:id', requireAuth, (req, res) => {
  const job = transcodeJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/transcode', requireAuth, (req, res) => {
  const jobs = [];
  for (const [id, job] of transcodeJobs) {
    jobs.push({ id, ...job });
  }
  res.json(jobs);
});

app.post('/api/upload/thumb', requireAuth, thumbUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ filename: req.file.filename, path: `/assets/thumbs/uncategorised/${req.file.filename}` });
});

// List uploaded files (recurse through category subdirs)
app.get('/api/files/videos', requireAuth, (req, res) => {
  const files = [];
  const subdirs = fs.readdirSync(VIDEOS_DIR).filter(d => {
    const p = path.join(VIDEOS_DIR, d);
    return fs.statSync(p).isDirectory();
  });
  for (const subdir of subdirs) {
    const dirPath = path.join(VIDEOS_DIR, subdir);
    const dirFiles = fs.readdirSync(dirPath).filter(f => !f.startsWith('.') && fs.statSync(path.join(dirPath, f)).isFile());
    for (const f of dirFiles) {
      files.push({
        name: f,
        category: subdir,
        path: `/assets/videos/${subdir}/${f}`,
        size: fs.statSync(path.join(dirPath, f)).size
      });
    }
  }
  res.json(files);
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

  const film = db.createFilm({ slug, title, category, year: parseInt(year) || new Date().getFullYear(), description, thumbnail, video, public: isPublic, visibility, eligible_for_featured });
  res.json(film);
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
  const result = await generateThumbnail(videoPath, thumbName, catSlug);

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
  db.deleteFilm(req.params.slug);
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

app.put('/api/films/:slug/password', requireAuth, (req, res) => {
  const { password } = req.body;
  const film = db.setFilmPassword(req.params.slug, password || null);
  if (!film) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, password_protected: !!film.password_hash });
});

// ---- Projects CRUD ----

app.get('/api/projects', requireAuth, (req, res) => {
  const projects = db.allProjects().map(p => {
    const versions = db.versionsByProject(p.uuid);
    return { ...p, version_count: versions.length };
  });
  res.json(projects);
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { title, video } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const uuid = uuidv4().split('-')[0];
  const project = db.createProject({ uuid, title, video });
  res.json(project);
});

app.put('/api/projects/:uuid', requireAuth, (req, res) => {
  const project = db.updateProject(req.params.uuid, req.body);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

app.delete('/api/projects/:uuid', requireAuth, (req, res) => {
  db.deleteProject(req.params.uuid);
  res.json({ ok: true });
});

// ---- Project Versions ----

app.get('/api/projects/:uuid/versions', requireAuth, (req, res) => {
  const project = db.projectByUuid(req.params.uuid);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(db.versionsByProject(req.params.uuid));
});

app.post('/api/projects/:uuid/versions', requireAuth, (req, res) => {
  const project = db.projectByUuid(req.params.uuid);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const { video, thumbnail, note } = req.body;
  if (!video) return res.status(400).json({ error: 'Video path required' });
  const version = db.createVersion({ project_uuid: req.params.uuid, video, thumbnail, note });
  res.json(version);
});

app.delete('/api/projects/:uuid/versions/:id', requireAuth, (req, res) => {
  db.deleteVersion(parseInt(req.params.id));
  res.json({ ok: true });
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

// ---- Admin dashboard route ----

app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Catch-all: serve index.html for SPA-style routes ----

app.get('/watch.html', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'watch.html'));
});

app.get('/screening.html', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'screening.html'));
});

app.get('/category/:slug', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'category.html'));
});

// ---- Login page HTML ----

function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — Watch Admin</title>
  <link rel="icon" type="image/png" href="/assets/images/favicon.png">
  <link rel="stylesheet" href="/admin-assets/css/admin.css">
</head>
<body>
  <div class="login-page">
    <div class="login-scanlines"></div>
    <div class="login-vignette"></div>
    <div class="login-box">
      <img src="/assets/images/watch-logo.png" alt="Watch Webbed Films" class="login-logo">
      <p class="login-label">// ADMIN ACCESS</p>
      <form id="login-form">
        <input type="password" id="password" placeholder="Password" autofocus>
        <button type="submit">Enter</button>
      </form>
      <p id="login-error" class="login-error"></p>
    </div>
  </div>
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
    return fs.statSync(fullPath).isFile();
  });

  // Also check for thumbnails directly in THUMB_DIR (not in subdirs)
  const rootThumbs = fs.readdirSync(THUMB_DIR).filter(f => {
    if (f.startsWith('.') || f.startsWith('_candidate_')) return false;
    const fullPath = path.join(THUMB_DIR, f);
    return fs.statSync(fullPath).isFile();
  });

  if (rootFiles.length === 0 && rootThumbs.length === 0) return;

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

  console.log('[Migration] Storage migration complete.');
}

// ---- Start ----

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Watch Admin] Running on port ${PORT}`);
  console.log(`[Watch Admin] VIDEO_DIR: ${VIDEO_DIR}`);
  console.log(`[Watch Admin] DATA_DIR: ${DATA_DIR}`);

  // Cleanup: delete stale uploads that have already been transcoded
  try {
    const uploads = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.'));
    // Collect all transcoded filenames across category subdirs
    const transcodedNames = new Set();
    for (const cat of fs.readdirSync(VIDEOS_DIR)) {
      const catPath = path.join(VIDEOS_DIR, cat);
      if (fs.statSync(catPath).isDirectory()) {
        for (const f of fs.readdirSync(catPath)) {
          if (f.endsWith('.mp4')) transcodedNames.add(path.parse(f).name);
        }
      }
    }
    for (const orig of uploads) {
      const baseName = path.parse(orig).name;
      if (transcodedNames.has(baseName)) {
        fs.unlinkSync(path.join(UPLOADS_DIR, orig));
        console.log(`[Cleanup] Deleted stale upload: ${orig}`);
      }
    }
  } catch (e) {
    console.log(`[Cleanup] Warning: ${e.message}`);
  }

  // Run storage migration if needed (flat → category structure)
  migrateStorage();
});

// Allow large uploads — disable default 2-minute timeout
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
