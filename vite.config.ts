import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env": {},
  },
  // Add the ngrok host to the allowed hosts
  server: {
    allowedHosts: ["61d6-102-89-22-89.ngrok-free.app"],
  },
});
