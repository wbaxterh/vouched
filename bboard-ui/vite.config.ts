// This file is part of wbaxterh/vouched.
// SPDX-License-Identifier: Apache-2.0

// The browser bundle is a plain React SPA; all Midnight machinery lives
// in the local demo backend, so no WASM or node-polyfill plugins are
// needed here. /api is proxied to that backend (bboard-cli `npm run
// server`, port 7302).

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  cacheDir: './.vite',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:7302',
    },
  },
});
