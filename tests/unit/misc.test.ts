import { Backoff, SIGNALING_BACKOFF } from "@/lib/utils/backoff";
import { detectFrom } from "@/lib/device/detection";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/utils/room-code";
import { creationSlots, pickStartable, schedulerLimits } from "@/lib/webrtc/scheduler";
import { AdaptiveController, chooseChunkSize, defaultTuning } from "@/lib/webrtc/adaptive-controller";
import { MAX_HIGH_WATER } from "@/lib/webrtc/data-channel";
import { classifyPath, qualityFromStats } from "@/lib/webrtc/connection-monitor";

describe("Backoff", () => {
  it("grows exponentially, is capped, and gives up", () => {
    const backoff = new Backoff({ ...SIGNALING_BACKOFF, jitter: 0, maxAttempts: 7 }, () => 0.5);
    const delays = Array.from({ length: 8 }, () => backoff.next());
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 16000, 16000, null]);
    backoff.reset();
    expect(backoff.next()).toBe(500);
  });

  it("applies jitter within bounds", () => {
    const low = new Backoff({ ...SIGNALING_BACKOFF }, () => 0).next()!;
    const high = new Backoff({ ...SIGNALING_BACKOFF }, () => 1).next()!;
    expect(low).toBe(400);
    expect(high).toBe(600);
  });
});

describe("detectDevice", () => {
  const base = { maxTouchPoints: 0, screenShortSide: 1080 };
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1", 5, "phone", "iOS", "Safari"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", 5, "tablet", "iPadOS", "Safari"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", 0, "laptop", "macOS", "Chrome"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36", 5, "phone", "Android", "Chrome"],
    ["Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", 5, "tablet", "Android", "Chrome"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0", 0, "desktop", "Windows", "Edge"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", 0, "desktop", "Linux", "Firefox"],
  ])("%s", (ua, touch, type, os, browser) => {
    expect(detectFrom({ ...base, userAgent: ua, maxTouchPoints: touch })).toEqual({ type, os, browser });
  });
});

describe("room codes", () => {
  it("normalizes pasted codes to the backend alphabet", () => {
    expect(normalizeRoomCode("k7x-9pq")).toBe("K7X9PQ");
    expect(normalizeRoomCode(" K7X 9PQ ")).toBe("K7X9PQ");
    expect(isValidRoomCode("K7X9PQ")).toBe(true);
    expect(isValidRoomCode("K7X9P")).toBe(false);
    // O, 0, I, 1 and L are not in the alphabet.
    expect(normalizeRoomCode("O0I1L")).toBe("");
  });
});

describe("scheduler", () => {
  it("starts oldest first within global and per-peer limits", () => {
    const limits = schedulerLimits(false);
    const waiting = [
      { key: "c", peerId: "B", order: 3 },
      { key: "a", peerId: "A", order: 1 },
      { key: "b", peerId: "A", order: 2 },
      { key: "d", peerId: "A", order: 4 },
      { key: "e", peerId: "C", order: 5 },
    ];
    const picked = pickStartable(waiting, [{ peerId: "C" }], limits).map((c) => c.key);
    // A gets 2 (per-peer limit), B 1, then the global limit of 4 is reached.
    expect(picked).toEqual(["a", "b", "c"]);
  });

  it("is stricter on mobile and respects the server transfer limit", () => {
    expect(schedulerLimits(true)).toEqual({ global: 2, perPeer: 1 });
    expect(creationSlots(14, 16)).toBe(2);
    expect(creationSlots(20, 16)).toBe(0);
  });
});

describe("adaptive transfer", () => {
  it("picks chunk sizes from measured throughput, within server bounds", () => {
    const bounds = { recommended: 4 * 1024 * 1024, min: 16 * 1024, max: 64 * 1024 * 1024 };
    expect(chooseChunkSize(null, bounds)).toBe(4 * 1024 * 1024);
    expect(chooseChunkSize(1_000_000, bounds)).toBe(1024 * 1024);
    expect(chooseChunkSize(100_000_000, bounds)).toBe(8 * 1024 * 1024);
    expect(chooseChunkSize(100_000_000, { ...bounds, max: 2 * 1024 * 1024 })).toBe(2 * 1024 * 1024);
  });

  it("uses safe frames when the max message size is unknown", () => {
    expect(defaultTuning(null, false).frameSize).toBe(16 * 1024);
    expect(defaultTuning(262_144, false).frameSize).toBe(64 * 1024);
    expect(defaultTuning(262_144, true).window).toBe(3);
  });

  it("does not grow the buffer without measurements", () => {
    const controller = new AdaptiveController(defaultTuning(262_144, false));
    const start = controller.currentHighWater;
    // No RTT known yet: never grows, even when the sender is blocked.
    let bytes = 0;
    for (let t = 0; t <= 5000; t += 500) {
      bytes += 5_000_000;
      controller.sample({ bytesQueued: bytes, bufferedAmount: 1024, senderBlocked: true, now: t });
    }
    expect(controller.currentHighWater).toBe(start);
  });

  it("grows toward 2×BDP when blocked, but never past the hard cap", () => {
    const controller = new AdaptiveController(defaultTuning(262_144, false));
    controller.setRtt(200);
    let bytes = 0;
    let rate = 10_000_000;
    for (let t = 0; t <= 20_000; t += 1000) {
      bytes += rate;
      rate *= 1.2;
      controller.sample({ bytesQueued: bytes, bufferedAmount: 0, senderBlocked: true, now: t });
    }
    expect(controller.currentHighWater).toBeGreaterThan(1024 * 1024);
    expect(controller.currentHighWater).toBeLessThanOrEqual(MAX_HIGH_WATER);
  });

  it("halves the buffer on a stall", () => {
    const controller = new AdaptiveController(defaultTuning(262_144, false));
    const start = controller.currentHighWater;
    controller.sample({ bytesQueued: 1000, bufferedAmount: 1000, senderBlocked: true, now: 0 });
    for (let t = 1000; t <= 4000; t += 1000) {
      controller.sample({ bytesQueued: 1000, bufferedAmount: 1000, senderBlocked: true, now: t });
    }
    expect(controller.currentHighWater).toBe(start / 2);
  });
});

describe("connection path", () => {
  const c = (candidateType: string, address = "203.0.113.5") => ({ id: "x", type: "local-candidate", candidateType, address });
  it("only claims direct when stats say so", () => {
    expect(classifyPath(c("host", "192.168.1.4"), c("host", "192.168.1.9"))).toBe("lan");
    expect(classifyPath(c("srflx"), c("srflx"))).toBe("direct");
    expect(classifyPath(c("host", "192.168.1.4"), c("prflx", "192.168.1.9"))).toBe("lan");
    expect(classifyPath(c("relay"), c("host"))).toBe("relay");
    expect(classifyPath(undefined, c("host"))).toBe("unknown");
  });

  it("rates quality from RTT only", () => {
    expect(qualityFromStats(12, false)).toBe("excellent");
    expect(qualityFromStats(90, false)).toBe("good");
    expect(qualityFromStats(400, false)).toBe("weak");
    expect(qualityFromStats(null, false)).toBeNull();
    expect(qualityFromStats(12, true)).toBe("weak");
  });
});
