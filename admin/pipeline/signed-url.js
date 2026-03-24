'use strict';

const crypto = require('crypto');
const config = require('./config');

function signUrl(urlPath, expiresInSeconds = 14400) { // 4 hours
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const sig = crypto.createHmac('sha256', config.SIGNING_SECRET)
    .update(`${urlPath}:${exp}`).digest('hex');
  const separator = urlPath.includes('?') ? '&' : '?';
  return `${urlPath}${separator}sig=${sig}&exp=${exp}`;
}

function verifySignature(urlPath, sig, exp) {
  if (!sig || !exp) return false;
  if (Math.floor(Date.now() / 1000) > parseInt(exp)) return false;
  const expected = crypto.createHmac('sha256', config.SIGNING_SECRET)
    .update(`${urlPath}:${exp}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}

module.exports = { signUrl, verifySignature };
