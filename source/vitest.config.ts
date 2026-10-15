import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    server: { deps: { inline: [/@grafana\/data/] } },
    deps: { optimizer: { ssr: { enabled: true, include: ['moment-timezone'] } } },
  },
});
