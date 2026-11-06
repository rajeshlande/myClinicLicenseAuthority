import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

function commitId() {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return String(process.env.GITHUB_SHA ?? 'dev').slice(0, 7);
  }
}

/**
 * Relative base ("./") by default so the exact same build works on localhost,
 * GitHub Pages (https://<user>.github.io/<repo>/), or a custom domain.
 * Set VITE_BASE="/<repo>/" only when forcing absolute asset URLs.
 */
const override = process.env.VITE_BASE;
const base = override
  ? override.endsWith('/')
    ? override
    : `${override}/`
  : './';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_BASE__: JSON.stringify(base),
    __AUTHORITY_BUILD__: JSON.stringify({
      id: commitId(),
      at: new Date().toISOString(),
    }),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    cors: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'supabase';
          if (/node_modules[\\/](react|react-dom|scheduler)/.test(id)) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
