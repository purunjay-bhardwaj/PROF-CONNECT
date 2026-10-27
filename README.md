# Profconnect Meeting Place

A self-hostable meeting place for students and professors: React frontend, Python FastAPI backend, browser WebRTC, and Docker deployment. Use it for office hours, project reviews, and mentoring. It is a working small-room product, not a claim of feature parity with Zoom or Google Meet.

## ProfConnect edition

The interface follows the public [ProfConnect frontend](https://profconnect-thapar.vercel.app/): dark maroon surfaces, warm salmon accents, and Manrope/Inter typography. A light theme is also available.

The student entry option defaults to joining a session; the professor option defaults to creating one unless an invitation is already entered. Both can create or join rooms. These are convenience options, **not verified identities or permissions**. Host controls still require the server-issued creator secret.

This is a separate meeting application. Existing ProfConnect accounts, appointments, professor availability, Supabase data, and SSO are **not integrated**. The portal links open the original ProfConnect site; no changes have been made to that deployment.

The source directory, database filename, and Docker service retain the internal name `gather` so existing local commands and persistent volumes continue to work.

## Included

- Guest rooms with display names, shareable links, optional passcodes and 24-hour expiration.
- Up to four simultaneous participants per room, enforced by the backend.
- Camera/microphone preview, device selection, speaker test and join without capture.
- Bidirectional audio/video, microphone mute and camera toggles.
- Screen sharing that temporarily replaces your camera feed.
- Ephemeral in-room text chat, hand raising and participant panel.
- Host-only lock/unlock and end-for-everyone controls.
- Responsive interface with light/dark themes and permission/error states.
- Persistent room metadata in SQLite; hashed passcodes and host secrets.
- Rate limits, origin validation, message limits and single-use WebSocket tickets.
- Timed TURN credentials or managed TURN credential configuration.
- Multi-stage Docker image, Compose, Caddy HTTPS configuration, optional coturn, Render Blueprint, backend/browser tests and GitHub Actions workflow.

## Quick local run with Docker

Install Docker with the Compose plugin, unzip this project and run these commands inside the `gather` directory:

```bash
cp .env.example .env
docker compose up -d --build
```

Open `http://localhost:8000`. This is a local test, not an internet deployment. On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed.

For an actual online deployment, follow **DEPLOYMENT.md**. The recommended routes are a single Render Docker service or a Linux VPS with Docker and Caddy.

## Quick local run without Docker

Use Python 3.12 and Node.js 22.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm ci
npm run build
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1 --ws-max-size 65536
```

On Windows, create the environment with `py -3.12 -m venv .venv` and activate it with `.venv\Scripts\Activate.ps1`. Do not use the Docker-specific `DATABASE_PATH=/app/data/gather.db` locally; the default local path is `data/gather.db`.

For frontend development, run `npm run dev` in another terminal and open `http://localhost:5173`. The Vite development proxy forwards `/api` and `/ws` to Python. Leave `ALLOWED_ORIGINS` unset or include the frontend origin explicitly.

## Architecture

```text
                 HTTPS / WebSocket signaling, chat, host controls
Browser A ─────────────────┐
                           ├── Caddy / hosting HTTPS ── FastAPI ── SQLite
Browser B ─────────────────┘
    │                   │
    └── encrypted WebRTC media ──┘
           direct or through TURN
```

Python handles rooms, authorization, passcodes, chat and signaling. Audio/video is exchanged by browser `RTCPeerConnection` instances and does not pass through Python. A TURN relay, when needed, relays encrypted media separately.

The topology is a full mesh with a deliberate four-person cap. This implementation does not contain an SFU; increasing the cap is not a sensible substitute for adding one.

## Project layout

```text
backend/
  main.py             FastAPI routes, room database, signaling and controls
  models.py           Validated request and message contracts
src/
  main.jsx            Lobby, meeting room, media/device UI and dialogs
  useMeeting.js       WebSocket lifecycle and WebRTC peer management
  api.js              API, invite and WebSocket URL helpers
  style.css           Responsive light/dark design
tests/
  test_backend.py     Room security, validation, capacity and relay tests
  browser/            Playwright user-flow and actual media tests
deploy/Caddyfile      HTTPS reverse proxy
Dockerfile            Builds React, then runs the Python app as non-root
compose*.yaml         Local, HTTPS and optional TURN deployment
render.yaml           Single-service hosting blueprint
.env.example          Deployment variables, no actual secrets
DEPLOYMENT.md         Detailed deployment and acceptance instructions
QA.md                 Verification inventory and test boundaries
```

## API and signaling

The OpenAPI UI is at `/api/docs`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness plus database connectivity |
| `GET /api/config` | Public participant limit, expiry and TURN availability |
| `POST /api/rooms` | Create a room; returns a creator-only host secret |
| `POST /api/rooms/{id}/join` | Check access; issue a 60-second one-time socket ticket and ICE settings |
| `WS /ws/{id}` | First message authenticates the ticket; remaining messages carry signaling, chat and controls |

Host actions are authorized from the server-issued ticket, not from a client-provided role. The host secret is hashed in SQLite and never included in invitation links.

## Data and privacy

- Camera and microphone are off initially and require an explicit user action.
- Room metadata, passcode hashes and host-token hashes persist in SQLite.
- Chat is relayed through the server and retained only in connected browser memory, capped at 200 messages per tab. It is not written to SQLite.
- No call recording, transcript generation or analytics is implemented.
- Chat is not end-to-end encrypted from the application server. Do not advertise it as E2EE.
- WebRTC media uses browser transport encryption. Peers and relay operators may see connection metadata. Do not advertise anonymity or IP privacy.
- Default STUN uses Google's public STUN endpoint. Font loading uses Google Fonts. Replace these if third-party requests conflict with your policy.
- Room creation is guest-based. This is not an authenticated enterprise tenant system.

## Important operating limits

- Run **exactly one process/worker and one replica**. Live signaling, peers and one-time tickets are in memory.
- A server restart disconnects calls. Room definitions survive when SQLite is on a persistent disk; participants must rejoin.
- Host capability lives in the creating tab's memory. Leaving and rejoining in that same tab preserves it; refreshing or closing that tab loses host access. No account recovery is implemented. Keep the host tab open.
- A lost host tab can leave a room locked. Start a new room; the old link eventually expires. For long-lived rooms, add authenticated host ownership before launch.
- The app reports signaling disconnects and provides leave/rejoin recovery. It does not silently recover sessions or renegotiate a failed ICE path.
- Screen sharing replaces camera video; simultaneous camera-plus-screen and system-audio sharing are not implemented.
- No scheduling/calendar sync, recording, transcription, breakout rooms, waiting room, file transfer, participant removal, billing, user accounts or native apps.
- Media reliability still depends on browser support, device permissions and network conditions. TURN should be configured before inviting real users across networks.
- Rate limits are process-local. For an open public launch, add edge-level abuse controls and consider authenticated room creation.

## Tests

```bash
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest tests/test_backend.py -q
npm ci
npm run build
npx playwright install chromium
```

Start the backend locally, then run:

```bash
npm run test:e2e
```

The browser suite uses synthetic camera/microphone devices. It checks actual inbound audio bytes and decoded video frames in both directions, not merely a “connected” badge.

The GitHub Actions workflow runs tests and builds the Docker image when you push the source to your repository. The workflow is included, not already executed on your GitHub account.

## Before calling this production

Complete the deployment acceptance checklist in DEPLOYMENT.md, including two devices on different networks and a TURN-only call. Add monitoring, backups and abuse protection appropriate to your audience. For larger rooms, replace mesh media transport with an SFU while retaining the room and UI concepts.
