import {createHmac,timingSafeEqual} from 'node:crypto';
import {resolve,sep,join} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {config} from './config.js';
export type MediaVariant='original'|'prepared';
const root=resolve(config.MEDIA_DIR);
export function resolveMediaPath(relativePath:string){
 // Explicit filename allowlist; never resolve arbitrary user-provided paths.
 if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(original\.(jpg|png|mp4)|prepared\.jpg)$/.test(relativePath))throw Error('Unsafe media storage path');
 const location=resolve(root,relativePath);
 if(!location.startsWith(root+sep))throw Error('Unsafe media path');
 return location;
}
export async function saveMedia(path:string,bytes:Buffer){
 const absolute=resolveMediaPath(path);await mkdir(resolve(absolute,'..'),{recursive:true,mode:0o700});
 await writeFile(absolute,bytes,{flag:'wx',mode:0o600});
}
export const readMedia=(path:string)=>readFile(resolveMediaPath(path));
function hmac(assetId:string,variant:MediaVariant,expiry:number){
 return createHmac('sha256',config.MEDIA_SIGNING_KEY).update(assetId+':'+variant+':'+expiry).digest('hex');
}
export function createMediaUrl(assetId:string,variant:MediaVariant,ttlSeconds:number){
 const expiry=Math.floor(Date.now()/1000)+ttlSeconds;
 const u=new URL(config.MEDIA_PUBLIC_BASE_URL);
 u.pathname='/api/public/media/'+assetId+'/'+variant;
 u.search=new URLSearchParams({expires:String(expiry),sig:hmac(assetId,variant,expiry)}).toString();
 return u.toString();
}
export function verifyMediaUrl(assetId:string,variant:string,expiryRaw:string,sig:string){
 if(!/^[a-f0-9-]{36}$/.test(assetId)||!['original','prepared'].includes(variant))return false;
 const expiry=Number(expiryRaw);
 if(!Number.isSafeInteger(expiry)||expiry<Math.floor(Date.now()/1000)||expiry>Math.floor(Date.now()/1000)+86400||!(/^[0-9a-f]{64}$/.test(sig)))return false;
 const a=Buffer.from(hmac(assetId,variant as MediaVariant,expiry),'hex'),b=Buffer.from(sig,'hex');
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function mediaContentType(path:string){return path.endsWith('.mp4')?'video/mp4':path.endsWith('.png')?'image/png':'image/jpeg';}
