import {createClient} from '@supabase/supabase-js';
import {formatInTimeZone,fromZonedTime} from 'date-fns-tz';
export const supabase=createClient(import.meta.env.VITE_SUPABASE_URL||'https://placeholder.supabase.co',import.meta.env.VITE_SUPABASE_ANON_KEY||'placeholder');
export const API_URL=import.meta.env.VITE_API_URL||'http://localhost:3001';
export async function api(path:string,workspaceId:string|null=null,options:RequestInit={}):Promise<any>{
  const {data}=await supabase.auth.getSession();const token=data.session?.access_token;
  if(!token)throw Error('Please sign in again');
  const response=await fetch(API_URL+path,{...options,headers:{Authorization:`Bearer ${token}`,...(workspaceId?{'x-workspace-id':workspaceId}:{}),...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),...options.headers}});
  const json=await response.json().catch(()=>null);if(!response.ok)throw Error(json?.error?.message||`Request failed (${response.status})`);return json;
}
export function utcFromLocal(input:string,zone:string){
  const date=fromZonedTime(input,zone);if(!Number.isFinite(date.getTime()))throw Error('Invalid date or time');
  if(formatInTimeZone(date,zone,"yyyy-MM-dd'T'HH:mm")!==input.slice(0,16))throw Error('This local time does not exist in the selected timezone');
  return date.toISOString();
}
export function fmt(iso:string|null|undefined,zone='Asia/Kolkata',format='dd MMM yyyy, hh:mm a'){
  if(!iso)return 'Not scheduled';try{return formatInTimeZone(new Date(iso),zone,format);}catch{return 'Invalid date';}
}
export function statusColor(v:string){
  if(v==='PUBLISHED')return 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300';
  if(v==='FAILED'||v==='ACTION_REQUIRED')return 'text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300';
  if(v==='UNKNOWN')return 'text-amber-800 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300';
  return 'text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-200';
}
export interface Account {id:string;name:string;username?:string;platform:'FACEBOOK'|'INSTAGRAM';provider_account_id:string;connection_status:string;permission_metadata:any;}
export interface Target {id:string;platform:string;account_name:string;social_account_id:string;publishing_status:string;provider_permalink:string|null;published_at:string|null;last_error_message:string|null;}
export interface Post {id:string;caption:string;scheduled_at_utc:string|null;timezone:string;lifecycle_status:string;media_asset_id:string|null;created_at:string;targets:Target[];}
export interface Media {id:string;original_filename:string;mime_type:string;width:number;height:number;duration_seconds:number|null;created_at:string;}
