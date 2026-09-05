import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
const key = 'brk_test_fixture_only';
const originalKey = process.env.BLOCKRUN_API_KEY;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.BLOCKRUN_API_KEY; else process.env.BLOCKRUN_API_KEY = originalKey; });
async function load() {
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/blockrun-tools.ts', import.meta.url),'utf8'));
  const mod = new vm.SourceTextModule(source);
  await mod.link(async id => {
    if (id === '@sinclair/typebox') return new vm.SyntheticModule(['Type'],function(){ this.setExport('Type',new Proxy({}, {get:()=> x=>x})); });
    if (id === 'bs58') return new vm.SyntheticModule(['default'],function(){ this.setExport('default',{decode(){throw new Error('Wallet must not be touched');}}); });
    if (id === '@solana/web3.js') {
      const names = ['PublicKey','TransactionMessage','TransactionInstruction','VersionedTransaction','Connection','Keypair'];
      return new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,name==='PublicKey'? class {} : class {constructor(){throw new Error('Wallet must not be touched');}});});
    }
    throw new Error(`Unexpected module ${id}`);
  });
  await mod.evaluate(); return mod.namespace;
}
for (const [factory,params,path,payload] of [
  ['createBlockRunModelsTool',{},'/models',{data:[{id:'test'}]}],
  ['createBlockRunChatTool',{model:'test',message:'hello'},'/chat/completions',{model:'test',choices:[{message:{content:'OK'}}]}],
  ['createBlockRunImageTool',{prompt:'blue square'},'/images/generations',{data:[{url:'https://example.test/image.png'}]}],
]) test(`${factory} uses account auth without wallet access`, async () => {
  process.env.BLOCKRUN_API_KEY=key;
  globalThis.fetch=async(url,init)=>{assert.equal(url,`https://api.blockrun.ai/v1${path}`);assert.equal(init.headers.get('authorization'),`Bearer ${key}`);assert.equal(init.headers.get('x-payment'),null);assert.equal(init.redirect,'error');return Response.json(payload);};
  const api=await load(); const result=await api[factory]().execute('test',params); assert.doesNotMatch(result.content[0].text,/failed/i);
});
for(const status of [401,402,429,500]) test(`${status} never replays or touches wallet and redacts key`,async()=>{
  process.env.BLOCKRUN_API_KEY=key;let n=0;
  globalThis.fetch=async()=>{n++;return new Response(key,{status});};
  const api=await load();const result=await api.createBlockRunChatTool().execute('t',{model:'test',message:'hello'});
  assert.match(result.content[0].text,new RegExp(`HTTP ${status}`));assert.ok(!result.content[0].text.includes(key));assert.equal(n,1);
});
test('missing key uses production Solana; malformed key fails before network',async()=>{
  delete process.env.BLOCKRUN_API_KEY;let n=0;
  globalThis.fetch=async url=>{n++;assert.equal(url,'https://sol.blockrun.ai/api/v1/models');return Response.json({data:[]});};
  const api=await load();await api.createBlockRunModelsTool().execute('t',{});assert.equal(n,1);
  process.env.BLOCKRUN_API_KEY='invalid';const r=await api.createBlockRunModelsTool().execute('t',{});assert.match(r.content[0].text,/Invalid BLOCKRUN_API_KEY/);assert.equal(n,1);
});
