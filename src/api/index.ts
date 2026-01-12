import { err, ok, toError, type Result } from "../utils/index.js";

export type ApiAuth = {
  space: string;
  host: string;
  apiKey: string;
};

export type ApiErrorInfo = {
  status: number;
  statusText: string;
  url: string;
  body?: unknown;
};

export class ApiError extends Error {
  info: ApiErrorInfo;

  constructor(info: ApiErrorInfo) {
    super(`Request failed (${info.status} ${info.statusText})`);
    this.name = "ApiError";
    this.info = info;
  }
}

export const isApiError = (error: Error): error is ApiError => error instanceof ApiError;

export type BacklogUser = {
  id: number;
  name?: string;
  userId?: string;
};

export type BacklogStatus = {
  id: number;
  name: string;
};

export type BacklogPriority = {
  id: number;
  name: string;
};

export type BacklogIssue = {
  id: number;
  issueKey: string;
  summary: string;
  description?: string | null;
  status?: BacklogStatus;
  priority?: BacklogPriority;
  assignee?: BacklogUser | null;
  dueDate?: string | null;
};

export type BacklogIssueComment = {
  id: number;
  content?: string | null;
  created?: string;
  updated?: string;
  createdUser?: BacklogUser;
  updatedUser?: BacklogUser;
};

export type BacklogWikiTag = {
  id: number;
  name: string;
};

export type BacklogWikiSummary = {
  id: number;
  name: string;
  projectId?: number;
  tags?: BacklogWikiTag[];
  created?: string;
  updated?: string;
  createdUser?: BacklogUser;
  updatedUser?: BacklogUser;
};

export type BacklogWikiDetail = {
  id: number;
  name: string;
  projectId?: number;
  content?: string | null;
  tags?: BacklogWikiTag[];
  created?: string;
  updated?: string;
  createdUser?: BacklogUser;
  updatedUser?: BacklogUser;
};

export type IssueSearchParams = {
  projectId?: string[];
  statusId?: number[];
  assigneeId?: number[];
  keyword?: string;
  count?: number;
  offset?: number;
  sort?: string;
  order?: string;
};

export type IssueCommentInput = {
  content: string;
  notifiedUserIds?: number[];
};

type QueryValue = string | number | boolean;
type QueryValues = QueryValue | QueryValue[];

type RequestInput = {
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, QueryValues | undefined>;
  body?: URLSearchParams;
  debug?: boolean;
};

const buildBaseUrl = (auth: ApiAuth): string => `https://${auth.space}.${auth.host}/api/v2/`;

const addQueryParam = (url: URL, key: string, value: QueryValues | undefined): void => {
  if (value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      url.searchParams.append(key, String(entry));
    }
    return;
  }

  url.searchParams.set(key, String(value));
};

const maskApiKey = (url: URL): string => {
  const masked = new URL(url.toString());
  if (masked.searchParams.has("apiKey")) {
    masked.searchParams.set("apiKey", "***");
  }
  return masked.toString();
};

const pickHeaders = (headers: Headers, names: string[]): string[] => {
  const lines: string[] = [];
  for (const name of names) {
    const value = headers.get(name);
    if (value) {
      lines.push(`${name}: ${value}`);
    }
  }
  return lines;
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const raw = await response.text();
  if (!raw) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  return raw;
};

