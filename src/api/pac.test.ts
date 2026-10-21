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

  const apiUrl = new URL("https://space.backlog.com/api/v2/issues/PROJ-1?apiKey=SECRET_KEY");

  it("passes only scheme://host:port/ to FindProxyForURL", async () => {
    const result = await evaluatePac("function FindProxyForURL(url, host) { return url; }", apiUrl);
    assert.deepEqual(result, { ok: true, value: "https://space.backlog.com/" });
  });

  it("keeps the apiKey out of PAC errors", async () => {
    const result = await evaluatePac(
      "function FindProxyForURL(url, host) { throw new Error(url); }",
      apiUrl,
    );
    assert.ok(!result.ok);
    assert.doesNotMatch(result.error.message, /SECRET_KEY/);
  });

  it("sends alert() to onAlert instead of stdout", async () => {
    const alerts: string[] = [];
    const result = await evaluatePac(
      'function FindProxyForURL(url, host) { alert(url); return "DIRECT"; }',
      apiUrl,
      { onAlert: (message) => alerts.push(message) },
    );
    assert.deepEqual(result, { ok: true, value: "DIRECT" });
    assert.deepEqual(alerts, ["https://space.backlog.com/"]);
  });

  for (const [label, loopScript] of [
    ["in FindProxyForURL", "function FindProxyForURL(url, host) { while (true) {} }"],
    [
      "at the top level",
      'while (true) {} function FindProxyForURL(url, host) { return "DIRECT"; }',
    ],
    [
      "after a DNS lookup",
      "function FindProxyForURL(url, host) { dnsResolve(host); while (true) {} }",
    ],
  ] as const) {
    it(`times out a PAC file that loops ${label}`, async () => {
      const startedAt = Date.now();
      const result = await evaluatePac(loopScript, new URL("https://localhost/"), {
        timeoutMs: 300,
      });
      assert.ok(!result.ok);
      assert.match(result.error.message, /timed out after 300 ms/);
      assert.ok(Date.now() - startedAt < 3000);
    });
  }
});
