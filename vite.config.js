import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
  },
  plugins: [
    {
      name: 'preview-live-data',
      configureServer(server) {
        server.middlewares.use('/api/live-data.js', (request, response, next) => {
          if (request.method !== 'GET') return next();
          response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          response.end('window.NELLI_LIVE = window.NELLI_LIVE || {};');
        });
      },
    },
  ],
});
