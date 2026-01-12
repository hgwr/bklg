import { isApiError, type ApiErrorInfo, type BacklogIssue, type BacklogUser } from "../api/index.js";

export type OutputFormat = "md" | "json" | "text";

export type FormatContext = {
  baseUrl?: string;
};

type ErrorPayload = {
  message: string;
  status?: number;
  statusText?: string;
  details?: unknown;
  url?: string;
};

const formatAssignee = (assignee: BacklogUser | null | undefined): string => {
  if (!assignee) {
    return "(unassigned)";
  }
  if (assignee.name && assignee.userId) {
    return `${assignee.name} (${assignee.userId})`;
  }
  if (assignee.name) {
    return assignee.name;
  }
  if (assignee.userId) {
    return assignee.userId;
  }
  return `User ${assignee.id}`;
};

const toIssueTitle = (issue: BacklogIssue): string => {
  const identifier = issue.issueKey || String(issue.id);
  return issue.summary ? `${identifier} ${issue.summary}` : identifier;
};

const toIssueUrl = (issue: BacklogIssue, context?: FormatContext): string | undefined => {
  if (!context?.baseUrl || !issue.issueKey) {
    return undefined;
  }
  return `${context.baseUrl}/view/${issue.issueKey}`;
};

const toErrorPayload = (error: Error): ErrorPayload => {
  if (isApiError(error)) {
    const info: ApiErrorInfo = error.info;
    return {
      message: error.message,
      status: info.status,
      statusText: info.statusText,
      details: info.body,
      url: info.url,
    };
  }

  return { message: error.message };
};

const formatFriendlyError = (payload: ErrorPayload): string => {
  if (payload.status === 401 || payload.status === 403) {
    return "Authentication failed. Check --api-key/--space or BACKLOG_API_KEY/BACKLOG_SPACE.";
  }
  if (payload.status === 404) {
    return "Not found. Check the issue key/id or your permissions.";
  }
  if (payload.status === 429) {
    return "Rate limit exceeded. Please retry later.";
  }
  if (payload.status) {
    return `Request failed (${payload.status} ${payload.statusText ?? "Unknown"}).`;
  }
  return payload.message;
};

export const formatError = (error: Error, format: OutputFormat): string => {
  const payload = toErrorPayload(error);
  if (format === "json") {
    return JSON.stringify({ error: payload }, null, 2);
  }
  return formatFriendlyError(payload);
};

export const formatIssue = (
  issue: BacklogIssue,
  format: OutputFormat,
  context: FormatContext = {},
): string => {
  if (format === "json") {
    return JSON.stringify(issue, null, 2);
  }

  const status = issue.status?.name ?? "(unknown)";
  const priority = issue.priority?.name ?? "(unknown)";
  const assignee = formatAssignee(issue.assignee);
  const due = issue.dueDate ?? "(none)";

  if (format === "text") {
    const lines = [toIssueTitle(issue), `Status: ${status} | Priority: ${priority} | Assignee: ${assignee} | Due: ${due}`];
    const description = issue.description?.trim();
    if (description) {
      lines.push("", description);
    }
    return lines.join("\n");
  }

  const description = issue.description?.trim() || "(no description)";

  return [
    `# ${toIssueTitle(issue)}`,
    "",
    `- Status: ${status}`,
    `- Priority: ${priority}`,
    `- Assignee: ${assignee}`,
    `- Due: ${due}`,
    "",
    "## Description",
    description,
  ].join("\n");
};

export const formatIssueList = (
  issues: BacklogIssue[],
  format: OutputFormat,
  context: FormatContext = {},
): string => {
  if (format === "json") {
    return JSON.stringify(issues, null, 2);
  }

  if (issues.length === 0) {
    return "No issues found.";
  }

  if (format === "text") {
    return issues
      .map((issue) => {
        const status = issue.status?.name ?? "(unknown)";
        const summary = issue.summary ?? "";
        return `${issue.issueKey ?? issue.id} ${summary} (Status: ${status})`.trim();
      })
      .join("\n");
  }

  return issues
    .map((issue) => {
      const status = issue.status?.name ?? "(unknown)";
      const summary = issue.summary ?? "";
      const label = issue.issueKey ?? String(issue.id);
      const issueUrl = toIssueUrl(issue, context);
      const display = issueUrl ? `[${label}](${issueUrl})` : label;
      return `- ${display} ${summary} (Status: ${status})`.trim();
    })
    .join("\n");
};
