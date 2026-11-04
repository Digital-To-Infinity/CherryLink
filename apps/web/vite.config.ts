import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import {fileURLToPath} from 'node:url';
// Single root .env for both frontend and server; only VITE_ variables reach the browser.
export default defineConfig({plugins:[react()],envDir:fileURLToPath(new URL('../..',import.meta.url)),server:{port:5173,host:'127.0.0.1'},build:{outDir:'dist'}});
