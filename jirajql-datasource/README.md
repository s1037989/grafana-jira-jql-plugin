# Jira JQL data source for Grafana

A native Grafana data source plugin that converts JQL into Jira HTTP API requests
and returns Jira's JSON as Grafana data frames. Requires Grafana **12.4 or later**.

The query editor sends JQL through Grafana's data proxy to Jira's search API.
Returned JSON becomes an issue table, original JSON page rows, or both.

The TypeScript/React plugin uses Grafana's built-in server data proxy. Jira
credentials are stored in Grafana's encrypted `secureJsonData` and injected by
Grafana on outbound requests. No separate Perl or Go service is required.

## Install the included build

1. Extract `jirajql-datasource` into Grafana's plugin directory,
   usually `/var/lib/grafana/plugins`. The archive already contains the plugin folder.
2. Allow this unsigned private plugin in `grafana.ini`:

   ```ini
   [plugins]
   allow_loading_unsigned_plugins = jirajql-datasource
   ```

   Or set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=jirajql-datasource`.
3. Restart Grafana, then go to **Connections -> Data sources -> Add data source -> Jira JQL**.
4. Configure the Jira URL, edition, and Authorization header; click **Save & test**.
5. Create a panel, choose this data source, enter JQL, and use a **Table** visualization.

This is an unsigned local plugin. Installation requires a Grafana deployment you
control; it is not a Grafana Cloud marketplace installation. Signing and catalog
publication are separate steps.

## Jira connection settings

| Setting | Jira Cloud | Jira Data Center |
| --- | --- | --- |
| Base URL | `https://YOUR-SITE.atlassian.net` | `https://jira.example.com` or `https://jira.example.com/jira` |
| Edition | Jira Cloud | Jira Data Center |
| Authorization | `Basic BASE64(email:API-token)` | `Bearer PERSONAL_ACCESS_TOKEN` |
| Search | `POST /rest/api/3/search/jql` | `POST /rest/api/2/search` |
| Pagination | `nextPageToken` | `startAt` and `total` |

For scoped Jira Cloud API tokens, use the Atlassian API gateway base URL required
by your token, such as `https://api.atlassian.com/ex/jira/CLOUD_ID`. The plugin
appends the search or identity path to this base URL. Jira determines which
permissions and scopes are required for your deployment. OAuth token acquisition
and refresh are not implemented.

Generate a Basic header with Perl using environment variables (do not commit the
output or tokens into files):

```bash
export JIRA_EMAIL='you@example.com'
read -rsp 'Jira API token: ' JIRA_TOKEN
export JIRA_TOKEN
perl -MMIME::Base64=encode_base64 -E 'say "Basic ", encode_base64("$ENV{JIRA_EMAIL}:$ENV{JIRA_TOKEN}", "")'
unset JIRA_TOKEN
```

Paste the entire generated `Basic ...` value into **Authorization header**. For
Data Center, paste `Bearer ...`. Use **Reset authorization** to replace saved
credentials. Use HTTPS; configure private certificate trust on the Grafana server.
The Grafana server needs network access to Jira. A successful identity check does
not imply permission to see every project or issue. All data source users query
with the configured account, so grant that account appropriate access and control
who can use this data source.

## Query example

```jql
project = PHOENIX AND status != Done ORDER BY updated DESC
```

Cloud request body:

```json
{
  "jql": "project = PHOENIX AND status != Done ORDER BY updated DESC",
  "fields": ["summary", "status", "assignee", "created", "updated"],
  "maxResults": 100
}
```

The request URL and Authorization header are handled by Grafana's proxy. JQL is
JSON-encoded in the POST body rather than concatenated into a URL. Jira JQL syntax
and authorization errors are shown with their HTTP status.

## Output and JSON preservation

- **Issue table**: one row per issue with configured columns and an `Issue JSON`
  column containing the full returned issue object.
- **Original JSON pages**: one row per HTTP response, with `Page` and `JSON` fields.
  The JSON field contains the entire parsed response object, including pagination
  metadata. Serialization preserves JSON values, not original whitespace or byte
  formatting.
- **Table and JSON pages**: both frames; select a frame in the Table panel as needed.

Grafana expects data frames rather than an arbitrary JSON response. Returning
JSON as a string field retains the response for inspection while the table makes
fields usable in Grafana transformations, grouping, and charts. The data source
queries Jira live; it does not persist historical snapshots.

## Custom fields and column mappings

The **Jira fields** input selects fields Jira returns. For example:

```text
summary,status,customfield_10001,customfield_10002,created
```

Set **Table columns** to:

