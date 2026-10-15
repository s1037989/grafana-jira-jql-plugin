const path = require('node:path');
const CopyPlugin = require('copy-webpack-plugin');
module.exports = {
  entry: './src/module.ts',
  output: { path: path.resolve(__dirname, 'dist'), filename: 'module.js', library: { type: 'amd' }, clean: true },
  externals: [/^@grafana\//, 'react', 'react-dom', 'react/jsx-runtime', 'rxjs'],
  resolve: { extensions: ['.ts', '.tsx', '.js'] },
  module: { rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }] },
  plugins: [new CopyPlugin({ patterns: [
    { from: 'src/plugin.json', to: 'plugin.json' },
    { from: 'src/img', to: 'img' },
    { from: 'README.md', to: 'README.md' },
    { from: 'LICENSE', to: 'LICENSE.txt', toType: 'file' }
  ] })],
  devtool: 'source-map',
  optimization: { splitChunks: false, runtimeChunk: false }
};
