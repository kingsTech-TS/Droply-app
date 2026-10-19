import { SignalingClient, type EndReason } from "@/lib/webrtc/signaling-client";
import { FakeSocket, roomStateEvent } from "../mocks/websocket";

function makeClient(budget?: number) {
  const client = new SignalingClient({
    wsUrl: "wss://api.test/ws/v1",
    roomId: "rm_test",
    token: "secret-token",
    createSocket: (url) => new FakeSocket(url),
    budget,
  });
  const ended: EndReason[] = [];
  client.events.on("ended", (reason) => ended.push(reason));
  return { client, ended };
}

function openAndJoin(): FakeSocket {
  const socket = FakeSocket.latest();
  socket.serverOpen();
  socket.serverSend(roomStateEvent());
  return socket;
}

describe("SignalingClient", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeSocket.reset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps the token out of the URL and sends join first", () => {
    const { client } = makeClient();
    client.connect();
    const socket = FakeSocket.latest();
    expect(socket.url).toBe("wss://api.test/ws/v1/rooms/rm_test");
    expect(socket.url).not.toContain("secret-token");
    socket.serverOpen();
    expect(socket.sent[0]).toEqual({ type: "join", token: "secret-token" });
  });

  it("queues messages until room_state, then flushes them in order", () => {
    const { client } = makeClient();
    client.connect();
    client.send({ type: "transfer_accepted", transfer_id: "tr_aaaaaaaaaaaaaaaaaaaa" });
    const socket = FakeSocket.latest();
    socket.serverOpen();
    expect(socket.sentTypes()).toEqual(["join"]);
    socket.serverSend(roomStateEvent());
    expect(socket.sentTypes()).toEqual(["join", "transfer_accepted"]);
    expect(client.status).toBe("open");
  });

  it("after a freeze, reconnects at once if the socket no longer answers", () => {
    const { client } = makeClient();
    client.connect();
    const socket = openAndJoin();
    client.checkAlive(4000);
    expect(socket.sent.at(-1)).toMatchObject({ type: "ping" });
    // A live socket answers and nothing happens.
    jest.advanceTimersByTime(1000);
    socket.serverSend({ type: "pong", ts: 1 });
    jest.advanceTimersByTime(10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    // A dead one (looks open, never answers) is replaced right away, not after 75 s.
    client.checkAlive(4000);
    jest.advanceTimersByTime(4001);
    expect(client.state.getSnapshot().status).toBe("reconnecting");
    jest.advanceTimersByTime(700);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("answers server pings with pong", () => {
    const { client } = makeClient();
    client.connect();
    const socket = openAndJoin();
    socket.serverSend({ type: "ping", ts: 42 });
    expect(socket.sent.at(-1)).toEqual({ type: "pong", ts: 42 });
  });

  it("reconnects with backoff after an abnormal close and resets on success", () => {
    const { client } = makeClient();
    client.connect();
    openAndJoin().serverClose(1006);
    expect(client.state.getSnapshot().status).toBe("reconnecting");
    expect(FakeSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(700);
    expect(FakeSocket.instances).toHaveLength(2);
    openAndJoin();
    expect(client.state.getSnapshot()).toMatchObject({ status: "open", attempts: 0 });
  });

  it("drops offers and candidates still queued when the socket closes", () => {
    const { client } = makeClient();
    client.connect();
    const first = FakeSocket.latest();
    first.serverOpen(); // open, but not authenticated yet: messages wait
    client.send({ type: "offer", target_id: "dv_peer000000000000000", connection_id: "pc-1", payload: { type: "offer", sdp: "x" } });
    client.send({ type: "transfer_paused", transfer_id: "tr_aaaaaaaaaaaaaaaaaaaa" });
    first.serverClose(1006);
    jest.advanceTimersByTime(5000);
    const socket = openAndJoin();
    // The offer belonged to the old session; the peer layer renegotiates instead.
    expect(socket.sentTypes()).toEqual(["join", "transfer_paused"]);
  });

  it.each([
    [4001, "unauthorized"],
    [4003, "forbidden"],
    [4004, "room_not_found"],
    [4010, "room_ended"],
    [4011, "replaced"],
    [4012, "removed"],
  ] as const)("does not reconnect after close code %i", (code, reason) => {
    const { client, ended } = makeClient();
    client.connect();
    openAndJoin().serverClose(code);
    jest.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(ended).toEqual([reason]);
  });

  it("gives up after the maximum number of attempts", () => {
    const { client, ended } = makeClient();
    client.connect();
    for (let i = 0; i < 9; i += 1) {
      FakeSocket.latest().serverClose(1006);
      jest.advanceTimersByTime(20_000);
    }
    expect(ended).toContain("gave_up");
    const count = FakeSocket.instances.length;
    client.retryNow();
    expect(FakeSocket.instances.length).toBe(count + 1);
  });

  it("treats a silent server as a dead socket", () => {
    const { client } = makeClient();
    client.connect();
    openAndJoin();
    jest.advanceTimersByTime(76_000);
    expect(client.state.getSnapshot().status).toBe("reconnecting");
  });

  it("stays under the outbound rate budget and coalesces checkpoints", () => {
    const { client } = makeClient(5);
    client.connect();
    const socket = openAndJoin();
    for (let i = 0; i < 6; i += 1) client.send({ type: "transfer_started", transfer_id: "tr_bbbbbbbbbbbbbbbbbbbb" });
    // While over budget, newer checkpoints for a transfer replace older queued ones.
    for (let i = 0; i < 10; i += 1) {
      client.send({ type: "transfer_checkpoint", transfer_id: "tr_aaaaaaaaaaaaaaaaaaaa", received_ranges: [[0, i]] });
    }
    // join is sent before the budget applies; then at most 5 messages per 10 s.
    expect(socket.sent.length).toBe(1 + 5);
    jest.advanceTimersByTime(10_100);
    expect(socket.sentTypes().slice(6)).toEqual(["transfer_started", "transfer_checkpoint"]);
    expect(socket.sent.at(-1)?.received_ranges).toEqual([[0, 9]]);
  });

  it("sends leave and ends without reconnecting", () => {
    const { client, ended } = makeClient();
    client.connect();
    const socket = openAndJoin();
    client.leave();
    expect(socket.sentTypes()).toContain("leave");
    expect(socket.closedWith).toBe(1000);
    jest.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(ended).toEqual(["left"]);
  });
});
