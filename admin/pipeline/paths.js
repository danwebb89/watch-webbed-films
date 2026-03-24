'use strict';

const path = require('path');
const fs = require('fs');
const config = require('./config');

// Move video + thumbnails from one category folder to another, return updated paths
function resolveFilmFiles(videoPath, thumbnailPath, category) {
  const catSlug = config.categorySlug(category);
  let finalVideo = videoPath;
  let finalThumb = thumbnailPath;

  if (videoPath) {
    const parts = videoPath.replace(/^\/assets\/videos\//, '').split('/');
    if (parts.length === 2) {
      const [currentCat, filename] = parts;
      if (currentCat !== catSlug) {
        const srcPath = path.join(config.VIDEOS_DIR, currentCat, filename);
        const destDir = path.join(config.VIDEOS_DIR, catSlug);
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, filename);
        if (fs.existsSync(srcPath)) {
          fs.renameSync(srcPath, destPath);
          console.log(`[Files] Moved video: ${currentCat}/${filename} → ${catSlug}/`);
        }
        finalVideo = `/assets/videos/${catSlug}/${filename}`;
      }
    }
  }

  if (thumbnailPath) {
    const parts = thumbnailPath.replace(/^\/assets\/thumbs\//, '').split('/');
    if (parts.length === 2) {
      const [currentCat, filename] = parts;
      if (currentCat !== catSlug) {
        const srcDir = path.join(config.THUMB_DIR, currentCat);
        const destDir = path.join(config.THUMB_DIR, catSlug);
        fs.mkdirSync(destDir, { recursive: true });

        // Move main thumbnail
        const srcPath = path.join(srcDir, filename);
        if (fs.existsSync(srcPath)) {
          fs.renameSync(srcPath, path.join(destDir, filename));
          console.log(`[Files] Moved thumb: ${currentCat}/${filename} → ${catSlug}/`);
        }
        finalThumb = `/assets/thumbs/${catSlug}/${filename}`;

        // Move thumbnail options
        const thumbBase = path.parse(filename).name;
        try {
          const optFiles = fs.readdirSync(srcDir).filter(f => f.startsWith(thumbBase + '_opt_'));
          for (const optFile of optFiles) {
            fs.renameSync(path.join(srcDir, optFile), path.join(destDir, optFile));
          }
          if (optFiles.length > 0) console.log(`[Files] Moved ${optFiles.length} thumb options → ${catSlug}/`);
        } catch (e) { /* source dir may not exist */ }
      }
    }
  }

  return { video: finalVideo, thumbnail: finalThumb };
}

// Clean up unused thumbnail options for a film
function cleanupThumbOptions(thumbnailPath) {
  if (!thumbnailPath) return;
  const parts = thumbnailPath.replace(/^\/assets\/thumbs\//, '').split('/');
  if (parts.length !== 2) return;
  const [catSlug, filename] = parts;
  const thumbDir = path.join(config.THUMB_DIR, catSlug);
  const thumbBase = path.parse(filename).name;
  try {
    const optFiles = fs.readdirSync(thumbDir).filter(f => f.startsWith(thumbBase + '_opt_'));
    for (const optFile of optFiles) {
      fs.unlinkSync(path.join(thumbDir, optFile));
    }
    if (optFiles.length > 0) console.log(`[Cleanup] Removed ${optFiles.length} unused thumb options for ${filename}`);
  } catch (e) { /* ignore */ }
}

// Move transcoded video + thumbnail from staging to client path
function relocateClientVersion(filePath, clientSlug, projectSlug, formatSlug, versionNumber) {
  const vName = `v${versionNumber}.mp4`;
  const vThumbName = `v${versionNumber}_thumb.jpg`;
  let finalFilePath = filePath;
  let finalThumb = '';

  if (!filePath || !filePath.startsWith('/assets/videos/')) {
    console.log(`[Relocate] Skipping — path not in /assets/videos/: ${filePath}`);
    return { file_path: finalFilePath, thumbnail: finalThumb };
  }

  try {
    const destDir = path.join(config.CLIENTS_DIR, clientSlug, 'projects', projectSlug, 'formats', formatSlug);
    fs.mkdirSync(destDir, { recursive: true });

    const relPath = filePath.replace(/^\/assets\/videos\//, '');
    const srcPath = path.join(config.VIDEOS_DIR, relPath);
    const destPath = path.join(destDir, vName);

    if (!fs.existsSync(srcPath)) {
      console.log(`[Relocate] Source file not found: ${srcPath} — keeping original path`);
      return { file_path: finalFilePath, thumbnail: finalThumb };
    }

    fs.renameSync(srcPath, destPath);
    finalFilePath = `/assets/clients/${clientSlug}/projects/${projectSlug}/formats/${formatSlug}/${vName}`;
    console.log(`[Relocate] Video: ${relPath} → clients/${clientSlug}/projects/${projectSlug}/formats/${formatSlug}/${vName}`);

    // Find and move corresponding thumbnail
    const videoBase = path.parse(path.basename(relPath)).name;
    const thumbName = videoBase + '_thumb.jpg';
    const thumbSubdirs = fs.readdirSync(config.THUMB_DIR).filter(d => {
      try { return fs.statSync(path.join(config.THUMB_DIR, d)).isDirectory(); } catch { return false; }
    });
    for (const subdir of thumbSubdirs) {
      const thumbSrc = path.join(config.THUMB_DIR, subdir, thumbName);
      if (fs.existsSync(thumbSrc)) {
        const thumbDest = path.join(destDir, vThumbName);
        fs.renameSync(thumbSrc, thumbDest);
        finalThumb = `/assets/clients/${clientSlug}/projects/${projectSlug}/formats/${formatSlug}/${vThumbName}`;
        console.log(`[Relocate] Thumb: ${subdir}/${thumbName} → .../${vThumbName}`);
        try {
          const optFiles = fs.readdirSync(path.join(config.THUMB_DIR, subdir)).filter(f => f.startsWith(videoBase + '_thumb_opt_'));
          for (const opt of optFiles) fs.unlinkSync(path.join(config.THUMB_DIR, subdir, opt));
        } catch {}
        break;
      }
    }
  } catch (err) {
    console.error(`[Relocate] Error moving files: ${err.message} — keeping original path: ${filePath}`);
  }

  return { file_path: finalFilePath, thumbnail: finalThumb };
}

// Resolve an asset path to a disk path
function resolveDiskPath(filePath) {
  if (!filePath) return null;
  if (filePath.startsWith('/assets/clients/')) {
    return path.join(config.CLIENTS_DIR, filePath.replace('/assets/clients/', ''));
  }
  if (filePath.startsWith('/assets/videos/')) {
    return path.join(config.VIDEOS_DIR, filePath.replace('/assets/videos/', ''));
  }
  return path.join(config.VIDEO_DIR, filePath.replace('/assets/', ''));
}

module.exports = {
  resolveFilmFiles,
  cleanupThumbOptions,
  relocateClientVersion,
  resolveDiskPath,
};
