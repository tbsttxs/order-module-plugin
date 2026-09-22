import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { chromium } from 'playwright-core';
import { beijingNow, resultFileName, writeJson } from './lib/state.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const configPath=path.join(root,'config.json');
if(!fs.existsSync(configPath)) throw new Error('缺少 config.json。请从 config.example.json 复制并填写。');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const mode=process.argv.find(x=>x.startsWith('--mode='))?.split('=')[1]||config.mode||'dry-run';
const permitted=['dry-run','full-production'];
if(!permitted.includes(mode)) throw new Error(`不支持的模式：${mode}`);
if(mode==='full-production' && process.env.PURCHASE_APPROVED!=='YES') throw new Error('生产执行必须使用运行完整下单.cmd；它会显式设置 PURCHASE_APPROVED=YES。');
const runDir=path.join(root,'runs',new Date().toISOString().replace(/[:.]/g,'-')); fs.mkdirSync(path.join(runDir,'screenshots'),{recursive:true});
const xw=XLSX.readFile(config.inputWorkbook,{cellStyles:true}); const sheet=config.sheetName||xw.SheetNames[0]; const xws=xw.Sheets[sheet]||xw.Sheets[xw.SheetNames[0]];
const matrix=XLSX.utils.sheet_to_json(xws,{header:1,defval:null,raw:false}); const headers=matrix[0]||[];
const rows=matrix.slice(1).map((v,i)=>({r:i+2,sku:String(v[0]||'').trim(),qty:Number(v[1])})).filter(x=>x.sku&&x.qty>0);
if(!rows.length) throw new Error('未找到有效任务行（料号 + 正数下单数量）。');
const writeback={},ledger=[];
const now=()=>beijingNow();
function report(step,extra={}){if(config.progressFile){try{writeJson(config.progressFile,{updatedAt:now(),step,...extra})}catch{}}}
function pauseRequested(){return !!config.pauseFile&&fs.existsSync(config.pauseFile)}
function checkpoint(step,item){if(item)item.currentStep=step;report(step,{row:item?.row,sku:item?.sku});if(pauseRequested())throw Object.assign(new Error('用户已手动暂停；已回写当前已完成部分。'),{code:'PAUSED'})}

