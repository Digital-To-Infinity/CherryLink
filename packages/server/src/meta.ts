import {config} from './config.js';

export class MetaError extends Error {
  constructor(message:string,public readonly status:number|null,public readonly code:number|null,public readonly subcode:number|null,public readonly retryAfter:number|null,public readonly sent:boolean=true){super(message);this.name='MetaError';}
  get tokenInvalid(){return [190,102].includes(this.code??-1);}
  get retryable(){return this.status===429||[4,17,32,613].includes(this.code??-1);}
  get uncertain(){return this.status===null||this.status>=500||this.status===408;}
}
const base=`https://graph.facebook.com/${config.META_GRAPH_VERSION}`;
async function request(method:'GET'|'POST',path:string,token:string,params:Record<string,string>={},timeoutMs=45000){
  if(!/^\/(?:[\w.-]+\/)*[\w.-]+$/.test(path))throw new Error('Unsafe Graph API path');
  const url=new URL(base+path);
  const options:RequestInit={method,headers:{'Authorization':`Bearer ${token}`},signal:AbortSignal.timeout(timeoutMs)};
  if(method==='GET')for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  else {options.body=new URLSearchParams(params);(options.headers as Record<string,string>)['Content-Type']='application/x-www-form-urlencoded';}
  let response:Response;
  try{response=await fetch(url,options);}catch(e){throw new MetaError(e instanceof Error?e.message:'Network failure',null,null,null,null);}
  let body:any;try{body=await response.json();}catch{body={};}
  if(!response.ok||body.error){const x=body.error??{};const retry=response.headers.get('retry-after');throw new MetaError(String(x.message||'Meta API returned an error').slice(0,250),response.status,typeof x.code==='number'?x.code:null,typeof x.error_subcode==='number'?x.error_subcode:null,retry?Number(retry):null);}
  return body;
}
export const graphGet=(path:string,token:string,params:Record<string,string>={})=>request('GET',path,token,params);
export const graphPost=(path:string,token:string,params:Record<string,string>={})=>request('POST',path,token,params);
export async function exchangeCode(code:string,redirectUri:string){
  const uri=new URL(`${base}/oauth/access_token`);
  for(const [k,v] of Object.entries({client_id:config.META_APP_ID,client_secret:config.META_APP_SECRET,redirect_uri:redirectUri,code}))uri.searchParams.set(k,v);
  const res=await fetch(uri,{signal:AbortSignal.timeout(15000)});const data:any=await res.json();
  if(!res.ok||typeof data.access_token!=='string')throw new Error('Meta OAuth exchange failed; inspect app configuration and code validity');
  return {token:data.access_token as string,expiresIn:typeof data.expires_in==='number'?data.expires_in:null};
}
export function oauthUrl(platform:'facebook'|'instagram',state:string){
  const configId=platform==='facebook'?config.META_FACEBOOK_CONFIG_ID:config.META_INSTAGRAM_CONFIG_ID;
  const redirect=platform==='facebook'?config.META_FACEBOOK_REDIRECT_URI:config.META_INSTAGRAM_REDIRECT_URI;
  const url=new URL(`https://www.facebook.com/${config.META_GRAPH_VERSION}/dialog/oauth`);
  for(const [k,v] of Object.entries({client_id:config.META_APP_ID,redirect_uri:redirect,state,config_id:configId,response_type:'code',override_default_response_type:'true'}))url.searchParams.set(k,v);
  return url.toString();
}
export async function discoverPageAccounts(token:string){
  const found:any[]=[];let next:string|null='/me/accounts';let cursor:string|undefined;
  for(let page=0;page<10 && next;page++){
    const res=await graphGet('/me/accounts',token,{fields:'id,name,tasks,access_token,instagram_business_account',limit:'100',...(cursor?{after:cursor}:{})});
    found.push(...(Array.isArray(res.data)?res.data:[]));cursor=res.paging?.cursors?.after;next=res.paging?.next&&cursor?'/me/accounts':null;
  }
  return found as Array<{id:string;name:string;access_token?:string;tasks?:string[];instagram_business_account?:{id:string}}>;
}
export async function debugToken(token:string){
  const appToken=`${config.META_APP_ID}|${config.META_APP_SECRET}`;
  return graphGet('/debug_token',appToken,{input_token:token});
}
