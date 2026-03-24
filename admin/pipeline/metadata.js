'use strict';

const { spawn } = require('child_process');

function probeEnabled() {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-version']);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

function probeFor(filePath) {
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

function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath
    ]);
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        const info = JSON.parse(stdout);
        const videoStream = info.streams && info.streams.find(s => s.codec_type === 'video');
        const format = info.format || {};
        resolve({
          width: videoStream ? videoStream.width : null,
          height: videoStream ? videoStream.height : null,
          duration: format.duration ? parseFloat(format.duration) : null,
          file_size: format.size ? parseInt(format.size) : null,
        });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

function getImageDimensions(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', filePath
    ]);
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        const info = JSON.parse(stdout);
        const stream = info.streams && info.streams[0];
        resolve({ width: stream ? stream.width : null, height: stream ? stream.height : null });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

// Probe average brightness of an image (0-255) using ffmpeg signalstats
function probeFrameBrightness(imagePath) {
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
      const match = stderr.match(/YAVG:(\d+\.?\d*)/);
      resolve(match ? parseFloat(match[1]) : 128);
    });
    proc.on('error', () => resolve(128));
  });
}

// Detect black bars (letterboxing/pillarboxing) and return a crop filter string
function detectCrop(videoPath, duration) {
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
      const matches = [...stderr.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)];
      if (matches.length === 0) return resolve(null);
      const lastCrop = matches[matches.length - 1][1];
      const [w, h] = lastCrop.split(':').map(Number);
      if (w > 0 && h > 0) {
        return resolve(`crop=${lastCrop}`);
      }
      resolve(null);
    });
    proc.on('error', () => resolve(null));
  });
}

module.exports = {
  probeEnabled,
  probeFor,
  getVideoMetadata,
  getImageDimensions,
  probeFrameBrightness,
  detectCrop,
};
