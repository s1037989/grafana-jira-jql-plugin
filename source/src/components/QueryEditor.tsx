import React from 'react';
import type { QueryEditorProps } from '@grafana/data';
import { Alert, InlineField, Input, Select, TextArea } from '@grafana/ui';
import type { DataSource } from '../datasource';
import { DEFAULT_QUERY, type JiraOptions, type JiraQuery, type OutputFormat } from '../types';

type Props = QueryEditorProps<DataSource, JiraQuery, JiraOptions>;
export function QueryEditor({query, onChange, onRunQuery}: Props) {
  const value = { ...DEFAULT_QUERY, ...query };
  const update = (change: Partial<JiraQuery>) => onChange({ ...value, ...change });
  return <div>
    <InlineField label="JQL" labelWidth={18} grow>
      <TextArea rows={3} value={value.jql} placeholder={'project = DEMO AND status != Done ORDER BY updated DESC'}
        onChange={event => update({jql: event.currentTarget.value})} onBlur={onRunQuery} />
    </InlineField>
    <InlineField label="Output" labelWidth={18}>
      <Select<OutputFormat> width={32} value={value.format}
        options={[{label: 'Issue table', value: 'table'}, {label: 'Original JSON pages', value: 'json'}, {label: 'Table and JSON pages', value: 'both'}]}
        onChange={selection => update({format: selection.value})} onBlur={onRunQuery} />
    </InlineField>
    <InlineField label="Jira fields" labelWidth={18} grow tooltip="Comma-separated Jira field IDs. Include custom fields used in your column mappings, or use *all.">
      <Input value={value.fields} onChange={event => update({fields: event.currentTarget.value})} onBlur={onRunQuery} />
    </InlineField>
    <InlineField label="Page size" labelWidth={18} tooltip="1–100 issues requested per API call; Jira may return fewer.">
      <Input type="number" min={1} max={100} width={16} value={value.pageSize}
        onChange={event => update({pageSize: Number(event.currentTarget.value)})} onBlur={onRunQuery} />
    </InlineField>
    <InlineField label="Issue limit" labelWidth={18} tooltip="Maximum table rows, 1–100000. More results produce a warning.">
      <Input type="number" min={1} max={100000} width={16} value={value.maxIssues}
        onChange={event => update({maxIssues: Number(event.currentTarget.value)})} onBlur={onRunQuery} />
    </InlineField>
    <InlineField label="Page limit" labelWidth={18} tooltip="Maximum Jira requests per target, 1–1000.">
      <Input type="number" min={1} max={1000} width={16} value={value.maxPages}
        onChange={event => update({maxPages: Number(event.currentTarget.value)})} onBlur={onRunQuery} />
    </InlineField>
    {value.format !== 'json' && <InlineField label="Table columns" labelWidth={18} grow tooltip="JSON array of path/name/type objects. Paths are relative to each issue; arrays support numeric indexes. Types: string, number, boolean, time.">
      <TextArea rows={8} value={value.columnsJson} onChange={event => update({columnsJson: event.currentTarget.value})} onBlur={onRunQuery} />
    </InlineField>}
    <Alert title="JQL controls the time range" severity="info">
      The dashboard time picker does not automatically filter issues. Add Jira date conditions in JQL when needed.
      For dashboard variables, use project = $project or project IN ($projects), without adding quotes around the variable.
    </Alert>
  </div>;
}
