'use strict';

const config = require('./config');
const { signUrl, verifySignature } = require('./signed-url');
const { validateFileType, validateFileSize, isValidLinkUrl } = require('./validate');
const { getVideoMetadata, getImageDimensions, probeEnabled, probeFor } = require('./metadata');
const { generateImageThumbnail, generatePdfThumbnail, generateVideoThumbnail } = require('./thumbnail');
const { resolveFilmFiles, cleanupThumbOptions, relocateClientVersion, resolveDiskPath } = require('./paths');
const transcode = require('./transcode');
const upload = require('./upload');
const { serveDownload, resolveMimeType } = require('./download');
const cleanup = require('./cleanup');

module.exports = {
  // Configuration
  configure: config.configure,
  config,

  // Signed URLs
  signUrl,
  verifySignature,

  // Validation
  validateFileType,
  validateFileSize,
  isValidLinkUrl,

  // Metadata
  getVideoMetadata,
  getImageDimensions,
  probeEnabled,
  probeFor,

  // Thumbnails
  generateImageThumbnail,
  generatePdfThumbnail,
  generateVideoThumbnail,

  // Paths / file management
  resolveFilmFiles,
  cleanupThumbOptions,
  relocateClientVersion,
  resolveDiskPath,

  // Transcode
  transcodeJobs: transcode.transcodeJobs,
  getJob: transcode.getJob,
  getAllJobs: transcode.getAllJobs,
  createJob: transcode.createJob,
  generateJobId: transcode.generateJobId,
  transcodeVideo: transcode.transcodeVideo,

  // Upload
  handleChunkUpload: upload.handleChunkUpload,
  assembleAndTranscode: upload.assembleAndTranscode,
  assembleFile: upload.assembleFile,
  startTranscode: upload.startTranscode,

  // Download
  serveDownload,
  resolveMimeType,

  // Cleanup
  runStartupCleanup: cleanup.runStartupCleanup,
  markOrphanedJobs: cleanup.markOrphanedJobs,
  cleanStaleUploads: cleanup.cleanStaleUploads,
  cleanOrphanedStaging: cleanup.cleanOrphanedStaging,
};
