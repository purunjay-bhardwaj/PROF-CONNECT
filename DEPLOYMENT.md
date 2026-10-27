# Deploy Profconnect Meeting Place online

This is the student–professor meeting app, separate from the existing ProfConnect portal. Student/professor entry choices are not login or identity verification. Connect existing authentication and enforce professor permissions on the backend before treating rooms as institution-restricted. Internal `gather` service and data paths are intentionally unchanged.

The easiest deployment is one Docker-capable service serving both frontend and backend. You still need your own hosting account and a TURN relay for reliable cross-network calls; no hosting account, domain, paid service or credential was provisioned by this build.

## Option A: Render Docker service

The repository includes `render.yaml`. Render's Blueprint format supports persistent disks using `disk`, `mountPath` and `sizeGB`, as described in the [Render Blueprint reference](https://render.com/docs/blueprint-spec).

1. Put the contents of this project in a GitHub repository, with `Dockerfile` and `render.yaml` at the repository root. Do not commit `.env`, `data/` or any secrets.
2. In Render, create a Blueprint from that repository. Review the requested service and disk charges before confirming deployment; this configuration specifies `plan: starter` and a 1 GB disk.
3. For the initial setup, `ALLOWED_ORIGINS` can be empty to enforce same-origin. Once you know your actual `https://...onrender.com` URL or custom domain, set it to that exact origin, with no trailing slash.
4. Set TURN variables as described below. For a first UI-only smoke test they can be empty, but that is not a reliable cross-network calling setup.
5. Keep one instance. Do not configure multiple Uvicorn workers or scale to multiple replicas.
6. Wait for `/api/health` to return `{"status":"ok"}`.
7. Open the HTTPS URL, create a meeting and complete the acceptance checklist.

The image respects the `PORT` variable supplied by the hosting platform. Room metadata is stored at `/app/data/gather.db` on the configured disk.

The exact hosting UI may change. If importing a Blueprint is inconvenient, create a Docker web service manually, attach a disk at `/app/data`, set `DATABASE_PATH=/app/data/gather.db`, and configure the same variables.

## Option B: Linux VPS with Docker and Caddy

