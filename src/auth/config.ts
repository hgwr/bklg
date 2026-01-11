import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { err, ok, toError, type Result } from "../utils/index.js";

export type AuthConfig = {
  space?: string;
  host?: string;
  apiKey?: string;
};

const CONFIG_DIR = path.join(os.homedir(), ".config", "bklg");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const normalizeConfig = (input: unknown): AuthConfig => {
  if (!input || typeof input !== "object") {
    return {};
  }

  const record = input as Record<string, unknown>;
  const config: AuthConfig = {};

  if (isNonEmptyString(record.space)) {
    config.space = record.space.trim();
  }

  if (isNonEmptyString(record.host)) {
    config.host = record.host.trim();
  }

  if (isNonEmptyString(record.apiKey)) {
    config.apiKey = record.apiKey.trim();
  }

  return config;
};

export const configPath = (): string => CONFIG_PATH;

export const loadConfig = async (): Promise<Result<AuthConfig | null>> => {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return ok(normalizeConfig(JSON.parse(raw)));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return ok(null);
    }
    return err(toError(error));
  }
};

export const saveConfig = async (config: AuthConfig): Promise<Result<void>> => {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const body = `${JSON.stringify(config, null, 2)}\n`;
    await fs.writeFile(CONFIG_PATH, body, { mode: 0o600 });
    return ok(undefined);
  } catch (error) {
    return err(toError(error));
  }
};

export const deleteConfig = async (): Promise<Result<void>> => {
  try {
    await fs.unlink(CONFIG_PATH);
    return ok(undefined);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return ok(undefined);
    }
    return err(toError(error));
  }
};

export const hasConfigValues = (config: AuthConfig): boolean => {
  return isNonEmptyString(config.space) || isNonEmptyString(config.host);
};
