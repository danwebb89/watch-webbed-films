# Watch Webbed Films — Claude Instructions

## Project

Self-hosted video screening platform at **watch.webbedfilms.com**.
Admin API runs on Unraid at `192.168.10.25:3500`.

## CLI Tool: `tools/wf`

Use this tool for all watch site operations. It handles authentication automatically.

### Upload a video and create a film entry

```bash
# 1. Upload the video (auto-chunks large files, returns transcodeId)
tools/wf upload /path/to/video.mp4

# 2. Wait for transcode to finish (polls every 3s)
tools/wf transcode-wait <transcodeId>

# 3. Create the film entry (use the video/thumbnail paths from transcode result)
tools/wf films create \
  --title "Film Title" \
  --category "Short Films" \
  --year 2026 \
  --video /assets/videos/filename.mp4 \
  --thumbnail /assets/thumbs/filename_thumb.jpg \
  --description "Description here"
```

### Create a client screening

```bash
# Use an already-uploaded video
tools/wf projects create --title "Client Cut v2" --video /assets/videos/filename.mp4
# Returns a UUID — screening link is: watch.webbedfilms.com/screening.html?id=<uuid>
```

### Other commands

```bash
tools/wf films list                    # List all films
tools/wf films get <slug>             # Get one film
tools/wf films update <slug> --title "New Title"
tools/wf films delete <slug>
tools/wf projects list                 # List all projects
tools/wf projects update <uuid> --active false
tools/wf projects delete <uuid>
tools/wf files videos                  # List transcoded videos on server
tools/wf files thumbs                  # List thumbnails on server
```

### Categories

Originals, Documentary, Short Films, Feature Films, Corporate

### Visibility

- `--public true` (default) — appears in the public film catalog
- `--public false` — hidden from public, use for client-only content

## Deploy

```bash
bash deploy.sh   # commits, pushes, pulls on Unraid, restarts container
```

## Architecture

- **Frontend**: Static HTML served by Express (public/)
- **Backend**: Express.js with session auth (admin/server.js)
- **Transcode**: ffmpeg H.265/HEVC, CRF 20, auto-thumbnail at 25%
- **Data**: JSON files (data/films.json, data/projects.json)
- **Video storage**: /mnt/user/watch on Unraid (mounted as /videos in container)
