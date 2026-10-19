# Build SwiftDrop — Native Android and iOS App

## 1. Project Overview

Build **SwiftDrop**, a fast, secure, cross-platform file-sharing mobile application for **Android and iOS**, using React Native and TypeScript.

SwiftDrop allows users to transfer files directly between supported devices, including:

- Android phones and tablets
- iPhones and iPads
- Windows and macOS computers
- The existing SwiftDrop web application

The experience should be inspired by AirDrop and Quick Share: discover or connect to another device, select files, accept the transfer, and send files directly between peers.

This is a real, production-oriented application, not a static UI prototype.

## 2. Required Technology Stack

Use the following stack:

- **React Native** with Expo and TypeScript.
- **Expo Router** for navigation.
- **NativeWind** and Tailwind CSS conventions for styling where compatible.
- **React Native Reanimated** for animations.
- **Lucide React Native** for icons.
- **Zustand** for lightweight application and transfer state.
- **TanStack Query** for API requests and server state where appropriate.
- **Expo SecureStore** for sensitive local configuration or credentials, if needed.
- **Expo FileSystem** or a compatible maintained native file-system library for file access and storage.
- A compatible native document picker for selecting files.
- A compatible image picker for photos and videos.
- A QR-code scanner for joining transfer rooms.
- A compatible **React Native WebRTC implementation** for peer-to-peer connections.
- WebSockets for signaling through the existing FastAPI backend.

Before implementing, verify the current compatibility of Expo, React Native WebRTC, file-system libraries, and required native modules. Use an Expo development build or native prebuild workflow where necessary. Do not assume the application will work inside Expo Go.

Avoid unnecessary dependencies and document any native configuration required.

## 3. Existing Backend Integration

Connect to the existing SwiftDrop FastAPI backend and WebSocket signaling server.

Use these environment variables:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_WS_URL`

Example local development values:

- API: `http://192.168.1.100:8000`
- WebSocket: `ws://192.168.1.100:8000/<actual-signaling-path>`

The IP address is an example. Use the developer machine's actual LAN IP when testing on physical devices. A phone cannot normally reach a development server through `localhost` on the phone itself.

### Backend integration rules

1. Inspect the existing backend source code and API documentation before implementing integration.
2. Reuse the actual API endpoints, WebSocket routes, message schemas, authentication rules, room identifiers, and error responses.
3. Do not invent endpoints or signaling message formats when the backend already defines them.
4. If an essential endpoint or protocol is missing, document the gap and propose the smallest compatible backend change.
5. Keep the mobile app compatible with the existing SwiftDrop website.
6. Never send file contents through ordinary FastAPI upload endpoints when a direct WebRTC connection is available.
7. Use FastAPI for signaling, room coordination, device metadata, and transfer coordination—not as the default route for file bytes.

The mobile app and website must be able to participate in the same transfer room and communicate through the same signaling protocol.

## 4. Application Screens

### A. Home screen

Create a polished home screen featuring:

- SwiftDrop branding.
- A prominent **Send Files** action.
- A prominent **Receive Files** action.
- Create Room and Join Room actions, if supported by the backend.
- Nearby or connected device status where supported.
- Recent transfers.
- Connection status.
- Settings access.

Display a clear explanation when local network connectivity or peer connectivity is unavailable.

### B. Send files

Allow users to select files using the native file picker.

Support, where permitted by the platform:

- Photos
- Videos
- Audio files
- PDFs
- Documents
- ZIP archives
- Other file types supported by the operating system

Show selected files with their names, types, sizes, and removal controls.

Display the total number and size of selected files before starting a transfer.

Do not load entire large files into JavaScript memory. Use file-backed access and chunked reads wherever the native library supports them.

### C. Receive files

Provide a clear receiving interface with:

- Device name.
- Room or pairing code.
- QR code for joining a room, when supported.
- Connection status.
- Incoming transfer requests.
- Accept and decline actions.

Never automatically accept files from unknown devices.

### D. Device connection

Support the connection methods implemented by the backend:

- Room codes.
- QR-code pairing.
- Join links or deep links, if supported.
- Device lists for peers already in a shared room.

Show useful device information such as device name and platform.

Do not claim that React Native can continuously discover arbitrary nearby devices without the necessary discovery mechanism and platform permissions. Implement the discovery mechanism the existing system supports, and clearly distinguish room-based availability from physical proximity discovery.

### E. Active transfers

Display active transfers with:

- File name.
- Sender and receiver.
- File size.
- Bytes transferred.
- Percentage complete.
- Transfer speed.
- Estimated remaining time, when a reliable estimate is available.
- Pause, resume, or cancel controls where genuinely supported.

Support multiple files in a transfer queue.

Keep the UI responsive during large transfers.

### F. Transfer history

Show completed, failed, cancelled, and interrupted transfers.

Persist appropriate local history, including:

- File name.
- File size.
- Date and time.
- Transfer direction.
- Final status.

Avoid storing file contents or unnecessary sensitive information in transfer history.

### G. Settings

Include:

