# Admin UI Fixes — Round 3

**Date:** 2026-03-20

## Fixes Applied

### 1. [POLISH] Film category count visual hierarchy
**File:** `admin/public/css/admin.css:1373`
**Fix:** Removed `opacity: 0.6` from the earlier `.admin-category-heading .cat-count` rule which was stacking with the `--text-dim` color (0.3 opacity), creating an overly dim count at 18% effective opacity. Changed `color` to `var(--text-dim)` directly. The later redesign v2 rule already set `color: var(--text-dim)` — the earlier rule's opacity was counterproductive.
**Result:** Category label "BRAND FILM" renders at 50% opacity (--text-muted), count "14" renders at 30% opacity (--text-dim). Clear visual hierarchy.
