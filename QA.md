# Profconnect Meeting Place verification checklist

## Original calling-engine verification

Verified on 20 September 2026:

- Six backend test functions passed with Python 3.12, including nested checks for room security and signaling.
- Two automated Playwright scenarios passed, including actual inbound audio bytes and decoded video frames in both directions.
- Interactive Chromium checks passed for a four-person mesh, optional passcodes, lock/unlock, leave/rejoin, host-end, chat and hand raising.
- Synthetic desktop capture reached the other browser at 1440 × 810; stopping sharing restored 1280 × 720 camera video.
- Desktop lobby inspected at 1440 × 1000 in light/dark themes.
- Mobile lobby and meeting inspected at 375 × 812. The meeting toolbar fit the viewport and horizontal overflow was zero.
- No uncaught browser JavaScript errors were observed in the interactive checks.
- Production React build passed. npm audit and pip-audit reported no known vulnerabilities for the audited dependency set.
- An initial one-way media issue was identified and fixed by reusing the offer's transceivers on the answering peer. The bidirectional regression test guards this behavior.

These results use synthetic capture and local browser connections, not real camera hardware or a configured internet TURN relay. The Docker image and hosting-provider deployment were not executed here because no Docker daemon or hosting account was provisioned.

## ProfConnect frontend regression scope

The rebrand preserves the calling engine and backend authorization. The automated suite now also covers student/professor entry defaults, invitation preservation on role changes, portal navigation, and the new brand title. Roles are unverified UI choices, not an authentication feature.

Re-run results on 20 September 2026:

- Production frontend build passed.
- All six backend tests passed.
- All three Playwright scenarios passed, including bidirectional audio/video and host-end cleanup.
- Dark and light desktop lobbies were visually inspected at 1440px; the dark mobile lobby was inspected at 375px.
- The rebranded in-call interface was inspected on desktop and mobile. No horizontal overflow was detected at 375px.
- Full source retains the existing Docker and localhost commands; original deployment limitations still apply.

## Backend checks

- Health and public configuration.
- Invalid names, title limits, oversized request bodies and cross-origin rejection.
- Optional passcode checking; server-issued host identity, never a client-supplied role.
- Single-use, expiring WebSocket tickets.
- Offers, chat, lock/unlock and end meeting; guest cannot invoke host controls.
- Four-person capacity, isolation between rooms, expiration and creation rate limits.

## Browser checks

- Desktop and 375px mobile lobby, room and dialogs; no horizontal overflow.
- Light/dark themes, new/join tabs, meeting options and form validation.
- Permissions requested only on explicit action.
- Create a room; join in a second independent browser context.
- Actual WebRTC inbound video/audio statistics with synthetic browser devices.
- Join with no media and add media mid-call.
- Mic/camera toggles, raise/lower hand, chat delivery, people/chat panel toggles.
- Invite links, host lock/unlock, blocked guest, leave/rejoin and end for everyone.
- Device selection dialog, speaker control, help and instructions.
- Screen sharing uses the browser's display picker; test with synthetic display capture where available.
- Negative cases: malformed code, wrong passcode, network disconnect.
- Camera capture is stopped on leave and on host-end.

## Deployment checks and boundaries

- Frontend production build.
- Python tests with Python 3.12, the Docker runtime version.
- Docker source configuration reviewed; building Docker requires a Docker daemon.
- HTTPS and actual TURN traversal require the deployment hostname and relay credentials.
- Browser tests in this workspace do not prove cross-network NAT traversal or production concurrency.
- Native camera hardware, screen-selection UI, Firefox, Safari and mobile hardware need deployment acceptance testing.
