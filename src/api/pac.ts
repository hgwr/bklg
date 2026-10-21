import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { request } from "undici";

import { err, ok, toError, type Result } from "../utils/index.js";
import type { PacWorkerInput, PacWorkerMessage } from "./pac-worker.js";

const PAC_DOWNLOAD_TIMEOUT_MS = 10_000;
const PAC_EVALUATION_TIMEOUT_MS = 5_000;

export type PacEntry =
  { type: "DIRECT" } | { type: "PROXY"; url: URL } | { type: "UNSUPPORTED"; value: string };

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

    const response = await request(url, { signal: AbortSignal.timeout(PAC_DOWNLOAD_TIMEOUT_MS) });
    const body = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return err(new Error(`Failed to download PAC file (${response.statusCode})`));
    }
    return ok(body);
  } catch (error) {
    return err(toError(error));
  }
};

// As browsers do for https:// URLs, the PAC file only sees scheme://host:port/, never the path
// or the query (which carries the apiKey).
export const toPacTargetUrl = (target: URL): string => `${target.protocol}//${target.host}/`;

export type EvaluatePacOptions = {
  timeoutMs?: number;
  onAlert?: (message: string) => void;
};

// Runs FindProxyForURL() inside a QuickJS (WebAssembly) sandbox in a worker thread. The worker is
// terminated on timeout, which also stops PAC code stuck in a loop or waiting on a DNS lookup.
export const evaluatePac = (
  script: string,
  target: URL,
  options: EvaluatePacOptions = {},
): Promise<Result<string>> => {
  const timeoutMs = options.timeoutMs ?? PAC_EVALUATION_TIMEOUT_MS;
  const input: PacWorkerInput = { script, url: toPacTargetUrl(target) };

  return new Promise((resolve) => {
    let worker: Worker;
    try {
      // stdout: true keeps anything the worker prints out of the CLI's own output.
      worker = new Worker(new URL("./pac-worker.js", import.meta.url), {
        workerData: input,
        stdout: true,
      });
    } catch (error) {
      resolve(err(toError(error)));
      return;
    }
    worker.stdout.resume();

    let settled = false;
    const finish = (result: Result<string>): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(err(new Error(`PAC evaluation timed out after ${timeoutMs} ms`)));
    }, timeoutMs);

    worker.on("message", (message: PacWorkerMessage) => {
      if (message.type === "alert") {
        options.onAlert?.(message.message);
        return;
      }
      finish(message.ok ? ok(message.value) : err(new Error(message.message)));
    });
    worker.on("error", (error) => finish(err(error)));
    worker.on("exit", (code) => finish(err(new Error(`PAC worker exited (${code})`))));
  });
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
