import mysql from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {config} from './config.js';
// mysql2 returns standard arrays; this adapter preserves the existing {rows} API while converting $n bindings.
const mysqlPool=mysql.createPool({
 host:config.MYSQL_HOST,port:config.MYSQL_PORT,user:config.MYSQL_USER,password:config.MYSQL_PASSWORD,
 database:config.MYSQL_DATABASE,waitForConnections:true,connectionLimit:10,timezone:'Z',
 ssl:config.MYSQL_SSL==='true'?{rejectUnauthorized:true}:undefined,decimalNumbers:true
});
function bindings(sql:string,args:unknown[]=[]):[string,unknown[]]{
 const bound:unknown[]=[];
 const statement=sql.replace(/\$(\d+)/g,(_,n:string)=>{
  const i=Number(n)-1;if(i<0||i>=args.length)throw Error('Missing SQL parameter');
  const value=args[i];
  // MySQL DATETIME columns store UTC without timezone suffix. Normalize ISO instants.
  bound.push(typeof value==='string' && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$/.test(value)?value.replace('T',' ').replace(/Z$/,''):value);
  return '?';
 });
 return [statement,bound];
}
export interface QueryResult<T>{rows:T[];rowCount:number;}
export interface DbClient{
 query<T=any>(statement:string,params?:unknown[]):Promise<QueryResult<T>>;
 release():void;
}
async function queryOn<T>(connection:mysql.PoolConnection,sql:string,params?:unknown[]):Promise<QueryResult<T>>{
 const [statement,values]=bindings(sql,params);
 const [result]=await connection.query(statement,values as any[]);
 const rows=Array.isArray(result)?result as T[]:[];
 const info=result as mysql.ResultSetHeader;
 return {rows,rowCount:rows.length||info.affectedRows||0};
}
export const pool={
 async connect():Promise<DbClient>{
  const conn=await mysqlPool.getConnection();
  try{await conn.query("SET time_zone = '+00:00'");}catch(e){conn.release();throw e;}
  return {query:<T=any>(sql:string,args?:unknown[])=>queryOn<T>(conn,sql,args),release:()=>conn.release()};
 },
 async query<T=any>(sql:string,args?:unknown[]):Promise<QueryResult<T>>{
  const client=await this.connect();try{return await client.query<T>(sql,args);}finally{client.release();}
 },
 end:()=>mysqlPool.end()
};
export const newId=()=>randomUUID();
export async function authorize(workspaceId:string,userId:string,role:'ADMIN'|'EDITOR'='EDITOR'){
 const {rows}=await pool.query<{role:'ADMIN'|'EDITOR'}>('select role from workspace_members where workspace_id=$1 and user_id=$2',[workspaceId,userId]);
 if(!rows.length||(role==='ADMIN'&&rows[0]!.role!=='ADMIN'))throw Object.assign(new Error('Not authorized for this workspace'),{statusCode:403});
}
export async function audit(workspaceId:string,actorId:string|null,entityType:string,entityId:string,action:string,metadata:object={}){
 await pool.query('insert into audit_logs(workspace_id,actor_id,entity_type,entity_id,action,metadata) values($1,$2,$3,$4,$5,$6)',[workspaceId,actorId,entityType,entityId,action,JSON.stringify(metadata)]);
}
