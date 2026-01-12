import { deleteConfig, hasConfigValues, loadConfig, saveConfig } from "./config.js";
import { err, isNonEmptyString, ok, type Result } from "../utils/index.js";
import type { ApiAuth } from "../api/index.js";

export type AuthInput = {
  space?: string;
  host?: string;
  apiKey?: string;
};

export type AuthStatus = {
  space?: string;
  host?: string;
  apiKeyMasked?: string;
};

export type LogoutStatus = "missing" | "cleared" | "deleted";

const maskApiKey = (apiKey: string): string => {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return "*".repeat(trimmed.length);
  }
  const head = trimmed.slice(0, 2);
  const tail = trimmed.slice(-2);
  return `${head}${"*".repeat(trimmed.length - 4)}${tail}`;
};

const resolveHost = (value?: string): string =>
  isNonEmptyString(value) ? value.trim() : "backlog.jp";

export const login = async (input: AuthInput): Promise<Result<{ space: string; host: string }>> => {
  const space = isNonEmptyString(input.space) ? input.space.trim() : undefined;
  const apiKey = isNonEmptyString(input.apiKey) ? input.apiKey.trim() : undefined;
  const host = resolveHost(input.host);

  if (!space || !apiKey) {
    return err(new Error("Missing required --space or --api-key (or BACKLOG_SPACE/BACKLOG_API_KEY)."));
  }

  const saved = await saveConfig({ space, host, apiKey });
  if (!saved.ok) {
    return err(saved.error);
  }

  return ok({ space, host });
};

export const status = async (input: AuthInput): Promise<Result<AuthStatus>> => {
  const configResult = await loadConfig();
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const config = configResult.value ?? {};

  const space = isNonEmptyString(input.space) ? input.space.trim() : config.space;
  const host = resolveHost(isNonEmptyString(input.host) ? input.host.trim() : config.host);
  const apiKey = isNonEmptyString(input.apiKey) ? input.apiKey.trim() : config.apiKey;

  const status: AuthStatus = { host };

  if (space) {
    status.space = space;
  }

  if (apiKey) {
    status.apiKeyMasked = maskApiKey(apiKey);
  }

  return ok(status);
};

export const resolveAuth = async (input: AuthInput): Promise<Result<ApiAuth>> => {
  const configResult = await loadConfig();
  if (!configResult.ok) {
    return err(configResult.error);
  }

  const config = configResult.value ?? {};
  const space = isNonEmptyString(input.space) ? input.space.trim() : config.space;
  const host = resolveHost(isNonEmptyString(input.host) ? input.host.trim() : config.host);
  const apiKey = isNonEmptyString(input.apiKey) ? input.apiKey.trim() : config.apiKey;

  if (!space || !apiKey) {
    return err(new Error("Missing required --space or --api-key (or BACKLOG_SPACE/BACKLOG_API_KEY)."));
  }

  return ok({ space, host, apiKey });
};

export const logout = async (): Promise<Result<LogoutStatus>> => {
  const configResult = await loadConfig();
  if (!configResult.ok) {
    return err(configResult.error);
  }

  if (!configResult.value) {
    return ok("missing");
  }

  const { apiKey: _apiKey, ...config } = configResult.value;

  if (!hasConfigValues(config)) {
    const deleted = await deleteConfig();
    return deleted.ok ? ok("deleted") : err(deleted.error);
  }

  const saved = await saveConfig(config);
  return saved.ok ? ok("cleared") : err(saved.error);
};
