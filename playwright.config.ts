import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,use:{baseURL:'http://127.0.0.1:3107',headless:true,channel:process.env.PLAYWRIGHT_CHANNEL},webServer:{command:'node scripts/e2e-server.mjs',url:'http://127.0.0.1:3107/login',reuseExistingServer:false,timeout:60000}});
