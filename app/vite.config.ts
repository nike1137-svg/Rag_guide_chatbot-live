import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // 제출용은 GitHub Pages 하위 경로, 실사용판은 도메인 루트에 올라간다.
  base: process.env.VITE_BASE || '/Rag_guide_chatbot/',
  plugins: [react()],
})