```json
[
  {"path":"key","name":"Key","type":"string"},
  {"path":"fields.summary","name":"Rule","type":"string"},
  {"path":"fields.status.name","name":"Status","type":"string"},
  {"path":"fields.customfield_10001","name":"Port","type":"number"},
  {"path":"fields.customfield_10002.value","name":"Team A status","type":"string"},
  {"path":"fields.created","name":"Created","type":"time"}
]
```

Paths are relative to each issue and use dot notation. Numeric array indexes are
supported, e.g. `fields.labels.0`. Missing values become null. String columns
serialize objects and arrays as JSON; numeric and boolean columns accept matching
JSON types, without coercing strings. Time columns parse timestamp strings or
accept numeric Unix milliseconds. A type mismatch produces null; the original
value remains in `Issue JSON`. The default columns are Key, Summary, Status,
Assignee, Created, and Updated. Field IDs containing literal dots are not supported
by the dot-path mapper.

## Dashboard variables and time filtering

Use `project = $project` or `project IN ($projects)`. Do not put quotes around the
variable: the plugin quotes and escapes each substituted value. Multi-value
variables expand to a comma-separated list. Use Grafana's explicit formatting
(e.g. `${filter:raw}`) only for a trusted JQL fragment. An **All** selection should
expand to explicit values; a wildcard All value is not a JQL project wildcard.
The plugin does not provide a variable-query editor; use custom dashboard variables.

The Grafana time picker does not automatically alter JQL. Use Jira date conditions,
for example `updated >= -30d`, or explicit Grafana date formatting with Jira's
supported date format:

```jql
project = PHOENIX AND updated >= "${__from:date:YYYY-MM-DD HH:mm}"
  AND updated <= "${__to:date:YYYY-MM-DD HH:mm}"
```

Jira interprets date literals using its applicable timezone, which may differ from
Grafana's timezone. This filters the current issue set; it is not an event-history
or time-series query. Server-side Grafana Alerting is **not supported** by this
frontend plugin. That requires a backend `QueryData` implementation.

## Pagination and limits

Default page size: 100. Default issue limit: 1000. Default page limit: 100. Jira may
return fewer issues than requested; the plugin follows the continuation token or
uses the actual returned issue count for the next Data Center offset. It stops
with a warning when an issue or page limit prevents complete retrieval. The table
is capped at the issue limit; original JSON pages retain every returned issue even
if Jira unexpectedly exceeds the requested size. Metadata is also in
`frame.meta.custom` (`returnedIssues`, `returnedPages`, `truncated`).

Up to four panel query targets run concurrently; pages for each target are fetched
sequentially. Cancelling the panel query unsubscribes active HTTP requests. A failed
page fails that target instead of returning apparently complete partial data. Other
targets can still return their data. Repeated Cloud tokens and non-progressing Data
Center pages fail explicitly. HTTP 429 and other HTTP failures are surfaced without
automatic retry. Search results can change during pagination if Jira issues change.

## Build from source

Prerequisites: Node.js 20 or newer, npm, and `zip` for packaging.

```bash
npm ci
npm test
npm run build
npm run package
```

The build emits an AMD `dist/module.js` using Grafana's supplied React, RxJS, and
Grafana libraries. It also copies `plugin.json`, the logo, README, and license.
The install archive is in `release/`. `package-lock.json` pins the dependencies.
For an offline environment, build outside the boundary and transfer the compiled
install archive through your approved flow; the deployed plugin needs no npm access.

To run a local Grafana after building:

```bash
docker compose up
```

Open `http://localhost:3000` and use Grafana's initial login flow. The development
Compose file allows only this plugin ID as unsigned. Docker downloads the specified
Grafana image unless you already have it available locally.

A provisioning example is in `provisioning/datasources/jira.example.yaml`. Set
`JIRA_AUTHORIZATION` in the Grafana process environment and update both `url` and
`jsonData.jiraUrl` to your Jira base URL. The included example dashboard can be
imported after creating the data source.

## Validation and references

Tests cover request bodies, Cloud and Data Center pagination, limits, original JSON
preservation, column mapping, errors, template values, multiple targets, credentials
staying out of browser requests, and cancellation. See `VALIDATION.md` for checks
performed on this delivery. A live Jira/Grafana integration check requires your
instance and credentials.

Official documentation:

- [Grafana data proxy](https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/fetch-data-from-frontend)
- [Grafana secure data source authentication](https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/add-authentication-for-data-source-plugins)
- [Jira Cloud enhanced JQL search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)
- [Jira Data Center REST API](https://developer.atlassian.com/server/jira/platform/rest/v10000/)
