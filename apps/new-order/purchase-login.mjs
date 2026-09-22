import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const requireOld=createRequire(path.resolve(root,'..','legacy-order','package.json'));
const {chromium}=requireOld('playwright-core');
const login=JSON.parse(process.env.NEW_PRODUCT_LOGIN||'null');
if(!login)throw new Error('未获得本次登录信息。');
const browser=await chromium.connectOverCDP('http://127.0.0.1:9333');const context=browser.contexts()[0];let page=context.pages().find(p=>p.url().includes('purchase.valsun.cn'))||await context.newPage();
const target='https://purchase.valsun.cn/index.php?mod=alert&act=usAlert';
await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(700);
// A valid existing SSO session lands directly on the business page; do not look for password controls in that case.
if(page.url().includes('mod=alert&act=usAlert') && (await page.locator('#keyword').count())){
  console.log('采购系统会话已有效，已进入美西仓库料号预警入口。');await browser.close();process.exit(0);
}
const pwd=page.locator('input[type=password]').filter({visible:true}).first();
try{await pwd.waitFor({state:'visible',timeout:15000})}catch{throw new Error(`未进入可填写的 SSO 登录页；当前页面：${page.url()}`)}
const user=page.locator('input:not([type=password]):not([type=hidden])').filter({visible:true}).first();await user.fill(login.username);await pwd.fill(login.password);
const btn=page.locator('#login-btn, input[type=button][value*=登录], input[type=submit], button').filter({visible:true}).first();await btn.click();
for(let i=0;i<8;i++){await page.waitForTimeout(1500);try{await page.goto('https://purchase.valsun.cn/index.php?mod=alert&act=usAlert',{waitUntil:'domcontentloaded',timeout:20000});if(!/sso\.valsun|act=getPcTicket/i.test(page.url())){console.log('采购系统登录成功，已进入美西仓库料号预警入口。');await browser.close();process.exit(0)}}catch{}}
await browser.close();throw new Error('已点击登录，但采购系统会话未就绪。请检查账号、密码、验证码或 SSO 限制。');