This route includes HTTPS termination. Caddy obtains and renews HTTPS certificates when configured with a valid hostname, according to the [Caddy reverse-proxy documentation](https://caddyserver.com/docs/quick-starts/reverse-proxy).

### Prepare the server

Use a Linux VPS with Docker Engine and the Compose plugin installed. A small starting configuration can be used for testing; no concurrency or CPU sizing benchmark is claimed.

1. Point a domain or subdomain, such as `meet.example.com`, at the VPS public IP.
2. Allow inbound TCP ports 80 and 443 in both the cloud firewall and host firewall.
3. Optionally allow UDP 443 for HTTP/3. Do not expose the Python app's port 8000 publicly.
4. Upload or clone this project onto the VPS.

### Set configuration

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
DOMAIN=meet.example.com
ALLOWED_ORIGINS=https://meet.example.com
DATABASE_PATH=/app/data/gather.db
MAX_PARTICIPANTS=4
ROOM_TTL_HOURS=24
PREVIEW_MODE=false
```

Configure TURN before real users begin calling. Then start the app and HTTPS proxy:

```bash
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

Open `https://meet.example.com`. The domain value above is an example; replace it with your real domain.

### Check status and logs

```bash
docker compose -f compose.yaml -f compose.production.yaml ps
docker compose -f compose.yaml -f compose.production.yaml logs --tail=100 gather
docker compose -f compose.yaml -f compose.production.yaml logs --tail=100 caddy
```

Do not post logs publicly if you add custom logging that includes room links, credentials or user content. The default runtime disables Uvicorn access logs to reduce incidental identifier logging.

### Update

Pull or upload your revised code and rerun the same Compose `up -d --build` command. Redeployment can disconnect active calls, so schedule updates between meetings.

### Stop

```bash
docker compose -f compose.yaml -f compose.production.yaml down
```

The named data volume remains. Do not add `-v` unless you deliberately intend to delete persisted room data.

## Configure TURN

There are two supported credential modes. The backend returns ICE credentials only after a successful room join.

### Managed TURN

Obtain TURN URLs and credentials from your chosen provider. Configure the exact values supplied by the provider:

```dotenv
TURN_URLS=turn:your-relay.example:3478?transport=udp,turns:your-relay.example:5349?transport=tcp
TURN_USERNAME=your-provider-username
TURN_PASSWORD=your-provider-password
TURN_SECRET=
```

Do not copy those placeholder values literally. Include TLS/TCP relay access if you need to support restrictive corporate networks, using the ports and URLs supported by your provider.

Static TURN credentials are necessarily delivered to authorized browsers. Anyone able to join a room can inspect those credentials, so use provider-side quotas and limited-lifetime credentials where available. The built-in shared-secret mode below generates time-limited credentials.

### Self-host coturn on the same Linux VPS

The optional `compose.turn.yaml` starts coturn with host networking, relay port limits, quotas and private-peer address restrictions. Coturn's `use-auth-secret` mode derives a temporary credential from a timestamped username and shared secret, as documented in the [coturn server guide](https://github.com/coturn/coturn/wiki/turnserver).

Generate a strong secret on your own machine or server:

```bash
openssl rand -hex 32
```

Add these entries to `.env`, substituting your actual secret and public IPv4:

```dotenv
TURN_EXTERNAL_IP=YOUR_VPS_PUBLIC_IPV4
TURN_SECRET=YOUR_RANDOM_SECRET
TURN_URLS=turn:meet.example.com:3478?transport=udp,turn:meet.example.com:3478?transport=tcp
TURN_USERNAME=
TURN_PASSWORD=
```

Open TCP and UDP 3478 and UDP 49160–49200 in both firewalls. Start all three services:

```bash
docker compose -f compose.yaml -f compose.production.yaml -f compose.turn.yaml up -d --build
```

This bundled coturn profile intentionally does not configure TURN-over-TLS. If your users need TLS relay on 443 or 5349, use a managed relay or set up a separate relay hostname/IP with coturn certificates and appropriate ports. Do not claim that UDP/TCP 3478 reaches every enterprise network.

The coturn container uses host networking and is intended for Linux, not a direct Windows/macOS desktop deployment. Its image, firewall and TLS configuration have not been exercised in this workspace.

Keep `TURN_SECRET` on the backend and relay only. The frontend receives a derived temporary credential, not the shared secret itself.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `DOMAIN` | Caddy hostname for the VPS route |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins; empty enforces matching request Host |
| `DATABASE_PATH` | SQLite path; use a persistent volume |
| `MAX_PARTICIPANTS` | Room capacity, clamped to 2–4 |
| `ROOM_TTL_HOURS` | Room link lifetime, default 24 |
| `PORT` | Runtime listen port, default 8000 |
| `PREVIEW_MODE` | Internal preview only; must remain `false` in production |
| `TURN_URLS` | Comma-separated TURN URLs |
| `TURN_SECRET` | Shared secret for timed credentials |
| `TURN_USERNAME`, `TURN_PASSWORD` | Alternative fixed-credential mode |
| `TURN_EXTERNAL_IP` | Public IPv4, optional coturn Compose service only |
| `FORWARDED_ALLOW_IPS` | Uvicorn trusted proxy peers; use only with a network boundary preventing direct untrusted access |

The production Compose override trusts forwarded headers because the app port is bound only to loopback and traffic is expected through Caddy. If you change the network exposure, review this trust setting.

The configuration does not use `VITE_API_BASE` in normal deployments. That variable is reserved for the Computer preview bundle. Do not deploy `preview-dist` as a standalone app; use the Dockerfile or normal `npm run build`.

## Deployment acceptance checklist

Do these on the real HTTPS deployment before sharing it broadly:

- [ ] `/api/health` returns `ok` after a cold start.
- [ ] Browser console has no mixed-content or WebSocket errors.
- [ ] One laptop on Wi-Fi and one phone on mobile data can join the same room.
- [ ] Both participants can hear and see each other, not only one direction.
- [ ] Join with devices off; enabling camera and microphone mid-call works.
- [ ] Desktop screen sharing reaches the other device and camera resumes when stopped.
- [ ] Chat, hand raising, mic mute and camera off update on the other device.
- [ ] A wrong passcode is rejected; correct passcode permits entry.
- [ ] Lock blocks new guests; unlock permits them.
- [ ] Four participants can join; a fifth receives a capacity error.
- [ ] Host-end disconnects everyone and the old room link cannot be reused.
- [ ] Leave turns off capture devices.
- [ ] Server restart retains room definitions but clients are asked to rejoin.
- [ ] Browser ICE diagnostics show a successful TURN relay path.
- [ ] For a dedicated relay test, temporarily add `iceTransportPolicy: 'relay'` to the `RTCPeerConnection` config in `src/useMeeting.js`, rebuild and repeat a two-device call; then remove that test setting if direct connections are desired.
- [ ] Test your target Chrome, Firefox, Safari and mobile versions on real devices.
- [ ] Backups, monitoring, log retention and abuse controls match your expected users.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Camera/mic controls fail | Use HTTPS or localhost; allow browser permissions; open the deployed page directly rather than a restricted iframe |
| One user connects but no media crosses networks | Check TURN URLs, credentials, relay firewall ports and ICE statistics |
| WebSocket disconnects immediately | Origin allowlist, proxy WebSocket upgrades, single-use ticket expiry |
| Room creation returns 403 | `ALLOWED_ORIGINS` must match the exact current origin |
| Many users share a rate limit | Verify proxy trust and the client IP received by Uvicorn; do not blindly trust forwarded headers |
| Locked room cannot be managed after refresh | Host capability was lost with the original tab; create a new room |
| Audio echoes | Use headphones and avoid two unmuted devices in the same physical room |
| Screen sharing is missing on a phone | Use a supported desktop browser for screen capture |
| Rooms disappear after redeploy | Database path is not on a persistent disk/volume |
| Calls fail after enabling extra workers | Revert to one worker and one replica; this signaling service is process-local |

## What has not been deployed for you

The attached Computer preview is a temporary app preview backed by this workspace. It is not a permanent public meeting service, does not provision TURN, and may impose iframe or permission restrictions. Hosting billing, DNS, TLS issuance on your domain, real relay credentials and cross-network verification remain deployment steps.
