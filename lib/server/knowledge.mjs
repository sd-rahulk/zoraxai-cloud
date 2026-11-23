import { z } from "zod";
import { Fault } from "./config.mjs";

export const normalize = value => value.normalize("NFKC").replace(/([a-z])([A-Z])/g,"$1 $2").toLowerCase()
  .match(/[\p{L}\p{N}\p{M}]+/gu)?.join(" ") || "";
const groups = {
  company:["company name","name of your company","organization","business name","registered company name","legal business name"],
  description:["company description","business description","about your company"], services:["services offered","what services do you offer"],
  email:["email address","work email","your email","business email","company email"],
  phone:["phone number","telephone","tel","mobile number","business phone","company phone"],
  "first name":["given name","forename"],"last name":["family name","surname"],"full name":["name","your name"],
  "contact name":["contact person","primary contact","business contact"],website:["website url","company website","url"],
  "job title":["position","your title"],city:["town","address level2"],"postal code":["zip","zip code","postcode"],
  "employee count":["employees","number of employees","headcount","company size","how many employees work here","how many employees work at your company"],
  location:["business location","company location","headquarters","head office"],"street address":["address","business address","address line 1"],
  region:["state","province","state or province","address level1"],country:["business country","country of operation"],
};
const aliases = new Map(Object.entries(groups).flatMap(([key, values]) => values.map(value => [value,key])));
export const canonical = value => { const clean = normalize(value); return aliases.get(clean) || clean; };
export const sensitive = /\b(passwords?|passcodes?|passphrases?|pin|secrets?|(?:api|private) keys?|tokens?|credentials?|otp|verification code|cvc|cvv|csc|security code|payment|billing|credit card|debit card|card number|cardholder|cc|expiry date|expiration date|one time code|bank|routing number|iban|account number|ssn|social security|consent|agree|authorize|authorization|certify|accept|terms|privacy policy|signature|attest|waiver|opt in)\b/;
export const injection = /\b(ignore|disregard|override|forget)\b.{0,70}\b(instructions|prompt|system|previous|above)\b|\b(system prompt|developer message|assistant message|reveal secrets|exfiltrate)\b/;
const credentialAssignment = /\b(password|passphrase|passcode|pin|api[ _-]?key|private[ _-]?key|secret(?:[ _-]?key)?|(?:access[ _-]?|refresh[ _-]?)?token|aws[ _-]secret[ _-]access[ _-]key|client[ _-]secret|credentials?|otp|one[ _-]time[ _-]code|verification[ _-]?code|cvv|cvc|(?:credit|debit)[ _-]?card|card[ _-]?number|bank[ _-]?account|routing[ _-]?number|iban|ssn|recovery[ _-]?code)\s*(?:[:=]|\bis\b)\s*\S/i;
export function containsSecret(value) {
  const text = String(value).normalize("NFKC");
  if (credentialAssignment.test(text) || /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[a-z0-9_.+/=-]{12,}|\b(?:zorax_(?:live|ext|pair)_|gsk_|sk-(?:proj-)?|gh[pousr]_|github_pat_|xox[baprs]-)[a-z0-9_-]{12,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/i.test(text)) return true;
  for (const [candidate] of text.matchAll(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g)) {
    const digits = [...candidate.replace(/\D/g,"")].reverse().map(Number);
    if (digits.reduce((total,digit,index) => total+(index%2 ? digit*2-(digit>4?9:0):digit),0)%10===0) return true;
  }
  return false;
}

export const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);
export const uuid = z.string().uuid();
export const label = z.string().trim().min(1).max(160);
const profileKey = z.string().regex(/^[\p{L}\p{N}\p{M}_ .-]{1,64}$/u);
const value = z.union([z.string().min(1).max(512),z.number().int(),z.boolean()]);
export const attributes = z.record(profileKey,value);
const businessNames = ["company","contact_name","email","phone","website","description","services","location","street_address","city","region","postal_code","country"];
const business = z.strictObject(Object.fromEntries(businessNames.map(name => [
  name, (name === "description" ? z.string().trim() : z.string().trim().max(512)).optional(),
])));
const profile = z.strictObject({
  name:z.string().trim().min(1).max(80), category:z.string().trim().max(60).default(""),
  business:business.default({}), custom:attributes.default({}),
  answers:z.array(z.strictObject({question:label,answer:z.string().trim().min(1).max(512)})).max(30).default([]),
  context:z.string().max(12000).default(""),
});
const fields = {access_key_ids:z.array(uuid).max(100).default([]),make_default:z.boolean().default(false)};
export const schemas = {create:profile.extend(fields),update:profile.extend({...fields,version:z.number().int().positive()}),
  import:z.strictObject({format_version:z.literal(1),profile})};
