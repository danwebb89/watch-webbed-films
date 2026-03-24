'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const pipeline = require('../pipeline');

// ---- Setup: temp dirs ----
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
const videoDir = path.join(tmpDir, 'videos');
const thumbDir = path.join(tmpDir, 'thumbs');
const dataDir = path.join(tmpDir, 'data');
const publicDir = path.join(tmpDir, 'public');

pipeline.configure({
  videoDir,
  thumbDir,
  dataDir,
  publicDir,
  signingSecret: 'test-secret-key-12345',
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ==== Validation Tests ====

describe('validateFileType', () => {
  it('accepts .mp4 for video category', () => {
    assert.deepStrictEqual(pipeline.validateFileType('test.mp4', 'video'), { valid: true });
  });

  it('accepts .mov for video category', () => {
    assert.deepStrictEqual(pipeline.validateFileType('test.mov', 'video'), { valid: true });
  });

  it('accepts .pdf for document category', () => {
    assert.deepStrictEqual(pipeline.validateFileType('test.pdf', 'document'), { valid: true });
  });

  it('accepts .png for image category', () => {
    assert.deepStrictEqual(pipeline.validateFileType('test.png', 'image'), { valid: true });
  });

  it('accepts .jpg for image category', () => {
    assert.deepStrictEqual(pipeline.validateFileType('photo.jpg', 'image'), { valid: true });
  });

  it('accepts .wav for audio category', () => {
    assert.deepStrictEqual(pipeline.validateFileType('audio.wav', 'audio'), { valid: true });
  });

  it('accepts .ai for design category', () => {
    assert.deepStrictEqual(pipeline.validateFileType('design.ai', 'design'), { valid: true });
  });

  it('rejects .txt for video category', () => {
    const result = pipeline.validateFileType('readme.txt', 'video');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('.txt'));
  });

  it('rejects .exe for any category', () => {
    for (const cat of ['video', 'document', 'image', 'design', 'audio']) {
      const result = pipeline.validateFileType('virus.exe', cat);
      assert.equal(result.valid, false);
    }
  });

  it('rejects .mp4 for document category', () => {
    const result = pipeline.validateFileType('video.mp4', 'document');
    assert.equal(result.valid, false);
  });

  it('rejects unknown category', () => {
    const result = pipeline.validateFileType('test.mp4', 'unknown');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('Unknown category'));
  });
});

describe('validateFileSize', () => {
  it('accepts file under size limit', () => {
    assert.deepStrictEqual(pipeline.validateFileSize(1024, 'video'), { valid: true });
  });

  it('rejects file over size limit', () => {
    const result = pipeline.validateFileSize(6 * 1024 * 1024 * 1024, 'video'); // 6GB > 5GB limit
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('Maximum'));
  });

  it('accepts unknown category (no rule)', () => {
    assert.deepStrictEqual(pipeline.validateFileSize(999999999, 'unknown'), { valid: true });
  });

  it('rejects image over 50MB', () => {
    const result = pipeline.validateFileSize(51 * 1024 * 1024, 'image');
    assert.equal(result.valid, false);
  });
});

describe('isValidLinkUrl', () => {
  it('rejects javascript: URL', () => {
    assert.equal(pipeline.isValidLinkUrl('javascript:alert(1)'), false);
  });

  it('rejects data: URL', () => {
    assert.equal(pipeline.isValidLinkUrl('data:text/html,<h1>hi</h1>'), false);
  });

  it('accepts https: URL', () => {
    assert.equal(pipeline.isValidLinkUrl('https://example.com'), true);
  });

  it('accepts http: URL', () => {
    assert.equal(pipeline.isValidLinkUrl('http://example.com'), true);
  });

  it('accepts mailto: URL', () => {
    assert.equal(pipeline.isValidLinkUrl('mailto:test@example.com'), true);
  });

  it('rejects ftp: URL', () => {
    assert.equal(pipeline.isValidLinkUrl('ftp://files.example.com'), false);
  });

  it('rejects invalid URL', () => {
    assert.equal(pipeline.isValidLinkUrl('not a url'), false);
  });
});

// ==== Signed URL Tests ====

