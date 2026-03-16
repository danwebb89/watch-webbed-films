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
const ORIGINALS_DIR = path.join(VIDEO_DIR, 'originals');
const CHUNKS_DIR = path.join(VIDEO_DIR, 'chunks');
// Ensure directories exist
[VIDEO_DIR, THUMB_DIR, DATA_DIR, ORIGINALS_DIR, CHUNKS_DIR].forEach(dir => {
  fs.mkdirSync(dir, { recursive: true });
});

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

      // Delete the original from originals/
      try {
        if (fs.existsSync(inputPath) && inputPath.includes('originals')) {
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
          const videoPath = `/assets/videos/${job.output}`;
          const thumbnail = job.thumbnail || '';
          if (!db.filmBySlug(pending.slug)) {
            db.createFilm({
              slug: pending.slug,
              title: pending.title,
              category: pending.category || '',
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

async function generateThumbnail(videoPath, thumbName) {
  const duration = await probeFor(videoPath);
  const outputPath = path.join(THUMB_DIR, thumbName);

  // Generate 10 candidates at different points and pick the best one
  const percentages = [0.08, 0.16, 0.24, 0.32, 0.40, 0.50, 0.58, 0.66, 0.76, 0.88];
  const candidates = [];

  for (let i = 0; i < percentages.length; i++) {
    const seekTo = duration > 0 ? Math.max(1, Math.floor(duration * percentages[i])) : 2;
    const candidatePath = path.join(THUMB_DIR, `_candidate_${i}_${thumbName}`);

    const ok = await new Promise((resolve) => {
      const proc = spawn('ffmpeg', [
        '-ss', String(seekTo),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        '-y',
        candidatePath
      ]);
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
    const optPath = path.join(THUMB_DIR, optName);
    fs.renameSync(c.path, optPath);
    candidatePaths.push(`/assets/thumbs/${optName}`);
  }

  console.log(`[Thumbnail] Generated: ${thumbName} + ${candidatePaths.length} options (best at ${Math.round(best.pct * 100)}%, brightness=${best.brightness.toFixed(0)}, score=${best.score.toFixed(2)})`);
  return { selected: `/assets/thumbs/${thumbName}`, options: candidatePaths };
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

// Serve videos and thumbs (with caching)
app.use('/assets/videos', express.static(VIDEO_DIR, {
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
    destination: (req, file, cb) => cb(null, ORIGINALS_DIR),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, safe);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50GB
});

const thumbUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, THUMB_DIR),
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

  const originalPath = path.join(ORIGINALS_DIR, req.file.filename);
  const baseName = path.parse(req.file.filename).name;
  const outputName = baseName + '.mp4';
  const outputPath = path.join(VIDEO_DIR, outputName);

  // If already an mp4, check if it needs transcoding
  const jobId = crypto.randomBytes(8).toString('hex');
  transcodeJobs.set(jobId, {
    status: 'queued',
    progress: 0,
    input: req.file.filename,
    output: outputName,
    error: null
  });

  // Start transcode in background
  transcodeVideo(jobId, originalPath, outputPath);

  res.json({
    filename: outputName,
    path: `/assets/videos/${outputName}`,
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
    // Assemble into originals dir
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const assembledPath = path.join(ORIGINALS_DIR, safe);
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
    const outputPath = path.join(VIDEO_DIR, outputName);

    const jobId = crypto.randomBytes(8).toString('hex');
    transcodeJobs.set(jobId, {
      status: 'queued',
      progress: 0,
      input: safe,
      output: outputName,
      error: null
    });

    transcodeVideo(jobId, assembledPath, outputPath);

    res.json({
      filename: outputName,
      path: `/assets/videos/${outputName}`,
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
  res.json({ filename: req.file.filename, path: `/assets/thumbs/${req.file.filename}` });
});

// List uploaded files (only transcoded mp4s, not the originals folder)
app.get('/api/files/videos', requireAuth, (req, res) => {
  const files = fs.readdirSync(VIDEO_DIR).filter(f => {
    if (f.startsWith('.') || f === 'originals' || f === 'chunks') return false;
    return fs.statSync(path.join(VIDEO_DIR, f)).isFile();
  });
  res.json(files.map(f => ({
    name: f,
    path: `/assets/videos/${f}`,
    size: fs.statSync(path.join(VIDEO_DIR, f)).size
  })));
});

// List thumbnail options for a given video filename base
app.get('/api/files/thumb-options/:videoBase', requireAuth, (req, res) => {
  const base = req.params.videoBase.replace(/\.[^.]+$/, '') + '_thumb';
  const files = fs.readdirSync(THUMB_DIR).filter(f => f.startsWith(base + '_opt_'));
  const options = files.sort().map(f => `/assets/thumbs/${f}`);
  res.json(options);
});

app.get('/api/files/thumbs', requireAuth, (req, res) => {
  const files = fs.readdirSync(THUMB_DIR).filter(f => !f.startsWith('.'));
  res.json(files.map(f => ({
    name: f,
    path: `/assets/thumbs/${f}`,
    size: fs.statSync(path.join(THUMB_DIR, f)).size
  })));
});

// ---- Films CRUD ----

app.get('/api/films', requireAuth, (req, res) => {
  res.json(db.allFilms());
});

app.post('/api/films', requireAuth, (req, res) => {
  const { title, slug, category, year, description, thumbnail, video, eligible_for_featured, visibility } = req.body;
  const isPublic = req.body.public !== undefined ? req.body.public : true;
  if (!title || !slug) return res.status(400).json({ error: 'Title and slug required' });
  if (db.filmBySlug(slug)) return res.status(409).json({ error: 'Slug already exists' });

  const film = db.createFilm({ slug, title, category, year: parseInt(year) || new Date().getFullYear(), description, thumbnail, video, public: isPublic, visibility, eligible_for_featured });
  res.json(film);
});

// Regenerate thumbnail options for an existing film
app.post('/api/films/:slug/regenerate-thumbs', requireAuth, async (req, res) => {
  const film = db.filmBySlug(req.params.slug);
  if (!film) return res.status(404).json({ error: 'Not found' });
  if (!film.video) return res.status(400).json({ error: 'No video path' });

  const videoFile = path.basename(film.video);
  const videoPath = path.join(VIDEO_DIR, videoFile);
  if (!fs.existsSync(videoPath)) return res.status(400).json({ error: 'Video file not found on disk' });

  const thumbName = path.parse(videoFile).name + '_thumb.jpg';
  const result = await generateThumbnail(videoPath, thumbName);

  if (result && typeof result === 'object') {
    // Update film thumbnail to the best pick
    db.updateFilm(req.params.slug, { thumbnail: result.selected });
    res.json({ thumbnail: result.selected, options: result.options });
  } else {
    res.status(500).json({ error: 'Failed to generate thumbnails' });
  }
});

app.put('/api/films/:slug', requireAuth, (req, res) => {
  const film = db.updateFilm(req.params.slug, req.body);
  if (!film) return res.status(404).json({ error: 'Not found' });
  res.json(film);
});

app.delete('/api/films/:slug', requireAuth, (req, res) => {
  db.deleteFilm(req.params.slug);
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

// ---- Start ----

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Watch Admin] Running on port ${PORT}`);
  console.log(`[Watch Admin] VIDEO_DIR: ${VIDEO_DIR}`);
  console.log(`[Watch Admin] DATA_DIR: ${DATA_DIR}`);

  // Cleanup: delete originals that have a matching transcoded file
  try {
    const originals = fs.readdirSync(ORIGINALS_DIR).filter(f => !f.startsWith('.'));
    const transcoded = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.mp4') && !f.startsWith('.'));
    for (const orig of originals) {
      const baseName = path.parse(orig).name + '.mp4';
      if (transcoded.includes(baseName)) {
        fs.unlinkSync(path.join(ORIGINALS_DIR, orig));
        console.log(`[Cleanup] Deleted stale original: ${orig}`);
      }
    }
  } catch (e) {
    console.log(`[Cleanup] Warning: ${e.message}`);
  }
});

// Allow large uploads — disable default 2-minute timeout
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