const requestJson = async <T>(auth: ApiAuth, input: RequestInput): Promise<Result<T>> => {
  try {
    const baseUrl = buildBaseUrl(auth);
    const normalizedPath = input.path.startsWith("/") ? input.path.slice(1) : input.path;
    const url = new URL(normalizedPath, baseUrl);

    if (input.query) {
      for (const [key, value] of Object.entries(input.query)) {
        addQueryParam(url, key, value);
      }
    }

    url.searchParams.set("apiKey", auth.apiKey);

    const safeUrl = maskApiKey(url);
    const method = input.method ?? "GET";

    if (input.debug) {
      console.error(`[bklg] ${method} ${safeUrl}`);
    }

    const requestInit: RequestInit = { method };
    if (input.body !== undefined) {
      requestInit.body = input.body;
    }

    const response = await fetch(url.toString(), requestInit);

    if (input.debug) {
      console.error(`[bklg] status ${response.status} ${response.statusText}`);
      const headerLines = pickHeaders(response.headers, [
        "content-type",
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
        "x-rate-limit-remaining",
        "x-rate-limit-reset",
      ]);
      if (headerLines.length > 0) {
        console.error(`[bklg] headers ${headerLines.join(", ")}`);
      }
    }

    const body = await parseResponseBody(response);

    if (!response.ok) {
      return err(
        new ApiError({
          status: response.status,
          statusText: response.statusText,
          url: safeUrl,
          body,
        }),
      );
    }

    return ok(body as T);
  } catch (error) {
    return err(toError(error));
  }
};

export const getIssue = async (
  auth: ApiAuth,
  issueIdOrKey: string,
  options: { debug?: boolean } = {},
): Promise<Result<BacklogIssue>> => {
  return requestJson<BacklogIssue>(auth, {
    path: `issues/${encodeURIComponent(issueIdOrKey)}`,
    debug: options.debug ?? false,
  });
};

export const searchIssues = async (
  auth: ApiAuth,
  params: IssueSearchParams,
  options: { debug?: boolean } = {},
): Promise<Result<BacklogIssue[]>> => {
  const query: Record<string, QueryValues | undefined> = {
    "projectId[]": params.projectId,
    "statusId[]": params.statusId,
    "assigneeId[]": params.assigneeId,
    keyword: params.keyword,
    count: params.count,
    offset: params.offset,
    sort: params.sort,
    order: params.order,
  };

  return requestJson<BacklogIssue[]>(auth, {
    path: "issues",
    query,
    debug: options.debug ?? false,
  });
};

export const getMyself = async (
  auth: ApiAuth,
  options: { debug?: boolean } = {},
): Promise<Result<BacklogUser>> => {
  return requestJson<BacklogUser>(auth, {
    path: "users/myself",
    debug: options.debug ?? false,
  });
};

export const getIssueComments = async (
  auth: ApiAuth,
  issueIdOrKey: string,
  options: { debug?: boolean } = {},
): Promise<Result<BacklogIssueComment[]>> => {
  return requestJson<BacklogIssueComment[]>(auth, {
    path: `issues/${encodeURIComponent(issueIdOrKey)}/comments`,
    debug: options.debug ?? false,
  });
};

export const postIssueComment = async (
  auth: ApiAuth,
  issueIdOrKey: string,
  input: IssueCommentInput,
  options: { debug?: boolean } = {},
): Promise<Result<BacklogIssueComment>> => {
  const body = new URLSearchParams();
  body.set("content", input.content);

  if (input.notifiedUserIds && input.notifiedUserIds.length > 0) {
    for (const userId of input.notifiedUserIds) {
      body.append("notifiedUserId[]", String(userId));
    }
  }

  return requestJson<BacklogIssueComment>(auth, {
    path: `issues/${encodeURIComponent(issueIdOrKey)}/comments`,
    method: "POST",
    body,
    debug: options.debug ?? false,
  });
};

export const getWikis = async (
  auth: ApiAuth,
  options: { debug?: boolean } = {},
): Promise<Result<BacklogWikiSummary[]>> => {
  return requestJson<BacklogWikiSummary[]>(auth, {
    path: "wikis",
    debug: options.debug ?? false,
  });
};

export const getWiki = async (
  auth: ApiAuth,
  wikiId: number,
  options: { debug?: boolean } = {},
): Promise<Result<BacklogWikiDetail>> => {
  return requestJson<BacklogWikiDetail>(auth, {
    path: `wikis/${wikiId}`,
    debug: options.debug ?? false,
  });
};
