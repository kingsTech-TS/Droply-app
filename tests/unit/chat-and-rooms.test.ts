import { findMentions } from "@/lib/chat/mentions";
import { clearRoomHistory, recordRoomEnded, recordRoomEntered, roomHistory, updateRoomHistory } from "@/lib/history/rooms";
import { parseCtl } from "@/lib/webrtc/protocol";

const app = (m: unknown) => parseCtl(JSON.stringify({ t: "app", m }));

describe("chat messages between peers", () => {
  it("keeps plain chat messages from older peers working", () => {
    expect(app({ kind: "chat", id: "c1", text: "hi" })).toEqual({ t: "app", m: { kind: "chat", id: "c1", text: "hi" } });
  });

  it("carries replies and mentions", () => {
    const parsed = app({
      kind: "chat",
      id: "c2",
      text: "@Phone yes",
      replyTo: { id: "c1", author: "dv_a", text: "anyone?" },
      mentions: ["dv_b", "dv_b", "dv_c"],
    });
    expect(parsed).toEqual({
      t: "app",
      m: { kind: "chat", id: "c2", text: "@Phone yes", replyTo: { id: "c1", author: "dv_a", text: "anyone?" }, mentions: ["dv_b", "dv_c"] },
    });
  });

  it("drops malformed extras but keeps the message", () => {
    const parsed = app({ kind: "chat", id: "c3", text: "x", replyTo: { id: "c1", author: "bad id!", text: "q" }, mentions: "dv_b" });
    expect(parsed).toEqual({ t: "app", m: { kind: "chat", id: "c3", text: "x" } });
    const long = app({ kind: "chat", id: "c4", text: "x", replyTo: { id: "c1", author: "dv_a", text: "q".repeat(201) } });
    expect(long).toEqual({ t: "app", m: { kind: "chat", id: "c4", text: "x" } });
  });

  it("parses chat reactions and rejects unknown emoji", () => {
    expect(app({ kind: "chat_reaction", messageId: "c1", emoji: "🔥", on: true })).toEqual({
      t: "app",
      m: { kind: "chat_reaction", messageId: "c1", emoji: "🔥", on: true },
    });
    expect(app({ kind: "chat_reaction", messageId: "c1", emoji: "💩", on: true })).toBeNull();
    expect(app({ kind: "chat_reaction", messageId: "c1", emoji: "🔥" })).toBeNull();
  });
});

describe("findMentions", () => {
  const devices = [
    { device_id: "a", device_name: "Phone" },
    { device_id: "b", device_name: "Phone 2" },
    { device_id: "c", device_name: "Ada's Laptop" },
  ];

  it("finds tagged devices, preferring the longest name", () => {
    expect(findMentions("hey @Phone 2 look", devices)).toEqual(["b"]);
    expect(findMentions("@Phone and @Phone 2", devices).sort()).toEqual(["a", "b"]);
    expect(findMentions("@Ada's Laptop!", devices)).toEqual(["c"]);
  });

  it("ignores names that are only a prefix of a word", () => {
    expect(findMentions("@Phones are great", devices)).toEqual([]);
    expect(findMentions("no tags here", devices)).toEqual([]);
  });
});

describe("room history", () => {
  beforeEach(() => clearRoomHistory());

  const entered = {
    roomId: "rm_1",
    roomCode: "K7X9PQ",
    host: true,
    kind: "standard" as const,
    theme: "party" as const,
    mode: "standard" as const,
    durationSeconds: 600,
    timeExtended: false,
    peakDevices: 1,
  };

  it("records entering, activity and the end of a room", () => {
    recordRoomEntered(entered);
    updateRoomHistory("rm_1", (e) => ({ sentFiles: e.sentFiles + 1, sentBytes: e.sentBytes + 100, peakDevices: 4 }));
    recordRoomEnded("rm_1", "expired");
    recordRoomEnded("rm_1", "left"); // the first end wins
    const [room] = roomHistory.get();
    expect(room).toMatchObject({ roomCode: "K7X9PQ", sentFiles: 1, sentBytes: 100, peakDevices: 4, endReason: "expired" });
    expect(room!.endedAt).not.toBeNull();
  });

  it("reopens the same entry when coming back to a room", () => {
    recordRoomEntered(entered);
    updateRoomHistory("rm_1", () => ({ receivedFiles: 2 }));
    recordRoomEnded("rm_1", "left");
    recordRoomEntered({ ...entered, host: false, peakDevices: 2 });
    const list = roomHistory.get();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ host: true, receivedFiles: 2, endedAt: null, endReason: null, peakDevices: 2 });
  });
});
