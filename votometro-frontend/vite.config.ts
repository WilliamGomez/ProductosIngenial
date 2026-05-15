import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
const backendProxy = {
  "/api": {
    target: "http://localhost:7071",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 8080,
    proxy: backendProxy,
  },
  preview: {
    port: 8080,
    proxy: backendProxy,
  },
});
