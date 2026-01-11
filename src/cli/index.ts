#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("bklg")
  .description("Backlog API v2 thin wrapper CLI")
  .option("--format <format>", "output format (md|json|text)", "json")
  .option("--debug", "show debug logging", false)
  .option("--space <space>", "backlog space").env("BACKLOG_SPACE")
  .option("--host <host>", "backlog host", "backlog.jp").env("BACKLOG_HOST")
  .option("--api-key <key>", "backlog api key");

program.parse();
