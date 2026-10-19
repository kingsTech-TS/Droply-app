import { frontendOrigin, joinUrlFor, parseDroplyLink } from "@/lib/utils/join-url";

describe("joinUrlFor (app)", () => {
  // The app has no page origin of its own: the QR encodes the backend's join_url, which opens
  // the website (or this app, through universal/app links).
  it("uses the backend's join_url as returned", () => {
    expect(joinUrlFor("K7X9PQ", "https://droply.app/join/K7X9PQ")).toBe("https://droply.app/join/K7X9PQ");
  });

  it("derives the website origin from a join URL", () => {
    expect(frontendOrigin("https://droply.app/join/K7X9PQ")).toBe("https://droply.app");
    expect(frontendOrigin("http://192.168.1.20:3000/join/K7X9PQ")).toBe("http://192.168.1.20:3000");
    expect(frontendOrigin("droply://join/K7X9PQ")).toBeNull();
  });
});

describe("parseDroplyLink (QR codes and deep links)", () => {
  it("reads website join links, app links and bare codes", () => {
    expect(parseDroplyLink("https://droply.app/join/K7X9PQ")).toEqual({ kind: "join", code: "K7X9PQ" });
    expect(parseDroplyLink("http://192.168.1.20:3000/join/k7x9pq?x=1")).toEqual({ kind: "join", code: "k7x9pq" });
    expect(parseDroplyLink("droply://join/K7X9PQ")).toEqual({ kind: "join", code: "K7X9PQ" });
    expect(parseDroplyLink("  K7X-9PQ ")).toEqual({ kind: "join", code: "K7X-9PQ" });
  });

  it("reads personal room links", () => {
    const key = "abcdefghijklmnopqrstuvwxyz_-0123456789AB";
    expect(parseDroplyLink(`https://droply.app/r/${key}`)).toEqual({ kind: "room-link", key });
    expect(parseDroplyLink(`droply://r/${key}`)).toEqual({ kind: "room-link", key });
  });

  it("rejects anything else", () => {
    expect(parseDroplyLink("https://example.com/")).toBeNull();
    expect(parseDroplyLink("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
    expect(parseDroplyLink("https://droply.app/r/short")).toBeNull();
  });
});
