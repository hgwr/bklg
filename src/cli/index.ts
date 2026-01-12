#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from "commander";
import { getIssue, getMyself, searchIssues, type ApiAuth, type IssueSearchParams } from "../api/index.js";
import { login, logout, resolveAuth, status, type AuthInput } from "../auth/index.js";
import { formatError, formatIssue, formatIssueList, type OutputFormat } from "../format/index.js";
import { err, ok, type Result } from "../utils/index.js";

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
const issue = program.command("issue").description("Issue commands");

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

const resolveFormat = (value: string | undefined): OutputFormat | null => {
  switch (value) {
    case "md":
    case "json":
    case "text":
      return value;
    default:
      return null;
  }
};

const collectValues = (value: string, previous: string[]): string[] => {
  return [...previous, value];
};

const parseNumberOption = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new InvalidArgumentError(`Expected a number, got "${value}".`);
  }
  return parsed;
};

const parseNumericId = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const writeError = (error: Error, format: OutputFormat): void => {
  const message = formatError(error, format);
  if (format === "json") {
    console.log(message);
  } else {
    console.error(message);
  }
  process.exitCode = 1;
};

type SearchOptions = {
  project: string[];
  status?: string;
  assignee?: string;
  keyword?: string;
  count?: number;
  offset?: number;
  sort?: string;
  order?: string;
};

const buildIssueSearchParams = async (
  searchOpts: SearchOptions,
  auth: ApiAuth,
  debug: boolean,
): Promise<Result<IssueSearchParams>> => {
  const params: IssueSearchParams = {};

  if (searchOpts.project.length > 0) {
    params.projectId = searchOpts.project;
  }

  if (searchOpts.status) {
    const statusId = parseNumericId(searchOpts.status);
    if (statusId === null) {
      return err(new Error("Invalid --status. Provide a numeric statusId."));
    }
    params.statusId = [statusId];
  }

  if (searchOpts.assignee) {
    if (searchOpts.assignee === "me") {
      const meResult = await getMyself(auth, { debug });
      if (!meResult.ok) {
        return err(meResult.error);
      }
      params.assigneeId = [meResult.value.id];
    } else {
      const assigneeId = parseNumericId(searchOpts.assignee);
      if (assigneeId === null) {
        return err(new Error("Invalid --assignee. Provide a numeric userId or 'me'."));
      }
      params.assigneeId = [assigneeId];
    }
  }

  if (searchOpts.keyword) {
    params.keyword = searchOpts.keyword;
  }

  if (searchOpts.count !== undefined) {
    params.count = searchOpts.count;
  }

  if (searchOpts.offset !== undefined) {
    params.offset = searchOpts.offset;
  }

  if (searchOpts.sort) {
    params.sort = searchOpts.sort;
  }

  if (searchOpts.order) {
    params.order = searchOpts.order;
  }

  return ok(params);
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

issue
  .command("view")
  .description("View an issue by key or id")
  .argument("<issueKeyOrId>", "Issue key (PROJ-123) or numeric id")
  .action(async (issueKeyOrId: string) => {
    const opts = program.opts<{ format?: string; debug?: boolean; space?: string; host?: string; apiKey?: string }>();
    const format = resolveFormat(opts.format);
    if (!format) {
      console.error(`Unsupported format: ${opts.format ?? ""}`);
      process.exitCode = 1;
      return;
    }

    const authResult = await resolveAuth(toAuthInput(opts));
    if (!authResult.ok) {
      writeError(authResult.error, format);
      return;
    }

    const result = await getIssue(authResult.value, issueKeyOrId, { debug: opts.debug ?? false });
    if (!result.ok) {
      writeError(result.error, format);
      return;
    }

    const baseUrl = `https://${authResult.value.space}.${authResult.value.host}`;
    console.log(formatIssue(result.value, format, { baseUrl }));
  });

issue
  .command("search")
  .description("Search issues")
  .option("--project <projectId>", "project id (repeatable)", collectValues, [])
  .option("--status <statusId>", "status id (numeric)")
  .option("--assignee <assignee>", "assignee id (numeric) or 'me'")
  .option("--keyword <text>", "keyword")
  .option("--count <n>", "max results", parseNumberOption)
  .option("--offset <n>", "offset", parseNumberOption)
  .option("--sort <created|updated|dueDate>", "sort field")
  .option("--order <asc|desc>", "sort order")
  .action(async (searchOpts: SearchOptions) => {
    const opts = program.opts<{ format?: string; debug?: boolean; space?: string; host?: string; apiKey?: string }>();
    const format = resolveFormat(opts.format);
    if (!format) {
      console.error(`Unsupported format: ${opts.format ?? ""}`);
      process.exitCode = 1;
      return;
    }

    const authResult = await resolveAuth(toAuthInput(opts));
    if (!authResult.ok) {
      writeError(authResult.error, format);
      return;
    }

    const paramsResult = await buildIssueSearchParams(searchOpts, authResult.value, opts.debug ?? false);
    if (!paramsResult.ok) {
      writeError(paramsResult.error, format);
      return;
    }

    const result = await searchIssues(authResult.value, paramsResult.value, { debug: opts.debug ?? false });
    if (!result.ok) {
      writeError(result.error, format);
      return;
    }

    const baseUrl = `https://${authResult.value.space}.${authResult.value.host}`;
    console.log(formatIssueList(result.value, format, { baseUrl }));
  });

void program.parseAsync();
