import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import pg from "pg";
import { passwordHash, verifyPassword } from "../lib/server/config.mjs";
import { makePool } from "../lib/server/db.mjs";
import { containsSecret, parseProfile, schemas } from "../lib/server/knowledge.mjs";
import { formSchema, groqUsage, identifyNext, navigationSchema, plan } from "../lib/server/inference.mjs";
import { dispatch } from "../lib/server/api.mjs";

test("rejects a Supabase HTTPS project URL before connecting", () => {
  assert.throws(() => makePool("https://demo.supabase.co"), { code:"invalid_database_url" });
});

test("uses the Supabase CA with verified TLS even when the URL sets sslmode", async () => {
  const pool = makePool("postgresql://postgres@aws-0-example.pooler.supabase.com/postgres?sslmode=require", true);
  try {
    const client = new pg.Client(pool.options);
    assert.equal(client.ssl.rejectUnauthorized, true);
    assert.match(client.ssl.ca, /-----BEGIN CERTIFICATE-----/);
    assert.equal(client.ssl.checkServerIdentity, undefined);
  } finally {
    await pool.end();
  }
});

test("accepts the previous scrypt hashes and new Node-generated hashes", async () => {
  const salt = Buffer.alloc(16);
  for (const size of [32,64]) {
    const hash = await passwordHash("sample-password-used-for-tests",salt,size);
    assert(await verifyPassword("sample-password-used-for-tests",hash));
    assert.equal(await verifyPassword("wrong-password",hash),false);
  }
});

test("keeps exact knowledge local and excludes protected fields", () => {
  const form = formSchema.parse({fields:[
    {id:"company",label:"Company name",type:"text"},{id:"ship",label:"Shipping region",type:"select",options:["Western Europe"]},
    {id:"pin",label:"Payment PIN",type:"text"},{id:"missing",label:"Unrelated identifier",type:"text"},
  ]});
  const {result,pending}=plan(form,{business:{company:"Demo Co"},context:"Shipping region: Western Europe"});
  assert.deepEqual(result.fill.map(row=>row.value),["Demo Co","Western Europe"]);
  assert.equal(result.requires_review[0].field_id,"pin");
  assert.equal(result.ask[0].field_id,"missing");
  assert.equal(pending.length,0);
  assert(containsSecret("Key: gsk_"+ "x".repeat(32)));
  assert(containsSecret("4111 1111 1111 1111"));
});

test("chooses the actual loan option using saved facts, equivalent wording and Other", () => {
  const field = (id,label,options) => ({id,label,type:"radio",options});
  const form = formSchema.parse({fields:[
    field("intro","I want to",["Home purchase","Refinance my mortgage","Home equity"]),
    field("goal","Why are you refinancing?",["Take cash out","Reduce my monthly mortgage payment","Other"]),
    field("other","Loan goal",["Take cash out","Switch to a fixed rate","Something else"]),
    field("unknown","Loan purpose",["Take cash out","Switch to a fixed rate"]),
    field("authorization","Credit authorization",["Yes","No"]),
  ]});
  const {result} = plan(form,{context:"I’m exploring loan options. My main goal is to lower my monthly mortgage payment."});
  assert.deepEqual(result.fill.map(({field_id,value})=>[field_id,value]),[
    ["intro","Refinance my mortgage"],["goal","Reduce my monthly mortgage payment"],["other","Something else"],
  ]);
  assert.equal(result.ask.find(row=>row.field_id==="unknown")?.field_id,"unknown");
  assert.equal(result.requires_review.find(row=>row.field_id==="authorization")?.field_id,"authorization");
  const blank = plan(form,{context:"I’m exploring options."}).result;
  assert.equal(blank.fill.length,0);
  const conflicting = plan(form,{context:"Loan goal: Lower my monthly payment\nLoan goal: Take cash out"}).result;
  assert.equal(conflicting.fill.length,0);
});

