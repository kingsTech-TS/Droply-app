import { formatBytes, formatCountdown, formatDuration, formatPercent, formatRoomCode, formatSpeed } from "@/lib/utils/format";

describe("format (decimal units everywhere)", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(4_000_000)).toBe("4.00 MB");
    expect(formatBytes(2_800_000_000)).toBe("2.80 GB");
    expect(formatBytes(87_400_000)).toBe("87.4 MB");
    expect(formatBytes(-1)).toBe("—");
  });

  it("formats speed and never invents one", () => {
    expect(formatSpeed(87_400_000)).toBe("87.4 MB/s");
    expect(formatSpeed(null)).toBe("—");
    expect(formatSpeed(0)).toBe("—");
  });

  it("formats durations", () => {
    expect(formatDuration(6)).toBe("6 seconds");
    expect(formatDuration(1)).toBe("1 second");
    expect(formatDuration(90)).toBe("1 min 30 s");
    expect(formatDuration(3720)).toBe("1 h 2 min");
    expect(formatDuration(null)).toBe("—");
  });

  it("never rounds progress up to 100% early", () => {
    expect(formatPercent(0.996)).toBe("99%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.82)).toBe("82%");
  });

  it("formats countdowns and room codes", () => {
    expect(formatCountdown(522_000)).toBe("08:42");
    expect(formatCountdown(3_723_000)).toBe("1:02:03");
    expect(formatCountdown(-5)).toBe("00:00");
    expect(formatRoomCode("k7x9pq")).toBe("K7X 9PQ");
  });
});
