import { parentPort, workerData } from "node:worker_threads";

import { createPacResolver } from "pac-resolver";
import { QuickJS } from "quickjs-wasi";

// Runs FindProxyForURL() in a worker so the caller can terminate a PAC file that never finishes.

export type PacWorkerInput = {
  script: string;
  url: string;
};

export type PacWorkerMessage =
  | { type: "alert"; message: string }
  | { type: "result"; ok: true; value: string }
  | { type: "result"; ok: false; message: string };

const post = (message: PacWorkerMessage): void => {
  parentPort?.postMessage(message);
};

const toMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

const run = async ({ script, url }: PacWorkerInput): Promise<void> => {
  try {
    const vm = await QuickJS.create();
    try {
      const findProxyForURL = createPacResolver(vm, script, {
        // pac-resolver's default alert() writes to stdout; send it to the --debug log instead.
        sandbox: {
          alert: (message: unknown = "") => post({ type: "alert", message: String(message) }),
        },
      });
      post({ type: "result", ok: true, value: await findProxyForURL(url) });
    } finally {
      vm.dispose();
    }
  } catch (error) {
    post({ type: "result", ok: false, message: toMessage(error) });
  }
};

void run(workerData as PacWorkerInput);
