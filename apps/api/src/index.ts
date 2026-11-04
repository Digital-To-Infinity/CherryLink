import express,{type Request,type Response,type NextFunction} from 'express';
import cors from 'cors';import helmet from 'helmet';import rateLimit from 'express-rate-limit';import multer from 'multer';
import {fileTypeFromBuffer} from 'file-type';import sharp from 'sharp';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createPostSchema,rescheduleSchema} from '@cherrylink/shared';
import {config,pool,newId,authorize,audit,encrypt,hashState,oauthUrl,exchangeCode,discoverPageAccounts,graphGet,debugToken,
 getSessionUser,createSession,destroySession,verifyPassword,createUser,tokenHash,validateCsrf,csrfToken,
 saveMedia,readMedia,createMediaUrl,verifyMediaUrl,mediaContentType} from '@cherrylink/server';

const app=express();app.disable('x-powered-by');if(config.NODE_ENV==='production')app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:config.CORS_ORIGIN.split(',').map(v=>v.trim()),credentials:true,methods:['GET','POST','PATCH','DELETE'],allowedHeaders:['Content-Type','x-workspace-id','x-csrf-token']}));
app.use(express.json({limit:'1mb'}));
app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false}));
const loginLimiter=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
const asyncRoute=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res)).catch(next);};
const bad=(msg:string,statusCode=400)=>Object.assign(new Error(msg),{statusCode});
const cookieName='cherrylink_session';
function sessionFromCookie(req:Request){
 const entry=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
 return entry?.slice(cookieName.length+1)||'';
}
function sessionCookie(token:string,maxAge:number){
 return [cookieName+'='+token,'Path=/api','HttpOnly','SameSite=Lax',...(config.NODE_ENV==='production'?['Secure']:[]),'Max-Age='+maxAge].join('; ');
}
const auth=(req:Request,res:Response,next:NextFunction)=>{(async()=>{
 const token=sessionFromCookie(req);if(!token)throw bad('Sign in required',401);
 const user=await getSessionUser(token);if(!user)throw bad('Session expired; sign in again',401);
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!validateCsrf(token,req.header('x-csrf-token')||''))throw bad('Session verification failed; reload and try again',403);
 res.locals.userId=user.id;res.locals.user=user;res.locals.sessionToken=token;next();
})().catch(next);};
const member=(req:Request,res:Response,next:NextFunction)=>{(async()=>{
 const id=req.header('x-workspace-id');if(!id||!/^[-a-f0-9]{36}$/i.test(id))throw bad('Select a workspace');
 await authorize(id,res.locals.userId);res.locals.workspaceId=id;next();
})().catch(next);};
const admin=(req:Request,res:Response,next:NextFunction)=>{authorize(res.locals.workspaceId,res.locals.userId,'ADMIN').then(()=>next()).catch(next);};

app.post('/api/auth/login',loginLimiter,asyncRoute(async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');
 if(!email||!password)throw bad('Email and password required');
 const {rows}=await pool.query<{id:string;password_hash:string;disabled:number}>('select id,password_hash,disabled from users where email=$1 limit 1',[email]);
 if(!rows.length||rows[0]!.disabled||!await verifyPassword(password,rows[0]!.password_hash))throw bad('Invalid email or password',401);
 const token=await createSession(rows[0]!.id);
 res.setHeader('Set-Cookie',sessionCookie(token,7*24*3600));res.json({ok:true,csrfToken:csrfToken(token)});
}));
app.get('/api/auth/session',asyncRoute(async(req,res)=>{
 const token=sessionFromCookie(req),user=await getSessionUser(token);
 if(!user){res.status(401).json({authenticated:false});return;}
 res.json({authenticated:true,user,csrfToken:csrfToken(token)});
}));
app.post('/api/auth/logout',auth,asyncRoute(async(_req,res)=>{
 await destroySession(res.locals.sessionToken);
 res.setHeader('Set-Cookie',sessionCookie('',0));res.json({ok:true});
}));
app.post('/api/auth/accept-invite',loginLimiter,asyncRoute(async(req,res)=>{
 const token=String(req.body?.token||''),password=String(req.body?.password||'');
 const {rows}=await pool.query<{workspace_id:string;email:string;role:'ADMIN'|'EDITOR'}>(
  'select workspace_id,email,role from workspace_invitations where token_hash=$1 and accepted_at is null and expires_at>UTC_TIMESTAMP(3)',[tokenHash(token)]);
 if(!rows.length)throw bad('Invitation expired or invalid',410);
 const invite=rows[0]!;
 const existing=await pool.query('select id from users where email=$1',[invite.email]);
 if(existing.rows.length)throw bad('Account already exists. Sign in to accept the invitation.',409);
 const userId=await createUser(invite.email,password);
 const client=await pool.connect();
 try{await client.query('begin');
  const locked=await client.query('select token_hash from workspace_invitations where token_hash=$1 and accepted_at is null and expires_at>UTC_TIMESTAMP(3) for update',[tokenHash(token)]);
  if(!locked.rows.length)throw bad('Invitation no longer available',410);
  await client.query('insert into workspace_members(id,workspace_id,user_id,role) values($1,$2,$3,$4)',[newId(),invite.workspace_id,userId,invite.role]);
  await client.query('update workspace_invitations set accepted_at=UTC_TIMESTAMP(3) where token_hash=$1',[tokenHash(token)]);
  await client.query('commit');
 }catch(e){await client.query('rollback');throw e;}finally{client.release();}
 const session=await createSession(userId);res.setHeader('Set-Cookie',sessionCookie(session,7*24*3600));
 res.status(201).json({ok:true,csrfToken:csrfToken(session)});
}));
app.post('/api/auth/join-workspace',auth,asyncRoute(async(req,res)=>{
 const token=String(req.body?.token||'');
 const client=await pool.connect();
 try{await client.query('begin');
  const inv=await client.query<{workspace_id:string;email:string;role:'ADMIN'|'EDITOR'}>(
   'select workspace_id,email,role from workspace_invitations where token_hash=$1 and accepted_at is null and expires_at>UTC_TIMESTAMP(3) for update',[tokenHash(token)]);
  if(!inv.rows.length||inv.rows[0]!.email.toLowerCase()!==res.locals.user.email.toLowerCase())throw bad('Invitation expired or does not match your email',403);
  await client.query('insert into workspace_members(id,workspace_id,user_id,role) values($1,$2,$3,$4) on duplicate key update role=values(role)',[newId(),inv.rows[0]!.workspace_id,res.locals.userId,inv.rows[0]!.role]);
  await client.query('update workspace_invitations set accepted_at=UTC_TIMESTAMP(3) where token_hash=$1',[tokenHash(token)]);
  await client.query('commit');res.json({ok:true});
 }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}));
