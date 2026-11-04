import {config,pool,newId,createMediaUrl,decrypt,graphGet,graphPost,MetaError} from '@cherrylink/server';
import {aggregateStatus,retryDelaySeconds,type PublishingStatus} from '@cherrylink/shared';
import type {DbClient} from '@cherrylink/server';
import {randomUUID} from 'node:crypto';

interface Delivery {
 job_id:string;target_id:string;post_id:string;workspace_id:string;social_account_id:string;platform:'FACEBOOK'|'INSTAGRAM';
 provider_account_id:string;caption:string;caption_override:string|null;content_type:'TEXT'|'IMAGE'|'REEL';provider_container_id:string|null;
 attempt_count:number;media_asset_id:string|null;mime_type:string|null;storage_path:string|null;prepared_path:string|null;connection_status:string;encrypted_token:string|null;
}
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));let shuttingDown=false;
const runtimeWorkerId=config.WORKER_ID+'-'+process.pid+'-'+randomUUID().slice(0,8);
function classify(err:unknown,phase:'preflight'|'nonfinal'|'final'):{status:PublishingStatus;code:string;message:string;delay:number}{
 const e=err instanceof MetaError?err:null;
 const msg=e?`Meta rejected publishing (code ${e.code??'unknown'}).`:(err instanceof Error?err.message.slice(0,160):'Publishing error');
 if(e?.tokenInvalid)return {status:'ACTION_REQUIRED',code:'TOKEN_INVALID',message:'Reconnect Meta account; token expired or permission changed.',delay:0};
 if(phase==='final'&&(e?.uncertain||!e))return {status:'UNKNOWN',code:'PUBLISH_OUTCOME_UNKNOWN',message:'Provider may have published; reconcile before retry.',delay:0};
 if(e?.retryable||(phase!=='final'&&(e?.uncertain||err instanceof TypeError||(err instanceof Error&&/network|abort|timed out/i.test(err.message)))))return {status:'RETRY_WAIT',code:'META_RETRYABLE',message:'Provider temporarily unavailable or rate-limited.',delay:Math.max(e?.retryAfter||0,60)};
 return {status:'FAILED',code:e?'PROVIDER_REJECTED':'INTERNAL_ERROR',message:msg,delay:0};
}
async function claim(client:DbClient):Promise<Delivery|null>{
 await client.query('begin');
 try{
  // MySQL 8.0 InnoDB queue lock: each job can only be claimed by one worker.
  const selected=await client.query<Delivery>(`select j.id job_id,t.id target_id,p.id post_id,p.workspace_id,p.media_asset_id,t.social_account_id,t.platform,
   a.provider_account_id,p.caption,t.caption_override,t.content_type,t.provider_container_id,j.attempt_count,
   m.mime_type,m.storage_path,JSON_UNQUOTE(JSON_EXTRACT(m.metadata,'$.prepared_path')) as prepared_path,
   a.connection_status,c.encrypted_token
   from publication_jobs j join post_targets t on t.id=j.post_target_id join posts p on p.id=t.post_id
   join social_accounts a on a.id=t.social_account_id left join social_account_credentials c on c.social_account_id=a.id
   left join media_assets m on m.id=p.media_asset_id
   where j.status='QUEUED' and j.available_at<=UTC_TIMESTAMP(3) and t.publishing_status in ('SCHEDULED','RETRY_WAIT','READY')
   order by j.available_at,j.id limit 1 for update skip locked`);
  const d=selected.rows[0];if(!d){await client.query('commit');return null;}
  // Atomic lease acquisition: a concurrent worker must NEVER overwrite a valid lease.
  await client.query(`insert into account_publish_leases(social_account_id,worker_id,leased_until)
    values($1,$2,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))
    on duplicate key update
      worker_id=IF(leased_until<UTC_TIMESTAMP(3),values(worker_id),worker_id),
      leased_until=IF(leased_until<UTC_TIMESTAMP(3),values(leased_until),leased_until)`,[d.social_account_id,runtimeWorkerId]);
  const {rows:leases}=await client.query<{worker_id:string}>('select worker_id from account_publish_leases where social_account_id=$1 for update',[d.social_account_id]);
  if(leases[0]?.worker_id!==runtimeWorkerId){await client.query('commit');return null;}
  await client.query(`update publication_jobs set status='RUNNING',locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE),worker_id=$2,attempt_count=attempt_count+1,updated_at=UTC_TIMESTAMP(3) where id=$1`,[d.job_id,runtimeWorkerId]);
  await client.query(`update post_targets set publishing_status='PREPARING',request_stage='PREFLIGHT',updated_at=UTC_TIMESTAMP(3) where id=$1`,[d.target_id]);
  await client.query(`insert into publication_attempts(id,post_target_id,attempt_number,provider_operation,outcome) values($1,$2,$3,'PREFLIGHT','STARTED')`,[newId(),d.target_id,d.attempt_count+1]);
  await client.query('commit');return {...d,attempt_count:d.attempt_count+1};
 }catch(e){await client.query('rollback');throw e;}
}
async function markStage(d:Delivery,stage:string,status:PublishingStatus){
 await pool.query(`update post_targets set request_stage=$2,publishing_status=$3,updated_at=UTC_TIMESTAMP(3) where id=$1 and publishing_status not in ('CANCELLED','PUBLISHED')`,[d.target_id,stage,status]);
 await pool.query('update publication_attempts set provider_operation=$2 where post_target_id=$1 and attempt_number=$3',[d.target_id,stage,d.attempt_count]);
}
async function complete(d:Delivery,status:PublishingStatus,opts:{postId?:string;permalink?:string;containerId?:string;code?:string;message?:string;delaySeconds?:number}={}){
 const client=await pool.connect();
 try{await client.query('begin');
  await client.query(`update post_targets set publishing_status=$2,provider_post_id=coalesce($3,provider_post_id),provider_permalink=coalesce($4,provider_permalink),
    provider_container_id=coalesce($5,provider_container_id),last_error_code=$6,last_error_message=$7,
    published_at=case when $2='PUBLISHED' then UTC_TIMESTAMP(3) else published_at end,request_stage=$8,updated_at=UTC_TIMESTAMP(3) where id=$1`,
   [d.target_id,status,opts.postId??null,opts.permalink??null,opts.containerId??null,opts.code??null,opts.message??null,status]);
  const jobStatus=status==='RETRY_WAIT'?'QUEUED':status==='UNKNOWN'?'UNKNOWN':'DONE';
  await client.query(`update publication_jobs set status=$2,available_at=case when $2='QUEUED' then DATE_ADD(UTC_TIMESTAMP(3),INTERVAL $3 SECOND) else available_at end,
    locked_until=null,worker_id=null,updated_at=UTC_TIMESTAMP(3) where id=$1`,[d.job_id,jobStatus,opts.delaySeconds??0]);
  await client.query('update publication_attempts set finished_at=UTC_TIMESTAMP(3),outcome=$3,safe_error_code=$4 where post_target_id=$1 and attempt_number=$2',[d.target_id,d.attempt_count,status,opts.code??null]);
  await client.query('delete from account_publish_leases where social_account_id=$1 and worker_id=$2',[d.social_account_id,runtimeWorkerId]);
  const {rows}=await client.query<{publishing_status:PublishingStatus}>('select publishing_status from post_targets where post_id=$1',[d.post_id]);
  await client.query('update posts set lifecycle_status=$2,updated_at=UTC_TIMESTAMP(3) where id=$1',[d.post_id,aggregateStatus(rows.map(r=>r.publishing_status))]);
  await client.query('commit');
 }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}
