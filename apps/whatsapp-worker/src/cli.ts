import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDirectory, readConfig, root, persist } from './config.js';
import { browserDoctor } from './provider.js';
const label='app.ou-soccer.whatsapp', domain=`gui/${process.getuid!()}`, service=`${domain}/${label}`;
const plist=join(homedir(),'Library/LaunchAgents',label+'.plist');
const xml=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const command=process.argv[2]??'status';
function launch(...args:string[]){return spawnSync('/bin/launchctl',args,{stdio:'inherit'}).status??1;}
async function main(){
  if(command==='doctor'){
    let config={};if(existsSync(join(root,'config.json')))config=readConfig();
    console.log(JSON.stringify(await browserDoctor(config),null,2));return;
  }
  if(command==='init'){
    privateDirectory();
    const path=join(root,'config.json');if(existsSync(path))throw new Error('Configuration already exists; edit it privately to replace credentials');
    persist(path,{supabase_url:'https://YOUR-PROJECT.supabase.co',publishable_key:'YOUR-PUBLISHABLE-KEY',worker_id:'FROM-DASHBOARD',token:'FROM-DASHBOARD',port:43821});
    console.log(`Edit ${path}, then run pnpm whatsapp doctor and pnpm whatsapp install.`);return;
  }
  if(command==='pair'){
    const pairing=JSON.parse(readFileSync(join(root,'pairing.json'),'utf8'));
    if(pairing.expires_at<Date.now())throw new Error('Pairing page expired; restart the worker to renew it');
    execFileSync('/usr/bin/open',[pairing.url]);return;
  }
  if(command==='install'){
    if(process.platform!=='darwin')throw new Error('launchd installation requires macOS');
    readConfig();await browserDoctor(readConfig());
    const mainPath=resolve(dirname(fileURLToPath(import.meta.url)),'main.js');
    if(!existsSync(mainPath))throw new Error('Build the worker first');
    mkdirSync(dirname(plist),{recursive:true});
    writeFileSync(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(mainPath)}</string></array>
<key>EnvironmentVariables</key><dict><key>OU_WHATSAPP_HOME</key><string>${xml(root)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${xml(join(root,'worker.log'))}</string><key>StandardErrorPath</key><string>${xml(join(root,'error.log'))}</string>
<key>Umask</key><integer>63</integer></dict></plist>`,{mode:0o600});chmodSync(plist,0o600);
    console.log(`Installed ${plist}. Run pnpm whatsapp start. Automatic messaging remains disabled until activated in the dashboard.`);return;
  }
  if(command==='start'){
    // Rotate service logs before starting. Files stay private under the 0700 directory.
    for(const name of ['worker.log','error.log']){const path=join(root,name);if(existsSync(path)&&statSync(path).size>5_000_000)renameSync(path,path+'.previous');}
    process.exitCode=launch('bootstrap',domain,plist);return;
  }
  if(command==='stop'){process.exitCode=launch('bootout',service);return;}
  if(command==='restart'){const status=spawnSync('/bin/launchctl',['print',service],{stdio:'ignore'}).status;if(status===0 && launch('bootout',service)!==0){process.exitCode=1;return;}
    process.exitCode=launch('bootstrap',domain,plist);return;}
  if(command==='status'){process.exitCode=launch('print',service);return;}
  throw new Error('Commands: init, doctor, install, start, stop, restart, status, pair');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Worker command failed');process.exitCode=1;});
