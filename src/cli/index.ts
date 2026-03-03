#!/usr/bin/env node
import fs from "node:fs/promises";

import { Command, InvalidArgumentError, Option } from "commander";
import {
  ApiError,
  getIssue,
  getIssueComments,
  getWiki,
  getWikis,
  getMyself,
  postIssueComment,
  searchIssues,
  type ApiAuth,
  type IssueCommentInput,
  type IssueSearchParams,
} from "../api/index.js";
import { login, logout, resolveAuth, status, type AuthInput } from "../auth/index.js";
import {
  formatComment,
  formatCommentDraft,
  formatCommentList,
  formatAuthLogin,
  formatAuthLogout,
  formatAuthStatus,
  formatError,
  formatIssue,
  formatIssueList,
  formatWiki,
  type OutputFormat,
} from "../format/index.js";
import { err, isNonEmptyString, ok, toError, type Result } from "../utils/index.js";

const program = new Command();

const rootHelpText = `
Auth resolution order (highest first):
  1) CLI args: --space, --host, --api-key
  2) Env vars: BACKLOG_SPACE, BACKLOG_HOST, BACKLOG_API_KEY
  3) Config file: ~/.config/bklg/config.json

Output format:
  md    AI/editor-friendly structured Markdown
  json  Backlog API-like JSON output (default)
  text  Compact human-readable text

Examples:
  $ bklg auth login --space your-space --api-key YOUR_API_KEY
  $ bklg issue view PROJ-123 --format md
  $ bklg issue search --project 123 --status 1 --assignee me --format text
`;

program
  .name("bklg")
  .description("Backlog API v2 thin wrapper CLI")
  .configureHelp({ showGlobalOptions: true })
  .showSuggestionAfterError(true)
  .addOption(new Option("--format <format>", "output format").choices(["md", "json", "text"]).default("json"))
  .option("--debug", "show debug logging", false)
  .addOption(new Option("--space <space>", "backlog space (required for authenticated commands)").env("BACKLOG_SPACE"))
  .addOption(new Option("--host <host>", "backlog host (e.g. backlog.jp, backlog.com)").env("BACKLOG_HOST"))
  .addOption(new Option("--api-key <key>", "backlog api key (required for authenticated commands)").env("BACKLOG_API_KEY"))
  .addHelpText("after", rootHelpText);

const auth = program.command("auth").description("Authentication commands");
const issue = program.command("issue").description("Issue commands");
const wiki = program.command("wiki").description("Wiki commands");

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

const resolveOutputFormat = (): OutputFormat | null => {
  const opts = program.opts<{ format?: string }>();
  const format = resolveFormat(opts.format);
  if (!format) {
    console.error(`Unsupported format: ${opts.format ?? ""}`);
    process.exitCode = 1;
    return null;
  }
  return format;
};

const withOutputFormat = (action: (format: OutputFormat) => Promise<void>) => {
  return async () => {
    const format = resolveOutputFormat();
    if (!format) {
      return;
    }
    await action(format);
  };
};

type CommandContext = {
  format: OutputFormat;
  debug: boolean;
  auth: ApiAuth;
  baseUrl: string;
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

type WriteCommentOptions = {
  message?: string;
  messageFile?: string;
  notify?: string;
  dryRun?: boolean;
};

const resolveCommandContext = async (): Promise<CommandContext | null> => {
  const opts = program.opts<{ format?: string; debug?: boolean; space?: string; host?: string; apiKey?: string }>();
  const format = resolveOutputFormat();
  if (!format) {
    return null;
  }

  const authResult = await resolveAuth(toAuthInput(opts));
  if (!authResult.ok) {
    writeError(authResult.error, format);
    return null;
  }

  return {
    format,
    debug: opts.debug ?? false,
    auth: authResult.value,
    baseUrl: `https://${authResult.value.space}.${authResult.value.host}`,
  };
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

const readMessageFile = async (filePath: string): Promise<Result<string>> => {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return ok(content);
  } catch (error) {
    return err(toError(error));
  }
};

const normalizeMessage = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
};

const resolveMessageContent = async (
  message: string | undefined,
  messageFile: string | undefined,
): Promise<Result<string>> => {
  if (isNonEmptyString(message)) {
    const normalized = normalizeMessage(message);
    if (!normalized) {
      return err(new Error("Message is empty."));
    }
    return ok(normalized);
  }

  if (isNonEmptyString(messageFile)) {
    const fileResult = await readMessageFile(messageFile.trim());
    if (!fileResult.ok) {
      return err(fileResult.error);
    }
    const normalized = normalizeMessage(fileResult.value);
    if (!normalized) {
      return err(new Error("Message file is empty."));
    }
    return ok(normalized);
  }

  return err(new Error("Missing required --message or --message-file."));
};

