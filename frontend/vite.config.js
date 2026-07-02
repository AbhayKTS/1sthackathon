import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dev server middleware to support Firebase-style clean URLs locally
const cleanUrlsPlugin = () => ({
  name: 'clean-urls',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // If the request has no extension and isn't the root
      if (req.url && !req.url.includes('.') && req.url !== '/') {
        // Strip query params for file checking
        const urlPath = req.url.split('?')[0];
        const htmlPath = resolve(server.config.root, urlPath.substring(1) + '.html');
        if (fs.existsSync(htmlPath)) {
          req.url = req.url + '.html';
        }
      }
      next();
    });
  }
});

export default defineConfig({
  plugins: [tailwindcss(), cleanUrlsPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        home: resolve(__dirname, 'home.html'),
        login: resolve(__dirname, 'login.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        admin: resolve(__dirname, 'cmd-center.html'),
        onboarding: resolve(__dirname, 'onboarding.html'),
        profile: resolve(__dirname, 'profile.html'),
        support: resolve(__dirname, 'support.html'),
        faqs: resolve(__dirname, 'faqs.html'),
        problemStatements: resolve(__dirname, 'problem-statements.html'),
        resources: resolve(__dirname, 'resources.html')
      }
    }
  }
});
