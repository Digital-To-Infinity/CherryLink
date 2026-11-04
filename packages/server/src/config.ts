import {config as loadEnv} from 'dotenv';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
// The repository-root .env is shared across workspace packages; production ENV takes precedence.
loadEnv({path:fileURLToPath(new URL('../../../.env',import.meta.url)),quiet:true});
const schema=z.object({
 NODE_ENV:z.enum(['development','test','production']).default('development'),
 API_PORT:z.coerce.number().int().default(3001),
 MYSQL_HOST:z.string().min(1).default('127.0.0.1'),MYSQL_PORT:z.coerce.number().int().default(3306),
 MYSQL_USER:z.string().min(1),MYSQL_PASSWORD:z.string(),MYSQL_DATABASE:z.string().min(1),
 MYSQL_SSL:z.enum(['true','false']).default('false'),
 WEB_URL:z.url().default('http://127.0.0.1:5173'),
 CORS_ORIGIN:z.string().default('http://127.0.0.1:5173'),
 MEDIA_DIR:z.string().min(1).default('./var/cherrylink-media'),
 MEDIA_PUBLIC_BASE_URL:z.url().default('http://127.0.0.1:3001'),
 MEDIA_SIGNING_KEY:z.string().min(32),
 TOKEN_ENCRYPTION_KEY_BASE64:z.string().min(40),
 META_APP_ID:z.string().default(''),META_APP_SECRET:z.string().default(''),
 META_GRAPH_VERSION:z.string().regex(/^v\d+\.\d+$/).default('v26.0'),
 META_FACEBOOK_CONFIG_ID:z.string().default(''),META_INSTAGRAM_CONFIG_ID:z.string().default(''),
 META_FACEBOOK_REDIRECT_URI:z.url().default('http://127.0.0.1:3001/api/connections/facebook/callback'),
 META_INSTAGRAM_REDIRECT_URI:z.url().default('http://127.0.0.1:3001/api/connections/instagram/callback'),
 LIVE_PUBLISHING_ENABLED:z.enum(['true','false']).default('false'),
 WORKER_POLL_MS:z.coerce.number().int().min(2000).default(10000),
 WORKER_ID:z.string().default('cherrylink-worker-local')
});
export const config=schema.parse(process.env);
if(config.NODE_ENV==='production' && (!config.MEDIA_PUBLIC_BASE_URL.startsWith('https://')||!config.WEB_URL.startsWith('https://')))throw new Error('Production requires HTTPS origins');
