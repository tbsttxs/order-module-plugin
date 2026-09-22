import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const req=createRequire(path.resolve(root,'..','legacy-order','package.json'));
const {chromium}=req('playwright-core');

const sku=String(process.env.NEW_PRODUCT_SKU||'').trim();
const quantity=Number(process.env.NEW_PRODUCT_QTY||1);
const mode=process.env.NEW_PRODUCT_MODE||'DRY_RUN';
const authorized=process.env.NEW_PRODUCT_AUTHORIZED==='YES';
if(!sku)throw new Error('缺少料号。');
if(!Number.isFinite(quantity)||quantity<=0)throw new Error('数量必须是大于 0 的数字。');
if(mode==='SUBMIT'&&!authorized)throw new Error('正式下单需要显式授权 YES。');

const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');
const context=browser.contexts()[0];
let page=context.pages().find(p=>p.url().includes('purchase.valsun.cn'))||await context.newPage();
const target='https://purchase.valsun.cn/index.php?mod=alert&act=usAlert';
await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(700);
if(!(await page.locator('#keyword').count()))throw new Error(`未进入美西仓库料号预警页面，当前页面：${page.url()}`);

await page.locator('#type').evaluate(e=>{e.value='sku';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));window.layui?.form?.render?.('select')});
await page.locator('#keyword').fill(sku);
await page.getByText('搜索',{exact:true}).filter({visible:true}).first().click();
await page.waitForTimeout(1000);

const records=await page.locator('input[name="inverse"]').evaluateAll((xs,sku)=>xs.map(x=>({sku:x.value,row:(x.closest('tr')?.innerText||'').replace(/\\s+/g,' ').trim(),entity:x.dataset.entityid})).filter(x=>x.sku===sku),sku);
if(records.length!==1)throw new Error(`料号 ${sku} 搜索结果不是唯一条目，实际 ${records.length} 条。`);
const entity=await page.locator('#orderEntity').evaluate(e=>({value:e.value,text:e.selectedOptions?.[0]?.textContent?.trim()||''})).catch(()=>({value:'',text:''}));
const base={sku,quantity,mode,matched:1,entity,record:records[0],url:page.url()};
if(mode==='DRY_RUN'){console.log(JSON.stringify({...base,result:'预检完成',writes:false}));await browser.close();process.exit(0);}

const checkbox=page.locator(`input[name="inverse"][value="${sku}"]`);await checkbox.check();
if(await page.locator('input[name="inverse"]:checked').count()!==1)throw new Error('安全校验失败：未能保证仅勾选当前料号。');
await page.locator('#createPur').click({force:true});
const modal=page.locator('.modal:visible').filter({hasText:'非预警下单'}).first();await modal.waitFor({state:'visible',timeout:10000});
await modal.locator('input[name="operatNote"]').fill('新品');
await modal.locator('#noAlertSubmit').click();await page.waitForTimeout(1000);
const visible=await page.locator('.modal,.layui-layer,.alert').evaluateAll(xs=>xs.filter(x=>{const s=getComputedStyle(x),r=x.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width&&r.height}).map(x=>x.innerText.trim()).filter(Boolean));
const body=(await page.locator('body').innerText()).slice(-5000);
const failure=body.match(new RegExp(`${sku}[^\\n]{0,160}`,'i'))?.[0]||'';
if(/失败|未设置|请先设置|错误/i.test(failure)||/生成采购订单失败/i.test(body))throw new Error(failure||'采购系统未创建订单。');
const success=visible.find(x=>/成功|采购订单号|订单号|生成采购订单/.test(x))||'';
if(!success)throw new Error('提交后未读取到成功结果。');
console.log(JSON.stringify({...base,result:'成功',writes:true,success,visible},null,2));await browser.close();