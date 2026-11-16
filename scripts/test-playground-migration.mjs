#!/usr/bin/env node
// Isolated PostgreSQL-WASM test. NEVER uses DATABASE_URL or application secrets.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const migration = await readFile(resolve(import.meta.dirname, '../supabase/migrations/20261116_playground_mode.sql'), 'utf8');
const db = new PGlite('memory://playground-migration-test');
const a = 'fixture_tenant_a';
const b = 'fixture_tenant_b';
const opA = '00000000-0000-4000-8000-000000000001';
const opB = '00000000-0000-4000-8000-000000000002';
const opC = '00000000-0000-4000-8000-000000000003';
const shift = '2026-11-15T22:00:00.000Z';
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
async function launch(tenant, request, table, child, operator = opA, order = null) {
  const r = await db.query('SELECT public.playground_add_entry($1,$2,$3,$4,$5::uuid,$6,$7,$8::timestamptz) AS result', [tenant, request, table, child, operator, 'untrusted browser name', order, shift]);
  return r.rows[0].result;
}
async function expectFailure(fn, pattern) { await assert.rejects(fn, pattern); }
async function setConfig(tenant, patch) {
  await db.query('UPDATE public.config SET data=data || $1::jsonb WHERE id=$2', [JSON.stringify(patch), `${tenant}:pizzaria`]);
}
async function denyRole(role, sql) {
  await db.exec(`SET ROLE ${role}`);
  try { await assert.rejects(() => db.query(sql), /permission denied/i); }
  finally { await db.exec('RESET ROLE'); }
}
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.config(id text PRIMARY KEY, tenant_id text NOT NULL, data jsonb NOT NULL DEFAULT '{}');
    CREATE TABLE public.tables(tenant_id text NOT NULL, id integer NOT NULL, status text DEFAULT 'free', current_order text, linked_to integer, PRIMARY KEY(tenant_id,id));
    CREATE TABLE public.comandas(LIKE public.tables INCLUDING ALL);
    CREATE TABLE public.orders(id text NOT NULL, tenant_id text NOT NULL, table_id text, waiter_id text, waiter_name text, status text DEFAULT 'pending', is_comanda boolean DEFAULT false, timestamp timestamptz DEFAULT now(), items jsonb DEFAULT '[]', payment_log jsonb DEFAULT '[]', delivery_log jsonb DEFAULT '[]', PRIMARY KEY(tenant_id,id));
    CREATE TABLE public.waiters(id text PRIMARY KEY,tenant_id text,name text,password text);
    CREATE TABLE public.menu(id text PRIMARY KEY,tenant_id text,name text,items jsonb DEFAULT '[]');
    GRANT ALL ON public.config,public.tables,public.comandas,public.orders,public.waiters,public.menu TO anon,authenticated,service_role;
  `);
  for (const tenant of [a,b]) {
    await db.query('INSERT INTO public.config VALUES($1,$2,$3)', [`${tenant}:pizzaria`,tenant,JSON.stringify({parquinhoEnabled:true,parquinhoChildNameRequired:true,parquinhoPrice:25})]);
    await db.query('INSERT INTO public.config VALUES($1,$2,$3)', [`${tenant}:app`,tenant,JSON.stringify({isCashRegisterOpen:true,shiftStartedAt:shift})]);
    await db.query('INSERT INTO public.tables(tenant_id,id) VALUES($1,1),($1,2),($1,3)', [tenant]);
    await db.query('INSERT INTO public.orders(id,tenant_id,table_id,items) VALUES($1,$2,$3,$4)', ['food-order',tenant,'1',JSON.stringify([{id:'food',name:'Fictitious sandwich',type:'lanches',price:7,quantity:1}])]);
    await db.query('UPDATE public.tables SET status=$1,current_order=$2 WHERE tenant_id=$3 AND id=1', ['occupied','food-order',tenant]);
  }
  await check('migration is additive and idempotent', async () => {
    await db.exec(migration); await db.exec(migration);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM orders')).rows[0].n), 2);
    const rls = await db.query("SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('parquinho_entries','parquinho_operators')");
    assert.equal(rls.rows.length,2); assert.ok(rls.rows.every(r=>r.relrowsecurity));
  });
  for (const [id,tenant,name,status] of [[opA,a,'Operator A','approved'],[opB,a,'Operator B','approved'],[opC,b,'Operator A','approved']]) {
    await db.query('INSERT INTO parquinho_operators(id,tenant_id,name,password_hash,status,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,id) DO UPDATE SET status=EXCLUDED.status', [id,tenant,name,'fictitious-hash',status,'playground_operator']);
  }
  await check('operator upsert supports its actual conflict target and same name across tenants', async()=> {
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM parquinho_operators')).rows[0].n),3);
  });
  let first;
  await check('transaction appends Parquinho to the ordinary food account without duplicating food',async()=> {
    first = await launch(a,'r1',1,'  Child A  ');
    assert.equal(first.order.id,'food-order'); assert.equal(first.order.items.length,2);
    assert.equal(first.order.items[0].name,'Fictitious sandwich');
    assert.equal(first.item.quantity,1); assert.equal(Number(first.item.price),25);
    assert.equal(first.item.type,'outros'); assert.equal(first.item.operatorName,'Operator A');
    assert.equal(first.entry.child_name,'Child A'); assert.equal(first.item.observations,'Criança: Child A');
    assert.deepEqual(first.item.flavors,[]); assert.deepEqual(first.item.extras,[]);
    assert.equal(first.item.menuItemId,`parquinho:${a}`);
    assert.equal(first.order.items.reduce((sum,i)=>sum+Number(i.price),0),7+25);
  });
  await check('lost ACK retry returns the same entry and ignores subsequent price change',async()=> {
    await setConfig(a,{parquinhoPrice:40});
    const retry=await launch(a,'r1',1,'Child A'); assert.equal(retry.entry.id,first.entry.id);
    assert.equal(Number(retry.entry.total_price),25); assert.equal(retry.order.items.length,2);
  });
  await check('idempotency key cannot be reused for another child/table/operator',async()=> {
    await expectFailure(()=>launch(a,'r1',1,'Other child'),/requestId/);
    await expectFailure(()=>launch(a,'r1',2,'Child A'),/requestId/);
    await expectFailure(()=>launch(a,'r1',1,'Child A',opB),/requestId/);
  });
  await check('second operator appends a distinct child to the same account using current configured price',async()=> {
    const second=await launch(a,'r2',1,'Child B',opB); assert.equal(second.order.id,'food-order');
    assert.equal(second.order.items.length,3); assert.equal(second.entry.operator_id,opB);
    assert.equal(Number(second.entry.total_price),40);
  });
  await check('required child name rejects spaces without modifying either ledger or account',async()=> {
    const before=(await db.query('SELECT items FROM orders WHERE tenant_id=$1 AND id=$2',[a,'food-order'])).rows[0].items;
    await expectFailure(()=>launch(a,'empty',1,' \t\n '),/Nome da criança/);
    assert.deepEqual((await db.query('SELECT items FROM orders WHERE tenant_id=$1 AND id=$2',[a,'food-order'])).rows[0].items,before);
  });
  await check('tenant and operator approval are validated in SQL',async()=> {
    await expectFailure(()=>launch(b,'foreign',1,'Child A',opA),/Operador não aprovado/);
    await db.query("UPDATE parquinho_operators SET status='inactive' WHERE id=$1",[opB]);
    await expectFailure(()=>launch(a,'inactive',1,'Child B',opB),/Operador não aprovado/);
    await db.query("UPDATE parquinho_operators SET status='approved' WHERE id=$1",[opB]);
    const foreign=await launch(b,'r1',1,'Child C',opC); assert.equal(foreign.entry.tenant_id,b);
  });
  await check('null price blocks launches, while explicit zero and optional name are valid',async()=> {
    await setConfig(a,{parquinhoPrice:null});
    await expectFailure(()=>launch(a,'null-price',2,'Child'),/não configurado/);
    await setConfig(a,{parquinhoPrice:0,parquinhoChildNameRequired:false});
    const free=await launch(a,'zero-price',2,'   '); assert.equal(Number(free.entry.total_price),0); assert.equal(free.entry.child_name,null);
  });
  await check('negative price is rejected before rounding',async()=> {
    await setConfig(a,{parquinhoPrice:-0.001});
    await expectFailure(()=>launch(a,'negative',3,'Child'),/inválido/);
    await setConfig(a,{parquinhoPrice:25});
  });
  await check('disabled module blocks new entries but preserves existing records and retry receipts',async()=> {
    const count=Number((await db.query('SELECT count(*) n FROM parquinho_entries')).rows[0].n);
    await setConfig(a,{parquinhoEnabled:false});
    await expectFailure(()=>launch(a,'disabled',3,'Child'),/desativado/);
    assert.equal((await launch(a,'r1',1,'Child A')).entry.id,first.entry.id);
    assert.equal(Number((await db.query('SELECT count(*) n FROM parquinho_entries')).rows[0].n),count);
    await setConfig(a,{parquinhoEnabled:true});
  });
  await check('linked tables remain linked instead of being silently separated',async()=> {
    await db.query("UPDATE tables SET status='linked',linked_to=1 WHERE tenant_id=$1 AND id=3",[a]);
    await expectFailure(()=>launch(a,'linked',3,'Child'),/unificada/);
    assert.equal((await db.query('SELECT linked_to FROM tables WHERE tenant_id=$1 AND id=3',[a])).rows[0].linked_to,1);
    await db.query("UPDATE tables SET status='free',linked_to=NULL WHERE tenant_id=$1 AND id=3",[a]);
  });
  await check('paid item remains auditable and finalization preserves history with finalized status',async()=> {
    const r=(await db.query('SELECT items FROM orders WHERE tenant_id=$1 AND id=$2',[a,'food-order'])).rows[0];
    const items=r.items.map(i=>i.source==='parquinho'?{...i,paid:true}:i);
    await db.query('UPDATE orders SET items=$1 WHERE tenant_id=$2 AND id=$3',[JSON.stringify(items),a,'food-order']);
    assert.equal((await db.query('SELECT status FROM parquinho_entries WHERE id=$1',[first.entry.id])).rows[0].status,'paid');
    await db.query("UPDATE orders SET status='finalizada' WHERE tenant_id=$1 AND id=$2",[a,'food-order']);
    assert.equal((await db.query('SELECT status FROM parquinho_entries WHERE id=$1',[first.entry.id])).rows[0].status,'finalized');
  });
  await check('report groups entries after midnight by the captured shift, not calendar date',async()=> {
    await db.query('UPDATE parquinho_entries SET created_at=$1 WHERE id=$2',['2026-11-16T01:00:00Z',first.entry.id]);
    const r=await db.query('SELECT * FROM parquinho_entries WHERE tenant_id=$1 AND shift_started_at=$2::timestamptz',[a,shift]);
    assert.ok(r.rows.some(e=>e.id===first.entry.id));
    assert.ok(r.rows.some(e=>new Date(e.created_at).getUTCDate()!==new Date(shift).getUTCDate()));
  });
  await check('removal and cancellation persist in ledger after order mutation/deletion',async()=> {
    const r=await launch(a,'remove-me',3,'Child D');
    await db.query('UPDATE orders SET items=$1 WHERE tenant_id=$2 AND id=$3',[JSON.stringify([{...r.item,removed:true,removedBy:'ADM fixture',removalReason:'Fictitious cancellation'}]),a,r.order.id]);
    assert.equal((await db.query('SELECT status FROM parquinho_entries WHERE id=$1',[r.entry.id])).rows[0].status,'removed');
    const cancel=await launch(a,'cancel-me',3,'Child E');
    await db.query('DELETE FROM orders WHERE tenant_id=$1 AND id=$2',[a,cancel.order.id]);
    assert.equal((await db.query('SELECT status FROM parquinho_entries WHERE id=$1',[cancel.entry.id])).rows[0].status,'cancelled');
    assert.equal((await db.query('SELECT status FROM parquinho_entries WHERE id=$1',[r.entry.id])).rows[0].status,'removed');
  });
  await check('anonymous/authenticated browser roles cannot read private tables or call charging RPC',async()=> {
    for(const role of ['anon','authenticated']) {
      for(const table of ['parquinho_operators','parquinho_entries','orders','tables','comandas','waiters','menu','config']) {
        await denyRole(role,`SELECT * FROM public.${table}`);
      }
      await denyRole(role,`SELECT playground_add_entry('${a}','bad',1,'Child','${opA}','Fake',NULL,NULL)`);
    }
    await db.exec('SET ROLE service_role');
    assert.ok((await db.query('SELECT * FROM parquinho_entries')).rows.length>0);
    await db.exec('RESET ROLE');
  });
  console.log(`PASS: ${passed} SQL scenarios, in-memory only; no real database or credentials accessed.`);
} finally { await db.close(); }
