import { ProxyAgent, type Dispatcher } from "undici";

import { err, isNonEmptyString, ok, type Result } from "../utils/index.js";
import { evaluatePac, loadPacScript, parsePacResult, type EvaluatePacOptions } from "./pac.js";
import { readSystemProxySettings, type SystemProxySettings } from "./system-proxy.js";

type Env = Record<string, string | undefined>;

export type ProxyCredentials = {
  username: string;
  password: string;
};

export type ProxyDecision = {
  // Proxy URL without credentials; undefined means a direct connection.
  proxy?: URL;
  credentials?: ProxyCredentials;
  // Where the decision came from, for --debug output.
  source: string;
};

export type ResolveProxyOptions = {
  env?: Env;
  platform?: NodeJS.Platform;
  readSystemSettings?: (platform: NodeJS.Platform) => Promise<Result<SystemProxySettings | null>>;
  loadPac?: (pacUrl: string) => Promise<Result<string>>;
  pacTimeoutMs?: number;
  log?: (message: string) => void;
};

export type ProxyTransport = {
  decision: ProxyDecision;
  dispatcher?: Dispatcher;
};

const ENV_PROXY_NAMES = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
const NO_PROXY_NAMES = ["NO_PROXY", "no_proxy"];

const readEnv = (env: Env, names: string[]): { name: string; value: string } | undefined => {
  for (const name of names) {
    const value = env[name];
    if (isNonEmptyString(value)) {
      return { name, value: value.trim() };
    }
  }
  return undefined;
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const escapeRegExp = (value: string): string => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

// Accepts "http://host:port", "https://host:port" or a bare "host:port".
export const parseProxyUrl = (
  value: string,
): { proxy: URL; credentials?: ProxyCredentials } | null => {
  const trimmed = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    return null;
  }

  const proxy = new URL(`${url.protocol}//${url.host}`);
  if (!url.username && !url.password) {
    return { proxy };
  }

  return {
    proxy,
    credentials: { username: safeDecode(url.username), password: safeDecode(url.password) },
  };
};

// NO_PROXY: comma/space separated hosts or domains ("example.com", ".example.com", "*.example.com",
// "host:port") or "*" for all hosts. A domain also matches its subdomains.
export const matchesNoProxy = (target: URL, noProxy: string): boolean => {
  const hostname = target.hostname.toLowerCase();
  const port = target.port || (target.protocol === "https:" ? "443" : "80");

  for (const rawEntry of noProxy.split(/[\s,]+/)) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) {
      continue;
    }
    if (entry === "*") {
      return true;
    }

    const match = /^(.*?)(?::(\d+))?$/.exec(entry);
    const entryHost = match?.[1] ?? entry;
    const entryPort = match?.[2];
    if (entryPort && entryPort !== port) {
      continue;
    }

    const domain = entryHost.replace(/^\*?\./, "");
    if (domain && (hostname === domain || hostname.endsWith(`.${domain}`))) {
      return true;
    }
  }

  return false;
};

