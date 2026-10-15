import type { Column, JiraEdition, JiraIssue, JiraPage } from './types';
import { DEFAULT_COLUMNS } from './types';

export interface SearchOptions {
  edition: JiraEdition;
  jql: string;
  fields: string[];
  pageSize: number;
  maxIssues: number;
  maxPages: number;
}
export interface SearchResult { issues: JiraIssue[]; pages: JiraPage[]; truncated: boolean }
export type Transport = (route: string, body: Record<string, unknown>) => Promise<unknown>;

export function validateBaseUrl(value: string | undefined): string {
  if (!value?.trim()) { throw new Error('Configure the Jira base URL, then Save & test.'); }
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Jira URL must be HTTP(S), without credentials, query parameters, or a fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}
export function integer(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return result;
}
export function parseColumns(value?: string): Column[] {
  const columns: unknown = value?.trim() ? JSON.parse(value) : DEFAULT_COLUMNS;
  if (!Array.isArray(columns) || !columns.length || columns.length > 100) {
    throw new Error('Columns must be a JSON array with 1–100 entries.');
  }
  const names = new Set<string>();
  for (const column of columns) {
    if (!column || typeof column !== 'object' || typeof column.path !== 'string' || !column.path.trim() ||
        (column.name !== undefined && (typeof column.name !== 'string' || !column.name.trim())) ||
        (column.type !== undefined && !['string', 'number', 'boolean', 'time'].includes(column.type))) {
      throw new Error('Each column needs a path, an optional name, and type string, number, boolean, or time.');
    }
    const name = column.name ?? column.path;
    if (name === 'Issue JSON' || names.has(name)) { throw new Error(`Duplicate or reserved column name: ${name}`); }
    names.add(name);
  }
  return columns;
}
export function getPath(object: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) { return undefined; }
    return (value as Record<string, unknown>)[part];
  }, object);
}
export function cellValue(value: unknown, type: Column['type']): string | number | boolean | null {
  if (value === null || value === undefined) { return null; }
  switch (type ?? 'string') {
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? value : null;
    case 'boolean': return typeof value === 'boolean' ? value : null;
    case 'time': {
      const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
      return Number.isFinite(time) ? time : null;
    }
    default: return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}
function parsePage(value: unknown): JiraPage {
  if (!value || typeof value !== 'object' || !Array.isArray((value as JiraPage).issues)) {
    throw new Error('Jira returned an unexpected response: expected a JSON object with an issues array.');
  }
  const page = value as JiraPage;
  if (page.issues.some(issue => !issue || typeof issue !== 'object' || Array.isArray(issue))) {
    throw new Error('Jira returned a malformed issue.');
  }
  if ((page.total !== undefined && (!Number.isInteger(page.total) || page.total < 0)) ||
      (page.startAt !== undefined && (!Number.isInteger(page.startAt) || page.startAt < 0)) ||
      (page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string') ||
      (page.isLast !== undefined && typeof page.isLast !== 'boolean')) {
    throw new Error('Jira returned malformed pagination metadata.');
  }
  return page;
}

export async function searchJira(options: SearchOptions, transport: Transport): Promise<SearchResult> {
  const { edition, fields, pageSize, maxIssues, maxPages } = options;
  const jql = options.jql.trim();
  if (!jql) { throw new Error('Enter a JQL query.'); }
  integer(pageSize, 100, 1, 100, 'Page size');
  integer(maxIssues, 1000, 1, 100000, 'Issue limit');
  integer(maxPages, 100, 1, 1000, 'Page limit');
  const result: SearchResult = { issues: [], pages: [], truncated: false };
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;
  let startAt = 0;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const body: Record<string, unknown> = {
      jql, fields, maxResults: Math.min(pageSize, maxIssues - result.issues.length),
    };
    if (edition === 'cloud') {
      if (nextPageToken) { body.nextPageToken = nextPageToken; }
    } else { body.startAt = startAt; }
    const page = parsePage(await transport(edition === 'cloud' ? 'cloud-search' : 'dc-search', body));
    result.pages.push(page); // Preserve each complete JSON page, including response metadata.
    result.issues.push(...page.issues.slice(0, maxIssues - result.issues.length));
    let hasMore: boolean;
    if (edition === 'cloud') {
      hasMore = page.isLast !== true && Boolean(page.nextPageToken);
      if (page.isLast === false && !page.nextPageToken) {
        throw new Error('Jira reported more results but did not provide a nextPageToken.');
      }
      if (hasMore) {
        nextPageToken = page.nextPageToken!;
        if (seenTokens.has(nextPageToken)) { throw new Error('Jira repeated a pagination token; stopping to prevent a loop.'); }
        seenTokens.add(nextPageToken);
      }
    } else {
      if (page.startAt !== undefined && page.startAt !== startAt) { throw new Error('Jira returned an unexpected page offset.'); }
      const nextStart = startAt + page.issues.length;
      hasMore = page.total !== undefined ? nextStart < page.total : page.issues.length > 0;
      if (hasMore && !page.issues.length) { throw new Error('Jira returned an empty page before the reported total.'); }
      startAt = nextStart; // Use actual page length; Jira may return less than maxResults.
    }
    if (!hasMore) {
      result.truncated = page.issues.length > Number(body.maxResults);
      return result;
    }
    if (result.issues.length >= maxIssues) { result.truncated = true; return result; }
  }
  result.truncated = true;
  return result;
}

export function jiraError(error: unknown): string {
  if (error instanceof Error) { return error.message; }
  if (!error || typeof error !== 'object') { return 'Jira request failed.'; }
  const e = error as {status?: number; statusText?: string; data?: {errorMessages?: string[]; errors?: Record<string, string>; message?: string}};
  const messages = [
    ...(Array.isArray(e.data?.errorMessages) ? e.data!.errorMessages! : []),
    ...Object.values(e.data?.errors ?? {}),
    ...(e.data?.message ? [e.data.message] : []),
  ];
  return `Jira HTTP ${e.status ?? 'error'}${messages.length ? `: ${messages.join('; ')}` : `: ${e.statusText || 'request failed'}`}`;
}
