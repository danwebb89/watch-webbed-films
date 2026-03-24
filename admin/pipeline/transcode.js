'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('./config');
const { probeEnabled, probeFor, getVideoMetadata } = require('./metadata');
const { generateVideoThumbnail } = require('./thumbnail');
const { resolveFilmFiles } = require('./paths');

// ---- Transcode job state ----
const transcodeJobs = new Map(); // id -> { status, progress, input, output, error, ... }

function getJob(jobId) {
  return transcodeJobs.get(jobId);
}

function getAllJobs() {
  const jobs = [];
  for (const [id, job] of transcodeJobs) {
    jobs.push({ id, ...job });
  }
  return jobs;
}

function createJob(jobId, jobData) {
  transcodeJobs.set(jobId, jobData);
}

function generateJobId() {
  return crypto.randomBytes(8).toString('hex');
}

async function transcodeVideo(jobId, inputPath, outputPath, db) {
  const job = transcodeJobs.get(jobId);
  job.status = 'probing';
  db.updateTranscodeJob(jobId, { status: 'probing' });

  const duration = await probeEnabled() ? await probeFor(inputPath) : 0;

  job.status = 'transcoding';
  job.duration = duration;
  db.updateTranscodeJob(jobId, { status: 'transcoding', duration });

  // Intel QuickSync HEVC hardware encoding (i7-10700K)
  const args = [
    '-hwaccel', 'qsv',
    '-i', inputPath,
    '-vf', 'format=nv12,hwupload=extra_hw_frames=64',
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

  // Throttle DB progress updates (every 5%)
  let lastDbProgress = 0;

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('out_time_us=')) {
        const us = parseInt(line.split('=')[1]);
        if (duration > 0 && us > 0) {
          job.progress = Math.min(99, Math.round((us / 1000000 / duration) * 100));
          if (job.progress - lastDbProgress >= 5) {
            lastDbProgress = job.progress;
            db.updateTranscodeJob(jobId, { progress: job.progress });
          }
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
      db.updateTranscodeJob(jobId, { status: 'generating_thumbnail', progress: 100 });
      console.log(`[Transcode] Complete: ${path.basename(outputPath)}`);

      // Auto-generate thumbnails (10 options + best pick)
      const thumbName = path.parse(path.basename(outputPath)).name + '_thumb.jpg';
      const thumbResult = await generateVideoThumbnail(outputPath, thumbName);
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
      const pendingFile = path.join(config.PENDING_DIR, jobId + '.json');
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
      db.updateTranscodeJob(jobId, { status: 'done', thumbnail: job.thumbnail, thumbnailOptions: job.thumbnailOptions || [] });

      // Extract and store video metadata
      try {
        const meta = await getVideoMetadata(outputPath);
        job.metadata = meta;
        db.updateTranscodeJob(jobId, { duration: meta.duration });
        console.log(`[Transcode] Metadata: ${meta.width}x${meta.height}, ${meta.duration?.toFixed(1)}s, ${(meta.file_size / 1024 / 1024).toFixed(1)}MB`);
      } catch (e) {
        console.log(`[Transcode] Metadata extraction warning: ${e.message}`);
      }
    } else {
      job.status = 'error';
      job.error = `ffmpeg exited with code ${code}`;
      db.updateTranscodeJob(jobId, { status: 'error', error: job.error });
      console.log(`[Transcode] Failed: ${path.basename(inputPath)} — code ${code}`);

      // Clean up partial output file
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log(`[Transcode] Cleaned up partial output: ${path.basename(outputPath)}`);
        }
      } catch (e) { console.error(`[Transcode] Cleanup error: ${e.message}`); }
    }
  });

  proc.on('error', (err) => {
    job.status = 'error';
    job.error = err.message;
    db.updateTranscodeJob(jobId, { status: 'error', error: err.message });

    // Clean up partial output file on spawn error
    try {
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    } catch {}
  });
}

module.exports = {
  transcodeJobs,
  getJob,
  getAllJobs,
  createJob,
  generateJobId,
  transcodeVideo,
};
