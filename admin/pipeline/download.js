'use strict';

const path = require('path');
const fs = require('fs');
const config = require('./config');

function serveDownload(diskPath, downloadName, mimeType, req, res) {
  if (!fs.existsSync(diskPath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  const stat = fs.statSync(diskPath);

  // Handle range requests
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10) || 0;
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (isNaN(start) || start >= stat.size || start < 0 || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    });
    fs.createReadStream(diskPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(diskPath).pipe(res);
  }
}

// Resolve a MIME type from extension, with optional stored mime_type override
function resolveMimeType(ext, storedMimeType) {
  if (storedMimeType) return storedMimeType;
  return config.MIME_TYPES[ext] || 'application/octet-stream';
}

module.exports = { serveDownload, resolveMimeType };