describe('signUrl / verifySignature', () => {
  it('generates a signed URL with sig and exp parameters', () => {
    const result = pipeline.signUrl('/test/path');
    assert.ok(result.includes('sig='));
    assert.ok(result.includes('exp='));
    assert.ok(result.startsWith('/test/path?'));
  });

  it('verifies a valid signed URL', () => {
    const signed = pipeline.signUrl('/test/path');
    const url = new URL('http://localhost' + signed);
    const sig = url.searchParams.get('sig');
    const exp = url.searchParams.get('exp');
    assert.equal(pipeline.verifySignature('/test/path', sig, exp), true);
  });

  it('rejects a tampered signature', () => {
    const signed = pipeline.signUrl('/test/path');
    const url = new URL('http://localhost' + signed);
    const exp = url.searchParams.get('exp');
    assert.equal(pipeline.verifySignature('/test/path', 'tampered_sig_value_0000000000000000000000000000000000000000000000000000000000000000', exp), false);
  });

  it('rejects an expired URL', () => {
    // Create a URL that expired 1 second ago
    const exp = Math.floor(Date.now() / 1000) - 1;
    const sig = crypto.createHmac('sha256', 'test-secret-key-12345')
      .update(`/test/path:${exp}`).digest('hex');
    assert.equal(pipeline.verifySignature('/test/path', sig, String(exp)), false);
  });

  it('rejects a URL with no signature', () => {
    assert.equal(pipeline.verifySignature('/test/path', null, null), false);
  });

  it('uses ? separator for paths without query params', () => {
    const result = pipeline.signUrl('/clean/path');
    assert.ok(result.includes('?sig='));
  });

  it('uses & separator for paths with existing query params', () => {
    const result = pipeline.signUrl('/path?existing=param');
    assert.ok(result.includes('&sig='));
  });
});

// ==== Config / Category Tests ====

describe('categorySlug', () => {
  it('maps known categories correctly', () => {
    assert.equal(pipeline.config.categorySlug('Brand Film'), 'brand-film');
    assert.equal(pipeline.config.categorySlug('Charity'), 'charity');
    assert.equal(pipeline.config.categorySlug('Documentary'), 'documentary');
    assert.equal(pipeline.config.categorySlug('External Communications'), 'external-communications');
  });

  it('returns uncategorised for null/empty', () => {
    assert.equal(pipeline.config.categorySlug(null), 'uncategorised');
    assert.equal(pipeline.config.categorySlug(''), 'uncategorised');
  });

  it('slugifies unknown categories', () => {
    assert.equal(pipeline.config.categorySlug('My Custom Category'), 'my-custom-category');
  });
});

// ==== MIME Type Tests ====

describe('resolveMimeType', () => {
  it('resolves .mp4 to video/mp4', () => {
    assert.equal(pipeline.resolveMimeType('.mp4'), 'video/mp4');
  });

  it('resolves .pdf to application/pdf', () => {
    assert.equal(pipeline.resolveMimeType('.pdf'), 'application/pdf');
  });

  it('resolves .png to image/png', () => {
    assert.equal(pipeline.resolveMimeType('.png'), 'image/png');
  });

  it('returns stored mime_type when provided', () => {
    assert.equal(pipeline.resolveMimeType('.mp4', 'custom/type'), 'custom/type');
  });

  it('falls back to application/octet-stream for unknown', () => {
    assert.equal(pipeline.resolveMimeType('.xyz'), 'application/octet-stream');
  });
});

// ==== Path Tests ====

describe('resolveDiskPath', () => {
  it('resolves /assets/clients/ path', () => {
    const result = pipeline.resolveDiskPath('/assets/clients/test-client/file.mp4');
    assert.ok(result.includes('clients'));
    assert.ok(result.endsWith('test-client/file.mp4'));
  });

  it('resolves /assets/videos/ path', () => {
    const result = pipeline.resolveDiskPath('/assets/videos/brand-film/test.mp4');
    assert.ok(result.includes('videos'));
    assert.ok(result.endsWith('brand-film/test.mp4'));
  });

  it('returns null for null input', () => {
    assert.equal(pipeline.resolveDiskPath(null), null);
  });
});

