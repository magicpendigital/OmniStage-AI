/**
 * Phase 7C — Playwright E2E for the OmniStage Player (exported HTML, no dev server needed).
 * Uses the Chrome installed on this machine (no browser download). Override with OMNI_E2E_CHANNEL=msedge | chromium.
 *   npm run test:e2e
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  outputDir: 'output/e2e-results',
  use: {
    channel: process.env.OMNI_E2E_CHANNEL || 'chrome',
    headless: true,
    viewport: { width: 960, height: 540 },
    // Software rendering (SwiftShader): stable on every machine. WebGPU tests skip here (no adapter).
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'default' },
    // Phase 7: WebGPU parity on the real GPU (npm run test:e2e:gpu).
    {
      name: 'gpu',
      testMatch: 'webgpu.e2e.ts',
      use: { launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu'] } },
    },
  ],
});
