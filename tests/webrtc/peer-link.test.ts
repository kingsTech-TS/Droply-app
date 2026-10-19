import type { RTCPeerConnection as AppPeerConnection } from "@/lib/webrtc/rtc";
import { IceServerProvider } from "@/lib/webrtc/ice";
import { PeerLink } from "@/lib/webrtc/peer-connection";
import type { DataChannelTransport } from "@/lib/webrtc/data-channel";
import type { ClientMessage } from "@/types/signaling";
import { FakeRTCPeerConnection, resetFakePeerConnections } from "../mocks/fake-peer-connection";

const A = "dv_aaaaaaaaaaaaaaaaaaaa";
const B = "dv_bbbbbbbbbbbbbbbbbbbb";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await tick(2);
  }
}

interface Side {
  link: PeerLink;
  pcs: FakeRTCPeerConnection[];
  transports: DataChannelTransport[];
  lost: number;
  sent: ClientMessage[];
}

/** Two PeerLinks wired through an in-order "signaling server". */
function pair(options: { holdCandidatesFor?: string } = {}) {
  const sides = {} as Record<"a" | "b", Side>;
  const held: Array<() => void> = [];
  const make = (selfId: string, peerId: string, deliverTo: () => Side): Side => {
    const side: Side = { link: null as unknown as PeerLink, pcs: [], transports: [], lost: 0, sent: [] };
    side.link = new PeerLink({
      selfId,
      peerId,
      // The backend's rule: the greater device id is polite.
      polite: selfId > peerId,
      ice: new IceServerProvider([], "token", async () => {
        throw new Error("no TURN in tests");
      }),
      localMaxFrame: 64 * 1024,
      createPeerConnection: (config) => {
        const pc = new FakeRTCPeerConnection(config);
        side.pcs.push(pc);
        return pc as unknown as AppPeerConnection;
      },
      send: (message) => {
        side.sent.push(message);
        if (message.type !== "offer" && message.type !== "answer" && message.type !== "ice_candidate") return;
        const relayed = { ...message, sender_id: selfId };
        const deliver = () => {
          const target = deliverTo().link;
          if (relayed.type === "offer") void target.handleOffer(relayed);
          else if (relayed.type === "answer") void target.handleAnswer(relayed);
          else void target.handleCandidate(relayed);
        };
        // Optionally hold candidates to simulate them racing ahead of the description.
        if (relayed.type === "ice_candidate" && options.holdCandidatesFor === selfId) held.push(deliver);
        else setTimeout(deliver, 0);
      },
    });
    side.link.events.on("transport", (t) => side.transports.push(t));
    side.link.events.on("transportLost", () => {
      side.lost += 1;
    });
    return side;
  };
  sides.a = make(A, B, () => sides.b);
  sides.b = make(B, A, () => sides.a);
  return { ...sides, releaseHeld: () => held.splice(0).forEach((f) => f()) };
}

describe("PeerLink (perfect negotiation)", () => {
  beforeEach(() => resetFakePeerConnections());
  afterEach(() => resetFakePeerConnections());

  it("connects via offer/answer/ICE and opens the DataChannel on both sides", async () => {
    const { a, b } = pair();
    await a.link.ensure();
    await until(() => a.transports.length > 0 && b.transports.length > 0);
    expect(a.link.isConnected).toBe(true);
    expect(b.link.isConnected).toBe(true);
    expect(a.sent.some((m) => m.type === "offer")).toBe(true);
    expect(b.sent.some((m) => m.type === "answer")).toBe(true);
    // Both sides use the same connection id.
    expect(a.link.info.getSnapshot().connectionId).toBe(b.link.info.getSnapshot().connectionId);
  });

  it("exchanges control messages once open, and agrees the frame size", async () => {
    const { a, b } = pair();
    await a.link.ensure();
    await until(() => a.transports.length > 0 && b.transports.length > 0);
    const received: string[] = [];
    b.transports[0]!.events.on("ctl", (ctl) => received.push(ctl.t));
    a.transports[0]!.sendCtl({ t: "chunk_ack", slot: 1, index: 0 });
    await until(() => received.includes("chunk_ack"));
    expect(a.link.frameSize).toBe(64 * 1024);
  });

  it("resolves glare when both sides start at once", async () => {
    const { a, b } = pair();
    await Promise.all([a.link.ensure(), b.link.ensure()]);
    await until(() => a.link.isConnected && b.link.isConnected);
    expect(a.link.info.getSnapshot().connectionId).toBe(b.link.info.getSnapshot().connectionId);
    expect(a.link.info.getSnapshot().status).toBe("connected");
  });

  it("buffers candidates that arrive before the remote description", async () => {
    const { a, b, releaseHeld } = pair({ holdCandidatesFor: A });
    await a.link.ensure();
    await until(() => a.sent.some((m) => m.type === "ice_candidate"));
    // Deliver A's candidates first, then let the answer flow.
    releaseHeld();
    await until(() => a.link.isConnected && b.link.isConnected);
    await tick(10);
    const bPc = b.pcs.at(-1)!;
    expect(bPc.candidateErrors).toBe(0);
  });

  it("reports the transport lost when the channel closes, and the path from stats", async () => {
    const { a, b } = pair();
    await a.link.ensure();
    await until(() => a.link.isConnected && b.link.isConnected);
    await a.link.refreshStats();
    expect(a.link.info.getSnapshot()).toMatchObject({ path: "lan", rttMs: 12, quality: "excellent" });
    b.pcs.at(-1)!.close();
    await until(() => a.lost > 0);
    expect(a.link.isConnected).toBe(false);
  });

  it("replaces the connection when the peer restarts with a new connection id", async () => {
    const { a, b } = pair();
    await a.link.ensure();
    await until(() => a.link.isConnected && b.link.isConnected);
    const firstId = a.link.info.getSnapshot().connectionId;
    // B's tab crashes (no "bye"), then a brand-new link offers with a new connection id.
    // (A deliberate close sends "bye"; the PeerManager then replaces the link instead.)
    const fresh = new PeerLink({
      selfId: B,
      peerId: A,
      polite: true,
      ice: new IceServerProvider([], "t", async () => {
        throw new Error("none");
      }),
      localMaxFrame: 64 * 1024,
      createPeerConnection: (config) => new FakeRTCPeerConnection(config) as unknown as AppPeerConnection,
      send: (message) => {
        const relayed = { ...message, sender_id: B };
        setTimeout(() => {
          if (relayed.type === "offer") void a.link.handleOffer(relayed);
          else if (relayed.type === "ice_candidate") void a.link.handleCandidate(relayed);
        }, 0);
      },
    });
    // Route A's answers to the fresh link.
    const route = a.link as unknown as { options: { send: (m: ClientMessage) => void } };
    route.options.send = (message) => {
      const relayed = { ...message, sender_id: A };
      setTimeout(() => {
        if (relayed.type === "answer") void fresh.handleAnswer(relayed);
        else if (relayed.type === "ice_candidate") void fresh.handleCandidate(relayed);
      }, 0);
    };
    await fresh.ensure();
    await until(() => fresh.isConnected && a.link.isConnected && a.link.info.getSnapshot().connectionId !== firstId);
    expect(a.link.info.getSnapshot().connectionId).toBe(fresh.info.getSnapshot().connectionId);
  });
});