- Editable device display name.
- Theme preference.
- Automatic or manual file acceptance preference, defaulting to manual acceptance for unknown devices.
- Transfer notifications.
- Privacy and security information.
- Backend connection diagnostics.
- Application version.
- Clear transfer history.

Only include settings that actually work.

## 5. WebRTC Peer-to-Peer Transfers

Implement real peer-to-peer file transfers using WebRTC.

The FastAPI backend should exchange signaling messages and coordinate room membership. Once the peer connection is established, file data should travel directly between the sender and receiver over a WebRTC DataChannel whenever network conditions permit.

Implement:

- RTCPeerConnection lifecycle management.
- ICE candidate exchange.
- Connection establishment and failure handling.
- DataChannel creation and lifecycle management.
- Reliable ordered data transfer for file contents.
- Connection timeouts.
- Cleanup of closed peer connections.
- Reconnection or retry flows where feasible.

Use the same signaling semantics as the existing SwiftDrop web client.

Do not assume that connecting to the signaling server means the devices can exchange files. Verify that the peer connection and DataChannel are actually established.

### STUN and TURN

Use the existing SwiftDrop ICE server configuration.

Support STUN for connection discovery and TURN relay fallback when direct connectivity fails.

Retrieve credentials securely where the backend provides temporary TURN credentials. Never embed permanent TURN credentials or server secrets in the mobile app.

Display useful connection states such as:

- Connecting
- Waiting for peer
- Establishing secure connection
- Connected directly
- Connected through relay, when reliably detectable
- Connection failed

Document that TURN relays can incur bandwidth costs and that some networks may require relay connectivity.

## 6. Large-File Transfer Engine

Implement a dedicated, reusable transfer engine rather than placing WebRTC logic directly inside screen components.

### Chunked file transmission

- Read files in bounded chunks using native file APIs.
- Send chunks through the WebRTC DataChannel.
- Include transfer IDs, file IDs, chunk indexes, and sufficient metadata to validate the transfer.
- Reassemble files correctly on the receiving device.
- Preserve the original file name and supported file metadata.
- Verify the completed file size and, where feasible, a cryptographic checksum.
- Handle zero-byte files and interrupted transfers.
- Avoid keeping the entire file or every chunk in memory.

Choose chunk sizes based on actual DataChannel constraints and performance testing. Do not assume that very large DataChannel messages are safe on all devices.

### Backpressure and memory management

Implement DataChannel backpressure using `bufferedAmount` and `bufferedAmountLowThreshold` where supported.

Stop scheduling new chunks when the outgoing buffer reaches the configured high-water mark, and resume when it drains.

Use bounded queues and make buffer limits configurable.

The transfer engine must not overwhelm the JavaScript thread, native bridge, device memory, or receiving storage.

### Resume and retry

Design transfers so they can recover from temporary interruptions when the peer and underlying file data are still available.

Track successfully received chunks and request missing chunks when the protocol supports it.

If a connection drops:

- Preserve safe partial-transfer metadata where practical.
- Show the interrupted state.
- Allow the user to retry.
- Resume from verified chunks when both peers and their files remain available.
- Otherwise restart cleanly and explain why.

Do not advertise resumability unless it is implemented and tested end to end. Define any required signaling protocol changes explicitly and keep them compatible with the website.

## 7. Receiving and Saving Files

Save received files using platform-appropriate APIs.

On Android and iOS:

- Request only the permissions necessary for the requested action.
- Use document-picker and share-sheet integrations where appropriate.
- Respect iOS sandbox restrictions.
- Respect Android scoped storage and applicable storage-access restrictions.
- Allow users to export or share received files.
- Provide a clear completion action.
- Clean up temporary files after failed or cancelled transfers when safe.

Do not assume an application can silently write arbitrary files to every location on either operating system.

Handle insufficient storage, permission denial, unsupported file types, and interrupted writes gracefully.

## 8. Security and Privacy

Implement security throughout the transfer flow.

- Validate incoming signaling messages and transfer metadata.
- Require explicit user approval before accepting files from unknown peers.
- Set sensible file-size and resource limits.
- Sanitize file names before creating local files.
- Prevent path traversal and unsafe file-path construction.
- Handle malformed chunks, unexpected transfer IDs, and out-of-order messages safely.
- Avoid exposing sensitive information in logs.
- Never log file contents, authentication tokens, or temporary TURN credentials.
- Keep API and WebSocket configuration environment-specific.
- Use HTTPS and secure WebSockets in production.
- Do not trust device names or other peer-provided metadata.
- Explain the connection and transfer security model accurately.

WebRTC encrypts its transport, but this does not automatically mean the application provides end-to-end identity verification against every possible signaling compromise. Document the security assumptions and any additional authentication or verification implemented.

## 9. Mobile Lifecycle and Notifications

Handle real mobile lifecycle behavior.

Implement:

- App backgrounding and foregrounding.
- Screen navigation while a transfer is running.
- Network changes.
- Wi-Fi disconnects.
- Peer disconnections.
- WebSocket reconnection.
- Transfer cancellation during cleanup.
- Storage permission failures.
- App restarts during interrupted transfers.

