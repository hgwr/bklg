import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { request } from "undici";

import { err, ok, toError, type Result } from "../utils/index.js";

const PAC_TIMEOUT_MS = 10_000;

export type PacEntry =
  | { type: "DIRECT" }
  | { type: "PROXY"; url: URL }
  | { type: "UNSUPPORTED"; value: string };

// The PAC file itself is always fetched directly, as browsers do.
export const loadPacScript = async (pacUrl: string): Promise<Result<string>> => {
  try {
    const url = new URL(pacUrl);

    if (url.protocol === "file:") {
      return ok(await fs.readFile(fileURLToPath(url), "utf8"));
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return err(new Error(`Unsupported PAC URL scheme: ${url.protocol}`));
    }

    const response = await request(url, { signal: AbortSignal.timeout(PAC_TIMEOUT_MS) });
    const body = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return err(new Error(`Failed to download PAC file (${response.statusCode})`));
    }
    return ok(body);
  } catch (error) {
    return err(toError(error));
  }
};

// Runs FindProxyForURL() inside a QuickJS (WebAssembly) sandbox.
export const evaluatePac = async (script: string, target: URL): Promise<Result<string>> => {
  try {
    const [{ QuickJS }, { createPacResolver }] = await Promise.all([
      import("quickjs-wasi"),
      import("pac-resolver"),
    ]);
    const vm = await QuickJS.create();
    try {
      const findProxyForURL = createPacResolver(vm, script);
      return ok(await findProxyForURL(target));
    } finally {
      vm.dispose();
    }
  } catch (error) {
    return err(toError(error));
  }
};

// Parses a FindProxyForURL() result such as "PROXY a:80; PROXY b:80; DIRECT".
export const parsePacResult = (result: string): PacEntry[] => {
  const entries: PacEntry[] = [];

  for (const part of result.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const [keyword = "", address = ""] = trimmed.split(/\s+/, 2);
    switch (keyword.toUpperCase()) {
      case "DIRECT":
        entries.push({ type: "DIRECT" });
        break;
      case "PROXY":
      case "HTTP":
        entries.push(toPacProxyEntry("http:", address, trimmed));
        break;
      case "HTTPS":
        entries.push(toPacProxyEntry("https:", address, trimmed));
        break;
      default:
        entries.push({ type: "UNSUPPORTED", value: trimmed });
    }
  }

  return entries;
};

const toPacProxyEntry = (protocol: string, address: string, raw: string): PacEntry => {
  if (!address) {
    return { type: "UNSUPPORTED", value: raw };
  }
  try {
    return { type: "PROXY", url: new URL(`${protocol}//${address}`) };
  } catch {
    return { type: "UNSUPPORTED", value: raw };
  }
};
