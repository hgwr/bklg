import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "../utils/index.js";
import {
  describeProxy,
  matchesBypassList,
  matchesNoProxy,
  parseProxyUrl,
  resolveProxy,
} from "./proxy.js";
import type { SystemProxySettings } from "./system-proxy.js";

const target = new URL("https://space.backlog.com/api/v2/issues/PROJ-1");

const system = (settings: Partial<SystemProxySettings>) => async () =>
  ok<SystemProxySettings | null>({ origin: "macOS", bypass: [], ...settings });

const noSystem = async () => ok<SystemProxySettings | null>(null);

describe("parseProxyUrl", () => {
  it("adds http:// to a bare host:port and splits credentials", () => {
    assert.equal(
      parseProxyUrl("proxy.example.com:8080")?.proxy.toString(),
      "http://proxy.example.com:8080/",
    );

    const parsed = parseProxyUrl("http://user%40corp:p%3Ass@proxy.example.com:3128");
    assert.equal(parsed?.proxy.toString(), "http://proxy.example.com:3128/");
    assert.deepEqual(parsed?.credentials, { username: "user@corp", password: "p:ss" });
  });

  it("rejects unsupported schemes", () => {
    assert.equal(parseProxyUrl("socks5://proxy.example.com:1080"), null);
  });
});

describe("matchesNoProxy", () => {
  it("matches hosts, domains, wildcards and ports", () => {
    assert.equal(matchesNoProxy(target, "*"), true);
    assert.equal(matchesNoProxy(target, "space.backlog.com"), true);
    assert.equal(matchesNoProxy(target, "localhost, .backlog.com"), true);
    assert.equal(matchesNoProxy(target, "*.backlog.com"), true);
    assert.equal(matchesNoProxy(target, "backlog.com:443"), true);
    assert.equal(matchesNoProxy(target, "backlog.com:8443"), false);
    assert.equal(matchesNoProxy(target, "backlog.jp,example.com"), false);
    assert.equal(matchesNoProxy(target, "klog.com"), false);
  });
});

describe("matchesBypassList", () => {
  it("supports wildcards and <local>", () => {
    assert.equal(matchesBypassList("space.backlog.com", ["*.backlog.com"]), true);
    assert.equal(matchesBypassList("space.backlog.com", ["*.local", "169.254/16"]), false);
    assert.equal(matchesBypassList("intranet", ["<local>"]), true);
    assert.equal(matchesBypassList("space.backlog.com", ["<local>"]), false);
  });
});

