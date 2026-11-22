import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config, Fault, token, verifyPassword } from "./config.mjs";
import { database } from "./db.mjs";
import { knowledge, label, schemas, uuid } from "./knowledge.mjs";
import { formSchema, infer, rates } from "./inference.mjs";

const equal = (left,right) => {
  const a=Buffer.from(left),b=Buffer.from(right);
  return a.length===b.length && timingSafeEqual(a,b);
};
const baseHeaders = {"cache-control":"no-store","x-content-type-options":"nosniff"};
const routes = [];
function add(method,path,access,handler,schema) {
  routes.push({method,path,access,handler,schema,match:new RegExp("^"+path.replace(/\{[\w]+\}/g,"([^/]+)")+"/?$")});
}
const int = (min,max) => z.number().int().min(min).max(max);
const budgetSchema = z.strictObject({daily_tokens:int(1,1e12).nullish(),monthly_tokens:int(1,1e12).nullish()});
const keySchema = budgetSchema.extend({name:label,requests_per_minute:int(1,600).default(30),daily_requests:int(1,100000).default(500)});
const settingsSchema = z.strictObject({model:label,max_output:int(64,1024),context_size:int(1024,32768)});
const credentials = z.strictObject({username:z.string().min(1).max(128),password:z.string().min(1).max(256)});
const cookieName="zorax_session";
const bearer = request=>/^Bearer ([^\s]{1,180})$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
const cookie = request => /(?:^|;\s*)zorax_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(request.headers.get("cookie") || "")?.[1] || "";
const setCookie = (cfg,value,age) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${cfg.production ? "; Secure":""}`;
const ok={ok:true};

async function admin(request,cfg,db) {
  const value=cookie(request);
  const session=value && await db.one("select digest from zorax.sessions where digest=$1 and admin_identity=$2 and expires_at>now()",[cfg.digest("session",value),cfg.username]);
  if (!session) throw new Fault(401,"admin_session_required");
  return session.digest;
}
async function clientKey(request,cfg,db) {
  const value=bearer(request);
  let row;
  if (/^zorax_live_[\w-]{43}$/.test(value)) {
    row=await db.one("select id from zorax.keys where digest=$1 and revoked_at is null",[cfg.digest("key",value)]);
  } else if (/^zorax_ext_[\w-]{43}$/.test(value)) {
    row=await db.one(`select k.id from zorax.extension_credentials c join zorax.keys k on k.id=c.key_id
      where c.digest=$1 and c.kind='access' and c.expires_at>now() and k.revoked_at is null`,[cfg.digest("extension",value)]);
  }
  if (!row) throw new Fault(401,"invalid_api_key");
  return row.id;
}
async function readBody(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json") throw new Fault(415,"json_required");
  if (Number(request.headers.get("content-length"))>65536) throw new Fault(413,"request_too_large");
  const reader=request.body?.getReader();
  if (!reader) throw new Fault(422,"invalid_request");
  let bytes=0;
  const parts=[];
  while (true) {
    const {done,value}=await reader.read();
    if (done) break;
    bytes+=value.length;
    if (bytes>65536) { await reader.cancel(); throw new Fault(413,"request_too_large"); }
    parts.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); } catch { throw new Fault(422,"invalid_request"); }
}

add("GET","/health","public",()=>({status:"ok"}));
add("GET","/ready","probe",async ({db})=>{
  if (!await db.one("select singleton from zorax.settings where singleton and to_regclass('zorax.maintenance') is not null")) throw new Fault(503,"database_not_ready");
  return {status:"ready"};
});
add("POST","/api/admin/login","public",async ({cfg,db,data,headers})=>{
  await db.tx(async tx=>{
    await tx.query("select pg_advisory_xact_lock(4090102)");
    const row=await tx.one("select count(*) as count from zorax.login_attempts where attempted_at>now()-interval '10 minutes'");
    if (row.count>=12) throw new Fault(429,"login_rate_limited","600");
    await tx.query("insert into zorax.login_attempts default values");
  });
  const valid=await verifyPassword(data.password,cfg.password);
  if (!valid || !equal(data.username,cfg.username)) throw new Fault(401,"invalid_credentials");
  const value=token();
  await db.tx(async tx=>{
    await tx.query("insert into zorax.sessions values ($1,$2,now()+interval '8 hours')",[cfg.digest("session",value),cfg.username]);
    await tx.query("insert into zorax.audit (action) values ('login')");
  });
  headers.set("set-cookie",setCookie(cfg,value,28800));
  return {username:cfg.username};
},credentials);
add("GET","/api/admin/session","admin",({cfg})=>({username:cfg.username}));
add("POST","/api/admin/logout","admin",async ({db,cfg,identity,headers})=>{
  await db.query("delete from zorax.sessions where digest=$1",[identity]);
  headers.set("set-cookie",setCookie(cfg,"",0));
  return ok;
});
add("GET","/api/admin/openapi.json","admin",()=>{
  const paths={};
  for (const route of routes) {
    if (route.path.endsWith("/openapi.json")) continue;
    const parameters=[...(route.path.matchAll(/\{([^}]+)\}/g))].map(([,name])=>({in:"path",name,required:true,schema:{type:"string"}}));
    (paths[route.path]??={})[route.method.toLowerCase()]={
      parameters,security:route.access==="admin"?[{session:[]}]:route.access==="key"?[{bearer:[]}]:route.access==="probe"?[{session:[]},{bearer:[]}]:[],
      ...(route.schema && {requestBody:{required:true,content:{"application/json":{schema:z.toJSONSchema(route.schema,{target:"draft-2020-12",io:"input"})}}}}),
      responses:{200:{description:"Success"},400:{description:"Bad request"},401:{description:"Unauthorized"},422:{description:"Invalid input"}},
    };
  }
  return {openapi:"3.1.0",info:{title:"Zorax AI Cloud",version:"2.0.0"},paths,components:{securitySchemes:{
    bearer:{type:"http",scheme:"bearer"},session:{type:"apiKey",in:"cookie",name:cookieName},
  }}};
});

add("GET","/api/v1/profiles","key",({kb,identity})=>kb.extension(identity));
add("GET","/api/admin/knowledge","admin",({kb,query})=>kb.list(z.string().max(100).parse(query.get("q") || "").trim()));
add("POST","/api/admin/knowledge","admin",({kb,data})=>kb.write(data),schemas.create);
add("POST","/api/admin/knowledge/import","admin",({kb,data})=>kb.write(data.profile),schemas.import);
add("GET","/api/admin/knowledge/{id}","admin",({kb,params:[id]})=>kb.detail(uuid.parse(id)));
add("PUT","/api/admin/knowledge/{id}","admin",({kb,data,params:[id]})=>kb.write(data,uuid.parse(id)),schemas.update);
add("DELETE","/api/admin/knowledge/{id}","admin",({kb,query,params:[id]})=>kb.remove(uuid.parse(id),readInt(query.get("version"),1,2147483647)));
add("GET","/api/admin/knowledge/{id}/export","admin",async ({kb,params:[id]})=>({format_version:1,profile:(await kb.detail(uuid.parse(id))).profile}));
add("GET","/api/admin/knowledge/{id}/history","admin",({kb,params:[id]})=>kb.history(uuid.parse(id)));
add("GET","/api/admin/knowledge/{id}/history/{version}","admin",({kb,params:[id,version]})=>kb.revision(uuid.parse(id),readInt(version,1,2147483647)));

for (const [path,access,endpoint] of [["/api/v1/analyze-form","key","analyze-form"],["/api/v1/answer-fields","key","answer-fields"],["/api/admin/playground","admin","playground"]]) {
  add("POST",path,access,async ctx=>{
    const result=await infer(ctx.db,ctx.kb,ctx.cfg,ctx.data,access==="key"?ctx.identity:null,endpoint);
    if (result.warning && access==="key") {
      ctx.status=result.warning.http_status;
      if (result.warning.retry_after) ctx.headers.set("retry-after",result.warning.retry_after);
    }
    return result;
  },formSchema);
}

async function models({cfg,db}) {
  return {models:cfg.models,default:(await db.settings()).model,pricing:rates.filter(row=>cfg.models.includes(row.model))};
}
add("GET","/api/v1/models","key",models);
add("GET","/api/admin/models","admin",models);
const aggregate=`count(*) as requests,count(*) filter(where status='ok') as successful,
  count(*) filter(where status='failed') as failed,count(*) filter(where status='pending') as pending,
  count(*) filter(where needs_ai) as needed_ai,count(*) filter(where route='cloud') as cloud,
  count(*) filter(where route in ('local','cache') and status='ok') as without_ai,
  count(*) filter(where cache_fields>0) as cache_hits,sum(verified_input) as verified_input,
  sum(verified_output) as verified_output,sum(verified_cached_input) as verified_cached_input,
  sum(estimated_input) as estimated_input,sum(estimated_output) as estimated_output,
  sum(coalesce(estimated_input,0)+coalesce(estimated_output,0))
    filter(where estimated_input is not null or estimated_output is not null) as estimated_tokens,
  sum(coalesce(verified_total_tokens,verified_input+verified_output)) as verified_total,
  count(coalesce(verified_total_tokens,verified_input+verified_output)) as verified_complete,
  avg(coalesce(verified_total_tokens,verified_input+verified_output)) as tokens_per_request,
  avg(latency_ms) as average_ms,percentile_cont(.5) within group(order by latency_ms) as p50_ms,
  percentile_cont(.95) within group(order by latency_ms) as p95_ms,sum(estimated_cost) as estimated_cost,count(estimated_cost) as priced_requests`;
function readInt(value,min,max) {
  if (!/^\d+$/.test(value || "")) throw new Fault(422,"invalid_request");
  return int(min,max).parse(Number(value));
}
function utcDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value||"")) throw new Fault(422,"invalid_date_range");
  const date=new Date(value+"T00:00:00.000Z");
  if (isNaN(+date) || date.toISOString().slice(0,10)!==value) throw new Fault(422,"invalid_date_range");
  return date;
}
async function usage({db,query,identity},isKey) {
  const period=z.enum(["24h","7d","30d","custom"]).parse(query.get("period")||"7d");
  const now=new Date(),day=86400000;
  let end=now,start=new Date(+end-({"24h":1,"7d":7,"30d":30}[period]||1)*day);
  if (period==="custom") {
    start=utcDate(query.get("start"));
    const last=utcDate(query.get("end"));
    if (+last<+start || +last>+now || (+last-+start)/day>365) throw new Fault(422,"invalid_date_range");
    end=new Date(+last+day);
  }
  const id=isKey ? identity : query.get("key_id") && uuid.parse(query.get("key_id"));
  const params=[start,end];
  const where="created_at >= $1 and created_at < $2"+(id ? " and key_id=$"+params.push(id) : "");
  const [total,days,models]=await Promise.all([
    db.one(`select ${aggregate} from zorax.requests where ${where}`,params),
    db.all(`select (created_at at time zone 'UTC')::date::text as day,${aggregate} from zorax.requests where ${where} group by 1 order by 1`,params),
    db.all(`select model,provider,${aggregate} from zorax.requests where ${where} and route='cloud' group by model,provider order by requests desc`,params),
  ]);
  return {from:start,until:end,total,days,models,sources:{
    verified:"Token counts reported by Groq or the provider recorded on historical requests.",
    estimated:"Missing counts can use a UTF-8 byte estimate. Estimated USD uses published rates before cache discounts.",
    gateway:"Accepted Zorax requests and wall-clock latency. Dates use UTC.",
    cache_hit_rate:"Share of requests that reused at least one local field mapping.",
    reasoning:"Reasoning tokens are stored when Groq reports them separately.",
  }};
}
add("GET","/api/v1/usage","key",context=>usage(context,true));
add("GET","/api/admin/usage","admin",context=>usage(context,false));
add("GET","/api/admin/requests","admin",({db,query})=>{
  const id=query.get("key_id");
  const limit=readInt(query.get("limit")||"50",1,100), offset=readInt(query.get("offset")||"0",0,100000);
  return db.all(`select r.id,r.key_id,k.name as key_name,r.endpoint,r.created_at,r.status,r.route,r.needs_ai,
    r.model,r.provider,r.provider_model,r.provider_latency_ms,r.provider_attempts,r.verified_input,r.verified_output,
    r.verified_cached_input,r.verified_total_tokens,r.verified_reasoning,r.estimated_input,r.estimated_output,
    r.timings,r.error_code,r.estimated_cost,r.latency_ms,r.local_fields,r.cache_fields,r.field_count,r.done_reason,
    r.provider_created_at,r.cost_assumption from zorax.requests r left join zorax.keys k on k.id=r.key_id
    ${id?"where r.key_id=$3":""} order by r.created_at desc,r.id desc limit $1 offset $2`,id?[limit,offset,uuid.parse(id)]:[limit,offset]);
});
add("GET","/api/admin/audit","admin",({db})=>db.all("select * from zorax.audit order by id desc limit 100"));

add("GET","/api/admin/keys","admin",({db})=>db.all(`select id,name,prefix,requests_per_minute,daily_requests,daily_tokens,monthly_tokens,
  created_at,last_used_at,revoked_at,u.requests,u.verified_input,u.verified_output from zorax.keys k
  left join lateral(select count(*) as requests,sum(verified_input) as verified_input,sum(verified_output) as verified_output
  from zorax.requests r where r.key_id=k.id) u on true order by created_at desc`));
const keyValues = d => [d.name,d.requests_per_minute,d.daily_requests,d.daily_tokens??null,d.monthly_tokens??null];
const keyMissing = () => new Fault(404,"active_key_not_found");
const audit = (db,action,id=null) => db.query("insert into zorax.audit (action,key_id) values ($1,$2)",[action,id]);
add("POST","/api/admin/keys","admin",({db,cfg,data})=>db.tx(async tx=>{
  const key=token("zorax_live_");
  const row=await tx.one(`insert into zorax.keys (name,requests_per_minute,daily_requests,daily_tokens,monthly_tokens,prefix,digest)
    values ($1,$2,$3,$4,$5,$6,$7) returning id,prefix`,[...keyValues(data),key.slice(0,19),cfg.digest("key",key)]);
  await audit(tx,"key_created",row.id);
  return {...row,key};
}),keySchema);
add("PUT","/api/admin/keys/{id}","admin",({db,data,params:[raw]})=>db.tx(async tx=>{
  const id=uuid.parse(raw);
  const row=await tx.one(`update zorax.keys set name=$1,requests_per_minute=$2,daily_requests=$3,daily_tokens=$4,monthly_tokens=$5
    where id=$6 and revoked_at is null returning id`,[...keyValues(data),id]);
  if (!row) throw keyMissing();
  await audit(tx,"key_updated",id);
  return ok;
}),keySchema);
for (const operation of ["rotate","revoke","pair"]) {
  add(operation==="revoke"?"DELETE":"POST","/api/admin/keys/{id}"+(operation==="revoke"?"":"/"+operation),"admin",({db,cfg,params:[raw]})=>db.tx(async tx=>{
    const id=uuid.parse(raw);
    if (!await tx.one("select id from zorax.keys where id=$1 and revoked_at is null for update",[id])) throw keyMissing();
    if (operation==="pair") {
      const code=token("zorax_pair_");
      await tx.query("insert into zorax.extension_credentials (digest,key_id,expires_at,kind) values ($1,$2,now()+interval '5 minutes','pair')",[cfg.digest("extension",code),id]);
      await audit(tx,"pair_created",id);
      return {code,expires_in:300};
    }
    await tx.query("delete from zorax.extension_credentials where key_id=$1",[id]);
    if (operation==="revoke") {
      await tx.query("update zorax.keys set revoked_at=now() where id=$1",[id]);
      await audit(tx,"key_revoked",id);
      return ok;
    }
    const key=token("zorax_live_"),prefix=key.slice(0,19);
    await tx.query("update zorax.keys set digest=$1,prefix=$2 where id=$3",[cfg.digest("key",key),prefix,id]);
    await audit(tx,"key_rotated",id);
    return {id,prefix,key};
  }));
}
add("POST","/api/v1/extension/redeem","public",({db,cfg,data})=>db.tx(async tx=>{
  const digest=cfg.digest("extension",data.code);
  const key=await tx.one(`select k.id from zorax.keys k join zorax.extension_credentials c on c.key_id=k.id
    where c.digest=$1 and k.revoked_at is null for update of k`,[digest]);
  if (!key || !await tx.one(`update zorax.extension_credentials set redeemed_at=now() where digest=$1
    and kind='pair' and redeemed_at is null and expires_at>now() returning key_id`,[digest])) throw new Fault(401,"invalid_pairing_code");
  const access=token("zorax_ext_");
  await tx.query("insert into zorax.extension_credentials (digest,key_id,expires_at,kind) values ($1,$2,now()+interval '1 hour','access')",[cfg.digest("extension",access),key.id]);
  return {access_token:access,token_type:"bearer",expires_in:3600};
}),z.strictObject({code:z.string().regex(/^zorax_pair_[\w-]{43}$/)}));

add("GET","/api/admin/settings","admin",async ({db,cfg})=>({...await db.settings(),groq_configured:!!cfg.groq,retention_days:cfg.retention,concurrency:cfg.concurrency}));
add("PUT","/api/admin/settings","admin",({db,cfg,data})=>db.tx(async tx=>{
  if (!cfg.models.includes(data.model)) throw new Fault(422,"model_not_allowed");
  await tx.query("update zorax.settings set model=$1,max_output=$2,context_size=$3",[data.model,data.max_output,data.context_size]);
  await audit(tx,"settings_updated");
  return ok;
}),settingsSchema);
add("GET","/api/admin/budgets","admin",({db})=>db.one(`select s.daily_tokens,s.monthly_tokens,
  coalesce(sum(case when r.status='pending' then reserved_tokens else budget_charge end)
    filter(where r.created_at>=date_trunc('day',now(),'UTC')),0) as daily_used,
  coalesce(sum(case when r.status='pending' then reserved_tokens else budget_charge end),0) as monthly_used
  from zorax.settings s left join zorax.requests r on r.created_at>=date_trunc('month',now(),'UTC') group by s.singleton`));
add("PUT","/api/admin/budgets","admin",({db,data})=>db.tx(async tx=>{
  await tx.query("update zorax.settings set daily_tokens=$1,monthly_tokens=$2",[data.daily_tokens??null,data.monthly_tokens??null]);
  await audit(tx,"budgets_updated");
  return ok;
}),budgetSchema);

let nextCleanup=0;
export async function dispatch(request) {
  const url=new URL(request.url);
  const headers=new Headers(baseHeaders);
  const method=request.method;
  if (method==="GET" && url.pathname==="/health") return Response.json({status:"ok"},{headers});
  try {
    const cfg=config();
    const origin=request.headers.get("origin");
    if (origin && cfg.origins.includes(origin) && url.pathname.startsWith("/api/v1/")) {
      headers.set("access-control-allow-origin",origin);
      headers.set("vary","Origin");
      headers.set("access-control-allow-methods","GET, POST, OPTIONS");
      headers.set("access-control-allow-headers","Authorization, Content-Type");
    }
    if (method==="OPTIONS") return new Response(null,{status:204,headers});
    if (origin && url.pathname.startsWith("/api/admin/") && method!=="GET"
        && origin!==cfg.origin && !(cfg.production && origin===url.origin)) throw new Fault(403,"invalid_origin");
    const route=routes.find(item=>item.method===method && item.match.test(url.pathname));
    if (!route) throw new Fault(404,"route_not_found");
    const db=database(cfg), kb=knowledge(db,cfg);
    let identity;
    if (route.access==="admin") identity=await admin(request,cfg,db);
    else if (route.access==="key") identity=await clientKey(request,cfg,db);
    else if (route.access==="probe" && !(cfg.monitor && equal(cfg.monitor,bearer(request)))) await admin(request,cfg,db);
    const data=route.schema ? route.schema.parse(await readBody(request)) : undefined;
    if (Date.now()>nextCleanup && route.access!=="public") {
      await db.cleanup();
      nextCleanup=Date.now()+30*60*1000;
    }
    const ctx={request,cfg,db,kb,identity,data,headers,params:route.match.exec(url.pathname).slice(1),query:url.searchParams,status:
      method==="POST" && ["/api/admin/knowledge","/api/admin/knowledge/import"].includes(route.path) ? 201:200};
    const body=await route.handler(ctx);
    return Response.json(body??null,{headers,status:ctx.status});
  } catch (error) {
    if (error instanceof Fault) {
      if (error.retryAfter) headers.set("retry-after",error.retryAfter);
      return Response.json({detail:error.code},{status:error.status,headers});
    }
    if (error instanceof z.ZodError) return Response.json({detail:"invalid_request"},{status:422,headers});
    console.error("Zorax API failure",typeof error?.code==="string" ? error.code : error?.name ?? "UnknownError");
    return Response.json({detail:"database_or_server_unavailable"},{status:503,headers});
  }
}
