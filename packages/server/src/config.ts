import {config as loadEnv} from 'dotenv';
import {fileURLToPath} from 'node:url';
// Stable in both packages/server/src and packages/server/dist; hosting env vars take precedence.
loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  API_PORT: z.coerce.number().default(3001), DATABASE_URL: z.string().min(10),
  SUPABASE_URL: z.url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(15),
  SUPABASE_STORAGE_BUCKET: z.string().default('cherrylink-media'),
  TOKEN_ENCRYPTION_KEY_BASE64: z.string().min(40),
  META_APP_ID: z.string().min(1),META_APP_SECRET:z.string().min(1),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v26.0'),
  META_FACEBOOK_CONFIG_ID:z.string().min(1),META_INSTAGRAM_CONFIG_ID:z.string().min(1),
  META_FACEBOOK_REDIRECT_URI:z.url(),META_INSTAGRAM_REDIRECT_URI:z.url(),
  WEB_URL:z.url(), CORS_ORIGIN:z.string(), LIVE_PUBLISHING_ENABLED:z.enum(['true','false']).default('false'),
  WORKER_POLL_MS:z.coerce.number().int().min(2000).default(10000),WORKER_ID:z.string().default('worker-local')
});
export const config = schema.parse(process.env);