describe('resolveFilmFiles', () => {
  it('returns original paths when category matches', () => {
    const result = pipeline.resolveFilmFiles(
      '/assets/videos/brand-film/test.mp4',
      '/assets/thumbs/brand-film/test_thumb.jpg',
      'Brand Film'
    );
    assert.equal(result.video, '/assets/videos/brand-film/test.mp4');
    assert.equal(result.thumbnail, '/assets/thumbs/brand-film/test_thumb.jpg');
  });

  it('updates paths when category changes', () => {
    // Create source files
    const srcVideoDir = path.join(videoDir, 'videos', 'uncategorised');
    const srcThumbDir = path.join(thumbDir, 'uncategorised');
    fs.mkdirSync(srcVideoDir, { recursive: true });
    fs.mkdirSync(srcThumbDir, { recursive: true });
    fs.writeFileSync(path.join(srcVideoDir, 'move-test.mp4'), 'fake-video');
    fs.writeFileSync(path.join(srcThumbDir, 'move-test_thumb.jpg'), 'fake-thumb');

    const result = pipeline.resolveFilmFiles(
      '/assets/videos/uncategorised/move-test.mp4',
      '/assets/thumbs/uncategorised/move-test_thumb.jpg',
      'Charity'
    );

    assert.equal(result.video, '/assets/videos/charity/move-test.mp4');
    assert.equal(result.thumbnail, '/assets/thumbs/charity/move-test_thumb.jpg');

    // Verify files moved
    assert.ok(fs.existsSync(path.join(videoDir, 'videos', 'charity', 'move-test.mp4')));
    assert.ok(fs.existsSync(path.join(thumbDir, 'charity', 'move-test_thumb.jpg')));
  });
});

describe('cleanupThumbOptions', () => {
  it('removes option files for a thumbnail', () => {
    const catDir = path.join(thumbDir, 'test-cleanup');
    fs.mkdirSync(catDir, { recursive: true });
    fs.writeFileSync(path.join(catDir, 'test_thumb.jpg'), 'main');
    fs.writeFileSync(path.join(catDir, 'test_thumb_opt_0.jpg'), 'opt0');
    fs.writeFileSync(path.join(catDir, 'test_thumb_opt_1.jpg'), 'opt1');

    pipeline.cleanupThumbOptions('/assets/thumbs/test-cleanup/test_thumb.jpg');

    assert.ok(fs.existsSync(path.join(catDir, 'test_thumb.jpg'))); // main kept
    assert.ok(!fs.existsSync(path.join(catDir, 'test_thumb_opt_0.jpg'))); // opts removed
    assert.ok(!fs.existsSync(path.join(catDir, 'test_thumb_opt_1.jpg')));
  });

  it('handles null thumbnail gracefully', () => {
    pipeline.cleanupThumbOptions(null); // should not throw
  });
});

// ==== Upload Tests ====

describe('assembleFile', () => {
  it('assembles chunks into single file', async () => {
    const uploadId = 'test-assembly-' + Date.now();
    const chunksDir = pipeline.config.CHUNKS_DIR;

    // Create fake chunks
    const chunk0 = Buffer.from('Hello ');
    const chunk1 = Buffer.from('World!');
    fs.writeFileSync(path.join(chunksDir, `${uploadId}_chunk_000000`), chunk0);
    fs.writeFileSync(path.join(chunksDir, `${uploadId}_chunk_000001`), chunk1);

    const result = await pipeline.assembleFile(uploadId, 'test-output.txt');

    assert.ok(!result.error);
    assert.equal(result.filename, 'test-output.txt');
    assert.equal(result.fileSize, 12); // "Hello World!" = 12 bytes

    // Verify assembled file content
    const content = fs.readFileSync(result.assembledPath, 'utf8');
    assert.equal(content, 'Hello World!');

    // Verify chunks cleaned up
    assert.ok(!fs.existsSync(path.join(chunksDir, `${uploadId}_chunk_000000`)));
    assert.ok(!fs.existsSync(path.join(chunksDir, `${uploadId}_chunk_000001`)));
  });

  it('returns error for missing chunks', async () => {
    const result = await pipeline.assembleFile('nonexistent-upload-id', 'test.txt');
    assert.ok(result.error);
    assert.ok(result.error.includes('No chunks found'));
  });
});

// ==== Download Tests ====

