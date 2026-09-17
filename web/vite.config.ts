import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// HTTPS is required for camera access from a phone on the LAN.
// COOP/COEP headers enable multi-threaded WebAssembly for the detector.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Trusted local certificate (see README "HTTPS without warnings"): `mkcert` writes
// certs/dev.pem + certs/dev-key.pem; when present they replace the self-signed fallback.
const certDir = fileURLToPath(new URL('./certs/', import.meta.url));
const certFile = `${certDir}dev.pem`;
const keyFile = `${certDir}dev-key.pem`;
const trustedCert = fs.existsSync(certFile) && fs.existsSync(keyFile)
  ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
  : undefined;
const httpOnly = Boolean(process.env.VITE_HTTP);
const https = httpOnly ? undefined : trustedCert;

// Serve the mkcert root certificate with the MIME type phones expect for a CA profile.
const caDownload = {
  name: 'ca-download',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] === '/rootCA.crt') {
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.setHeader('Content-Disposition', 'attachment; filename="rootCA.crt"');
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    caDownload,
    { ...caDownload, name: 'ca-download-preview', configurePreviewServer: caDownload.configureServer, configureServer: undefined },
    ...(httpOnly || trustedCert ? [] : [basicSsl()]),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Mahjong Fan Planner',
        short_name: 'Mahjong Fan',
        description: 'Point your camera at your tiles and see how to reach the minimum fan.',
        theme_color: '#0f1419',
        background_color: '#0f1419',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,mjs,onnx,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
      },
    }),
  ],
  server: { host: true, port: 5173, headers: isolation, https },
  preview: { host: true, port: 4173, headers: isolation, https },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
