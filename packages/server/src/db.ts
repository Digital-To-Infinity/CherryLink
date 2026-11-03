import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {config} from './config.js';
export const pool = new pg.Pool({connectionString: config.DATABASE_URL,max:10,ssl: config.NODE_ENV==='production'?{rejectUnauthorized:true}:undefined});
export const supabaseAdmin = createClient(config.SUPABASE_URL,config.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
export async function authorize(workspaceId:string,userId:string,role:'ADMIN'|'EDITOR'='EDITOR') {
  const {rows}=await pool.query<{role:'ADMIN'|'EDITOR'}>('select role from workspace_members where workspace_id=$1 and user_id=$2',[workspaceId,userId]);
  if(!rows.length || (role==='ADMIN' && rows[0]?.role!=='ADMIN')) throw Object.assign(new Error('Not authorized for this workspace'),{statusCode:403});
}
export async function audit(workspaceId:string, actorId:string|null, entityType:string,entityId:string,action:string,metadata:object={}){
  await pool.query('insert into audit_logs(workspace_id,actor_id,entity_type,entity_id,action,metadata) values($1,$2,$3,$4,$5,$6)',[workspaceId,actorId,entityType,entityId,action,JSON.stringify(metadata)]);
}
