import {pool} from '@cherrylink/server';
async function main(){
try{
 const {rows}=await pool.query<{schema_name:string}>('select database() as schema_name');
 const tables=await pool.query<{name:string}>("select table_name as name from information_schema.tables where table_schema=database() and table_name IN ('users','sessions','workspaces','social_accounts','posts','publication_jobs','account_publish_leases')");
 if(tables.rows.length!==7)throw Error('Missing tables: import mysql/migrations/0001_initial.sql');
 console.log('MySQL connected:',rows[0]?.schema_name,'(' + tables.rows.length + ' essential tables verified)');
}catch(e){console.error('MySQL check failed:',e instanceof Error?e.message:String(e));process.exitCode=1;}
finally{await pool.end();}
}
void main();
