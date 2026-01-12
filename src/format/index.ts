import {
  isApiError,
  type ApiErrorInfo,
  type BacklogIssue,
  type BacklogIssueComment,
  type BacklogUser,
} from "../api/index.js";
import type { AuthStatus, LogoutStatus } from "../auth/index.js";

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

export type CommentDraft = {
  issueIdOrKey: string;
  content: string;
  notifiedUserIds: number[];
};

const formatUser = (user: BacklogUser | null | undefined, fallback: string): string => {
  if (!user) {
    return fallback;
  }
  if (user.name && user.userId) {
    return `${user.name} (${user.userId})`;
  }
  if (user.name) {
    return user.name;
  }
  if (user.userId) {
    return user.userId;
  }
  return `User ${user.id}`;
};

const formatAssignee = (assignee: BacklogUser | null | undefined): string => {
  return formatUser(assignee, "(unassigned)");
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

const formatCommentContent = (content: string | null | undefined): string => {
  const trimmed = content?.trim();
  if (!trimmed) {
    return "(no content)";
  }
  return trimmed;
};

const summarizeContent = (content: string | null | undefined, length = 50): string => {
  const compact = (content ?? "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(no content)";
  }
  if (compact.length <= length) {
    return compact;
  }
  const safeLength = Math.max(0, length - 3);
  return `${compact.slice(0, safeLength)}...`;
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

export const formatAuthLogin = (value: { space: string; host: string }, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(value, null, 2);
  }
  if (format === "md") {
    return ["# Auth Login", "", `- Space: ${value.space}`, `- Host: ${value.host}`].join("\n");
  }
  return `Logged in as ${value.space}.${value.host}`;
};

export const formatAuthStatus = (value: AuthStatus, format: OutputFormat): string => {
  const hasAuth = Boolean(value.space || value.apiKeyMasked);
  if (format === "json") {
    return JSON.stringify(value, null, 2);
  }
  if (!hasAuth) {
    return "Not logged in.";
  }

  const host = value.host ?? "(not set)";
  const apiKey = value.apiKeyMasked ?? "(not set)";

  if (format === "md") {
    const lines = ["# Auth Status", ""];
    if (value.space) {
      lines.push(`- Space: ${value.space}`);
    }
    lines.push(`- Host: ${host}`);
    lines.push(`- API Key: ${apiKey}`);
    return lines.join("\n");
  }

  const lines: string[] = [];
  if (value.space) {
    lines.push(`Space: ${value.space}`);
  }
  lines.push(`Host: ${host}`);
  lines.push(`API Key: ${apiKey}`);
  return lines.join("\n");
};

export const formatAuthLogout = (status: LogoutStatus, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify({ status }, null, 2);
  }

  const message = status === "missing" ? "Already logged out." : "Logged out.";
  if (format === "md") {
    return ["# Auth Logout", "", message].join("\n");
  }
  return message;
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

export const formatComment = (comment: BacklogIssueComment, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(comment, null, 2);
  }

  const author = formatUser(comment.createdUser, "(unknown)");
  const created = comment.created ?? "(unknown)";
  const updated = comment.updated ?? "";
  const content = formatCommentContent(comment.content);

  if (format === "text") {
    const lines = [`Comment ${comment.id} by ${author} at ${created}`];
    if (updated && updated !== created) {
      lines.push(`Updated: ${updated}`);
    }
    lines.push("", content);
    return lines.join("\n");
  }

  const lines = [
    `## Comment ${comment.id}`,
    "",
    `- Author: ${author}`,
    `- Created: ${created}`,
  ];
  if (updated && updated !== created) {
    lines.push(`- Updated: ${updated}`);
  }
  lines.push("", content);
  return lines.join("\n");
};

export const formatCommentList = (comments: BacklogIssueComment[], format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify(comments, null, 2);
  }

  if (comments.length === 0) {
    return "No comments found.";
  }

  if (format === "text") {
    return comments
      .map((comment) => {
        const author = formatUser(comment.createdUser, "(unknown)");
        const created = comment.created ?? "(unknown)";
        const summary = summarizeContent(comment.content);
        return `Comment by ${author} at ${created}: ${summary}`;
      })
      .join("\n");
  }

  return comments.map((comment) => formatComment(comment, "md")).join("\n\n");
};

export const formatCommentDraft = (draft: CommentDraft, format: OutputFormat): string => {
  if (format === "json") {
    return JSON.stringify({ dryRun: true, ...draft }, null, 2);
  }

  const notify = draft.notifiedUserIds.length > 0 ? draft.notifiedUserIds.join(", ") : "(none)";
  const content = formatCommentContent(draft.content);

  if (format === "text") {
    return `Dry run: comment to ${draft.issueIdOrKey}\nNotify: ${notify}\n\n${content}`;
  }

  return ["# Dry Run", "", `- Issue: ${draft.issueIdOrKey}`, `- Notify: ${notify}`, "", "## Content", content].join(
    "\n",
  );
};
