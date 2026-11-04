import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const enabled=process.env.CI_MYSQL_TEST==='true';
test('HTTP login, workspace, post draft, invitation and editor isolation through MySQL',{skip:!enabled,timeout:40000},async()=>{
 const {pool,createUser}=await import('../src/index.js');
 const adminEmail='cl_http_'+randomUUID()+'@example.test',editorEmail='cl_invite_'+randomUUID()+'@example.test';
 const password='CiUniqueLongPassword123456!';
 const adminId=await createUser(adminEmail,password);
 const child=spawn(process.execPath,['apps/api/dist/index.js'],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=b.toString());
 const base='http://127.0.0.1:3001';
 let workspaceId:string|null=null;let editorId:string|null=null;
 try{
  let ready=false;
  for(let i=0;i<50;i++){try{if((await fetch(base+'/readyz')).ok){ready=true;break;}}catch{}await delay(200);}
  assert.equal(ready,true,'API did not become ready: '+errors.slice(0,500));
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:adminEmail,password})});
  assert.equal(login.status,200,await login.clone().text().catch(()=>'')); // response already available
  const cookie=login.headers.get('set-cookie')?.split(';')[0]||'';
  assert.ok(cookie.startsWith('cherrylink_session='));
  const {csrfToken}=await login.json();
  const calls=(method:string,path:string,body?:object,workspace?:string,authCookie=cookie,csrf=csrfToken)=>
   fetch(base+path,{method,headers:{Cookie:authCookie,'x-csrf-token':csrf,...(workspace?{'x-workspace-id':workspace}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let rsp=await calls('GET','/api/me');assert.equal(rsp.status,200);
  rsp=await calls('POST','/api/workspaces',{name:'MySQL Test Workspace'});assert.equal(rsp.status,201,await rsp.clone().text().catch(()=>'')); 
  // GET json from fresh request if response body was consumed by text in assertion messages.
  workspaceId=(await calls('GET','/api/me').then(x=>x.json())).workspaces[0]?.id;
  assert.ok(workspaceId);
  rsp=await calls('POST','/api/posts',{caption:'HTTP integration draft',saveDraft:true,accountIds:[],mediaAssetId:null},workspaceId!);
  assert.equal(rsp.status,201,await rsp.clone().text().catch(()=>''));
  const posts=(await calls('GET','/api/posts',undefined,workspaceId!).then(x=>x.json())).posts;
  assert.equal(posts.length,1);assert.equal(posts[0].lifecycle_status,'DRAFT');
  rsp=await calls('POST','/api/team/invite',{email:editorEmail,role:'EDITOR'},workspaceId!);
  assert.equal(rsp.status,201);const {inviteUrl}=await rsp.json();const token=new URL(inviteUrl).searchParams.get('invite');assert.ok(token);
  rsp=await fetch(base+'/api/auth/accept-invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:'EditorPassLong123456789!'})});
  assert.equal(rsp.status,201,await rsp.clone().text().catch(()=>''));
  const editorCookie=rsp.headers.get('set-cookie')?.split(';')[0]||'';
  const auth=(await fetch(base+'/api/auth/session',{headers:{Cookie:editorCookie}})).json();
  const editorSession=await auth;editorId=editorSession.user.id;
  assert.equal(editorSession.user.email,editorEmail);
  const editorView=await calls('GET','/api/me',undefined,undefined,editorCookie,editorSession.csrfToken);
  assert.equal(editorView.status,200);
  const prohibited=await calls('GET','/api/operations',undefined,workspaceId!,editorCookie,editorSession.csrfToken);
  assert.equal(prohibited.status,403);
 }finally{
  child.kill('SIGTERM');
  await delay(200);
  if(workspaceId)await pool.query('delete from workspaces where id=$1',[workspaceId]);
  if(editorId)await pool.query('delete from users where id=$1',[editorId]);
  await pool.query('delete from users where id=$1',[adminId]);
  await pool.end();
 }
});
