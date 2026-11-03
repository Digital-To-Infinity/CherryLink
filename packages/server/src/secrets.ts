import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {config} from './config.js';
const key=Buffer.from(config.TOKEN_ENCRYPTION_KEY_BASE64,'base64');
if(key.length!==32)throw new Error('TOKEN_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes');
export function encrypt(value:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
export function decrypt(value:string){const bytes=Buffer.from(value,'base64');const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}
export function hashState(value:string){return createHash('sha256').update(value).digest('hex');}
