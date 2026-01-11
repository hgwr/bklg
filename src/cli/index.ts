#!/usr/bin/env node
import { Command, Option } from "commander";
import { login, logout, status, type AuthInput } from "../auth/index.js";

const program = new Command();

program
  .name("bklg")
  .description("Backlog API v2 thin wrapper CLI")
  .option("--format <format>", "output format (md|json|text)", "json")
  .option("--debug", "show debug logging", false)
  .addOption(new Option("--space <space>", "backlog space").env("BACKLOG_SPACE"))
  .addOption(new Option("--host <host>", "backlog host").env("BACKLOG_HOST"))
  .addOption(new Option("--api-key <key>", "backlog api key").env("BACKLOG_API_KEY"));

const auth = program.command("auth").description("Authentication commands");

const toAuthInput = (opts: { space?: string; host?: string; apiKey?: string }): AuthInput => {
  const input: AuthInput = {};

  if (opts.space) {
    input.space = opts.space;
  }

  if (opts.host) {
    input.host = opts.host;
  }

  if (opts.apiKey) {
    input.apiKey = opts.apiKey;
  }

  return input;
};

auth
  .command("login")
  .description("Save API key to local config")
  .action(async () => {
    const opts = program.opts<{ space?: string; host?: string; apiKey?: string }>();
    const input = toAuthInput(opts);
    const result = await login(input);
    if (!result.ok) {
      console.error(result.error.message);
      process.exitCode = 1;
      return;
    }
    console.log(`Logged in as ${result.value.space}.${result.value.host}`);
  });

auth
  .command("status")
  .description("Show current auth settings")
  .action(async () => {
    const opts = program.opts<{ space?: string; host?: string; apiKey?: string }>();
    const input = toAuthInput(opts);
    const result = await status(input);
    if (!result.ok) {
      console.error(result.error.message);
      process.exitCode = 1;
      return;
    }

    const { space, host, apiKeyMasked } = result.value;
    if (!space && !apiKeyMasked) {
      console.log("Not logged in.");
      return;
    }

    if (space) {
      console.log(`Space: ${space}`);
    }
    if (host) {
      console.log(`Host: ${host}`);
    }
    console.log(`API Key: ${apiKeyMasked ?? "(not set)"}`);
  });

auth
  .command("logout")
  .description("Remove stored API key")
  .action(async () => {
    const result = await logout();
    if (!result.ok) {
      console.error(result.error.message);
      process.exitCode = 1;
      return;
    }
    if (result.value === "missing") {
      console.log("Already logged out.");
      return;
    }
    console.log("Logged out.");
  });

void program.parseAsync();