export function parseProfile(data) {
  const content = profile.parse(data);
  const custom = Object.keys(content.custom);
  const questions = content.answers.map(row=>row.question);
  const titles = [content.name,...(content.category?[content.category]:[]),...custom,...questions];
  if (titles.some(title=>!normalize(title) || sensitive.test(normalize(title)) || injection.test(normalize(title)))) {
    throw new Fault(422,"Remove credential or instruction labels.");
  }
  if ([...titles,...Object.values(content.business),...Object.values(content.custom),content.context,...content.answers.map(x=>x.answer)].some(containsSecret)) {
    throw new Fault(422,"Remove credentials, payment numbers, or secrets from the profile.");
  }
  const standard = new Set(businessNames.map(canonical));
  const names = custom.map(canonical);
  if (names.some(name=>standard.has(name)) || new Set(names).size!==names.length
      || new Set(questions.map(normalize)).size!==questions.length) throw new Fault(422,"Use distinct custom field names and questions.");
  if (content.business.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.business.email)) throw new Fault(422,"Enter a valid business email.");
  if (content.business.website && !validUrl(content.business.website)) throw new Fault(422,"Enter a valid HTTP or HTTPS website URL.");
  if (custom.length>24 || Buffer.byteLength(JSON.stringify(content))>57000) throw new Fault(422,"The profile exceeds the maximum size.");
  return content;
}
export function validUrl(value) {
  try { const url = new URL(value); return ["http:","https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}

const metadata = "p.id,p.name,p.category,p.is_default,p.version,p.created_at,p.updated_at";
export function knowledge(db,cfg) {
  const key = cfg.encryptionKey;
  const notFound = () => new Fault(404,"knowledge_profile_not_found");
  return {
    list: search => db.all(`select ${metadata} from zorax.knowledge_profiles p
      ${search ? "where strpos(lower(zorax.decrypt_knowledge(p.content,$1)),lower($2))>0" : ""}
      order by p.is_default desc,p.category,lower(p.name)`, search ? [key,search] : []),
    extension: keyId => db.all(`select p.id,p.name,p.is_default from zorax.knowledge_profiles p
      join zorax.knowledge_access a on a.profile_id=p.id
      join zorax.keys k on k.id=a.key_id and k.revoked_at is null
      where a.key_id=$1 order by p.is_default desc,lower(p.name)`,[keyId]),
    async load(id,keyId) {
      const params = [key];
      const scope = id ? "p.id=$"+params.push(id) : "p.is_default";
      const permission = keyId ? ` and exists(select 1 from zorax.knowledge_access a join zorax.keys k on k.id=a.key_id
        where a.profile_id=p.id and k.id=$${params.push(keyId)} and k.revoked_at is null)` : "";
      const row = await db.one(`select p.id,p.version,zorax.decrypt_knowledge(p.content,$1)::json as profile
        from zorax.knowledge_profiles p where ${scope}${permission}`,params);
      if (!row && id) throw notFound();
      return row;
    },
    async detail(id) {
      const row = await db.one(`select ${metadata},zorax.decrypt_knowledge(p.content,$1)::json as profile,
        array(select a.key_id from zorax.knowledge_access a join zorax.keys k on k.id=a.key_id and k.revoked_at is null
        where a.profile_id=p.id order by a.key_id) as access_key_ids from zorax.knowledge_profiles p where p.id=$2`,[key,id]);
      if (!row) throw notFound();
      return row;
    },
    async write(data,id) {
      const {access_key_ids = [],make_default = false,version,...rest} = data;
      const content = parseProfile(rest);
      try {
        return await db.tx(async tx => {
          await tx.query("select pg_advisory_xact_lock(4090103)");
          const current = await tx.one("select id from zorax.knowledge_profiles where is_default");
          const makeDefault = make_default || !current || current.id===id;
          if (makeDefault && current && current.id!==id) await tx.query("update zorax.knowledge_profiles set is_default=false where is_default");
          const params = [content.name,content.category,makeDefault,JSON.stringify(content),key];
          let result;
          if (id) {
            result = await tx.one(`update zorax.knowledge_profiles set name=$1,category=$2,is_default=$3,
              content=zorax.encrypt_knowledge($4,$5),version=version+1,updated_at=now() where id=$6 and version=$7 returning id,version`,[...params,id,version]);
            if (!result) {
              if (!await tx.one("select id from zorax.knowledge_profiles where id=$1",[id])) throw notFound();
              throw new Fault(409,"knowledge_profile_conflict");
            }
          } else {
            if ((await tx.one("select count(*) as total from zorax.knowledge_profiles")).total>=100) throw new Fault(409,"knowledge_profile_limit");
            result = await tx.one(`insert into zorax.knowledge_profiles (name,category,is_default,content)
              values ($1,$2,$3,zorax.encrypt_knowledge($4,$5)) returning id,version`,params);
          }
          await tx.query("insert into zorax.knowledge_revisions (profile_id,version,content) select id,version,content from zorax.knowledge_profiles where id=$1",[result.id]);
          await tx.query("delete from zorax.knowledge_revisions where profile_id=$1 and version <= $2",[result.id,result.version-30]);
          if (id) await tx.query("delete from zorax.knowledge_access where profile_id=$1",[id]);
          const grants = [...new Set(access_key_ids)];
          if (grants.length) {
            const changes = await tx.query(`insert into zorax.knowledge_access (profile_id,key_id)
              select $1,id from zorax.keys where id=any($2::uuid[]) and revoked_at is null`,[result.id,grants]);
            if (changes.rowCount!==grants.length) throw new Fault(422,"knowledge_access_key_invalid");
          }
          await tx.query("insert into zorax.audit (action) values ($1)",[id ? "knowledge_profile_updated":"knowledge_profile_created"]);
          return result;
        });
      } catch (error) {
        if (error.code==="23505") throw new Fault(409,"knowledge_profile_name_taken");
        throw error;
      }
    },
    async remove(id,version) {
      await db.tx(async tx => {
        await tx.query("select pg_advisory_xact_lock(4090103)");
        const row = await tx.one("delete from zorax.knowledge_profiles where id=$1 and version=$2 returning is_default",[id,version]);
        if (!row) {
          if (!await tx.one("select id from zorax.knowledge_profiles where id=$1",[id])) throw notFound();
          throw new Fault(409,"knowledge_profile_conflict");
        }
        if (row.is_default) await tx.query("update zorax.knowledge_profiles set is_default=true where id=(select id from zorax.knowledge_profiles order by created_at,id limit 1)");
        await tx.query("insert into zorax.audit (action) values ('knowledge_profile_deleted')");
      });
      return {ok:true};
    },
    history: id=>db.all("select version,created_at from zorax.knowledge_revisions where profile_id=$1 order by version desc",[id]),
    async revision(id,version) {
      const row = await db.one("select version,created_at,zorax.decrypt_knowledge(content,$1)::json as profile from zorax.knowledge_revisions where profile_id=$2 and version=$3",[key,id,version]);
      if (!row) throw new Fault(404,"knowledge_revision_not_found");
      return row;
    },
  };
}
