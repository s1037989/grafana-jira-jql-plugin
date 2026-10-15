import { DataSourceApi, type DataSourceInstanceSettings, type DataQueryRequest, type DataQueryResponse, type ScopedVars } from '@grafana/data';
import { getBackendSrv, getTemplateSrv } from '@grafana/runtime';
import { Observable, Subject, firstValueFrom, takeUntil } from 'rxjs';
import { DEFAULT_QUERY, type JiraOptions, type JiraQuery } from './types';
import { integer, jiraError, parseColumns, searchJira, validateBaseUrl } from './jira';
import { resultFrames } from './frames';

// Quote each value as a JQL string. Use variables without surrounding quotes:
// project = $project, or project IN ($projects).
export function jqlLiteral(value: unknown): string {
  if (Array.isArray(value)) { return value.map(jqlLiteral).join(','); }
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export class DataSource extends DataSourceApi<JiraQuery, JiraOptions> {
  private readonly baseUrl: string;
  private readonly edition: 'cloud' | 'datacenter';
  private readonly jiraUrl?: string;

  constructor(settings: DataSourceInstanceSettings<JiraOptions>) {
    super(settings);
    this.baseUrl = settings.url ?? '';
    this.edition = settings.jsonData.edition ?? 'cloud';
    this.jiraUrl = settings.jsonData.jiraUrl;
  }
  getDefaultQuery(): Partial<JiraQuery> { return { ...DEFAULT_QUERY }; }
  filterQuery(query: JiraQuery): boolean { return !query.hide && Boolean(query.jql?.trim()); }
  applyTemplateVariables(query: JiraQuery, scopedVars: ScopedVars): JiraQuery {
    return { ...query, jql: getTemplateSrv().replace(query.jql ?? '', scopedVars, jqlLiteral) };
  }
  query(request: DataQueryRequest<JiraQuery>): Observable<DataQueryResponse> {
    return new Observable(subscriber => {
      const cancel = new Subject<void>();
      const data: DataQueryResponse['data'] = [];
      const errors: NonNullable<DataQueryResponse['errors']> = [];
      const targets = request.targets.filter(query => this.filterQuery(query));
      let nextTarget = 0;
      const work = async () => {
        while (!subscriber.closed && nextTarget < targets.length) {
          const target = targets[nextTarget++];
          try {
            validateBaseUrl(this.jiraUrl);
            if (!this.baseUrl) { throw new Error('Save the data source before querying.'); }
            const query = { ...DEFAULT_QUERY, ...this.applyTemplateVariables(target, request.scopedVars) };
            const format = query.format ?? 'table';
            if (!['table', 'json', 'both'].includes(format)) { throw new Error('Invalid output format.'); }
            const columns = format === 'json' ? [] : parseColumns(query.columnsJson);
            const fields = (query.fields ?? DEFAULT_QUERY.fields!).split(',').map(field => field.trim()).filter(Boolean);
            if (!fields.length) { throw new Error('Specify at least one Jira field, or *all.'); }
            const result = await searchJira({
              edition: this.edition, jql: query.jql, fields,
              pageSize: integer(query.pageSize, 100, 1, 100, 'Page size'),
              maxIssues: integer(query.maxIssues, 1000, 1, 100000, 'Issue limit'),
              maxPages: integer(query.maxPages, 100, 1, 1000, 'Page limit'),
            }, async (route, body) => {
              if (subscriber.closed) { throw new Error('Query cancelled.'); }
              const response = await firstValueFrom(getBackendSrv().fetch<unknown>({
                url: `${this.baseUrl}/${route}`, method: 'POST', data: body,
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                hideFromInspector: false,
              }).pipe(takeUntil(cancel)));
              return response.data;
            });
            data.push(...resultFrames(result, target.refId, format, columns));
          } catch (error) {
            if (!subscriber.closed) { errors.push({ message: jiraError(error), refId: target.refId }); }
          }
        }
      };
      void Promise.all(Array.from({ length: Math.min(4, targets.length) }, work)).then(() => {
        if (!subscriber.closed) { subscriber.next({ data, errors: errors.length ? errors : undefined }); subscriber.complete(); }
      }).catch(error => { if (!subscriber.closed) { subscriber.error(error); } });
      return () => { cancel.next(); cancel.complete(); };
    });
  }
  async testDatasource() {
    try {
      validateBaseUrl(this.jiraUrl);
      const response = await firstValueFrom(getBackendSrv().fetch<{displayName?: string; accountId?: string; name?: string}>({
        url: `${this.baseUrl}/${this.edition === 'cloud' ? 'cloud-myself' : 'dc-myself'}`,
        method: 'GET', headers: { Accept: 'application/json' },
      }));
      if (!response.data || !(response.data.accountId || response.data.name || response.data.displayName)) {
        throw new Error('Jira returned an unexpected identity response; check for an SSO redirect.');
      }
      return { status: 'success', message: `Connected to Jira as ${response.data.displayName ?? response.data.name ?? response.data.accountId}.` };
    } catch (error) { return { status: 'error', message: jiraError(error) }; }
  }
}
