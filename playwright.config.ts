import { defineConfig, devices } from "@playwright/test";

/**
 * react-hook-form example (port 5173) と TanStack Form example (port 5174) は
 * 同じ機能・同じ UI の双子アプリ。
 * 同一の e2e spec を 2 プロジェクトで両方に流してアダプター間のパリティを検証する。
 */
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["github"], ["html"]] : "html",
	use: {
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "rhf",
			use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5173" },
		},
		{
			name: "tanstack",
			use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5174" },
		},
	],
	webServer: [
		{
			command: "pnpm run dev:example:rhf",
			url: "http://localhost:5173",
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
		},
		{
			command: "pnpm run dev:example:tanstack",
			url: "http://localhost:5174",
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
		},
	],
});