// OS bypass lists (macOS ExceptionsList, Windows ProxyOverride) use "*" wildcards;
// Windows "<local>" means host names without a dot.
export const matchesBypassList = (hostname: string, patterns: string[]): boolean => {
  const host = hostname.toLowerCase();

  return patterns.some((rawPattern) => {
    const pattern = rawPattern.trim().toLowerCase();
    if (!pattern) {
      return false;
    }
    if (pattern === "<local>") {
      return !host.includes(".");
    }
    if (pattern.includes("*")) {
      return new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`).test(host);
    }
    return host === pattern;
  });
};

const withEnvCredentials = (decision: ProxyDecision, env: Env): ProxyDecision => {
  if (!decision.proxy || decision.credentials) {
    return decision;
  }

  const username = env.BKLG_PROXY_USERNAME;
  if (!isNonEmptyString(username)) {
    return decision;
  }

  return { ...decision, credentials: { username, password: env.BKLG_PROXY_PASSWORD ?? "" } };
};

const describePacUrl = (pacUrl: string): string => {
  try {
    const url = new URL(pacUrl);
    return url.protocol === "file:" ? url.toString() : `${url.origin}${url.pathname}`;
  } catch {
    return pacUrl;
  }
};

// Returns null when the PAC file cannot be used, so the caller can fall back.
const resolveFromPac = async (
  target: URL,
  system: SystemProxySettings,
  pacUrl: string,
  options: ResolveProxyOptions,
): Promise<ProxyDecision | null> => {
  const log = options.log ?? (() => {});
  const source = `${system.origin} PAC ${describePacUrl(pacUrl)}`;

  const scriptResult = await (options.loadPac ?? loadPacScript)(pacUrl);
  if (!scriptResult.ok) {
    log(`could not load PAC file (${source}): ${scriptResult.error.message}`);
    return null;
  }

  const pacOptions: EvaluatePacOptions = { onAlert: (message) => log(`PAC alert: ${message}`) };
  if (options.pacTimeoutMs !== undefined) {
    pacOptions.timeoutMs = options.pacTimeoutMs;
  }
  const pacResult = await evaluatePac(scriptResult.value, target, pacOptions);
  if (!pacResult.ok) {
    log(`could not evaluate PAC file (${source}): ${pacResult.error.message}`);
    return null;
  }

  for (const entry of parsePacResult(pacResult.value)) {
    if (entry.type === "DIRECT") {
      return { source };
    }
    if (entry.type === "PROXY") {
      return { proxy: entry.url, source };
    }
    log(`skipping unsupported PAC entry: ${entry.value}`);
  }

  log(`PAC returned no usable proxy (${pacResult.value}); connecting directly`);
  return { source };
};

// Resolution order: NO_PROXY, HTTPS_PROXY/HTTP_PROXY, OS proxy settings (PAC first, then the
// HTTPS proxy), then a direct connection.
export const resolveProxy = async (
  target: URL,
  options: ResolveProxyOptions = {},
): Promise<Result<ProxyDecision>> => {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});

  const noProxy = readEnv(env, NO_PROXY_NAMES);
  if (noProxy && matchesNoProxy(target, noProxy.value)) {
    return ok({ source: noProxy.name });
  }

  const envProxy = readEnv(env, ENV_PROXY_NAMES);
  if (envProxy) {
    const parsed = parseProxyUrl(envProxy.value);
    if (!parsed) {
      return err(
        new Error(
          `Unsupported proxy URL in ${envProxy.name}. Use http://host:port or https://host:port.`,
        ),
      );
    }
    return ok(withEnvCredentials({ ...parsed, source: envProxy.name }, env));
  }

  const platform = options.platform ?? process.platform;
  const systemResult = await (options.readSystemSettings ?? readSystemProxySettings)(platform);
  if (!systemResult.ok) {
    log(`could not read system proxy settings: ${systemResult.error.message}`);
    return ok({ source: "default" });
  }

  const system = systemResult.value;
  if (!system) {
    return ok({ source: "default" });
  }

  if (system.pacUrl) {
    const pacDecision = await resolveFromPac(target, system, system.pacUrl, options);
    if (pacDecision) {
      return ok(withEnvCredentials(pacDecision, env));
    }
  }

  if (system.httpsProxy && !matchesBypassList(target.hostname, system.bypass)) {
    const parsed = parseProxyUrl(system.httpsProxy);
    if (parsed) {
      return ok(withEnvCredentials({ ...parsed, source: `${system.origin} proxy settings` }, env));
    }
    log(`ignoring unsupported system proxy: ${system.httpsProxy}`);
  }

  return ok({ source: `${system.origin} proxy settings` });
};

export const describeProxy = (decision: ProxyDecision): string => {
  if (!decision.proxy) {
    return "DIRECT";
  }
  const { protocol, hostname, port } = decision.proxy;
  const proxy = `${protocol}//${hostname}:${port || (protocol === "https:" ? "443" : "80")}`;
  return decision.credentials ? `${proxy} (with credentials)` : proxy;
};

const createDispatcher = (decision: ProxyDecision): Dispatcher | undefined => {
  if (!decision.proxy) {
    return undefined;
  }

  const options: ProxyAgent.Options = { uri: decision.proxy.toString() };
  if (decision.credentials) {
    const { username, password } = decision.credentials;
    options.token = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  return new ProxyAgent(options);
};

const transportCache = new Map<string, Promise<Result<ProxyTransport>>>();

// Resolves the proxy once per origin and process. Only the origin is used for routing (the PAC file
// gets scheme://host:port/ as well), so one decision per origin is exact and the path and apiKey
// never reach the proxy resolution.
export const getProxyTransport = (
  target: URL,
  log?: (message: string) => void,
): Promise<Result<ProxyTransport>> => {
  const cached = transportCache.get(target.origin);
  if (cached) {
    return cached;
  }

  const options: ResolveProxyOptions = log ? { log } : {};
  const origin = new URL(target.origin);
  const transport = resolveProxy(origin, options).then((result): Result<ProxyTransport> => {
    if (!result.ok) {
      return result;
    }
    const decision = result.value;
    log?.(`proxy ${describeProxy(decision)} (source: ${decision.source})`);
    const dispatcher = createDispatcher(decision);
    return ok(dispatcher ? { decision, dispatcher } : { decision });
  });

  transportCache.set(target.origin, transport);
  return transport;
};