test("preserves long business descriptions when creating, updating and importing profiles", () => {
  const description = "We help small businesses respond to new inquiries.\n".repeat(70) + "Our service includes scheduling.";
  const input = {name:"Demo",business:{description}};
  assert.equal(schemas.create.parse(input).business.description,description);
  assert.equal(schemas.update.parse({...input,version:1}).business.description,description);
  assert.equal(parseProfile(schemas.import.parse({format_version:1,profile:input}).profile).business.description,description);
  assert.throws(() => parseProfile({name:"Demo",business:{description:"a".repeat(57000)}}), {code:"The profile exceeds the maximum size."});
});

test("matches a generic goal question when its options identify mortgage products", () => {
  const form = formSchema.parse({fields:[{
    id:"goal",label:"What's your goal?",type:"radio",options:["Refinance","Buy a home","Use my equity"],
  }]});
  for (const [goal,expected] of [
    ["Lower my monthly payment","Refinance"], ["Buy a home","Buy a home"], ["Use my equity","Use my equity"],
  ]) {
    const {result} = plan(form,{context:`Loan goal: ${goal}`});
    assert.equal(result.fill[0]?.value,expected);
  }
  assert.equal(plan(form,{context:""}).result.fill.length,0);
  assert.equal(plan(form,{context:"Loan goal: Lower my monthly payment\nLoan goal: Buy a home"}).result.fill.length,0);
  const ordinary = formSchema.parse({fields:[{...form.fields[0],options:["Save time","Learn a skill"]}]});
  assert.equal(plan(ordinary,{context:"Loan goal: Lower my monthly payment"}).result.fill.length,0);
});

test("meters navigation lookup and only returns an in-range control index", async () => {
  const form=navigationSchema.parse({controls:[{label:"proceed",in_step:true}]});
  const charges=[];
  const db={
    settings:async()=>({model:"openai/gpt-oss-20b",max_output:256,context_size:8192}),
    begin:async (...args)=>{assert.deepEqual(args,["key","identify-next",1]);return "request";},
    reserve:async (_id,_key,_model,amount)=>assert(amount>256),
    finish:async (_id,record)=>charges.push(record.budget_charge),
  };
  for (const choice of [0,8,null]) {
    const mock=async (_url,request)=>{
      assert.deepEqual(JSON.parse(JSON.parse(request.body).messages[1].content),form.controls);
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({choice})}}],
        usage:{prompt_tokens:88,completion_tokens:12,total_tokens:100}});
    };
    assert.deepEqual(await identifyNext(db,{groq:"mock"},form,"key",mock),{choice:choice===0?0:null});
  }
  assert.deepEqual(charges,[100,100,100]);
});

test("tracks verified Groq usage without estimating available counts", () => {
  const row=groqUsage({model:"openai/gpt-oss-20b",choices:[{message:{content:'{"m":[]}'},finish_reason:"stop"}],
    usage:{prompt_tokens:42,completion_tokens:9,total_tokens:51,completion_tokens_details:{reasoning_tokens:2},
      prompt_tokens_details:{cached_tokens:4},total_time:.12}},"question",125);
  assert.equal(row.verified_input,42);
  assert.equal(row.verified_total_tokens,51);
  assert.equal(row.verified_reasoning,2);
  assert.equal(row.estimated_output,null);
  assert.equal(row.timings.total_time_seconds,.12);
  assert(groqUsage({choices:[{message:{content:"hello"}}]},"test",10).estimated_input>0);
});

