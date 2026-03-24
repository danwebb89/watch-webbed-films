# Watch Webbed Films — Claude Instructions

## Project

Self-hosted video screening platform at **watch.webbedfilms.com**.
Admin API runs on Unraid at `192.168.10.25:3500`.

## CLI Tool: `tools/wf`

Use this tool for all watch site operations. It handles authentication automatically.

### Add a film (one command — upload, transcode, create)

```bash
tools/wf add /path/to/video.mp4 \
  --title "Film Title" \
  --category "Short Films" \
  --year 2024 \
  --description "A short description" \
  --featured true
```

This uploads the file, waits for transcoding to finish (QuickSync hardware encoding), generates 10 thumbnail options, and creates the film entry.

### Batch upload a folder

```bash
for f in /path/to/folder/*.mp4; do
  tools/wf add "$f" --title "$(basename "${f%.mp4}")" --category "Short Films"
done
```

### All film flags

| Flag | Description | Default |
|------|-------------|---------|
| `--title` | Film title (required) | — |
| `--slug` | URL slug | auto from title |
| `--category` | Category (see list below) | — |
| `--year` | Release year | current year |
| `--description` | Short description | — |
| `--synopsis` | Full synopsis | — |
| `--credits` | Credits text | — |
| `--role` | Role/position description | — |
| `--duration` | Duration in minutes | — |
| `--video` | Video path (for create without upload) | — |
| `--thumbnail` | Thumbnail path | auto from transcode |
| `--public` | `true`/`false` | true |
| `--visibility` | `public`/`private`/`client` | public |
| `--featured` | `true`/`false` — eligible for Film of the Day | false |
| `--password` | Password protect (`"none"` to remove) | — |
| `--sort` | Sort order number (update only) | — |

### Categories

Feature Films, Short Films, Documentary, Corporate, Showreels, Trailers and BTS

### Step-by-step upload (alternative)

```bash
# 1. Upload the video (auto-chunks large files, returns transcodeId)
tools/wf upload /path/to/video.mp4

# 2. Wait for transcode to finish (polls every 3s)
tools/wf transcode-wait <transcodeId>

# 3. Create the film entry (use the video/thumbnail paths from transcode result)
tools/wf films create \
  --title "Film Title" \
  --category "Short Films" \
  --video /assets/videos/filename.mp4 \
  --thumbnail /assets/thumbs/filename_thumb.jpg
```

### Manage films

```bash
tools/wf films list                                    # List all films
tools/wf films get <slug>                              # Get one film
tools/wf films update <slug> --title "New Title"       # Update fields
tools/wf films update <slug> --category "Feature Films" --featured true
tools/wf films update <slug> --password "secret123"    # Add password
tools/wf films update <slug> --password none           # Remove password
tools/wf films delete <slug>                           # Delete a film
tools/wf regen-thumbs <slug>                           # Regenerate 10 thumbnails
```

### Client Portal

```bash
# Client management
tools/wf portal clients                              # List all clients
tools/wf portal clients create --name "Client Name"  # Create client portal
tools/wf portal clients create --name "Client Name" --password "secret"
tools/wf portal clients delete <slug>                # Delete a client

# Projects within a client
tools/wf portal projects <client-slug>               # List projects
tools/wf portal projects client-name create --title "Brand Film 2026"
tools/wf portal projects client-name delete <project-slug>

# Upload video version to a project (upload + transcode + add)
tools/wf portal add-version client-name brand-film-2026 /path/to/video.mp4 --note "First cut"

# Upload resource files
tools/wf portal upload-resource client-name /path/to/brand-guide.pdf --category brand-guidelines
# Categories: scripts, brand-guidelines, logos, graphics, other

# Migrate legacy screening project to portal
tools/wf portal migrate-project <old-uuid> --client "Client Name"
```

### Files & status

```bash
tools/wf files videos        # List transcoded videos on server
tools/wf files thumbs        # List thumbnails on server
tools/wf transcode <id>      # Check transcode status
```

## Deploy

```bash
bash deploy.sh
```

Deploy flow: commit → push to GitHub → backup DB → rsync to Unraid → restart container → purge Cloudflare cache.

## Architecture

- **Frontend**: Static HTML served by Express (public/)
- **Backend**: Express.js with session auth (admin/server.js)
- **Database**: SQLite (admin/db.js)
- **Transcode**: ffmpeg HEVC via Intel QuickSync (hevc_qsv), 10 auto-thumbnails
- **Video storage**: /mnt/user/watch on Unraid (mounted as /videos in container)
- **Container**: `watch-webbed-films` on Unraid at `/mnt/user/appdata/watch-webbed-films`
- **Port**: 3500

## Branding

- **Background**: Black (#0a0a0a)
- **Text**: Warm white (#f0ede8)
- **Accent**: Gold (#c8a96e)
- **Display font**: Cormorant Garamond / Cinzel (serif)
- **UI font**: Inter (sans-serif)
- **Logo**: Film strip motif — "watch WEBBEDFILMS"
- **Motifs**: CRT monitor, scanlines, film strip borders, timecode
