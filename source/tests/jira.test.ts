import { describe, expect, it, vi } from 'vitest';
import { cellValue, getPath, integer, jiraError, parseColumns, searchJira, validateBaseUrl, type SearchOptions } from '../src/jira';
const options: SearchOptions = {edition: 'cloud', jql: 'project = DEMO', fields: ['summary'], pageSize: 100, maxIssues: 1000, maxPages: 100};
const issue = (key: string) => ({key, fields: {summary: `Issue ${key}`}});

describe('Jira HTTP request conversion and pagination', () => {
  it('posts JQL as JSON unchanged and follows Cloud page tokens', async () => {
    const transport = vi.fn().mockResolvedValueOnce({issues: [issue('A')], nextPageToken: 'token-a', isLast: false})
      .mockResolvedValueOnce({issues: [issue('B')], isLast: true});
    const result = await searchJira({...options, jql: 'summary ~ "quotes & spaces"'}, transport);
    expect(transport.mock.calls[0]).toEqual(['cloud-search', {jql: 'summary ~ "quotes & spaces"', fields: ['summary'], maxResults: 100}]);
    expect(transport.mock.calls[1][1]).toHaveProperty('nextPageToken', 'token-a');
    expect(transport.mock.calls[1][1]).not.toHaveProperty('startAt');
    expect(result.issues.map(i => i.key)).toEqual(['A', 'B']);
    expect(result.pages).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });
  it('uses actual page lengths for Data Center offsets', async () => {
    const transport = vi.fn().mockResolvedValueOnce({issues: [issue('A'), issue('B')], total: 3, startAt: 0, maxResults: 2})
      .mockResolvedValueOnce({issues: [issue('C')], total: 3, startAt: 2});
    const result = await searchJira({...options, edition: 'datacenter'}, transport);
    expect(transport.mock.calls.map(call => [call[0], call[1].startAt])).toEqual([['dc-search', 0], ['dc-search', 2]]);
    expect(result.truncated).toBe(false);
  });
  it('shrinks the final request to the remaining issue limit', async () => {
    const transport = vi.fn().mockResolvedValueOnce({issues: [issue('A')], nextPageToken: 'a'})
      .mockResolvedValueOnce({issues: [issue('B')], nextPageToken: 'b'});
    const result = await searchJira({...options, maxIssues: 2}, transport);
    expect(transport.mock.calls[1][1].maxResults).toBe(1);
    expect(result.truncated).toBe(true);
  });
  it('distinguishes a complete page at the exact limit from truncation', async () => {
    const result = await searchJira({...options, maxIssues: 1}, vi.fn().mockResolvedValue({issues: [issue('A')], isLast: true}));
    expect(result.truncated).toBe(false);
  });
  it('preserves full JSON pages even if a server exceeds the row limit', async () => {
    const page = {issues: [issue('A'), issue('B')], isLast: true, customMetadata: {x: 1}};
    const result = await searchJira({...options, maxIssues: 1}, vi.fn().mockResolvedValue(page));
    expect(result.issues).toHaveLength(1);
    expect(result.pages[0]).toBe(page);
    expect(result.truncated).toBe(true);
  });
  it('reports truncation at the page limit', async () => {
    const result = await searchJira({...options, maxPages: 1}, vi.fn().mockResolvedValue({issues: [issue('A')], nextPageToken: 'a'}));
    expect(result.truncated).toBe(true);
  });
  it('rejects repeated Cloud tokens', async () => {
    await expect(searchJira(options, vi.fn().mockResolvedValue({issues: [issue('A')], nextPageToken: 'a'}))).rejects.toThrow('repeated');
  });
  it('rejects missing continuation tokens and malformed pagination', async () => {
    await expect(searchJira(options, vi.fn().mockResolvedValue({issues: [], isLast: false}))).rejects.toThrow('nextPageToken');
    await expect(searchJira(options, vi.fn().mockResolvedValue({issues: [], nextPageToken: 3}))).rejects.toThrow('malformed pagination');
  });
  it('rejects empty Data Center pages before total and wrong offsets', async () => {
    await expect(searchJira({...options, edition: 'datacenter'}, vi.fn().mockResolvedValue({issues: [], total: 5}))).rejects.toThrow('empty page');
    await expect(searchJira({...options, edition: 'datacenter'}, vi.fn().mockResolvedValue({issues: [], startAt: 4}))).rejects.toThrow('offset');
  });
  it('handles zero results and missing DC total', async () => {
    expect((await searchJira(options, vi.fn().mockResolvedValue({issues: [], isLast: true}))).issues).toEqual([]);
    const transport = vi.fn().mockResolvedValueOnce({issues: [issue('A')]}).mockResolvedValueOnce({issues: []});
    expect((await searchJira({...options, edition: 'datacenter'}, transport)).truncated).toBe(false);
  });
  it('rejects malformed JSON, empty JQL, and invalid limits', async () => {
    await expect(searchJira(options, vi.fn().mockResolvedValue('<html>login</html>'))).rejects.toThrow('unexpected response');
    await expect(searchJira({...options, jql: ''}, vi.fn())).rejects.toThrow('JQL');
    await expect(searchJira({...options, pageSize: 0}, vi.fn())).rejects.toThrow('Page size');
  });
  it('does not turn transport errors into partial success', async () => {
    const transport = vi.fn().mockResolvedValueOnce({issues: [issue('A')], nextPageToken: 'a'})
      .mockRejectedValueOnce(new Error('Rate limited'));
    await expect(searchJira(options, transport)).rejects.toThrow('Rate limited');
  });
});
describe('column mapping and configuration', () => {
  it('reads nested own properties and arrays without inherited values', () => {
    expect(getPath({fields: {labels: ['alpha']}}, 'fields.labels.0')).toBe('alpha');
    expect(getPath({}, 'constructor.name')).toBeUndefined();
    expect(getPath({fields: null}, 'fields.foo')).toBeUndefined();
  });
  it('maps nulls, numeric and boolean fields, times, and complex values', () => {
    expect(cellValue(undefined, 'string')).toBeNull();
    expect(cellValue(3.5, 'number')).toBe(3.5);
    expect(cellValue('3.5', 'number')).toBeNull();
    expect(cellValue(false, 'boolean')).toBe(false);
    expect(cellValue('2026-10-05T18:00:00.000+0000', 'time')).toBe(Date.parse('2026-10-05T18:00:00Z'));
    expect(cellValue('bad', 'time')).toBeNull();
    expect(cellValue({name: 'Open'}, 'string')).toBe('{"name":"Open"}');
  });
  it('validates columns, duplicate names, and reserved JSON name', () => {
    expect(parseColumns()).toHaveLength(6);
    expect(parseColumns('[{"path":"fields.customfield_10000","type":"number"}]')).toHaveLength(1);
    for (const invalid of ['{}', '[]', '[{"path":"x","type":"bad"}]', '[{"path":"x"},{"path":"x"}]', '[{"path":"x","name":"Issue JSON"}]']) {
      expect(() => parseColumns(invalid)).toThrow();
    }
  });
  it('validates URL and integers', () => {
    expect(validateBaseUrl('https://jira.example.com/jira/')).toBe('https://jira.example.com/jira');
    for (const url of ['file:///tmp', 'https://u:p@jira.example.com', 'https://jira.example.com/?token=x', '']) {
      expect(() => validateBaseUrl(url)).toThrow();
    }
    expect(integer(undefined, 100, 1, 100, 'size')).toBe(100);
    expect(() => integer(NaN, 100, 1, 100, 'size')).toThrow();
  });
  it('formats Jira HTTP errors', () => {
    expect(jiraError({status: 400, data: {errorMessages: ['Bad JQL'], errors: {jql: 'syntax'}}})).toBe('Jira HTTP 400: Bad JQL; syntax');
  });
});