test("migrates, signs in, protects profiles, calls Groq, records usage and revokes keys",{skip:!process.env.TEST_DATABASE_URL},async () => {
  const control=makePool(process.env.TEST_DATABASE_URL);
  const name="zorax_node_"+randomUUID().replaceAll("-","");
  const url=new URL(process.env.TEST_DATABASE_URL);
  url.pathname="/"+name;
  const env={...process.env,DATABASE_URL:url.toString(),ADMIN_USERNAME:"admin",APP_ENV:"development",
    PUBLIC_ORIGIN:"http://127.0.0.1:8000",ZORAX_SECRET:"fixture-scope-secret-for-zorax-node-test",
    ADMIN_PASSWORD_HASH:await passwordHash("sample-password-used-for-tests"),GROQ_API_KEY:"fixture-groq-key"};
  const actualFetch=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    assert.equal(url,"https://api.groq.com/openai/v1/chat/completions");
    assert.equal(options.headers.authorization,"Bearer fixture-groq-key");
    const parsed=JSON.parse(options.body);
    assert.equal(parsed.model,"openai/gpt-oss-20b");
    assert(!parsed.messages[1].content.includes("private answer"));
    return Response.json({model:parsed.model,choices:[{finish_reason:"stop",message:{content:'{"m":[[0,0]]}'}}],
      usage:{prompt_tokens:42,completion_tokens:9,total_tokens:51}});
  };
  try {
    await control.query('create database "'+name+'"');
    for (let i=0;i<2;i++) execFileSync(process.execPath,["scripts/migrate.mjs"],{env,stdio:"pipe"});
    Object.assign(process.env,env);
    let cookie;
    const call=(path,method="GET",body,key)=> dispatch(new Request("http://127.0.0.1:8000"+path,{
      method,headers:{...(cookie&&{cookie}),...(body&&{"content-type":"application/json"}),...(key&&{authorization:"Bearer "+key})},
      body:body ? JSON.stringify(body):undefined,
    }));
    assert.equal((await call("/api/admin/keys")).status,401);
    assert.equal((await call("/api/v1/profiles")).status,401);
    const login=await call("/api/admin/login","POST",{username:"admin",password:"sample-password-used-for-tests"});
    assert.equal(login.status,200);
    cookie=login.headers.get("set-cookie").split(";")[0];
    const docs=await call("/api/admin/openapi.json");
    assert.equal(docs.status,200);
    assert((await docs.json()).paths["/api/v1/analyze-form"].post.requestBody);
    const key=await (await call("/api/admin/keys","POST",{name:"Extension"})).json();
    assert.match(key.key,/^zorax_live_/);
    const profile=await call("/api/admin/knowledge","POST",{name:"Demo",business:{company:"Demo supplied"},
      answers:[{question:"What sustainable packaging materials are offered?",answer:"private answer"}],access_key_ids:[key.id]});
    assert.equal(profile.status,201);
    const {id}=await profile.json();
    const profiles=await (await call("/api/v1/profiles","GET",undefined,key.key)).json();
    assert.deepEqual(profiles.map(row=>row.id),[id]);
    const paired=await (await call("/api/admin/keys/"+key.id+"/pair","POST",{})).json();
    const extension=await (await call("/api/v1/extension/redeem","POST",{code:paired.code})).json();
    assert.match(extension.access_token,/^zorax_ext_/);
    const form={profile_id:id,fields:[{id:"corp",label:"Company name",type:"text"},
      {id:"packing",label:"Describe sustainable packaging materials",type:"textarea"}]};
    const inferred=await call("/api/v1/analyze-form","POST",form,extension.access_token);
    assert.equal(inferred.status,200);
    const body=await inferred.json();
    assert.deepEqual(body.fill.map(row=>row.value),["Demo supplied","private answer"]);
    assert.equal(body.usage.verified_total,51);
    const cached=await (await call("/api/v1/analyze-form","POST",form,extension.access_token)).json();
    assert.equal(cached.usage.route,"cache");
    const usage=await (await call("/api/admin/usage")).json();
    assert.equal(usage.models[0].provider,"groq");
    assert.equal(usage.total.verified_total,51);
    const stored=await (await call("/api/admin/knowledge/"+id+"/export")).json();
    assert.equal(stored.profile.business.company,"Demo supplied");
    assert.equal((await call("/api/admin/keys/"+key.id,"DELETE")).status,200);
    assert.equal((await call("/api/v1/profiles","GET",undefined,extension.access_token)).status,401);
  } finally {
    globalThis.fetch=actualFetch;
    if (globalThis.zoraxDatabase?.pool) await globalThis.zoraxDatabase.pool.end();
    await control.query('drop database if exists "'+name+'"');
    await control.end();
  }
});
