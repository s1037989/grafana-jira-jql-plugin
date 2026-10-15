import React from 'react';
import { type DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { Alert, Button, InlineField, Input, Select } from '@grafana/ui';
import type { JiraEdition, JiraOptions, JiraSecureOptions } from '../types';

export function ConfigEditor({options, onOptionsChange}: DataSourcePluginOptionsEditorProps<JiraOptions, JiraSecureOptions>) {
  const setUrl = (jiraUrl: string) => onOptionsChange({
    ...options, access: 'proxy', url: jiraUrl, jsonData: { ...options.jsonData, jiraUrl },
  });
  const configured = Boolean(options.secureJsonFields?.authorization);
  return <div>
    <InlineField label="Jira base URL" labelWidth={24} tooltip="Include a context path such as /jira if your Data Center installation uses one. Use no trailing slash.">
      <Input width={64} value={options.jsonData.jiraUrl ?? ''} placeholder="https://jira.example.com"
        onChange={event => setUrl(event.currentTarget.value)}
        onBlur={event => setUrl(event.currentTarget.value.trim().replace(/\/+$/, ''))} />
    </InlineField>
    <InlineField label="Jira edition" labelWidth={24}>
      <Select<JiraEdition> width={32} value={options.jsonData.edition ?? 'cloud'}
        options={[{label: 'Jira Cloud', value: 'cloud'}, {label: 'Jira Data Center', value: 'datacenter'}]}
        onChange={selection => onOptionsChange({...options, jsonData: {...options.jsonData, edition: selection.value}})} />
    </InlineField>
    <InlineField label="Authorization header" labelWidth={24} tooltip="Full header value: Bearer <PAT> or Basic <base64(email:API-token)>. Stored encrypted by Grafana.">
      <Input width={64} type="password" autoComplete="new-password" disabled={configured}
        value={options.secureJsonData?.authorization ?? ''} placeholder={configured ? 'Configured securely' : 'Bearer … or Basic …'}
        onChange={event => onOptionsChange({...options, secureJsonData: {...options.secureJsonData, authorization: event.currentTarget.value}})} />
    </InlineField>
    {configured && <Button variant="secondary" onClick={() => onOptionsChange({
      ...options, secureJsonFields: {...options.secureJsonFields, authorization: false},
      secureJsonData: {...options.secureJsonData, authorization: ''},
    })}>Reset authorization</Button>}
    <Alert title="Authentication" severity="info">
      Jira Cloud: use Basic authentication with your email and API token. Jira Data Center: use Bearer authentication with a personal access token.
      The README includes a Perl command to produce the Basic header. Grafana injects the saved header on the server.
      Save &amp; test verifies your identity; search results depend on that account&apos;s Jira permissions.
    </Alert>
  </div>;
}