app.get('/healthz',(_req,res)=>res.json({status:'ok'}));
app.get('/readyz',asyncRoute(async(_req,res)=>{await pool.query('select 1');res.json({status:'ready'});}));
app.get('/api/me',auth,asyncRoute(async(_req,res)=>{const {rows}=await pool.query(`select w.id,w.name,w.timezone,m.role from workspace_members m join workspaces w on w.id=m.workspace_id where m.user_id=$1 order by w.created_at`,[res.locals.userId]);res.json({workspaces:rows});}));
app.post('/api/workspaces',auth,asyncRoute(async(req,res)=>{
  const name=String(req.body?.name??'').trim();if(name.length<2||name.length>120)throw bad('Workspace name must have 2-120 characters');
  const client=await pool.connect();try{await client.query('begin');const id=newId();await client.query('insert into workspaces(id,name,settings) values($1,$2,$3)',[id,name,'{}']);
  await client.query(`insert into workspace_members(id,workspace_id,user_id,role) values($1,$2,$3,'ADMIN')`,[newId(),id,res.locals.userId]);await client.query('commit');res.status(201).json({id});
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}));
app.get('/api/accounts',auth,member,asyncRoute(async(_req,res)=>{
  const {rows}=await pool.query('select id,platform,provider_account_id,name,username,account_type,connection_status,permission_metadata,token_expiry,created_at from social_accounts where workspace_id=$1 order by created_at desc',[res.locals.workspaceId]);res.json({accounts:rows});
}));
app.post('/api/accounts/:id/disconnect',auth,member,admin,asyncRoute(async(req,res)=>{
 const existing=await pool.query('select id from social_accounts where id=$1 and workspace_id=$2',[req.params.id,res.locals.workspaceId]);
 if(!existing.rows.length)throw bad('Account not found',404);
 const client=await pool.connect();try{await client.query('begin');
 await client.query("update social_accounts set connection_status='DISCONNECTED',token_reference=null,updated_at=UTC_TIMESTAMP(3) where id=$1",[req.params.id]);
 await client.query('delete from social_account_credentials where social_account_id=$1',[req.params.id]);
 await client.query("update post_targets set publishing_status='ACTION_REQUIRED',last_error_code='ACCOUNT_DISCONNECTED' where social_account_id=$1 and publishing_status in ('SCHEDULED','RETRY_WAIT','READY')",[req.params.id]);
 await client.query('commit');
 }catch(e){await client.query('rollback');throw e;}finally{client.release();}
 await audit(res.locals.workspaceId,res.locals.userId,'social_account',req.params.id!,'DISCONNECT');res.json({ok:true});
}));
app.post('/api/connections/:platform/start',auth,member,admin,asyncRoute(async(req,res)=>{
  const kind=req.params.platform==='facebook'?'FACEBOOK':req.params.platform==='instagram'?'INSTAGRAM':null;
  if(!kind)throw bad('Unsupported platform');const raw=randomBytes(32).toString('base64url');
  await pool.query(`insert into oauth_states(state_hash,workspace_id,actor_id,platform,expires_at) values($1,$2,$3,$4,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))`,[hashState(raw),res.locals.workspaceId,res.locals.userId,kind]);
  res.json({authorizationUrl:oauthUrl(req.params.platform as 'facebook'|'instagram',raw)});
}));
async function upsertAccount(workspaceId:string,platform:'FACEBOOK'|'INSTAGRAM',providerId:string,name:string,token:string,tokenKind:string,metadata:object){
 const client=await pool.connect();
 try{await client.query('begin');
  const existing=await client.query<{id:string}>('select id from social_accounts where workspace_id=$1 and platform=$2 and provider_account_id=$3 for update',[workspaceId,platform,providerId]);
  const id=existing.rows[0]?.id||newId();
  if(existing.rows.length)await client.query("update social_accounts set name=$1,permission_metadata=$2,connection_status='CONNECTED',updated_at=UTC_TIMESTAMP(3) where id=$3",[name,JSON.stringify(metadata),id]);
  else await client.query('insert into social_accounts(id,workspace_id,platform,provider_account_id,name,permission_metadata) values($1,$2,$3,$4,$5,$6)',[id,workspaceId,platform,providerId,name,JSON.stringify(metadata)]);
  const old=await client.query<{id:string}>('select id from social_account_credentials where social_account_id=$1 for update',[id]);
  const credentialId=old.rows[0]?.id||newId();
  if(old.rows.length)await client.query('update social_account_credentials set encrypted_token=$1,token_kind=$2,rotated_at=UTC_TIMESTAMP(3) where id=$3',[encrypt(token),tokenKind,credentialId]);
  else await client.query('insert into social_account_credentials(id,social_account_id,encrypted_token,token_kind) values($1,$2,$3,$4)',[credentialId,id,encrypt(token),tokenKind]);
  await client.query('update social_accounts set token_reference=$1 where id=$2',[credentialId,id]);
  await client.query('commit');return id;
 }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}
app.get('/api/connections/:platform/callback',asyncRoute(async(req,res)=>{
  const platform=req.params.platform==='facebook'?'FACEBOOK':req.params.platform==='instagram'?'INSTAGRAM':null;
  const errorLocation=new URL(config.WEB_URL);errorLocation.searchParams.set('view','accounts');
  if(!platform)throw bad('Unsupported OAuth callback');
  if(typeof req.query.state!=='string')throw bad('Missing OAuth state');
  const stateHash=hashState(req.query.state);
  const client=await pool.connect();let session:{workspace_id:string;actor_id:string}|undefined;
  try{await client.query('begin');const {rows}=await client.query<{workspace_id:string;actor_id:string}>(`select workspace_id,actor_id from oauth_states where state_hash=$1 and platform=$2 and consumed_at is null and expires_at>now() for update`,[stateHash,platform]);
    session=rows[0];if(!session)throw bad('Expired or already-used OAuth state',403);
    await client.query('update oauth_states set consumed_at=UTC_TIMESTAMP(3) where state_hash=$1',[stateHash]);await client.query('commit');
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
  if(req.query.error||typeof req.query.code!=='string'){errorLocation.searchParams.set('connect_error','Meta authorization declined or invalid');return res.redirect(errorLocation.toString());}
  const redirectUri=platform==='FACEBOOK'?config.META_FACEBOOK_REDIRECT_URI:config.META_INSTAGRAM_REDIRECT_URI;
  try{
    const {token}=await exchangeCode(req.query.code,redirectUri);
    const debug=await debugToken(token);
    const grants: string[]=Array.isArray(debug.data?.scopes)?debug.data.scopes:[];
    if(debug.data?.is_valid===false)throw new Error('Meta returned an invalid token');
    const pages=await discoverPageAccounts(token);
    let added=0;
    if(platform==='FACEBOOK'){
      if(!grants.includes('pages_manage_posts')||!grants.includes('pages_show_list'))throw new Error('Missing Page posting permissions');
      for(const p of pages){if(!p.access_token||!p.tasks?.includes('CREATE_CONTENT'))continue;
        await upsertAccount(session!.workspace_id,'FACEBOOK',p.id,p.name,p.access_token,'PAGE',{tasks:p.tasks,grants});added++;
      }
      if(!added)throw new Error('No Facebook Page with CREATE_CONTENT access discovered');
    }else{
      if(!grants.includes('instagram_basic')||!grants.includes('instagram_content_publish'))throw new Error('Missing Instagram publishing permissions in Unified Login configuration');
      for(const p of pages){const ig=p.instagram_business_account?.id;if(!ig)continue;
        try{const info=await graphGet('/'+ig,p.access_token||token,{fields:'id,username,account_type'});
          await upsertAccount(session!.workspace_id,'INSTAGRAM',ig,info.username||`Instagram ${ig}`,p.access_token||token,p.access_token?'LINKED_PAGE':'BUSINESS_INTEGRATION',{grants,linkedPage:p.id});added++;
        }catch{/* Do not mark unverified assets connected. */}
      }
      if(!added){
        const pendingId=newId();await pool.query(`insert into connection_sessions(id,workspace_id,actor_id,platform,encrypted_token,token_kind,permission_metadata,expires_at) values($1,$2,$3,'INSTAGRAM',$4,'BUSINESS_INTEGRATION',$5,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE))`,[pendingId,session!.workspace_id,session!.actor_id,encrypt(token),JSON.stringify({grants})]);
        errorLocation.searchParams.set('pending_ig_session',pendingId);
        return res.redirect(errorLocation.toString());
      }
    }
    await audit(session!.workspace_id,session!.actor_id,'connection',platform,'CONNECTED',{accountsAdded:added});errorLocation.searchParams.set('connected',platform);return res.redirect(errorLocation.toString());
  }catch(e){console.error('Meta connection failed',e instanceof Error?e.name:'unknown');errorLocation.searchParams.set('connect_error','Meta connection failed. Check app configuration, permissions and selected assets.');return res.redirect(errorLocation.toString());}
}));
// Admin-verified fallback for Unified Login integrations that do not enumerate through /me/accounts.
// Only a provider ID that the freshly-authorized token can read is accepted.
app.post('/api/connections/instagram/verify-asset',auth,member,admin,asyncRoute(async(req,res)=>{
  const {sessionId,instagramAccountId}=req.body||{};
  if(!/^[-a-f0-9]{36}$/i.test(String(sessionId))||!/^\d{5,30}$/.test(String(instagramAccountId)))throw bad('Valid session and provider Instagram account ID required');
  const {rows}=await pool.query<{encrypted_token:string;permission_metadata:any}>(`select encrypted_token,permission_metadata from connection_sessions where id=$1 and workspace_id=$2 and actor_id=$3 and consumed_at is null and expires_at>now()`,[sessionId,res.locals.workspaceId,res.locals.userId]);
  if(!rows.length)throw bad('Authorization session expired; reconnect',410);
  const {decrypt}=await import('@cherrylink/server');const token=decrypt(rows[0]!.encrypted_token);
  const ig=await graphGet('/'+instagramAccountId,token,{fields:'id,username,account_type'});
  if(String(ig.id)!==String(instagramAccountId)||!ig.username||!['BUSINESS','MEDIA_CREATOR','CREATOR'].includes(String(ig.account_type).toUpperCase()))throw bad('Meta did not verify this professional Instagram account');
  const id=await upsertAccount(res.locals.workspaceId,'INSTAGRAM',instagramAccountId,ig.username,token,'BUSINESS_INTEGRATION',{...rows[0]!.permission_metadata,verifiedVia:'direct_asset'});
  await pool.query('update connection_sessions set consumed_at=UTC_TIMESTAMP(3) where id=$1',[sessionId]);await audit(res.locals.workspaceId,res.locals.userId,'social_account',id,'CONNECTED');res.json({id});
}));

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:150*1024*1024,files:1}});
async function inspectMedia(buffer:Buffer,mime:string){
  if(mime.startsWith('image/')){const meta=await sharp(buffer).metadata();if(!meta.width||!meta.height||meta.width<320||meta.height<320||meta.width>10000||meta.height>10000)throw bad('Image dimensions are unsupported');return {width:meta.width,height:meta.height,duration:null,videoCodec:null,audioCodec:null};}
  // FFprobe reads from stdin; no shell interpolation and no untrusted path.
  const {spawn}=await import('node:child_process');
  return new Promise<{width:number;height:number;duration:number;videoCodec:string|null;audioCodec:string|null}>((resolve,reject)=>{
    const child=spawn('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height:format=duration','-of','json','pipe:0'],{stdio:['pipe','pipe','pipe']});
    let out='';let err='';child.stdout.on('data',(b:Buffer)=>out+=b.toString());child.stderr.on('data',(b:Buffer)=>err+=b.toString());
    child.on('error',()=>reject(bad('FFprobe is not available on the API server',503)));
    child.on('close',(code)=>{if(code!==0)return reject(bad('Video metadata inspection failed'));
      try{const x=JSON.parse(out);const v=x.streams?.find((s:any)=>s.codec_type==='video');const a=x.streams?.find((s:any)=>s.codec_type==='audio');const d=Number(x.format?.duration);
        if(!v?.width||!v?.height||!Number.isFinite(d)||d<3||d>900)throw Error('Invalid video dimensions or duration');
        if(!['h264','hevc'].includes(v.codec_name)|| (a&&a.codec_name!=='aac'))throw Error('Video must be H.264/H.265 with AAC audio');
        resolve({width:v.width,height:v.height,duration:d,videoCodec:v.codec_name,audioCodec:a?.codec_name||null});
      }catch{reject(bad('Unsupported MP4. Encode H.264 with AAC audio.'));}});
    child.stdin.on('error',()=>{});child.stdin.end(buffer);
  });
}
app.post('/api/media',auth,member,upload.single('media'),asyncRoute(async(req,res)=>{
  const f=req.file;if(!f)throw bad('Select an image or MP4 video');
  const sniff=await fileTypeFromBuffer(f.buffer);if(!sniff||!['image/jpeg','image/png','video/mp4'].includes(sniff.mime))throw bad('Only genuine JPEG, PNG or MP4 files are supported');
  let detail=await inspectMedia(f.buffer,sniff.mime);
  let prepared:Buffer|null=null;
  if(sniff.mime.startsWith('image/')){
    prepared=await sharp(f.buffer).rotate().jpeg({quality:88,mozjpeg:true}).toBuffer();
    const m=await sharp(prepared).metadata();detail={...detail,width:m.width||detail.width,height:m.height||detail.height};
  }
  const hash=createHash('sha256').update(f.buffer).digest('hex');const id=randomUUID();const path=`${res.locals.workspaceId}/${id}/original.${sniff.ext==='jpg'?'jpg':sniff.ext==='png'?'png':'mp4'}`;
  const {error}=await supabaseAdmin.storage.from(config.SUPABASE_STORAGE_BUCKET).upload(path,f.buffer,{contentType:sniff.mime,upsert:false});if(error)throw bad('Private media storage unavailable',503);
  const preparedPath=prepared?`${res.locals.workspaceId}/${id}/prepared.jpg`:null;
  if(prepared&&preparedPath){const {error:prepError}=await supabaseAdmin.storage.from(config.SUPABASE_STORAGE_BUCKET).upload(preparedPath,prepared,{contentType:'image/jpeg',upsert:false});if(prepError)throw bad('Image preparation storage unavailable',503);}
  const {rows}=await pool.query(`insert into media_assets(id,workspace_id,storage_path,original_filename,mime_type,size_bytes,width,height,duration_seconds,checksum_sha256,metadata)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,[id,res.locals.workspaceId,path,f.originalname.slice(0,200),sniff.mime,f.size,detail.width,detail.height,detail.duration,hash,JSON.stringify({...detail,prepared_path:preparedPath})]);
  await audit(res.locals.workspaceId,res.locals.userId,'media_asset',id,'UPLOAD');res.status(201).json({id:rows[0]!.id,mime_type:sniff.mime});
}));
app.get('/api/media',auth,member,asyncRoute(async(_req,res)=>{
  const {rows}=await pool.query('select id,original_filename,mime_type,width,height,duration_seconds,created_at from media_assets where workspace_id=$1 order by created_at desc limit 100',[res.locals.workspaceId]);res.json({media:rows});
}));
app.get('/api/media/:id/preview',auth,member,asyncRoute(async(req,res)=>{
  const {rows}=await pool.query<{storage_path:string}>(`select storage_path from media_assets where id=$1 and workspace_id=$2`,[req.params.id,res.locals.workspaceId]);if(!rows.length)throw bad('Media not found',404);
  const {data,error}=await supabaseAdmin.storage.from(config.SUPABASE_STORAGE_BUCKET).createSignedUrl(rows[0]!.storage_path,600);if(error||!data)throw bad('Media preview temporarily unavailable',503);
  res.json({url:data.signedUrl});
}));
app.post('/api/posts',auth,member,asyncRoute(async(req,res)=>{
  const parsed=createPostSchema.safeParse(req.body);if(!parsed.success)throw bad(parsed.error.issues[0]?.message||'Invalid post');
  const p=parsed.data;
  if(p.mediaAssetId){const media=await pool.query<{mime_type:string;width:number;height:number;duration_seconds:string|null}>('select mime_type,width,height,duration_seconds from media_assets where id=$1 and workspace_id=$2 and processing_status=\'READY\'',[p.mediaAssetId,res.locals.workspaceId]);if(!media.rows.length)throw bad('Media is not available in this workspace');}
  const accountRows=p.accountIds.length?await pool.query<{id:string;platform:'FACEBOOK'|'INSTAGRAM'}>(`select id,platform from social_accounts where workspace_id=$1 and connection_status='CONNECTED' and id=any($2::uuid[])`,[res.locals.workspaceId,p.accountIds]):{rows:[]};
  const uniqueIds=new Set(p.accountIds);if(accountRows.rows.length!==uniqueIds.size)throw bad('One or more target accounts are disconnected or inaccessible');
  const media=p.mediaAssetId?await pool.query<{mime_type:string;duration_seconds:string|null;width:number;height:number}>(`select mime_type,duration_seconds,width,height from media_assets where id=$1 and workspace_id=$2`,[p.mediaAssetId,res.locals.workspaceId]):null;
  const asset=media?.rows[0];const mime=asset?.mime_type;
  for(const a of accountRows.rows){
    if(a.platform==='INSTAGRAM'&&!mime)throw bad('Instagram requires image or Reel media');
    if(a.platform==='INSTAGRAM'&&mime?.startsWith('image/')){const ratio=asset!.width/asset!.height;if(ratio<0.8||ratio>1.91)throw bad('Instagram feed images require an aspect ratio between 4:5 and 1.91:1');}
    if(a.platform==='FACEBOOK'&&mime==='video/mp4'){const duration=Number(asset!.duration_seconds),ratio=asset!.width/asset!.height;if(duration<4||duration>60||asset!.width<540||asset!.height<960||Math.abs(ratio-9/16)>0.02)throw bad('Facebook Reels require 9:16 video, at least 540×960, and 4–60 seconds');}
  }
  const scheduled=p.saveDraft?null:p.scheduledAtUtc?new Date(p.scheduledAtUtc):new Date(Date.now()+10000);
  if(scheduled&&scheduled.getTime()<Date.now()-5000)throw bad('Scheduled time cannot be in the past');
  if(scheduled&&scheduled.getTime()>Date.now()+365*24*3600000)throw bad('Schedule within the next 365 days');
  const client=await pool.connect();try{await client.query('begin');
    const post=await client.query<{id:string}>(`insert into posts(workspace_id,created_by,media_asset_id,caption,scheduled_at_utc,timezone,lifecycle_status,content_origin)
      values($1,$2,$3,$4,$5,(select timezone from workspaces where id=$1),$6,$7) returning id`,[res.locals.workspaceId,res.locals.userId,p.mediaAssetId??null,p.caption,scheduled?.toISOString()??null,p.saveDraft?'DRAFT':'SCHEDULED',p.contentOrigin]);
    const postId=post.rows[0]!.id;
    for(const a of accountRows.rows){
      const type=!mime?'TEXT':mime==='video/mp4'?'REEL':'IMAGE';
      const target=await client.query<{id:string}>(`insert into post_targets(post_id,workspace_id,social_account_id,platform,content_type,caption_override,scheduled_at_utc,publishing_status)
        values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[postId,res.locals.workspaceId,a.id,a.platform,type,p.overrides[a.id]??null,(scheduled??new Date()).toISOString(),p.saveDraft?'DRAFT':'SCHEDULED']);
      if(!p.saveDraft)await client.query(`insert into publication_jobs(post_target_id,available_at) values($1,$2)`,[target.rows[0]!.id,scheduled!.toISOString()]);
    }
    await client.query('commit');await audit(res.locals.workspaceId,res.locals.userId,'post',postId,p.saveDraft?'DRAFT_CREATED':'SCHEDULED');res.status(201).json({id:postId});
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}));

