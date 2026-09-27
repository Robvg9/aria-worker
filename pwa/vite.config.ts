import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function canonicalTestCatalogMetaPlugin() {
  return {
    name: 'canonical-test-catalog-meta',
    transformIndexHtml(html: string) {
      const source = fs.readFileSync(path.resolve(process.cwd(), 'src/testCatalog.ts'), 'utf8');
      const version = source.match(/TEST_CATALOG_VERSION\s*=\\s*['"]([^'"]+)['"]/)?.[1];
      const total = [...source.matchAll(/\"id\"\\s*:\\s*\"[^\"]+\"/g)].length;
      if (!version || total < 1) throw new Error('Unable to derive canonical test catalog metadata');
      return html.replace(
        '</head>',
        '<meta name="aria-test-catalog-version" content="' + version + '">' +
          '<meta name="aria-test-catalog-total" content="' + total + '">' +
          '</head>',
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), canonicalTestCatalogMetaPlugin()],
  base: '/pwa/',
  build: {
    outDir: process.env.APPDEPLOY_VITE_OUT_DIR || 'dist',
    sourcemap:
      process.env.APPDEPLOY_VITE_SOURCEMAP === 'hidden' ? 'hidden' : false,
    rollupOptions: {
      maxParallelFileOps: 128,
    },
  },
});
