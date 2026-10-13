import { defineConfig } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);

export default defineConfig({
	use: { baseURL: `http://localhost:${port}` },
	webServer: [
		{
			command: 'npm run build:arena && npm run start:arena',
			url: 'http://127.0.0.1:8788/health'
		},
		{
			command: `VITE_E2E=true npm run build && npm run preview -- --port ${port} --strictPort`,
			port
		}
	],
	testMatch: '**/*.e2e.{ts,js}'
});
