# Admin UI Fixes — Round 2

**Date:** 2026-03-20

## Fixes Applied

### 1. [POLISH] Film card titles — 2-line clamp
**File:** `admin/public/css/admin.css:1471`
**Fix:** Changed `.admin-card-title` from `white-space: nowrap` with `text-overflow: ellipsis` to `-webkit-line-clamp: 2` with `-webkit-box-orient: vertical`. Titles now show up to 2 lines before truncating.
**Impact:** Long titles like "Bart's Cancer Institute: Identity Film" and "GiveStar All Stars: Mike Copeland" are now readable without truncation.

### 2. [POLISH] Kebab button border-radius normalized
**File:** `admin/public/css/admin.css:2340`
**Fix:** Changed `.kebab-btn` border-radius from hardcoded `6px` to `var(--radius-lg)` (8px), matching `.btn-sm` radius.
**Impact:** Consistent border-radius across all interactive button types.

### 3. [POLISH] Client and deliverable chevrons — SVG icons
**File:** `admin/public/js/admin.js:463, 1954`
**Fix:** Replaced text character `&#8250;` (›) with proper SVG chevron icon (Material Design chevron_right, 16x16). Updated CSS for `.hc-chevron` and `.dl-chevron` to use `display: inline-flex` for proper SVG alignment.
**Impact:** Chevrons are now crisp SVG icons matching the icon style used throughout the admin UI.
