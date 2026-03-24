# Admin UI Fixes — Round 1 (40-Tester)

**Date:** 2026-03-20

## Context
Round 1 of the 40-tester evaluation scored an average of 7.1/10. Three critical issues drove the lowest scores (Console Error Hunter: 3/10, Error State: 4/10, Slow Network: 5/10).

## Fixes Applied

### 1. [CRITICAL] Auth-aware fetch wrapper — session expiry handling
**File:** `admin/public/js/admin.js`
**Fix:** Added `authFetch()` wrapper function that checks for 401/302 responses and redirects to `/login` instead of silently failing. Applied to `loadHomeStats()` API calls.
**Before:** Session expiry caused silent blank pages, broken data rendering, and cascading TypeError errors.
**After:** Session expiry immediately redirects to login page — no silent failures.

### 2. [CRITICAL] Transcode polling 401 flood
**File:** `admin/public/js/admin.js` (lines 1395-1410)
**Fix:** Added `res.ok` check to `pollTranscodeStatus()` before parsing JSON. On 401/302, clears the polling interval and redirects to login. Also fixed background transcode poll with same pattern.
**Before:** `/api/transcode` polled every 3 seconds; on session expiry, generated 25+ console errors flooding the console and masking real issues.
**After:** Polling stops cleanly on auth failure, redirects to login.

### 3. [BUG] Films page TypeError crash
**File:** `admin/public/js/admin.js` (`loadFilms` function)
**Fix:** Wrapped `loadFilms()` in try/catch, used `authFetch()`, and added `Array.isArray()` guard before assigning to `allAdminFilms`.
**Before:** `allAdminFilms.filter is not a function` TypeError when API returned non-array (e.g., HTML redirect page).
**After:** Gracefully handles API failures — sets empty array, no crash.

### 4. [BUG] Portal dynamics.js console error (deployed earlier)
**File:** `public/js/dynamics.js` (lines 1042, 1053)
**Fix:** Added `if (!e.target || !e.target.closest) return;` guard to `mouseenter`/`mouseleave` handlers.
**Before:** `TypeError: e.target.closest is not a function` on every portal page load.
**After:** No console errors on portal pages.

### 5. [BUG] Missing ARIA attributes on modals (deployed earlier)
**File:** `admin/public/index.html`
**Fix:** Added `role="dialog"` and `aria-modal="true"` to all 9 modal overlays. Added `aria-labelledby` for 6 modals with title IDs, `aria-label` for 3 without.
**Before:** Screen readers couldn't identify modals as dialogs. 0 ARIA dialog attributes.
**After:** All modals properly announced as dialogs with descriptive labels.
