import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { FieldType, type DataFrame, type DataQueryRequest, type DataSourceInstanceSettings } from '@grafana/data';
import type { JiraOptions, JiraQuery } from '../src/types';
import { resultFrames } from '../src/frames';
const mock = vi.hoisted(() => ({fetch: vi.fn(), replace: vi.fn()}));
vi.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({fetch: mock.fetch}),
  getTemplateSrv: () => ({replace: mock.replace}),
}));
import { DataSource, jqlLiteral } from '../src/datasource';

const settings = {
  id: 1, uid: 'jira', name: 'Jira', type: 'jirajql-datasource',
  url: '/api/datasources/proxy/uid/jira', jsonData: {jiraUrl: 'https://jira.example.com', edition: 'cloud'},
  meta: {}, readOnly: false, access: 'proxy',
} as unknown as DataSourceInstanceSettings<JiraOptions>;
const request = (targets: JiraQuery[]) => ({targets, scopedVars: {}, requestId: 'req-1'} as unknown as DataQueryRequest<JiraQuery>);
const query = (refId = 'A', jql = 'project = DEMO'): JiraQuery => ({refId, jql});
beforeEach(() => {
  mock.fetch.mockReset();
  mock.replace.mockReset().mockImplementation((text: string) => text);
});
describe('Grafana frames', () => {
  it('returns typed columns and preserves complete issues and JSON pages', () => {
    const issue = {key: 'D-1', fields: {customfield_10001: 123, created: '2026-10-05T18:00:00Z'}};
    const page = {issues: [issue], isLast: true, extraMetadata: 'kept'};
    const frames = resultFrames({issues: [issue], pages: [page], truncated: true}, 'A', 'both', [
      {path: 'key'}, {path: 'fields.customfield_10001', type: 'number'}, {path: 'fields.created', type: 'time'},
    ]);
    expect(frames).toHaveLength(2);
    expect(frames[0].length).toBe(1);
    expect(frames[0].fields[1].type).toBe(FieldType.number);
    expect(frames[0].fields[1].values[0]).toBe(123);
    expect(frames[0].fields[2].type).toBe(FieldType.time);
    expect(JSON.parse(frames[0].fields[3].values[0])).toEqual(issue);
    expect(JSON.parse(frames[1].fields[1].values[0])).toEqual(page);
    expect(frames[0].meta?.notices?.[0].severity).toBe('warning');
    expect(frames[1].meta?.custom?.truncated).toBe(true);
  });
});
describe('Grafana data source adapter', () => {
  it('uses a Grafana proxy URL with no Jira credentials in the browser request', async () => {
    mock.fetch.mockReturnValue(of({data: {issues: [{key: 'D-1'}], isLast: true}}));
    const response = await firstValueFrom(new DataSource(settings).query(request([query()])));
    expect(response.data).toHaveLength(1);
    expect(mock.fetch).toHaveBeenCalledWith(expect.objectContaining({
      url: '/api/datasources/proxy/uid/jira/cloud-search', method: 'POST',
      data: expect.objectContaining({jql: 'project = DEMO'}),
    }));
    expect(mock.fetch.mock.calls[0][0].headers).not.toHaveProperty('Authorization');
  });
  it('skips hidden and empty targets', async () => {
    const response = await firstValueFrom(new DataSource(settings).query(request([{...query(), hide: true}, query('B', '')])));
    expect(response.data).toEqual([]);
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it('allows raw JSON output independently of table column configuration', async () => {
    mock.fetch.mockReturnValue(of({data: {issues: [], isLast: true}}));
    const response = await firstValueFrom(new DataSource(settings).query(request([
      {...query(), format: 'json', columnsJson: 'not JSON'},
    ])));
    expect(response.errors).toBeUndefined();
    expect((response.data[0] as DataFrame).name).toBe('Jira JSON responses');
  });
  it('preserves successful targets when another target has a Jira error', async () => {
    mock.fetch.mockImplementation((options: {data: {jql: string}}) => options.data.jql.includes('BAD')
      ? throwError(() => ({status: 400, data: {errorMessages: ['Invalid JQL']}}))
      : of({data: {issues: [{key: 'D-1'}], isLast: true}}));
    const response = await firstValueFrom(new DataSource(settings).query(request([query('A'), query('B', 'BAD')])));
    expect((response.data[0] as DataFrame).refId).toBe('A');
    expect(response.errors).toEqual([{refId: 'B', message: 'Jira HTTP 400: Invalid JQL'}]);
  });
  it('unsubscribes in-flight fetches on query cancellation', async () => {
    const http = new Subject();
    mock.fetch.mockReturnValue(http);
    const subscription = new DataSource(settings).query(request([query()])).subscribe();
    expect(http.observed).toBe(true);
    subscription.unsubscribe();
    expect(http.observed).toBe(false);
    await Promise.resolve();
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it('passes scoped variables and the JQL formatter to Grafana', () => {
    const source = new DataSource(settings);
    const vars = {project: {text: 'D', value: 'D'}};
    source.applyTemplateVariables(query('A', 'project = $project'), vars);
    expect(mock.replace).toHaveBeenCalledWith('project = $project', vars, jqlLiteral);
    expect(jqlLiteral(['D', 'E'])).toBe('"D","E"');
    expect(jqlLiteral('x" OR project = "SECRET\\x')).toBe('"x\\" OR project = \\"SECRET\\\\x"');
  });
  it('tests authenticated identity and rejects a login page', async () => {
    const source = new DataSource(settings);
    mock.fetch.mockReturnValueOnce(of({data: {accountId: '1', displayName: 'Stefan'}}));
    expect((await source.testDatasource()).status).toBe('success');
    expect(mock.fetch.mock.calls[0][0].url).toContain('cloud-myself');
    mock.fetch.mockReturnValueOnce(of({data: '<html>Login</html>'}));
    expect((await source.testDatasource()).status).toBe('error');
  });
});
