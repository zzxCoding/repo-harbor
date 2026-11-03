import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url)), load = p => import(pathToFileURL(path.join(root, p)));
const { gitlabFixture } = await load('test/fixture.mjs');
const { startService } = await load('src/server.mjs');
const { Client } = await load('node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
const { StreamableHTTPClientTransport } = await load('node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js');
const exec = promisify(execFile), fixture = await gitlabFixture();
let service, client;
const report = { scenario: '固定提交，256 个合成 Java 文件，12 个检索词与 12 个文件；不包含模型推理和广域网络延迟', runs: [] };
try {
  // 使用本地测试仓库，不接触用户服务器、凭证或业务数据。
  for (let i = 0; i < 256; i++) await fs.writeFile(path.join(fixture.source, `src/Payment${i}.java`), `package example;\npublic class Payment${i} {\n  // 订单费用计算示例\n  public int settlePayment${i}(int amount) { return amount + ${i}; }\n}\n`);
  const git = args => exec('git', ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null',...args], {cwd:fixture.source});
  await git(['add','.']); await git(['commit','-m','synthetic-batch-fixture']); await git(['push','origin','main']);
  process.env.ADMIN_BOOTSTRAP_PASSWORD = 'synthetic-benchmark-password';
  service = await startService({dataDir:path.join(fixture.root,'data'), host:'127.0.0.1', port:0});
  const base = `http://127.0.0.1:${service.port}`; let cookie='';
  async function api(route, method='GET', body) {
    const response = await fetch(`${base}/api/${route}`, {method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
    assert(response.ok, `API status ${response.status}`); return response.json();
  }
  await api('login','POST',{password:process.env.ADMIN_BOOTSTRAP_PASSWORD});
  await api('connection','PUT',{baseUrl:fixture.baseUrl,token:fixture.token,username:'oauth2'});
  const id=(await api('repositories','POST',{projectPath:'team/service'})).added[0];
  const repo=()=>service.store.state.repositories.find(r=>r.id===id);
  const deadline=Date.now()+90000;
  while(!['ready','error'].includes(repo().status)){assert(Date.now()<deadline,'Index timed out');await new Promise(r=>setTimeout(r,100));}
  assert.equal(repo().status,'ready',repo().lastError);
  const grant=await api('access-tokens','POST',{name:'Synthetic benchmark',repositoryIds:[id]});
  const secret=(await api(`access-tokens/${grant.token.id}/secret`)).token;
  client=new Client({name:'batch-baseline',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${secret}`}}}));
  report.tools=(await client.listTools()).tools.map(t=>t.name);
  const parse=result=>{assert(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
  const ids=Array.from({length:12},(_,i)=>i*17), jobs=ids.flatMap(i=>[{name:'search',arguments:{repo:id,query:`settlePayment${i}`,mode:'symbol',limit:5}},{name:'get_file',arguments:{repo:id,file:`src/Payment${i}.java`,limit:80}}]);
  // 先预热，避免将首次建图时间计入检索比较。
  for(const job of jobs) parse(await client.callTool(job));
  const countsBefore={...fixture.counters}, expectedContent=new Map();
  for(let round=0;round<3;round++) {
    for(const concurrency of [1,4]) {
      const started=performance.now();let cursor=0, bytes=0;const latencies=[];
      await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<jobs.length){const job=jobs[cursor++],t=performance.now();const result=parse(await client.callTool(job));latencies.push(performance.now()-t);bytes+=Buffer.byteLength(JSON.stringify(result));if(job.name==='get_file'){assert(result.text.includes('package example;'));expectedContent.set(job.arguments.file,result.content);}else assert(result.results.length>0);}}));
      latencies.sort((a,b)=>a-b);
      report.runs.push({round,mode:`mcp-concurrency-${concurrency}`,calls:jobs.length,totalMs:Math.round(performance.now()-started),p50Ms:Math.round(latencies[Math.floor(latencies.length*.5)]),p95Ms:Math.round(latencies[Math.floor(latencies.length*.95)]),responseBytes:bytes});
    }
    // 批量工具与旧接口读取同一份文件内容；比较调用数，不假设语义搜索与字面匹配等价。
    const batchStart=performance.now();
    const matched=parse(await client.callTool({name:'grep',arguments:{repo:id,patterns:ids.map(i=>`settlePayment${i}(`),include:['src/*.java'],context:0}}));
    assert.equal(matched.results.length,ids.length);assert.equal(matched.truncated,false);
    const batch=parse(await client.callTool({name:'get_files',arguments:{repo:id,files:matched.results.map(row=>({file:row.file,limit:80}))}}));
    assert.equal(batch.results.length,ids.length);assert.equal(batch.truncated,false);
    for(const file of batch.results) assert.equal(file.content,expectedContent.get(file.file));
    report.runs.push({round,mode:'mcp-bulk',calls:2,totalMs:Math.round(performance.now()-batchStart),responseBytes:Buffer.byteLength(JSON.stringify(matched)+JSON.stringify(batch)),verifiedSourceFiles:batch.results.length});
    const started=performance.now();
    const searched=await exec('rg',['-n','-F',...ids.flatMap(i=>['-e',`settlePayment${i}(`]),'src'],{cwd:repo().current.root});
    assert(searched.stdout.includes('settlePayment0'));
    const files=await Promise.all(ids.map(i=>fs.readFile(path.join(repo().current.root,`src/Payment${i}.java`),'utf8')));assert(files.every(s=>s.includes('package example;')));
    report.runs.push({round,mode:'local-rg-plus-read',processes:1,totalMs:Math.round(performance.now()-started),responseBytes:Buffer.byteLength(searched.stdout+files.join('\n'))});
  }
  for(const job of [{name:'explore',arguments:{repo:id,query:'settlePayment0',includeSource:true}},{name:'packet_get',arguments:{repo:id,target:'src/Payment0.java'}}]){
    const started=performance.now(),result=parse(await client.callTool(job));report.runs.push({mode:job.name,totalMs:Math.round(performance.now()-started),responseBytes:Buffer.byteLength(JSON.stringify(result)),keys:Object.keys(result)});
  }
  report.hostingCallsDuringQueries=Object.fromEntries(Object.keys(countsBefore).map(k=>[k,fixture.counters[k]-countsBefore[k]]));
  report.batchCapability=report.tools.some(n=>/batch|get_files|search_many/.test(n))?'present':'absent';
  const output=path.resolve(process.argv[2] || path.join(root,'test/evidence/batch-benchmark.json'));
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await client?.close();await service?.close();await fixture.close();}
