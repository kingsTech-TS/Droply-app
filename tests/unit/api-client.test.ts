import { ApiClient } from "@/lib/api/client";
import { ApiError, userMessage } from "@/lib/api/errors";
import { createRoom, joinRoom } from "@/lib/api/rooms";
import { parseServerMessage } from "@/lib/webrtc/server-messages";

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const envelope = (code: string, message = "msg") => ({ success: false, error: { code, message, request_id: "rq_1" } });

describe("ApiClient", () => {
  it("sends JSON with the bearer token and returns the body", async () => {
    const fetchImpl = jest.fn(async () => response(201, { room_id: "rm_1" }));
    const client = new ApiClient("http://api.test/api/v1", fetchImpl as unknown as typeof fetch);
    const result = await client.request<{ room_id: string }>("POST", "/rooms", { body: { a: 1 }, token: "tok" });
    expect(result.room_id).toBe("rm_1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/rooms");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "INVALID_ROOM_CODE"],
    [409, "ROOM_FULL"],
    [410, "ROOM_EXPIRED"],
    [500, "INTERNAL_ERROR"],
  ])("maps %i %s from the error envelope", async (status, code) => {
    const client = new ApiClient("http://api.test", (async () => response(status, envelope(code))) as unknown as typeof fetch);
    const error = await client.request("GET", "/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).requestId).toBe("rq_1");
    expect(userMessage(error)).not.toContain("msg"); // friendly copy, not server internals
  });

  it("falls back to status-based codes for non-JSON errors", async () => {
    const client = new ApiClient("http://api.test", (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch);
    const error = (await client.request("GET", "/x").catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("INTERNAL_ERROR");
  });

  it("honours Retry-After on 429 for retryable calls", async () => {
    jest.useFakeTimers();
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(429, envelope("RATE_LIMITED"), { "Retry-After": "2" }))
      .mockResolvedValueOnce(response(200, { ok: true }));
    const client = new ApiClient("http://api.test", fetchImpl as unknown as typeof fetch);
    const pending = client.request("GET", "/x", { retries: 1 });
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
    jest.useRealTimers();
  });

  it("does not retry POSTs by default and reports the wait", async () => {
    const fetchImpl = jest.fn(async () => response(429, envelope("RATE_LIMITED"), { "Retry-After": "30" }));
    const client = new ApiClient("http://api.test", fetchImpl as unknown as typeof fetch);
    const error = (await createRoom({ device_name: "x" }, client).catch((e: unknown) => e)) as ApiError;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error.retryAfter).toBe(30);
    expect(userMessage(error)).toBe("Too many attempts. Try again in 30 s.");
  });

  it("reports network errors", async () => {
    const client = new ApiClient("http://api.test", (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    const error = (await client.request("GET", "/x").catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("NETWORK_ERROR");
  });
});

describe("parseServerMessage", () => {
  const device = {
    device_id: "dv_aaaaaaaaaaaaaaaaaaaa",
    device_name: "Phone",
    device_type: "phone",
    browser: null,
    operating_system: null,
    joined_at: "2026-01-01T00:00:00Z",
    last_seen: "2026-01-01T00:00:00Z",
    connection_state: "connected",
    is_host: false,
  };

  it("accepts contract messages", () => {
    expect(parseServerMessage(JSON.stringify({ type: "peer_joined", device }))?.type).toBe("peer_joined");
    expect(parseServerMessage(JSON.stringify({ type: "ping", ts: 1 }))?.type).toBe("ping");
    expect(
      parseServerMessage(
        JSON.stringify({ type: "offer", sender_id: "dv_a", target_id: "dv_b", connection_id: "pc-1", payload: { type: "offer", sdp: "v=0" } }),
      )?.type,
    ).toBe("offer");
  });

  it("fills defaults on transfer events", () => {
    const transfer = {
      transfer_id: "tr_1",
      sender_id: "dv_a",
      status: "pending",
      recipients: [{ device_id: "dv_b", status: "pending", received_ranges: [] }],
      file: { file_name: "a", file_size: 1, chunk_size: 1, total_chunks: 1 },
    };
    const parsed = parseServerMessage(JSON.stringify({ type: "transfer_request", transfer }));
    expect(parsed).toMatchObject({ type: "transfer_request", device_ids: [], actor_id: null, reason: null });
  });

  it("drops anything outside the contract", () => {
    expect(parseServerMessage("{")).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "peer_joined" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "bogus" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ type: "offer", payload: { type: "offer", sdp: "x" } }))).toBeNull();
    expect(parseServerMessage(new ArrayBuffer(4))).toBeNull();
  });
});

describe("createRoom with a theme", () => {
  const device = { device_name: "Laptop", device_type: "laptop" as const };

  it("sends the theme, and leaves it out for the default theme", async () => {
    const fetchImpl = jest.fn(async () => response(201, { room_id: "rm_1" }));
    const client = new ApiClient("http://api.test", fetchImpl as unknown as typeof fetch);
    await createRoom(device, client, "event", "birthday");
    await createRoom(device, client);
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    const sent = { ...device, client: "app", install_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) };
    expect(bodies[0]).toEqual({ device: sent, kind: "event", theme: "birthday" });
    expect(bodies[1]).toEqual({ device: sent, kind: "standard" });
    // The same random id every time (one install = one user).
    expect(bodies[0].device.install_id).toBe(bodies[1].device.install_id);
  });

  it("falls back to an unthemed room on servers that reject the field", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(422, envelope("VALIDATION_ERROR")))
      .mockResolvedValueOnce(response(201, { room_id: "rm_2" }));
    const client = new ApiClient("http://api.test", fetchImpl as unknown as typeof fetch);
    const session = await createRoom(device, client, "standard", "ocean");
    expect(session.room_id).toBe("rm_2");
    expect(JSON.parse(String((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({
      device: expect.objectContaining(device),
      kind: "standard",
    });
  });

  it("leaves out the app kind and install id on servers that predate them", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(response(422, envelope("VALIDATION_ERROR")))
      .mockResolvedValueOnce(response(200, { room_id: "rm_3" }));
    const client = new ApiClient("http://api.test", fetchImpl as unknown as typeof fetch);
    const session = await joinRoom("K7X9PQ", device, null, client);
    expect(session.room_id).toBe("rm_3");
    const [first, second] = fetchImpl.mock.calls.map((call) => JSON.parse(String((call as [string, RequestInit])[1].body)));
    expect(first.device).toMatchObject({ client: "app" });
    expect(second).toEqual({ room_code: "K7X9PQ", device });
  });
});
