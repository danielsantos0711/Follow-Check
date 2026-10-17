// Runs direct-reader.js in a real Chromium page (Playwright) against two layouts of
// Instagram's mobile messages page: rows rendered as links and rows rendered as
// clickable divs. Run: NODE_PATH=$(npm root -g) node tests/direct/direct-reader.browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const reader=fs.readFileSync(new URL('../../FollowCheckIOS/Extension/direct-reader.js',import.meta.url),'utf8');
const row=(inner,attrs='')=>`<div ${attrs} style="display:flex;gap:12px;padding:8px;cursor:pointer"><img src="https://cdn.example/a.jpg" width="56" height="56"><div>${inner}</div></div>`;
const inboxLinks=`<main><header><h1>marta.lisboa</h1></header><div aria-label="Lista de conversas">
 <a href="/direct/t/340282366841710300949128132115679123/">${row('<span style="font-weight:700">Ana Ribeiro</span><br><span style="font-weight:700">Combinado, sexta às 8 · 2 min</span><div aria-label="Não lida" style="width:8px;height:8px"></div>')}</a>
 <a href="/direct/t/340282366841710300949128132115679124/">${row('<span>Studio Norte</span><br><span>Enviaste: obrigado · 1 h</span>')}</a>
</div></main>
<div role="dialog"><p>Ativar notificações?</p><button onclick="this.closest('[role=dialog]').remove()">Agora não</button></div>`;
const inboxRows=`<main><div role="list">
 ${row('<span>João Martins</span><br><span>Viste o filme? · 3 h</span>','role="button" onclick="history.pushState({},\'\',\'/direct/t/987/\');document.body.innerHTML=window.__thread"')}
 ${row('<span>Inês Costa</span><br><span>Gostou de uma mensagem · ontem</span>','role="button"')}
</div></main><nav>${row('<span>Início</span><br><span>Explorar</span>','role="link"')}</nav>`;
const thread=`<main style="display:flex;flex-direction:column;height:800px;width:390px"><header><span>Voltar</span><span>João Martins</span></header>
 <div id="scroller" style="flex:1;overflow:auto"><div style="height:1200px;position:relative">
  <div style="display:flex;justify-content:flex-start;margin:8px"><div dir="auto" style="max-width:60%;background:#eee">Olá! Ainda vens?</div></div>
  <div style="display:flex;justify-content:flex-end;margin:8px"><div dir="auto" style="max-width:60%;background:#3797f0">Sim, claro. Que horas?</div></div>
  <div style="display:flex;justify-content:center;margin:8px"><span dir="auto">12:41</span></div>
  <div style="display:flex;justify-content:flex-start;margin:8px"><div dir="auto" style="max-width:60%">Às 8 no sítio do costume</div></div>
  <div style="display:flex;justify-content:flex-end;margin:8px"><img src="https://cdn.example/photo.jpg" width="160" height="160"></div>
 </div></div>
 <div><div contenteditable="true" role="textbox" id="box" style="min-height:30px" oninput="window.typed=this.innerText"></div><div role="button" onclick="window.sent=document.getElementById('box').innerText">Enviar</div></div>
</main>`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||undefined});
const page=await browser.newPage({viewport:{width:390,height:844}});
async function load(path,html){
  await page.route('https://www.instagram.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}<script>window.__thread=${JSON.stringify(thread)}</script></body></html>`}));
  await page.goto('https://www.instagram.com'+path);await page.addScriptTag({content:reader});await page.unroute('https://www.instagram.com/**');
}
// 1. Links layout
await load('/direct/inbox/',inboxLinks);
let snap=await page.evaluate(()=>__FC_DIRECT__.snapshot());
assert.equal(snap.page,'inbox');assert.equal(snap.threads.length,2);
assert.deepEqual(snap.threads.map(t=>[t.id.slice(-3),t.name,t.snippet,t.time,t.unread]),[['123','Ana Ribeiro','Combinado, sexta às 8','2 min',true],['124','Studio Norte','Enviaste: obrigado','1 h',false]]);
assert.equal(snap.shape.dialogs,0,'the notifications prompt was dismissed');
assert.equal(snap.threads[0].photoURL,'https://cdn.example/a.jpg');
// 2. Row layout (no links): opened by position
await load('/direct/inbox/',inboxRows);
snap=await page.evaluate(()=>__FC_DIRECT__.snapshot());
assert.deepEqual(snap.threads.map(t=>[t.id,t.name,t.snippet,t.time]),[['row:0','João Martins','Viste o filme?','3 h'],['row:1','Inês Costa','Gostou de uma mensagem','ontem']]);
assert.equal(await page.evaluate(()=>__FC_DIRECT__.open('row:0',0)),true);
snap=await page.evaluate(()=>__FC_DIRECT__.snapshot());
assert.equal(snap.page,'thread');assert.equal(snap.threadId,'987');assert.equal(snap.title,'João Martins');assert.equal(snap.canSend,true);
assert.deepEqual(snap.messages.map(m=>[m.text||'[imagem]',m.outgoing]),[['Olá! Ainda vens?',false],['Sim, claro. Que horas?',true],['Às 8 no sítio do costume',false],['[imagem]',true]]);
// 3. Sending types into the page composer and presses its send button
assert.deepEqual(await page.evaluate(()=>__FC_DIRECT__.send('Até já!')),{ok:true});
await page.waitForTimeout(300);
assert.equal(await page.evaluate(()=>window.sent),'Até já!');
assert.deepEqual(await page.evaluate(()=>__FC_DIRECT__.send('   ')),{ok:false,code:'empty'});
await browser.close();
console.log('PASS direct reader: links and rows layouts, prompt dismissal, thread reading, bubble sides and sending');