async function signedMediaUrl(d:Delivery){
 if(!d.media_asset_id)throw new Error('MEDIA_NOT_AVAILABLE');
 if(!config.MEDIA_PUBLIC_BASE_URL.startsWith('https://'))throw new Error('MEDIA_NOT_AVAILABLE');
 const variant=d.platform==='INSTAGRAM'&&d.mime_type?.startsWith('image/')?'prepared':'original';
 if(variant==='prepared'&&!d.prepared_path)throw new Error('MEDIA_NOT_AVAILABLE');
 return createMediaUrl(d.media_asset_id,variant,7200);
}
async function safePermalink(platform:'FACEBOOK'|'INSTAGRAM',providerId:string,token:string){
  try{const fields=platform==='FACEBOOK'?'permalink_url':'permalink';const info=await graphGet('/'+providerId,token,{fields});return info[fields] as string|undefined;}catch{return undefined;}
}
async function pollContainer(id:string,token:string){
  for(let i=0;i<16;i++){
    const info=await graphGet('/'+id,token,{fields:'status_code,status'});
    if(info.status_code==='FINISHED')return 'FINISHED';
    if(info.status_code==='PUBLISHED')return 'PUBLISHED';
    if(['ERROR','EXPIRED'].includes(info.status_code))throw new Error('CONTAINER_'+info.status_code);
    await sleep(5000);
  }return 'IN_PROGRESS';
}
async function publishInstagram(d:Delivery,token:string):Promise<void>{
  const caption=d.caption_override??d.caption;let container=d.provider_container_id;
  if(!container){
    const mediaUrl=await signedMediaUrl(d);
    await markStage(d,'INSTAGRAM_CREATE_CONTAINER','PREPARING');
    const params:Record<string,string>=d.content_type==='REEL'?{media_type:'REELS',video_url:mediaUrl,caption,share_to_feed:'true'}:{image_url:mediaUrl,caption};
    const created=await graphPost('/'+d.provider_account_id+'/media',token,params);
    if(!created.id)throw new Error('Instagram did not return a media container ID');
    container=String(created.id);await pool.query('update post_targets set provider_container_id=$2 where id=$1',[d.target_id,container]);
  }
  await markStage(d,'INSTAGRAM_WAIT_READY','PREPARING');const state=await pollContainer(container!,token);
  if(state==='PUBLISHED'){await complete(d,'UNKNOWN',{containerId:container!,code:'ALREADY_PUBLISHED_NEEDS_RECONCILIATION',message:'Container was published; verify its media ID before resolving.'});return;}
  if(state!=='FINISHED'){await complete(d,'RETRY_WAIT',{containerId:container!,code:'MEDIA_PROCESSING',message:'Instagram is still processing the media.',delaySeconds:90});return;}
  await markStage(d,'INSTAGRAM_FINAL_PUBLISH','PUBLISHING');
  let posted:any;try{posted=await graphPost('/'+d.provider_account_id+'/media_publish',token,{creation_id:container!});}
  catch(e){const state=classify(e,'final');await complete(d,state.status,{containerId:container!,code:state.code,message:state.message,delaySeconds:state.delay});return;}
  if(!posted.id){await complete(d,'UNKNOWN',{containerId:container!,code:'MISSING_MEDIA_ID',message:'Publish call returned without a verified published media ID.'});return;}
  const id=String(posted.id);const url=await safePermalink('INSTAGRAM',id,token);
  await complete(d,'PUBLISHED',{postId:id,permalink:url,containerId:container!});
}
async function publishFacebook(d:Delivery,token:string):Promise<void>{
  const caption=d.caption_override??d.caption;
  if(d.content_type==='REEL'){
    // Server-hosted video upload session, from Meta's official Facebook Postman collection.
    let videoId=d.provider_container_id;
    let uploadUrl:string|undefined;
    if(!videoId){
      await markStage(d,'FACEBOOK_REEL_START','PREPARING');const started=await graphPost('/'+d.provider_account_id+'/video_reels',token,{upload_phase:'start'});
      if(!started.video_id)throw new Error('Facebook Reel upload session missing video ID');videoId=String(started.video_id);uploadUrl=started.upload_url;
      await pool.query('update post_targets set provider_container_id=$2 where id=$1',[d.target_id,videoId]);
    }
    // Repeat upload to the SAME unpublished video session after a safe pre-publish retry.
    const mediaUrl=await signedMediaUrl(d);
    const targetUrl=new URL(uploadUrl||`https://rupload.facebook.com/video-upload/${config.META_GRAPH_VERSION}/${videoId}`);
    if(targetUrl.protocol!=='https:'||targetUrl.hostname!=='rupload.facebook.com')throw new Error('Unexpected Facebook upload host');
    await markStage(d,'FACEBOOK_REEL_UPLOAD','PREPARING');
    const response=await fetch(targetUrl,{method:'POST',headers:{Authorization:`OAuth ${token}`,file_url:mediaUrl},signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new MetaError('Facebook Reel upload failed',response.status,null,null,null);
    await markStage(d,'FACEBOOK_REEL_FINAL_PUBLISH','PUBLISHING');
    try{await graphPost('/'+d.provider_account_id+'/video_reels',token,{upload_phase:'finish',video_id:videoId!,video_state:'PUBLISHED',description:caption});}
    catch(e){const state=classify(e,'final');await complete(d,state.status,{containerId:videoId!,code:state.code,message:state.message,delaySeconds:state.delay});return;}
    let observed=false;let link:string|undefined;
    for(let i=0;i<8;i++){
      try{const result=await graphGet('/'+videoId!,token,{fields:'status,permalink_url'});
        const phase=String(result.status?.publishing_phase?.status||'').toLowerCase();
        const video=String(result.status?.video_status||'').toLowerCase();
        if(phase==='complete'||video==='published'){observed=true;link=result.permalink_url;break;}
      }catch{}
      await sleep(5000);
    }
    if(observed){await complete(d,'PUBLISHED',{postId:videoId!,containerId:videoId!,permalink:link});}
    else{await complete(d,'UNKNOWN',{containerId:videoId!,code:'FACEBOOK_REEL_PROCESSING_UNCONFIRMED',message:'Facebook accepted the Reel finish request but final visibility is not confirmed. Reconciliation required.'});}
    return;
  }
  const params:Record<string,string>=d.content_type==='TEXT'?{message:caption,published:'true'}:{url:await signedMediaUrl(d),caption,published:'true'};
  await markStage(d,'FACEBOOK_FINAL_PUBLISH','PUBLISHING');
  let posted:any;try{posted=await graphPost('/'+d.provider_account_id+(d.content_type==='TEXT'?'/feed':'/photos'),token,params);}
  catch(e){const state=classify(e,'final');await complete(d,state.status,{code:state.code,message:state.message,delaySeconds:state.delay});return;}
  const id=String(posted.post_id||posted.id||'');if(!id){await complete(d,'UNKNOWN',{code:'MISSING_PROVIDER_ID',message:'Facebook returned no provider ID after publish.'});return;}
  const link=await safePermalink('FACEBOOK',id,token);await complete(d,'PUBLISHED',{postId:id,permalink:link});
}
async function processDelivery(d:Delivery){
  if(d.connection_status!=='CONNECTED'||!d.encrypted_token){await complete(d,'ACTION_REQUIRED',{code:'ACCOUNT_DISCONNECTED',message:'Reconnect the social account before publishing'});return;}
  let phase:'preflight'|'nonfinal'|'final'='preflight';
  try{
    const token=decrypt(d.encrypted_token);
    if(d.platform==='INSTAGRAM'){phase='nonfinal';await publishInstagram(d,token);}
    else{phase=d.content_type==='REEL'?'nonfinal':'final';await publishFacebook(d,token);}
  }catch(err){
    const msg=err instanceof Error?err.message:'';
    if(msg==='MEDIA_NOT_AVAILABLE'){await complete(d,'RETRY_WAIT',{code:'MEDIA_NOT_AVAILABLE',message:'Media storage could not provide the asset.',delaySeconds:180});return;}
    if(msg.startsWith('CONTAINER_')){await complete(d,'FAILED',{code:msg,message:'Instagram media container failed or expired; this delivery requires review.'});return;}
    // Preserve the last persisted operation stage: errors after a final-publish intent are always ambiguous unless Meta explicitly rejected them.
    const stage=await pool.query<{request_stage:string}>('select request_stage from post_targets where id=$1',[d.target_id]);
    if(stage.rows[0]?.request_stage.includes('FINAL_PUBLISH'))phase='final';
    const x=classify(err,phase);await complete(d,x.status,{code:x.code,message:x.message,delaySeconds:x.status==='RETRY_WAIT'?Math.max(x.delay,retryDelaySeconds(d.attempt_count)):0});
  }
}
async function markOrphansUnknown(){
 const client=await pool.connect();
 try{await client.query('begin');
  const {rows}=await client.query<{id:string;post_target_id:string;worker_id:string|null;social_account_id:string}>(`
   select j.id,j.post_target_id,j.worker_id,t.social_account_id
   from publication_jobs j join post_targets t on t.id=j.post_target_id
   where j.status='RUNNING' and j.locked_until<UTC_TIMESTAMP(3)
   order by j.locked_until limit 20 for update skip locked`);
  for(const r of rows){
   await client.query("update publication_jobs set status='UNKNOWN',worker_id=null,locked_until=null,updated_at=UTC_TIMESTAMP(3) where id=$1",[r.id]);
   await client.query("update post_targets set publishing_status='UNKNOWN',last_error_code='WORKER_LEASE_EXPIRED',last_error_message='Worker stopped during publication. Verify externally before retrying.' where id=$1 and publishing_status<>'PUBLISHED'",[r.post_target_id]);
   await client.query("update publication_attempts set outcome='UNKNOWN',finished_at=UTC_TIMESTAMP(3),safe_error_code='WORKER_LEASE_EXPIRED' where post_target_id=$1 and finished_at is null",[r.post_target_id]);
   await client.query('delete from account_publish_leases where social_account_id=$1 and worker_id=$2',[r.social_account_id,r.worker_id]);
  }
  await client.query('commit');
 }catch(e){await client.query('rollback');throw e;}finally{client.release();}
}
async function reconcileUnknown(){
 const {rows}=await pool.query<{target_id:string;platform:string;provider_container_id:string|null;provider_account_id:string;encrypted_token:string|null}>(`
  select t.id target_id,t.platform,t.provider_container_id,a.provider_account_id,c.encrypted_token
  from post_targets t join social_accounts a on a.id=t.social_account_id
  left join social_account_credentials c on c.social_account_id=a.id
  where t.publishing_status='UNKNOWN' and t.provider_container_id is not null order by t.updated_at limit 10`);
 for(const r of rows){if(!r.encrypted_token||!r.provider_container_id)continue;
  try{
   const token=decrypt(r.encrypted_token);
   if(r.platform==='INSTAGRAM'){
    const state=await graphGet('/'+r.provider_container_id,token,{fields:'status_code'});
    if(state.status_code==='PUBLISHED')await pool.query("update post_targets set last_error_code='IG_CONTAINER_CONFIRMED_PUBLISHED',last_error_message='Container published: determine published media ID manually before resolving.' where id=$1 and publishing_status='UNKNOWN'",[r.target_id]);
   }else{
    const result=await graphGet('/'+r.provider_container_id,token,{fields:'status,permalink_url'});
    if(String(result.status?.publishing_phase?.status||'').toLowerCase()==='complete'||String(result.status?.video_status||'').toLowerCase()==='published'){
     await pool.query("update post_targets set publishing_status='PUBLISHED',provider_post_id=$2,provider_permalink=$3,published_at=UTC_TIMESTAMP(3),last_error_code=null,last_error_message=null where id=$1 and publishing_status='UNKNOWN'",[r.target_id,r.provider_container_id,result.permalink_url||null]);
     await pool.query("update posts set lifecycle_status='PUBLISHED',updated_at=UTC_TIMESTAMP(3) where id=(select post_id from post_targets where id=$1) and not exists(select 1 from post_targets where post_id=(select post_id from post_targets where id=$1) and publishing_status<>'PUBLISHED')",[r.target_id]);
    }
   }
  }catch{/* Unknown remains quarantined; never retry or claim success without provider evidence. */}
 }
}
let reconcileCounter=0;
async function tick(){
 await pool.query("insert into worker_heartbeats(worker_id,last_seen_at,status) values($1,UTC_TIMESTAMP(3),$2) on duplicate key update last_seen_at=UTC_TIMESTAMP(3),status=values(status)",
  [runtimeWorkerId,config.LIVE_PUBLISHING_ENABLED==='true'?'ACTIVE':'DISABLED']);
 if(config.LIVE_PUBLISHING_ENABLED!=='true')return;
 await markOrphansUnknown();if(++reconcileCounter%6===0)await reconcileUnknown();
 const client=await pool.connect();let d:Delivery|null=null;
 try{d=await claim(client);}finally{client.release();}
 if(!d)return;
 const locked=d;
 const timer=setInterval(()=>{(async()=>{
  await pool.query("update publication_jobs set locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE) where id=$1 and worker_id=$2 and status='RUNNING'",[locked.job_id,runtimeWorkerId]);
  await pool.query("update account_publish_leases set leased_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE) where social_account_id=$1 and worker_id=$2",[locked.social_account_id,runtimeWorkerId]);
 })().catch(()=>{});},30000);
 try{await processDelivery(d);}finally{clearInterval(timer);}
}
process.on('SIGTERM',()=>{shuttingDown=true;});process.on('SIGINT',()=>{shuttingDown=true;});
async function main(){
 console.info('CherryLink MySQL worker online',{workerId:runtimeWorkerId,live:config.LIVE_PUBLISHING_ENABLED});
 while(!shuttingDown){try{await tick();}catch(e){console.error('Worker tick failed',{type:e instanceof Error?e.name:'unknown'});}if(!shuttingDown)await sleep(config.WORKER_POLL_MS);}
 await pool.end();
}
main().catch(e=>{console.error('Worker fatal error',e instanceof Error?e.name:'unknown');process.exitCode=1;});
