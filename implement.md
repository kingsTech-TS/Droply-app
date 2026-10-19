# Implementation Plan: Droply Mobile (Expo / React Native) — full parity with the website

Sources (inspected for this plan):

- Requirements: [prompt.md](prompt.md)
- **Website — the behaviour to replicate:** `../droply` (Next.js 16). Every route in `app/`, every component in
  `components/`, every hook in `hooks/`, every module in `lib/`, `types/`, `config/`, and its `README.md` /
  `implementation.md`.
- **Backend — the contract to obey:** `../Droply-BD/backend` — `docs/WEBSOCKET_PROTOCOL.md`, `app/schemas/*.py`,
  `app/models/*.py`, `app/api/routes/*.py`, `app/api/websocket/signaling.py`, `app/core/{config,security,exceptions}.py`,
  `app/services/transfer_state.py`.
- This repo: Expo SDK **58** (`expo ~58.0.14`), React Native 0.88, React 19.3, TypeScript 6. It is still the blank
  template (`App.tsx`, `index.ts`).

> **Rule 1 — Parity.** Everything the website does, the app does: same features, same flows, same state machine,
> same limits and timings, same error copy, same honest status labels. §4 lists every website feature and module
> with its app counterpart. Only three kinds of differences are allowed, and each one is listed in §5:
> (a) a browser mechanism replaced by its native equivalent (OPFS → app sandbox file, `localStorage` → SQLite,
> Web Audio → bundled sounds, …); (b) browser-only features that have no meaning in a native app (PWA install,
> service worker, "unsupported browser"); (c) native extras the website can't do (Save to Photos, share extension).

> **Rule 2 — Contract.** The backend defines REST, WebSocket messages, limits and errors (§2). The website defines
> the DataChannel wire protocol (§3). The app speaks both **byte for byte**, so a browser cannot tell that its peer
> is a phone, and the backend needs no code change.

> **Rule 3 — Data plane.** FastAPI is the control plane and WebRTC is the data plane. File bytes never go to the API.
> Files are never loaded into JS memory whole, never Base64-encoded by our code, and never sent as one DataChannel
> message.

---

## 0. Where prompt.md does not match the website/backend

The website and backend win wherever they disagree with the prompt.

| # | prompt.md says | Website + backend reality | Mobile decision |
|---|---|---|---|
| 1 | Product **SwiftDrop** | **Droply** (`config/brand.ts`: "Send anything. Instantly." / "Fast, private file sharing between your devices.") | Droply. Brand strings live in `src/config/brand.ts`, same contents as the website's file. |
| 2 | `EXPO_PUBLIC_API_URL=http://IP:8000`, WS `ws://…/<path>` | The website uses `…/api/v1` and `…/ws/v1`. The socket is `/ws/v1/rooms/{room_id}`. | `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000/api/v1`, `EXPO_PUBLIC_WS_URL=ws://<LAN-IP>:8000/ws/v1`. Mirror the other website variables too: `EXPO_PUBLIC_DEBUG`, `EXPO_PUBLIC_ENABLE_BENCHMARK`, `EXPO_PUBLIC_MAX_ACTIVE_TRANSFERS=16`. |
| 3 | Routes in `app/` | AGENTS.md requires `src/app/` | Routes in `src/app/`. Non-route code in `src/` mirrors the website tree (`src/lib/webrtc`, `src/lib/storage`, …) so each file has an obvious counterpart (§7). |
| 4 | Handle zero-byte files | Backend `file_size > 0`. The website skips empty files with a warning. | Same warning copy: "Empty files can't be sent." / "N empty files were skipped." |
| 5 | Transfer IDs + file IDs | One transfer = one file with N recipient legs, and `batch_id` groups the files picked together | Same. `fileId` = `transfer_id`. |
| 6 | Checksum "where feasible" | SHA-256 per chunk plus a root digest (SHA-256 of the joined hex digests). The backend `sha256` field stays `null`. | Same (required for interop). |
| 7 | Pause/resume "where supported" | Fully supported (leg states, checkpoints, `file_ready.have`, IndexedDB resume) | Fully implemented, including resume after an app restart. |
| 8 | Global auto/manual acceptance setting | The website has no global auto-accept. It has: a per-room "auto-accept from this device" switch, "Auto-accept the rest from this device" for large batches, and automatic acceptance inside **My devices** rooms (`trustAll` when `mode === "my-devices"`). | Exactly the website's rules. Unknown devices always prompt. |
| 9 | Proximity discovery | Room codes, QR (`join_url`), **Nearby rooms** (opt-in, same public IP), **rendezvous** (My devices + personal room link) | All four, with the same wording. "Nearby" means "on your network", not physical distance. |
| 10 | Chunk sizing from DataChannel limits | Chunk (declared, chosen by `chooseChunkSize`, clamped by `transfer_config` and the memory budget) ≠ frame (16–256 KiB, `hello.maxFrame`) | Same algorithm and constants (§6). |
| 11 | WebSocket "just connects" | The server checks `Origin` against `WS_ALLOWED_ORIGINS`/`CORS_ORIGINS`. React Native sends a default Origin derived from the URL (`http://<api-host>`), which is not allowed, so the connection closes with `4003`, even in development. | The app sends `Origin: droply-app://mobile` (RN `WebSocket(url, protocols, { headers })`). The backend adds it to the allow-list (§9, config only). |
| 12 | Deep links "if supported" | QR = `join_url` `https://<frontend>/join/<CODE>`. Personal link = `/r/<key>`. | The scanner and deep links handle both, plus `droply://join/<CODE>` and `droply://r/<key>`. Universal/App Links need two `.well-known` files on the website (§9). |
| 13 | "Connected directly / via relay" | **Direct connection** (both `host`), **Internet connection** (`srflx`/`prflx`), **Relay connection** (either `relay`). Quality Excellent < 50 ms RTT, Good < 150 ms, otherwise Weak. | Identical labels, thresholds and `connection_state` reporting. |
| 14 | Only the core screens | The website also has text drop, chat, reactions, security code, pairing, personal room link, nearby rooms, room themes, event rooms, present QR, speed test, album, zip, folders, smaller photos, celebrations, history, stats/Wrapped/badges, result cards, diagnostics and a benchmark | **All of them** (Rule 1, §4). |
| 15 | Cloud upload fallback | The backend has R2 fallback endpoints, but **the website does not implement them** (only `cloud_fallback_enabled` is read) | Not in the app either (parity). The type definitions stay, so it can be added to both clients later. |
| 16 | TanStack Query "where appropriate" | The website uses no query library. Services own the state and React subscribes to snapshots. | Keep the website's architecture (services + external stores). Use TanStack Query only for the screens that are one-shot REST reads (nearby rooms, active-room status, diagnostics). Zustand holds persisted settings/history state where the website used `LocalStore`. |

