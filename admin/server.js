const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const { spawn } = require('child_process');

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

  const args = [
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-profile:v', 'high',
    '-level', '4.1',
    '-pix_fmt', 'yuv420p',
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

      // Auto-generate thumbnail
      const thumbName = path.parse(path.basename(outputPath)).name + '_thumb.jpg';
      const thumbPath = await generateThumbnail(outputPath, thumbName);
      job.thumbnail = thumbPath;
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
  return new Promise(async (resolve) => {
    // Get duration to grab frame at 25%
    const duration = await probeFor(videoPath);
    const seekTo = duration > 0 ? Math.max(1, Math.floor(duration * 0.25)) : 2;
    const outputPath = path.join(THUMB_DIR, thumbName);

    const args = [
      '-ss', String(seekTo),
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      outputPath
    ];

    const proc = spawn('ffmpeg', args);
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[Thumbnail] Generated: ${thumbName}`);
        resolve(`/assets/thumbs/${thumbName}`);
      } else {
        console.log(`[Thumbnail] Failed for ${thumbName} (code ${code})`);
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
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

// Ensure JSON files exist
const filmsPath = path.join(DATA_DIR, 'films.json');
const projectsPath = path.join(DATA_DIR, 'projects.json');
if (!fs.existsSync(filmsPath)) fs.writeFileSync(filmsPath, '[]');
if (!fs.existsSync(projectsPath)) fs.writeFileSync(projectsPath, '[]');

app.use(express.json());
app.use(cookieParser());

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

app.post('/api/login', (req, res) => {
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

// Serve public site
app.use(express.static(PUBLIC_DIR));

// Serve data dir as /data (for the public site to fetch JSON)
app.use('/data', express.static(DATA_DIR));

// Serve videos and thumbs
app.use('/assets/videos', express.static(VIDEO_DIR));
app.use('/assets/thumbs', express.static(THUMB_DIR));

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
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB per chunk
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
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
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
    if (f.startsWith('.') || f === 'originals') return false;
    return fs.statSync(path.join(VIDEO_DIR, f)).isFile();
  });
  res.json(files.map(f => ({
    name: f,
    path: `/assets/videos/${f}`,
    size: fs.statSync(path.join(VIDEO_DIR, f)).size
  })));
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

function readFilms() {
  return JSON.parse(fs.readFileSync(filmsPath, 'utf-8'));
}

function writeFilms(data) {
  fs.writeFileSync(filmsPath, JSON.stringify(data, null, 2));
}

app.get('/api/films', requireAuth, (req, res) => {
  res.json(readFilms());
});

app.post('/api/films', requireAuth, (req, res) => {
  const films = readFilms();
  const { title, slug, category, year, description, thumbnail, video } = req.body;
  if (!title || !slug) return res.status(400).json({ error: 'Title and slug required' });
  if (films.find(f => f.slug === slug)) return res.status(409).json({ error: 'Slug already exists' });

  const film = {
    slug,
    title,
    category: category || '',
    year: parseInt(year) || new Date().getFullYear(),
    description: description || '',
    thumbnail: thumbnail || '',
    video: video || '',
    public: true
  };

  films.push(film);
  writeFilms(films);
  res.json(film);
});

app.put('/api/films/:slug', requireAuth, (req, res) => {
  const films = readFilms();
  const idx = films.findIndex(f => f.slug === req.params.slug);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  Object.assign(films[idx], req.body);
  writeFilms(films);
  res.json(films[idx]);
});

app.delete('/api/films/:slug', requireAuth, (req, res) => {
  let films = readFilms();
  films = films.filter(f => f.slug !== req.params.slug);
  writeFilms(films);
  res.json({ ok: true });
});

// ---- Projects CRUD ----

function readProjects() {
  return JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));
}

function writeProjects(data) {
  fs.writeFileSync(projectsPath, JSON.stringify(data, null, 2));
}

app.get('/api/projects', requireAuth, (req, res) => {
  res.json(readProjects());
});

app.post('/api/projects', requireAuth, (req, res) => {
  const projects = readProjects();
  const { title, video } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const project = {
    uuid: uuidv4().split('-')[0],
    title,
    video: video || '',
    active: true,
    created: new Date().toISOString().split('T')[0]
  };

  projects.push(project);
  writeProjects(projects);
  res.json(project);
});

app.put('/api/projects/:uuid', requireAuth, (req, res) => {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.uuid === req.params.uuid);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  Object.assign(projects[idx], req.body);
  writeProjects(projects);
  res.json(projects[idx]);
});

app.delete('/api/projects/:uuid', requireAuth, (req, res) => {
  let projects = readProjects();
  projects = projects.filter(p => p.uuid !== req.params.uuid);
  writeProjects(projects);
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

// ---- Login page HTML ----

function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — Watch Admin</title>
  <link rel="stylesheet" href="/admin-assets/css/admin.css">
</head>
<body>
  <div class="login-page">
    <div class="login-box">
      <div class="wordmark">WEBBED<span class="accent">FILMS</span></div>
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
});

// Allow large uploads — disable default 2-minute timeout
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
