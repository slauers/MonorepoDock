import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../backend/frontend/dist",
    emptyOutDir: true
  },
  server: {
    port: 3410,
    strictPort: true
  }
});