Do not assume WebRTC transfers will continue indefinitely when iOS or Android suspends the application.

Use native background-transfer capabilities only where appropriate and supported. If a transfer cannot continue in the background, preserve its state where practical and explain that the user may need to reopen the app.

Use local notifications for important transfer events when configured and supported. Request notification permission contextually and handle denial gracefully.

## 10. User Interface and Experience

Create a polished, modern interface suitable for both Android and iOS.

Design requirements:

- Mobile-first layouts.
- Clear typography and visual hierarchy.
- Consistent spacing and reusable components.
- Rounded cards and subtle shadows.
- Smooth, restrained animations.
- Light and dark themes.
- Accessible touch targets.
- Screen-reader labels.
- Safe-area handling.
- Responsive layouts for phones and tablets.
- Loading, empty, error, and success states.
- Confirmation before destructive actions.

Use a consistent visual identity for SwiftDrop. Avoid copying Apple's proprietary interface exactly.

Prioritize fast access to Send and Receive. A user should be able to start a transfer with minimal navigation.

## 11. Architecture and Project Structure

Organize the project into clear modules. Adapt the exact structure to the existing repository rather than duplicating infrastructure unnecessarily.

Suggested structure:

- `app/` — Expo Router screens and navigation.
- `components/` — reusable UI components.
- `features/connection/` — room joining and peer connections.
- `features/transfers/` — transfer queue and progress UI.
- `services/api/` — HTTP client and API integration.
- `services/signaling/` — WebSocket signaling.
- `services/webrtc/` — peer connection and DataChannel lifecycle.
- `services/files/` — file selection, chunked reads, saving, and checksums.
- `services/notifications/` — notification handling.
- `stores/` — Zustand stores.
- `hooks/` — reusable React hooks.
- `types/` — shared application types.
- `utils/` — validation, formatting, and safe file-name handling.
- `tests/` — unit and integration tests.

Keep networking, WebRTC, file-system access, transfer state, and presentation separate.

Use strict TypeScript. Avoid `any` unless absolutely necessary and justified.

## 12. Testing Requirements

Write automated tests for the parts that can be tested independently, including:

- API client behavior.
- WebSocket message validation.
- Transfer-state transitions.
- File metadata validation.
- Chunk sequencing and reassembly.
- Progress calculation.
- Cancellation and cleanup.
- Retry and resume behavior.
- Error handling.
- Store updates.
- File-name sanitization.

Mock native modules where necessary for unit tests, but do not treat mocked tests as proof of real WebRTC functionality.

Also create a manual integration test plan covering:

1. Android to Android.
2. iPhone to iPhone.
3. Android to iPhone.
4. Android to the SwiftDrop website.
5. iPhone to the SwiftDrop website.
6. Small files.
7. Large files.
8. Multiple files.
9. QR-code or room-code pairing.
10. Direct connectivity and TURN relay fallback.
11. Wi-Fi disconnection during transfer.
12. Insufficient storage.
13. Permission denial.
14. Backgrounding and reopening the app.
15. Cancellation and retry.

Test on real devices wherever native WebRTC and file-system behavior is involved.

## 13. Build and Development Workflow

Provide instructions for:

- Installing dependencies.
- Configuring environment variables.
- Starting Expo.
- Creating an Android development build.
- Creating an iOS development build.
- Running the app on physical devices.
- Configuring local network access.
- Connecting to the existing FastAPI backend.
- Running tests.
- Building production Android and iOS releases.

Use EAS Build if appropriate for the project.

Document the iOS build requirements, including the need for macOS/Xcode or a suitable cloud build service for native iOS builds.

Do not commit secrets, signing credentials, or private TURN credentials.

## 14. Implementation Rules

Before making changes:

1. Inspect the existing repository and backend API.
2. Identify the current signaling protocol and its message schemas.
3. Confirm which React Native WebRTC and file-system libraries are compatible with the selected Expo and React Native versions.
4. Identify any required backend or website changes.
5. Produce a short implementation plan.
6. Implement the application in small, testable phases.

Do not stop after creating screens or generating placeholder functions.

Build a functioning end-to-end transfer flow first, then expand the application.

Do not replace working backend logic or alter the website protocol without explaining why.

Do not claim a feature is complete unless its implementation and relevant tests support that claim.

## 15. Acceptance Criteria

The application is ready for an initial working release when:

- Android and iOS builds can be produced.
- Users can connect through the existing SwiftDrop room and signaling system.
- Mobile devices can exchange files with supported SwiftDrop web clients.
- Files travel over WebRTC DataChannels rather than being uploaded to FastAPI by default.
- Transfers show meaningful progress and completion status.
- Received files can be accessed or exported using supported native APIs.
- Large transfers use bounded chunking and backpressure.
- Connection failures, storage errors, and permission problems are handled gracefully.
- The app does not claim unsupported background transfer or resumability.
- The project includes setup instructions, tests, and documented limitations.

**Start by inspecting the existing SwiftDrop repository and backend, then implement the mobile application to match the real API and signaling protocol.**