import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { err, isNonEmptyString, ok, toError, type Result } from "../utils/index.js";

const execFileAsync = promisify(execFile);

export type SystemProxySettings = {
  origin: "macOS" | "Windows";
  pacUrl?: string;
  httpsProxy?: string;
  bypass: string[];
};

const WINDOWS_INTERNET_SETTINGS_KEY =
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

type ScutilValue = string | string[];

// Reads the top-level keys only. Nested dictionaries such as the per-interface `__SCOPED__`
// settings are skipped so they cannot override the global settings.
const parseScutilDictionary = (output: string): Record<string, ScutilValue> => {
  const values: Record<string, ScutilValue> = {};
  // 1 = inside the top-level <dictionary>.
  let depth = 0;
  let currentArray: string[] | null = null;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line === "}") {
      depth -= 1;
      if (depth <= 1) {
        currentArray = null;
      }
      continue;
    }

    const opening = /^(?:(\S+)\s*:\s*)?<(array|dictionary)>\s*\{$/.exec(line);
    if (opening) {
      if (depth === 1 && opening[1] && opening[2] === "array") {
        currentArray = [];
        values[opening[1]] = currentArray;
      }
      depth += 1;
      continue;
    }

    if (depth === 1) {
      const scalar = /^(\S+)\s*:\s*(.*)$/.exec(line);
      if (scalar?.[1] && scalar[2] !== undefined) {
        values[scalar[1]] = scalar[2];
      }
    } else if (depth === 2 && currentArray) {
      const entry = /^\d+\s*:\s*(.*)$/.exec(line);
      if (entry?.[1] !== undefined) {
        currentArray.push(entry[1]);
      }
    }
  }

  return values;
};

// Parses `scutil --proxy` output. Only the settings that apply to https:// URLs are used.
export const parseScutilProxy = (output: string): SystemProxySettings => {
  const values = parseScutilDictionary(output);
  const scalar = (key: string): string | undefined => {
    const value = values[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const settings: SystemProxySettings = { origin: "macOS", bypass: [] };

  const pacUrl = scalar("ProxyAutoConfigURLString");
  if (scalar("ProxyAutoConfigEnable") === "1" && pacUrl) {
    settings.pacUrl = pacUrl;
  }

  const httpsHost = scalar("HTTPSProxy");
  if (scalar("HTTPSEnable") === "1" && httpsHost) {
    const port = scalar("HTTPSPort");
    settings.httpsProxy = port ? `${httpsHost}:${port}` : httpsHost;
  }

  const exceptions = values.ExceptionsList;
  if (Array.isArray(exceptions)) {
    settings.bypass = exceptions.filter((entry) => entry.length > 0);
  }

  return settings;
};

// ProxyServer is either "host:port" (all protocols) or "http=host:port;https=host:port;...".
const pickWindowsHttpsProxy = (proxyServer: string): string | undefined => {
  const entries = proxyServer
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      return entry;
    }
    if (entry.slice(0, separator).trim().toLowerCase() === "https") {
      const value = entry.slice(separator + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }

  return undefined;
};

// Parses `reg query "HKCU\...\Internet Settings"` output.
export const parseWindowsInternetSettings = (output: string): SystemProxySettings => {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+(REG_\w+)\s+(.*)$/.exec(line);
    if (match?.[1] && match[3] !== undefined) {
      values[match[1]] = match[3].trim();
    }
  }

  const settings: SystemProxySettings = { origin: "Windows", bypass: [] };

  if (isNonEmptyString(values.AutoConfigURL)) {
    settings.pacUrl = values.AutoConfigURL;
  }

  const enabled = values.ProxyEnable !== undefined && Number.parseInt(values.ProxyEnable, 16) === 1;
  if (enabled && isNonEmptyString(values.ProxyServer)) {
    const httpsProxy = pickWindowsHttpsProxy(values.ProxyServer);
    if (httpsProxy) {
      settings.httpsProxy = httpsProxy;
    }
  }

  if (isNonEmptyString(values.ProxyOverride)) {
    settings.bypass = values.ProxyOverride.split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return settings;
};

export const readSystemProxySettings = async (
  platform: NodeJS.Platform = process.platform,
): Promise<Result<SystemProxySettings | null>> => {
  try {
    if (platform === "darwin") {
      const { stdout } = await execFileAsync("/usr/sbin/scutil", ["--proxy"], { timeout: 5000 });
      return ok(parseScutilProxy(stdout));
    }

    if (platform === "win32") {
      const { stdout } = await execFileAsync("reg", ["query", WINDOWS_INTERNET_SETTINGS_KEY], {
        timeout: 5000,
        windowsHide: true,
      });
      return ok(parseWindowsInternetSettings(stdout));
    }

    return ok(null);
  } catch (error) {
    return err(toError(error));
  }
};