app.post('/api/posts/:id/activate-draft',auth,member,asyncRoute(async(req,res)=>{
 const when=req.body?.scheduledAtUtc?new Date(req.body.scheduledAtUtc):null;
 const accountIds=Array.isArray(req.body?.accountIds)?req.body.accountIds:[];
 const caption=String(req.body?.caption??'');
 if(!when||!Number.isFinite(when.getTime())||when.getTime()<Date.now()+5000||when.getTime()>Date.now()+365*86400000)throw bad('Choose a valid future publishing time');
 if(!accountIds.length||accountIds.length>20||accountIds.some((id:any)=>typeof id!=='string'||!/^[-a-f0-9]{36}$/i.test(id)))throw bad('Choose one or more authorized accounts');
 if(caption.length>15000)throw bad('Caption is too long');
 const client=await pool.connect();try{await client.query('begin');
   const post=await client.query<{id:string;lifecycle_status:string;media_asset_id:string|null}>(`select id,lifecycle_status,media_asset_id from posts where id=$1 and workspace_id=$2 for update`,[req.params.id,res.locals.workspaceId]);
   if(!post.rows.length||post.rows[0]!.lifecycle_status!=='DRAFT')throw bad('Only drafts can be activated',409);
   const targetRows=await client.query(`select id from post_targets where post_id=$1 for update`,[req.params.id]);
   const accounts=await client.query<{id:string;platform:string}>(`select id,platform from social_accounts where id=any($1::uuid[]) and workspace_id=$2 and connection_status='CONNECTED'`,[accountIds,res.locals.workspaceId]);
   if(accounts.rows.length!==new Set(accountIds).size)throw bad('Some accounts are no longer connected');
   const media=post.rows[0]!.media_asset_id?await client.query<{mime_type:string;width:number;height:number;duration_seconds:string}>(`select mime_type,width,height,duration_seconds from media_assets where id=$1 and workspace_id=$2`,[post.rows[0]!.media_asset_id,res.locals.workspaceId]):null;
   const asset=media?.rows[0];
   for(const a of accounts.rows){
     if(a.platform==='INSTAGRAM'&&!asset)throw bad('Instagram requires image or Reel media');
     if(a.platform==='INSTAGRAM'&&asset?.mime_type.startsWith('image/')&&(asset.width/asset.height<0.8||asset.width/asset.height>1.91))throw bad('Instagram image aspect ratio must be 4:5 to 1.91:1');
     if(a.platform==='FACEBOOK'&&asset?.mime_type==='video/mp4'&&(Number(asset.duration_seconds)>60||Number(asset.duration_seconds)<4||asset.width<540||asset.height<960||Math.abs(asset.width/asset.height-9/16)>0.02))throw bad('Facebook Reel dimensions or duration are unsupported');
   }
   await client.query('delete from post_targets where post_id=$1',[req.params.id]);
   await client.query(`update posts set lifecycle_status='SCHEDULED',caption=$2,scheduled_at_utc=$3,updated_at=UTC_TIMESTAMP(3) where id=$1`,[req.params.id,caption,when.toISOString()]);
   for(const a of accounts.rows){
     const type=!asset?'TEXT':asset.mime_type==='video/mp4'?'REEL':'IMAGE';
     const {rows}=await client.query<{id:string}>(`insert into post_targets(post_id,workspace_id,social_account_id,platform,content_type,scheduled_at_utc,publishing_status)
       values($1,$2,$3,$4,$5,$6,'SCHEDULED') returning id`,[req.params.id,res.locals.workspaceId,a.id,a.platform,type,when.toISOString()]);
     await client.query(`insert into publication_jobs(post_target_id,available_at) values($1,$2)`,[rows[0]!.id,when.toISOString()]);
   }
   await client.query('commit');await audit(res.locals.workspaceId,res.locals.userId,'post',req.params.id!,'DRAFT_ACTIVATED');res.json({ok:true});
 }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}));
