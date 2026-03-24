'use strict';

const path = require('path');
const config = require('./config');

function validateFileType(filename, category) {
  const ext = path.extname(filename).toLowerCase();
  const rule = config.FILE_TYPE_RULES[category];
  if (!rule) return { valid: false, error: `Unknown category: ${category}` };
  if (!rule.exts.includes(ext)) {
    return { valid: false, error: `File type ${ext} is not accepted for ${category}. Allowed: ${rule.exts.join(', ')}` };
  }
  return { valid: true };
}

function validateFileSize(sizeBytes, category) {
  const rule = config.FILE_TYPE_RULES[category];
  if (!rule) return { valid: true };
  if (sizeBytes > rule.maxBytes) {
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(1);
    const maxMB = (rule.maxBytes / 1024 / 1024).toFixed(0);
    return { valid: false, error: `File is ${sizeMB} MB. Maximum for ${category} is ${maxMB} MB.` };
  }
  return { valid: true };
}

function isValidLinkUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

module.exports = { validateFileType, validateFileSize, isValidLinkUrl };