describe('serveDownload', () => {
  it('returns 404 for non-existent file', () => {
    let statusCode = null;
    let jsonBody = null;
    const mockRes = {
      status: (code) => { statusCode = code; return mockRes; },
      json: (body) => { jsonBody = body; },
      writeHead: () => {},
      end: () => {},
    };
    const mockReq = { headers: {} };

    pipeline.serveDownload('/nonexistent/path.mp4', 'test.mp4', 'video/mp4', mockReq, mockRes);
    assert.equal(statusCode, 404);
    assert.ok(jsonBody.error.includes('not found'));
  });

  it('sets correct headers for existing file', async () => {
    const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-test-'));
    const testFile = path.join(dlDir, 'download-test.txt');
    fs.writeFileSync(testFile, 'test content here');

    let headersWritten = null;
    let statusCodeWritten = null;
    const mockReq = { headers: {} };
    const { Writable } = require('stream');
    const mockRes = new Writable({ write(chunk, enc, cb) { cb(); } });
    mockRes.writeHead = (code, headers) => { statusCodeWritten = code; headersWritten = headers; };
    mockRes.status = (code) => { statusCodeWritten = code; return mockRes; };
    mockRes.json = () => {};

    pipeline.serveDownload(testFile, 'download-test.txt', 'text/plain', mockReq, mockRes);

    // Wait for stream to finish before asserting
    await new Promise(r => setTimeout(r, 50));

    assert.equal(statusCodeWritten, 200);
    assert.equal(headersWritten['Content-Type'], 'text/plain');
    assert.equal(headersWritten['Content-Length'], 17);
    assert.equal(headersWritten['Accept-Ranges'], 'bytes');
    assert.ok(headersWritten['Content-Disposition'].includes('download-test.txt'));
    fs.rmSync(dlDir, { recursive: true, force: true });
  });

  it('handles range request with 206 response', async () => {
    const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-test-'));
    const testFile = path.join(dlDir, 'range-test.txt');
    fs.writeFileSync(testFile, '0123456789'); // 10 bytes

    let statusCodeWritten = null;
    let headersWritten = null;
    const mockReq = { headers: { range: 'bytes=0-4' } };
    const { Writable } = require('stream');
    const mockRes = new Writable({ write(chunk, enc, cb) { cb(); } });
    mockRes.writeHead = (code, headers) => { statusCodeWritten = code; headersWritten = headers; };
    mockRes.status = (code) => { statusCodeWritten = code; return mockRes; };
    mockRes.json = () => {};

    pipeline.serveDownload(testFile, 'range-test.txt', 'text/plain', mockReq, mockRes);

    await new Promise(r => setTimeout(r, 50));

    assert.equal(statusCodeWritten, 206);
    assert.equal(headersWritten['Content-Length'], 5);
    assert.equal(headersWritten['Content-Range'], 'bytes 0-4/10');
    fs.rmSync(dlDir, { recursive: true, force: true });
  });

  it('returns 416 for out-of-bounds range', () => {
    const testFile = path.join(tmpDir, 'oob-test.txt');
    fs.writeFileSync(testFile, '0123456789'); // 10 bytes

    let statusCodeWritten = null;
    let headersWritten = null;
    const mockReq = { headers: { range: 'bytes=20-30' } };
    const mockRes = {
      writeHead: (code, headers) => {
        statusCodeWritten = code;
        headersWritten = headers;
      },
      end: () => {},
      status: () => mockRes,
      json: () => {},
    };

    pipeline.serveDownload(testFile, 'oob-test.txt', 'text/plain', mockReq, mockRes);

    assert.equal(statusCodeWritten, 416);
  });
});

// ==== Transcode Job State Tests ====

describe('transcode job management', () => {
  it('creates and retrieves a job', () => {
    const jobId = 'test-job-' + Date.now();
    pipeline.createJob(jobId, { status: 'queued', progress: 0 });
    const job = pipeline.getJob(jobId);
    assert.ok(job);
    assert.equal(job.status, 'queued');
  });

  it('lists all jobs', () => {
    const jobs = pipeline.getAllJobs();
    assert.ok(Array.isArray(jobs));
    assert.ok(jobs.length > 0); // at least the one we just created
  });

  it('generates unique job IDs', () => {
    const id1 = pipeline.generateJobId();
    const id2 = pipeline.generateJobId();
    assert.notEqual(id1, id2);
    assert.equal(id1.length, 16); // 8 bytes hex = 16 chars
  });
});

// ==== Config Tests ====

describe('pipeline.configure', () => {
  it('creates required directories', () => {
    assert.ok(fs.existsSync(pipeline.config.VIDEOS_DIR));
    assert.ok(fs.existsSync(pipeline.config.STAGING_DIR));
    assert.ok(fs.existsSync(pipeline.config.UPLOADS_DIR));
    assert.ok(fs.existsSync(pipeline.config.CHUNKS_DIR));
    assert.ok(fs.existsSync(pipeline.config.PENDING_DIR));
    assert.ok(fs.existsSync(pipeline.config.CLIENTS_DIR));
  });

  it('creates category subdirectories', () => {
    assert.ok(fs.existsSync(path.join(pipeline.config.VIDEOS_DIR, 'brand-film')));
    assert.ok(fs.existsSync(path.join(pipeline.config.VIDEOS_DIR, 'charity')));
    assert.ok(fs.existsSync(path.join(pipeline.config.VIDEOS_DIR, 'uncategorised')));
  });
});

console.log('All pipeline tests loaded. Running...');
