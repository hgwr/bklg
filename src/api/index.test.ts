import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { after, before, describe, it } from "node:test";

import { formatError } from "../format/index.js";
import { getIssue, isProxyError } from "./index.js";

const PROXY_ENV_NAMES = [
  "NO_PROXY",
  "no_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "BKLG_PROXY_USERNAME",
  "BKLG_PROXY_PASSWORD",
];

const EXPECTED_AUTH = `Basic ${Buffer.from("alice:s3cr@t").toString("base64")}`;

describe("requests through an HTTP proxy", () => {
  const savedEnv = { ...process.env };
  const connects: { target: string | undefined; auth: string | undefined }[] = [];
  const sockets = new Set<Socket>();
  let server: http.Server;
  let proxyOrigin: string;

  before(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(400).end();
    });
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("connect", (req: http.IncomingMessage, socket: Socket) => {
      connects.push({ target: req.url, auth: req.headers["proxy-authorization"] });
      if (req.headers["proxy-authorization"] !== EXPECTED_AUTH) {
        socket.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nContent-Length: 0\r\n\r\n',
        );
        return;
      }
      // Accept the tunnel, then hang up before TLS starts.
      socket.end("HTTP/1.1 200 Connection Established\r\n\r\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    proxyOrigin = `127.0.0.1:${(server.address() as AddressInfo).port}`;

    for (const name of PROXY_ENV_NAMES) {
      delete process.env[name];
    }
  });

  after(async () => {
    for (const name of PROXY_ENV_NAMES) {
      if (savedEnv[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = savedEnv[name];
      }
    }
    // undici keeps connections to the proxy alive; drop them so close() can finish.
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports 407 when the proxy needs credentials", async () => {
    process.env.HTTPS_PROXY = `http://${proxyOrigin}`;

    const result = await getIssue(
      { space: "no-auth", host: "backlog.test", apiKey: "KEY" },
      "PROJ-1",
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && isProxyError(result.error));
    assert.equal(result.error.info.status, 407);
    assert.equal(connects.at(-1)?.target, "no-auth.backlog.test:443");
    assert.match(
      formatError(result.error, "text"),
      /^Proxy authentication required by http:\/\/127\.0\.0\.1:\d+\./,
    );
    assert.doesNotMatch(formatError(result.error, "json"), /KEY/);
  });

  it("sends BKLG_PROXY_USERNAME/BKLG_PROXY_PASSWORD as Basic proxy auth", async () => {
    process.env.HTTPS_PROXY = `http://${proxyOrigin}`;
    process.env.BKLG_PROXY_USERNAME = "alice";
    process.env.BKLG_PROXY_PASSWORD = "s3cr@t";

    const result = await getIssue(
      { space: "env-auth", host: "backlog.test", apiKey: "KEY" },
      "PROJ-1",
    );
    assert.equal(connects.at(-1)?.target, "env-auth.backlog.test:443");
    assert.equal(connects.at(-1)?.auth, EXPECTED_AUTH);
    // The tunnel was accepted; the test proxy then closes it before TLS.
    assert.ok(!result.ok && isProxyError(result.error));
    assert.equal(result.error.info.status, undefined);

    delete process.env.BKLG_PROXY_USERNAME;
    delete process.env.BKLG_PROXY_PASSWORD;
  });

  it("sends credentials embedded in HTTPS_PROXY", async () => {
    process.env.HTTPS_PROXY = `http://alice:s3cr%40t@${proxyOrigin}`;

    await getIssue({ space: "url-auth", host: "backlog.test", apiKey: "KEY" }, "PROJ-1");
    assert.equal(connects.at(-1)?.target, "url-auth.backlog.test:443");
    assert.equal(connects.at(-1)?.auth, EXPECTED_AUTH);
  });
});
