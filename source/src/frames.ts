import { FieldType, toDataFrame, type DataFrame } from '@grafana/data';
import type { Column, OutputFormat } from './types';
import type { SearchResult } from './jira';
import { cellValue, getPath } from './jira';

export function resultFrames(result: SearchResult, refId: string, format: OutputFormat, columns: Column[]): DataFrame[] {
  const frames: DataFrame[] = [];
  if (format === 'table' || format === 'both') {
    frames.push(toDataFrame({
      name: 'Jira issues', refId,
      fields: [
        ...columns.map(column => ({
          name: column.name ?? column.path,
          type: FieldType[column.type ?? 'string'],
          values: result.issues.map(issue => cellValue(getPath(issue, column.path), column.type)),
        })),
        { name: 'Issue JSON', type: FieldType.string, values: result.issues.map(issue => JSON.stringify(issue)) },
      ],
    }));
  }
  if (format === 'json' || format === 'both') {
    frames.push(toDataFrame({
      name: 'Jira JSON responses', refId,
      fields: [
        { name: 'Page', type: FieldType.number, values: result.pages.map((_, index) => index + 1) },
        { name: 'JSON', type: FieldType.string, values: result.pages.map(page => JSON.stringify(page)) },
      ],
    }));
  }
  for (const frame of frames) {
    frame.meta = {
      preferredVisualisationType: 'table',
      custom: { returnedIssues: result.issues.length, returnedPages: result.pages.length, truncated: result.truncated },
      notices: result.truncated ? [{ severity: 'warning', text: 'Jira results reached the configured issue or page limit. Increase the limits to retrieve more results.' }] : [],
    };
  }
  return frames;
}
