import type { DataQuery, DataSourceJsonData } from '@grafana/data';

export type JiraEdition = 'cloud' | 'datacenter';
export type OutputFormat = 'table' | 'json' | 'both';
export type ColumnType = 'string' | 'number' | 'boolean' | 'time';
export interface Column { path: string; name?: string; type?: ColumnType }
export interface JiraQuery extends DataQuery {
  jql: string;
  fields?: string;
  columnsJson?: string;
  format?: OutputFormat;
  pageSize?: number;
  maxIssues?: number;
  maxPages?: number;
}
export interface JiraOptions extends DataSourceJsonData {
  jiraUrl?: string;
  edition?: JiraEdition;
}
export interface JiraSecureOptions { authorization?: string }
export type JiraIssue = Record<string, unknown>;
export interface JiraPage {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
  startAt?: number;
  maxResults?: number;
  total?: number;
  [key: string]: unknown;
}
export const DEFAULT_COLUMNS: Column[] = [
  { path: 'key', name: 'Key' },
  { path: 'fields.summary', name: 'Summary' },
  { path: 'fields.status.name', name: 'Status' },
  { path: 'fields.assignee.displayName', name: 'Assignee' },
  { path: 'fields.created', name: 'Created', type: 'time' },
  { path: 'fields.updated', name: 'Updated', type: 'time' },
];
export const DEFAULT_QUERY: Omit<JiraQuery, 'refId'> = {
  jql: '',
  fields: 'summary,status,assignee,created,updated',
  columnsJson: JSON.stringify(DEFAULT_COLUMNS, null, 2),
  format: 'table',
  pageSize: 100,
  maxIssues: 1000,
  maxPages: 100,
};
