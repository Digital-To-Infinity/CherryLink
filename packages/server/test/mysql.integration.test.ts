import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const withMysql=process.env.CI_MYSQL_TEST==='true';
test('MySQL 8 schema, auth sessions, workspace isolation and published-state guard',{skip:!withMysql},async()=>{
 const {pool,createUser,verifyPassword,createSession,getSessionUser,destroySession,authorize,newId}=await import('../src/index.js');
 const uid1=await createUser('cl_ci1_'+randomUUID()+'@example.test','UniqueTestStrongPassword1234!','Admin');
 const uid2=await createUser('cl_ci2_'+randomUUID()+'@example.test','UniqueTestStrongPassword5678!','Editor');
 const ws=newId(),acct=newId(),post=newId(),target=newId();
 try{
  const {rows}=await pool.query<{password_hash:string}>('select password_hash from users where id=$1',[uid1]);
  assert.equal(await verifyPassword('UniqueTestStrongPassword1234!',rows[0]!.password_hash),true);
  assert.equal(await verifyPassword('wrongpassword012345',rows[0]!.password_hash),false);
  const tok=await createSession(uid1);
  assert.equal((await getSessionUser(tok))?.id,uid1);
  await destroySession(tok);assert.equal(await getSessionUser(tok),null);
  await pool.query('insert into workspaces(id,name,settings) values($1,$2,$3)',[ws,'CI workspace','{}']);
  await pool.query("insert into workspace_members(id,workspace_id,user_id,role) values($1,$2,$3,'ADMIN')",[newId(),ws,uid1]);
  await authorize(ws,uid1,'ADMIN');
  await assert.rejects(()=>authorize(ws,uid2),/Not authorized/);
  await pool.query('insert into social_accounts(id,workspace_id,platform,provider_account_id,name,permission_metadata) values($1,$2,$3,$4,$5,$6)',[acct,ws,'FACEBOOK','ci-only-asset','CI fixture','{}']);
  await pool.query("insert into posts(id,workspace_id,created_by,caption,timezone,lifecycle_status,content_origin) values($1,$2,$3,$4,'Asia/Kolkata','SCHEDULED','HUMAN_UPLOAD')",[post,ws,uid1,'CI fixture']);
  await pool.query("insert into post_targets(id,post_id,workspace_id,social_account_id,platform,content_type,scheduled_at_utc,publishing_status) values($1,$2,$3,$4,'FACEBOOK','TEXT',UTC_TIMESTAMP(3),'PUBLISHED')",[target,post,ws,acct]);
  await assert.rejects(()=>pool.query("update post_targets set publishing_status='SCHEDULED' where id=$1",[target]));
  const events=await pool.query<{old_status:string|null;new_status:string}>('select old_status,new_status from publication_events where post_target_id=$1',[target]);
  assert.equal(events.rows[0]?.new_status,'PUBLISHED');
 }finally{
  await pool.query('delete from workspaces where id=$1',[ws]);
  await pool.query('delete from users where id IN ($1,$2)',[uid1,uid2]);
  await pool.end();
 }
});
