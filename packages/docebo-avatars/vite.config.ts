import { defineConfig } from 'vite';

// One self-contained file per format: the renderer and the Docebo avatars are bundled in, so a host
// page needs nothing else. `vite` alone serves the demo host page (index.html) from source.
export default defineConfig({
  resolve: { conditions: ['open-bot-avatar/source'] },
  // A fixed port: `pnpm dev` at the root runs this beside the editor (5173), and each links to the other.
  server: { port: 5180, strictPort: true },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'DoceboAvatars',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'docebo-agent-avatars.js' : 'docebo-agent-avatars.iife.js'),
    },
    target: 'es2020',
  },
});
