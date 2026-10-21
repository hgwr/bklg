import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluatePac, parsePacResult } from "./pac.js";

describe("parsePacResult", () => {
  it("parses PROXY, HTTPS, DIRECT and unsupported entries in order", () => {
    const entries = parsePacResult(
      "SOCKS5 socks.example.com:1080; PROXY a.example.com:80; HTTPS b.example.com:443; DIRECT",
    );
    assert.deepEqual(
      entries.map((entry) => (entry.type === "PROXY" ? entry.url.toString() : entry.type)),
      ["UNSUPPORTED", "http://a.example.com/", "https://b.example.com/", "DIRECT"],
    );
  });
});

describe("evaluatePac", () => {
  const script = `function FindProxyForURL(url, host) {
  if (shExpMatch(host, "*.backlog.com")) {
    return "PROXY proxy.example.com:8080; DIRECT";
  }
  return "DIRECT";
}`;

  it("runs FindProxyForURL for the target URL", async () => {
    const proxied = await evaluatePac(script, new URL("https://space.backlog.com/api/v2/issues"));
    assert.deepEqual(proxied, { ok: true, value: "PROXY proxy.example.com:8080; DIRECT" });

    const direct = await evaluatePac(script, new URL("https://example.com/"));
    assert.deepEqual(direct, { ok: true, value: "DIRECT" });
  });

  it("returns an error for a broken PAC file", async () => {
    const result = await evaluatePac("function FindProxyForURL(", new URL("https://example.com/"));
    assert.equal(result.ok, false);
  });
});