const parseNotifyIds = (value: string | undefined): Result<number[]> => {
  if (!isNonEmptyString(value)) {
    return ok([]);
  }

  const parts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const ids: number[] = [];
  for (const entry of parts) {
    const parsed = parseNumericId(entry);
    if (parsed === null) {
      return err(new Error(`Invalid --notify value: "${entry}". Use numeric user IDs.`));
    }
    ids.push(parsed);
  }

  return ok(ids);
};

auth
  .command("login")
  .description("Save API key to local config")
  .usage("--space <space> [--host <host>] --api-key <key>")
  .addHelpText(
    "after",
    `
Required:
  --space and --api-key must be provided from args or env.

Examples:
  $ bklg auth login --space hgwr --api-key YOUR_API_KEY
  $ bklg auth login --space hgwr --host backlog.com --api-key YOUR_API_KEY
`,
  )
  .action(
    withOutputFormat(async (format) => {
    const opts = program.opts<{ space?: string; host?: string; apiKey?: string }>();
    const input = toAuthInput(opts);
    const result = await login(input);
    if (!result.ok) {
      writeError(result.error, format);
      return;
    }
    console.log(formatAuthLogin(result.value, format));
    }),
  );

auth
  .command("status")
  .description("Show current auth settings (API key is masked)")
  .usage("[options]")
  .addHelpText(
    "after",
    `
Examples:
  $ bklg auth status
  $ bklg auth status --format md
`,
  )
  .action(
    withOutputFormat(async (format) => {
    const opts = program.opts<{ space?: string; host?: string; apiKey?: string }>();
    const input = toAuthInput(opts);
    const result = await status(input);
    if (!result.ok) {
      writeError(result.error, format);
      return;
    }

    console.log(formatAuthStatus(result.value, format));
    }),
  );

auth
  .command("logout")
  .description("Remove stored API key")
  .usage("[options]")
  .addHelpText(
    "after",
    `
Examples:
  $ bklg auth logout
  $ bklg auth logout --format md
`,
  )
  .action(
    withOutputFormat(async (format) => {
    const result = await logout();
    if (!result.ok) {
      writeError(result.error, format);
      return;
    }
    console.log(formatAuthLogout(result.value, format));
    }),
  );

issue
  .command("view")
  .description("View an issue by key or id")
  .usage("<issueKeyOrId> [options]")
  .argument("<issueKeyOrId>", "Issue key (PROJ-123) or numeric id")
  .addHelpText(
    "after",
    `
Examples:
  $ bklg issue view PROJ-123
  $ bklg issue view 12345 --format md
`,
  )
  .action(async (issueKeyOrId: string) => {
    const context = await resolveCommandContext();
    if (!context) {
      return;
    }

    const result = await getIssue(context.auth, issueKeyOrId, { debug: context.debug });
    if (!result.ok) {
      writeError(result.error, context.format);
      return;
    }

    console.log(formatIssue(result.value, context.format, { baseUrl: context.baseUrl }));
  });

issue
  .command("comments")
  .description("List issue comments")
  .usage("<issueKeyOrId> [options]")
  .argument("<issueKeyOrId>", "Issue key (PROJ-123) or numeric id")
  .addHelpText(
    "after",
    `
Examples:
  $ bklg issue comments PROJ-123 --format text
  $ bklg issue comments 12345 --format md
`,
  )
  .action(async (issueKeyOrId: string) => {
    const context = await resolveCommandContext();
    if (!context) {
      return;
    }

    const result = await getIssueComments(context.auth, issueKeyOrId, { debug: context.debug });
    if (!result.ok) {
      writeError(result.error, context.format);
      return;
    }

    console.log(formatCommentList(result.value, context.format));
  });

