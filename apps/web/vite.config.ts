import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
// npm workspaces launch Vite from apps/web; use the repository-root .env for all apps.
export default defineConfig({plugins:[react()],envDir:fileURLToPath(new URL('../..',import.meta.url)),server:{port:5173},build:{outDir:'dist'}});
