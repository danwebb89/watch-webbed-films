'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const transcode = require('./transcode');

function handleChunkUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No chunk' });
  if (req.file.size === 0) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'Empty file. Upload a file with content.' });
  }
  const { uploadId, chunkIndex, totalChunks } = req.body;

  // Rename temp file to proper name now that we have the form fields
  const properName = `${uploadId}_chunk_${chunkIndex.padStart(6, '0')}`;
  const properPath = path.join(config.CHUNKS_DIR, properName);
  fs.renameSync(req.file.path, properPath);

  console.log(`[Upload] Chunk ${parseInt(chunkIndex)+1}/${totalChunks} for ${uploadId}`);
  res.json({ ok: true, chunkIndex: parseInt(chunkIndex) });
}

async function assembleChunks(uploadId) {
  const allFiles = fs.readdirSync(config.CHUNKS_DIR);
  const chunkFiles = allFiles.filter(f => f.startsWith(uploadId + '_chunk_')).sort();
  return chunkFiles;
}

async function assembleAndTranscode(uploadId, filename, db) {
  const chunkFiles = await assembleChunks(uploadId);
  if (chunkFiles.length === 0) return { error: 'No chunks found' };

  // Assemble into staging uploads dir
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const assembledPath = path.join(config.UPLOADS_DIR, safe);
  const writeStream = fs.createWriteStream(assembledPath);

  for (const chunkFile of chunkFiles) {
    const chunkPath = path.join(config.CHUNKS_DIR, chunkFile);
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
    fs.unlinkSync(path.join(config.CHUNKS_DIR, chunkFile));
  }

  console.log(`[Upload] Assembled ${chunkFiles.length} chunks → ${safe} (${(fs.statSync(assembledPath).size / 1024 / 1024).toFixed(1)} MB)`);

  // Start transcode
  const baseName = path.parse(safe).name;
  const outputName = baseName + '.mp4';
  const outputPath = path.join(config.VIDEOS_DIR, 'uncategorised', outputName);

  const jobId = transcode.generateJobId();
  const jobData = {
    status: 'queued',
    progress: 0,
    input: safe,
    output: outputName,
    videoPath: `/assets/videos/uncategorised/${outputName}`,
    error: null
  };
  transcode.createJob(jobId, jobData);
  db.createTranscodeJob(jobId, jobData);

  transcode.transcodeVideo(jobId, assembledPath, outputPath, db);

  return {
    filename: outputName,
    path: `/assets/videos/uncategorised/${outputName}`,
    videoPath: `/assets/videos/uncategorised/${outputName}`,
    transcodeId: jobId,
    original: safe
  };
}

async function assembleFile(uploadId, filename) {
  const chunkFiles = await assembleChunks(uploadId);
  if (chunkFiles.length === 0) return { error: 'No chunks found' };

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const assembledPath = path.join(config.UPLOADS_DIR, safe);
  const writeStream = fs.createWriteStream(assembledPath);

  for (const chunkFile of chunkFiles) {
    const chunkPath = path.join(config.CHUNKS_DIR, chunkFile);
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
    fs.unlinkSync(path.join(config.CHUNKS_DIR, chunkFile));
  }

  const fileSize = fs.statSync(assembledPath).size;
  console.log(`[Upload] Assembled ${chunkFiles.length} chunks → ${safe} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  return { filename: safe, assembledPath, fileSize };
}

// Start transcode for a single uploaded file (non-chunked)
function startTranscode(uploadedFile, db) {
  const originalPath = path.join(config.UPLOADS_DIR, uploadedFile.filename);
  const baseName = path.parse(uploadedFile.filename).name;
  const outputName = baseName + '.mp4';
  const outputPath = path.join(config.VIDEOS_DIR, 'uncategorised', outputName);

  const jobId = transcode.generateJobId();
  const jobData = {
    status: 'queued',
    progress: 0,
    input: uploadedFile.filename,
    output: outputName,
    videoPath: `/assets/videos/uncategorised/${outputName}`,
    error: null
  };
  transcode.createJob(jobId, jobData);
  db.createTranscodeJob(jobId, jobData);

  transcode.transcodeVideo(jobId, originalPath, outputPath, db);

  return {
    filename: outputName,
    path: `/assets/videos/uncategorised/${outputName}`,
    videoPath: `/assets/videos/uncategorised/${outputName}`,
    transcodeId: jobId,
    original: uploadedFile.filename
  };
}

module.exports = {
  handleChunkUpload,
  assembleAndTranscode,
  assembleFile,
  startTranscode,
};
