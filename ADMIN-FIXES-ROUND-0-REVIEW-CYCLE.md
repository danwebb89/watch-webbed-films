# Admin UI Fixes — Review Cycle (Pre-tester)

**Date:** 2026-03-20

## Fixes Applied

### 1. [CRITICAL] Open comment count on client cards
**Files:** `admin/db.js`, `admin/server.js`, `admin/public/js/admin.js`, `admin/public/css/admin.css`
**Fix:**
- Added `openCommentCountByClient()` DB function that JOINs comments → versions → projects to count open comments per client
- Updated `/api/clients` endpoint to include `comment_count` and `open_comment_count` in response
- Added orange chat icon + count badge to client cards when open comments > 0
- Styled with `.hc-count-notes` class: orange accent color, font-weight 600, full opacity icon
**Before:** Client cards showed only project count, resource count, Active status — no indication of feedback
**After:** Client cards show "💬 12" (orange) alongside project/resource counts — editor can see at a glance which clients need attention
**Screenshot:** `review-editor-clients-list-FIXED.png`

### 2. [CRITICAL] Deliverable status reflecting client approvals
**File:** `admin/db.js`
**Fix:** Modified `clientVersionsByDeliverable()` to LEFT JOIN with `client_version_approvals` table, returning `approval_status` and `approval_author` on each version record. Also added `comment_count` and `open_comment_count` subqueries per version.
**Before:** Deliverable cards always showed "Awaiting review" because versions had no approval_status data
**After:** Cards correctly show "Changes requested" / "Approved" / "Awaiting review" based on actual client approval decisions
**Screenshot:** `review-editor-atlas-project-FIXED.png`

### 3. [CRITICAL] Open comment count on collapsed deliverable cards
**Files:** `admin/public/js/admin.js`, `admin/public/css/admin.css`
**Fix:** Added "N open" pill badge to the collapsed deliverable card row, computed by summing `open_comment_count` across all versions of the deliverable. Styled as `.dl-notes-badge`: orange accent text on accent-dim background, 11px, rounded pill.
**Before:** Comment count was only visible after expanding the card and clicking "View notes"
**After:** "10 open" badge visible in collapsed state next to version count
**Screenshot:** `review-editor-atlas-project-FIXED.png`