---

## 1. Architecture (same as the website)

```
┌──────────────────────────── React Native (UI only) ─────────────────────────────┐
│  src/app routes · src/components · src/hooks (useSyncExternalStore / zustand)    │
└──────────────▲───────────────────────────────────────────────▲──────────────────┘
               │ snapshots (≤ 5 per second, 200 ms)            │ commands
┌──────────────┴──────────── RoomSession (one per room) ───────┴──────────────────┐
│  SignalingClient     PeerManager → PeerLink        TransferManager              │
│  · WS JSON, budget   · RTCPeerConnection           · leg state machine          │
│  · heartbeat         · negotiated DataChannel      · scheduler, progress        │
│  · backoff           · stats, recovery ladder      · resume, trust, batches     │
│  PeerMessenger (text/chat/reactions/pairing)  IceServerProvider  ApiClient      │
│  FileSender / FileReceiver ── protocol ── ChunkSink (sandbox .part / SAF folder)│
│  ResumeStore (SQLite)   History/Records (SQLite)   SessionStore (SecureStore)   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Services are plain TypeScript classes with no React imports. Each exposes `subscribe()`/`getSnapshot()`
  (website `lib/utils/emitter.ts` `Emitter` + `Store`), consumed by hooks with `useSyncExternalStore`, exactly as
  the website's `hooks/use-room-session.tsx` does (`useRoom`, `useTransfers`, `usePeerLinks`, `useInbox`,
  `useUnreadChat`, `usePairRequests`).
- File handles, buffers, `RTCPeerConnection` and channels never enter React state.
- **Room sessions survive navigation.** On the website a session lives while the room page is mounted. In the app,
  `RoomSessionRegistry` keeps the session alive while the user moves between tabs (Home, Transfers, History). It is
  disposed on leave, room end, or idle with no transfers. This replaces the browser tab's lifetime.

---

## 2. Backend contract (exact)

**REST** (base `EXPO_PUBLIC_API_URL`; `Authorization: Bearer <device_token>` where authenticated; errors use
`{success:false, error:{code, message, request_id}}`; `ApiError` keyed on `error.code`; same retry rules as the
website's `lib/api/client.ts`: honour `Retry-After`, retry idempotent GETs/TURN only, no automatic POST retries):

| Website function (`lib/api/*`) | Call | App use |
|---|---|---|
| `createRoom(device, kind?, theme?)` | `POST /rooms` | Send / Receive / Create room (with theme picker and event-room option) |
| `joinRoom(code, device, hostKey?)` | `POST /rooms/join` | Join by code/QR/link. The host key makes the creator host again. |
| `getRoom`, `closeRoom`, `updateRoomSettings` | `GET/DELETE/PATCH /rooms/{id}` | Refresh expiry, close for everyone, theme + discoverable |
| `getRoomStatus(rooms)` | `POST /rooms/status` | "Your active rooms" |
| `getNearbyRooms()` | `GET /rooms/nearby` | "Rooms on your network" |
| `rendezvous(key, device, token?)` | `POST /rendezvous` | My devices / personal room link (the existing token reuses this device in that room) |
| `getDevices`, `leaveRoom` | `GET /rooms/{id}/devices`, `DELETE /rooms/{id}/devices/{device_id}` | Device list, leave, remove (host) |
| `createTransfer`, `getTransfer`, `transferAction(accept…cancel)`, checkpoint | `/transfers…` | TransferManager (actions over REST, checkpoints over WS) |
| `getTurnCredentials` | `POST /turn/credentials` | IceServerProvider (refresh 5 min before expiry; 60 s back-off on failure; STUN-only fallback) |
| `getTransferConfig` | `GET /config/transfer` | Diagnostics (`room_state.transfer_config` is the primary source) |
| — | `GET /health` | Diagnostics |

`DeviceInfoIn` from the app: `device_name` (≤ 64 characters, default from `funDeviceName()` / `defaultDeviceName()`,
editable), `device_type` (`phone`/`tablet` from `expo-device`), `browser: "Droply app"`, `operating_system: "iOS" |
"Android"`. The website shows these as "Android • Droply app" with no change.

**WebSocket** `EXPO_PUBLIC_WS_URL/rooms/{room_id}`, header `Origin: droply-app://mobile`. Port the website's
`signaling-client.ts` behaviour exactly:
join-first within 5 s → `room_state` · `pong {ts}` to every `ping` · 75 s of silence = dead socket · outbound budget
150 messages / 10 s, with checkpoints coalesced · frames ≤ 60 KiB · backoff 0.5 → 16 s ± 20 %, 8 attempts, then
"Connection lost [Retry]" · close codes: `1001/1006/4000/4008` reconnect (`4008` from 4 s); `4001` → session invalid;
`4003` → configuration error; `4004/4010` → Room ended; `4009` → log and reconnect once; `4011` → "Opened on another
device" + [Use here]; `4012` → Removed by host · events `room_state`, `peer_joined/updated/left`, all 15 `transfer_*`
types, `room_updated`, `room_closed/expired`, `error` · every inbound message passes the ported
`server-messages.ts` guards.

---

## 3. DataChannel wire protocol (identical to `../droply/lib/webrtc/protocol.ts`)

- **Channel:** `createDataChannel("droply", { negotiated: true, id: 0, ordered: true })` on both sides,
  `binaryType = "arraybuffer"`, one per peer pair. Perfect negotiation with the server's `polite` flag (the greater
  `device_id` is polite). `connection_id = pc-<peerId>-<n>`. ICE buffered per `connection_id` (max 64). Peer-restart
  and creation-glare rules from `peer-connection.ts`. Recovery ladder: disconnected 5 s → `restartIce` → 15 s →
  new PC (polite waits 10 s more) → fail after 3 attempts. "Reconnect through relay" = `iceTransportPolicy: "relay"`.
  Links are reference-counted and closed after 3 minutes idle (`peer-manager.ts`).
- **Control (JSON):** `hello{v:1,maxFrame}` · `file_open{slot,transferId,size,chunkSize,totalChunks,path?,test?}` ·
  `file_ready{slot,have,window}` · `chunk_end{slot,index,sha256}` · `chunk_ack` · `chunk_nack` · `file_end{slot,root}` ·
  `file_done{slot,ok}` · `file_close{slot,role,reason}` · `app{m}` · `bye`.
  App messages: `text` (≤ 64 KiB) · `chat` (≤ 2000 characters) · `reaction` (👍 ❤️ 😂 🔥 🎉 🙏) · `pair_request{key,name}` ·
  `pair_accept{name}` · `pair_decline`.
- **Binary frame:** `u8 0xD7 · u8 1 · u16 slot · u32 chunkIndex · u32 offset · u32 length · payload` (little-endian).
- **Flow:** sender `file_open` → receiver `file_ready{have,window}` → per missing chunk: read → SHA-256 → frames with
  backpressure → `chunk_end` → `chunk_ack` (credit back) or `chunk_nack` (resend, max 3) → `file_end{root}` →
  `file_done{ok}`. Progress comes only from acks. A receiver chunk failing 3 times fails the leg (`integrity`).
- **Speed test:** `file_open{test:true}` with no server transfer, synthetic source, `DiscardSink` on the receiver,
  capped at 256 MiB.
- **Security code:** the website's `securityCode()` (sorted DTLS fingerprints → SHA-256 → 4 of 64 emoji). The table
  is copied verbatim, so the phone and the browser show the same code.

---

## 4. Parity matrix — every website feature and module, and its app counterpart

Legend: **=** same logic (rewritten in RN where needed, same behaviour, same constants) · **≈** same behaviour on a
native mechanism (details in §5) · **+** native extra.

### 4.1 Routes / screens

| Website route / component | What it does | App route | |
|---|---|---|---|
| `/` `app/page.tsx` + `landing/start-sharing` | Hero, drop zone / Select files → create room with files pending; create empty room to receive; theme picker | `src/app/(tabs)/index.tsx` Home: **Send** (pick files → room) and **Receive** (empty room) tiles, theme picker on create | ≈ (picker replaces drop) |
| `landing/join-code-form` | 6-character code entry, normalized | Home "Join with code" (6-slot input) + **Scan QR** (`scan.tsx`) | = / + |
| `landing/active-rooms` | Your active rooms (rooms/status), Rejoin, host key | Home section "Your active rooms" | = |
| `landing/nearby-rooms` | Discoverable rooms on the same network, one-tap join | Home section "Rooms on your network" | = |
| `landing/my-devices` | "Connect my devices" → rendezvous (`my-devices` mode) | Home card "Connect my devices" | = |
| `landing/speed-test-start` + `/speed-test` | Start a device-to-device speed test room | `src/app/speed-test.tsx` | = |
| `/join/[code]` `room/join-form` | Device name (editable, type icon), Join, error states | `src/app/join/[code].tsx` (deep link + typed + scanned) | = |
| `/r/[key]` `room/room-link-join` | Personal room link → rendezvous (`room-link` mode) | `src/app/r/[key].tsx` | = |
| `/room/[roomId]` `room/room-screen`, `room-view` | Whole room UI (below) | `src/app/room/[roomId]/index.tsx` | = |
| `/my-devices` `pairing/my-devices-manager` | Paired list, unpair, personal room link (create / copy / share / reset) | `src/app/my-devices.tsx` | = |
| `/history` `history/history-view` | Local history, filters, clear | `src/app/(tabs)/history.tsx` | = |
| `/stats` `history/stats-view` | Monthly Wrapped, records, badges, share card | `src/app/stats.tsx` (from History) | = |
| `/privacy` | What the server sees / never sees | `src/app/privacy.tsx` (same copy) | = |
| `/about` | Control and data planes, caveats | `src/app/about.tsx` (same copy) | = |
| `/dev/benchmark` `dev/benchmark` | Loopback + peer benchmark (gated) | `src/app/dev/benchmark.tsx` (gated by `EXPO_PUBLIC_ENABLE_BENCHMARK`) | = |
| `dev/diagnostics-panel` | Per-peer ICE/DataChannel/throughput internals (gated) | Room sheet `room/[roomId]/diagnostics.tsx` (gated by `EXPO_PUBLIC_DEBUG`) + Settings → Diagnostics (backend health, WS state) | = / + |
| `layout/preferences-dialog` | Sound, celebrations, haptics, notifications, send smaller photos | `src/app/(tabs)/settings.tsx` (same five preferences + device name + theme + storage) | = |
| `layout/header`, `theme-toggle`, `theme-provider` | Logo, light/dark/system without flash | Tab/stack headers, Settings theme option, `ThemeProvider` | = |
| `app/error.tsx`, `not-found.tsx` | Error boundary, 404 | `ErrorBoundary` export in `_layout.tsx`, `+not-found.tsx` | = |
| `manifest.ts`, `share-target/`, `pwa/shared-inbox` | PWA install, "Share to Droply" | **≈ Share extension / intent filter**: shared files and text open a new room with them pending | ≈ |
| — | — | `src/app/(tabs)/transfers.tsx`: every active transfer across rooms (tab badge) | + |

### 4.2 Room screen (website `room-view.tsx` and its children)

| Website component | Feature | App component |
|---|---|---|
| `room-header` | Code, host menu (close room), Leave (confirm while transfers are active) | `RoomHeader` (+ `usePreventRemove` / Android back confirm = website `useLeaveWarning`) |
| `room-share-panel`, `room-code`, `qr-code`, `room-countdown` | Code `K7X 9PQ` (copy), copy link, QR of `join_url`, expiry countdown, open by default when alone | `RoomSharePanel` (collapsible sheet, open when alone), `RoomCode`, `QrCode` (`react-native-qrcode-svg`), `RoomCountdown` (shared 1 s clock = `use-countdown`) |
| `present-dialog` | Full-screen QR for an audience | `PresentScreen` (full-screen modal, max brightness via `expo-brightness`) |
| `room-banners` `ExpiryPrompt`, `KeepTabOpenBanner` | "Room expires soon — Keep open" (`keepAlive`), keep-open hint on mobile | `ExpiryPrompt`, `KeepAppOpenBanner` ("Keep Droply open until the transfer finishes") |
| `connection-banner` | Offline / reconnecting / Retry | `ConnectionBanner` (NetInfo) |
| `room-ended` | Ended / expired / removed / invalid session copy | `RoomEnded` |
| `room-settings` + `landing/theme-picker` | Host: theme (8) and Nearby discoverability | `RoomSettingsSheet` |
| `device-list`, `device-card`, `device-avatar`, `device-icon` | Presence as text + dot, "This device", OS • Browser, connection badge + quality, paired marker; actions: Send files, Send text, Test speed, Add to My devices, Reconnect / through relay, Remove (host, confirm) | `DeviceList`, `DeviceCard` (long-press / ⋯ action sheet with the same actions), `DeviceAvatar` (emoji avatar from `splitAvatar`) |
| `connection-badge` | Direct / Internet / Relay + Excellent/Good/Weak | `ConnectionBadge`, `QualityIndicator` |
| `connecting-animation` | "Waiting for another device…" | `RadarPulse` animation (§6) |
| `transfer/drop-zone`, `send-panel`, `file-list`, `file-item`, `file-icon`, `recipient-selector` | Files ready (icon by kind, size, remove), Send to (Select all / Clear, auto-select single), Send N files with disabled reason, **Send smaller photos**, **Send when my device connects** (My devices rooms) | `SendPanel` (Add files: Files / Photos & videos / Folder on Android), same controls and the same disabled-reason copy |
| `incoming-transfer` | Grouped "Incoming files" card (batch / 2 s window), per-file decline expander, storage check, auto-accept switch, "Auto-accept the rest" | `IncomingSheet` (bottom sheet, same contents) |
| `transfer-list`, `transfer-card`, `transfer-progress`, `transfer-details`, `cancel-dialog` | Status text, progress, bytes, speed, ETA, per-recipient progress, Pause/Resume/Cancel (confirm > 100 MB)/Retry/Dismiss/Save, details (path, current/avg speed, latency), reactions, **Save all as .zip** | `TransferList`, `TransferCard`, `TransferProgress`, `TransferDetails`, `CancelDialog`; Save = Open / Share / Save to Files / Save to Photos |
| `speed-graphics` `Sparkline`, `SpeedGauge` | 30-second speed graph, log-scale gauge (100 kB/s – 1 GB/s) for large files, batch total speed, end summary | `Sparkline`, `SpeedGauge` (`react-native-svg` + Reanimated) |
| `media-thumb`, `media-viewer`, `album-dialog` | Previews only after the magic-byte sniff; album of received photos/videos, save one / all, add photos | `MediaThumb` (`expo-image`, `expo-video-thumbnails`), `MediaViewer` (`expo-image` / `expo-video`), `AlbumScreen` (+ Save all to Photos) |
| `storage-panel` | Temporary data size + Clear | `StoragePanel` (also in Settings) |
| `text-drop` `TextDropDialog`, `TextInbox` | Send text to chosen devices, received texts (copy) | `TextDropSheet`, `TextInbox` (`expo-clipboard`) |
| `chat-panel` | Room chat, unread badge | `ChatSheet` |
| `pair-request-dialog` | Accept/decline pairing | `PairRequestSheet` |
| `speed-test-dialog` | Run the test, live speed, result | `SpeedTestSheet` |
| `unsupported-browser` | WebRTC/crypto missing | ≈ startup capability check only (the app bundles WebRTC) |

### 4.3 Services and logic (`lib/`, `hooks/`, `types/`, `config/`)

| Website module | App module (`src/…`) | |
|---|---|---|
| `config/brand.ts`, `config/env.ts` | `config/brand.ts`, `config/env.ts` (validated `EXPO_PUBLIC_*`) | = |
| `types/api.ts, device.ts, room.ts, signaling.ts, transfer.ts` | same files (mirror of the Pydantic models) | = |
| `lib/api/client.ts, errors.ts, rooms.ts, devices.ts, transfers.ts, turn.ts, config.ts` | `lib/api/*` (same functions, same error → copy table `userMessage`) | = |
| `lib/webrtc/signaling-client.ts` | `lib/webrtc/signaling-client.ts` (+ Origin header) | = |
| `lib/webrtc/server-messages.ts` | same | = |
| `lib/webrtc/ice.ts` | same | = |
| `lib/webrtc/peer-connection.ts`, `peer-manager.ts` | same, on `react-native-webrtc` | = |
| `lib/webrtc/connection-monitor.ts` | same (`getStats` every 2 s while transferring, 10 s otherwise, paused in background) | = |
| `lib/webrtc/data-channel.ts` | same (high-water 256 KiB – 8 MiB, low threshold = high / 2, 100 ms drain re-check poll) | = |
| `lib/webrtc/adaptive-controller.ts` | same (`defaultTuning`, `chooseChunkSize`, growth ×1.5/s, halve on stall) | = |
| `lib/webrtc/protocol.ts`, `security-code.ts` | same | = |
| `lib/webrtc/chunk-manager.ts` (`FileSource`, `SyntheticSource`, read limiter) | `FileSource` on `expo-file-system` `FileHandle.readBytes` at an offset; same limiter | ≈ |
| `lib/webrtc/file-sender.ts`, `file-receiver.ts` | same | = |
| `lib/webrtc/transfer-manager.ts` | same responsibilities: lazy creation (≤ 16), batches + `batch_id` (with fallback when unsupported), request grouping (2 s), trust, accept/decline/declineOne, pause/resume/retry/cancel/dismiss, save, saveAsZip, provideFile (re-pick after restart), restore, clear temporary data, reactions, speed test, early views, notices, completions, 200 ms publish, 1 s tuning, 2 s checkpoints | = |
| `lib/webrtc/transfer-state.ts` | same (`ALLOWED` copied from `transfer_state.py` + `queued/requesting`; 121-pair test) | = |
| `lib/webrtc/transfer-view.ts`, `progress.ts`, `scheduler.ts` | same (3 s speed window, ETA after 2 s, 30-sample history; mobile limits global 2 / per-peer 1) | = |
| `lib/webrtc/resume-manager.ts` + `lib/storage/indexed-db.ts` | `ResumeStore` on `expo-sqlite` (tables `legs`, `digests`; a digest is written only after its chunk is stored; expiry = `resume_window_seconds`) | ≈ |
| `lib/webrtc/messaging.ts` (`PeerMessenger`) | same (20 s connect timeout) | = |
| `lib/session/room-session.ts` | same (inbox ≤ 200, unread chat, pair requests, celebration merge 1.5 s, theme/discoverable, sendText, sendChat, react, requestPairing/respond, runSpeedTest, leave, removeDevice, closeForEveryone, retryConnection, retryPeer(relayOnly), keepAlive, dispose) + `RoomSessionRegistry` | = |
| `lib/session/session-store.ts` (`sessionStorage`) | `SecureStore` (token, deviceId, roomCode, joinUrl, mode, hostKey) | ≈ |
| `lib/session/my-rooms.ts` (max 10, host key) | SQLite table (`hostKey` in SecureStore) | ≈ |
| `lib/session/pending-files.ts` | in-memory pending files/text (Home / share extension → room) | = |
| `lib/session/rendezvous-join.ts` | same (reuse the last room's token per mode + key fingerprint) | = |
| `lib/pairing/pairing.ts` | pairing key + paired devices + room-link key in SecureStore/SQLite; `generateKey()` with `expo-crypto.getRandomValues` | ≈ |
| `lib/storage/sinks/*` (fs-access, OPFS, IDB, memory, discard) + `storage.worker.ts` + `factory.ts` | `PartFileSink` (sandbox `.part`, offset writes — the OPFS equivalent), `SafFolderSink` (Android "Save into a folder" — the fs-access equivalent), `DiscardSink` (speed test); factory picks folder → sandbox; `NoStorageError` when space is short | ≈ |
| `lib/storage/quota.ts` | `Paths.availableDiskSpace` / `totalDiskSpace` | ≈ |
| `lib/storage/save.ts` | Open with… / Share (`expo-sharing`) / Save to Files (iOS) / Save to Downloads (Android, SAF) / Save to Photos (`expo-media-library`, images/videos only after the sniff); always under a sanitized name | ≈ + |
| `lib/storage/zip.ts` (stored ZIP + ZIP64, streaming CRC-32) | same algorithm writing the archive sequentially with a `FileHandle`, then Share/Save | = |
| `lib/media/sniff.ts`, `image-size.ts` | same (magic bytes from the first `readBytes`) | = |
| `lib/media/thumbnail.ts` | `expo-image-manipulator` downscale + `expo-video-thumbnails`, one at a time, gated by the memory budget | ≈ |
| `lib/media/compress.ts` ("Send smaller photos") | `expo-image-manipulator` resize/re-encode (JPEG/PNG/WebP; keep GIF; keep the original if not meaningfully smaller) | ≈ |
| `lib/device/detection.ts`, `device-name.ts` | `expo-device` (phone/tablet), same `defaultDeviceName` / `cleanDeviceName` (64 characters), saved name | ≈ |
| `lib/device/memory.ts` | same budgets; class from `Device.totalMemory` (normal / constrained / low) | ≈ |
| `lib/fun/names.ts`, `themes.ts`, `prefs.ts` | same lists, theme styles (label, emoji, confetti colors), same five preferences (defaults sound on, celebrations on, haptics on, notifications off, smaller photos off) | = |
| `lib/fun/celebrate.ts` (confetti, synthesized sounds, vibrate, flyFile) | Reanimated confetti (theme colors), bundled short sounds rendered from the same synth parameters (`expo-audio`), `expo-haptics`, Reanimated flight path | ≈ |
| `lib/history/history.ts` (history, records, 9 badges, Wrapped stats) | same logic on SQLite: entries, records (best average, best peak, biggest file), badges (First drop, Gigabyte club, Marathon, Speed demon, Party room, Century, Terabyte, Social butterfly, Collector), monthly stats | = |
| `lib/share/result-card.ts` | Card rendered as a view → image (`react-native-view-shot`) → share sheet; numbers only, no file names | ≈ |
| `lib/utils/*` (backoff, emitter, file-kind, format, hash, id, join-url, local-store, logger, ranges, room-code, safe-decode, sanitize-filename, dropped-files) | same (`hash` on `expo-crypto`; `local-store` → zustand persist / SQLite; `dropped-files` → picker + Android folder walk) | = / ≈ |
| `hooks/use-room-session.tsx` | same hooks | = |
| `hooks/use-countdown.ts`, `use-device.ts`, `use-network-status.ts` (NetInfo), `use-room-theme.ts` | same | = / ≈ |
| `hooks/use-wake-lock.ts` | `expo-keep-awake` while transferring | ≈ |
| `hooks/use-page-lifecycle.ts` (`beforeunload`) | leave confirmation + `AppState` handling | ≈ |
| `hooks/use-room-effects.ts` `useCelebrations`, `useBackgroundNotifications` | same, with `expo-notifications` when the app is backgrounded | ≈ |
| `hooks/use-room-effects.ts` `useKeyboardShortcuts` (paste, Ctrl+O, number keys, `?`) | "Paste" action in the send panel (`expo-clipboard`: text → text drop, image → file); hardware-keyboard shortcuts on iPad/Android tablets | ≈ |
| `scripts/check-contract.ts` | `scripts/check-contract.ts` (runs the real API + signaling clients against a live backend) | = |

### 4.4 Behaviour constants (must match)

| Constant | Value | Source |
|---|---|---|
| Max active server transfers per device | 16 (backend cap 20) | env |
| Request grouping window | 2000 ms | transfer-manager |
| Snapshot publish / tune / checkpoint | 200 ms / 1 s / 2 s | transfer-manager |
| Credit window | 3 chunks on mobile | design |
| Frame size | 16 KiB safe, 64 KiB default, 256 KiB max | adaptive-controller |
| High-water mark | 256 KiB min, 8 MiB max (memory budget may lower it) | data-channel, memory |
| Memory budgets | normal 8 MiB chunk / 4 active; constrained 2 MiB / 2; low 1 MiB / 1 | memory.ts |
| Scheduler (mobile) | global 2, per peer 1 | scheduler |
| Nacks per chunk / receiver failures | 3 / 3 | sender / receiver |
| ICE disconnect grace / recovery / polite extra / attempts / buffered candidates | 5 s / 15 s / 10 s / 3 / 64 | peer-connection |
| Idle link close | 3 min | peer-manager |
| TURN refresh margin / failure back-off | 5 min / 60 s | ice |
| Speed window / ETA delay / history | 3 s / 2 s / 30 × 1 s | progress |
| Speed test cap | 256 MiB | transfer-manager |
| Inbox / celebration merge | 200 / 1.5 s | room-session |
| Active rooms remembered | 10 | my-rooms |
| Cancel confirmation | > 100 MB while transferring/paused | transfer-card |
| Text / chat limits | 64 KiB / 2000 characters | protocol |

---

## 5. Allowed differences (platform mapping)

| Website mechanism | Native replacement | Why |
|---|---|---|
| Drag-and-drop, `<input type=file>`, `webkitdirectory` | `expo-document-picker` (any type, multiple), `expo-image-picker` (photos/videos, multiple), Android folder pick + recursive listing (paths kept for `file_open.path`) | No drag and drop on phones. **iOS has no folder picking**, so folders are sent from Android only. Receiving folders works on both (structure kept under `Received/<folder>/` via `sanitizeFolderPath`). |
| OPFS / IndexedDB / memory sinks | `Paths.cache/droply-incoming/<transferId>.part` with offset writes, moved to `Paths.document/Received/` on success | The sandbox file is the OPFS equivalent: random access, resumable, no size limit beyond the disk. |
| `showSaveFilePicker` / folder picker | Android SAF "Save into a folder" sink; iOS "Save to Files" via the share sheet | Platform storage rules (scoped storage, iOS sandbox) |
| Browser download | Open / Share / Save to Files / Downloads / Photos | Native |
| `localStorage` / `sessionStorage` | SQLite (history, records, my-rooms, resume) and SecureStore (tokens, host keys, pairing and room-link keys) | Secrets go in secure storage. Sessions survive an app restart, so rejoining works within the server's 20 s grace period / 5 min TTL. |
| Web Crypto | `expo-crypto` (`digest(SHA256, bytes)`, `digestStringAsync`, `getRandomValues`), verified in the SDK 58 docs | — |
| Web Audio synthesized sounds | Bundled tiny WAVs generated from the same parameters, played with `expo-audio` | No Web Audio |
| `navigator.vibrate` | `expo-haptics` | — |
| Screen Wake Lock | `expo-keep-awake` | — |
| `visibilitychange` / `pagehide` | `AppState` (background: flush checkpoints + resume store, pause stats; foreground: refresh room, check WS, restart ICE if disconnected) | iOS suspends apps. Transfers pause and resume on return, with a notification. Nothing claims background transfer. |
| Notifications API | `expo-notifications` (local), asked for when the user turns on the preference (same as the website) | — |
| PWA install, service worker, share target, `/icons`, manifest | Not needed (it is an app). Share target → share extension / intent filter (`expo-share-intent` config plugin or equivalent, verified in Phase 0). | — |
| "Opened in another tab" (`4011`) | "Opened on another device" | Copy only |
| Canvas result card | `react-native-view-shot` | — |
| Chromium-only "save direct to disk" | Android SAF folder sink (both platforms always have the sandbox tier) | — |

---

## 6. Look, feel and motion

### 6.1 Visual identity = website tokens
Port `../droply/app/globals.css` tokens to `src/theme/tokens.ts`, converting oklch to hex for light and dark:
`background, foreground, card, primary (oklch 0.51 0.23 277 / dark 0.67 0.19 280), secondary, muted, accent,
electric, success, warning, destructive, border, input, ring`, radius 12. Port all **8 room themes** (classic, party,
birthday, wedding, gaming, study, ocean, sunset) as token overrides: the whole room follows the theme, including
headers, buttons, sheets, background and confetti colors, at WCAG AA. Use the same Lucide icons, the logo mark (lucide
"zap" on primary), playful names with emoji avatars, and decimal units (`format.ts`).

### 6.2 Navigation
Bottom tabs **Home · Transfers · History · Settings**. Room, Join, Scan, Present, My devices, Stats, Speed test,
Privacy, About and Benchmark are stack screens. Incoming files, text drop, chat, pairing, speed test, room settings,
device actions and diagnostics are **bottom sheets** with swipe-to-dismiss.

### 6.3 Motion and haptics (Reanimated worklets + Gesture Handler + expo-haptics)
These replicate every website animation (devices joining, QR reveal, drop zone, connecting line, completion,
confetti, flight path) and add native touch feedback. They respect `useReducedMotion()` and the website's
celebrations / haptics / sound preferences. Progress is never driven by React re-renders: values live in shared
values updated ≤ 5 Hz and interpolated on the UI thread.

| Moment | Animation | Haptic |
|---|---|---|
| Launch | Splash → logo spring drop-in → Home | — |
| Send / Receive tiles, buttons | Press scale 0.96 spring + shadow lift | light |
| Receive / waiting | Radar pulse rings behind the avatar ("Waiting for another device…"), QR fade+scale, code characters stagger in | — |
| Device joins / leaves | `FadeInDown.springify()` / `FadeOutUp`, list `LinearTransition` | success |
| Connecting | Dotted line with a travelling pulse between devices, turning solid on channel open. Badge morphs to Direct / Internet / Relay. | light |
| Incoming files | Sheet springs up, Accept shimmer | warning |
| Files added | Chips pop in, swipe-to-remove with rubber band | selection |
| Transferring | Animated progress bar, rolling speed digits, live sparkline, speed gauge needle for big files, paper-plane flight path (`flyFile`) | — |
| Paused / failed | Desaturate + small shake | error |
| Complete | Ring fill → check-mark stroke draw → confetti (theme colors, small/big) + sound | success |
| New record / badge | Badge flip-in on the Stats screen, "New record!" toast | success |
| Chat / text received | Bubble slide-in, unread badge bump | light |
| Code input / scanner | Slot spring, shake on an invalid code; scanner corners lock on detect | selection / error / success |
| Tabs | Icon scale/fill + sliding pill | selection |
| Pull to refresh | Logo spring indicator | — |

Target: 60 fps on a mid-range Android, lists via FlashList with memoized rows.

---

## 7. Project structure (mirrors the website)

```
src/
  app/                       routes (§4.1)
    _layout.tsx  +not-found.tsx
    (tabs)/_layout.tsx index.tsx transfers.tsx history.tsx settings.tsx
    join/[code].tsx  r/[key].tsx  room/[roomId]/index.tsx  room/[roomId]/diagnostics.tsx
    scan.tsx present.tsx my-devices.tsx stats.tsx speed-test.tsx privacy.tsx about.tsx dev/benchmark.tsx
  components/                same groups as the website: layout/ landing/ room/ transfer/ history/ pairing/ dev/ ui/ + motion/
  config/                    brand.ts env.ts
  hooks/                     use-room-session.tsx use-countdown.ts use-device.ts use-network-status.ts use-room-theme.ts
                             use-keep-awake.ts use-leave-guard.ts use-room-effects.ts use-app-lifecycle.ts
  lib/
    api/ webrtc/ session/ storage/ media/ device/ fun/ history/ pairing/ share/ utils/   (§4.3 one-to-one)
    notifications/           expo-notifications wrapper
  theme/                     tokens.ts room-themes.ts ThemeProvider.tsx
  types/                     api.ts device.ts room.ts signaling.ts transfer.ts
assets/sounds/               send.wav receive.wav request.wav record.wav
scripts/check-contract.ts
tests/                       unit/ webrtc/ components/ (mirrors the website suites)
```

---

## 8. Phases (each ends with exit criteria; nothing is "done" without its tests)

**Phase 0 — Compatibility (no UI).** Check every library against the SDK 58 docs (`docs.expo.dev/versions/v58.0.0/`,
`llms.txt`) and RN 0.88: `react-native-webrtc` + config plugin (negotiated channels, `bufferedAmountLowThreshold`,
`getStats`, implicit `setLocalDescription`, rollback, `restartIce`, `iceTransportPolicy: relay`), NativeWind vs
`StyleSheet`, Reanimated/worklets, share-intent plugin, `react-native-view-shot`. Spikes: `FileHandle` chunk reads on
Android `content://` and iOS picker URIs without a copy; app ↔ website DataChannel throughput with 64 KiB frames.
*Exit:* `docs/compat.md` with versions and a decision on R1–R3.

**Phase 1 — Foundation.** `app.json` (Droply, scheme `droply`, bundle IDs, plugins, permission strings), `eas.json`,
env, tokens + 8 themes, ThemeProvider, UI kit, motion primitives, tabs, types, utils (ranges, format, room-code,
sanitize, backoff, emitter, file-kind, logger), jest-expo with the website's unit tests ported.
*Exit:* dev build on both OSes, lint/typecheck/tests green.

**Phase 2 — Rooms.** API client + error copy, create (theme, event), join (code / QR / deep link / host key), status,
active rooms, session store, room code / QR / countdown / share / present, leave / close / remove, room ended screens.
*Exit:* app ↔ website create and join both ways.

**Phase 3 — Signaling and presence.** SignalingClient (Origin, join-first, ping/pong, budget, close codes, backoff),
device list and presence, `room_updated` (theme follows live), expiry prompt + keepAlive, connection banner,
AppState/NetInfo. *Exit:* reconnect within 20 s shows `peer_updated`, and every close code is handled.

**Phase 4 — WebRTC.** IceServerProvider, PeerConnection (perfect negotiation, glare/restart rules, ICE buffering,
recovery ladder, relay retry), PeerManager (lazy, ref-counted, 3 min idle), ConnectionMonitor (path, quality,
`connection_state`), security code, PeerMessenger. *Exit:* phone ↔ website and phone ↔ phone channels; the security
code matches; labels are correct on Wi-Fi and LTE.

**Phase 5 — Transfers.** FileSource, PartFileSink, FileSender/FileReceiver, adaptive controller, TransferManager
(lazy creation, batches, grouping, scheduler, trust rules, storage check), incoming sheet, transfer cards + speed
graphics, save / open / share / photos, history writes. *Exit:* 1 MB, 500 MB and 2 GB+ both ways with the website,
verified, flat memory.

**Phase 6 — Reliability.** Pause / resume / retry / cancel / dismiss, checkpoints, resume after reconnect and after an
app restart (receiver from `.part` + SQLite digests; sender re-picks the file via `provideFile`), multi-recipient,
clear temporary data, storage panel. *Exit:* Wi-Fi drop and app kill scenarios resume from verified chunks.

**Phase 7 — Room extras.** Text drop + inbox, chat + unread, reactions, speed test, album + media viewer + previews
(sniffed), Save all as .zip, folders (Android send, both receive), send smaller photos, room settings (theme,
discoverable), event rooms (50 devices, grouped transfers over 19 recipients), present QR.
*Exit:* each feature works against the website.

**Phase 8 — Coming back.** Nearby rooms, My devices (pair request/accept over the DataChannel, rendezvous, auto-accept,
"Send when my device connects"), personal room link (`/r/<key>`, reset), share extension → room with pending
files/text. *Exit:* pair a phone with a browser and reconnect without a code; shared files open in a room.

**Phase 9 — Fun, history, stats.** Celebrations (confetti, sounds, haptics, flight path), history (filters, clear),
records, 9 badges, monthly Wrapped, result card sharing, preferences, notifications (background incoming / complete /
pairing). *Exit:* outputs match the website's history/badge logic tests.

**Phase 10 — Polish and dev tools.** All §6.3 animations, accessibility (labels, roles, 44 pt targets, Dynamic Type,
announcements on status changes but not per-tick progress), tablet two-column layout, diagnostics, benchmark,
privacy/about copy. *Exit:* 60 fps on a mid-range Android; VoiceOver/TalkBack pass.

**Phase 11 — Release.** EAS production builds, store metadata and privacy labels (camera for QR, photos, local
network on iOS, notifications), README, the full manual matrix.

---

## 9. Changes needed outside this repo

**Backend (`Droply-BD`) — configuration only, no code change:**
1. `WS_ALLOWED_ORIGINS=http://localhost:3000,https://<website-domain>,droply-app://mobile`. When set, it replaces
   `CORS_ORIGINS` for the socket check, so list the website too. Native `fetch` ignores CORS.
2. LAN development: `uvicorn app.main:app --reload --host 0.0.0.0` and `PUBLIC_FRONTEND_URL=http://<LAN-IP>:3000`.
   The app talks plain `ws://` on the LAN; the website on a phone still needs HTTPS as its README says.
3. Document that the Origin check is a browser (CSWSH) defence. For native clients the device token is the real
   authorization.

**Website (`droply`) — small and optional:**
1. `public/.well-known/apple-app-site-association` + `assetlinks.json` for `/join/*` and `/r/*`, so the phone camera
   opens the app when it is installed.
2. Optional "Get the app" link on the join page.

No protocol change on either side.

---

## 10. Testing (port the website's suites)

| Website suite | App suite |
|---|---|
| `tests/unit` (ranges, protocol, sanitize, format, backoff, detection, scheduler, adaptive buffer, API errors, message parsing, 121 state pairs) | `tests/unit` — same cases and fixtures |
| `tests/webrtc` (signaling: join-first, pong, backoff, close codes, budget; perfect negotiation with a fake PC: glare, early candidates, restart; pipeline: backpressure, credit, corruption, resume, pause) | `tests/webrtc` — same, with fake `react-native-webrtc` and fake `FileHandle` |
| `transfer-manager.test.ts` (2–3 managers against an in-memory backend: multi file/recipient, decline, limit, pause/resume, dropped link, cancel) | same |
| `large-transfer.test.ts` (flat memory at 64/512 MiB) | same, plus on-device profiling |
| `tests/components` | `@testing-library/react-native` for the same components |
| `scripts/check-contract.ts` (37 live checks + ws-schema match) | same script |
| Playwright e2e | Manual device matrix: Android↔Android, iPhone↔iPhone, Android↔iPhone, each ↔ website; small / 2 GB+ / 50 files / folder; code, QR, link, nearby, My devices; Wi-Fi vs LTE (relay); Wi-Fi drop; storage full; permission denial; background / kill / restart; cancel / retry; security code; theme change; room expiry / close / remove; text, chat, reactions, speed test, zip, album |

Mocked native tests are never treated as proof of real WebRTC or file-system behaviour.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `react-native-webrtc` binary throughput across the JS bridge | Benchmark in Phase 0. Tune frames up to 256 KiB. Last resort: a small Expo Module for native file ⇄ channel piping. |
| R2 | Ranged reads of `content://` / iOS picker URIs without copying | Phase 0 spike. Fallback: copy when small and space allows, or a tiny native ranged-read module. |
| R3 | NativeWind on SDK 58 | Decide in Phase 0. The `StyleSheet` + tokens fallback keeps the design. |
| R4 | iOS suspends the app | Keep-awake, banner, pause/resume with a notification (same honesty as the website's "keep this tab open"). |
| R5 | Share-extension plugin maturity | Verify in Phase 0. If it is not viable, ship without it and note the gap. |
| R6 | WS Origin mis-configuration → `4003` | Diagnostics shows the close code and the fix hint. |
| Q1 | Android foreground service so transfers continue with the screen off? | Product decision (a native-only extra beyond the website). |

---

## 12. Definition of done

Every row of §4 is implemented and checked against the website. Only §5 differences remain, and they are documented.
The phone joins the same rooms as the website (code, QR, link, nearby, My devices, room link) and exchanges files over
WebRTC with per-chunk SHA-256 plus root verification, bounded memory, real pause/resume/restart-resume, and honest
labels. Text, chat, reactions, speed test, album, zip, themes, history, stats and celebrations match the website.
Animations and haptics follow §6.3. Lint, typecheck, ported tests and the contract check pass. The README covers
setup, LAN testing, the backend env change and limitations.

---

## 13. Implementation status (2026-10-18)

Built and verified without a device:

| Check | Result |
|---|---|
| `npm run typecheck` (app compiled **without** DOM types + tests) | clean |
| `npx expo lint` | 0 errors, 0 warnings |
| `npm test` | 266 passed (website suites ported to jest-expo + native-adapter tests) |
| `npm run test:memory` | 512 MiB transfer: peak live memory 28 MiB (64 MiB: 40 MiB) |
| `npx expo export --platform android` / `ios` | both bundle to Hermes bytecode (≈ 8.2 MB) |
| `npx expo-doctor` | 19/20 (remaining: `react-native-webrtc` untested on the New Architecture, see below) |

Phase 0 findings that changed the design:

- `react-native-webrtc` 155 has negotiated channels, `bufferedAmountLowThreshold`/`bufferedamountlow`,
  `restartIce`, implicit `setLocalDescription`, `iceTransportPolicy: "relay"` and `getStats` — the
  website's protocol ports as is.
- Its `bufferedAmount` only updates from native events (not synchronously on `send()`), so
  `DataChannelTransport` keeps an optimistic count; tested in `tests/unit/native-adapters.test.ts`.
- It has no `pc.sctp`: the frame size uses the remote SDP's `a=max-message-size` (what browsers
  derive `sctp.maxMessageSize` from) instead of falling back to 16 KiB.
- It sends binary frames across the bridge as Base64 internally (risk R1 confirmed); measure with
  the in-app benchmark.
- `expo-media-library` 58's `saveToLibraryAsync` now throws; "Save to Photos" uses `Asset.create()`.
- React Native's WebSocket needs an explicit `Origin` header (§0 #11); Settings → Diagnostics
  verifies the backend accepts it.

Implemented: every row of §4 except the items below. Allowed differences are as listed in §5.

Not done (needs a decision or information):

- **Share to Droply** (share extension): needs a third-party config plugin; not added.
- **Universal/App Links** for `https://<website>/join/*` and `/r/*`: needs the production domain
  and Apple team ID, plus `.well-known` files on the website. `droply://` links and QR work.
- **Backend `.env`**: `WS_ALLOWED_ORIGINS` must include `droply-app://mobile` (README → Backend
  configuration). Not edited from here because it's another repository's local secret file.
- **On-device verification**: the manual matrix in §10 (phone ↔ website, phone ↔ phone, relay,
  restart-resume, permissions) has not been run; it needs real devices and a development build.
