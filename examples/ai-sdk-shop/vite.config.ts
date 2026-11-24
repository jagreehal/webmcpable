import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { handleChat } from './server/chat.ts'

export default defineConfig({
  plugins: [
    react(),
    {
      configureServer(server) {
        server.middlewares.use('/api/chat', (request, response) => void handleChat(request, response))
      },
      name: 'chat-api',
    },
  ],
  // webmcpable is linked, so its copy of React has to resolve to this one.
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    fs: { allow: ['.', '../../packages/webmcpable'] },
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
  },
})
