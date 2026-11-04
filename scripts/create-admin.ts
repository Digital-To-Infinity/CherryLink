import {pool,createUser} from '@cherrylink/server';
const email=String(process.env.CHERRYLINK_ADMIN_EMAIL||'').trim().toLowerCase();
const password=String(process.env.CHERRYLINK_ADMIN_PASSWORD||'');
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12){
 console.error('Set CHERRYLINK_ADMIN_EMAIL and CHERRYLINK_ADMIN_PASSWORD (minimum 12 characters) as temporary environment variables.');
 process.exit(1);
}
try{
 const {rows}=await pool.query('select id from users where email=$1',[email]);
 if(rows.length){console.error('Email is already registered. No password was changed.');process.exitCode=1;}
 else{const id=await createUser(email,password);console.log('CherryLink administrator login created:',email,id);}
}catch(e){console.error('Admin creation failed: check MySQL credentials and import the schema.');process.exitCode=1;}
finally{await pool.end();}
