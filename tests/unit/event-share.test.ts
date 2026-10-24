import { EventShare } from "@/lib/session/event-share";
import { parseServerMessage } from "@/lib/webrtc/server-messages";
import { parseCtl, type AppMessage } from "@/lib/webrtc/protocol";

const app = (m: unknown) => parseCtl(JSON.stringify({ t: "app", m }));

describe("event messages", () => {
  it("parses requests, previews and unavailable notices", () => {
    expect(app({ kind: "event_get", itemId: "it1", requestId: "ev1" })).toEqual({ t: "app", m: { kind: "event_get", itemId: "it1", requestId: "ev1" } });
    expect(app({ kind: "event_thumb", itemId: "a", data: "data:image/jpeg;base64,AAAA" })).not.toBeNull();
    expect(app({ kind: "event_thumb", itemId: "a", data: "data:text/html;base64,AAAA" })).toBeNull();
    expect(app({ kind: "event_unavailable", itemId: "a" })).not.toBeNull();
  });

  it("accepts catalog updates from the server", () => {
    const raw = JSON.stringify({
      type: "catalog_updated",
      room_id: "rm_1",
      items: [{ item_id: "a", name: "a.jpg", size: 3, mime_type: "image/jpeg", folder: null, added_at: "x" }],
    });
    expect(parseServerMessage(raw)).toMatchObject({ type: "catalog_updated" });
  });
});

describe("EventShare (guest)", () => {
  let hostId = "dv_host";
  const sent: Array<{ to: string; message: AppMessage }> = [];
  let reachable = true;
  const make = (selfId: string) =>
    new EventShare({
      selfId,
      hostId: () => hostId,
      messenger: {
        send: jest.fn(async (to: string, message: AppMessage) => {
          sent.push({ to, message });
          return reachable;
        }),
      } as never,
      notify: jest.fn(),
    });

  beforeEach(() => {
    hostId = "dv_host";
    reachable = true;
    sent.length = 0;
  });

  it("asks the host for each picked file and accepts only those transfers", async () => {
    const guest = make("dv_guest");
    expect(await guest.download(["it_a", "it_b"])).toBe(2);
    expect(sent.every((s) => s.to === "dv_host" && s.message.kind === "event_get")).toBe(true);
    const requestId = (sent[0]!.message as { requestId: string }).requestId;
    expect(guest.isRequested("dv_host", requestId)).toBe(true);
    expect(guest.isRequested("dv_other", requestId)).toBe(false);
  });

  it("forgets requests the host couldn't be reached for", async () => {
    reachable = false;
    const guest = make("dv_guest");
    expect(await guest.download(["it_a"])).toBe(0);
    expect(guest.requests.getSnapshot()).toEqual({});
  });

  it("only takes previews from the host", () => {
    const guest = make("dv_guest");
    guest.handle("dv_intruder", { kind: "event_thumb", itemId: "a", data: "data:image/jpeg;base64,AA" });
    expect(guest.thumbs.getSnapshot()).toEqual({});
    guest.handle("dv_host", { kind: "event_thumb", itemId: "a", data: "data:image/jpeg;base64,AA" });
    expect(guest.thumbs.getSnapshot().a).toBe("data:image/jpeg;base64,AA");
  });

  it("answers 'unavailable' if this device ends up as host", () => {
    hostId = "dv_app";
    const app = make("dv_app");
    expect(app.handle("dv_guest", { kind: "event_get", itemId: "x", requestId: "ev_1" })).toBe(true);
    expect(sent).toEqual([{ to: "dv_guest", message: { kind: "event_unavailable", itemId: "x" } }]);
  });
});
