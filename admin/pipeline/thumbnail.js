'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const config = require('./config');
const { probeFor, detectCrop, probeFrameBrightness } = require('./metadata');

function generateImageThumbnail(srcPath, destPath, maxWidth = 400) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', srcPath, '-vf', `scale=${maxWidth}:-1`, '-q:v', '4', '-y', destPath
    ]);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    proc.on('error', reject);
  });
}

function generatePdfThumbnail(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', srcPath, '-vf', 'scale=400:-1', '-frames:v', '1', '-q:v', '4', '-y', destPath
    ]);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg PDF thumb exited ${code}`)));
    proc.on('error', reject);
  });
}

async function generateVideoThumbnail(videoPath, thumbName, thumbSubdir = 'uncategorised') {
  const duration = await probeFor(videoPath);
  const thumbDir = path.join(config.THUMB_DIR, thumbSubdir);
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
    const brightTarget = 110;
    const brightDist = Math.abs(c.brightness - brightTarget);
    c.brightScore = Math.max(0, 1 - brightDist / 128);
    c.sizeNorm = c.size;
  }
  const maxSize = Math.max(...candidates.map(c => c.sizeNorm));
  for (const c of candidates) {
    c.sizeScore = maxSize > 0 ? c.sizeNorm / maxSize : 0;
    c.score = c.brightScore * 0.6 + c.sizeScore * 0.4;
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Keep the best as the default thumbnail
  fs.copyFileSync(best.path, outputPath);

  // Rename candidates to persistent names (thumb_opt_0.jpg ... thumb_opt_N.jpg)
  const baseName = path.parse(thumbName).name;
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

module.exports = {
  generateImageThumbnail,
  generatePdfThumbnail,
  generateVideoThumbnail,
};
