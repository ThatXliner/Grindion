import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'VITE_E2E=true npm run build && npm run preview', port: 4173 },
	testMatch: '**/*.e2e.{ts,js}'
});
