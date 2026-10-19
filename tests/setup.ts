// Native modules are replaced by in-memory fakes (tests/mocks/native.ts).
jest.mock("expo-file-system", () => jest.requireActual("./mocks/native").fileSystemMock);
jest.mock("expo-crypto", () => jest.requireActual("./mocks/native").cryptoMock);
jest.mock("expo-sqlite/kv-store", () => jest.requireActual("./mocks/native").kvMock);
jest.mock("expo-secure-store", () => jest.requireActual("./mocks/native").secureStoreMock);
// SQLite unavailable in tests: the resume store falls back to memory.
jest.mock("expo-sqlite", () => ({ openDatabaseAsync: () => Promise.reject(new Error("no sqlite in tests")) }));
jest.mock("react-native-webrtc", () => ({ RTCPeerConnection: class {} }));
jest.mock("expo-haptics", () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
jest.mock("expo-audio", () => ({ createAudioPlayer: () => ({ seekTo: () => Promise.resolve(), play: () => undefined }) }));
jest.mock("expo-device", () => ({ deviceType: 1, DeviceType: { PHONE: 1, TABLET: 2 }, totalMemory: 6 * 1024 ** 3 }));
jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: () => Promise.resolve(false), shareAsync: () => Promise.resolve() }));
jest.mock("expo-media-library", () => ({ requestPermissionsAsync: () => Promise.resolve({ granted: false }), saveToLibraryAsync: () => Promise.resolve() }));
jest.mock("expo-image-manipulator", () => ({ ImageManipulator: { manipulate: () => ({}) }, SaveFormat: { JPEG: "jpeg" } }));
jest.mock("expo-video-thumbnails", () => ({ getThumbnailAsync: () => Promise.reject(new Error("n/a")) }));
jest.mock("expo-notifications", () => ({}));
