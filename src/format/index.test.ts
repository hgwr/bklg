import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError, ProxyError } from "../api/index.js";
import { formatError } from "./index.js";

const url = "https://space.backlog.com/api/v2/issues/PROJ-1?apiKey=***";

describe("formatError", () => {
  it("explains the IP address restriction on 403", () => {
    const error = new ApiError({
      status: 403,
      statusText: "Forbidden",
      url,
      body: {
        errors: [{ message: "Access from your IP Address is forbidden.", code: 4, moreInfo: "" }],
      },
    });
    assert.equal(
      formatError(error, "text"),
      "Access denied by the space's IP address restriction. Backlog: Access from your IP Address is forbidden.\n" +
        "Route requests through an allowed proxy with HTTPS_PROXY or the OS proxy settings (see --debug).",
    );
  });

  it("keeps the authentication hint on 401 and adds Backlog's message", () => {
    const error = new ApiError({
      status: 401,
      statusText: "Unauthorized",
      url,
      body: { errors: [{ message: "Authenticate error", code: 11, moreInfo: "" }] },
    });
    assert.equal(
      formatError(error, "md"),
      "Authentication failed. Check --api-key/--space or BACKLOG_API_KEY/BACKLOG_SPACE. Backlog: Authenticate error",
    );
  });

  it("formats proxy authentication errors", () => {
    const error = new ProxyError(
      {
        proxy: "http://proxy.example.com:80",
        status: 407,
        statusText: "Proxy Authentication Required",
        url,
      },
      "Proxy refused the connection (407 Proxy Authentication Required)",
    );
    assert.equal(
      formatError(error, "text"),
      "Proxy authentication required by http://proxy.example.com:80. " +
        "Set BKLG_PROXY_USERNAME/BKLG_PROXY_PASSWORD, or HTTPS_PROXY=http://USER:PASS@host:port.",
    );
    assert.deepEqual(JSON.parse(formatError(error, "json")), {
      error: {
        message: "Proxy refused the connection (407 Proxy Authentication Required)",
        status: 407,
        statusText: "Proxy Authentication Required",
        proxy: "http://proxy.example.com:80",
        url,
      },
    });
  });

  it("formats proxy connection failures", () => {
    const error = new ProxyError(
      { proxy: "http://proxy.example.com:80", url },
      "Request via proxy failed: connect ECONNREFUSED",
    );
    assert.equal(
      formatError(error, "text"),
      "Request via proxy failed: connect ECONNREFUSED (proxy: http://proxy.example.com:80)",
    );
  });
});