app.get('/api/posts',auth,member,asyncRoute(async(req,res)=>{
  const status=req.query.status;
  const {rows}=await pool.query(`select p.id,p.caption,p.scheduled_at_utc,p.timezone,p.lifecycle_status,p.created_at,p.media_asset_id,
    coalesce(json_agg(json_build_object('id',t.id,'platform',t.platform,'publishing_status',t.publishing_status,'social_account_id',t.social_account_id,'account_name',a.name,'provider_permalink',t.provider_permalink,'last_error_message',t.last_error_message,'published_at',t.published_at) order by t.created_at) filter(where t.id is not null),'[]'::json) targets
    from posts p left join post_targets t on t.post_id=p.id left join social_accounts a on a.id=t.social_account_id
    where p.workspace_id=$1 group by p.id order by coalesce(p.scheduled_at_utc,p.created_at) desc limit 250`,[res.locals.workspaceId]);res.json({posts:rows});
}));
app.patch('/api/posts/:id/reschedule',auth,member,asyncRoute(async(req,res)=>{
  const p=rescheduleSchema.safeParse(req.body);if(!p.success)throw bad('Invalid scheduled UTC datetime');const when=new Date(p.data.scheduledAtUtc);
  if(when.getTime()<Date.now()+5000)throw bad('Choose a time at least 5 seconds in the future');
  const client=await pool.connect();try{await client.query('begin');
    const targets=await client.query<{id:string;publishing_status:string}>(`select t.id,t.publishing_status from post_targets t join posts p on p.id=t.post_id where p.id=$1 and p.workspace_id=$2 for update of t`,[req.params.id,res.locals.workspaceId]);
    if(!targets.rows.length||targets.rows.some(t=>!['SCHEDULED','RETRY_WAIT','READY'].includes(t.publishing_status)))throw bad('Cannot reschedule a started, published, cancelled or uncertain delivery',409);
    await client.query(`update posts set scheduled_at_utc=$1,lifecycle_status='SCHEDULED',updated_at=UTC_TIMESTAMP(3) where id=$2`,[when.toISOString(),req.params.id]);
    await client.query(`update post_targets set scheduled_at_utc=$1,publishing_status='SCHEDULED',updated_at=UTC_TIMESTAMP(3) where post_id=$2`,[when.toISOString(),req.params.id]);
    await client.query(`update publication_jobs set available_at=$1,status='QUEUED',locked_until=null,worker_id=null,updated_at=UTC_TIMESTAMP(3) where post_target_id=any($2::uuid[])`,[when.toISOString(),targets.rows.map(t=>t.id)]);
    await client.query('commit');await audit(res.locals.workspaceId,res.locals.userId,'post',req.params.id!,'RESCHEDULE');res.json({ok:true});
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}));
app.post('/api/posts/:id/cancel',auth,member,asyncRoute(async(req,res)=>{
  const client=await pool.connect();try{await client.query('begin');
    const targets=await client.query<{id:string;publishing_status:string}>(`select t.id,t.publishing_status from post_targets t join posts p on p.id=t.post_id where p.id=$1 and p.workspace_id=$2 for update of t`,[req.params.id,res.locals.workspaceId]);
    const post=await client.query<{lifecycle_status:string}>(`select lifecycle_status from posts where id=$1 and workspace_id=$2 for update`,[req.params.id,res.locals.workspaceId]);
    if(!post.rows.length)throw bad('Post not found',404);
    if(targets.rows.some(t=>['PREPARING','PUBLISHING','UNKNOWN'].includes(t.publishing_status)))throw bad('An in-flight or unknown delivery cannot be safely cancelled',409);
    const remaining=targets.rows.filter(t=>!['PUBLISHED','CANCELLED'].includes(t.publishing_status)).map(t=>t.id);
    if(remaining.length){await client.query(`update post_targets set publishing_status='CANCELLED',updated_at=UTC_TIMESTAMP(3) where id=any($1::uuid[])`,[remaining]);await client.query(`update publication_jobs set status='CANCELLED',updated_at=UTC_TIMESTAMP(3) where post_target_id=any($1::uuid[])`,[remaining]);}
    await client.query(`update posts set lifecycle_status=$1,updated_at=UTC_TIMESTAMP(3) where id=$2`,[targets.rows.some(t=>t.publishing_status==='PUBLISHED')?'PARTIALLY_PUBLISHED':'CANCELLED',req.params.id]);await client.query('commit');
    await audit(res.locals.workspaceId,res.locals.userId,'post',req.params.id!,'CANCEL');res.json({ok:true});
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}));
app.post('/api/targets/:id/retry',auth,member,admin,asyncRoute(async(req,res)=>{
  const client=await pool.connect();try{await client.query('begin');
    const {rows}=await client.query<{id:string;publishing_status:string;connection_status:string}>(`select t.id,t.publishing_status,a.connection_status from post_targets t join social_accounts a on a.id=t.social_account_id where t.id=$1 and t.workspace_id=$2 for update of t`,[req.params.id,res.locals.workspaceId]);
    if(!rows.length||!['FAILED','ACTION_REQUIRED'].includes(rows[0]!.publishing_status)||rows[0]!.connection_status!=='CONNECTED')throw bad('Retry requires a confirmed failed delivery and a connected account',409);
    await client.query(`update post_targets set publishing_status='SCHEDULED',last_error_code=null,last_error_message=null,updated_at=UTC_TIMESTAMP(3) where id=$1`,[req.params.id]);
    await client.query(`insert into publication_jobs(post_target_id,available_at,status) values($1,now(),'QUEUED') on conflict(post_target_id) do update set available_at=now(),status='QUEUED',worker_id=null,locked_until=null`,[req.params.id]);
    await client.query('commit');await audit(res.locals.workspaceId,res.locals.userId,'post_target',req.params.id!,'RETRY_REQUESTED');res.json({ok:true});
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}));
app.get('/api/team',auth,member,asyncRoute(async(_req,res)=>{const {rows}=await pool.query('select user_id,role,created_at from workspace_members where workspace_id=$1 order by created_at',[res.locals.workspaceId]);res.json({members:rows});}));
app.get('/api/operations',auth,member,admin,asyncRoute(async(_req,res)=>{
  const jobs=await pool.query(`select j.status,count(*)::int as count from publication_jobs j join post_targets t on t.id=j.post_target_id where t.workspace_id=$1 group by j.status`,[res.locals.workspaceId]);
  const workers=await pool.query(`select worker_id,last_seen_at,status from worker_heartbeats where last_seen_at>now()-interval '3 minutes'`);
  res.json({jobs:jobs.rows,workers:workers.rows,livePublishingEnabled:config.LIVE_PUBLISHING_ENABLED==='true'});
}));

app.patch('/api/posts/:id/edit',auth,member,asyncRoute(async(req,res)=>{
  const caption=req.body?.caption;if(typeof caption!=='string'||caption.length>15000)throw bad('Caption must be 15,000 characters or less');
  const client=await pool.connect();try{await client.query('begin');
    const {rows}=await client.query<{publishing_status:string}>(`select t.publishing_status from post_targets t join posts p on p.id=t.post_id where p.id=$1 and p.workspace_id=$2 for update of t`,[req.params.id,res.locals.workspaceId]);
    const exists=await client.query(`select id from posts where id=$1 and workspace_id=$2 for update`,[req.params.id,res.locals.workspaceId]);
    if(!exists.rows.length)throw bad('Post not found',404);
    if(rows.some(t=>!['DRAFT','SCHEDULED','RETRY_WAIT','READY'].includes(t.publishing_status)))throw bad('Cannot edit a started or finished publication',409);
    await client.query('update posts set caption=$2,updated_at=UTC_TIMESTAMP(3) where id=$1',[req.params.id,caption]);await client.query('commit');
    await audit(res.locals.workspaceId,res.locals.userId,'post',req.params.id!,'EDIT_CAPTION');res.json({ok:true});
  }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}));
app.get('/api/targets/:id/attempts',auth,member,asyncRoute(async(req,res)=>{
  const {rows}=await pool.query(`select at.attempt_number,at.started_at,at.finished_at,at.provider_operation,at.safe_error_code,at.outcome
    from publication_attempts at join post_targets t on t.id=at.post_target_id where t.id=$1 and t.workspace_id=$2 order by at.attempt_number desc`,[req.params.id,res.locals.workspaceId]);res.json({attempts:rows});
}));
app.post('/api/team/invite',auth,member,admin,asyncRoute(async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase();const role=req.body?.role;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['ADMIN','EDITOR'].includes(role))throw bad('Valid email and role required');
  // Supabase Auth invitations issue an email; do not return or log invite links.
  const {data,error}=await supabaseAdmin.auth.admin.inviteUserByEmail(email,{redirectTo:config.WEB_URL});
  if(error||!data.user)throw bad('Invite could not be issued. For existing members, add them by User ID.',409);
  await pool.query(`insert into workspace_members(workspace_id,user_id,role) values($1,$2,$3) on conflict(workspace_id,user_id) do nothing`,[res.locals.workspaceId,data.user.id,role]);
  await audit(res.locals.workspaceId,res.locals.userId,'workspace_member',data.user.id,'INVITED',{role});res.status(201).json({ok:true});
}));
app.patch('/api/settings',auth,member,admin,asyncRoute(async(req,res)=>{
  const timezone=String(req.body?.timezone||'');
  try{new Intl.DateTimeFormat('en-US',{timeZone:timezone});}catch{throw bad('Invalid IANA timezone');}
  if(timezone.length>80)throw bad('Invalid timezone');
  await pool.query('update workspaces set timezone=$1 where id=$2',[timezone,res.locals.workspaceId]);
  await audit(res.locals.workspaceId,res.locals.userId,'workspace',res.locals.workspaceId,'SET_TIMEZONE',{timezone});res.json({ok:true});
}));
app.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{
  const status=Number(err?.statusCode)|| (err?.code==='LIMIT_FILE_SIZE'?413:500);
  if(status>=500)console.error('[CherryLink API]',{error:err?.name||'Error',code:err?.code||null});
  res.status(status).json({error:{code:err?.code|| (status===500?'INTERNAL_ERROR':'REQUEST_ERROR'),message:status>=500?'Request could not be completed. Try again or contact an admin.':String(err?.message||'Invalid request')}});
});
app.listen(config.API_PORT,()=>console.info(`CherryLink API listening on :${config.API_PORT}`));
