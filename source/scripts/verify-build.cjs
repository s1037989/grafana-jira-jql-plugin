const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class DataSourcePlugin {
  constructor(datasource) { this.datasource = datasource; }
  setConfigEditor(editor) { this.configEditor = editor; return this; }
  setQueryEditor(editor) { this.queryEditor = editor; return this; }
}
const dependencies = {
  '@grafana/data': {DataSourceApi: class {}, DataSourcePlugin},
  '@grafana/runtime': {}, '@grafana/ui': {}, rxjs: {}, react: {},
};
let loaded;
vm.runInNewContext(fs.readFileSync('dist/module.js', 'utf8'), {
  define(names, factory) {
    for (const name of names) assert.ok(name in dependencies, `Unexpected runtime dependency: ${name}`);
    loaded = factory(...names.map(name => dependencies[name]));
  },
});
assert.ok(loaded.plugin instanceof DataSourcePlugin);
assert.equal(typeof loaded.plugin.datasource, 'function');
assert.equal(typeof loaded.plugin.configEditor, 'function');
assert.equal(typeof loaded.plugin.queryEditor, 'function');
const metadata = JSON.parse(fs.readFileSync('dist/plugin.json', 'utf8'));
assert.equal(metadata.id, 'jirajql-datasource');
assert.equal(metadata.backend, false);
assert.equal(metadata.alerting, false);
for (const route of metadata.routes) {
  assert.equal(route.headers[0].content, '{{ .SecureJsonData.authorization }}');
}
assert.ok(fs.existsSync(`dist/${metadata.info.logos.small}`));
console.log('Built AMD module loads and registers data source, configuration editor, and query editor.');
