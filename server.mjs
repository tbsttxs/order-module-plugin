import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const root=path.dirname(fileURLToPath(import.meta.url)), legacyRoot=path.join(root,'apps','legacy-order'), requireLegacy=createRequire(path.join(legacyRoot,'package.json')), keytar=requireLegacy('keytar');
const VAULT_SERVICE='sailvan-order-module',VAULT_ACCOUNT='purchase-login';
const services={legacy:{name:'老品下单',port:8787,healthPath:'/api/status',cwd:legacyRoot,script:'server.mjs'},fresh:{name:'新品下单',port:8790,healthPath:'/health',cwd:path.join(root,'apps','new-order'),script:'server.mjs'}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),base=k=>`http://127.0.0.1:${services[k].port}`;
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
async function readJson(req){let raw='';for await(const p of req)raw+=p;if(raw.length>200000)throw Error('请求内容过大');return JSON.parse(raw||'{}')}
async function status(k){const s=services[k];try{const r=await fetch(`${base(k)}${s.healthPath}`,{signal:AbortSignal.timeout(1800)});return {key:k,name:s.name,online:r.ok}}catch{return {key:k,name:s.name,online:false}}}
async function start(k){const s=services[k],before=await status(k);if(before.online)return before;spawn(process.execPath,[s.script],{cwd:s.cwd,detached:true,windowsHide:true,stdio:'ignore'}).unref();for(let i=0;i<20;i++){await sleep(450);const now=await status(k);if(now.online)return now}throw Error(`${s.name}启动超时。`)}
async function credential(){const raw=await keytar.getPassword(VAULT_SERVICE,VAULT_ACCOUNT);return raw?JSON.parse(raw):null}
const server=http.createServer(async(req,res)=>{try{
 if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(path.join(root,'public','index.html')).pipe(res)}
 if(req.method==='GET'&&req.url==='/vendor/xlsx.full.min.js'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});return fs.createReadStream(path.join(legacyRoot,'node_modules','xlsx','dist','xlsx.full.min.js')).pipe(res)}
 if(req.method==='GET'&&req.url==='/download/template'){const file=path.join(root,'下单模块统一任务模板.xlsx');if(!fs.existsSync(file))return json(res,404,{error:'统一任务模板不存在。'});res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''%E4%B8%8B%E5%8D%95%E6%A8%A1%E5%9D%97%E7%BB%9F%E4%B8%80%E4%BB%BB%E5%8A%A1%E6%A8%A1%E6%9D%BF.xlsx",'Cache-Control':'no-store'});return fs.createReadStream(file).pipe(res)}
 if(req.method==='GET'&&req.url==='/health')return json(res,200,{status:'ok',plugin:'order-module',services:await Promise.all(Object.keys(services).map(status))});
 if(req.method==='GET'&&req.url==='/api/account')return json(res,200,{credentialSaved:!!await credential()});
 if(req.method==='POST'&&req.url==='/api/account'){const b=await readJson(req),username=String(b.username||'').trim(),password=String(b.password||'');if(!username||!password)return json(res,400,{error:'请同时填写采购账号和密码。'});if(b.save)await keytar.setPassword(VAULT_SERVICE,VAULT_ACCOUNT,JSON.stringify({username,password}));return json(res,200,{ok:true,saved:!!b.save})}
 if(req.method==='DELETE'&&req.url==='/api/account'){await keytar.deletePassword(VAULT_SERVICE,VAULT_ACCOUNT);return json(res,200,{ok:true})}

 const m=req.url?.match(/^\/api\/run\/(fresh|legacy)$/);if(req.method==='POST'&&m){const variant=m[1],b=await readJson(req);await start(variant);if(variant==='legacy'){if(!b.fileBase64)return json(res,400,{error:'请上传老品下单 Excel 文件。'});const temp=path.join(legacyRoot,'uploads',`${Date.now()}-${String(b.fileName||'任务.xlsx').replace(/[^\w.\-\u4e00-\u9fa5]/g,'_')}`);fs.mkdirSync(path.dirname(temp),{recursive:true});fs.writeFileSync(temp,Buffer.from(b.fileBase64,'base64'));const form=new FormData();form.append('workbook',new Blob([fs.readFileSync(temp)]),path.basename(temp));form.append('mode',b.mode==='full-production'?'full-production':'dry-run');if(b.confirm===true)form.append('confirm','YES');const upstream=await fetch(`${base('legacy')}/api/run`,{method:'POST',body:form});const data=await upstream.json();if(data.id)data.result=`/api/download/legacy/${encodeURIComponent(data.id)}`;try{fs.unlinkSync(temp)}catch{}return json(res,upstream.status,data)}const mode=b.mode==='SUBMIT'?'SUBMIT':'DRY_RUN';if(mode==='SUBMIT'&&b.confirm!==true)return json(res,400,{error:'正式新品下单需要确认真实写入。'});const taskItems=Array.isArray(b.tasks)?b.tasks:[...Array.isArray(b.skus)?b.skus:[]].map(s=>({sku:s,quantity:1}));const upstream=await fetch(`${base('fresh')}/api/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tasks:taskItems,mode,confirm:b.confirm})});const data=await upstream.json();if(data.id)data.result=`/api/download/fresh/${encodeURIComponent(data.id)}`;return json(res,upstream.status,data)}
 const startMatch=req.url?.match(/^\/api\/modules\/(legacy|fresh)\/start$/);if(req.method==='POST'&&startMatch)return json(res,200,await start(startMatch[1]));
 return json(res,404,{error:'not_found'});
}catch(e){return json(res,500,{error:String(e.message||e)})}});
server.listen(8791,'127.0.0.1',()=>console.log('ORDER_MODULE=http://127.0.0.1:8791'));
