import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseScutilProxy, parseWindowsInternetSettings } from "./system-proxy.js";

describe("parseScutilProxy", () => {
  it("reads PAC, HTTPS proxy and exceptions", () => {
    const output = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
  }
  FTPPassive : 1
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : http-proxy.example.com
  HTTPSEnable : 1
  HTTPSPort : 8443
  HTTPSProxy : https-proxy.example.com
  ProxyAutoConfigEnable : 1
  ProxyAutoConfigURLString : https://pac.example.com/proxy.pac
}
`;
    assert.deepEqual(parseScutilProxy(output), {
      origin: "macOS",
      pacUrl: "https://pac.example.com/proxy.pac",
      httpsProxy: "https-proxy.example.com:8443",
      bypass: ["*.local", "169.254/16"],
    });
  });

  it("ignores per-interface __SCOPED__ settings", () => {
    const output = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
  }
  HTTPSEnable : 1
  HTTPSPort : 8080
  HTTPSProxy : global-proxy.example.com
  __SCOPED__ : <dictionary> {
    en0 : <dictionary> {
      ExceptionsList : <array> {
        0 : scoped.example.com
      }
      HTTPSEnable : 0
      HTTPSProxy : scoped-proxy.example.com
      ProxyAutoConfigEnable : 1
      ProxyAutoConfigURLString : https://scoped.example.com/proxy.pac
    }
  }
}
`;
    assert.deepEqual(parseScutilProxy(output), {
      origin: "macOS",
      httpsProxy: "global-proxy.example.com:8080",
      bypass: ["*.local"],
    });
  });

  it("ignores disabled settings and the plain HTTP proxy", () => {
    const output = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 8080
  HTTPProxy : http-proxy.example.com
  HTTPSEnable : 0
  HTTPSProxy : https-proxy.example.com
  ProxyAutoConfigEnable : 0
  ProxyAutoConfigURLString : https://pac.example.com/proxy.pac
}
`;
    assert.deepEqual(parseScutilProxy(output), { origin: "macOS", bypass: [] });
  });
});

describe("parseWindowsInternetSettings", () => {
  const header =
    "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\r\n";

  it("reads a single proxy for all protocols", () => {
    const output = `${header}    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    proxy.example.com:8080\r\n    ProxyOverride    REG_SZ    <local>;*.corp.example.com\r\n`;
    assert.deepEqual(parseWindowsInternetSettings(output), {
      origin: "Windows",
      httpsProxy: "proxy.example.com:8080",
      bypass: ["<local>", "*.corp.example.com"],
    });
  });

  it("picks the https= entry from per-protocol settings", () => {
    const output = `${header}    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    http=web.example.com:80;https=secure.example.com:443\r\n`;
    assert.equal(parseWindowsInternetSettings(output).httpsProxy, "secure.example.com:443");
  });

  it("reads AutoConfigURL and ignores a disabled manual proxy", () => {
    const output = `${header}    ProxyEnable    REG_DWORD    0x0\r\n    ProxyServer    REG_SZ    proxy.example.com:8080\r\n    AutoConfigURL    REG_SZ    http://wpad.example.com/proxy.pac\r\n`;
    assert.deepEqual(parseWindowsInternetSettings(output), {
      origin: "Windows",
      pacUrl: "http://wpad.example.com/proxy.pac",
      bypass: [],
    });
  });
});