issue
  .command("writeComment")
  .description("Write a comment to an issue")
  .usage("<issueKeyOrId> (-m <text> | --message-file <path>) [options]")
  .argument("<issueKeyOrId>", "Issue key (PROJ-123) or numeric id")
  .addOption(new Option("-m, --message <text>", "comment content").conflicts("messageFile"))
  .addOption(new Option("--message-file <path>", "comment content file").conflicts("message"))
  .option("--notify <userIdCSV>", "notify user IDs (comma-separated)")
  .option("--dry-run", "show comment without posting", false)
  .addHelpText(
    "after",
    `
Notes:
  --message and --message-file are mutually exclusive.
  --notify accepts comma-separated numeric Backlog user IDs.

Examples:
  $ bklg issue writeComment PROJ-123 -m "Please review"
  $ bklg issue writeComment PROJ-123 --message-file ./comment.md --notify 1001,1002
  $ bklg issue writeComment PROJ-123 -m "draft only" --dry-run --format md
`,
  )
  .action(async (issueKeyOrId: string, writeOpts: WriteCommentOptions) => {
    const context = await resolveCommandContext();
    if (!context) {
      return;
    }

    const contentResult = await resolveMessageContent(writeOpts.message, writeOpts.messageFile);
    if (!contentResult.ok) {
      writeError(contentResult.error, context.format);
      return;
    }

    const notifyResult = parseNotifyIds(writeOpts.notify);
    if (!notifyResult.ok) {
      writeError(notifyResult.error, context.format);
      return;
    }

    const draft = {
      issueIdOrKey: issueKeyOrId,
      content: contentResult.value,
      notifiedUserIds: notifyResult.value,
    };

    if (writeOpts.dryRun) {
      console.log(formatCommentDraft(draft, context.format));
      return;
    }

    const input: IssueCommentInput = {
      content: contentResult.value,
    };
    if (notifyResult.value.length > 0) {
      input.notifiedUserIds = notifyResult.value;
    }

    const result = await postIssueComment(context.auth, issueKeyOrId, input, { debug: context.debug });
    if (!result.ok) {
      writeError(result.error, context.format);
      return;
    }

    if (context.format === "text") {
      console.log(`Comment posted: ${result.value.id}`);
      return;
    }

    console.log(formatComment(result.value, context.format));
  });

issue
  .command("search")
  .description("Search issues")
  .usage("[options]")
  .option("--project <projectId>", "project id (repeatable)", collectValues, [])
  .option("--status <statusId>", "status id (numeric)")
  .option("--assignee <assignee>", "assignee id (numeric) or 'me'")
  .option("--keyword <text>", "keyword")
  .option("--count <n>", "max results", parseNumberOption)
  .option("--offset <n>", "offset", parseNumberOption)
  .option("--sort <created|updated|dueDate>", "sort field")
  .option("--order <asc|desc>", "sort order")
  .addHelpText(
    "after",
    `
Notes:
  --project can be repeated: --project 1 --project 2
  --status and numeric --assignee use Backlog IDs.

Examples:
  $ bklg issue search --project 123 --status 1 --assignee me --format md
  $ bklg issue search --keyword "login" --count 20 --order desc --format text
`,
  )
  .action(async (searchOpts: SearchOptions) => {
    const context = await resolveCommandContext();
    if (!context) {
      return;
    }

    const paramsResult = await buildIssueSearchParams(searchOpts, context.auth, context.debug);
    if (!paramsResult.ok) {
      writeError(paramsResult.error, context.format);
      return;
    }

    const result = await searchIssues(context.auth, paramsResult.value, { debug: context.debug });
    if (!result.ok) {
      writeError(result.error, context.format);
      return;
    }

    console.log(formatIssueList(result.value, context.format, { baseUrl: context.baseUrl }));
  });

wiki
  .command("view")
  .description("View a wiki page by name")
  .usage("<pageName> --project <projectKeyOrId> [options]")
  .argument("<pageName>", "Wiki page name")
  .requiredOption("--project <projectKey>", "Project key for the wiki")
  .addHelpText(
    "after",
    `
Examples:
  $ bklg wiki view "Wiki Page" --project PROJ --format md
  $ bklg wiki view "API Rules" --project 123 --format json
`,
  )
  .action(async (pageName: string, opts: { project: string }) => {
    const context = await resolveCommandContext();
    if (!context) {
      return;
    }

    const listResult = await getWikis(context.auth, { projectIdOrKey: opts.project }, { debug: context.debug });
    if (!listResult.ok) {
      writeError(listResult.error, context.format);
      return;
    }

    const wikiSummary = listResult.value.find((entry) => entry.name === pageName);
    if (!wikiSummary) {
      writeError(
        new ApiError({
          status: 404,
          statusText: "Not Found",
          url: `wiki:${pageName} in project ${opts.project}`,
          body: { pageName, project: opts.project },
        }),
        context.format,
      );
      return;
    }

    const detailResult = await getWiki(context.auth, wikiSummary.id, { debug: context.debug });
    if (!detailResult.ok) {
      writeError(detailResult.error, context.format);
      return;
    }

    console.log(formatWiki(detailResult.value, context.format));
  });

void program.parseAsync();
