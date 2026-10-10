import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const testCatalogSource = readFileSync(new URL('./src/testCatalog.ts', import.meta.url), 'utf8');
const testCatalogVersion = testCatalogSource.match(/export const TEST_CATALOG_VERSION = '([^']+)';/)?.[1];
const testCatalogTotal = [...testCatalogSource.matchAll(/"file": "tests\//g)].length;

if (!testCatalogVersion || testCatalogTotal < 1) {
  throw new Error('ARIA test catalog metadata could not be derived from pwa/src/testCatalog.ts');
}

function replaceMetaContent(html: string, name: string, value: string): string {
  const pattern = new RegExp(`(<meta\\s+name=['"]${name}['"]\\s+content=['"])[^'"]*(['"]\\s*/?>)`);
  if (!pattern.test(html)) {
    throw new Error(`ARIA PWA HTML is missing required metadata: ${name}`);
  }
  return html.replace(pattern, `$1${value}$2`);
}

const testCatalogMetadata = {
  name: 'aria-test-catalog-metadata',
  transformIndexHtml(html: string) {
    const withVersion = replaceMetaContent(html, 'aria-test-catalog-version', testCatalogVersion);
    return replaceMetaContent(withVersion, 'aria-test-catalog-total', String(testCatalogTotal));
  },
};

export default defineConfig({
  plugins: [react(), testCatalogMetadata],
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
