import { STATUS_CODES, type IncomingHttpHeaders } from "node:http";

import { request, type Dispatcher } from "undici";

import { err, ok, toError, type Result } from "../utils/index.js";
import { describeProxy, getProxyTransport, type ProxyTransport } from "./proxy.js";

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

export type ProxyErrorInfo = {
  proxy: string;
  // Status of the proxy's CONNECT response, when the proxy refused the tunnel.
  status?: number;
  statusText?: string;
  url: string;
};

export class ProxyError extends Error {
  info: ProxyErrorInfo;

  constructor(info: ProxyErrorInfo, message: string) {
    super(message);
    this.name = "ProxyError";
    this.info = info;
  }
}

export const isProxyError = (error: Error): error is ProxyError => error instanceof ProxyError;

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

const pickHeaders = (headers: IncomingHttpHeaders, names: string[]): string[] => {
  const lines: string[] = [];
  for (const name of names) {
    const value = headers[name];
    if (value) {
      lines.push(`${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
    }
  }
  return lines;
};

type HttpResponse = {
  status: number;
  statusText: string;
  headers: IncomingHttpHeaders;
  raw: string;
};

const parseResponseBody = (response: HttpResponse): unknown => {
  if (!response.raw) {
    return undefined;
  }

  const contentType = String(response.headers["content-type"] ?? "");
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(response.raw) as unknown;
    } catch {
      return response.raw;
    }
  }

  return response.raw;
};

const toProxyError = (error: Error, transport: ProxyTransport, safeUrl: string): ProxyError => {
  const proxy = describeProxy(transport.decision);
  // undici reports a refused CONNECT as "Proxy response (407) !== 200 when HTTP Tunneling".
  const tunnelStatus = /Proxy response \((\d{3})\)/.exec(error.message)?.[1];

  if (tunnelStatus) {
    const status = Number(tunnelStatus);
    return new ProxyError(
      { proxy, status, statusText: STATUS_CODES[status] ?? "Unknown", url: safeUrl },
      `Proxy refused the connection (${status} ${STATUS_CODES[status] ?? "Unknown"})`,
    );
  }

  return new ProxyError({ proxy, url: safeUrl }, `Request via proxy failed: ${error.message}`);
};

const sendRequest = async (
  url: URL,
  safeUrl: string,
  method: "GET" | "POST",
  body: URLSearchParams | undefined,
  transport: ProxyTransport,
): Promise<Result<HttpResponse>> => {
  const options: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    dispatcher?: Dispatcher;
  } = { method };

  if (body !== undefined) {
    options.headers = { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" };
    options.body = body.toString();
  }

  if (transport.dispatcher) {
    options.dispatcher = transport.dispatcher;
  }

  try {
    const response = await request(url, options);
    return ok({
      status: response.statusCode,
      statusText: STATUS_CODES[response.statusCode] ?? "",
      headers: response.headers,
      raw: await response.body.text(),
    });
  } catch (error) {
    const cause = toError(error);
    return err(transport.decision.proxy ? toProxyError(cause, transport, safeUrl) : cause);
  }
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
    const log = input.debug ? (message: string) => console.error(`[bklg] ${message}`) : undefined;

    const transportResult = await getProxyTransport(url, log);
    if (!transportResult.ok) {
      return err(transportResult.error);
    }

    log?.(`${method} ${safeUrl}`);

    const responseResult = await sendRequest(
      url,
      safeUrl,
      method,
      input.body,
      transportResult.value,
    );
    if (!responseResult.ok) {
      return err(responseResult.error);
    }
    const response = responseResult.value;

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

    const body = parseResponseBody(response);

    if (response.status < 200 || response.status >= 300) {
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
  const pageSize = 100;
  const comments: BacklogIssueComment[] = [];
  const path = `issues/${encodeURIComponent(issueIdOrKey)}/comments`;

  let minId: number | undefined;
  let maxId: number | undefined;
  let isDescendingOrder: boolean | undefined;
  let previousEdgeId: number | undefined;

  while (true) {
    const query: Record<string, QueryValues | undefined> = { count: pageSize };
    if (minId !== undefined) {
      query.minId = minId;
    }
    if (maxId !== undefined) {
      query.maxId = maxId;
    }

    const pageResult = await requestJson<BacklogIssueComment[]>(auth, {
      path,
      query,
      debug: options.debug ?? false,
    });
    if (!pageResult.ok) {
      return pageResult;
    }

    const page = pageResult.value;
    if (page.length === 0) {
      break;
    }

    comments.push(...page);

    if (page.length < pageSize) {
      break;
    }

    const firstId = page[0]?.id;
    const lastId = page.at(-1)?.id;
    if (firstId === undefined || lastId === undefined) {
      break;
    }

    if (isDescendingOrder === undefined) {
      isDescendingOrder = firstId > lastId;
    }

    if (previousEdgeId !== undefined && previousEdgeId === lastId) {
      break;
    }
    previousEdgeId = lastId;

    if (isDescendingOrder) {
      maxId = lastId - 1;
      if (maxId < 0) {
        break;
      }
      minId = undefined;
    } else {
      minId = lastId + 1;
      maxId = undefined;
    }
  }

  return ok(comments);
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
  params: { projectIdOrKey?: string },
  options: { debug?: boolean } = {},
): Promise<Result<BacklogWikiSummary[]>> => {
  return requestJson<BacklogWikiSummary[]>(auth, {
    path: "wikis",
    query: {
      projectIdOrKey: params.projectIdOrKey,
    },
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
