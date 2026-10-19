// Synthetic loopback benchmark (website: /dev/benchmark), gated by EXPO_PUBLIC_ENABLE_BENCHMARK.
// Two native RTCPeerConnections inside the app; bytes are generated, hashed, sent through the
// real FileSender/FileReceiver, verified and discarded — this measures the WebRTC + bridge
// pipeline on this phone (the disk is not involved).
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { env } from "@/config/env";
import { formatBytes, formatDuration, formatSpeed } from "@/lib/utils/format";
import { SyntheticSource, totalChunks } from "@/lib/webrtc/chunk-manager";
import { parseStats, type LinkStats } from "@/lib/webrtc/connection-monitor";
import { DataChannelTransport, type DataChannelLike } from "@/lib/webrtc/data-channel";
import { FileReceiver } from "@/lib/webrtc/file-receiver";
import { FileSender } from "@/lib/webrtc/file-sender";
import { createNativePeerConnection, type RTCPeerConnection } from "@/lib/webrtc/rtc";
import { DiscardSink } from "@/lib/storage/sinks/discard-sink";
import { space } from "@/theme/tokens";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Screen } from "@/components/ui/screen";
import { EmptyState, SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

interface Settings {
  sizeMb: number;
  chunkKb: number;
  frameKb: number;
  highWaterKb: number;
  window: number;
  files: number;
}

interface Live {
  verified: number;
  total: number;
  elapsedMs: number;
  bufferedAmount: number;
  stats: LinkStats | null;
  done: boolean;
  error: string | null;
}

const MiB = 1024 * 1024;

async function connectLoopback(): Promise<{ a: RTCPeerConnection; b: RTCPeerConnection; ca: DataChannelLike; cb: DataChannelLike }> {
  const a = createNativePeerConnection({});
  const b = createNativePeerConnection({});
  a.onicecandidate = (e) => {
    if (e.candidate) void b.addIceCandidate(e.candidate.toJSON?.() ?? e.candidate);
  };
  b.onicecandidate = (e) => {
    if (e.candidate) void a.addIceCandidate(e.candidate.toJSON?.() ?? e.candidate);
  };
  const ca = a.createDataChannel("bench", { negotiated: true, id: 0, ordered: true });
  const cb = b.createDataChannel("bench", { negotiated: true, id: 0, ordered: true });
  await a.setLocalDescription();
  await b.setRemoteDescription({ type: "offer", sdp: a.localDescription!.sdp });
  await b.setLocalDescription();
  await a.setRemoteDescription({ type: "answer", sdp: b.localDescription!.sdp });
  await Promise.all(
    [ca, cb].map(
      (c) =>
        new Promise<void>((resolve, reject) => {
          if (c.readyState === "open") resolve();
          c.addEventListener("open", () => resolve());
          setTimeout(() => reject(new Error("DataChannel did not open")), 10_000);
        }),
    ),
  );
  return { a, b, ca, cb };
}

export default function BenchmarkScreen() {
  const [settings, setSettings] = useState<Settings>({ sizeMb: 256, chunkKb: 4096, frameKb: 64, highWaterKb: 1024, window: 3, files: 1 });
  const [live, setLive] = useState<Live | null>(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);

  if (!env.benchmarkEnabled) {
    return (
      <Screen title="Benchmark" back>
        <EmptyState title="The benchmark is turned off." body="Set EXPO_PUBLIC_ENABLE_BENCHMARK=true for this build." />
      </Screen>
    );
  }

  const field = (key: keyof Settings, label: string, min: number, max: number) => (
    <View key={key} style={{ width: "48%" }}>
      <Input
        label={label}
        keyboardType="number-pad"
        value={String(settings[key])}
        editable={!running}
        onChangeText={(v) => setSettings((s) => ({ ...s, [key]: Math.min(max, Math.max(min, Number(v) || min)) }))}
      />
    </View>
  );

  const run = async () => {
    setRunning(true);
    const size = settings.sizeMb * MiB;
    const chunkSize = settings.chunkKb * 1024;
    const total = size * settings.files;
    const verifiedBySlot = new Map<number, number>();
    const started = performance.now();
    let stopped = false;
    let link: Awaited<ReturnType<typeof connectLoopback>> | null = null;
    let statsTimer: ReturnType<typeof setInterval> | null = null;
    let latestStats: LinkStats | null = null;
    stopRef.current = () => {
      stopped = true;
    };
    setLive({ verified: 0, total, elapsedMs: 0, bufferedAmount: 0, stats: null, done: false, error: null });
    try {
      link = await connectLoopback();
      const tx = new DataChannelTransport(link.ca, settings.highWaterKb * 1024);
      const rx = new DataChannelTransport(link.cb);
      const receivers = new Map<number, FileReceiver>();
      const senders = new Map<number, FileSender>();
      tx.events.on("ctl", (ctl) => {
        if ("slot" in ctl) senders.get(ctl.slot)?.handleCtl(ctl);
      });
      rx.events.on("frame", (frame) => receivers.get(frame.slot)?.handleFrame(frame));
      rx.events.on("ctl", (ctl) => {
        if (ctl.t === "file_open") {
          const receiver = new FileReceiver({
            transport: rx,
            slot: ctl.slot,
            transferId: ctl.transferId,
            size: ctl.size,
            chunkSize: ctl.chunkSize,
            totalChunks: ctl.totalChunks,
            window: settings.window,
            sink: new DiscardSink(),
            digests: new Map(),
            persistDigest: async () => {},
          });
          receivers.set(ctl.slot, receiver);
          void receiver.start();
        } else if ("slot" in ctl) {
          receivers.get(ctl.slot)?.handleCtl(ctl);
        }
      });
      const pc = link.a;
      statsTimer = setInterval(() => {
        void pc.getStats().then((report) => {
          latestStats = parseStats(report);
          const verified = [...verifiedBySlot.values()].reduce((x, y) => x + y, 0);
          setLive({ verified, total, elapsedMs: performance.now() - started, bufferedAmount: tx.bufferedAmount, stats: latestStats, done: false, error: null });
          if (stopped) for (const s of senders.values()) s.stop("cancelled");
        });
      }, 500);
      const runs = Array.from({ length: settings.files }, (_, i) => {
        const slot = i + 1;
        const sender = new FileSender({
          transport: tx,
          slot,
          transferId: `tr_benchmark_${slot}`,
          source: new SyntheticSource(size, slot),
          chunkSize,
          totalChunks: totalChunks(size, chunkSize),
          frameSize: settings.frameKb * 1024,
          window: settings.window,
          onProgress: (bytes) => verifiedBySlot.set(slot, bytes),
        });
        senders.set(slot, sender);
        return sender.run();
      });
      const results = await Promise.all(runs);
      const failed = results.find((r) => r.kind !== "done");
      const verified = [...verifiedBySlot.values()].reduce((x, y) => x + y, 0);
      setLive({ verified, total, elapsedMs: performance.now() - started, bufferedAmount: 0, stats: latestStats, done: true, error: failed ? `Stopped: ${failed.kind}` : null });
    } catch (error) {
      setLive((current) => ({ ...(current ?? { verified: 0, total, elapsedMs: 0, bufferedAmount: 0, stats: null }), done: true, error: String(error) }));
    } finally {
      if (statsTimer) clearInterval(statsTimer);
      link?.a.close();
      link?.b.close();
      stopRef.current = null;
      setRunning(false);
    }
  };

  const throughput = live && live.elapsedMs > 0 ? (live.verified * 1000) / live.elapsedMs : null;
  const remaining = live && throughput ? (live.total - live.verified) / throughput : null;

  return (
    <Screen title="Benchmark" subtitle="Synthetic loopback transfer through the real sender and receiver." back>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: space.md }}>
          {field("sizeMb", "File size (MiB)", 1, 20480)}
          {field("files", "Concurrent files", 1, 8)}
          {field("chunkKb", "Chunk size (KiB)", 16, 65536)}
          {field("frameKb", "Frame size (KiB)", 1, 256)}
          {field("highWaterKb", "Buffer threshold (KiB)", 256, 8192)}
          {field("window", "Credit window (chunks)", 1, 32)}
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label={running ? "Running…" : "Start"} onPress={() => void run()} disabled={running} style={{ flex: 1 }} />
          <Button label="Stop" variant="outline" onPress={() => stopRef.current?.()} disabled={!running} style={{ flex: 1 }} />
        </View>
      </Card>
      <SectionHeader title="Connection" />
      <Card style={{ gap: space.sm }}>
        {live ? (
          <>
            <ProgressBar value={live.verified / Math.max(1, live.total)} active={!live.done} accessibilityLabel="Benchmark progress" />
            {[
              ["Type", live.stats ? `${live.stats.path} (${live.stats.localCandidateType ?? "?"} → ${live.stats.remoteCandidateType ?? "?"})` : "—"],
              ["RTT", live.stats?.rttMs != null ? `${live.stats.rttMs} ms` : "—"],
              ["Throughput", formatSpeed(throughput)],
              ["Buffered amount", formatBytes(live.bufferedAmount)],
              ["Packet loss", "n/a (not exposed for data channels)"],
              ["Verified", `${formatBytes(live.verified)} / ${formatBytes(live.total)}`],
              ["Elapsed", formatDuration(live.elapsedMs / 1000)],
              ["Remaining", live.done ? "—" : formatDuration(remaining)],
            ].map(([label, value]) => (
              <View key={label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text variant="footnote" tone="muted">
                  {label}
                </Text>
                <Text variant="footnote" style={{ fontWeight: "600" }}>
                  {value}
                </Text>
              </View>
            ))}
            {live.done ? (
              <Text variant="footnote" tone={live.error ? "destructive" : "success"} accessibilityLiveRegion="polite">
                {live.error ?? `Done: ${formatSpeed(throughput)} average over ${formatDuration(live.elapsedMs / 1000)}`}
              </Text>
            ) : null}
          </>
        ) : (
          <Text tone="muted">Press Start to measure.</Text>
        )}
      </Card>
    </Screen>
  );
}
