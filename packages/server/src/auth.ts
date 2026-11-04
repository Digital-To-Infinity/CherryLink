import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {pool,newId} from './db.js';
const scrypt=promisify(scryptCallback);
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export async function passwordHash(password:string){
 if(password.length<12||password.length>128)throw Object.assign(new Error('Password must be 12–128 characters'),{statusCode:400});
 const salt=randomBytes(24).toString('hex');
 const derived=await scrypt(password,salt,64,{N:16384,r:8,p:1}) as Buffer;
 return 'scrypt$'+salt+'$'+derived.toString('hex');
}
export async function verifyPassword(password:string,stored:string){
 const [algorithm,salt,key]=stored.split('$');
 if(algorithm!=='scrypt'||!salt||!key)return false;
 const derived=await scrypt(password,salt,64,{N:16384,r:8,p:1}) as Buffer;
 const expected=Buffer.from(key,'hex');return expected.length===derived.length&&timingSafeEqual(derived,expected);
}
export async function createSession(userId:string){
 const token=randomBytes(32).toString('base64url');
 const tokenHash=hash(token);
 await pool.query('insert into sessions(token_hash,user_id,expires_at) values($1,$2,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY))',[tokenHash,userId]);
 return token;
}
export async function getSessionUser(token:string){
 if(!token||token.length>150)return null;
 const {rows}=await pool.query<{id:string;email:string;display_name:string|null}>(
  'select u.id,u.email,u.display_name from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>UTC_TIMESTAMP(3) and u.disabled=0',
  [hash(token)]);
 return rows[0]??null;
}
export async function destroySession(token:string){if(token)await pool.query('delete from sessions where token_hash=$1',[hash(token)]);}
export function csrfToken(token:string){return createHash('sha256').update(token+':cherrylink-csrf').digest('hex');}
export function validateCsrf(token:string,csrf:string){const a=Buffer.from(csrfToken(token));const b=Buffer.from(csrf);return a.length===b.length&&timingSafeEqual(a,b);}
export function tokenHash(token:string){return hash(token);}
export async function createUser(email:string,password:string,name?:string){
 const id=newId();await pool.query('insert into users(id,email,password_hash,display_name) values($1,$2,$3,$4)',[id,email.trim().toLowerCase(),await passwordHash(password),name||null]);return id;
}