describe("resolveProxy", () => {
  it("prefers HTTPS_PROXY over HTTP_PROXY and the OS settings", async () => {
    const result = await resolveProxy(target, {
      env: {
        HTTPS_PROXY: "http://secure.example.com:8443",
        HTTP_PROXY: "http://plain.example.com:8080",
      },
      readSystemSettings: system({ httpsProxy: "os.example.com:80" }),
    });
    assert.ok(result.ok);
    assert.equal(describeProxy(result.value), "http://secure.example.com:8443");
    assert.equal(result.value.source, "HTTPS_PROXY");
  });

  it("falls back to HTTP_PROXY", async () => {
    const result = await resolveProxy(target, {
      env: { http_proxy: "plain.example.com:8080" },
      readSystemSettings: noSystem,
    });
    assert.ok(result.ok);
    assert.equal(describeProxy(result.value), "http://plain.example.com:8080");
  });

  it("connects directly when NO_PROXY matches", async () => {
    const result = await resolveProxy(target, {
      env: { HTTPS_PROXY: "http://secure.example.com:8443", NO_PROXY: "backlog.com" },
      readSystemSettings: system({ httpsProxy: "os.example.com:80" }),
    });
    assert.deepEqual(result, { ok: true, value: { source: "NO_PROXY" } });
  });

  it("reports an unsupported proxy URL in the environment", async () => {
    const result = await resolveProxy(target, {
      env: { HTTPS_PROXY: "socks5://socks.example.com:1080" },
    });
    assert.equal(result.ok, false);
  });

  it("uses the OS HTTPS proxy unless the host is bypassed", async () => {
    const used = await resolveProxy(target, {
      env: {},
      readSystemSettings: system({ httpsProxy: "os.example.com:3128" }),
    });
    assert.ok(used.ok);
    assert.equal(describeProxy(used.value), "http://os.example.com:3128");

    const bypassed = await resolveProxy(target, {
      env: {},
      readSystemSettings: system({ httpsProxy: "os.example.com:3128", bypass: ["*.backlog.com"] }),
    });
    assert.ok(bypassed.ok);
    assert.equal(describeProxy(bypassed.value), "DIRECT");
  });

  it("evaluates the OS PAC file and applies BKLG_PROXY_USERNAME/PASSWORD", async () => {
    const script = `function FindProxyForURL(url, host) {
  return dnsDomainIs(host, ".backlog.com") ? "SOCKS socks.example.com:1080; PROXY pac.example.com:80" : "DIRECT";
}`;
    const result = await resolveProxy(target, {
      env: { BKLG_PROXY_USERNAME: "alice", BKLG_PROXY_PASSWORD: "secret" },
      readSystemSettings: system({
        pacUrl: "https://pac.example.com/proxy.pac",
        httpsProxy: "os.example.com:3128",
      }),
      loadPac: async () => ok(script),
    });
    assert.ok(result.ok);
    assert.equal(result.value.proxy?.toString(), "http://pac.example.com/");
    assert.deepEqual(result.value.credentials, { username: "alice", password: "secret" });
    assert.equal(result.value.source, "macOS PAC https://pac.example.com/proxy.pac");
    assert.equal(describeProxy(result.value), "http://pac.example.com:80 (with credentials)");
  });

  it("falls back to the OS HTTPS proxy when the PAC file cannot be loaded", async () => {
    const logs: string[] = [];
    const result = await resolveProxy(target, {
      env: {},
      readSystemSettings: system({
        pacUrl: "https://pac.example.com/proxy.pac",
        httpsProxy: "os.example.com:3128",
      }),
      loadPac: async () => ({ ok: false, error: new Error("timeout") }),
      log: (message) => logs.push(message),
    });
    assert.ok(result.ok);
    assert.equal(describeProxy(result.value), "http://os.example.com:3128");
    assert.equal(logs.length, 1);
  });

  it("falls back to the OS HTTPS proxy when the PAC file never finishes", async () => {
    const logs: string[] = [];
    const result = await resolveProxy(target, {
      env: {},
      readSystemSettings: system({
        pacUrl: "https://pac.example.com/proxy.pac",
        httpsProxy: "os.example.com:3128",
      }),
      loadPac: async () => ok("function FindProxyForURL(url, host) { while (true) {} }"),
      pacTimeoutMs: 300,
      log: (message) => logs.push(message),
    });
    assert.ok(result.ok);
    assert.equal(describeProxy(result.value), "http://os.example.com:3128");
    assert.match(logs.join("\n"), /timed out/);
  });

  it("keeps the apiKey out of the PAC file and the debug log", async () => {
    const logs: string[] = [];
    const result = await resolveProxy(
      new URL("https://space.backlog.com/api/v2/issues/PROJ-1?apiKey=SECRET_KEY"),
      {
        env: {},
        readSystemSettings: system({ pacUrl: "https://pac.example.com/proxy.pac" }),
        loadPac: async () =>
          ok("function FindProxyForURL(url, host) { alert(url); throw new Error(url); }"),
        log: (message) => logs.push(message),
      },
    );
    assert.ok(result.ok);
    assert.equal(logs.length, 2);
    assert.doesNotMatch(logs.join("\n"), /SECRET_KEY|api\/v2/);
  });

  it("connects directly without any proxy settings", async () => {
    const result = await resolveProxy(target, { env: {}, readSystemSettings: noSystem });
    assert.deepEqual(result, { ok: true, value: { source: "default" } });
  });
});