function update(r,v){writeback[r]={...(writeback[r]||{}),...v};}
function errorText(e){return String(e?.message||e).replace(/\s+/g,' ').slice(0,900);}
async function evidence(page,file){try{const t=page.locator('table tbody').last();await t.screenshot({path:file,timeout:8000,animations:'disabled'});return file;}catch{try{await page.screenshot({path:file,timeout:5000,fullPage:false,animations:'disabled'});return file}catch{return null}}}
async function pageFor(context,part){return context.pages().find(p=>p.url().includes(part));}
async function restoreSession(page){
 if(!/login|sso/i.test(page.url())) return page;
 const saved=config.login;
 report('正在恢复采购系统登录');
 if(saved?.username&&saved?.password){
   // SSO forms differ by deployment; identify the password field first, then choose the nearest usable account input.
   const pass=page.locator('input[type="password"]').first();
   await pass.waitFor({state:'visible',timeout:10000}).catch(()=>{});
   const candidates=page.locator('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="submit"])');
   const n=await candidates.count(); let user=null;
   for(let i=0;i<n;i++){const x=candidates.nth(i);if(await x.isVisible().catch(()=>false)){user=x;break}}
   if(!user||!(await pass.isVisible().catch(()=>false))) throw new Error('采购登录页未识别到账号或密码输入框。');
   await user.fill(saved.username);await pass.fill(saved.password);
   const values=await page.locator('input').evaluateAll(es=>es.map(e=>({type:e.type,value:e.value,visible:!!(e.offsetWidth||e.offsetHeight)})));
   if(!values.some(x=>x.type==='password'&&x.value))throw new Error('采购密码未成功写入登录页。');
 }
 // Prefer actual form submit controls. The SSO page uses a styled clickable login control that is not reliably exposed by role/name.
 const loginCandidates=page.locator('button, input[type="submit"], input[type="button"], a, [role="button"]');
 const count=await loginCandidates.count();let login=null;
 for(let i=0;i<count;i++){const x=loginCandidates.nth(i);const t=((await x.innerText().catch(()=>''))||await x.getAttribute('value').catch(()=>'' )||'').replace(/\s+/g,'');if((/登录|login/i.test(t))&&await x.isVisible().catch(()=>false)){login=x;break}}
 if(!login) throw new Error('已填入账号密码，但未识别到可点击的“登录”按钮。');
 await login.scrollIntoViewIfNeeded().catch(()=>{});await login.click({force:true});report('已点击采购系统登录按钮，等待系统建立会话');
 // The system may complete SSO server-side while the page URL remains a login callback for several seconds.
 // Verify business availability instead of judging URL immediately.
 const demandUrl='https://purchase.valsun.cn/index.php?mod=purchaseDemand&act=index';let restored=false,lastError='';
 for(let attempt=0;attempt<6;attempt++){
   await page.waitForTimeout(2000);
   try{await page.goto(demandUrl,{waitUntil:'domcontentloaded',timeout:15000});
     const demandInput=page.locator('#sku_exact, input[name="sku_exact"], input[placeholder*="料号"]').first();
     if(await demandInput.count()&&await demandInput.isVisible().catch(()=>false)){restored=true;break}
   }catch(e){lastError=String(e?.message||e)}
 }
 if(!restored) throw new Error(saved?.username?`已点击登录按钮，但采购会话在约12秒内未就绪${lastError?`（${lastError.slice(0,120)}）`:''}。请核对账号密码、验证码/SSO限制、网络或账号权限。`:'采购系统登录态已失效，且未提供可用的账号密码。');
 return page;
}
async function demandPage(context,page){
 page=context.pages().find(p=>p.url().includes('purchase.valsun.cn')&&!p.url().includes('act=audit'))||page;
 await restoreSession(page);
 await page.goto('https://purchase.valsun.cn/index.php?mod=purchaseDemand&act=index',{waitUntil:'domcontentloaded',timeout:45000});
 await restoreSession(page); return page;
}
async function ensureSingleAndLocate(page,context,task){
 page=await demandPage(context,page);
 const sku=page.locator('#sku_exact, input[name="sku_exact"], input[placeholder*="料号"]').first(); await sku.waitFor({state:'visible',timeout:15000}); await sku.fill(task.sku);
 const status=page.locator('#status').first(); const opts=await status.locator('option').evaluateAll(os=>os.map(o=>({label:(o.textContent||'').trim(),value:o.value}))); const u=opts.find(x=>x.label.includes('未处理')); if(!u)throw new Error('状态下拉框未找到“未处理”。');
 const applied=await status.evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));try{window.layui?.form?.render('select')}catch{};return el.value},u.value); if(applied!==u.value)throw new Error('未处理状态设置失败。');
 await page.locator('#searchBtn, button:has-text("搜索"), input[value="搜索"]').first().click(); await page.waitForTimeout(700);
 const row=page.locator('table tbody tr').filter({hasText:task.sku}).first(); const text=await row.innerText(); if(!text.includes('未处理'))throw new Error(`第一条结果不是未处理：${text.replace(/\s+/g,' ').slice(0,260)}`);
 const dm=(text.match(/DM\d+/)||[])[0]; if(!dm)throw new Error('未能解析采购需求编号 DM。'); return {page,row,dm,text};
}
async function fullRun(page,context,task,item){
 checkpoint('已定位采购需求',item); const found=await ensureSingleAndLocate(page,context,task); page=found.page; item.dm=found.dm; item.step='需求已定位';
 await found.row.locator('input[name=checkArr]').check({force:true}); if(await page.locator('input[name=checkArr]:checked').count()!==1)throw new Error('未能确保只勾选第一条需求。');
 checkpoint('正在分仓模拟',item); await page.locator('#splitFabon').click(); const sim=page.locator('.layui-layer:visible').filter({hasText:'是否进行工厂柜/DDP订单的分仓模拟'}); await sim.locator('.layui-layer-btn0').click(); await page.waitForTimeout(800);
 await page.locator('#choose-confirmNext').click(); await page.waitForURL(/demandChoose/, {timeout:15000}).catch(()=>{}); await page.waitForTimeout(500); await page.locator('#demandAllocationLink').click(); await page.waitForURL(/pageTag=skuAllowtion/, {timeout:15000}).catch(()=>{}); await page.waitForTimeout(800);
 const qty=page.locator(`input[name=planPurchaseNum][plan-sku="${task.sku}"]`); await qty.waitFor({state:'visible',timeout:15000}); await qty.fill(String(task.qty)); if(Number(await qty.inputValue())!==task.qty)throw new Error('计划采购数写入失败。');
  checkpoint('正在重新分配',item); await page.locator('#rePatchSku').click(); await page.waitForTimeout(5000);
 const allocationRow=page.locator('tr').filter({hasText:task.sku}).last(); const allocation=await allocationRow.innerText(); const planned=Number(await allocationRow.locator(`input[name=planPurchaseNum][plan-sku="${task.sku}"]`).inputValue()); if(!planned||!Number.isFinite(planned))throw new Error('料号分配页未找到有效计划采购数。'); const assigned=await allocationRow.locator('td').nth(6).innerText(); const sum=[...assigned.matchAll(/:(\d+(?:\.\d+)?)/g)].map(x=>Number(x[1])).reduce((a,b)=>a+b,0); if(sum!==task.qty||planned!==task.qty)throw new Error(`分配数量校验失败：计划数 ${planned}，分配合计 ${sum}，目标 ${task.qty}。`); item.allocation=allocation.replace(/\s+/g,' ').trim(); item.step='分配已校验';
 await page.locator('#split-confirmNext').click(); await page.waitForTimeout(3500); const save=page.locator('#save_warehouse_plan'); await save.waitFor({state:'visible',timeout:15000}); await save.click(); await page.waitForTimeout(1200);
 const pnRow=page.locator('table tbody tr').first(); const pnText=await pnRow.innerText(); const pn=(pnText.match(/PN\d+/)||[])[0]; if(!pn||!pnText.includes('待生成计划'))throw new Error('保存分仓方案后未找到待生成的 PN。'); item.pn=pn; checkpoint('正在生成采购计划',item);
 await pnRow.getByText('生成采购计划',{exact:true}).click(); const gen=page.locator('.layui-layer:visible').filter({hasText:'是否生成采购计划'}); await gen.locator('.layui-layer-btn0').click(); await page.waitForTimeout(1200);
 const ppRow=page.locator('table tbody tr').first(); const ppText=await ppRow.innerText(); const pp=(ppText.match(/PP\d+/)||[])[0]; if(!pp||!ppText.includes('待提交'))throw new Error('生成采购计划后未找到待提交的 PP。'); item.pp=pp; checkpoint('正在提交采购计划',item);
 await ppRow.getByText('提交',{exact:true}).click(); const submit=page.locator('.layui-layer:visible').filter({hasText:'是否提交这个采购计划'}); await submit.locator('.layui-layer-btn0').click(); await page.waitForTimeout(900);
 const submitted=await page.locator('table tbody tr').filter({hasText:pp}).first().innerText(); if(!submitted.includes('待审核'))throw new Error('提交后状态未变为待审核。');
 checkpoint('正在审核采购计划',item); const [audit]=await Promise.all([context.waitForEvent('page'),page.locator('table tbody tr').filter({hasText:pp}).first().getByText('审核',{exact:true}).click()]); await audit.waitForLoadState('domcontentloaded').catch(()=>{}); await audit.waitForTimeout(500);
 await audit.locator('input[name=audit_status][value="1"]').check({force:true}); await audit.locator('#audit').click(); const confirm=audit.locator('.layui-layer:visible').filter({hasText:'是否审核这个采购计划'}); await confirm.locator('.layui-layer-btn0').click(); await audit.waitForTimeout(900);
 const list=context.pages().find(p=>p.url().includes('purchaseDemandProject')&&p.url().includes('act=index'))||page; const finalRow=await list.locator('table tbody tr').filter({hasText:pp}).first().innerText(); if(!finalRow.includes('审核通过'))throw new Error('最终状态未回读到审核通过。'); item.finalRow=finalRow.replace(/\s+/g,' ').trim(); item.step='审核通过'; report('本行审核通过',{row:task.r,sku:task.sku,pp});
}
const browser=await chromium.connectOverCDP(config.cdpUrl); const context=browser.contexts()[0]; let page=context.pages().find(p=>p.url().includes('purchase.valsun.cn'))||context.pages()[0]; if(!page)throw new Error('未发现已登录采购系统页面。');
report('开始执行',{total:rows.length}); for(const task of rows){page=context.pages().find(p=>p.url().includes('purchase.valsun.cn')&&!p.url().includes('act=audit'))||page; const item={row:task.r,sku:task.sku,quantity:task.qty,mode,status:'处理中',startedAt:now()}; update(task.r,{执行结果:'处理中',开始时间:item.startedAt,异常说明:''}); try{if(mode==='dry-run'){const r=await ensureSingleAndLocate(page,context,task); page=r.page;item.dm=r.dm;item.firstResult=r.text.replace(/\s+/g,' ').trim();item.status='只读校验通过';update(task.r,{执行结果:'只读校验通过',采购需求编号:r.dm,异常说明:'已定位“精确料号 + 未处理 + 第一条”；未创建采购记录。'});}else{await fullRun(page,context,task,item);item.status='成功';update(task.r,{执行结果:'成功',采购需求编号:item.dm,采购计划号:item.pp,异常说明:'无异常；已完成分仓、生成、提交与审核。'});} }catch(e){item.status=e?.code==='PAUSED'?'已暂停':'异常';item.error=errorText(e);const point=item.currentStep||item.step||'进入采购流程';item.blockPoint=point;update(task.r,{执行结果:item.status,异常说明:`阻塞环节：${point}；原因：${item.error}`});item.screenshot=await evidence(page,path.join(runDir,'screenshots',`row-${task.r}-${task.sku}-exception.png`));}finally{item.endedAt=now();update(task.r,{结束时间:item.endedAt});ledger.push(item); report(item.status==='成功'?'本行完成':item.status==='已暂停'?'任务已暂停':'本行异常',{row:task.r,sku:task.sku,status:item.status}); for(const p of context.pages()){if(p!==page&&p.url().includes('purchase.valsun.cn')&&p.url().includes('act=audit')) await p.close().catch(()=>{});} } if(item.status==='已暂停') break; }
const completedAt=now();
writeJson(path.join(runDir,'run.json'),{mode,completedAt,tasks:ledger});
for(const [rs,vals] of Object.entries(writeback)){const r=Number(rs)-1;for(const [k,v] of Object.entries(vals)){let c=headers.map(x=>String(x||'').trim()).indexOf(k);if(c<0){c=headers.length;headers.push(k);matrix[0][c]=k;}matrix[r]??=[];matrix[r][c]=v;}}
xw.Sheets[sheet]=XLSX.utils.aoa_to_sheet(matrix); const output=path.join(runDir,resultFileName('老品下单')); XLSX.writeFile(xw,output); report('全部完成',{total:rows.length,success:ledger.filter(x=>x.status==='成功').length,failed:ledger.filter(x=>x.status==='异常').length,completedAt,output}); console.log(JSON.stringify({mode,runDir,output,completedAt,ledger},null,2));await browser.close();
