import 'dotenv/config';
import { zipSync, strToU8 } from "fflate";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import os from "os";
import net from "net";
import { randomUUID, createHash } from "crypto";
import { createServer as createViteServer } from "vite";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { MENU_CATEGORIES, PIZZA_FLAVORS, PIZZA_CRUSTS } from "./src/constants.ts";
import { initPg, pgSave, pgLoad, pgSeedMenu, pgDeleteMenu, pgDeleteLike, pgDeleteOrdersByWaiterLike } from "./src/db-pg.ts";
import { agendarBackupDiario } from "./src/lib/backup.ts";
import { LATEST_PR } from "./src/version.ts";
import {
  TEST_RESET_TENANT_ID,
  TEST_RESET_MARKER_FIELD,
  TEST_RESET_DISABLE_ENV,
  shouldRunTestTableReset,
  resetTestTableState,
} from "./src/server/test-table-reset.ts";
import { leaveTenantRooms, switchSocketTenant } from "./src/server/socket-tenant.ts";
import {
  authActorSafe,
  buildWaiterAuthAck,
  findWaiterByCredentials,
  isApprovedWaiter,
  isWaiterActorForTenant,
  projectWaitersForActor,
  sanitizeWaiter,
  sanitizeWaiters,
  waiterCredentialsMatch,
} from "./src/server/waiter-auth.ts";
import {
  ensurePlaygroundProduct,
  isPlaygroundReservedItem,
  normalizePlaygroundConfig,
  synchronizePlaygroundCatalog,
} from "./src/server/playground-core.ts";
import {
  registerPlaygroundSocketHandlers,
  isPlaygroundOperatorSocketEventAllowed,
  publishPlaygroundProjection,
} from "./src/server/playground.ts";
import { registerKitchenSocketHandlers } from "./src/server/kitchen-core.ts";
import {
  closeCashRegisterState,
  getOpenCashRegisterNames,
  hasLogicalOpenCashRegisters,
  openCashRegisterState,
  releaseCashRegisterClaims,
  restoreOpenCashRegisterOwners,
} from "./src/server/cash-register-state.ts";
// DotCompany removida — integração direta SEFAZ-MT via src/lib/fiscal/
import {
  carregarCertificado, getCertificado, validarCNPJ,
  encryptPfx, decryptPfx, encryptText, decryptText,
} from "./src/lib/fiscal/certificate.ts";
import {
  autorizarNFCe, cancelarNFCe, cancelarNFe, consultarNFCe, consultarNFe, verificarServico,
  reservarNumero, sincronizarContador, autorizarNFe, inutilizarNumeracao,
} from "./src/lib/fiscal/sefaz-direct.ts";
import { reconciliarResultadoDesconhecido } from "./src/lib/fiscal/reconciliacao.ts";
import { emitirEpecNFe } from "./src/lib/fiscal/epec.ts";
import { emitirNFeSvcRs, cancelarNFeSvcRs } from "./src/lib/fiscal/svcrs.ts";
import { emitirNFCeOffline } from "./src/lib/fiscal/nfce-offline.ts";
import type { IntencaoFiscal, EstabelecimentoFiscal, ItemNota, PagamentoNota, AmbienteFiscal } from "./src/lib/fiscal/types.ts";
import { T_PAG, TP_AMB } from "./src/lib/fiscal/endpoints.ts";
// Tipos legados mantidos apenas para compatibilidade de campos salvos no banco
type FiscalConfig = any;

/*
 * SQL — execute once in Supabase SQL editor:
 *
 * CREATE TABLE IF NOT EXISTS fiscal_notes (
 *   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *   tenant_id TEXT NOT NULL,
 *   order_id TEXT NOT NULL,
 *   chave_acesso TEXT,
 *   qr_code TEXT,
 *   url_danfe TEXT,
 *   xml TEXT,
 *   status TEXT NOT NULL DEFAULT 'pendente',
 *   protocolo TEXT,
 *   idempotency_key TEXT,
 *   nota_id INTEGER,
 *   cpf_consumidor TEXT,
 *   total NUMERIC,
 *   ambiente TEXT DEFAULT 'homologacao',
 *   error_detail TEXT,
 *   error_code TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 * CREATE INDEX IF NOT EXISTS fiscal_notes_tenant_order ON fiscal_notes(tenant_id, order_id);
 */

async function startServer() {
  const app = express();
  const httpServer = createServer({ maxHeaderSize: 65536 }, app);
  
  const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ["http://localhost:3000", "http://0.0.0.0:3000", "http://localhost:3001", "http://0.0.0.0:3001"];

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Agente local (Node.js) não envia origin — sempre permitir
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(null, true); // em dev, permitir tudo; em prod usar: callback(new Error('Not allowed'))
      },
    },
  });

  const PORT = 3001;

  // ── Detecta modo de banco: PostgreSQL local ou Supabase ─────────────────────
  const USE_POSTGRES = !!process.env.DATABASE_URL;
  let db: SupabaseClient | null = null;

  if (USE_POSTGRES) {
    try {
      initPg(process.env.DATABASE_URL!);
      console.log('[pg] Pool PostgreSQL inicializado');
    } catch (error) {
      console.error('[pg] Falha ao inicializar PostgreSQL:', error);
      process.exit(1);
    }
  } else {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
      }
      db = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
        realtime: { transport: ws as any },
      });
      console.log('[supabase] Admin client inicializado');
      agendarBackupDiario(db);
    } catch (error) {
      console.error('[supabase] Falha ao inicializar:', error);
      process.exit(1);
    }
  }

  app.use(express.json({ limit: '15mb' }));

  // ── Per-tenant state ──────────────────────────────────────────────────────
  interface TenantState {
    orders: any[];
    tables: any[];
    comandas: any[];
    waiters: any[];
    menu: any[];
    stock: any[];
    stockLog: any[];
    pizzaFlavors: any[];
    pizzaCrusts: any[];
    pizzaSizes: { name: string; slices: number; dim: string; people: string; maxFlavors: number; detail: string; basePrice?: number }[];
    isCashRegisterOpen: boolean;
    shiftStartedAt: string;
    dailyCounter: number;
    lastOrderDate: string;
    pizzariaConfig: any;
    fiscalConfig: FiscalConfig | null;
    printerConfig: any;
    printerAgentSocket: any;
    printSocket: any;
    openCashRegisters: Record<string, string>;
    loaded: boolean;
  }

  const DEFAULT_PIZZA_SIZES = [
    { name: 'Mini',       slices: 4,  dim: '20cm',     people: '1 pessoa',     maxFlavors: 1, detail: 'até 1 sabor',  basePrice: 28.00 },
    { name: 'Pequena',    slices: 4,  dim: '25cm',     people: '1-2 pessoas',  maxFlavors: 2, detail: 'até 2 sabores', basePrice: 38.00 },
    { name: 'Média',      slices: 6,  dim: '30cm',     people: '2-3 pessoas',  maxFlavors: 2, detail: 'até 2 sabores', basePrice: 48.00 },
    { name: 'Grande',     slices: 8,  dim: '35cm',     people: '3-4 pessoas',  maxFlavors: 4, detail: 'até 4 sabores', basePrice: 58.00 },
    { name: 'GG',         slices: 12, dim: '40cm',     people: '4-5 pessoas',  maxFlavors: 4, detail: 'até 4 sabores', basePrice: 69.00 },
    { name: 'Meio Metro', slices: 16, dim: '50x25cm',  people: '5-6 pessoas',  maxFlavors: 4, detail: 'até 4 sabores', basePrice: 85.00 },
    { name: 'Metro',      slices: 24, dim: '100x25cm', people: '8-10 pessoas', maxFlavors: 6, detail: 'até 6 sabores', basePrice: 129.00 },
  ];

  const tenants = new Map<string, TenantState>();
  // Agentes aguardando pareamento (conectaram sem tenantId)
  const pendingAgents = new Map<string, any>(); // socketId → socket

  function defaultTenantState(): TenantState {
    return {
      orders: [],
      tables: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: "free", currentOrder: null, linkedTo: null })),
      comandas: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: "free", currentOrder: null, linkedTo: null })),
      waiters: [],
      menu: JSON.parse(JSON.stringify(MENU_CATEGORIES)),
      stock: [],
      stockLog: [],
      pizzaFlavors: JSON.parse(JSON.stringify(PIZZA_FLAVORS)),
      pizzaCrusts: JSON.parse(JSON.stringify(PIZZA_CRUSTS)),
      pizzaSizes: JSON.parse(JSON.stringify(DEFAULT_PIZZA_SIZES)),
      isCashRegisterOpen: false,
      shiftStartedAt: new Date().toISOString(),
      dailyCounter: 0,
      lastOrderDate: '',
      pizzariaConfig: { enabled: false, yellowMinutes: 15, orangeMinutes: 20, redMinutes: 25, inactivityMinutes: 30, kdsEnabled: false, waiterCanPay: true },
      fiscalConfig: null,
      printerConfig: {},
      printerAgentSocket: null,
      printSocket: null,
      openCashRegisters: {},
      loaded: false,
    };
  }

  function getState(tenantId: string): TenantState {
    if (!tenants.has(tenantId)) tenants.set(tenantId, defaultTenantState());
    return tenants.get(tenantId)!;
  }

  // callWaiterCooldown and clientSessions keyed by `${tenantId}:...`
  const callWaiterCooldown = new Map<string, number>();

  // â"€â"€ Mappers: Supabase row â†" app object â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const rowToTable  = (r: any) => ({ id: r.id, status: r.status, currentOrder: r.current_order ?? null, linkedTo: r.linked_to ?? null });
  const tableToRow  = (t: any) => ({ id: t.id, status: t.status, current_order: t.currentOrder ?? null, linked_to: t.linkedTo ?? null });
  const rowToOrder  = (r: any) => ({ id: r.id, tableId: r.table_id, waiterId: r.waiter_id, waiterName: r.waiter_name, status: r.status, isComanda: r.is_comanda, timestamp: r.timestamp, items: r.items || [], paymentLog: r.payment_log || [], deliveryLog: r.delivery_log || [] });
  const orderToRow  = (o: any) => ({ id: String(o.id), table_id: o.tableId ? String(o.tableId) : null, waiter_id: o.waiterId ? String(o.waiterId) : null, waiter_name: o.waiterName || null, status: o.status || 'open', is_comanda: o.isComanda || false, timestamp: o.timestamp || new Date().toISOString(), items: o.items || [], payment_log: o.paymentLog || [], delivery_log: o.deliveryLog || [] });
  const rowToStock  = (r: any) => ({ id: r.id, menuItemId: r.menu_item_id, name: r.name, quantity: r.quantity, minQuantity: r.min_quantity, unit: r.unit, history: r.history || [] });
  const stockToRow  = (s: any) => ({ id: s.id, menu_item_id: s.menuItemId || s.id, name: s.name || '', quantity: s.quantity || 0, min_quantity: s.minQuantity || 0, unit: s.unit || 'un', history: s.history || [] });
  const publicWaiters = (waiters: any[]) => sanitizeWaiters(waiters);

  // â"€â"€ saveToSupabase: persiste qualquer coleÃ§Ã£o â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const markShiftStart = (st: TenantState) => {
    if (hasLogicalOpenCashRegisters(st.isCashRegisterOpen, st.openCashRegisters)) return;
    st.shiftStartedAt = new Date().toISOString();
  };

  const cashRegisterConfigPatch = (st: TenantState, extra: Record<string, any> = {}) => ({
    isCashRegisterOpen: st.isCashRegisterOpen,
    // Persist the marker even while globally closed so the next report can use
    // the exact shift that was just closed (including across midnight).
    shiftStartedAt: st.shiftStartedAt,
    openCashRegisterNames: getOpenCashRegisterNames(st.openCashRegisters),
    ...extra,
  });

  const clonePersistenceData = <T>(data: T): T => {
    if (data === undefined || data === null) return data;
    return JSON.parse(JSON.stringify(data));
  };

  // Single-writer por tenant/colecao/registro. O snapshot e clonado antes de
  // entrar na fila para nao observar mutacoes futuras do objeto em memoria.
  const _tenantWriteTails = new Map<string, Promise<void>>();
  const _tenantWriteRevisions = new Map<string, number>();

  const markTenantWrite = (tenantId: string) => {
    _tenantWriteRevisions.set(tenantId, (_tenantWriteRevisions.get(tenantId) || 0) + 1);
  };

  const tenantWriteRevision = (tenantId: string) => _tenantWriteRevisions.get(tenantId) || 0;

  const assertSupabaseResult = async <T extends { error?: any }>(result: PromiseLike<T>): Promise<T> => {
    const response = await result;
    if (response?.error) throw response.error;
    return response;
  };

  const waitForTenantWrites = async (tenantId: string) => {
    const prefix = `${tenantId}:`;
    while (true) {
      // Também drena o debounce de 80 ms. Sem isso, uma reconexão poderia ler
      // o banco antes de o último lançamento sair de _writePayload.
      const pendingPayloads = [..._writePayload.entries()]
        .filter(([key]) => key.startsWith(prefix));
      for (const [key, payload] of pendingPayloads) {
        const timer = _writeTimers.get(key);
        if (timer) clearTimeout(timer);
        _writeTimers.delete(key);
        _writePayload.delete(key);
        saveToSupabase(payload.collection, payload.data, payload.docId, payload.tenantId);
      }
      const pending = [..._tenantWriteTails.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, promise]) => promise);
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  };

  const saveToSupabaseRaw = async (collection: string, data: any, docId?: string, tenantId?: string) => {
    if (USE_POSTGRES) { await pgSave(collection, data, docId, tenantId || 'default'); return; }
    if (!db) return;
    const tid = tenantId || 'default';
    try {
      const d = JSON.parse(JSON.stringify(data));
      switch (collection) {
        case 'orders':   await assertSupabaseResult(db.from('orders').upsert({ ...orderToRow(d), tenant_id: tid }, { onConflict: 'tenant_id,id' })); break;
        case 'tables':   await assertSupabaseResult(db.from('tables').upsert({ ...tableToRow(d), tenant_id: tid }, { onConflict: 'tenant_id,id' })); break;
        case 'comandas': await assertSupabaseResult(db.from('comandas').upsert({ ...tableToRow(d), tenant_id: tid }, { onConflict: 'tenant_id,id' })); break;
        case 'waiters': {
          // Usa RPC para evitar validação do schema cache do PostgREST
          console.log('[supabase][waiters] upsert via rpc id:', d.id, 'tenant:', tid);
          await assertSupabaseResult(db.rpc('upsert_waiter', {
            p_id:         String(d.id ?? ''),
            p_name:       String(d.name ?? ''),
            p_cpf:        d.cpf        ?? null,
            p_phone:      d.phone      ?? null,
            p_birth_date: d.birthDate  ?? null,
            p_password:   d.password   ?? null,
            p_status:     d.status     ?? 'pending',
            p_uid:        d.uid        ?? null,
            p_tenant_id:  tid,
          }));
          break;
        }
        case 'menu':     await assertSupabaseResult(db.from('menu').upsert({ id: `${tid}:${docId || d.id}`, name: d.name, position: d.position || 0, items: d.items || [], tenant_id: tid, type: d.type, visible: d.visible !== false, subcategories: d.subcategories || [] })); break;
        case 'stock':    await assertSupabaseResult(db.from('stock').upsert({ ...stockToRow(d), id: `${tid}:${d.menuItemId || d.id}`, tenant_id: tid })); break;
        case 'config':   await assertSupabaseResult(db.from('config').upsert({ id: `${tid}:${docId}`, data: d, tenant_id: tid })); break;
        case 'pizzaFlavors': await assertSupabaseResult(db.from('pizza_flavors').upsert({ id: `${tid}:${d.name}`, name: d.name, category: d.category || null, price: d.price || null, available: d.available !== false, tenant_id: tid })); break;
        case 'pizzaCrusts':  await assertSupabaseResult(db.from('pizza_crusts').upsert({ id: `${tid}:${d.name || docId}`, name: d.name || docId, tenant_id: tid })); break;
        default: throw new Error(`Colecao desconhecida: ${collection}`);
      }
    } catch (e) {
      console.error(`[supabase] erro ao salvar em ${collection}:`, e);
      throw e;
    }
  };

  const saveToSupabase = (collection: string, data: any, docId?: string, tenantId?: string): Promise<void> => {
    const tid = tenantId || 'default';
    const key = `${tid}:${collection}:${String(docId ?? data?.id ?? '')}`;
    const snapshot = clonePersistenceData(data);
    markTenantWrite(tid);
    const previous = _tenantWriteTails.get(key);
    // Start the first write immediately. Besides reducing latency, this makes
    // the single-writer barrier observable before another microtask can load.
    const current = previous
      ? previous.catch(() => undefined).then(() => saveToSupabaseRaw(collection, snapshot, docId, tid))
      : saveToSupabaseRaw(collection, snapshot, docId, tid);
    const tracked = current.finally(() => {
      if (_tenantWriteTails.get(key) === tracked) _tenantWriteTails.delete(key);
    });
    // `current` continua rejeitando para o chamador; este observer evita que a
    // cópia mantida apenas no mapa vire uma unhandled rejection.
    tracked.catch(() => undefined);
    _tenantWriteTails.set(key, tracked);
    return current;
  };

  // TEST-ONLY, approved 2026-11-16: the reset is deliberately limited to the
  // exact tenant in test-table-reset.ts and is disabled by setting
  // PDV_TEST_RESET_ON_DEPLOY=false before a production rollout. It is not a
  // generic reset and never touches comandas/menu/users/stock/fiscal/reports.
  const runApprovedTestTableReset = async (tenantId: string, appConfig: any): Promise<boolean> => {
    if (!db || tenantId !== TEST_RESET_TENANT_ID) return false;
    const buildId = String(__BUILD_ID__);
    const enabled = String(process.env[TEST_RESET_DISABLE_ENV] ?? 'true').toLowerCase() !== 'false';
    if (!enabled) return false;
    // The app config is overwritten by normal cash-register/counter updates.
    // A dedicated record keeps a same-build restart from cleaning new orders.
    const markerDocId = `${tenantId}:test_table_reset`;
    const markerResult = await assertSupabaseResult(
      db.from('config').select('data').eq('tenant_id', tenantId).eq('id', markerDocId).maybeSingle()
    );
    if (!shouldRunTestTableReset({
      tenantId,
      buildId,
      marker: markerResult.data?.data?.[TEST_RESET_MARKER_FIELD],
      enabled,
    })) return false;

    try {
      // Supabase REST calls are awaited in order. If any step fails, the
      // marker is not written; the next tenant load safely retries this
      // idempotent cleanup before exposing init_data or accepting actions.
      await assertSupabaseResult(
        db.from('orders').delete().eq('tenant_id', tenantId).or('is_comanda.eq.false,is_comanda.is.null')
      );
      await assertSupabaseResult(
        db.from('tables').update({ status: 'free', current_order: null, linked_to: null }).eq('tenant_id', tenantId)
      );
      await assertSupabaseResult(
        db.from('config').upsert({
          id: markerDocId,
          tenant_id: tenantId,
          data: { [TEST_RESET_MARKER_FIELD]: buildId, resetAt: new Date().toISOString() },
        })
      );
      console.log(`[test-reset] tenant=${tenantId} table orders cleared for build ${buildId}`);
      return true;
    } catch (error: any) {
      console.error(`[test-reset] tenant=${tenantId} failed closed:`, error?.message || error);
      throw error;
    }
  };

  // ── Write queue: debounced async writes, sem bloquear o event loop ────────
  // Agrupa writes rápidos do mesmo registro (ex: vários itens na mesma order)
  // num único upsert. O socket responde imediatamente; o write vai em background.
  const _writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const _writePayload = new Map<string, { collection: string; data: any; docId: string; tenantId: string }>();

  const enqueueWrite = (collection: string, data: any, docId: string, tenantId: string, debounceMs = 80) => {
    const key = `${tenantId}:${collection}:${docId}`;
    const existing = _writeTimers.get(key);
    if (existing) clearTimeout(existing);
    markTenantWrite(tenantId);
    _writePayload.set(key, { collection, data: clonePersistenceData(data), docId, tenantId });
    _writeTimers.set(key, setTimeout(() => {
      _writeTimers.delete(key);
      const p = _writePayload.get(key);
      if (p) {
        _writePayload.delete(key);
        saveToSupabase(p.collection, p.data, p.docId, p.tenantId).catch((error) => {
          console.error(`[persist] falha ao salvar ${p.collection}/${p.docId} (tenant ${p.tenantId}):`, error?.message || error);
        });
      }
    }, debounceMs));
  };

  // Comandos de pedido/mesa/configuração compartilham uma única cauda por
  // tenant. Isso serializa mutações críticas sem bloquear impressão, leitura
  // ou broadcasts; cada operação ainda drena sua própria fila de persistência.
  const _tenantCommandTails = new Map<string, Promise<unknown>>();
  const withTenantCommand = async <T>(tenantId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = _tenantCommandTails.get(tenantId);
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
      await waitForTenantWrites(tenantId);
      const result = await operation();
      await waitForTenantWrites(tenantId);
      const operatorRoom = io.sockets.adapter.rooms.get(`playground:${tenantId}`);
      if (operatorRoom?.size) {
        try {
          await publishPlaygroundProjection({ db, usePostgres: USE_POSTGRES, getState, buildId: __BUILD_ID__, io }, tenantId);
        } catch (error) {
          // The account is already durable: do not turn a notification failure
          // into a false failed charge, and never replace a valid view with [].
          console.error(`[parquinho][${tenantId}] Falha ao atualizar projeção:`, error);
        }
      }
      return result;
    });
    const tracked = current.finally(() => {
      if (_tenantCommandTails.get(tenantId) === tracked) _tenantCommandTails.delete(tenantId);
    });
    tracked.catch(() => undefined);
    _tenantCommandTails.set(tenantId, tracked);
    return current;
  };

  const saveCashRegisterReport = async (tenantId: string, type: 'open' | 'close', cashRegisterName: string | null, st: TenantState) => {
    if (!db) return;
    const now = new Date().toISOString();
    const shiftStartedAt = st.shiftStartedAt || now;
    let reportData: any = {};
    if (type === 'close') {
      // Compute sales data from orders in the current shift
      const shiftOrders = st.orders.filter((o: any) => {
        if (!shiftStartedAt) return false;
        return o.timestamp >= shiftStartedAt;
      });
      const finishedOrders = shiftOrders.filter((o: any) => o.status === 'finalizada');
      const methodTotals: Record<string, number> = {};
      const productTotals: Record<string, { qty: number; total: number }> = {};
      const categoryTotals: Record<string, { qty: number; total: number }> = {};
      let totalPaid = 0;
      for (const order of finishedOrders) {
        const payments = [...(order.paymentLog || []), ...(order.partialPayments || [])];
        for (const p of payments) {
          const m = p.method || 'Outros';
          methodTotals[m] = (methodTotals[m] || 0) + (p.amount || 0);
          totalPaid += p.amount || 0;
        }
        for (const item of (order.items || [])) {
          if (item.removed) continue;
          const qty = item.quantity || 1;
          const total = (item.price || 0) * qty;
          if (!productTotals[item.name]) productTotals[item.name] = { qty: 0, total: 0 };
          productTotals[item.name].qty += qty;
          productTotals[item.name].total += total;
          const cat = item.type || 'outros';
          if (!categoryTotals[cat]) categoryTotals[cat] = { qty: 0, total: 0 };
          categoryTotals[cat].qty += qty;
          categoryTotals[cat].total += total;
        }
      }
      reportData = { methodTotals, productTotals, categoryTotals, totalPaid, orderCount: finishedOrders.length };
    }
    try {
      await db.from('cash_register_reports').insert({
        tenant_id: tenantId,
        type,
        cash_register_name: cashRegisterName,
        shift_started_at: shiftStartedAt,
        created_at: now,
        report_data: reportData,
      });
    } catch (e) {
      console.error('[crr] erro ao salvar relatório:', e);
    }
  };

  const writeAudit = (tenantId: string, type: string, actor: string | null, description: string, metadata?: Record<string, any>): void => {
    if (!db) return;
    db.from('audit_log').insert({
      tenant_id: tenantId,
      type,
      actor: actor || null,
      description,
      metadata: metadata ?? null,
      timestamp: new Date().toISOString(),
    }).then().catch((e: any) => console.error('[audit]', e));
  };

  const saveMenuToSupabase = (st: TenantState, tenantId: string) => {
    st.menu.forEach((cat: any, idx: number) => {
      saveToSupabase('menu', { ...cat, position: idx }, cat.name, tenantId).catch(() => {});
    });
  };

  const saveMenuToSupabaseAwait = async (st: TenantState, tenantId: string) => {
    await Promise.all(st.menu.map((cat: any, idx: number) =>
      saveToSupabase('menu', { ...cat, position: idx }, cat.name, tenantId)
    ));
  };

  // ── Carga inicial do banco (Supabase ou PostgreSQL) ──────────────────────────
  const loadFromSupabase = async () => {
    // ── PostgreSQL local ──────────────────────────────────────────────────────
    if (USE_POSTGRES) {
      const pgData = await pgLoad('default');
      if (!pgData) return;
      const st = getState('default');
      const room = 'tenant:default';

      if (pgData.waiters?.length) { st.waiters = pgData.waiters; io.to(room).emit('update_waiters', publicWaiters(st.waiters)); }

      const typeMap: Record<string, string> = {};
      MENU_CATEGORIES.forEach((c: any) => { typeMap[c.name] = c.type; });

      if (pgData.menu?.length) {
        st.menu = pgData.menu.map((row: any) => ({
          ...row,
          type: row.type || typeMap[row.name] || 'lanches',
          visible: row.visible !== false,
          subcategories: row.subcategories || [],
        }));
        io.to(room).emit('update_menu', st.menu);
      } else {
        await pgSeedMenu(st.menu, 'default');
        console.log('[pg] Menu inicial semeado');
        io.to(room).emit('update_menu', st.menu);
      }

      // Fix B: sempre emitir update_orders no startup, mesmo array vazio, para limpar cache stale
      st.orders = pgData.orders?.length ? pgData.orders.map((o: any) => {
        if (o.items && st.menu.length > 0) {
          o.items = o.items.map((item: any) => {
            if (item.type === 'pizzas') return item;
            const cat = st.menu.find((c: any) =>
              c.items?.some((i: any) => i.id === item.menuItemId || i.name === item.name) ||
              (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId || i.name === item.name))
            );
            return cat?.type ? { ...item, type: cat.type } : item;
          });
        }
        return o;
      }) : [];
      io.to(room).emit('update_orders', st.orders);

      if (pgData.tables?.length) {
        pgData.tables.forEach((dbTable: any) => {
          const idx = st.tables.findIndex(t => t.id === dbTable.id);
          if (idx !== -1) st.tables[idx] = { ...st.tables[idx], ...dbTable }; else st.tables.push(dbTable);
        });
        st.tables.sort((a, b) => a.id - b.id);
        io.to(room).emit('update_tables', st.tables);
      }

      if (pgData.comandas?.length) {
        pgData.comandas.forEach((dbC: any) => {
          const idx = st.comandas.findIndex(c => c.id === dbC.id);
          if (idx !== -1) st.comandas[idx] = { ...st.comandas[idx], ...dbC }; else st.comandas.push(dbC);
        });
        st.comandas.sort((a, b) => a.id - b.id);
        io.to(room).emit('update_comandas', st.comandas);
      }

      if (pgData.configApp) {
        const cfg = pgData.configApp as any;
        st.openCashRegisters = restoreOpenCashRegisterOwners(cfg.openCashRegisterNames);
        const restoredCashRegisterNames = getOpenCashRegisterNames(st.openCashRegisters);
        st.isCashRegisterOpen = cfg.isCashRegisterOpen ?? restoredCashRegisterNames.length > 0;
        // Persisted logical names are authoritative even when an older partial
        // config write left the global boolean behind.
        if (restoredCashRegisterNames.length > 0) st.isCashRegisterOpen = true;
        if (cfg.shiftStartedAt) st.shiftStartedAt = String(cfg.shiftStartedAt);
        if (cfg.dailyCounter !== undefined) st.dailyCounter = cfg.dailyCounter;
        if (cfg.lastOrderDate !== undefined) st.lastOrderDate = cfg.lastOrderDate;
        // Se há pedidos ativos mas o caixa está fechado, reabrir automaticamente
        const hasActiveOrders = st.orders.some((o: any) => o.status !== 'finalizada' && o.status !== 'paid');
        if (hasActiveOrders && !st.isCashRegisterOpen) {
          st.isCashRegisterOpen = true;
          saveToSupabase('config', cashRegisterConfigPatch(st), 'app', 'default').catch(() => {});
        }
        io.to(room).emit('update_cash_register', st.isCashRegisterOpen);
        io.to(room).emit('update_shift_started_at', st.shiftStartedAt);
      }

      if (pgData.stock?.length) { st.stock = pgData.stock; io.to(room).emit('update_stock', st.stock); }
      if (pgData.pizzaFlavors?.length) { st.pizzaFlavors = pgData.pizzaFlavors; io.to(room).emit('update_pizza_flavors', st.pizzaFlavors); }
      if (pgData.pizzaCrusts?.length) { st.pizzaCrusts = pgData.pizzaCrusts; io.to(room).emit('update_pizza_crusts', st.pizzaCrusts); }
      if (pgData.configPizzaria) {
        st.pizzariaConfig = { ...st.pizzariaConfig, ...(pgData.configPizzaria as any) };
        if (st.pizzariaConfig.parquinhoEnabled) {
          const product = ensurePlaygroundProduct(st.menu, 'default', normalizePlaygroundConfig('default', st.pizzariaConfig).parquinhoPrice);
          if (product.changed) { st.menu = product.menu; await pgSeedMenu(st.menu, 'default'); }
        }
        io.to(room).emit('update_pizzaria_config', st.pizzariaConfig);
      }

      // Reconcilia mesas/comandas: libera as que estão ocupadas sem pedido ativo
      const pgActiveOrderIds = new Set(st.orders.filter((o: any) => o.status !== 'finalizada' && o.status !== 'paid').map((o: any) => String(o.id)));
      let pgTablesDirty = false;
      st.tables = st.tables.map((t: any) => {
        if (t.status !== 'free' && t.currentOrder && !pgActiveOrderIds.has(String(t.currentOrder))) {
          pgTablesDirty = true;
          saveToSupabase('tables', { ...t, status: 'free', currentOrder: null, linkedTo: null }, t.id.toString(), 'default').catch(() => {});
          return { ...t, status: 'free', currentOrder: null, linkedTo: null };
        }
        return t;
      });
      st.comandas = st.comandas.map((c: any) => {
        if (c.status !== 'free' && c.currentOrder && !pgActiveOrderIds.has(String(c.currentOrder))) {
          pgTablesDirty = true;
          saveToSupabase('comandas', { ...c, status: 'free', currentOrder: null, linkedTo: null }, c.id.toString(), 'default').catch(() => {});
          return { ...c, status: 'free', currentOrder: null, linkedTo: null };
        }
        return c;
      });
      if (pgTablesDirty) {
        io.to(room).emit('update_tables', st.tables);
        io.to(room).emit('update_comandas', st.comandas);
        console.log('[pg] Mesas/comandas inconsistentes liberadas no startup');
      }

      st.loaded = true;
      console.log('[pg] Carga inicial concluída');
      return;
    }

    // Supabase: load for single default tenant on startup (backward-compat)
    await loadTenantData('default');
  };

  // ID do tenant-modelo: novos tenants herdam cardápio, sabores, bordas e tamanhos de pizza deste tenant.
  const _TMPL = 'c5c88a54-4bcc-477d-aa8e-d095423484d6';

  const loadTenantData = async (tenantId: string) => {
    if (!db) throw new Error(`Banco Supabase indisponivel para carregar tenant ${tenantId}`);
    const st = getState(tenantId);
    const room = 'tenant:' + tenantId;
    try {
      // Se existe uma escrita local pendente, o snapshot lido antes dela pode
      // apagar o lançamento em memória. Aguarde-a antes de aplicar qualquer
      // resposta do banco; falha de escrita mantém loaded=false e bloqueia init.
      await waitForTenantWrites(tenantId);
      const readRevision = tenantWriteRevision(tenantId);
      const [wRes, oRes, tRes, cRes, cfgRes, mRes, sRes, pfRes, pcRes, cfgPizRes, slRes, pcfgRes] = await Promise.all([
        db.from('waiters').select('*').eq('tenant_id', tenantId),
        db.from('orders').select('*').eq('tenant_id', tenantId),
        db.from('tables').select('*').eq('tenant_id', tenantId).order('id'),
        db.from('comandas').select('*').eq('tenant_id', tenantId).order('id'),
        db.from('config').select('data').eq('id', `${tenantId}:app`).maybeSingle(),
        db.from('menu').select('*').eq('tenant_id', tenantId).order('position'),
        db.from('stock').select('*').eq('tenant_id', tenantId),
        db.from('pizza_flavors').select('*').eq('tenant_id', tenantId),
        db.from('pizza_crusts').select('*').eq('tenant_id', tenantId),
        db.from('config').select('data').eq('id', `${tenantId}:pizzaria`).maybeSingle(),
        db.from('config').select('data').eq('id', `${tenantId}:stockLog`).maybeSingle(),
        db.from('config').select('data').eq('id', `${tenantId}:printerConfig`).maybeSingle(),
      ]);
      const queryError = [wRes, oRes, tRes, cRes, cfgRes, mRes, sRes, pfRes, pcRes, cfgPizRes, slRes, pcfgRes]
        .map((result: any) => result?.error)
        .find(Boolean);
      if (queryError) throw queryError;
      // A debounced write may have started while the SELECTs were in flight.
      // Drain it and retry the read instead of applying the older snapshot.
      await waitForTenantWrites(tenantId);
      if (tenantWriteRevision(tenantId) !== readRevision) {
        return loadTenantData(tenantId);
      }

      // O reset autorizado acontece ainda dentro do readiness do tenant, antes
      // de init_data. A carga usa as mesmas respostas já obtidas, mas elimina
      // qualquer pedido de mesa e força as tables a livres sem tocar comandas.
      const testTableResetApplied = await runApprovedTestTableReset(tenantId, cfgRes.data?.data);
      const loadedOrderRows = testTableResetApplied && oRes.data
        ? oRes.data.filter((row: any) => row.is_comanda === true)
        : oRes.data;
      const loadedTableRows = testTableResetApplied && tRes.data
        ? tRes.data.map((row: any) => ({ ...row, status: 'free', current_order: null, linked_to: null }))
        : tRes.data;

      if (wRes.data) {
        st.waiters = wRes.data;
        io.to(room).emit('update_waiters', publicWaiters(st.waiters));
      }

      const typeMap: Record<string, string> = {};
      MENU_CATEGORIES.forEach((c: any) => { typeMap[c.name] = c.type; });

      // Mapa de preços padrão por item id (garante que preços do constants.ts prevalecem sobre price:0 no DB)
      const defaultPriceMap = new Map<string, number>();
      MENU_CATEGORIES.forEach((cat: any) => {
        (cat.subcategories || []).forEach((sub: any) => {
          (sub.items || []).forEach((item: any) => { if (item.id && item.price) defaultPriceMap.set(item.id, item.price); });
        });
        (cat.items || []).forEach((item: any) => { if (item.id && item.price) defaultPriceMap.set(item.id, item.price); });
      });
      const fixItems = (items: any[]) => (items || []).map((item: any) => ({
        ...item,
        price: (!item.price || item.price === 0) && defaultPriceMap.has(item.id) ? defaultPriceMap.get(item.id) : item.price,
      }));

      if (mRes.data?.length) {
        st.menu = mRes.data.map((row: any) => ({
          ...row,
          type: row.type || typeMap[row.name] || (row.name.toLowerCase().includes('pizza') ? 'pizzas' : row.name.toLowerCase().includes('bebida') ? 'bebidas' : 'lanches'),
          visible: row.visible !== false,
          items: fixItems(row.items || []),
          subcategories: (row.subcategories || []).map((sub: any) => ({ ...sub, items: fixItems(sub.items || []) })),
        }));
        io.to(room).emit('update_menu', st.menu);
      } else {
        // Novo tenant sem cardápio: semeia o cardápio padrão mínimo.
        // NÃO copia do tenant-modelo — cada estabelecimento tem seus próprios produtos.
        await db.from('menu').upsert(
          st.menu.map((cat: any, idx: number) => ({ id: `${tenantId}:${cat.name}`, name: cat.name, position: idx, type: cat.type, items: cat.items || [], subcategories: cat.subcategories || [], tenant_id: tenantId }))
        );
        console.log(`[supabase][${tenantId}] Menu inicial semeado (padrão)`);
        io.to(room).emit('update_menu', st.menu);
      }

      if (loadedOrderRows) {
        st.orders = loadedOrderRows.filter((r: any) => {
          // Remove pedidos do Teste de Fogo
          const waiterName = r.waiter_name || '';
          return !waiterName.startsWith('Garcom_Fogo_');
        }).map((r: any) => {
          const o = rowToOrder(r);
          if (o.items && st.menu.length > 0) {
            o.items = o.items.map((item: any) => {
              if (item.type === 'pizzas') return item;
              const cat = item.menuItemId
                ? st.menu.find((c: any) => c.items?.some((i: any) => i.id === item.menuItemId) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId)))
                : st.menu.find((c: any) => c.items?.some((i: any) => i.name === item.name) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.name === item.name)));
              return cat?.type ? { ...item, type: cat.type } : item;
            });
          }
          return o;
        });
        if (!testTableResetApplied) io.to(room).emit('update_orders', st.orders);
      }

      if (loadedTableRows?.length) {
        loadedTableRows.map(rowToTable).forEach((dbTable: any) => {
          const idx = st.tables.findIndex(t => t.id === dbTable.id);
          if (idx !== -1) st.tables[idx] = { ...st.tables[idx], ...dbTable }; else st.tables.push(dbTable);
        });
        st.tables.sort((a, b) => a.id - b.id);
        if (!testTableResetApplied) io.to(room).emit('update_tables', st.tables);
      } else if (db) {
        // Supabase sem mesas para este tenant: semeia as 40 padrão automaticamente
        const defaultRows = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: 'free', current_order: null, linked_to: null, tenant_id: tenantId }));
        // Garante memória consistente: pode estar vazia após reload forçado (st.loaded=false por tables=[])
        if (st.tables.length === 0) {
          st.tables = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: 'free', currentOrder: null, linkedTo: null }));
        }
        db.from('tables').upsert(defaultRows, { onConflict: 'tenant_id,id' }).then(() => {
          console.log(`[supabase][${tenantId}] 40 mesas padrão semeadas automaticamente`);
        }).catch((e: any) => console.warn(`[supabase][${tenantId}] Falha ao semear mesas:`, e));
        if (!testTableResetApplied) io.to(room).emit('update_tables', st.tables);
      }

      if (testTableResetApplied) {
        const resetState = resetTestTableState({ orders: st.orders, tables: st.tables });
        st.orders = resetState.orders;
        st.tables = resetState.tables;
        // Invalidate only table sessions in this tenant; comanda sessions are
        // deliberately retained because comanda orders were not reset.
        for (const key of clientSessions.keys()) {
          if (key.startsWith(`${tenantId}:t:`)) clientSessions.delete(key);
        }
        io.to(room).emit('update_orders', st.orders);
        io.to(room).emit('update_tables', st.tables);
        console.log(`[test-reset] in-memory table state reset for tenant ${tenantId}`);
      }

      if (cRes.data?.length) {
        cRes.data.map(rowToTable).forEach((dbC: any) => {
          const idx = st.comandas.findIndex(c => c.id === dbC.id);
          if (idx !== -1) st.comandas[idx] = { ...st.comandas[idx], ...dbC }; else st.comandas.push(dbC);
        });
        st.comandas.sort((a, b) => a.id - b.id);
        io.to(room).emit('update_comandas', st.comandas);
      } else if (st.comandas.length === 0) {
        // Sem comandas no Supabase e memória vazia: restaura 50 padrão
        st.comandas = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: 'free', currentOrder: null, linkedTo: null }));
      }

      if (cfgRes.data?.data) {
        const cfg = cfgRes.data.data as any;
        st.openCashRegisters = restoreOpenCashRegisterOwners(cfg.openCashRegisterNames);
        const restoredCashRegisterNames = getOpenCashRegisterNames(st.openCashRegisters);
        st.isCashRegisterOpen = cfg.isCashRegisterOpen ?? restoredCashRegisterNames.length > 0;
        // A saved name denotes an open logical register even if the last
        // partial write did not include the aggregate boolean.
        if (restoredCashRegisterNames.length > 0) st.isCashRegisterOpen = true;
        if (cfg.shiftStartedAt) st.shiftStartedAt = String(cfg.shiftStartedAt);
        if (cfg.dailyCounter !== undefined) st.dailyCounter = cfg.dailyCounter;
        if (cfg.lastOrderDate !== undefined) st.lastOrderDate = cfg.lastOrderDate;
        if (cfg.isCashRegisterOpen !== undefined) {
          io.to(room).emit('update_cash_register', st.isCashRegisterOpen);
        }
        io.to(room).emit('update_shift_started_at', st.shiftStartedAt);
      }

      if (sRes.data) {
        const allItems = sRes.data.map(rowToStock);
        if (st.menu.length > 0) {
          const trackedMenuItems = st.menu.flatMap((c: any) => [...(c.items || []), ...(c.subcategories || []).flatMap((s: any) => s.items || [])]).filter((i: any) => i.trackStock);
          const trackedIds = new Set(trackedMenuItems.map((i: any) => i.id));
          st.stock = allItems.filter((s: any) => trackedIds.has(s.menuItemId));
          // reconcile: create missing stock rows for tracked items that have no Supabase entry
          const stockIds = new Set(st.stock.map((s: any) => s.menuItemId));
          const missing = trackedMenuItems.filter((i: any) => !stockIds.has(i.id));
          if (missing.length > 0 && db) {
            const fixedRows = missing.map((i: any) => ({ id: `${tenantId}:${i.id}`, menu_item_id: i.id, name: i.name || '', quantity: 0, min_quantity: 0, unit: 'un', history: [], tenant_id: tenantId }));
            db.from('stock').upsert(fixedRows).then().catch(() => {});
            st.stock.push(...missing.map((i: any) => ({ id: i.id, menuItemId: i.id, name: i.name, quantity: 0, unit: 'un', minQuantity: 0 })));
          }
        } else { st.stock = allItems; }
        io.to(room).emit('update_stock', st.stock);
      }

      if (pfRes.data) { st.pizzaFlavors = pfRes.data.map((r: any) => ({ id: r.id, name: r.name, category: r.category, price: r.price, available: r.available })); io.to(room).emit('update_pizza_flavors', st.pizzaFlavors); }
      if (pcRes.data) { st.pizzaCrusts = pcRes.data.map((r: any) => r.name); io.to(room).emit('update_pizza_crusts', st.pizzaCrusts); }

      // Seed pizza_flavors, pizza_crusts e pizzaSizes do tenant-modelo para novos tenants
      if (db && tenantId !== _TMPL && tenantId !== 'default') {
        if (!st.pizzaFlavors.length) {
          const { data: tplFlavors } = await db.from('pizza_flavors').select('*').eq('tenant_id', _TMPL);
          if (tplFlavors?.length) {
            const seedFlavors = tplFlavors.map((r: any) => ({ ...r, id: randomUUID(), tenant_id: tenantId }));
            await db.from('pizza_flavors').upsert(seedFlavors);
            st.pizzaFlavors = seedFlavors.map((r: any) => ({ id: r.id, name: r.name, category: r.category, price: r.price, available: r.available }));
            io.to(room).emit('update_pizza_flavors', st.pizzaFlavors);
            console.log(`[supabase][${tenantId}] Sabores pizza semeados do tenant-modelo (${seedFlavors.length})`);
          }
        }
        if (!st.pizzaCrusts.length) {
          const { data: tplCrusts } = await db.from('pizza_crusts').select('*').eq('tenant_id', _TMPL);
          if (tplCrusts?.length) {
            const seedCrusts = tplCrusts.map((r: any) => ({ ...r, id: randomUUID(), tenant_id: tenantId }));
            await db.from('pizza_crusts').upsert(seedCrusts);
            st.pizzaCrusts = seedCrusts.map((r: any) => r.name);
            io.to(room).emit('update_pizza_crusts', st.pizzaCrusts);
            console.log(`[supabase][${tenantId}] Bordas pizza semeadas do tenant-modelo (${seedCrusts.length})`);
          }
        }
      }

      if (cfgPizRes.data?.data) {
        st.pizzariaConfig = { ...st.pizzariaConfig, ...(cfgPizRes.data.data as any) };
        if ((cfgPizRes.data.data as any).pizzaSizes?.length) {
          st.pizzaSizes = (cfgPizRes.data.data as any).pizzaSizes;
          io.to(room).emit('update_pizza_sizes', st.pizzaSizes);
        }
        if (st.pizzariaConfig.parquinhoEnabled) {
          const playgroundConfig = normalizePlaygroundConfig(tenantId, st.pizzariaConfig);
          const product = ensurePlaygroundProduct(st.menu, tenantId, playgroundConfig.parquinhoPrice);
          if (product.changed) {
            st.menu = product.menu;
            saveMenuToSupabase(st, tenantId);
          }
        }
        io.to(room).emit('update_pizzaria_config', st.pizzariaConfig);
      } else if (db && tenantId !== _TMPL && tenantId !== 'default') {
        // Novo tenant sem config de pizzaria: copia pizzaSizes, numTables e numComandas do tenant-modelo
        const { data: tplCfgPiz } = await db.from('config').select('data').eq('id', `${_TMPL}:pizzaria`).maybeSingle();
        if (tplCfgPiz?.data) {
          const tplPiz = tplCfgPiz.data as any;
          const seedPizData: Record<string, any> = {};
          if (tplPiz.pizzaSizes?.length) {
            st.pizzaSizes = tplPiz.pizzaSizes;
            seedPizData.pizzaSizes = tplPiz.pizzaSizes;
            io.to(room).emit('update_pizza_sizes', st.pizzaSizes);
          }
          if (tplPiz.numTables != null) {
            st.pizzariaConfig = { ...st.pizzariaConfig, numTables: tplPiz.numTables };
            seedPizData.numTables = tplPiz.numTables;
          }
          if (tplPiz.numComandas != null) {
            st.pizzariaConfig = { ...st.pizzariaConfig, numComandas: tplPiz.numComandas };
            seedPizData.numComandas = tplPiz.numComandas;
          }
          if (Object.keys(seedPizData).length > 0) {
            await db.from('config').upsert({ id: `${tenantId}:pizzaria`, data: seedPizData });
            io.to(room).emit('update_pizzaria_config', st.pizzariaConfig);
            console.log(`[supabase][${tenantId}] Config pizzaria semeada do tenant-modelo:`, Object.keys(seedPizData).join(', '));
          }
        }
      }

      if ((slRes as any).data?.data?.stockLog?.length) {
        st.stockLog = (slRes as any).data.data.stockLog;
        io.to(room).emit('update_stock_log', st.stockLog);
      }

      if ((pcfgRes as any).data?.data && Object.keys((pcfgRes as any).data.data).length > 0) {
        st.printerConfig = (pcfgRes as any).data.data;
      }

      // Load fiscal config
      if (db) {
        const { data: cfgFiscal } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
        if (cfgFiscal?.data) { st.fiscalConfig = cfgFiscal.data as FiscalConfig; }
      }

      // Reconcilia mesas/comandas: libera as que estão ocupadas sem pedido ativo no banco
      const activeOrderIds = new Set(st.orders.filter((o: any) => o.status !== 'finalizada' && o.status !== 'paid').map((o: any) => String(o.id)));
      let tablesDirty = false;
      st.tables = st.tables.map((t: any) => {
        if (t.status !== 'free' && t.currentOrder && !activeOrderIds.has(String(t.currentOrder))) {
          tablesDirty = true;
          saveToSupabase('tables', { ...t, status: 'free', currentOrder: null, linkedTo: null }, t.id.toString(), tenantId).catch(() => {});
          return { ...t, status: 'free', currentOrder: null, linkedTo: null };
        }
        return t;
      });
      st.comandas = st.comandas.map((c: any) => {
        if (c.status !== 'free' && c.currentOrder && !activeOrderIds.has(String(c.currentOrder))) {
          tablesDirty = true;
          saveToSupabase('comandas', { ...c, status: 'free', currentOrder: null, linkedTo: null }, c.id.toString(), tenantId).catch(() => {});
          return { ...c, status: 'free', currentOrder: null, linkedTo: null };
        }
        return c;
      });
      if (tablesDirty) {
        io.to(room).emit('update_tables', st.tables);
        io.to(room).emit('update_comandas', st.comandas);
        console.log(`[supabase][${tenantId}] Mesas/comandas inconsistentes liberadas`);
      }

      st.loaded = true;
      console.log(`[supabase][${tenantId}] Carga concluída`);
    } catch (e) {
      console.error(`[supabase][${tenantId}] Erro na carga:`, e);
      st.loaded = false;
      throw e;
    }
  };

  // Trava por tenant: evita cargas paralelas do mesmo tenant em qualquer modo
  // de banco. O startup PostgreSQL tambem participa desta barreira.
  const _loadingTenants = new Map<string, Promise<void>>();
  let startupReady: Promise<void> = Promise.resolve();
  const loadTenantIfNeeded = (tenantId: string): Promise<void> => {
    const st = getState(tenantId);
    // Se carregado mas sem mesas, o estado ficou obsoleto (tenant carregado antes das mesas
    // serem semeadas no Supabase). Força recarga para buscar os dados atualizados.
    if (st.loaded && st.tables.length === 0) st.loaded = false;
    if (st.loaded) return Promise.resolve();
    if (_loadingTenants.has(tenantId)) return _loadingTenants.get(tenantId)!;
    if (USE_POSTGRES && tenantId !== 'default') {
      return Promise.reject(new Error(`Tenant ${tenantId} nao esta disponivel no modo PostgreSQL local`));
    }
    const p = (USE_POSTGRES ? startupReady : loadTenantData(tenantId))
      .finally(() => _loadingTenants.delete(tenantId));
    _loadingTenants.set(tenantId, p);
    return p;
  };

  // ── Seed: subcategorias de bebidas ──────────────────────────────────────────
  const seedBebidasSubcategories = async (tenantId: string) => {
    const st = getState(tenantId);
    const menu = st.menu;
    const SUBCATS: { name: string; items: { name: string; price: number }[] }[] = [
      { name: 'Vinhos', items: [
        { name: 'Pérgola Tinto Suave — Garrafa', price: 65 },
        { name: 'Pérgola Tinto Suave — Taça', price: 18 },
      ]},
      { name: 'Doses e Destilados', items: [
        { name: 'Dose Black Label', price: 24 },
        { name: 'Dose Campari', price: 18 },
        { name: 'Dose Velho Barreiro', price: 8 },
        { name: 'Dose Vodka', price: 12 },
        { name: 'Dose Jack Daniels', price: 0 },
        { name: 'Dose Old Parr', price: 26 },
        { name: 'Dose Red Label', price: 22 },
        { name: 'Red Bull Energético', price: 17 },
      ]},
      { name: 'Refrigerantes', items: [
        { name: 'Coca-Cola 1 L', price: 12 },
        { name: 'Coca-Cola KS', price: 7 },
        { name: 'Coca-Cola Lata', price: 8 },
        { name: 'Coca-Cola Lata Zero', price: 8 },
        { name: 'Fanta 1 L', price: 12 },
        { name: 'Fanta Laranja KS', price: 7 },
        { name: 'Fanta Laranja Lata', price: 7 },
        { name: 'Fanta Uva Lata', price: 7 },
        { name: 'Guaraná Antarctica Lata', price: 7 },
        { name: 'H2O 500 ml', price: 10 },
        { name: 'Schweppes Lata', price: 7 },
        { name: 'Sprite Lata', price: 7 },
        { name: 'Torre de Refrigerante 1,5 L', price: 18 },
      ]},
      { name: 'Sucos — Copos', items: [
        { name: 'Abacaxi', price: 15 },
        { name: 'Abacaxi com Hortelã', price: 15 },
        { name: 'Acerola', price: 15 },
        { name: 'Cupuaçu', price: 16 },
        { name: 'Laranja', price: 18 },
        { name: 'Maracujá', price: 16 },
        { name: 'Morango', price: 15 },
      ]},
      { name: 'Sucos — Jarras', items: [
        { name: 'Abacaxi', price: 24 },
        { name: 'Abacaxi com Hortelã', price: 24 },
        { name: 'Acerola', price: 24 },
        { name: 'Cupuaçu', price: 26 },
        { name: 'Laranja', price: 33 },
        { name: 'Morango', price: 24 },
        { name: 'Maracujá', price: 26 },
      ]},
      { name: 'Outros Sucos', items: [
        { name: 'Suco Kapo', price: 7 },
      ]},
      { name: 'Cervejas', items: [
        { name: 'Antarctica Original', price: 18 },
        { name: 'Brahma', price: 14 },
        { name: 'Brahma Zero Lata', price: 7 },
        { name: 'CDB', price: 3 },
        { name: 'Corona 600 ml', price: 22 },
        { name: 'Heineken', price: 22 },
        { name: 'Skol', price: 14 },
      ]},
      { name: 'Cervejas Long Neck', items: [
        { name: 'Budweiser', price: 11 },
        { name: 'Budweiser Zero', price: 11 },
        { name: 'Corona Extra Long', price: 12 },
        { name: 'Heineken Long Neck', price: 12 },
        { name: 'Stella Gold', price: 12 },
      ]},
      { name: 'Chopp', items: [
        { name: 'Caneca Cozumel 340 ml', price: 12 },
        { name: 'Chopp 1,5 L', price: 42 },
        { name: 'Chopp 1 L', price: 30 },
        { name: 'Chopp 2,5 L', price: 80 },
        { name: 'Chopp Caneca 340 ml', price: 10 },
        { name: 'Tulipinha Chopp 250 ml', price: 9 },
        { name: 'Tulipinha Chopp Cozumel 250 ml', price: 10 },
      ]},
      { name: 'Águas', items: [
        { name: 'Água com Gás', price: 6 },
        { name: 'Água sem Gás', price: 5 },
        { name: 'Água Tônica', price: 7 },
      ]},
      { name: 'Outros Itens', items: [
        { name: 'Embalagem Grande', price: 5 },
        { name: 'Embalagem Pequena', price: 3 },
        { name: 'Meio Rodízio — 5 a 10 anos', price: 31 },
        { name: 'Play Kids', price: 12 },
        { name: 'Rodízio', price: 65 },
      ]},
    ];

    const bebidasIdx = menu.findIndex((c: any) => c.type === 'bebidas' || c.name?.toLowerCase().includes('bebida'));
    if (bebidasIdx === -1) { console.log('[seed-bebidas] Categoria bebidas não encontrada'); return; }

    const cat = menu[bebidasIdx];
    const existingSubNames = (cat.subcategories || []).map((s: any) => s.name);
    const toAdd = SUBCATS.filter(s => !existingSubNames.includes(s.name));
    if (toAdd.length === 0) { console.log('[seed-bebidas] Todas as subcategorias já existem, nada a fazer.'); return; }

    const newSubs = toAdd.map((s, pos) => ({
      id: randomUUID(),
      name: s.name,
      position: (cat.subcategories || []).length + pos,
      visible: true,
      trackTime: false,
      items: s.items.map(item => ({ id: randomUUID(), name: item.name, price: item.price, visible: true })),
    }));

    st.menu[bebidasIdx] = { ...cat, subcategories: [...(cat.subcategories || []), ...newSubs] };
    if (db) {
      const { error } = await db.from('menu').upsert({ id: `${tenantId}:${cat.name}`, name: cat.name, position: bebidasIdx, type: 'bebidas', visible: true, items: st.menu[bebidasIdx].items || [], subcategories: st.menu[bebidasIdx].subcategories, tenant_id: tenantId });
      if (error) { console.error('[seed-bebidas] Erro ao salvar:', error.message); return; }
    } else {
      await saveToSupabase('menu', st.menu[bebidasIdx], cat.name, tenantId).catch(() => {});
    }
    io.to('tenant:' + tenantId).emit('update_menu', st.menu);
    console.log(`[seed-bebidas][${tenantId}] ${newSubs.length} subcategorias adicionadas à categoria bebidas.`);
  };

  // Daily order counter state
  const COUNTER_FILE = path.join(os.tmpdir(), 'sistema-pdv-flow-order-counter.json');
  let counterData = { dailyCounter: 0, lastOrderDate: "" };
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      counterData = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error("Error reading counter file", e);
  }

  // Legacy counter kept for PostgreSQL single-instance mode
  let _pgDailyCounter = counterData.dailyCounter;
  let _pgLastOrderDate = counterData.lastOrderDate;

  const saveCounter = (st: TenantState) => {
    try {
      fs.writeFileSync(COUNTER_FILE, JSON.stringify({ dailyCounter: st.dailyCounter, lastOrderDate: st.lastOrderDate }));
    } catch (e) {
      console.error("Error saving counter file", e);
    }
  };

  const generateOrderId = (st: TenantState, tenantId: string) => {
    const now = new Date();
    const dateStr = now.getDate().toString().padStart(2, '0') +
                    (now.getMonth() + 1).toString().padStart(2, '0') +
                    now.getFullYear().toString();
    if (dateStr !== st.lastOrderDate) {
      st.dailyCounter = 1;
      st.lastOrderDate = dateStr;
    } else {
      st.dailyCounter++;
    }
    if (USE_POSTGRES) saveCounter(st);
    // Preservar o estado lógico completo do caixa em cada upsert parcial.
    saveToSupabase('config', cashRegisterConfigPatch(st, { dailyCounter: st.dailyCounter, lastOrderDate: st.lastOrderDate }), 'app', tenantId).catch(() => {});
    return `${dateStr}${st.dailyCounter.toString().padStart(4, '0')}`;
  };

  // ── Sessões do cliente por mesa (keyed by tenantId) ───────────
  const clientSessions = new Map<string, { token: string; lastActivity: number; isComanda: boolean }>();
  const generateClientToken = () => Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  const activateClientSession = (tenantId: string, mesaId: number | string, isComanda: boolean) => {
    const key = `${tenantId}:${isComanda ? 'c' : 't'}:${mesaId}`;
    clientSessions.set(key, { token: generateClientToken(), lastActivity: Date.now(), isComanda });
  };
  const invalidateClientSession = (tenantId: string, mesaId: number | string, isComanda: boolean) => {
    clientSessions.delete(`${tenantId}:${isComanda ? 'c' : 't'}:${mesaId}`);
  };
  const getClientSession = (tenantId: string, mesaId: number | string, isComanda: boolean) => {
    return clientSessions.get(`${tenantId}:${isComanda ? 'c' : 't'}:${mesaId}`) || null;
  };
  setInterval(() => {
    const timeoutMin = (typeof pizzariaConfig !== 'undefined' ? (pizzariaConfig as any) : {}).clientSessionTimeoutMin ?? 0;
    if (timeoutMin <= 0) return;
    const now = Date.now();
    clientSessions.forEach((_session, key) => {
      const s = clientSessions.get(key)!;
      if (now - s.lastActivity > timeoutMin * 60 * 1000) clientSessions.delete(key);
    });
  }, 60_000);

  // â"€â"€ Local state backup â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const LOCAL_BACKUP_FILE = path.join(process.cwd(), 'data', 'local-state.json');
  let _backupTimer: ReturnType<typeof setTimeout> | null = null;

  const saveLocalBackup = (st?: TenantState) => {
    // Only used in PostgreSQL single-instance mode
    if (!USE_POSTGRES) return;
    const state = st || getState('default');
    if (_backupTimer) clearTimeout(_backupTimer);
    _backupTimer = setTimeout(() => {
      try {
        const dir = path.dirname(LOCAL_BACKUP_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LOCAL_BACKUP_FILE, JSON.stringify({
          orders: state.orders, tables: state.tables, comandas: state.comandas,
          waiters: state.waiters, menu: state.menu, stock: state.stock, stockLog: state.stockLog,
          isCashRegisterOpen: state.isCashRegisterOpen, pizzariaConfig: state.pizzariaConfig,
          savedAt: new Date().toISOString()
        }), 'utf-8');
      } catch (e) {
        console.error('[backup] Erro ao salvar estado local:', e);
      }
    }, 800);
  };

  const loadLocalBackup = (): boolean => {
    if (!USE_POSTGRES) return false;
    try {
      if (!fs.existsSync(LOCAL_BACKUP_FILE)) return false;
      const state = JSON.parse(fs.readFileSync(LOCAL_BACKUP_FILE, 'utf-8'));
      const st = getState('default');
      if (state.orders?.length) st.orders = state.orders;
      if (state.tables?.length) state.tables.forEach((t: any) => {
        const idx = st.tables.findIndex((tt: any) => tt.id === t.id);
        if (idx !== -1) st.tables[idx] = { ...st.tables[idx], ...t };
      });
      if (state.comandas?.length) state.comandas.forEach((c: any) => {
        const idx = st.comandas.findIndex((cc: any) => cc.id === c.id);
        if (idx !== -1) st.comandas[idx] = { ...st.comandas[idx], ...c };
      });
      if (state.waiters?.length) st.waiters = state.waiters;
      if (state.menu?.length) st.menu = state.menu;
      if (state.stock?.length) st.stock = state.stock;
      if (state.stockLog?.length) st.stockLog = state.stockLog;
      if (state.isCashRegisterOpen !== undefined) st.isCashRegisterOpen = state.isCashRegisterOpen;
      if (state.pizzariaConfig) st.pizzariaConfig = { ...st.pizzariaConfig, ...state.pizzariaConfig };
      const age = state.savedAt ? Math.round((Date.now() - new Date(state.savedAt).getTime()) / 60000) : null;
      console.log(`[backup] Estado local restaurado (salvo ${age !== null ? `há ${age} min` : 'anteriormente'})`);
      return true;
    } catch (e) {
      console.error('[backup] Erro ao carregar estado local:', e);
      return false;
    }
  };

  if (USE_POSTGRES) { loadLocalBackup(); saveLocalBackup(); }

  const getEffectiveItemPrice = (item: any) => {
    let price = Number(item.price) || 0;
    if (item.discount) {
      if (item.discountType === 'percentage') {
        price *= (1 - Number(item.discount) / 100);
      } else {
        price = Math.max(0, price - Number(item.discount));
      }
    }
    return price;
  };

  const applyStockReduction = (st: TenantState, tenantId: string, items: any[]) => {
    const room = 'tenant:' + tenantId;
    const newEntries: any[] = [];
    const lowAlerts: { name: string; quantity: number; minQuantity: number }[] = [];
    const updatedStockEntries: any[] = [];
    items.forEach(item => {
      const qty = item.quantity || 1;
      const entry = st.stock.find((s: any) =>
        (item.menuItemId && s.menuItemId === item.menuItemId) || s.name === item.name
      );
      if (entry) {
        st.stock = st.stock.map((s: any) => {
          if (s.id === entry.id) {
            const newQty = s.quantity - qty;
            newEntries.push({ id: randomUUID(), itemName: s.name, change: -qty, reason: 'Venda', timestamp: new Date().toISOString() });
            // Alert when stock reaches or drops below minQuantity
            if (s.minQuantity > 0 && newQty <= s.minQuantity && s.quantity > s.minQuantity) {
              lowAlerts.push({ name: s.name, quantity: newQty, minQuantity: s.minQuantity });
            }
            const updated = { ...s, quantity: newQty };
            updatedStockEntries.push(updated);
            return updated;
          }
          return s;
        });
      }
    });
    if (newEntries.length > 0) {
      st.stockLog = [...newEntries, ...st.stockLog].slice(0, 100);
      io.to(room).emit("update_stock_log", st.stockLog);
      saveToSupabase('config', { stockLog: st.stockLog }, 'stockLog', tenantId).catch(() => {});
    }
    io.to(room).emit("update_stock", st.stock);
    if (lowAlerts.length > 0) {
      io.to(room).emit("stock_low_alert", lowAlerts);
    }
    for (const updated of updatedStockEntries) {
      saveToSupabase('stock', updated, updated.menuItemId || updated.id, tenantId);
    }
  };

  const AGENT_SECRET = process.env.AGENT_SECRET || '';
  // DOTCOMPANY_API_KEY removida — integração direta SEFAZ-MT
  const DOTCOMPANY_API_KEY = ''; // mantido para evitar erros de compilação em código legado não removido ainda

  // ── Socket.io logic ───────────────────────────────────────────────────────
  // O modo de desenvolvimento não concede identidade, tenant ou papel. Um
  // token Supabase real continua sendo obrigatório para o painel ADM.
  const isDevMode = !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NODE_ENV !== 'production';

  // Metadata is embedded into both bundles by the same build, including Docker.
  const appVersion = {
    buildId: __BUILD_ID__,
    version: __BUILD_VERSION__,
    builtAt: __BUILD_TS__,
  };

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    // Keep the numeric event for legacy clients, without a separate version number.
    socket.emit("server_version", LATEST_PR);
    socket.emit("app_version", appVersion);
    // A mounted client can ask again if it missed the initial connection event.
    socket.on("request_app_version", () => socket.emit("app_version", appVersion));

    const isPlaygroundConnection = String(socket.handshake.query?.app || '') === 'parquinho';
    // Lê o tenant do query param da URL (?tenant=<id>) — usado por garçons e clientes.
    // A conexão dedicada do Parquinho nunca entra na sala tenant:<id>.
    const queryTenant = (socket.handshake.query?.tenant as string) || '';
    if (queryTenant && !isPlaygroundConnection) {
      // Query selection is only a hint for waiter registration/login. It is
      // deliberately not a room membership or an authorization decision.
      (socket as any).tenantId = queryTenant;
      (socket as any).pendingTenantId = queryTenant;
    }

    socket.on("admin_connect", async (token) => {
      try {
        if ((socket as any).__commandTenantId) {
          socket.emit("auth_error", { message: "Aguarde o comando do tenant atual terminar antes de trocar de conta." });
          return;
        }
        if (isPlaygroundConnection || typeof token !== 'string' || !token) {
          socket.emit("auth_error", { message: "Token administrativo inválido" });
          return;
        }
        if (!db) {
          socket.emit("auth_error", { message: "Autenticação administrativa indisponível" });
          return;
        }
        // Marca que admin_connect está em andamento para que request_init_data
        // ignore requisições do fallback timer enquanto o JWT está sendo verificado.
        (socket as any).__adminConnectPending = true;
        const authResult = await db.auth.getUser(token);
        if (authResult?.error || !authResult?.data?.user?.id) {
          socket.emit("auth_error", { message: "Token administrativo inválido" });
          return;
        }
        const user = authResult.data.user;
        const tenantId: string = String(user.id);
        // Reserve the authenticated owner identity while loading, but do not
        // authorize private commands until the authoritative tenant snapshot is ready.
        delete (socket as any).isAdmin;
        (socket as any).authContext = { role: 'admin', tenantId, ready: false };
        const tenantGeneration = switchSocketTenant(socket, tenantId);
        await loadTenantIfNeeded(tenantId);
        if (!socket.connected || (socket as any).tenantId !== tenantId ||
            (socket as any).tenantGeneration !== tenantGeneration ||
            !authActorSafe((socket as any).authContext) ||
            (socket as any).authContext.tenantId !== tenantId) return;
        (socket as any).authContext.ready = true;
        (socket as any).isAdmin = true;
        const st = getState(tenantId);
        socket.emit("init_data", {
          tenantId,
          ready: true,
          buildId: __BUILD_ID__,
          waiters: publicWaiters(st.waiters), orders: st.orders, tables: st.tables, comandas: st.comandas,
          stock: st.stock, stockLog: st.stockLog, menu: st.menu,
          pizzaFlavors: st.pizzaFlavors, pizzaCrusts: st.pizzaCrusts, pizzaSizes: st.pizzaSizes,
          isCashRegisterOpen: st.isCashRegisterOpen, shiftStartedAt: st.shiftStartedAt,
          openCashRegisterNames: getOpenCashRegisterNames(st.openCashRegisters),
          pizzariaConfig: st.pizzariaConfig, firebaseActive: !!db,
          printerAgentOnline: !!(st.printerAgentSocket?.connected), serverNow: new Date().toISOString(),
        });
        // Se há agentes aguardando pareamento, avisar o admin recém-conectado
        if (pendingAgents.size > 0) {
          pendingAgents.forEach((agentSock, agentSocketId) => {
            if (agentSock.connected) {
              socket.emit("printer_agent_pairing_available", { socketId: agentSocketId });
            } else {
              pendingAgents.delete(agentSocketId);
            }
          });
        }
        console.log(`Admin connected: ${user.email || user.id} (tenant: ${tenantId})`);
      } catch (e) {
        console.error("Error in admin_connect", e);
        const actor = authActorSafe((socket as any).authContext);
        if (actor?.role === 'admin') {
          leaveTenantRooms(socket);
          delete (socket as any).isAdmin;
          delete (socket as any).authContext;
          delete (socket as any).tenantId;
        }
        socket.emit("auth_error", { message: "Erro de autenticação" });
      } finally {
        delete (socket as any).__adminConnectPending;
      }
    });

    // ── Registro do agente de impressão local ────────────────────────────────
    socket.on("printer_agent_register", ({ secret, tenantId: agentTenantId }: { secret?: string; pairingCode?: string; tenantId?: string }) => {
      if (AGENT_SECRET && secret !== AGENT_SECRET) {
        socket.emit("printer_agent_rejected", "Segredo inválido.");
        console.warn(`[agent] Tentativa de registro rejeitada (socket ${socket.id})`);
        return;
      }
      // Without the shared secret, a tenant supplied by an anonymous agent is
      // not an identity. It must remain pending until an authenticated ADM
      // claims it; never route printer data by a caller-controlled UUID.
      const tid = AGENT_SECRET ? (agentTenantId || (socket as any).tenantId || '') : '';
      (socket as any).isPrinterAgent = true;

      if (!tid || tid === 'default') {
        // Agente sem tenant configurado — entra em modo de pareamento
        leaveTenantRooms(socket);
        (socket as any).pendingPairing = true;
        pendingAgents.set(socket.id, socket);
        socket.emit("printer_agent_pairing_needed", { socketId: socket.id });
        // Notifica apenas administradores autenticados sobre o pareamento.
        io.sockets.sockets.forEach((candidate: any) => {
          if (authActorSafe(candidate.authContext)?.role === 'admin' && candidate.authContext.tenantId === String(candidate.tenantId || '')) {
            candidate.emit("printer_agent_pairing_available", { socketId: socket.id });
          }
        });
        console.log(`[agent] Agente aguardando pareamento: ${socket.id}`);
        return;
      }

      switchSocketTenant(socket, tid);
      const st = getState(tid);
      st.printerAgentSocket = socket;
      socket.emit("printer_agent_accepted");
      socket.emit("printer_agent_paired");
      io.to('tenant:' + tid).emit("printer_agent_status", { online: true });
      setTimeout(() => { if (st.printerAgentSocket) st.printerAgentSocket.emit("scan_printers_request"); }, 500);
      console.log(`[agent] Agente conectado: ${socket.id} (tenant: ${tid})`);
    });

    // Admin aceita pareamento de um agente pendente
    socket.on("claim_printer_agent", ({ agentSocketId }: { agentSocketId: string }) => {
      const tid = (socket as any).tenantId;
      if (!tid || !isAdminForTenant(String(tid))) {
        socket.emit("error_message", "Não autorizado.");
        return;
      }
      const agentSocket = pendingAgents.get(agentSocketId);
      if (!agentSocket || !agentSocket.connected) {
        socket.emit("error_message", "Agente não encontrado ou desconectado.");
        return;
      }
      pendingAgents.delete(agentSocketId);
      (agentSocket as any).pendingPairing = false;
      switchSocketTenant(agentSocket, tid);
      const st = getState(tid);
      st.printerAgentSocket = agentSocket;
      agentSocket.emit("printer_agent_accepted");
      agentSocket.emit("printer_agent_paired");
      // Envia config.json com tenantId para o agente salvar localmente
      agentSocket.emit("printer_agent_config_update", { tenantId: tid });
      io.to('tenant:' + tid).emit("printer_agent_status", { online: true });
      setTimeout(() => { if (st.printerAgentSocket) st.printerAgentSocket.emit("scan_printers_request"); }, 500);
      console.log(`[agent] Agente ${agentSocketId} pareado com tenant ${tid}`);
    });

    socket.on("disconnect", () => {
      const tenantId = (socket as any).tenantId || 'default';
      if ((socket as any).isPrinterAgent) {
        const st = getState(tenantId);
        st.printerAgentSocket = null;
        io.to('tenant:' + tenantId).emit("printer_agent_status", { online: false });
        console.log(`[agent] Agente desconectado (tenant: ${tenantId})`);
      }
      const stDis = getState(tenantId);
      if (stDis.printSocket?.id === socket.id) stDis.printSocket = null;
      const releasedCashRegisters = releaseCashRegisterClaims(stDis.openCashRegisters, socket.id);
      if (JSON.stringify(releasedCashRegisters) !== JSON.stringify(stDis.openCashRegisters)) {
        stDis.openCashRegisters = releasedCashRegisters;
        saveToSupabase('config', cashRegisterConfigPatch(stDis), 'app', tenantId).catch(() => {});
        io.to('tenant:' + tenantId).emit('update_open_cash_register_names', getOpenCashRegisterNames(releasedCashRegisters));
      }
      if (USE_POSTGRES) saveLocalBackup(getState('default'));
    });

    // Resultado de impressão enviado pelo agente → repassa ao tenant
    socket.on("printer_agent_result", (result: { success: boolean; ip: string; error?: string }) => {
      const tenantId = (socket as any).tenantId || 'default';
      const activeState = getState(tenantId);
      if (activeState.printerAgentSocket?.id !== socket.id) return;
      io.to('tenant:' + tenantId).emit("print_result", result);
    });

    // Resultado do scan enviado pelo agente → repassa ao dashboard apenas se for o agente registrado
    socket.on("scan_printers_result", (data: { printers: { ip: string; port: number }[] }) => {
      const tenantId = (socket as any).tenantId || 'default';
      const st = getState(tenantId);
      // Ignora resultado de agente que não é o agente ativo deste tenant
      if (st.printerAgentSocket?.id !== socket.id) return;
      io.to('tenant:' + tenantId).emit("scan_printers_result", data);
    });

    // Per-socket tenant helpers. A queued command pins this value so a later
    // tenant switch cannot redirect an awaited mutation to another account.
    const _tid = (): string =>
      String((socket as any).__commandTenantId ||
        (socket as any).authContext?.tenantId ||
        (socket as any).tenantId || 'default');
    const _st = (): TenantState => getState(_tid());
    const _room = (): string => 'tenant:' + _tid();
    const isAdminForTenant = (tenantId: string): boolean => {
      const actor = authActorSafe((socket as any).authContext);
      return Boolean((socket as any).isAdmin && (socket as any).authContext?.ready === true &&
        actor?.role === 'admin' && actor.tenantId === tenantId);
    };
    const waiterForTenant = (tenantId: string): any => {
      const actor = authActorSafe((socket as any).authContext);
      if (!actor || actor.role !== 'waiter' || actor.tenantId !== tenantId) return null;
      const waiter = getState(tenantId).waiters.find((candidate: any) => String(candidate.id) === actor.waiterId);
      return isWaiterActorForTenant(actor, tenantId, waiter) ? waiter : null;
    };
    const isApprovedWaiterSocket = (tenantId = _tid()): boolean => {
      if (isAdminForTenant(tenantId)) return true;
      return isApprovedWaiter(waiterForTenant(tenantId));
    };
    const onTenantCommand = (event: string, handler: (...args: any[]) => any) => {
      socket.on(event, (...args: any[]) => {
        const tenantId = String((socket as any).authContext?.tenantId || (socket as any).tenantId || '').trim();
        if (!tenantId || !isApprovedWaiterSocket(tenantId)) {
          socket.emit('auth_error', { message: 'Autentique um garçom aprovado ou administrador.' });
          return Promise.resolve(false);
        }
        return withTenantCommand(tenantId, async () => {
          if (!isApprovedWaiterSocket(tenantId)) {
            socket.emit('auth_error', { message: 'Sessão alterada; autentique novamente neste tenant.' });
            return false;
          }
          const previousTenant = (socket as any).__commandTenantId;
          (socket as any).__commandTenantId = tenantId;
          try {
            return await handler(...args);
          } finally {
            if (previousTenant === undefined) delete (socket as any).__commandTenantId;
            else (socket as any).__commandTenantId = previousTenant;
          }
        });
      });
    };

    const requireAdmin = (handler: (...args: any[]) => void) => {
      return (...args: any[]) => {
        const ack = [...args].reverse().find((candidate: any) => typeof candidate === 'function') as ((result: any) => void) | undefined;
        if (!isAdminForTenant(_tid())) {
          socket.emit("error_message", "Acesso restrito ao administrador.");
          ack?.({ ok: false, message: "Acesso restrito ao administrador." });
          return Promise.resolve(false);
        }
        return Promise.resolve(handler(...args));
      };
    };

    const playgroundReservedMessage = 'Use o aplicativo Parquinho para lançar este item.';
    const menuItems = (menu: any[] = _st().menu): any[] => (Array.isArray(menu) ? menu : []).flatMap((category: any) => [
      ...(Array.isArray(category?.items) ? category.items : []),
      ...(Array.isArray(category?.subcategories) ? category.subcategories.flatMap((subcategory: any) => (
        Array.isArray(subcategory?.items) ? subcategory.items : []
      )) : []),
    ]);
    const findMenuItem = (productId: any): any => menuItems().find((item: any) => String(item?.id ?? '') === String(productId ?? ''));
    const rejectPlaygroundReserved = () => {
      socket.emit('error_message', playgroundReservedMessage);
      return false;
    };
    const hasReservedMenuItem = (value: any): boolean => {
      if (isPlaygroundReservedItem(value, _tid())) return true;
      if (Array.isArray(value)) return value.some(hasReservedMenuItem);
      if (!value || typeof value !== 'object') return false;
      return Object.values(value).some((child: any) => Array.isArray(child) || (child && typeof child === 'object') ? hasReservedMenuItem(child) : false);
    };

    registerPlaygroundSocketHandlers({
      socket,
      io,
      db,
      usePostgres: USE_POSTGRES,
      buildId: __BUILD_ID__,
      getTenantId: _tid,
      getState,
      loadTenantIfNeeded: loadTenantIfNeeded,
      enqueueWrite,
      saveToSupabase,
      generateOrderId,
      withTenantCommand,
      rowToOrder,
      rowToTable,
      isAdmin: () => !!(socket as any).isAdmin,
      isDedicatedConnection: () => isPlaygroundConnection,
    });

    // A playground socket is a capability-limited connection, not a waiter,
    // printer, client, or admin socket. Socket.IO middleware runs before every
    // event listener, so direct attempts to use a hidden legacy event are
    // rejected instead of relying on the terminal UI.
    socket.use(([eventName], next) => {
      if (!isPlaygroundConnection) return next();
      const event = String(eventName || '');
      const adminEvent = event === 'parquinho_get_operators' || event === 'parquinho_set_operator_status' || event === 'parquinho_get_report';
      if (!isPlaygroundOperatorSocketEventAllowed(event) && !adminEvent) {
        return next(new Error('Evento não disponível para o operador de Parquinho.'));
      }
      return next();
    });

    // Admin dashboard registra-se como socket de impressão exclusivo do tenant
    socket.on("register_print_socket", () => {
      if (!isAdminForTenant(_tid())) return;
      _st().printSocket = socket;
    });

    // Emite kitchen_print_order somente para o socket admin registrado; fallback para room se não houver
    const emitPrintOrder = (payload: any) => {
      const ps = _st().printSocket;
      if (ps?.connected) {
        ps.emit("kitchen_print_order", payload);
      } else {
        io.to(_room()).emit("kitchen_print_order", payload);
      }
    };

    // init_data is sent after admin_connect (with per-tenant state); skip here for non-dev
    if (isDevMode && (socket as any).isAdmin) {
      const defSt = getState('default');
      socket.emit("init_data", {
        tenantId: 'default',
        ready: true,
        buildId: __BUILD_ID__,
        waiters: publicWaiters(defSt.waiters), orders: defSt.orders, tables: defSt.tables, comandas: defSt.comandas,
        stock: defSt.stock, stockLog: defSt.stockLog, menu: defSt.menu,
        pizzaFlavors: defSt.pizzaFlavors, pizzaCrusts: defSt.pizzaCrusts, pizzaSizes: defSt.pizzaSizes,
        isCashRegisterOpen: defSt.isCashRegisterOpen, shiftStartedAt: defSt.shiftStartedAt,
        openCashRegisterNames: getOpenCashRegisterNames(defSt.openCashRegisters),
        pizzariaConfig: defSt.pizzariaConfig, firebaseActive: !!db,
        printerAgentOnline: !!(defSt.printerAgentSocket?.connected), serverNow: new Date().toISOString(),
      });
    }

    socket.on("request_init_data", async (request: any = {}, maybeAck?: (ack: any) => void) => {
      const ack = typeof maybeAck === 'function'
        ? maybeAck
        : typeof request === 'function' ? request : undefined;
      const tid = String((socket as any).authContext?.tenantId || (socket as any).tenantId || '').trim();
      if (!tid) {
        ack?.({ ok: false, message: 'Estabelecimento não identificado.' });
        return;
      }
      const admin = isAdminForTenant(tid);
      const actor = authActorSafe((socket as any).authContext);
      const preloadedWaiter = admin ? null : waiterForTenant(tid);
      if (!admin && !isApprovedWaiter(preloadedWaiter)) {
        // Se admin_connect está em andamento (verificando JWT ou carregando tenant),
        // retornar silenciosamente — init_data chegará quando admin_connect concluir.
        if ((socket as any).authContext?.role === 'admin' || (socket as any).__adminConnectPending) {
          ack?.({ ok: false, status: 'pending' });
          return;
        }
        socket.emit('auth_error', { message: 'Autentique um garçom aprovado antes de carregar o PDV.' });
        ack?.({ ok: false, status: 'rejected', message: 'Autentique um garçom aprovado antes de carregar o PDV.' });
        return;
      }
      const tenantGeneration = (socket as any).tenantGeneration;
      try {
        await loadTenantIfNeeded(tid);
        if (socket.connected === false || (socket as any).tenantId !== tid ||
            (socket as any).tenantGeneration !== tenantGeneration) return;
        if (admin ? !isAdminForTenant(tid) : !isApprovedWaiter(waiterForTenant(tid))) return;
        // Garante que o socket do garçom está no tenant room para receber broadcasts futuros
        if (!admin) socket.join(`tenant:${tid}`);
        const currentActor = authActorSafe((socket as any).authContext);
        const st = getState(tid);
        const ownWaiter = admin ? null : waiterForTenant(tid);
        const safeOwnWaiter = sanitizeWaiter(ownWaiter);
        const snapshot: any = {
          tenantId: tid,
          ready: true,
          buildId: __BUILD_ID__,
          waiters: admin ? publicWaiters(st.waiters) : projectWaitersForActor(st.waiters, currentActor),
          orders: st.orders, tables: st.tables, comandas: st.comandas,
          stock: st.stock, stockLog: st.stockLog, menu: st.menu,
          pizzaFlavors: st.pizzaFlavors, pizzaCrusts: st.pizzaCrusts, pizzaSizes: st.pizzaSizes,
          isCashRegisterOpen: st.isCashRegisterOpen, shiftStartedAt: st.shiftStartedAt,
          openCashRegisterNames: getOpenCashRegisterNames(st.openCashRegisters),
          pizzariaConfig: st.pizzariaConfig, firebaseActive: !!db,
          printerAgentOnline: !!(st.printerAgentSocket?.connected), serverNow: new Date().toISOString(),
          printerConfig: Object.keys(st.printerConfig || {}).length > 0 ? st.printerConfig : undefined,
        };
        if (!admin && safeOwnWaiter) snapshot.currentWaiter = safeOwnWaiter;
        socket.emit("init_data", snapshot);
        ack?.({ ok: true, ...(safeOwnWaiter ? { status: safeOwnWaiter.status, waiter: safeOwnWaiter } : {}) });
      } catch (error: any) {
        console.error(`[init_data] falha ao carregar tenant ${tid}:`, error?.message || error);
        socket.emit("auth_error", { message: "Não foi possível carregar os dados deste tenant." });
        ack?.({ ok: false, message: 'Não foi possível carregar os dados deste tenant.' });
      }
    });

    socket.on("save_printer_config", requireAdmin((config: any) => {
      if (!config || typeof config !== 'object' || Array.isArray(config)) return;
      _st().printerConfig = config;
      saveToSupabase('config', config, 'printerConfig', _tid()).catch(console.error);
    }));

    socket.on("update_pizzaria_config", requireAdmin(async (config: any, rawAck?: any) => {
      const ack = typeof rawAck === 'function' ? rawAck : undefined;
      const tenantId = _tid();
      const state = _st();
      const previousConfig = clonePersistenceData(state.pizzariaConfig || {});
      const previousMenu = clonePersistenceData(state.menu || []);
      const fail = (message: string) => {
        socket.emit('error_message', message);
        ack?.({ ok: false, message });
        return { ok: false, message };
      };

      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return fail('Configuração inválida.');
      }

      const mergedConfig = { ...previousConfig, ...config };
      const normalizedConfig = normalizePlaygroundConfig(tenantId, mergedConfig);
      const nextConfig = {
        ...mergedConfig,
        parquinhoEnabled: normalizedConfig.parquinhoEnabled,
        parquinhoChildNameRequired: normalizedConfig.parquinhoChildNameRequired,
        parquinhoPrice: normalizedConfig.parquinhoPrice,
        parquinhoProductId: normalizedConfig.parquinhoProductId,
      };

      try {
        // Persist the validated config before broadcasting it. The catalog
        // reconciliation below only changes the managed product, never orders.
        await saveToSupabase('config', nextConfig, 'pizzaria', tenantId);
        const catalog = synchronizePlaygroundCatalog(state.menu, tenantId, nextConfig);
        if (catalog.changed) {
          state.menu = catalog.menu;
          await saveMenuToSupabaseAwait(state, tenantId);
        }
        state.pizzariaConfig = nextConfig;
        if (catalog.changed) io.to(_room()).emit('update_menu', state.menu);
        io.to(_room()).emit("update_pizzaria_config", state.pizzariaConfig);
        const response = { ok: true, message: 'Configuração salva.', config: state.pizzariaConfig, pizzariaConfig: state.pizzariaConfig };
        ack?.(response);
        return response;
      } catch (error: any) {
        // Do not expose a new config or a partially reconciled menu after a
        // failed SDK/DB write. Best-effort persistence rollback keeps the
        // authoritative snapshot aligned when the first write succeeded.
        state.pizzariaConfig = previousConfig;
        state.menu = previousMenu;
        try { await saveToSupabase('config', previousConfig, 'pizzaria', tenantId); } catch { /* preserve original failure */ }
        return fail(error?.message || 'Não foi possível salvar a configuração.');
      }
    }));

    registerKitchenSocketHandlers({
      socket,
      io,
      getTenantId: _tid,
      getState,
      withTenantCommand,
      saveOrder: (order, orderId, tenantId) => saveToSupabase('orders', order, orderId, tenantId),
      isAdmin: () => !!(socket as any).isAdmin,
    });

    socket.on("waiter_identify_tenant", async ({ tenantId }: { tenantId: string } = {} as any) => {
      const tid = String(tenantId || '').trim();
      if (!tid) return;
      if ((socket as any).__commandTenantId) {
        socket.emit('auth_error', { message: 'Aguarde o comando atual terminar antes de trocar de tenant.' });
        return;
      }
      // A tenant hint cannot retarget an already authenticated owner/admin.
      if ((socket as any).isAdmin || authActorSafe((socket as any).authContext)?.role === 'admin') {
        socket.emit('auth_error', { message: 'A sessão administrativa deve permanecer no tenant autenticado.' });
        return;
      }
      // Seleção de tenant não é autenticação. Carregamos o estado para
      // validar cadastro/login, mas não ingressamos na sala antes de aprovar.
      leaveTenantRooms(socket);
      delete (socket as any).isAdmin;
      (socket as any).authContext = null;
      delete (socket as any).waiterId;
      delete (socket as any).waiterUid;
      delete (socket as any).waiterCpf;
      delete (socket as any).waiterName;
      (socket as any).tenantId = tid;
      (socket as any).pendingTenantId = tid;
      const tenantGeneration = (socket as any).tenantGeneration = (Number((socket as any).tenantGeneration) || 0) + 1;
      try {
        await loadTenantIfNeeded(tid);
        if (socket.connected === false || (socket as any).tenantId !== tid ||
            (socket as any).pendingTenantId !== tid ||
            (socket as any).tenantGeneration !== tenantGeneration) return;
      } catch (error: any) {
        console.error(`[waiter_identify_tenant] falha ao carregar ${tid}:`, error?.message || error);
        socket.emit("auth_error", { message: "Não foi possível carregar os dados deste tenant." });
      }
    });

    socket.on("waiter_register", async (waiterData: any = {}, callback?: (ack: any) => void) => {
      const ack = typeof callback === 'function' ? callback : undefined;
      if ((socket as any).__commandTenantId) {
        ack?.({ ok: false, status: 'rejected', message: 'Aguarde o comando atual terminar antes de trocar de conta.' });
        return;
      }
      const waiterTenantId = String((socket as any).pendingTenantId || socket.handshake.query?.tenant || '').trim();
      const fail = (message: string, status: any = 'rejected', waiter?: any) => {
        const response = buildWaiterAuthAck(false, waiter, message);
        if (status) response.status = status;
        ack?.(response);
        socket.emit('waiter_login_ack', response);
        socket.emit('auth_error', { message });
      };
      if (!waiterTenantId) { fail('Estabelecimento obrigatório.'); return; }
      if (!waiterData || typeof waiterData !== 'object' ||
          typeof waiterData.name !== 'string' || !waiterData.name.trim() ||
          typeof waiterData.password !== 'string' || !waiterData.password) {
        fail('Nome e senha são obrigatórios.');
        return;
      }
      (socket as any).tenantId = waiterTenantId;
      const registrationGeneration = (socket as any).tenantGeneration;
      console.log(`[waiter_register] tenant=${waiterTenantId} name=${waiterData.name} cpf=${waiterData.cpf} gen=${registrationGeneration}`);
      try {
        await loadTenantIfNeeded(waiterTenantId);
        if (socket.connected === false || (socket as any).pendingTenantId !== waiterTenantId ||
            (socket as any).tenantGeneration !== registrationGeneration) {
          console.warn(`[waiter_register] sessao expirada connected=${socket.connected} pendingTenantId=${(socket as any).pendingTenantId} gen=${(socket as any).tenantGeneration} vs ${registrationGeneration}`);
          fail('Sessão expirada. Tente novamente.');
          return;
        }
        const st = getState(waiterTenantId);
        // Never let a duplicate registration replace a password or approval for active/approved waiters.
        const existing = st.waiters.find((candidate: any) =>
          (waiterData.cpf && candidate.cpf === waiterData.cpf) ||
          (waiterData.name === candidate.name && waiterData.phone === candidate.phone)
        );
        if (existing) {
          const sameCredentials = waiterCredentialsMatch(existing, waiterData.name, waiterData.password);
          const isPending = String(existing.status).toLowerCase() === 'pending';
          if (sameCredentials || isPending) {
            // Same credentials OR still pending: update record with new data and treat as re-login.
            if (!sameCredentials && isPending) {
              Object.assign(existing, {
                name: waiterData.name,
                phone: waiterData.phone,
                cpf: waiterData.cpf,
                birthDate: waiterData.birthDate,
                password: waiterData.password,
                socketId: socket.id,
              });
              await saveToSupabase('waiters', existing, String(existing.id), waiterTenantId);
            }
            delete (socket as any).isAdmin;
            (socket as any).waiterId = existing.id;
            (socket as any).authContext = {
              role: 'waiter', tenantId: waiterTenantId, waiterId: String(existing.id), credentialsValidated: true,
            };
            const response = buildWaiterAuthAck(true, existing);
            ack?.(response);
            socket.emit('waiter_login_ack', response);
            socket.emit('waiter_approved', { status: existing.status, waiter: sanitizeWaiter(existing) });
            if (existing.status === 'pending') {
              io.to('tenant:' + waiterTenantId).emit('admin_notification', { type: 'NEW_WAITER', data: sanitizeWaiter(existing) });
              io.to('tenant:' + waiterTenantId).emit('update_waiters', publicWaiters(st.waiters));
            }
          } else {
            const conflictField = (waiterData.cpf && existing.cpf === waiterData.cpf) ? 'CPF' : 'nome+telefone';
            const existingStatus = String(existing.status || 'desconhecido');
            const response = buildWaiterAuthAck(false, undefined,
              `${conflictField} já cadastrado (status: ${existingStatus}). Use dados diferentes ou faça login com as credenciais do cadastro existente.`
            );
            ack?.(response);
            socket.emit('waiter_login_ack', response);
          }
          return;
        }

        const waiterId = waiterData.cpf || randomUUID();
        const waiter = {
          ...waiterData,
          id: waiterId,
          socketId: socket.id,
          status: 'pending',
        };
        st.waiters.push(waiter);
        delete (socket as any).isAdmin;
        (socket as any).waiterId = waiterId;
        (socket as any).authContext = {
          role: 'waiter', tenantId: waiterTenantId, waiterId: String(waiterId), credentialsValidated: true,
        };

        // ACK only after the durable waiter write succeeds.
        console.log(`[waiter_register] salvando garcom id=${waiterId} tenant=${waiterTenantId} phone=${waiter.phone} birthDate=${waiter.birthDate}`);
        await saveToSupabase('waiters', waiter, String(waiterId), waiterTenantId);
        console.log(`[waiter_register] salvo com sucesso id=${waiterId}`);
        const safeWaiter = sanitizeWaiter(waiter);
        const response = buildWaiterAuthAck(true, waiter);
        ack?.(response);
        socket.emit('waiter_login_ack', response);
        io.to('tenant:' + waiterTenantId).emit("admin_notification", {
          type: "NEW_WAITER",
          data: safeWaiter,
        });
        io.to('tenant:' + waiterTenantId).emit("update_waiters", publicWaiters(st.waiters));
        socket.emit("waiter_approved", { status: waiter.status, waiter: safeWaiter });
      } catch (error: any) {
        const st = getState(waiterTenantId);
        const createdId = String((socket as any).waiterId || '');
        const createdIndex = st.waiters.findIndex((candidate: any) => String(candidate.id) === createdId);
        if (createdIndex >= 0 && st.waiters[createdIndex].status === 'pending') st.waiters.splice(createdIndex, 1);
        delete (socket as any).authContext;
        delete (socket as any).waiterId;
        const errMsg = error?.message || error?.details || String(error) || 'erro desconhecido';
        console.error(`[waiter_register] falha ao persistir ${waiterTenantId}:`, error);
        fail(`Falha ao salvar cadastro: ${errMsg}`);
      }
    });

    socket.on("waiter_login", async ({ name, password }: { name?: string; password?: string } = {}, callback?: (ack: any) => void) => {
      const ack = typeof callback === 'function' ? callback : undefined;
      if ((socket as any).__commandTenantId) {
        ack?.({ ok: false, status: 'rejected', message: 'Aguarde o comando atual terminar antes de trocar de conta.' });
        return;
      }
      const waiterTenantId = String((socket as any).pendingTenantId || socket.handshake.query?.tenant || (socket as any).tenantId || '').trim();
      const invalid = (message: string, waiter?: any) => {
        const response = buildWaiterAuthAck(false, waiter, message);
        ack?.(response);
        socket.emit('waiter_login_ack', response);
        socket.emit("error_message", message);
      };
      const ownerActor = authActorSafe((socket as any).authContext);
      // A verified owner/admin socket must not be silently downgraded by a
      // saved waiter credential. A real staff-route transition reconnects
      // first, so this guard cannot block the legitimate /waiter flow.
      if (ownerActor?.role === 'admin' && isAdminForTenant(ownerActor.tenantId)) {
        invalid('A sessão administrativa não pode entrar como garçom nesta conexão.');
        return;
      }
      if (!waiterTenantId) { invalid('Estabelecimento obrigatório.'); return; }
      if (typeof name !== 'string' || typeof password !== 'string') {
        invalid('Nome ou senha incorretos. Verifique seus dados ou solicite um novo cadastro.');
        return;
      }
      (socket as any).tenantId = waiterTenantId;
      (socket as any).pendingTenantId = waiterTenantId;
      try {
        await loadTenantIfNeeded(waiterTenantId);
        if (!socket.connected) return;
        if ((socket as any).tenantId !== waiterTenantId || (socket as any).pendingTenantId !== waiterTenantId) {
          invalid('Sessão expirada. Tente novamente.');
          return;
        }
        const st = getState(waiterTenantId);
        const waiter = findWaiterByCredentials(st.waiters, name, password);
        if (!waiter) {
          invalid('Nome ou senha incorretos. Verifique seus dados ou solicite um novo cadastro.');
          return;
        }

        // A successful waiter login is a real role switch: never retain ADM.
        delete (socket as any).isAdmin;
        (socket as any).authContext = {
          role: 'waiter', tenantId: waiterTenantId, waiterId: String(waiter.id), credentialsValidated: true,
        };
        (socket as any).waiterId = waiter.id;
        (socket as any).waiterUid = waiter.uid;
        (socket as any).waiterCpf = waiter.cpf;
        (socket as any).waiterName = waiter.name;
        writeAudit(waiterTenantId, 'waiter_connected', waiter.name,
          `Garçom "${waiter.name}" conectou`);
        delete (socket as any)._pendingLogin;
        waiter.socketId = socket.id;
        const safeWaiter = sanitizeWaiter(waiter);
        const response = buildWaiterAuthAck(true, waiter);
        ack?.(response);
        socket.emit('waiter_login_ack', response);
        socket.emit("waiter_approved", { status: waiter.status, waiter: safeWaiter });
        io.to('tenant:' + waiterTenantId).emit("update_waiters", publicWaiters(st.waiters));
        if (waiter.status !== 'approved') return;

        const tenantGeneration = switchSocketTenant(socket, waiterTenantId);
        (socket as any).tenantGeneration = tenantGeneration;
        const currentState = getState(waiterTenantId);
        socket.emit('init_data', {
          tenantId: waiterTenantId,
          ready: true,
          buildId: __BUILD_ID__,
          currentWaiter: safeWaiter,
          waiters: [safeWaiter],
          orders: currentState.orders, tables: currentState.tables, comandas: currentState.comandas,
          stock: currentState.stock, stockLog: currentState.stockLog, menu: currentState.menu,
          pizzaFlavors: currentState.pizzaFlavors, pizzaCrusts: currentState.pizzaCrusts, pizzaSizes: currentState.pizzaSizes,
          isCashRegisterOpen: currentState.isCashRegisterOpen, shiftStartedAt: currentState.shiftStartedAt,
          pizzariaConfig: currentState.pizzariaConfig, firebaseActive: !!db,
          printerAgentOnline: !!(currentState.printerAgentSocket?.connected), serverNow: new Date().toISOString(),
        });
      } catch (error: any) {
        console.error(`[waiter_login] falha ao carregar tenant ${waiterTenantId}:`, error?.message || error);
        invalid('Não foi possível carregar os dados deste tenant.');
      }
    });

    onTenantCommand("toggle_cash_register", requireAdmin(async (payload) => {
      const isOpen: boolean = typeof payload === 'boolean' ? payload : (payload?.isOpen ?? false);
      const cashRegisterName: string | undefined = typeof payload === 'object' && payload !== null ? payload.cashRegisterName : undefined;
      const password: string | undefined = typeof payload === 'object' && payload !== null ? payload.password : undefined;
      const forceAssume: boolean = typeof payload === 'object' && payload !== null ? (payload.forceAssume ?? false) : false;

      if (!isOpen) {
        const activeTables = _st().tables.find((t: any) => t.status !== "free");
        const activeComandas = _st().comandas.find((c: any) => c.status !== "free");
        if (activeTables || activeComandas) {
          socket.emit("error_message", "Não é possível fechar o caixa com mesas ou comandas ocupadas.");
          return;
        }
        const closedCashState = closeCashRegisterState(_st(), {
          cashRegisterName,
          socketId: socket.id,
        });
        _st().openCashRegisters = closedCashState.openCashRegisters;
        _st().isCashRegisterOpen = closedCashState.isCashRegisterOpen;
      } else {
        if (cashRegisterName) {
          const registeredCaixa = (_st().pizzariaConfig?.cashRegisters ?? []).find((r: any) => r.name === cashRegisterName);
          if (registeredCaixa?.password) {
            if (registeredCaixa.password !== password) {
              socket.emit("error_message", "Senha incorreta.");
              return;
            }
          }
          const existingSocketId = _st().openCashRegisters[cashRegisterName];
          if (existingSocketId && existingSocketId !== socket.id) {
            const existingSocket = io.sockets.sockets.get(existingSocketId);
            if (existingSocket?.connected) {
              if (!forceAssume) {
                socket.emit("cash_register_conflict", { cashRegisterName });
                return;
              }
              existingSocket.emit("update_my_cash_register_name", null);
              existingSocket.emit("error_message", `O caixa "${cashRegisterName}" foi assumido por outro dispositivo.`);
              existingSocket.disconnect(true);
            }
          }
        }
        if (!hasLogicalOpenCashRegisters(_st().isCashRegisterOpen, _st().openCashRegisters)) {
          markShiftStart(_st());
        }
        const openedCashState = openCashRegisterState(_st(), {
          cashRegisterName,
          socketId: socket.id,
          now: _st().shiftStartedAt,
        });
        _st().isCashRegisterOpen = openedCashState.isCashRegisterOpen;
        _st().shiftStartedAt = openedCashState.shiftStartedAt;
        _st().openCashRegisters = openedCashState.openCashRegisters;
        io.to(_room()).emit('update_shift_started_at', _st().shiftStartedAt);
      }

      io.to(_room()).emit("update_cash_register", _st().isCashRegisterOpen);
      io.to(_room()).emit("update_open_cash_register_names", getOpenCashRegisterNames(_st().openCashRegisters));
      if (cashRegisterName !== undefined) {
        (socket as any).activeCashRegisterName = isOpen ? cashRegisterName : null;
        socket.emit("update_my_cash_register_name", isOpen ? cashRegisterName : null);
      }
      await saveToSupabase('config', cashRegisterConfigPatch(_st(), { updatedAt: new Date().toISOString() }), 'app', _tid());

      // Save a report snapshot to cash_register_reports (non-blocking)
      saveCashRegisterReport(_tid(), isOpen ? 'open' : 'close', cashRegisterName ?? null, _st()).catch(() => {});
      if (cashRegisterName) {
        writeAudit(_tid(), isOpen ? 'caixa_open' : 'caixa_close', cashRegisterName,
          isOpen ? `Caixa "${cashRegisterName}" aberto` : `Caixa "${cashRegisterName}" fechado`);
      }
    }));

    onTenantCommand("force_close_cash_register", requireAdmin(async (payload) => {
      const cashRegisterName: string | undefined = typeof payload === 'object' && payload !== null ? payload.cashRegisterName : undefined;
      if (!cashRegisterName) return;
      const ownerSocketId = _st().openCashRegisters[cashRegisterName];
      if (ownerSocketId) {
        const ownerSocket = io.sockets.sockets.get(ownerSocketId);
        if (ownerSocket?.connected) {
          ownerSocket.emit("update_my_cash_register_name", null);
          ownerSocket.emit("error_message", `O caixa "${cashRegisterName}" foi fechado remotamente pelo administrador.`);
        }
      }
      const closedState = closeCashRegisterState(_st(), { cashRegisterName, socketId: ownerSocketId ?? socket.id });
      _st().openCashRegisters = closedState.openCashRegisters;
      _st().isCashRegisterOpen = closedState.isCashRegisterOpen;
      io.to(_room()).emit("update_cash_register", _st().isCashRegisterOpen);
      io.to(_room()).emit("update_open_cash_register_names", getOpenCashRegisterNames(_st().openCashRegisters));
      await saveToSupabase('config', cashRegisterConfigPatch(_st(), { updatedAt: new Date().toISOString() }), 'app', _tid());
      saveCashRegisterReport(_tid(), 'close', cashRegisterName, _st()).catch(() => {});
      writeAudit(_tid(), 'caixa_force_close', cashRegisterName,
        `Caixa "${cashRegisterName}" fechado remotamente pelo ADM`);
      socket.emit("force_close_cash_register_ok", { cashRegisterName });
    }));

    socket.on("get_cash_register_reports", requireAdmin(async (payload: { date?: string }) => {
      if (!db) { socket.emit("cash_register_reports_response", []); return; }
      try {
        const date = payload?.date || new Date().toISOString().split('T')[0];
        const start = `${date}T00:00:00.000Z`;
        const end   = `${date}T23:59:59.999Z`;
        const { data, error } = await db.from('cash_register_reports')
          .select('id, type, cash_register_name, shift_started_at, created_at, report_data')
          .eq('tenant_id', _tid())
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: true });
        if (error) throw error;
        socket.emit("cash_register_reports_response", data || []);
      } catch (e) {
        console.error('[crr] erro ao buscar relatórios:', e);
        socket.emit("cash_register_reports_response", []);
      }
    }));

    socket.on("get_audit_log", requireAdmin(async (payload: { startDate?: string; endDate?: string }) => {
      if (!db) { socket.emit("audit_log_response", []); return; }
      try {
        let query = db.from('audit_log')
          .select('*')
          .eq('tenant_id', _tid())
          .order('timestamp', { ascending: false })
          .limit(500);
        if (payload?.startDate) query = query.gte('timestamp', `${payload.startDate}T00:00:00.000Z`);
        if (payload?.endDate)   query = query.lte('timestamp', `${payload.endDate}T23:59:59.999Z`);
        const { data, error } = await query;
        if (error) throw error;
        socket.emit("audit_log_response", data || []);
      } catch (e) {
        console.error('[audit_log]', e);
        socket.emit("audit_log_response", []);
      }
    }));

    socket.on("toggle_waiter_status", requireAdmin(async ({ waiterId, status }) => {
      const tenantId = _tid();
      const st = getState(tenantId);
      if (!['pending', 'approved', 'inactive'].includes(String(status))) {
        socket.emit('error_message', 'Status de garçom inválido.');
        return false;
      }
      const waiter = st.waiters.find((w) => w.id === waiterId || w.cpf === waiterId);
      if (!waiter) return false;
      const previousStatus = waiter.status;
      waiter.status = status;
      try {
        // Do not advertise a status that has not reached durable storage.
        await saveToSupabase('waiters', waiter, String(waiter.id), tenantId);
      } catch (error: any) {
        waiter.status = previousStatus;
        socket.emit('error_message', 'Não foi possível persistir o status do garçom.');
        console.error(`[waiter_status] falha ao salvar ${tenantId}:`, error?.message || error);
        return false;
      }
      io.to('tenant:' + tenantId).emit("update_waiters", publicWaiters(st.waiters));

      // Notify only sockets whose server-established actor belongs to this tenant.
      io.sockets.sockets.forEach((s: any) => {
        const actor = authActorSafe(s.authContext);
        if (actor?.role === 'waiter' && actor.tenantId === tenantId && actor.waiterId === String(waiter.id)) {
          s.emit("waiter_status_changed", { status, waiter: sanitizeWaiter(waiter) });
          s.emit("waiter_approved", { status, waiter: sanitizeWaiter(waiter) });
        }
      });
      return true;
    }));

    socket.on("remove_waiter", requireAdmin((waiterId: string) => {
      const idx = _st().waiters.findIndex((w) => w.id === waiterId || w.cpf === waiterId);
      if (idx === -1) return;
      const waiter = _st().waiters[idx];
      // Notifica o garçom para que encerre a sessão
      const connectedSockets = io.sockets.sockets;
      connectedSockets.forEach((s) => {
        if (
          (s as any).waiterId  === waiter.id  ||
          (s as any).waiterId  === waiter.cpf ||
          (s as any).waiterName === waiter.name
        ) {
          s.emit("waiter_status_changed", { status: "inactive" });
        }
      });
      _st().waiters.splice(idx, 1);
      io.to(_room()).emit("update_waiters", publicWaiters(_st().waiters));
      saveLocalBackup(_st());
    }));

    onTenantCommand("cleanup_test_data", requireAdmin(async ({ deleteWaiters, deleteData }: { deleteWaiters: boolean; deleteData: boolean }) => {
      const prefix = 'Garcom_Fogo_';
      if (deleteWaiters) {
        _st().waiters = _st().waiters.filter((w: any) => !w.name?.startsWith(prefix));
        io.to(_room()).emit('update_waiters', publicWaiters(_st().waiters));
        if (USE_POSTGRES) void pgDeleteLike('_st().waiters', 'id', `${prefix}%`);
        else db?.from('_st().waiters').delete().like('name', `${prefix}%`).then(() => {}).catch(() => {});
      }
      if (deleteData) {
        // Remove itens lançados por garçons de teste de pedidos mistos; exclui pedidos inteiramente do teste
        _st().orders = _st().orders
          .map((o: any) => ({
            ...o,
            items: (o.items || []).filter((i: any) => !i.waiterName?.startsWith(prefix)),
          }))
          .filter((o: any) => {
            const isTestOrder = o.waiterName?.startsWith(prefix);
            const hasRealItems = (o.items || []).some((i: any) => !i.waiterName?.startsWith(prefix));
            return !isTestOrder || hasRealItems;
          });
        // Libera mesas sem pedido ativo
        _st().tables = _st().tables.map((t: any) => {
          const hasActive = _st().orders.some((o: any) => String(o.tableId) === String(t.id) && o.status !== 'finalizada');
          return hasActive ? t : { ...t, status: 'free', currentOrder: null };
        });
        _st().comandas = _st().comandas.map((c: any) => {
          const hasActive = _st().orders.some((o: any) => o.isComanda && String(o.tableId) === String(c.id) && o.status !== 'finalizada');
          return hasActive ? c : { ...c, status: 'free', currentOrder: null };
        });
        io.to(_room()).emit('update_orders', _st().orders);
        io.to(_room()).emit('update_tables', _st().tables);
        io.to(_room()).emit('update_comandas', _st().comandas);
        if (USE_POSTGRES) void pgDeleteOrdersByWaiterLike(`${prefix}%`);
        else db?.from('_st().orders').delete().like('waiter_name', `${prefix}%`).then(() => {}).catch(() => {});
      }
    }));

    socket.on("admin_approve_waiter", requireAdmin(async (waiterId) => {
      const tenantId = _tid();
      const st = getState(tenantId);
      const waiter = st.waiters.find((w) => w.id === waiterId || w.cpf === waiterId);
      if (!waiter) return false;
      const previousStatus = waiter.status;
      waiter.status = "approved";
      try {
        await saveToSupabase('waiters', waiter, String(waiter.id), tenantId);
      } catch (error: any) {
        waiter.status = previousStatus;
        socket.emit('error_message', 'Não foi possível persistir a aprovação do garçom.');
        console.error(`[waiter_approve] falha ao salvar ${tenantId}:`, error?.message || error);
        return false;
      }
      const safeWaiter = sanitizeWaiter(waiter);
      io.to('tenant:' + tenantId).emit("update_waiters", publicWaiters(st.waiters));

      // Only a waiter socket that authenticated its own credentials can claim
      // this approval; names/IDs supplied by an anonymous socket are ignored.
      io.sockets.sockets.forEach((s: any) => {
        const actor = authActorSafe(s.authContext);
        if (actor?.role === 'waiter' && actor.tenantId === tenantId && actor.waiterId === String(waiter.id)) {
          s.emit("waiter_approved", { status: "approved", waiter: safeWaiter, isNewApproval: true });
        }
      });
      return true;
    }));

    onTenantCommand("new_order", async (orderData) => {
      await loadTenantIfNeeded(_tid());
      console.log("New order request received:", orderData.tableId, orderData.isComanda ? "Comanda" : "Table");

      const incomingItems = Array.isArray(orderData?.items) ? orderData.items : [];
      if (incomingItems.some((item: any) => isPlaygroundReservedItem(item, _tid()))) {
        return rejectPlaygroundReserved();
      }

      if (!_st().isCashRegisterOpen) {
        console.warn("Attempted order while register is closed");
        socket.emit("error_message", "O caixa estÃ¡ fechado. Abra o caixa para realizar pedidos.");
        return;
      }
      
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? _st().waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      const isComanda = !!orderData.isComanda;
      const targetList = isComanda ? _st().comandas : _st().tables;
      let table = targetList.find(t => orderData.tableId && t.id && String(t.id) === String(orderData.tableId));
      
      // Handle linked _st().tables
      if (table && table.status === "linked" && table.linkedTo) {
        let currentTable = table;
        const visited = new Set([currentTable.id]);
        while (currentTable.status === "linked" && currentTable.linkedTo) {
          const nextTable = targetList.find(t => currentTable.linkedTo && t.id && String(t.id) === String(currentTable.linkedTo));
          if (!nextTable || visited.has(nextTable.id)) break;
          currentTable = nextTable;
          visited.add(currentTable.id);
        }
        table = currentTable;
      }

      const waiterName = orderData.waiterName || (waiter ? waiter.name : "Desconhecido");

      // Tag items with waiter name and resolve type from server _st().menu
      const orderCreatedAt = Date.now();
      const itemsWithWaiter = (orderData.items || []).map((item: any, idx: number) => {
        // Pizzas always keep type 'pizzas'; for other items resolve from server _st().menu
        let resolvedType = item.type;
        if (item.type !== 'pizzas') {
          const cat = item.menuItemId
            ? _st().menu.find((c: any) => c.items.some((i: any) => i.id === item.menuItemId) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId)))
            : _st().menu.find((c: any) => c.items.some((i: any) => i.name === item.name) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.name === item.name)));
          if (cat?.type) resolvedType = cat.type;
        }
        return {
          ...item,
          type: resolvedType,
          id: item.id || Math.random().toString(36).substr(2, 9),
          waiterName: item.waiterName || waiterName,
          // Offset each item by its index so items in the same cart have unique timestamps
          timestamp: new Date(orderCreatedAt + idx).toISOString()
        };
      });

      if (table && table.status === "aguardando_baixa") {
        socket.emit("error_message", "Pedido aguardando baixa no caixa. NÃ£o Ã© possÃ­vel adicionar itens.");
        return;
      }

      if (table && (table.status === "occupied" || table.status === "bill_requested") && table.currentOrder) {
        console.log("Adding items to existing order:", table.currentOrder);
        const existingOrder = _st().orders.find(o => table.currentOrder && o.id && String(o.id) === String(table.currentOrder));
        if (existingOrder) {
          if (!existingOrder.items) existingOrder.items = [];
          existingOrder.items.push(...itemsWithWaiter);
          if (orderData.observations) {
            existingOrder.observations = existingOrder.observations 
              ? `${existingOrder.observations} | ${orderData.observations}` 
              : orderData.observations;
          }
          io.to(_room()).emit("update_orders", _st().orders);
          if (itemsWithWaiter.length > 0) {
            const kPayload1 = { items: itemsWithWaiter, tableId: existingOrder.tableId, isComanda: existingOrder.isComanda };
            io.to(_room()).emit("kitchen_new_order", kPayload1);
            emitPrintOrder(kPayload1);
          }
          enqueueWrite('orders', existingOrder, existingOrder.id.toString(), _tid());
          // Renovar sessão do cliente ao adicionar itens
          { const s = getClientSession(_tid(), existingOrder.tableId, existingOrder.isComanda); if (s) s.lastActivity = Date.now(); else activateClientSession(_tid(), existingOrder.tableId, existingOrder.isComanda); }
          applyStockReduction(_st(), _tid(), itemsWithWaiter);
          console.log("Existing order updated and emitted");
          return;
        }
      }

      const newOrder = { 
        ...orderData, 
        items: itemsWithWaiter,
        id: generateOrderId(_st(), _tid()), 
        status: "pending", 
        timestamp: new Date().toISOString(),
        waiterName: waiterName,
        isComanda: isComanda
      };
      
      console.log("Created new order object:", newOrder.id);
      _st().orders.push(newOrder);
      // Ativar sessão do cliente ao criar nova comanda
      activateClientSession(_tid(), newOrder.tableId, newOrder.isComanda ?? false);

      // Reduz estoque antes de emitir, para o cliente ver já o valor correto
      applyStockReduction(_st(), _tid(), itemsWithWaiter);

      // Emit orders update immediately; table update is emitted after status is set below
      io.to(_room()).emit("update_orders", _st().orders);
      if ((newOrder.items || []).length > 0) {
        const kPayload2 = { items: newOrder.items, tableId: newOrder.tableId, isComanda: newOrder.isComanda };
        io.to(_room()).emit("kitchen_new_order", kPayload2);
        emitPrintOrder(kPayload2);
      }
      
      console.log("Emitted initial updates for new order");
      
      saveToSupabase('orders', newOrder, newOrder.id, _tid());
      saveToSupabase('config', cashRegisterConfigPatch(_st(), { dailyCounter: _st().dailyCounter, lastOrderDate: _st().lastOrderDate }), 'app', _tid());
      
      if (table) {
        const orderId = newOrder.id;
        const targetId = table.id;
        const collName = isComanda ? 'comandas' : 'tables';
        
        console.log("Updating table status to occupied for:", targetId);
        
        if (isComanda) {
          _st().comandas.forEach(c => {
            if (c.id === targetId || c.linkedTo === targetId) {
              c.status = c.id === targetId ? "occupied" : "linked";
              c.currentOrder = orderId;
              saveToSupabase(collName, c, c.id.toString(), _tid());
            }
          });
        } else {
          _st().tables.forEach(t => {
            if (t.id === targetId || t.linkedTo === targetId) {
              t.status = t.id === targetId ? "occupied" : "linked";
              t.currentOrder = orderId;
              saveToSupabase(collName, t, t.id.toString(), _tid());
            }
          });
        }
        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        
        console.log("Emitted final table updates for new order");
      }

    });

    socket.on("update_product", requireAdmin(({ categoryName, productId, updatedData, subcategoryId }) => {
      const currentItem = findMenuItem(productId);
      if (isPlaygroundReservedItem(currentItem, _tid()) || isPlaygroundReservedItem({ id: productId }, _tid()) || isPlaygroundReservedItem(updatedData, _tid())) {
        return rejectPlaygroundReserved();
      }
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        if (subcategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map((sub: any) =>
              sub.id === subcategoryId
                ? { ...sub, items: sub.items.map((item: any) => item.id === productId ? { ...item, ...updatedData } : item) }
                : sub
            ),
          };
        }
        return { ...cat, items: cat.items.map((item: any) => item.id === productId ? { ...item, ...updatedData } : item) };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
      writeAudit(_tid(), 'product_updated', 'ADM',
        `Produto atualizado em "${categoryName}"`,
        { productId, fields: Object.keys(updatedData || {}) });

      // Sincroniza o nome no estoque se o produto for renomeado
      if (updatedData.name) {
        const stockEntry = _st().stock.find((s: any) => s.menuItemId === productId);
        if (stockEntry) {
          _st().stock = _st().stock.map((s: any) =>
            s.menuItemId === productId ? { ...s, name: updatedData.name } : s
          );
          io.to(_room()).emit("update_stock", _st().stock);
          saveToSupabase('stock', _st().stock.find((s: any) => s.menuItemId === productId), productId).catch(() => {});
        }
      }
    }));

    socket.on("add_product", requireAdmin(({ categoryName, productData, subcategoryId }) => {
      if (isPlaygroundReservedItem(productData, _tid())) return rejectPlaygroundReserved();
      const newItem = { id: randomUUID(), ...productData };
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        if (subcategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map((sub: any) =>
              sub.id === subcategoryId ? { ...sub, items: [...sub.items, newItem] } : sub
            ),
          };
        }
        return { ...cat, items: [...cat.items, newItem] };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
      writeAudit(_tid(), 'product_created', 'ADM',
        `Produto "${productData.name}" criado em "${categoryName}"`);
    }));

    socket.on("add_category", requireAdmin((categoryData) => {
      const validTypes = ['lanches', 'pizzas', 'bebidas', 'porcoes', 'lacarte', 'outros'];
      const type = validTypes.includes(categoryData.type) ? categoryData.type : 'lanches';

      // Se for pizza, monta automaticamente subcategorias Com/Sem Borda com os tamanhos cadastrados
      let subcategories: any[] = [];
      if (type === 'pizzas') {
        const makeItems = (withBorder: boolean) =>
          _st().pizzaSizes.map((s, i) => ({
            id: `${withBorder ? 'cb' : 'sb'}${i + 1}_${Date.now()}`,
            name: `${s.name} ${withBorder ? 'com Borda' : 'sem Borda'}`,
            price: 0,
            ingredients: `${s.slices} fatias · ${s.dim} · ${s.people} · ${s.detail}`,
            visible: true,
          }));
        subcategories = [
          { id: randomUUID(), name: 'Com Borda', position: 0, visible: true, items: makeItems(true) },
          { id: randomUUID(), name: 'Sem Borda', position: 1, visible: true, items: makeItems(false) },
        ];
      }

      const newCategory = {
        name: categoryData.name,
        type,
        visible: true,
        trackTime: false,
        items: [],
        subcategories,
      };
      _st().menu.push(newCategory);
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("update_category", requireAdmin(({ oldName, updatedData }) => {
      const currentCategory = _st().menu.find((cat: any) => cat.name === oldName);
      const replacesProducts = updatedData && (
        Object.prototype.hasOwnProperty.call(updatedData, 'items') ||
        Object.prototype.hasOwnProperty.call(updatedData, 'subcategories')
      );
      if (hasReservedMenuItem(updatedData) || (hasReservedMenuItem(currentCategory) && replacesProducts)) {
        return rejectPlaygroundReserved();
      }
      _st().menu = _st().menu.map((cat: any) => cat.name === oldName ? { ...cat, ...updatedData } : cat);
      _st().menu = synchronizePlaygroundCatalog(_st().menu, _tid(), _st().pizzariaConfig).menu;
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("toggle_category_visibility", requireAdmin(({ categoryName, visible }) => {
      _st().menu = _st().menu.map((cat: any) => cat.name === categoryName ? { ...cat, visible } : cat);
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("toggle_item_visibility", requireAdmin(({ categoryName, subcategoryId, itemId, visible }) => {
      if (isPlaygroundReservedItem(findMenuItem(itemId), _tid()) || isPlaygroundReservedItem({ id: itemId }, _tid())) {
        return rejectPlaygroundReserved();
      }
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        if (subcategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map((sub: any) =>
              sub.id === subcategoryId
                ? { ...sub, items: sub.items.map((i: any) => i.id === itemId ? { ...i, visible } : i) }
                : sub
            ),
          };
        }
        return { ...cat, items: (cat.items || []).map((i: any) => i.id === itemId ? { ...i, visible } : i) };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("delete_category", requireAdmin((categoryName) => {
      const category = _st().menu.find((cat: any) => cat.name === categoryName);
      if (hasReservedMenuItem(category)) return rejectPlaygroundReserved();
      _st().menu = _st().menu.filter((cat: any) => cat.name !== categoryName);
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("add_subcategory", requireAdmin(({ categoryName, subcategoryData }) => {
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        const newSub = {
          id: randomUUID(),
          name: subcategoryData.name,
          position: (cat.subcategories || []).length,
          visible: true,
          trackTime: false,
          isAdicional: subcategoryData.isAdicional || false,
          items: [],
        };
        return { ...cat, subcategories: [...(cat.subcategories || []), newSub] };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("update_subcategory", requireAdmin(({ categoryName, subcategoryId, updatedData }) => {
      const currentSubcategory = _st().menu
        .find((cat: any) => cat.name === categoryName)?.subcategories
        ?.find((subcategory: any) => subcategory.id === subcategoryId);
      if (hasReservedMenuItem(currentSubcategory) && (hasReservedMenuItem(updatedData) || updatedData?.items !== undefined)) {
        return rejectPlaygroundReserved();
      }
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        return {
          ...cat,
          subcategories: (cat.subcategories || []).map((sub: any) =>
            sub.id === subcategoryId ? { ...sub, ...updatedData } : sub
          ),
        };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("delete_subcategory", requireAdmin(({ categoryName, subcategoryId }) => {
      const currentSubcategory = _st().menu
        .find((cat: any) => cat.name === categoryName)?.subcategories
        ?.find((subcategory: any) => subcategory.id === subcategoryId);
      if (hasReservedMenuItem(currentSubcategory)) return rejectPlaygroundReserved();
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        return { ...cat, subcategories: (cat.subcategories || []).filter((sub: any) => sub.id !== subcategoryId) };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
    }));

    socket.on("delete_product", requireAdmin(({ categoryName, productId, subcategoryId }) => {
      if (isPlaygroundReservedItem(findMenuItem(productId), _tid()) || isPlaygroundReservedItem({ id: productId }, _tid())) {
        return rejectPlaygroundReserved();
      }
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name !== categoryName) return cat;
        if (subcategoryId) {
          return {
            ...cat,
            subcategories: (cat.subcategories || []).map((sub: any) =>
              sub.id === subcategoryId ? { ...sub, items: sub.items.filter((i: any) => i.id !== productId) } : sub
            ),
          };
        }
        return { ...cat, items: cat.items.filter((item: any) => item.id !== productId) };
      });
      io.to(_room()).emit("update_menu", _st().menu);
      saveMenuToSupabase(_st(), _tid());
      writeAudit(_tid(), 'product_deleted', 'ADM',
        `Produto excluído de "${categoryName}"`,
        { productId, categoryName });
    }));

    socket.on("toggle_stock_tracking", requireAdmin(({ menuItemId, categoryName, subcategoryId, enabled }) => {
      if (isPlaygroundReservedItem(findMenuItem(menuItemId), _tid()) || isPlaygroundReservedItem({ id: menuItemId }, _tid())) {
        return rejectPlaygroundReserved();
      }
      _st().menu = _st().menu.map((cat: any) => {
        if (cat.name === categoryName) {
          if (subcategoryId) {
            return {
              ...cat,
              subcategories: (cat.subcategories || []).map((sub: any) =>
                sub.id === subcategoryId
                  ? { ...sub, items: sub.items.map((item: any) => item.id === menuItemId ? { ...item, trackStock: enabled } : item) }
                  : sub
              ),
            };
          }
          return {
            ...cat,
            items: cat.items.map((item: any) =>
              item.id === menuItemId ? { ...item, trackStock: enabled } : item
            ),
          };
        }
        return cat;
      });

      if (enabled) {
        const allItems = _st().menu.flatMap((c: any) => [...c.items, ...(c.subcategories || []).flatMap((s: any) => s.items)]);
        const menuItem = allItems.find((i: any) => i.id === menuItemId);
        if (menuItem && !_st().stock.find((s: any) => s.menuItemId === menuItemId)) {
          const newEntry = { id: menuItemId, menuItemId, name: menuItem.name, quantity: 0, unit: 'un', minQuantity: 0 };
          _st().stock.push(newEntry);
          saveToSupabase('stock', newEntry, menuItemId, _tid()).catch(() => {});
        }
      } else {
        const removing = _st().stock.find((s: any) => s.menuItemId === menuItemId);
        _st().stock = _st().stock.filter((s: any) => s.menuItemId !== menuItemId);
        _st().stockLog = _st().stockLog.filter((l: any) => removing ? l.itemName !== removing.name : true);
        if (db) db.from('stock').delete().eq('id', `${_tid()}:${menuItemId}`).then().catch(() => {});
      }

      io.to(_room()).emit("update_menu", _st().menu);
      io.to(_room()).emit("update_stock", _st().stock);
      io.to(_room()).emit("update_stock_log", _st().stockLog);
      saveMenuToSupabase(_st(), _tid());
      writeAudit(_tid(), 'stock_tracking', 'ADM',
        `Controle de estoque ${enabled ? 'ativado' : 'desativado'} para item (${menuItemId})`);
    }));

    socket.on("update_stock_item", requireAdmin(({ menuItemId, quantity, minQuantity, unit, reason }) => {
      const prev = _st().stock.find((s: any) => (s.menuItemId ?? s.id) === menuItemId);
      if (!prev) return;
      const prevQty = prev.quantity ?? 0;
      _st().stock = _st().stock.map((s: any) =>
        (s.menuItemId ?? s.id) === menuItemId
          ? { ...s, quantity, minQuantity, unit: unit || s.unit }
          : s
      );
      if (quantity !== prevQty) {
        const change = quantity - prevQty;
        const defaultReason = change > 0 ? 'Entrada manual' : 'Ajuste manual';
        _st().stockLog = [{
          id: randomUUID(),
          itemName: prev.name,
          change,
          reason: (reason && String(reason).trim()) ? String(reason).trim() : defaultReason,
          timestamp: new Date().toISOString(),
        }, ..._st().stockLog].slice(0, 100);
        io.to(_room()).emit("update_stock_log", _st().stockLog);
        saveToSupabase('config', { stockLog: _st().stockLog }, 'stockLog', _tid()).catch(console.error);
        writeAudit(_tid(), 'stock_adjusted', 'ADM',
          `Estoque de "${prev.name}" ajustado: ${change > 0 ? '+' : ''}${change}${(reason && String(reason).trim()) ? ` (${String(reason).trim()})` : ''}`,
          { itemName: prev.name, change, reason: (reason && String(reason).trim()) ? String(reason).trim() : defaultReason });
      }
      io.to(_room()).emit("update_stock", _st().stock);
      // Persist updated stock item
      const updated = _st().stock.find((s: any) => (s.menuItemId ?? s.id) === menuItemId);
      if (updated) saveToSupabase('stock', updated, menuItemId, _tid()).catch(console.error);
    }));

    socket.on("update_pizza_flavor", requireAdmin(({ flavorName, updatedData }) => {
      _st().pizzaFlavors = _st().pizzaFlavors.map(f => {
        if (f.name === flavorName) return { ...f, ...updatedData };
        return f;
      });
      io.to(_room()).emit("update_pizza_flavors", _st().pizzaFlavors);
      // Persist
      if (USE_POSTGRES) {
        const updated = _st().pizzaFlavors.find(f => f.name === (updatedData.name || flavorName));
        if (updated) pgSave('pizzaFlavors', updated).catch(console.error);
      } else if (db) {
        const newName = updatedData.name || flavorName;
        // Se o nome mudou, remove a linha antiga antes de inserir a nova
        if (updatedData.name && updatedData.name !== flavorName) {
          db.from('pizza_flavors').delete().eq('id', `${_tid()}:${flavorName}`).then().catch(console.error);
        }
        const updated = _st().pizzaFlavors.find(f => f.name === newName);
        if (updated) db.from('pizza_flavors').upsert({
          id: `${_tid()}:${newName}`, name: newName,
          category: updated.category || null, price: updated.price || null,
          available: updated.available !== false, tenant_id: _tid(),
        }).then().catch(console.error);
      }
    }));

    socket.on("add_pizza_flavor", requireAdmin((flavorData) => {
      _st().pizzaFlavors.push(flavorData);
      io.to(_room()).emit("update_pizza_flavors", _st().pizzaFlavors);
      // Persist
      if (USE_POSTGRES) {
        pgSave('pizzaFlavors', flavorData).catch(console.error);
      } else if (db) {
        db.from('pizza_flavors').upsert({
          id: `${_tid()}:${flavorData.name}`, name: flavorData.name,
          category: flavorData.category || null, price: flavorData.price || null,
          available: flavorData.available !== false, tenant_id: _tid(),
        }).then().catch(console.error);
      }
    }));

    socket.on("delete_pizza_flavor", requireAdmin((flavorName) => {
      _st().pizzaFlavors = _st().pizzaFlavors.filter(f => f.name !== flavorName);
      io.to(_room()).emit("update_pizza_flavors", _st().pizzaFlavors);
      // Persist
      if (db) {
        db.from('pizza_flavors').delete()
          .eq('tenant_id', _tid()).eq('name', flavorName).then().catch(console.error);
      }
    }));

    const savePizzaSizesToDb = () => {
      _st().pizzariaConfig = { ..._st().pizzariaConfig, pizzaSizes: _st().pizzaSizes };
      saveToSupabase('config', _st().pizzariaConfig, 'pizzaria', _tid()).catch(console.error);
    };

    socket.on("update_pizza_crust", requireAdmin(({ oldName, newName }) => {
      _st().pizzaCrusts = _st().pizzaCrusts.map(c => c === oldName ? newName : c);
      io.to(_room()).emit("update_pizza_crusts", _st().pizzaCrusts);
      if (db) {
        db.from('pizza_crusts').delete().eq('id', `${_tid()}:${oldName}`).then().catch(console.error);
        db.from('pizza_crusts').upsert({ id: `${_tid()}:${newName}`, name: newName, tenant_id: _tid() }).then().catch(console.error);
      }
    }));

    socket.on("add_pizza_crust", requireAdmin((crustName) => {
      _st().pizzaCrusts.push(crustName);
      io.to(_room()).emit("update_pizza_crusts", _st().pizzaCrusts);
      saveToSupabase('pizzaCrusts', { name: crustName }, crustName, _tid()).catch(console.error);
    }));

    socket.on("delete_pizza_crust", requireAdmin((crustName) => {
      _st().pizzaCrusts = _st().pizzaCrusts.filter(c => c !== crustName);
      io.to(_room()).emit("update_pizza_crusts", _st().pizzaCrusts);
      if (db) db.from('pizza_crusts').delete().eq('tenant_id', _tid()).eq('name', crustName).then().catch(console.error);
    }));

    socket.on("add_pizza_size", requireAdmin((sizeData) => {
      _st().pizzaSizes.push(sizeData);
      io.to(_room()).emit("update_pizza_sizes", _st().pizzaSizes);
      savePizzaSizesToDb();
    }));

    socket.on("update_pizza_size", requireAdmin(({ index, updatedData }) => {
      if (index >= 0 && index < _st().pizzaSizes.length) {
        _st().pizzaSizes[index] = { ..._st().pizzaSizes[index], ...updatedData };
        io.to(_room()).emit("update_pizza_sizes", _st().pizzaSizes);
        savePizzaSizesToDb();
      }
    }));

    socket.on("delete_pizza_size", requireAdmin((index) => {
      if (index >= 0 && index < _st().pizzaSizes.length) {
        _st().pizzaSizes.splice(index, 1);
        io.to(_room()).emit("update_pizza_sizes", _st().pizzaSizes);
        savePizzaSizesToDb();
      }
    }));

    socket.on("reorder_pizza_sizes", requireAdmin((newOrder: any[]) => {
      _st().pizzaSizes = newOrder;
      io.to(_room()).emit("update_pizza_sizes", _st().pizzaSizes);
      savePizzaSizesToDb();
    }));

    socket.on("bulk_import", requireAdmin(async ({ menu: importedMenu, stock: importedStock, pizzaFlavors: impFlavors, pizzaCrusts: impCrusts, pizzariaConfig: impPizConfig, stockLog: impStockLog }) => {
      const previousImportedMenu = clonePersistenceData(_st().menu);
      const previousImportedConfig = clonePersistenceData(_st().pizzariaConfig);
      const hasImportedMenu = Array.isArray(importedMenu);
      const hasImportedConfig = !!impPizConfig && typeof impPizConfig === 'object' && !Array.isArray(impPizConfig);
      if (hasImportedMenu) _st().menu = clonePersistenceData(importedMenu);
      if (importedStock && Array.isArray(importedStock)) {
        _st().stock = importedStock;
        io.to(_room()).emit("update_stock", _st().stock);
        if (impStockLog && Array.isArray(impStockLog)) {
          _st().stockLog = impStockLog;
        } else {
          _st().stockLog = [];
        }
        io.to(_room()).emit("update_stock_log", _st().stockLog);
      }
      if (impFlavors && Array.isArray(impFlavors)) {
        _st().pizzaFlavors = impFlavors;
        io.to(_room()).emit("update_pizza_flavors", _st().pizzaFlavors);
        if (USE_POSTGRES) { for (const f of _st().pizzaFlavors) await pgSave('_st().pizzaFlavors', f); }
        else if (db) {
          try {
            await db.from('pizza_flavors').delete().eq('tenant_id', _tid());
            for (const f of _st().pizzaFlavors) {
              await db.from('pizza_flavors').upsert({ id: `${_tid()}:${f.name}`, name: f.name, category: f.category || null, price: f.price || null, available: f.available !== false, tenant_id: _tid() });
            }
          } catch {}
        }
      }
      if (impCrusts && Array.isArray(impCrusts)) {
        _st().pizzaCrusts = impCrusts;
        io.to(_room()).emit("update_pizza_crusts", _st().pizzaCrusts);
        if (USE_POSTGRES) { for (const c of _st().pizzaCrusts) await pgSave('_st().pizzaCrusts', { name: c }, c); }
        else if (db) {
          try {
            await db.from('pizza_crusts').delete().eq('tenant_id', _tid());
            for (const c of _st().pizzaCrusts) {
              await db.from('pizza_crusts').upsert({ id: `${_tid()}:${c}`, name: c, tenant_id: _tid() });
            }
          } catch {}
        }
      }
      if (hasImportedConfig) {
        const importedConfig = { ..._st().pizzariaConfig, ...impPizConfig, kdsEnabled: false };
        const normalized = normalizePlaygroundConfig(_tid(), importedConfig);
        _st().pizzariaConfig = {
          ...importedConfig,
          parquinhoEnabled: normalized.parquinhoEnabled,
          parquinhoChildNameRequired: normalized.parquinhoChildNameRequired,
          parquinhoPrice: normalized.parquinhoPrice,
          parquinhoProductId: normalized.parquinhoProductId,
        };
      }

      // Reconcile only after both imported pieces have been validated. The
      // module-off path deliberately keeps the existing managed product and
      // history untouched; the active path deduplicates root/submenu copies.
      if (hasImportedMenu || hasImportedConfig) {
        try {
          const catalog = synchronizePlaygroundCatalog(_st().menu, _tid(), _st().pizzariaConfig);
          if (catalog.changed) _st().menu = catalog.menu;
          if (hasImportedConfig) await saveToSupabase('config', _st().pizzariaConfig, 'pizzaria', _tid());
          if (hasImportedMenu || catalog.changed) {
            if (USE_POSTGRES) await pgDeleteMenu();
            else if (db) {
              try { await db.from('_st().menu').delete().neq('id', ''); } catch {}
            }
            await saveMenuToSupabaseAwait(_st(), _tid());
            io.to(_room()).emit("update_menu", _st().menu);
          }
          if (hasImportedConfig) io.to(_room()).emit("update_pizzaria_config", _st().pizzariaConfig);
        } catch (error: any) {
          _st().menu = previousImportedMenu;
          _st().pizzariaConfig = previousImportedConfig;
          socket.emit('error_message', error?.message || 'Não foi possível importar o catálogo/configuração.');
          return;
        }
      }
      socket.emit("import_complete", {
        menuCategories: importedMenu?.length ?? 0,
        stockItems: importedStock?.length ?? 0,
        flavors: impFlavors?.length ?? 0,
        crusts: impCrusts?.length ?? 0,
      });
    }));

    onTenantCommand("add_item_to_order", async ({ orderId, tableId: fallbackTableId, isComanda: fallbackIsComanda, item }) => {
      await loadTenantIfNeeded(_tid());
      if (isPlaygroundReservedItem(item, _tid())) return rejectPlaygroundReserved();
      if (!_st().isCashRegisterOpen) {
        socket.emit("error_message", "O caixa estÃ¡ fechado. Abra o caixa para adicionar itens.");
        return;
      }

      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? _st().waiters.find(w => w.id === waiterId) : null;

      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      let order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      let usedFallback = false;
      // Fallback: if orderId is stale/missing, resolve via mesa's currentOrder
      if (!order && fallbackTableId) {
        const targetList = fallbackIsComanda ? _st().comandas : _st().tables;
        const mesa = targetList.find((t: any) => t.id && String(t.id) === String(fallbackTableId));
        if (mesa?.currentOrder) {
          order = _st().orders.find((o: any) =>
            String(o.id) === String(mesa.currentOrder) &&
            o.status !== 'finalizada' && o.status !== 'aguardando_baixa'
          );
          if (order) usedFallback = true;
        }
      }

      // Fix D: pedido nao encontrado — sincroniza estado ao socket para corrigir view stale
      if (!order) {
        socket.emit('update_orders', _st().orders);
        socket.emit('update_tables', _st().tables);
        socket.emit('update_comandas', _st().comandas);
        return;
      }

      if (order.status === "aguardando_baixa") {
        socket.emit("error_message", "Pedido aguardando baixa no caixa. NÃ£o Ã© possÃ­vel adicionar itens.");
        return;
      }
      const resolvedWaiterName = waiter?.name || (socket as any).waiterName || item.waiterName || 'Desconhecido';
      // Resolve type from server _st().menu for non-pizza items
      let resolvedType = item.type;
      if (item.type !== 'pizzas') {
        const cat = item.menuItemId
          ? _st().menu.find((c: any) => c.items.some((i: any) => i.id === item.menuItemId) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.id === item.menuItemId)))
          : _st().menu.find((c: any) => c.items.some((i: any) => i.name === item.name) || (c.subcategories || []).some((s: any) => s.items?.some((i: any) => i.name === item.name)));
        if (cat?.type) resolvedType = cat.type;
      }
      const itemWithTimestamp = { ...item, type: resolvedType, waiterName: resolvedWaiterName, timestamp: new Date().toISOString() };
      writeAudit(_tid(), 'item_added', resolvedWaiterName,
        `"${item.name}" adicionado — Mesa ${order?.tableId ?? '?'}`,
        { orderId, tableId: order?.tableId });
      if (!order.items) order.items = [];
      order.items.push(itemWithTimestamp);

      // Emit immediately for fast UI
      io.to(_room()).emit("update_orders", _st().orders);
      // Fix C: se fallback foi usado, sincroniza tables para corrigir currentOrder pointer no cliente
      if (usedFallback) {
        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
      }
      const kPayload3 = { items: [itemWithTimestamp], tableId: order.tableId, isComanda: order.isComanda };
      io.to(_room()).emit("kitchen_new_order", kPayload3);
      emitPrintOrder(kPayload3);

      // Non-blocking: respond to socket immediately, persist in background
      enqueueWrite('orders', order, String(order.id), _tid());

      // Update _st().stock for the added item
      applyStockReduction(_st(), _tid(), [itemWithTimestamp]);
    });

    onTenantCommand("set_order_guests", async ({ orderId, guests }: { orderId: any, guests: string[] }) => {
      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order && Array.isArray(guests)) {
        (order as any).guests = guests;
        io.to(_room()).emit("update_orders", _st().orders);
        enqueueWrite('orders', order, String(order.id), _tid());
      }
    });

    onTenantCommand("set_item_guest", async ({ orderId, itemId, guestName }: { orderId: any, itemId: string, guestName: string | null }) => {
      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        const item = (order.items || []).find((i: any) => i.id === itemId);
        if (item) {
          (item as any).guestName = guestName || undefined;
          io.to(_room()).emit("update_orders", _st().orders);
          enqueueWrite('orders', order, String(order.id), _tid());
        }
      }
    });

    onTenantCommand("remove_item", async ({ orderId, itemId, quantity, reason, removedBy }) => {
      const waiterId = (socket as any).waiterId;
      const waiter = waiterId ? _st().waiters.find(w => w.id === waiterId) : null;
      
      if (waiter && waiter.status === "inactive") {
        socket.emit("error_message", "Seu acesso estÃ¡ inativo. Entre em contato com o gerente.");
        return;
      }

      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        const hasPartialPayment = (order.paymentLog || []).some((p: any) => p.type === 'partial');
        if (hasPartialPayment) {
          socket.emit("error_message", "NÃ£o Ã© possÃ­vel remover itens de uma comanda com pagamento parcial registrado.");
          return;
        }
        const itemIndex = order.items.findIndex(i => String(i.id) === String(itemId));
        if (itemIndex !== -1) {
          const item = order.items[itemIndex];
          const removeQty = quantity || item.quantity || 1;
          const currentQty = item.quantity || 1;

          if (removeQty < currentQty) {
            const unitPrice = item.price / currentQty;
            const removedItem = {
              ...item,
              id: randomUUID(),
              quantity: removeQty,
              price: unitPrice * removeQty,
              removed: true,
              removedBy: removedBy || (waiter ? waiter.name : "Desconhecido"),
              removalReason: reason || ""
            };
            item.quantity = currentQty - removeQty;
            item.price = unitPrice * (currentQty - removeQty);
            order.items.push(removedItem);
          } else {
            item.removed = true;
            item.removedBy = removedBy || (waiter ? waiter.name : "Desconhecido"),
            item.removalReason = reason || "";
          }
          const _removedActor = removedBy || (waiter ? waiter.name : 'ADM');
          writeAudit(_tid(), 'item_removed', _removedActor,
            `Item removido — Mesa ${order.tableId ?? '?'}${reason ? ` (${reason})` : ''}`,
            { orderId, reason: reason || null });
          enqueueWrite('orders', order, String(order.id), _tid());
          io.to(_room()).emit("update_orders", _st().orders);
        }
      }
    });

    onTenantCommand("pay_items", async ({ orderId, selectedItems, partialAmount, paymentMethod, payerName, fromAdmin, adminCashRegisterName }) => {
      const order = _st().orders.find(o => orderId && o.id && String(o.id) === String(orderId));
      if (order) {
        console.log(`Processing payment for order ${orderId}. Partial: ${partialAmount}`);
        if (!order.paymentLog) order.paymentLog = [];

        const cashRegisterAtPayment = Object.entries(_st().openCashRegisters).find(([, sid]) => sid === socket.id)?.[0] ?? (socket as any).activeCashRegisterName ?? adminCashRegisterName ?? (fromAdmin ? "ADM" : null);
        const waiterAtPayment = !cashRegisterAtPayment ? ((socket as any).waiterName ?? null) : null;
        const _payActor = cashRegisterAtPayment || waiterAtPayment || 'Desconhecido';

        const itemIds = Object.keys(selectedItems || {});
        const isPartialOnly = itemIds.length === 0;
        const numericPartialAmount = partialAmount !== undefined ? Number(partialAmount) : 0;

        if (isPartialOnly && numericPartialAmount > 0) {
          const payment: any = {
            amount: numericPartialAmount,
            method: paymentMethod || "NÃ£o informado",
            timestamp: new Date().toISOString(),
            type: 'partial' as const
          };
          if (payerName && typeof payerName === 'string') payment.payer = payerName.trim();
          if (cashRegisterAtPayment) payment.cashRegister = cashRegisterAtPayment;
          if (waiterAtPayment) payment.closedByWaiter = waiterAtPayment;
          order.paymentLog.push(payment);
        } else if (itemIds.length > 0) {
          const activeItemsForTotal = (order.items || []).filter(i => !i.removed);
          const selectedItemsTotal = activeItemsForTotal
            .filter(i => selectedItems[i.id] !== undefined)
            .reduce((acc, i) => {
              const qty = Number(selectedItems[i.id]);
              const price = getEffectiveItemPrice(i);
              const unitPrice = price / (i.quantity || 1);
              return acc + (unitPrice * qty);
            }, 0);

          const actualAmountPaid = partialAmount !== undefined ? Number(partialAmount) : selectedItemsTotal;

          const itemPayment: any = {
            amount: actualAmountPaid,
            method: paymentMethod || "NÃ£o informado",
            timestamp: new Date().toISOString(),
            type: 'items'
          };
          if (payerName && typeof payerName === 'string') itemPayment.payer = payerName.trim();
          if (cashRegisterAtPayment) itemPayment.cashRegister = cashRegisterAtPayment;
          if (waiterAtPayment) itemPayment.closedByWaiter = waiterAtPayment;
          order.paymentLog.push(itemPayment);
          
          itemIds.forEach(itemId => {
            const itemIndex = order.items.findIndex(i => String(i.id) === String(itemId));
            if (itemIndex !== -1) {
              const item = order.items[itemIndex];
              const payQty = Number(selectedItems[itemId] || 0);
              const currentQty = Number(item.quantity) || 1;

              if (payQty > 0 && payQty < currentQty) {
                const unitPrice = Number(item.price) / currentQty;
                const paidItem = {
                  ...item,
                  id: randomUUID(),
                  quantity: payQty,
                  price: unitPrice * payQty,
                  paid: true
                };
                item.quantity = currentQty - payQty;
                item.price = unitPrice * (currentQty - payQty);
                order.items.push(paidItem);
              } else {
                item.paid = true;
              }
            }
          });
        }

        // Check total paid from paymentLog
        const totalPaid = (order.paymentLog || []).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

        // Calculate final total with item-level discounts AND order-level discount
        const totalItemsPrice = (order.items || []).filter(i => !i.removed).reduce((acc, i) => acc + getEffectiveItemPrice(i), 0);

        let finalTotal = totalItemsPrice;
        if (order.discount) {
          const dVal = Number(order.discount) || 0;
          if (order.discountType === 'percentage') finalTotal *= (1 - dVal / 100);
          else finalTotal = Math.max(0, finalTotal - dVal);
        }
        
        // Use rounding to avoid floating point issues
        const roundedTotalPaid = Math.round(totalPaid * 100) / 100;
        const roundedFinalTotal = Math.round(finalTotal * 100) / 100;

        console.log(`Order ${orderId}: ItemsTotal: ${totalItemsPrice.toFixed(2)}, FinalTotal: ${roundedFinalTotal.toFixed(2)}, PaidSoFar: ${roundedTotalPaid.toFixed(2)}`);

        // Use a clearer epsilon comparison (allow for small rounding differences)
        const IS_FULLY_PAID = roundedTotalPaid >= (roundedFinalTotal - 0.1);

        if (IS_FULLY_PAID) {
          if (fromAdmin) {
            // Pagamento via ADM: libera mesa imediatamente sem passar por aguardando_baixa
            console.log(`Order ${orderId} fully paid via admin. Freeing _st().tables directly.`);
            order.status = "finalizada";

            const entitiesToUpdate: any[] = [];
            _st().tables.forEach((t: any) => {
              if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
                t.status = "free";
                t.currentOrder = null;
                t.linkedTo = null;
                entitiesToUpdate.push({ entity: t, collection: 'tables' });
              }
            });
            _st().comandas.forEach((c: any) => {
              if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
                c.status = "free";
                c.currentOrder = null;
                c.linkedTo = null;
                entitiesToUpdate.push({ entity: c, collection: 'comandas' });
              }
            });

            io.to(_room()).emit("update_orders", _st().orders);
            io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
            await saveToSupabase('orders', order, String(order.id), _tid());
            for (const item of entitiesToUpdate) {
              await saveToSupabase(item.collection, item.entity, String(item.entity.id), _tid());
            }
            return;
          } else {
            // Pagamento via GarÃ§om: aguarda baixa para liberar mesa
            console.log(`Order ${orderId} fully paid. Setting aguardando_baixa.`);
            order.status = "aguardando_baixa";

            _st().tables.forEach(t => {
              if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
                t.status = "aguardando_baixa";
                saveToSupabase('tables', t, String(t.id), _tid()).catch(() => {});
              }
            });
            _st().comandas.forEach(c => {
              if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
                c.status = "aguardando_baixa";
                saveToSupabase('comandas', c, String(c.id), _tid()).catch(() => {});
              }
            });
          }
        }

        // Emit updates IMMEDIATELY for UI responsiveness
        io.to(_room()).emit("update_orders", _st().orders);
        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);

        const _paidAmount = (order.paymentLog || []).slice(-1)[0]?.amount ?? 0;
        const _paidMethod = (order.paymentLog || []).slice(-1)[0]?.method ?? '?';
        writeAudit(_tid(), 'payment', _payActor,
          `Pagamento R$ ${Number(_paidAmount).toFixed(2)} (${_paidMethod}) — Mesa ${order.tableId ?? '?'}`,
          { orderId, amount: _paidAmount, method: _paidMethod });

        await saveToSupabase('orders', order, String(order.id), _tid());
      }
    });

    onTenantCommand("link_tables", requireAdmin(async ({ sourceTableId, targetTableId, isComanda }) => {
      const targetList = isComanda ? _st().comandas : _st().tables;
      const sourceTable = targetList.find(t => String(t.id) === String(sourceTableId));
      let targetTable = targetList.find(t => String(t.id) === String(targetTableId));

      if (sourceTable && targetTable) {
        // Find ultimate target if the target is already linked
        const visited = new Set([String(sourceTable.id), String(targetTable.id)]);
        while (targetTable.status === "linked" && targetTable.linkedTo) {
          const nextTable = targetList.find(t => String(t.id) === String(targetTable.linkedTo));
          if (!nextTable || visited.has(String(nextTable.id))) break;
          targetTable = nextTable;
          visited.add(String(targetTable.id));
        }
        const finalTargetTableId = targetTable.id;

        // If source has an order, transfer items to target
        if (sourceTable.currentOrder) {
          const sourceOrder = _st().orders.find(o => String(o.id) === String(sourceTable.currentOrder));
          if (sourceOrder) {
            if (targetTable.currentOrder) {
              const targetOrder = _st().orders.find(o => String(o.id) === String(targetTable.currentOrder));
              if (targetOrder) {
                // Merge items preserving paid flags
                targetOrder.items.push(...sourceOrder.items);

                // Merge paymentLog so partial payments from source are preserved
                // in the pending amount calculation of the unified order
                if (sourceOrder.paymentLog && sourceOrder.paymentLog.length > 0) {
                  if (!targetOrder.paymentLog) targetOrder.paymentLog = [];
                  targetOrder.paymentLog.push(...sourceOrder.paymentLog);
                }

                // Carry over source discount to target only if target has none
                if (sourceOrder.discount && !targetOrder.discount) {
                  targetOrder.discount = sourceOrder.discount;
                  targetOrder.discountType = sourceOrder.discountType;
                }

                sourceOrder.status = "finalizada";
              }
            } else {
              sourceOrder.tableId = finalTargetTableId;
              targetTable.currentOrder = sourceOrder.id;
              targetTable.status = "occupied";
            }
          }
        }

        sourceTable.status = "linked";
        sourceTable.linkedTo = finalTargetTableId;
        sourceTable.currentOrder = targetTable.currentOrder;

        // Update all _st().tables and _st().comandas that were linked to source to now point to ultimateTarget
        const updateLinked = (t) => {
          if (String(t.linkedTo) === String(sourceTable.id)) {
            t.linkedTo = finalTargetTableId;
            t.currentOrder = targetTable.currentOrder;
          }
        };
        if (isComanda) {
          _st().comandas.forEach(updateLinked);
        } else {
          _st().tables.forEach(updateLinked);
        }

        // Persist changes to Firestore
        const tableCol = isComanda ? '_st().comandas' : '_st().tables';
        await saveToSupabase(tableCol, sourceTable, sourceTable.id.toString(), _tid());
        await saveToSupabase(tableCol, targetTable, targetTable.id.toString(), _tid());
        
        if (targetTable.currentOrder) {
          const tOrder = _st().orders.find(o => o.id.toString() === targetTable.currentOrder.toString());
          if (tOrder) await saveToSupabase('orders', tOrder, tOrder.id.toString(), _tid());
        }

        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        io.to(_room()).emit("update_orders", _st().orders);
      }
    }));

    onTenantCommand("transfer_table", async ({ sourceTableId, targetTableId, isComanda, reason }) => {
      const targetList = isComanda ? _st().comandas : _st().tables;
      const sourceTable = targetList.find(t => String(t.id) === String(sourceTableId));
      const targetTable = targetList.find(t => String(t.id) === String(targetTableId));

      if (sourceTable && targetTable && sourceTable.currentOrder) {
        const sourceOrder = _st().orders.find(o => String(o.id) === String(sourceTable.currentOrder));
        const targetOrder = targetTable.currentOrder ? _st().orders.find(o => String(o.id) === String(targetTable.currentOrder)) : null;

        if (sourceOrder) {
          if (targetOrder) {
            // Merge items
            sourceOrder.items.forEach(item => {
              targetOrder.items.push({
                ...item,
                id: randomUUID(),
                transferReason: reason || "Troca de mesa"
              });
            });
            // Merge observations
            if (sourceOrder.observations) {
              targetOrder.observations = targetOrder.observations 
                ? `${targetOrder.observations} | ${sourceOrder.observations}`
                : sourceOrder.observations;
            }
            // Remove source order
            const sourceOrderIndex = _st().orders.findIndex(o => String(o.id) === String(sourceOrder.id));
            if (sourceOrderIndex !== -1) _st().orders.splice(sourceOrderIndex, 1);
          } else {
            // Simple transfer
            sourceOrder.tableId = targetTableId;
            targetTable.currentOrder = sourceOrder.id;
            targetTable.status = sourceTable.status === "linked" ? "occupied" : sourceTable.status;
          }
          
          // Update any _st().tables/_st().comandas linked to the source table to point to the target table
          const updateLinked = (t) => {
            if (String(t.linkedTo) === String(sourceTableId)) {
              t.linkedTo = targetTableId;
              t.currentOrder = targetTable.currentOrder;
            }
          };
          if (isComanda) {
            _st().comandas.forEach(updateLinked);
          } else {
            _st().tables.forEach(updateLinked);
          }

          sourceTable.currentOrder = null;
          sourceTable.status = "free";
          sourceTable.linkedTo = null;

          // Persist changes
          await saveToSupabase(isComanda ? 'comandas' : 'tables', sourceTable, sourceTable.id.toString(), _tid());
          await saveToSupabase(isComanda ? 'comandas' : 'tables', targetTable, targetTable.id.toString(), _tid());
          if (sourceOrder) await saveToSupabase('orders', sourceOrder, sourceOrder.id, _tid());
          if (targetOrder) await saveToSupabase('orders', targetOrder, targetOrder.id, _tid());
        }

        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        io.to(_room()).emit("update_orders", _st().orders);
      }
    });

    onTenantCommand("transfer_items", async ({ sourceTableId, targetTableId, isComanda, itemIds }) => {
      console.log(`[transfer_items] src=${sourceTableId} dst=${targetTableId} isComanda=${isComanda} itemIds=${JSON.stringify(itemIds)}`);

      const tableList = isComanda ? _st().comandas : _st().tables;
      const sourceTable = tableList.find(t => String(t.id) === String(sourceTableId));
      const targetTable = tableList.find(t => String(t.id) === String(targetTableId));

      if (!sourceTable || !targetTable) {
        console.warn(`[transfer_items] table not found: src=${!!sourceTable} dst=${!!targetTable}`);
        return;
      }
      if (!sourceTable.currentOrder) {
        console.warn(`[transfer_items] sourceTable has no currentOrder`);
        return;
      }

      const sourceOrder = _st().orders.find(o => String(o.id) === String(sourceTable.currentOrder));
      if (!sourceOrder) {
        console.warn(`[transfer_items] sourceOrder not found for id=${sourceTable.currentOrder}`);
        return;
      }

      const hasPartialPayment = (sourceOrder.paymentLog || []).some((p: any) => p.type === 'partial');
      if (hasPartialPayment) {
        socket.emit("error_message", "NÃ£o Ã© possÃ­vel transferir itens: a mesa possui pagamento parcial registrado.");
        return;
      }

      const itemIdSet = new Set((itemIds || []).map(String));
      console.log(`[transfer_items] itemIdSet=${JSON.stringify([...itemIdSet])}`);
      console.log(`[transfer_items] sourceOrder.items ids=${JSON.stringify(sourceOrder.items.map((i: any) => ({ id: i.id, removed: i.removed, paid: i.paid })))}`);

      // Reject if any of the requested items are already paid
      const paidRequested = sourceOrder.items.filter(
        (i: any) => itemIdSet.has(String(i.id)) && i.paid
      );
      if (paidRequested.length > 0) {
        socket.emit("error_message", "NÃ£o Ã© possÃ­vel transferir item(s) jÃ¡ pagos.");
        return;
      }

      // Collect items BEFORE any mutation (excludes removed and paid)
      const itemsToTransfer = sourceOrder.items.filter(
        (i: any) => itemIdSet.has(String(i.id)) && !i.removed && !i.paid
      );
      if (itemsToTransfer.length === 0) {
        console.warn(`[transfer_items] itemsToTransfer is empty â€" no matching active items found`);
        return;
      }
      console.log(`[transfer_items] itemsToTransfer.length=${itemsToTransfer.length}`);

      // Find or create target order â€" ignore finalized _st().orders (items would be invisible)
      let targetOrder: any = targetTable.currentOrder
        ? _st().orders.find(o => String(o.id) === String(targetTable.currentOrder) && o.status !== 'finalizada')
        : null;

      if (!targetOrder) {
        targetOrder = {
          id: generateOrderId(_st(), _tid()),
          tableId: Number(targetTableId),
          isComanda: !!isComanda,
          status: 'pending',
          items: [],
          timestamp: new Date().toISOString(),
          paymentLog: [],
          waiterName: sourceOrder.waiterName || 'TransferÃªncia'
        };
        _st().orders.push(targetOrder);
        targetTable.currentOrder = targetOrder.id;
        targetTable.status = 'occupied';
        console.log(`[transfer_items] created new targetOrder id=${targetOrder.id}`);
      } else {
        console.log(`[transfer_items] reusing existing targetOrder id=${targetOrder.id}`);
      }

      const tableCol = isComanda ? '_st().comandas' : '_st().tables';

      // Mark each source item as removed, then deep-copy a clean version to target
      itemsToTransfer.forEach((item: any) => {
        item.removed = true;
        item.removedBy = 'Sistema';
        item.removalReason = `Transferido para ${isComanda ? 'Comanda' : 'Mesa'} ${targetTableId}`;

        const clone = JSON.parse(JSON.stringify(item));
        clone.id = randomUUID();
        clone.removed = false;
        delete clone.removedBy;
        delete clone.removalReason;
        clone.transferredFrom = `${isComanda ? 'Comanda' : 'Mesa'} ${sourceTableId}`;
        targetOrder.items.push(clone);
      });

      // If source has no remaining active items, free source table and any _st().tables linked to it
      const remainingActive = sourceOrder.items.filter((i: any) => !i.removed && !i.paid);
      console.log(`[transfer_items] remainingActive=${remainingActive.length}`);

      // Capture linked _st().tables BEFORE nulling their linkedTo (so we can persist them later)
      const linkedTablesToFree = remainingActive.length === 0
        ? tableList.filter((t: any) => t.id !== sourceTable.id && String(t.linkedTo) === String(sourceTableId))
        : [];

      if (remainingActive.length === 0) {
        sourceOrder.status = 'finalizada';
        sourceTable.currentOrder = null;
        sourceTable.status = 'free';
        sourceTable.linkedTo = null;
        for (const lt of linkedTablesToFree) {
          lt.linkedTo = null;
          lt.currentOrder = null;
          lt.status = 'free';
        }
      }

      // Emit immediately with the correct in-memory state BEFORE async Firestore saves.
      // This prevents the Firestore onSnapshot (triggered by saveToSupabase) from racing
      // and emitting stale data that overwrites the correct state on clients.
      io.to(_room()).emit("update_orders", _st().orders);
      io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
      console.log(`[transfer_items] emitted updates â€" persisting to Firestore`);

      // Persist to Firestore (onSnapshot will re-emit after each save with the same correct data)
      await saveToSupabase('orders', sourceOrder, String(sourceOrder.id), _tid());
      await saveToSupabase('orders', targetOrder, String(targetOrder.id), _tid());
      await saveToSupabase(tableCol, targetTable, targetTable.id.toString(), _tid());
      if (remainingActive.length === 0) {
        await saveToSupabase(tableCol, sourceTable, sourceTable.id.toString(), _tid());
        for (const lt of linkedTablesToFree) {
          await saveToSupabase(tableCol, lt, lt.id.toString(), _tid());
        }
      }
      console.log(`[transfer_items] Firestore persistence complete`);
    });

    onTenantCommand("apply_discount", requireAdmin(async ({ orderId, itemId, discount, discountType }) => {
      const order = _st().orders.find(o => String(o.id) === String(orderId));
      if (order) {
        if (itemId) {
          const item = order.items.find(i => String(i.id) === String(itemId));
          if (item) {
            item.discount = Number(discount);
            item.discountType = discountType;
          }
        } else {
          order.discount = Number(discount);
          order.discountType = discountType;
        }
        await saveToSupabase('orders', order, order.id, _tid());
        io.to(_room()).emit("update_orders", _st().orders);
      }
    }));

    onTenantCommand("confirm_baixa", async ({ orderId }) => {
      const order = _st().orders.find((o: any) => String(o.id) === String(orderId));
      if (!order || order.status !== "aguardando_baixa") return;

      order.status = "finalizada";
      const cashRegisterAtClose = Object.entries(_st().openCashRegisters).find(([, sid]) => sid === socket.id)?.[0] ?? null;
      if (cashRegisterAtClose) order.cashRegisterClosedBy = cashRegisterAtClose;

      const entitiesToUpdate: any[] = [];
      _st().tables.forEach((t: any) => {
        if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
          t.status = "free";
          t.currentOrder = null;
          t.linkedTo = null;
          entitiesToUpdate.push({ entity: t, collection: 'tables' });
        }
      });
      _st().comandas.forEach((c: any) => {
        if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
          c.status = "free";
          c.currentOrder = null;
          c.linkedTo = null;
          entitiesToUpdate.push({ entity: c, collection: 'comandas' });
        }
      });

      io.to(_room()).emit("update_orders", _st().orders);
      io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);

      await saveToSupabase('orders', order, String(order.id), _tid());
      for (const item of entitiesToUpdate) {
        await saveToSupabase(item.collection, item.entity, String(item.entity.id), _tid());
      }
      // Invalidar sessão do cliente ao dar baixa
      _st().tables.forEach((t: any) => { if (String(t.currentOrder) === String(orderId) || (order.tableId && t.id === order.tableId)) invalidateClientSession(_tid(), t.id, false); });
      _st().comandas.forEach((c: any) => { if (String(c.currentOrder) === String(orderId) || (order.isComanda && c.id === order.tableId)) invalidateClientSession(_tid(), c.id, true); });
      console.log(`Baixa confirmada para pedido ${orderId}`);
    });

    onTenantCommand("update_order_status", async ({ orderId, status }) => {
      const order = _st().orders.find(o => String(o.id) === String(orderId));
      if (order) {
        order.status = status;
        await saveToSupabase('orders', order, order.id, _tid());
        io.to(_room()).emit("update_orders", _st().orders);
      }
    });

    onTenantCommand("force_release_table", requireAdmin(async ({ orderId }) => {
      const order = _st().orders.find((o: any) => String(o.id) === String(orderId));
      if (!order || order.status === 'finalizada' || order.status === 'paid') return;

      order.status = 'finalizada';
      (order as any).forceReleased = true;

      const entitiesToUpdate: any[] = [];
      _st().tables.forEach((t: any) => {
        if (t.currentOrder && String(t.currentOrder) === String(order.id)) {
          t.status = 'free'; t.currentOrder = null; t.linkedTo = null;
          entitiesToUpdate.push({ entity: t, collection: 'tables' });
        }
      });
      _st().comandas.forEach((c: any) => {
        if (c.currentOrder && String(c.currentOrder) === String(order.id)) {
          c.status = 'free'; c.currentOrder = null; c.linkedTo = null;
          entitiesToUpdate.push({ entity: c, collection: 'comandas' });
        }
      });

      io.to(_room()).emit('update_orders', _st().orders);
      io.to(_room()).emit('update_tables', _st().tables);
      io.to(_room()).emit('update_comandas', _st().comandas);

      await saveToSupabase('orders', order, String(order.id), _tid());
      for (const item of entitiesToUpdate) {
        await saveToSupabase(item.collection, item.entity, String(item.entity.id), _tid());
      }
      writeAudit(_tid(), 'force_release' as any, 'ADM',
        `Mesa liberada à força — Pedido ${orderId}`, { orderId });
      console.log(`[force_release_table] pedido ${orderId} finalizado e mesa liberada`);
    }));

    onTenantCommand("request_bill", async ({ tableId, isComanda }) => {
      const targetList = isComanda ? _st().comandas : _st().tables;
      const table = targetList.find(t => t.id === tableId);
      if (table) {
        table.status = "bill_requested";
        await saveToSupabase(isComanda ? 'comandas' : 'tables', table, table.id.toString(), _tid());
        io.to(_room()).emit("update_tables", _st().tables);
        io.to(_room()).emit("update_comandas", _st().comandas);
        io.to(_room()).emit("bill_requested", { tableId, isComanda: !!isComanda, timestamp: Date.now() });
      }
    });

    onTenantCommand("close_table", async ({ tableId, isComanda }) => {
      // Capture the tenant before awaiting persistence so this operation stays scoped.
      const tenantId = _tid();
      const st = _st();
      const room = _room();
      const sameId = (left: any, right: any) =>
        left != null && right != null && String(left) === String(right);
      const targetList = isComanda ? st.comandas : st.tables;
      const table = targetList.find(t => sameId(t.id, tableId));
      
      if (table) {
        // Find the ultimate target table if this one is linked
        let ultimateTargetId = tableId;
        let current = table;
        const visited = new Set([String(current.id)]);
        while (current.status === "linked" && current.linkedTo != null) {
          const next = targetList.find(t => sameId(t.id, current.linkedTo));
          if (!next || visited.has(String(next.id))) break;
          current = next;
          visited.add(String(current.id));
          ultimateTargetId = current.id;
        }

        const orderId = current.currentOrder;
        const order = st.orders.find(o => sameId(o.id, orderId));
        
        // Free the target and entities in the same sector linked to it or its order.
        const entitiesToFree: any[] = [];
        const processFree = (t, targetId, orderId) => {
          if (
            sameId(t.id, targetId) ||
            sameId(t.linkedTo, targetId) ||
            sameId(t.currentOrder, orderId)
          ) {
            t.status = "free";
            t.currentOrder = null;
            t.linkedTo = null;
            entitiesToFree.push(t);
          }
        };

        targetList.forEach(entity => processFree(entity, ultimateTargetId, orderId));

        // Also ensure the initial tableId is freed if it wasn't covered
        if (!entitiesToFree.includes(table)) {
          table.status = "free";
          table.currentOrder = null;
          table.linkedTo = null;
          entitiesToFree.push(table);
        }

        // Finalize the order before persistence or any broadcast of the freed table.
        if (order) {
          order.status = "finalizada";
          await saveToSupabase('orders', order, String(order.id), tenantId);
        }

        const collection = isComanda ? 'comandas' : 'tables';
        for (const entity of entitiesToFree) {
          await saveToSupabase(collection, entity, String(entity.id), tenantId);
        }

        // All payloads now describe the same final state: order closed, table free.
        io.to(room).emit("update_orders", st.orders);
        io.to(room).emit("update_tables", st.tables);
        io.to(room).emit("update_comandas", st.comandas);
      }
    });

    // Reset is destructive and must be an authenticated ADM command. The
    // tenant is captured before entering the queue; no late socket tenant is
    // consulted while the wipe is waiting behind another command.
    socket.on("reset_system", async () => {
      const tenantId = String((socket as any).authContext?.tenantId || (socket as any).tenantId || '').trim();
      if (!tenantId || !isAdminForTenant(tenantId)) {
        socket.emit('auth_error', { message: 'Reset do sistema exige administrador autenticado.' });
        return false;
      }
      return withTenantCommand(tenantId, async () => {
        if (!isAdminForTenant(tenantId)) {
          socket.emit('auth_error', { message: 'Sessão administrativa inválida para este tenant.' });
          return false;
        }
        const st = getState(tenantId);
        const room = 'tenant:' + tenantId;
        console.log(`reset_system: clearing tenant ${tenantId} orders, tables, comandas and stockLog`);

        st.orders = [];
        st.stockLog = [];
        st.tables.forEach(t => {
          t.status = "free";
          t.currentOrder = null;
          t.linkedTo = null;
        });
        st.comandas.forEach(c => {
          c.status = "free";
          c.currentOrder = null;
          c.linkedTo = null;
        });
        st.isCashRegisterOpen = false;
        st.openCashRegisters = {};

        // Persist the same tenant-scoped state before acknowledging completion.
        try {
          if (db) {
            // Preserva histórico: apenas marca pedidos ativos como finalizados em vez de deletar
            await db.from('orders').update({ status: 'finalizada' }).eq('tenant_id', tenantId).neq('status', 'finalizada');
            await db.from('tables').update({ status: 'free', current_order: null, linked_to: null }).eq('tenant_id', tenantId);
            await db.from('comandas').update({ status: 'free', current_order: null, linked_to: null }).eq('tenant_id', tenantId);
            await db.from('config').upsert({ id: `${tenantId}:stockLog`, data: { stockLog: [] }, tenant_id: tenantId });
            await saveToSupabase('config', cashRegisterConfigPatch(st), 'app', tenantId);
          }
        } catch (err) {
          console.error(`reset_system: failed to clear tenant ${tenantId}`, err);
          socket.emit('error_message', 'O reset foi aplicado em memória, mas falhou ao persistir no banco.');
          return false;
        }

        io.to(room).emit("update_orders", st.orders);
        io.to(room).emit("update_stock_log", st.stockLog);
        io.to(room).emit("update_tables", st.tables);
        io.to(room).emit("update_comandas", st.comandas);
        io.to(room).emit("update_cash_register", false);
        return true;
      });
    });

    // Cliente pede status atual do agente (ex: após reconexão do socket)
    socket.on("request_agent_status", () => {
      if (!isApprovedWaiterSocket()) return; // emitido antes do admin_connect na reconexão — ignorar silenciosamente
      // Verifica estado em memória; se offline, varre sockets ativos do tenant
      let online = !!(_st().printerAgentSocket?.connected);
      if (!online) {
        const tid = _tid();
        io.sockets.sockets.forEach((s: any) => {
          if (s.isPrinterAgent && s.tenantId === tid && s.connected) {
            _st().printerAgentSocket = s;
            online = true;
          }
        });
      }
      socket.emit("printer_agent_status", { online });
    });

    // Scan de impressoras — Dashboard pede, servidor repassa ao agente
    socket.on("scan_printers_request", () => {
      if (!isApprovedWaiterSocket()) {
        socket.emit('auth_error', { message: 'Autentique um garçom aprovado ou administrador.' });
        return;
      }
      // Recupera referência perdida após restart (mesma lógica de request_agent_status)
      if (!_st().printerAgentSocket?.connected) {
        const tid = _tid();
        io.sockets.sockets.forEach((s: any) => {
          if (s.isPrinterAgent && s.tenantId === tid && s.connected) {
            _st().printerAgentSocket = s;
          }
        });
        if (_st().printerAgentSocket?.connected) {
          io.to('tenant:' + tid).emit('printer_agent_status', { online: true });
        }
      }
      if (_st().printerAgentSocket?.connected) {
        _st().printerAgentSocket.emit("scan_printers_request");
      } else {
        socket.emit("scan_printers_result", { printers: [], error: "Agente offline" });
      }
    });

    // ── Caixas ativos: quais nomes têm socket conectado agora ────────────────
    socket.on("get_active_caixas", () => {
      const tenantId = _tid();
      if (!isApprovedWaiterSocket(tenantId)) {
        socket.emit('auth_error', { message: 'Autentique um garçom aprovado ou administrador.' });
        return;
      }
      const st = getState(tenantId);
      const active = Object.entries(st.openCashRegisters)
        .filter(([, sid]) => io.sockets.sockets.get(sid as string)?.connected)
        .map(([name]) => name);
      socket.emit("active_caixas", active);
    });

    // ── Impressão ESC/POS ─────────────────────────────────────────────────────
    // Se o agente local estiver conectado, delega para ele (cenário VPS).
    // Caso contrário, o servidor tenta conexão TCP direta (cenário local/dev).
    // Se targetCaixaId for fornecido, retransmite para o socket daquele caixa.
    socket.on("print_escpos", ({ ip, port = 9100, localName, data, targetCaixaId }: { ip?: string; port?: number; localName?: string; data: number[]; targetCaixaId?: string }) => {
      if (!isApprovedWaiterSocket()) {
        socket.emit('auth_error', { message: 'Autentique um garçom aprovado ou administrador.' });
        return;
      }
      if (!data?.length) return;

      if (targetCaixaId && targetCaixaId !== 'local') {
        const targetSocketId = _st().openCashRegisters[targetCaixaId] as string | undefined;
        const targetSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : null;
        if (targetSocket?.connected) {
          targetSocket.emit("relay_print_job", { ip, port, localName, data });
          return;
        }
        // Caixa alvo não encontrado — cai no fluxo normal
      }

      // Recupera referência perdida após restart antes de tentar imprimir
      if (!_st().printerAgentSocket?.connected) {
        const tid = _tid();
        io.sockets.sockets.forEach((s: any) => {
          if (s.isPrinterAgent && s.tenantId === tid && s.connected) {
            _st().printerAgentSocket = s;
          }
        });
        if (_st().printerAgentSocket?.connected) {
          io.to('tenant:' + tid).emit('printer_agent_status', { online: true });
        }
      }
      if (_st().printerAgentSocket && _st().printerAgentSocket.connected) {
        _st().printerAgentSocket.emit("do_print", { ip, port, localName, data });
        return;
      }

      // Sem agente e sem IP → não há como imprimir no servidor (USB é local)
      if (!ip) {
        socket.emit("print_result", { success: false, error: "Impressora USB requer o agente local conectado." });
        return;
      }

      // Fallback: conexão TCP direta (funciona apenas quando servidor e impressora estão na mesma rede)
      const client = new net.Socket();
      let finished = false;
      const done = () => { if (!finished) { finished = true; client.destroy(); } };

      client.setTimeout(6000);
      client.connect(port, ip, () => {
        client.write(Buffer.from(data), () => {
          socket.emit("print_result", { success: true, ip });
          setTimeout(done, 300);
        });
      });
      client.on("timeout", () => {
        socket.emit("print_result", { success: false, ip, error: "Timeout — impressora não responde" });
        done();
      });
      client.on("error", (err: Error) => {
        socket.emit("print_result", { success: false, ip, error: err.message });
        done();
      });
    });

    // Consolidated init_data is at the beginning of connection

    // ── Cliente connect (página /mesa/:tenantId/:mesaId) ──────────────────
    socket.on("client_connect", async ({ tenantId }: { tenantId: string }) => {
      if (!tenantId) return;
      if (authActorSafe((socket as any).authContext)) {
        socket.emit('auth_error', { message: 'Sessão autenticada não pode assumir identidade de cliente.' });
        return;
      }
      (socket as any).isClient = true;
      const tenantGeneration = switchSocketTenant(socket, tenantId);
      // Garante que o tenant está carregado antes de enviar os pedidos
      await loadTenantIfNeeded(tenantId);
      if (socket.connected === false || (socket as any).tenantId !== tenantId ||
          (socket as any).tenantGeneration !== tenantGeneration) return;
      const st = tenants.get(tenantId);
      if (st) socket.emit('update_orders', st.orders || []);
    });

    // ── Chama Garçom ──────────────────────────────────────────────────────
    socket.on("call_waiter", ({ tableId, rateLimitMinutes }: { tableId: number; rateLimitMinutes?: number }) => {
      const id = Number(tableId);
      if (!id || isNaN(id)) return;

      // Caixa deve estar aberto
      if (!_st().isCashRegisterOpen) {
        socket.emit("call_waiter_result", { success: false, tableId: id });
        return;
      }

      // Rate limiting por mesa (keyed por tenant:mesa)
      const limitMs = Math.max(1, Math.min(rateLimitMinutes ?? 3, 60)) * 60 * 1000;
      const now = Date.now();
      const cooldownKey = `${_tid()}:${id}`;
      const lastCall = callWaiterCooldown.get(cooldownKey) ?? 0;
      if (now - lastCall < limitMs) {
        socket.emit("call_waiter_result", { success: false, tableId: id });
        return;
      }
      callWaiterCooldown.set(cooldownKey, now);

      socket.emit("call_waiter_result", { success: true, tableId: id });
      io.to(_room()).emit("waiter_called", { tableId: id, timestamp: now });
    });
    // ── End Chama Garçom ───────────────────────────────────────────────────

  });

  // API Routes
  // Rotas administrativas usam autenticação por requisição. O helper só
  // autoriza depois que o Supabase Auth confirma o token com getUser; quando
  // o servidor está em modo PostgreSQL/local sem cliente Supabase, falha
  // fechada em vez de transformar a ausência de auth em bypass.
  const { authorizeAdminRequest, sendAdminAuthFailure } = await import('./src/server/admin-auth.ts');
  const getSupabaseUser = db?.auth?.getUser
    ? db.auth.getUser.bind(db.auth)
    : undefined;
  const requireAdminHttp = async (
    req: any,
    res: any,
    tenantIds: unknown[] = [],
    requireTenant = true,
  ) => {
    const authorization = await authorizeAdminRequest(req, {
      getUser: getSupabaseUser,
      tenantIds,
      requireTenant,
    });
    if (authorization.ok) return authorization;
    sendAdminAuthFailure(res, authorization as any);
    return null;
  };
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Proxy de renovação de token: o browser chama este endpoint (mesmo domínio)
  // e o servidor faz a chamada ao Supabase auth — contorna extensões que bloqueiam
  // requisições diretas ao domínio do Supabase.
  app.post("/api/auth/refresh", express.json({ limit: '4kb' }), async (req, res) => {
    try {
      const { refresh_token } = req.body ?? {};
      if (!refresh_token || typeof refresh_token !== 'string' || refresh_token.length < 20) {
        res.status(400).json({ error: 'refresh_token inválido' });
        return;
      }
      const supabaseBase = (process.env.SUPABASE_URL || 'https://iagflqaopurjnnzkunph.supabase.co').replace(/\/$/, '');
      const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhZ2ZscWFvcHVyam5uemt1bnBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMDk1MjcsImV4cCI6MjA5NTU4NTUyN30.A6OxNQ3gRUMzr-KLicnm83mG3SrT7U4J8CP6EjMZRmo';
      const upstream = await fetch(`${supabaseBase}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
        body: JSON.stringify({ refresh_token }),
      });
      const payload = await upstream.json() as any;
      if (!upstream.ok || !payload.access_token) {
        res.status(401).json({ error: payload.error_description || payload.msg || 'Refresh falhou' });
        return;
      }
      res.json({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token ?? refresh_token,
        expires_in: payload.expires_in ?? 3600,
        token_type: payload.token_type ?? 'bearer',
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Erro interno ao renovar sessão' });
    }
  });

  // POST /api/auth/signup — proxy de cadastro para contornar extensões que bloqueiam supabase.co
  app.post('/api/auth/signup', express.json({ limit: '8kb' }), async (req, res) => {
    try {
      const { email, password, establishment_name, plan } = req.body ?? {};
      if (!email || !password) {
        res.status(400).json({ error: 'email e password são obrigatórios' });
        return;
      }
      const supabaseBase = (process.env.SUPABASE_URL || 'https://iagflqaopurjnnzkunph.supabase.co').replace(/\/$/, '');
      const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhZ2ZscWFvcHVyam5uemt1bnBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMDk1MjcsImV4cCI6MjA5NTU4NTUyN30.A6OxNQ3gRUMzr-KLicnm83mG3SrT7U4J8CP6EjMZRmo';
      const upstream = await fetch(`${supabaseBase}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
        body: JSON.stringify({
          email,
          password,
          data: { establishment_name: establishment_name || '', plan: plan || 'premium' },
        }),
      });
      const payload = await upstream.json() as any;
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: payload.error_description || payload.msg || payload.error || 'Cadastro falhou' });
        return;
      }
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ error: 'Erro interno ao criar conta' });
    }
  });

  // POST /api/auth/signin — proxy de login para contornar extensões que bloqueiam supabase.co
  app.post('/api/auth/signin', express.json({ limit: '4kb' }), async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        res.status(400).json({ error: 'email e password são obrigatórios' });
        return;
      }
      const supabaseBase = (process.env.SUPABASE_URL || 'https://iagflqaopurjnnzkunph.supabase.co').replace(/\/$/, '');
      const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhZ2ZscWFvcHVyam5uemt1bnBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMDk1MjcsImV4cCI6MjA5NTU4NTUyN30.A6OxNQ3gRUMzr-KLicnm83mG3SrT7U4J8CP6EjMZRmo';
      const upstream = await fetch(`${supabaseBase}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': anonKey },
        body: JSON.stringify({ email, password }),
      });
      const payload = await upstream.json() as any;
      if (!upstream.ok || !payload.access_token) {
        res.status(upstream.status || 401).json({ error: payload.error_description || payload.msg || payload.error || 'Login falhou' });
        return;
      }
      res.json({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_in: payload.expires_in ?? 3600,
        token_type: payload.token_type ?? 'bearer',
        user: payload.user,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Erro interno ao autenticar' });
    }
  });

  app.get("/api/version", (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...appVersion, pr: LATEST_PR });
  });

  app.get("/api/order-by-table/:tenantId/:tableId", (req, res) => {
    const { tenantId, tableId } = req.params;
    const st = tenants.get(tenantId);
    if (!st) return res.json({ order: null });
    const order = (st.orders || []).find(
      (o: any) => String(o.tableId) === String(tableId) && !o.isComanda && o.status !== 'finalizada'
    );
    res.json({ order: order || null });
  });

  // ── Sessão do cliente ──────────────────────────────────────────
  app.get("/api/cliente-session/:tenantId/:mesaId", (req, res) => {
    const { tenantId, mesaId } = req.params;
    const isComanda = req.query.comanda === '1';
    const session = getClientSession(tenantId, mesaId, isComanda);
    if (!session) return res.json({ active: false });
    res.json({ active: true, token: session.token, mesaId, isComanda, tenantId });
  });

  app.get("/api/cliente-session/:tenantId/:mesaId/validate", (req, res) => {
    const { tenantId, mesaId } = req.params;
    const token = req.query.token as string;
    const isComanda = req.query.comanda === '1';
    const session = getClientSession(tenantId, mesaId, isComanda);
    if (!session || session.token !== token) return res.json({ valid: false });
    session.lastActivity = Date.now();
    res.json({ valid: true, mesaId, isComanda, tenantId });
  });

  // ── Info pública do tenant (nome + logo) ──────────────────────
  app.get("/api/tenant-info/:tenantId", async (req, res) => {
    const { tenantId } = req.params;
    const st = tenants.get(tenantId);
    // Tenta estado em memória primeiro; fallback: Supabase
    let cfg: any = st?.pizzariaConfig;
    if (!cfg && db) {
      const { data } = await db.from('config').select('data').eq('id', `${tenantId}:pizzaria`).single();
      cfg = data?.data;
    }
    res.json({
      name: cfg?.establishmentName || '',
      logoUrl: cfg?.logoUrl || '',
    });
  });

  // ── Cardápio público do tenant ─────────────────────────────────
  const mapItem = (item: any) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    originalPrice: item.originalPrice,
    ingredients: item.ingredients,
    imageUrl: item.imageUrl,
    videoUrl: item.videoUrl,
    available: item.available !== false,
  });

  const mapCategories = (rawMenu: any[]) =>
    rawMenu
      .filter((cat: any) => cat.visible !== false)
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
      .map((cat: any) => ({
        name: cat.name,
        type: cat.type,
        items: (cat.items || []).filter((i: any) => i.visible !== false).map(mapItem),
        subcategories: (cat.subcategories || [])
          .filter((sub: any) => sub.visible !== false)
          .map((sub: any) => ({
            id: sub.id,
            name: sub.name,
            items: (sub.items || []).filter((i: any) => i.visible !== false).map(mapItem),
          })),
      }));

  app.get("/api/menu/:tenantId", async (req, res) => {
    const { tenantId } = req.params;
    const st = tenants.get(tenantId);
    // Estado em memória disponível → usa direto
    if (st && (st.menu || []).length > 0) {
      return res.json({ categories: mapCategories(st.menu) });
    }
    // Fallback: busca no Supabase
    if (!db) return res.json({ categories: [] });
    const { data, error } = await db
      .from('menu')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('position');
    if (error || !data) return res.json({ categories: [] });
    return res.json({ categories: mapCategories(data) });
  });

  // ── Fiscal endpoints ─────────────────────────────────────────────────────

  // ── Fiscal endpoints — integração direta SEFAZ-MT ────────────────────────
  // DotCompany removida. Sem API intermediária, sem fallback remoto.

  // Tenta recarregar certificado do banco quando não está em memória (após restart)
  async function tentarRecarregarCert(tenantId: string, raw: any): Promise<void> {
    if (getCertificado(tenantId)) return; // já em memória
    try {
      if (raw?.pfxEncrypted && raw?.senhaCifrada) {
        const pfxBuf = decryptPfx(raw.pfxEncrypted);
        const senha = decryptText(raw.senhaCifrada);
        if (pfxBuf && senha) carregarCertificado(tenantId, pfxBuf.toString('base64'), senha);
      } else if (raw?.certificadoA1Base64 && raw?.certificadoSenha) {
        carregarCertificado(tenantId, raw.certificadoA1Base64, raw.certificadoSenha);
      }
    } catch { /* cert expirado ou inválido — ignora, o usuário verá status correto */ }
  }

  // GET /api/fiscal/config/:tenantId
  app.get("/api/fiscal/config/:tenantId", async (req, res) => {
    const { tenantId } = req.params;
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    const { data, error } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    const raw = data?.data as any;
    // Recarregar certificado automaticamente após restart se dados estiverem no banco
    await tentarRecarregarCert(tenantId, raw);
    const certRef = getCertificado(tenantId)?.ref ?? null;
    const cfg = raw ? {
      ...raw,
      certificadoA1Base64: undefined,
      certificadoSenha: undefined,
      pfxEncrypted: undefined,
      senhaCifrada: undefined,
      certificadoCarregado: !!certRef,
      certificadoFingerprint: certRef?.fingerprint?.slice(0, 16) ?? null,
      certificadoValidadeFim: certRef?.validadeFim ?? raw.certificadoValidadeFim ?? null,
      certificadoTitular: certRef?.titular ?? null,
    } : null;
    return res.json({ config: cfg });
  });

  // POST /api/fiscal/config/:tenantId
  app.post("/api/fiscal/config/:tenantId", express.json(), async (req, res) => {
    const { tenantId } = req.params;
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    const cfg: FiscalConfig = req.body;
    if (!cfg.cnpj || !cfg.razaoSocial) return res.status(400).json({ error: 'CNPJ e Razão Social são obrigatórios' });

    // Preservar campos do certificado já gravados no banco caso não venha novo certificado
    // (cliente nunca recebe pfxEncrypted/senhaCifrada no GET — sem isso o upsert apagaria o cert)
    const { data: existingRow } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
    const existingCfg: any = existingRow?.data ?? {};
    if (!cfg.certificadoA1Base64) {
      if (existingCfg.pfxEncrypted) cfg.pfxEncrypted = existingCfg.pfxEncrypted;
      if (existingCfg.senhaCifrada) cfg.senhaCifrada = existingCfg.senhaCifrada;
      if (existingCfg.certificadoA1Base64) cfg.certificadoA1Base64 = existingCfg.certificadoA1Base64;
      if (existingCfg.certificadoSenha) cfg.certificadoSenha = existingCfg.certificadoSenha;
      if (!cfg.certificadoValidadeFim && existingCfg.certificadoValidadeFim) cfg.certificadoValidadeFim = existingCfg.certificadoValidadeFim;
      if (!cfg.certificadoTitular && existingCfg.certificadoTitular) cfg.certificadoTitular = existingCfg.certificadoTitular;
      if (!cfg.certificadoFingerprint && existingCfg.certificadoFingerprint) cfg.certificadoFingerprint = existingCfg.certificadoFingerprint;
    }

    // Validar e carregar certificado A1 se fornecido
    if (cfg.certificadoA1Base64 && cfg.certificadoSenha) {
      try {
        const loaded = carregarCertificado(tenantId, cfg.certificadoA1Base64, cfg.certificadoSenha);
        validarCNPJ(cfg.cnpj, loaded);
        cfg.certificadoValidadeFim = loaded.ref.validadeFim;
        cfg.certificadoTitular = loaded.ref.titular;
        cfg.certificadoFingerprint = loaded.ref.fingerprint;
        // Persistir PFX cifrado (AES-256-GCM) — nunca em plain base64
        const pfxEnc = encryptPfx(loaded.pfxBuffer);
        const senhaEnc = encryptText(cfg.certificadoSenha);
        if (pfxEnc && senhaEnc) {
          cfg.pfxEncrypted = pfxEnc;
          cfg.senhaCifrada = senhaEnc;
          cfg.certificadoA1Base64 = undefined;
          cfg.certificadoSenha = undefined;
        }
        // Se CERT_ENCRYPTION_KEY não configurada, mantém plain (aviso em log)
        if (!pfxEnc) console.warn('[fiscal] CERT_ENCRYPTION_KEY não configurada — PFX não persistido cifrado. Defina a variável em produção.');
      } catch (certErr: any) {
        return res.status(400).json({ error: `Certificado inválido: ${certErr.message}` });
      }
    }

    await db.from('config').upsert({ id: `${tenantId}:fiscal`, data: cfg, tenant_id: tenantId });
    const st = tenants.get(tenantId);
    if (st) st.fiscalConfig = cfg;
    const certLoaded = !!(getCertificado(tenantId) ?? (cfg.pfxEncrypted || cfg.certificadoA1Base64));
    io.to('tenant:' + tenantId).emit('update_fiscal_config', {
      ...cfg, certificadoA1Base64: undefined, certificadoSenha: undefined, pfxEncrypted: undefined, senhaCifrada: undefined,
    });
    return res.json({ ok: true, certificadoCarregado: certLoaded });
  });

  // GET /api/fiscal/status/:tenantId — verificar disponibilidade SEFAZ (NFC-e e NF-e)
  app.get("/api/fiscal/status/:tenantId", async (req, res) => {
    const { tenantId } = req.params;
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (db && !getCertificado(tenantId)) {
      const { data } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
      await tentarRecarregarCert(tenantId, data?.data);
    }
    const cert = getCertificado(tenantId);
    if (!cert) return res.status(400).json({ error: 'Certificado não carregado. Salve a configuração fiscal com o certificado A1.' });
    const fiscalConfig = tenants.get(tenantId)?.fiscalConfig;
    const ambiente: AmbienteFiscal = fiscalConfig?.ambiente || 'homologacao';
    const [nfce, nfe] = await Promise.allSettled([
      verificarServico('65', ambiente, cert),
      verificarServico('55', ambiente, cert),
    ]);
    return res.json({
      nfce: nfce.status === 'fulfilled' ? nfce.value : { cStat: '', xMotivo: (nfce as PromiseRejectedResult).reason?.message ?? 'Erro' },
      nfe:  nfe.status  === 'fulfilled' ? nfe.value  : { cStat: '', xMotivo: (nfe  as PromiseRejectedResult).reason?.message ?? 'Erro' },
    });
  });

  // POST /api/fiscal/nfce/:orderId
  app.post("/api/fiscal/nfce/:orderId", express.json(), async (req, res) => {
    const { orderId } = req.params;
    const { tenantId, pagamento, cpfConsumidor, consolidarItem, asyncMode } = req.body as { tenantId: string; pagamento: string; cpfConsumidor?: string; consolidarItem?: { id: string; name: string; ncm?: string; cfop?: string; csosn?: string; cst?: string; unidade?: string }; asyncMode?: boolean };

    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });

    // Carregar configuração fiscal
    let fiscalConfig: FiscalConfig = tenants.get(tenantId)?.fiscalConfig;
    if (!fiscalConfig && db) {
      const { data } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
      fiscalConfig = data?.data || null;
    }
    if (!fiscalConfig?.cnpj) return res.status(400).json({ error: 'Configuração fiscal incompleta. Acesse Configurações → Fiscal.' });

    // Carregar ou reutilizar certificado em memória
    let cert = getCertificado(tenantId);
    if (!cert) {
      try {
        if (fiscalConfig.pfxEncrypted && fiscalConfig.senhaCifrada) {
          const pfxBuf = decryptPfx(fiscalConfig.pfxEncrypted);
          const senha = decryptText(fiscalConfig.senhaCifrada);
          if (pfxBuf && senha) {
            cert = carregarCertificado(tenantId, pfxBuf.toString('base64'), senha);
          }
        } else if (fiscalConfig.certificadoA1Base64 && fiscalConfig.certificadoSenha) {
          cert = carregarCertificado(tenantId, fiscalConfig.certificadoA1Base64, fiscalConfig.certificadoSenha);
        }
      } catch (e: any) {
        return res.status(400).json({ error: `Certificado inválido: ${e.message}` });
      }
    }
    if (!cert) return res.status(400).json({ error: 'Certificado A1 não carregado. Configure em Configurações → Fiscal.' });

    // Carregar pedido
    const st = tenants.get(tenantId);
    let order: any = st?.orders.find((o: any) => String(o.id) === String(orderId));
    if (!order && db) {
      const { data } = await db.from('orders').select('*').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
      if (data) order = rowToOrder(data);
    }
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    // Verificar emissão duplicada
    if (db) {
      const { data: existing } = await db.from('fiscal_notes')
        .select('chave_acesso,status')
        .eq('tenant_id', tenantId).eq('order_id', String(orderId))
        .in('status', ['AUTORIZADO', 'AUTORIZADO_COM_ALERTA', 'PENDENTE_TRANSMISSAO'])
        .maybeSingle();
      if (existing) {
        if (existing.status === 'PENDENTE_TRANSMISSAO') {
          return res.status(409).json({ error: 'Esta nota já está sendo transmitida. Aguarde o resultado.', pendente: true });
        }
        return res.status(409).json({ error: 'Nota já emitida para este pedido.', chaveAcesso: existing.chave_acesso });
      }
    }

    // Obter high-water mark do banco para numeração segura
    const ambiente: AmbienteFiscal = fiscalConfig.ambiente || 'homologacao';
    const serie = ambiente === 'producao' ? (fiscalConfig.serieNFCeProd || '1') : (fiscalConfig.serieNFCeHom || '1');
    let highWaterMark = 0;
    if (db) {
      const { data: hwRow } = await db.from('fiscal_notes')
        .select('numero').eq('tenant_id', tenantId).eq('modelo', '65').eq('serie', serie).eq('ambiente', ambiente)
        .order('numero', { ascending: false }).limit(1).maybeSingle();
      highWaterMark = hwRow?.numero ?? 0;
    }
    await sincronizarContador(tenantId, '65', serie, ambiente, highWaterMark, db ?? null);

    // Montar itens
    const orderItemsRaw = (order.items || []).filter((i: any) => !i.removed);
    if (orderItemsRaw.length === 0) return res.status(400).json({ error: 'Pedido sem itens' });
    const orderTotal = orderItemsRaw.reduce((s: number, i: any) => s + i.price, 0);

    let items: ItemNota[];
    if (consolidarItem?.id) {
      items = [{
        seq: 1,
        codigo: '100',
        descricao: (consolidarItem.name || 'Refeição').substring(0, 120),
        ncm: consolidarItem.ncm || '21069090',
        cfop: consolidarItem.cfop || '5102',
        csosn: consolidarItem.csosn || '400',
        cst: consolidarItem.cst,
        unidade: consolidarItem.unidade || 'UN',
        origem: '0',
        quantidade: 1,
        valorUnitario: orderTotal,
        valorTotal: orderTotal,
        piscofins: { cst: '07' },
      }];
    } else {
      items = orderItemsRaw.map((i: any, idx: number) => ({
        seq: idx + 1,
        codigo: String(100 + idx),
        descricao: (i.name || 'Item').substring(0, 120),
        ncm: i.ncm || '21069090',
        cfop: i.cfop || '5102',
        csosn: i.csosn || '400',
        cst: i.cst,
        unidade: i.unidade || 'UN',
        origem: i.origem || '0',
        quantidade: i.quantity ?? 1,
        valorUnitario: i.price / (i.quantity ?? 1),
        valorTotal: i.price,
        piscofins: { cst: i.pisCofinsCst || '07' },
        gtin: i.gtin || undefined,
      }));
    }
    const total = items.reduce((s, i) => s + i.valorTotal, 0);

    // Montar pagamento
    const tPag = T_PAG[pagamento] || T_PAG.outros;
    console.log(`[NFC-e] orderId=${orderId} pagamento_recebido="${pagamento}" → tPag="${tPag}"`);
    const pagamentos: PagamentoNota[] = [{ tPag, vPag: total }];

    // Montar emitente
    const emitente: EstabelecimentoFiscal = {
      tenantId,
      cnpj: fiscalConfig.cnpj.replace(/\D/g, ''),
      ie: fiscalConfig.ie || '',
      razaoSocial: fiscalConfig.razaoSocial,
      nomeFantasia: fiscalConfig.nomeFantasia,
      uf: fiscalConfig.uf || 'MT',
      codigoMunicipio: fiscalConfig.codigoMunicipio || '5103403',
      municipio: fiscalConfig.municipio || 'Cuiabá',
      logradouro: fiscalConfig.logradouro || '',
      numero: fiscalConfig.numero || 'SN',
      bairro: fiscalConfig.bairro || '',
      cep: (fiscalConfig.cep || '').replace(/\D/g, ''),
      telefone: fiscalConfig.telefone,
      crt: fiscalConfig.crt || '1',
      cnaePrincipal: fiscalConfig.cnae || '5611201',
      serieNFCeHom: fiscalConfig.serieNFCeHom || fiscalConfig.serie || '1',
      serieNFCeProd: fiscalConfig.serieNFCeProd || fiscalConfig.serie || '1',
      serieNFEHom: fiscalConfig.serieNFEHom || '1',
      serieNFEProd: fiscalConfig.serieNFEProd || '1',
      cscHomId: fiscalConfig.cscId || fiscalConfig.cscHomId || '',
      cscHom: fiscalConfig.csc || fiscalConfig.cscHom || '',
      cscProdId: fiscalConfig.cscProdId || '',
      cscProd: fiscalConfig.cscProd || '',
      ambiente,
    };

    const intencao: IntencaoFiscal = {
      id: crypto.randomUUID(),
      tenantId, orderId: String(orderId),
      modelo: '65', ambiente, serie, tpEmis: '1',
      status: 'VALIDACAO_PENDENTE',
      emitente, items, pagamentos, total,
      cpfConsumidor: cpfConsumidor?.replace(/\D/g, '') || undefined,
      observacoes: order.observations,
      hashPayload: createHash('sha256')
        .update(JSON.stringify({ orderId, items, total })).digest('hex'),
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      tentativas: [],
    };

    if (asyncMode) {
      if (db) {
        await db.from('fiscal_notes').upsert({
          id: intencao.id,
          tenant_id: tenantId, order_id: String(orderId),
          status: 'PENDENTE_TRANSMISSAO', modelo: '65',
          serie, ambiente, total,
          hash_payload: intencao.hashPayload,
          intencao_json: intencao,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      }
      res.json({ status: 'PENDENTE_TRANSMISSAO', intencaoId: intencao.id });

      ;(async () => {
        try {
          const result = await autorizarNFCe(intencao, cert, highWaterMark, db ?? null);
          const intencaoParaDanfe = { ...intencao, xmlAssinado: undefined, xmlProcNfe: undefined };
          if (db) {
            await db.from('fiscal_notes').update({
              chave_acesso: result.chaveAcesso,
              qr_code: result.qrCode,
              status: result.status,
              protocolo: result.protocolo,
              cstat: result.cStat,
              xmotivo: result.xMotivo,
              numero: intencao.numero,
              xml_assinado: intencao.xmlAssinado,
              xml_proc_nfe: result.xmlProcNfe,
              cpf_consumidor: cpfConsumidor || null,
              intencao_json: intencaoParaDanfe,
              updated_at: new Date().toISOString(),
            }).eq('id', intencao.id);
          }
          const urlDanfe = `/danfe/nfce/${result.chaveAcesso}?tenant=${encodeURIComponent(tenantId)}`;
          io.to('tenant:' + tenantId).emit('fiscal_note_emitted', {
            orderId, status: result.status, chaveAcesso: result.chaveAcesso,
            qrCode: result.qrCode, protocolo: result.protocolo,
            cStat: result.cStat, xMotivo: result.xMotivo, urlDanfe, intencaoId: intencao.id,
          });
        } catch (err: any) {
          const errMsg = (err as any).message || 'Erro desconhecido';
          if (db) {
            await db.from('fiscal_notes').update({
              status: 'REJEITADO', error_detail: errMsg,
              updated_at: new Date().toISOString(),
            }).eq('id', intencao.id);
          }
          io.to('tenant:' + tenantId).emit('fiscal_note_emitted', {
            orderId, status: 'REJEITADO', error: errMsg, intencaoId: intencao.id,
          });
        }
      })();
      return;
    }

    // Persistir intenção antes de enviar
    if (db) {
      await db.from('fiscal_notes').upsert({
        id: intencao.id,
        tenant_id: tenantId, order_id: String(orderId),
        status: 'VALIDACAO_PENDENTE', modelo: '65',
        serie, ambiente, total,
        hash_payload: intencao.hashPayload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    try {
      const result = await autorizarNFCe(intencao, cert, highWaterMark, db ?? null);

      const intencaoParaDanfe = { ...intencao, xmlAssinado: undefined, xmlProcNfe: undefined };

      if (db) {
        await db.from('fiscal_notes').update({
          chave_acesso: result.chaveAcesso,
          qr_code: result.qrCode,
          status: result.status,
          protocolo: result.protocolo,
          cstat: result.cStat,
          xmotivo: result.xMotivo,
          numero: intencao.numero,
          xml_assinado: intencao.xmlAssinado,
          xml_proc_nfe: result.xmlProcNfe,
          cpf_consumidor: cpfConsumidor || null,
          intencao_json: intencaoParaDanfe,
          updated_at: new Date().toISOString(),
        }).eq('id', intencao.id);
      }

      const urlDanfe = `/danfe/nfce/${result.chaveAcesso}?tenant=${encodeURIComponent(tenantId)}`;

      io.to('tenant:' + tenantId).emit('fiscal_note_emitted', {
        orderId, status: result.status, chaveAcesso: result.chaveAcesso,
        qrCode: result.qrCode, protocolo: result.protocolo,
        cStat: result.cStat, xMotivo: result.xMotivo, urlDanfe,
      });
      return res.json({ ...result, intencaoId: intencao.id, urlDanfe, _debug: { pagamento, tPag } });

    } catch (err: any) {
      const errMsg = err.message || 'Erro desconhecido';
      if (db) {
        await db.from('fiscal_notes').update({
          status: 'REJEITADO', error_detail: errMsg,
          updated_at: new Date().toISOString(),
        }).eq('id', intencao.id);
      }
      return res.status(500).json({ error: errMsg });
    }
  });

  // POST /api/fiscal/nfe/:orderId
  app.post("/api/fiscal/nfe/:orderId", express.json(), async (req, res) => {
    const { orderId } = req.params;
    const {
      tenantId, pagamento,
      cnpjDestinatario, cpfDestinatario, xNomeDestinatario,
      natOp, destinatario, consolidarItem,
    } = req.body as {
      tenantId: string; pagamento: string;
      cnpjDestinatario?: string; cpfDestinatario?: string; xNomeDestinatario?: string;
      natOp?: string;
      consolidarItem?: { id: string; name: string; ncm?: string; cfop?: string; csosn?: string; cst?: string; unidade?: string };
      destinatario?: {
        tipo?: 'pf' | 'pj';
        cpfCnpj?: string;
        nome?: string;
        ie?: string;
        email?: string;
        logradouro?: string;
        numero?: string;
        bairro?: string;
        municipio?: string;
        uf?: string;
        cep?: string;
        codigoMunicipio?: string;
        telefone?: string;
      };
    };

    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });

    // Configuração fiscal
    let fiscalConfig: FiscalConfig = tenants.get(tenantId)?.fiscalConfig;
    if (!fiscalConfig && db) {
      const { data } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
      fiscalConfig = data?.data || null;
    }
    if (!fiscalConfig?.cnpj) return res.status(400).json({ error: 'Configuração fiscal incompleta. Acesse Configurações → Fiscal.' });

    // Certificado
    let cert = getCertificado(tenantId);
    if (!cert) {
      try {
        if (fiscalConfig.pfxEncrypted && fiscalConfig.senhaCifrada) {
          const pfxBuf = decryptPfx(fiscalConfig.pfxEncrypted);
          const senha = decryptText(fiscalConfig.senhaCifrada);
          if (pfxBuf && senha) cert = carregarCertificado(tenantId, pfxBuf.toString('base64'), senha);
        } else if (fiscalConfig.certificadoA1Base64 && fiscalConfig.certificadoSenha) {
          cert = carregarCertificado(tenantId, fiscalConfig.certificadoA1Base64, fiscalConfig.certificadoSenha);
        }
      } catch (e: any) {
        return res.status(400).json({ error: `Certificado inválido: ${e.message}` });
      }
    }
    if (!cert) return res.status(400).json({ error: 'Certificado A1 não carregado. Configure em Configurações → Fiscal.' });

    // Pedido
    const st = tenants.get(tenantId);
    let order: any = st?.orders.find((o: any) => String(o.id) === String(orderId));
    if (!order && db) {
      const { data } = await db.from('orders').select('*').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
      if (data) order = rowToOrder(data);
    }
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    // Verificar duplicata
    if (db) {
      const { data: existing } = await db.from('fiscal_notes')
        .select('chave_acesso,status').eq('tenant_id', tenantId).eq('order_id', String(orderId))
        .in('status', ['AUTORIZADO', 'AUTORIZADO_COM_ALERTA']).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Nota já emitida para este pedido.', chaveAcesso: existing.chave_acesso });
    }

    const ambiente: AmbienteFiscal = fiscalConfig.ambiente || 'homologacao';
    const serie = ambiente === 'producao' ? (fiscalConfig.serieNFEProd || '1') : (fiscalConfig.serieNFEHom || '1');

    let highWaterMark = 0;
    if (db) {
      const { data: hwRow } = await db.from('fiscal_notes')
        .select('numero').eq('tenant_id', tenantId).eq('modelo', '55').eq('serie', serie).eq('ambiente', ambiente)
        .order('numero', { ascending: false }).limit(1).maybeSingle();
      highWaterMark = hwRow?.numero ?? 0;
    }
    await sincronizarContador(tenantId, '55', serie, ambiente, highWaterMark, db ?? null);

    // Destinatário: preferred from new 'destinatario' body field, fallback to legacy fields
    const dest = destinatario || {};
    const resolvedCnpj = dest.tipo === 'pj' ? (dest.cpfCnpj || cnpjDestinatario) : cnpjDestinatario;
    const resolvedCpf  = dest.tipo === 'pf' ? (dest.cpfCnpj || cpfDestinatario)  : cpfDestinatario;
    const resolvedNome = dest.nome || xNomeDestinatario;

    const orderItemsRaw = (order.items || []).filter((i: any) => !i.removed);
    if (orderItemsRaw.length === 0) return res.status(400).json({ error: 'Pedido sem itens' });
    const orderTotal = orderItemsRaw.reduce((s: number, i: any) => s + i.price, 0);

    let items: ItemNota[];
    if (consolidarItem?.id) {
      items = [{
        seq: 1,
        codigo: '100',
        descricao: (consolidarItem.name || 'Refeição').substring(0, 120),
        ncm: consolidarItem.ncm || '21069090',
        cfop: consolidarItem.cfop || '5102',
        csosn: consolidarItem.csosn || '400',
        cst: consolidarItem.cst,
        unidade: consolidarItem.unidade || 'UN',
        origem: '0',
        quantidade: 1,
        valorUnitario: orderTotal,
        valorTotal: orderTotal,
        piscofins: { cst: '07' },
      }];
    } else {
      items = orderItemsRaw.map((i: any, idx: number) => ({
        seq: idx + 1,
        codigo: String(100 + idx),
        descricao: (i.name || 'Item').substring(0, 120),
        ncm: i.ncm || '21069090',
        cfop: i.cfop || '5102',
        cfopForaEstado: i.cfopForaEstado || undefined,
        csosn: i.csosn || '400',
        cst: i.cst,
        unidade: i.unidade || 'UN',
        origem: i.origem || '0',
        quantidade: i.quantity ?? 1,
        valorUnitario: i.price / (i.quantity ?? 1),
        valorTotal: i.price,
        piscofins: { cst: i.pisCofinsCst || '07' },
        gtin: i.gtin || undefined,
      }));
    }

    const total = items.reduce((s, i) => s + i.valorTotal, 0);

    const tPag = T_PAG[pagamento] || T_PAG.outros;
    const pagamentos: PagamentoNota[] = [{ tPag, vPag: total }];

    const emitente: EstabelecimentoFiscal = {
      tenantId,
      cnpj: fiscalConfig.cnpj.replace(/\D/g, ''),
      ie: fiscalConfig.ie || '',
      razaoSocial: fiscalConfig.razaoSocial,
      nomeFantasia: fiscalConfig.nomeFantasia,
      uf: fiscalConfig.uf || 'MT',
      codigoMunicipio: fiscalConfig.codigoMunicipio || '5103403',
      municipio: fiscalConfig.municipio || 'Cuiabá',
      logradouro: fiscalConfig.logradouro || '',
      numero: fiscalConfig.numero || 'SN',
      bairro: fiscalConfig.bairro || '',
      cep: (fiscalConfig.cep || '').replace(/\D/g, ''),
      telefone: fiscalConfig.telefone,
      crt: fiscalConfig.crt || '1',
      cnaePrincipal: fiscalConfig.cnae || '5611201',
      serieNFCeHom: fiscalConfig.serieNFCeHom || '1',
      serieNFCeProd: fiscalConfig.serieNFCeProd || '1',
      serieNFEHom:  fiscalConfig.serieNFEHom  || '1',
      serieNFEProd: fiscalConfig.serieNFEProd || '1',
      cscHomId: fiscalConfig.cscId || fiscalConfig.cscHomId || '',
      cscHom:   fiscalConfig.csc  || fiscalConfig.cscHom   || '',
      cscProdId: fiscalConfig.cscProdId || '',
      cscProd:   fiscalConfig.cscProd   || '',
      ambiente,
    };

    const intencao: IntencaoFiscal = {
      id: crypto.randomUUID(),
      tenantId, orderId: String(orderId),
      modelo: '55', ambiente, serie, tpEmis: '1',
      status: 'VALIDACAO_PENDENTE',
      emitente, items, pagamentos, total,
      cnpjConsumidor: resolvedCnpj?.replace(/\D/g, '') || undefined,
      cpfConsumidor:  resolvedCpf?.replace(/\D/g, '')  || undefined,
      xNomeConsumidor: resolvedNome || undefined,
      ieDestinatario: dest.ie || undefined,
      ufDestinatario: dest.uf || undefined,
      endDestinatario: dest.logradouro ? {
        logradouro: dest.logradouro,
        numero: dest.numero,
        bairro: dest.bairro,
        municipio: dest.municipio,
        uf: dest.uf,
        cep: dest.cep,
        codigoMunicipio: dest.codigoMunicipio,
        telefone: dest.telefone,
        email: dest.email,
      } : undefined,
      observacoes: order.observations,
      hashPayload: createHash('sha256')
        .update(JSON.stringify({ orderId, items, total })).digest('hex'),
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      tentativas: [],
    };

    if (db) {
      await db.from('fiscal_notes').upsert({
        id: intencao.id, tenant_id: tenantId, order_id: String(orderId),
        status: 'VALIDACAO_PENDENTE', modelo: '55',
        serie, ambiente, total, hash_payload: intencao.hashPayload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    try {
      const result = await autorizarNFe(intencao, cert, highWaterMark, db ?? null, { natOp });

      const intencaoParaDanfe = { ...intencao, xmlAssinado: undefined, xmlProcNfe: undefined };

      if (db) {
        await db.from('fiscal_notes').update({
          chave_acesso: result.chaveAcesso,
          status: result.status,
          protocolo: result.protocolo,
          cstat: result.cStat,
          xmotivo: result.xMotivo,
          numero: intencao.numero,
          xml_assinado: intencao.xmlAssinado,
          xml_proc_nfe: result.xmlProcNfe,
          intencao_json: intencaoParaDanfe,
          updated_at: new Date().toISOString(),
        }).eq('id', intencao.id);
      }

      const urlDanfe = `/danfe/nfe/${result.chaveAcesso}?tenant=${encodeURIComponent(tenantId)}`;

      io.to('tenant:' + tenantId).emit('fiscal_note_emitted', {
        orderId, status: result.status, chaveAcesso: result.chaveAcesso,
        protocolo: result.protocolo, cStat: result.cStat, xMotivo: result.xMotivo,
        modelo: '55', urlDanfe,
      });
      return res.json({ ...result, intencaoId: intencao.id, urlDanfe });

    } catch (err: any) {
      const errMsg = err.message || 'Erro desconhecido';
      if (db) {
        await db.from('fiscal_notes').update({
          status: 'REJEITADO', error_detail: errMsg,
          updated_at: new Date().toISOString(),
        }).eq('id', intencao.id);
      }
      return res.status(500).json({ error: errMsg });
    }
  });

  // POST /api/fiscal/nfe-epec/:orderId — EPEC contingency (tpEmis='4') for NF-e modelo 55
  app.post("/api/fiscal/nfe-epec/:orderId", express.json(), async (req, res) => {
    const { orderId } = req.params;
    const {
      tenantId, pagamento,
      cnpjDestinatario, cpfDestinatario, xNomeDestinatario,
      natOp, dhCont, xJust,
    } = req.body as {
      tenantId: string; pagamento: string;
      cnpjDestinatario?: string; cpfDestinatario?: string; xNomeDestinatario?: string;
      natOp?: string;
      dhCont: string;  // ISO 8601 início da contingência, ex: "2026-11-11T10:00:00-04:00"
      xJust: string;   // justificativa 15–256 chars
    };

    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });
    if (!dhCont)   return res.status(400).json({ error: 'dhCont obrigatório (início da contingência)' });
    if (!xJust || xJust.length < 15) return res.status(400).json({ error: 'xJust deve ter pelo menos 15 caracteres' });

    // Configuração fiscal
    let fiscalConfig: FiscalConfig = tenants.get(tenantId)?.fiscalConfig;
    if (!fiscalConfig && db) {
      const { data } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
      fiscalConfig = data?.data || null;
    }
    if (!fiscalConfig?.cnpj) return res.status(400).json({ error: 'Configuração fiscal incompleta.' });

    // Certificado
    let cert = getCertificado(tenantId);
    if (!cert) {
      try {
        if (fiscalConfig.pfxEncrypted && fiscalConfig.senhaCifrada) {
          const pfxBuf = decryptPfx(fiscalConfig.pfxEncrypted);
          const senha  = decryptText(fiscalConfig.senhaCifrada);
          if (pfxBuf && senha) cert = carregarCertificado(tenantId, pfxBuf.toString('base64'), senha);
        } else if (fiscalConfig.certificadoA1Base64 && fiscalConfig.certificadoSenha) {
          cert = carregarCertificado(tenantId, fiscalConfig.certificadoA1Base64, fiscalConfig.certificadoSenha);
        }
      } catch (e: any) {
        return res.status(400).json({ error: `Certificado inválido: ${e.message}` });
      }
    }
    if (!cert) return res.status(400).json({ error: 'Certificado A1 não carregado.' });

    // Pedido
    const st = tenants.get(tenantId);
    let order: any = st?.orders.find((o: any) => String(o.id) === String(orderId));
    if (!order && db) {
      const { data } = await db.from('orders').select('*').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
      if (data) order = rowToOrder(data);
    }
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    // Verificar duplicata autorizada
    if (db) {
      const { data: existing } = await db.from('fiscal_notes')
        .select('chave_acesso,status').eq('tenant_id', tenantId).eq('order_id', String(orderId))
        .in('status', ['AUTORIZADO', 'AUTORIZADO_COM_ALERTA', 'EPEC_AUTORIZADO']).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Nota já emitida para este pedido.', chaveAcesso: existing.chave_acesso });
    }

    const ambiente: AmbienteFiscal = fiscalConfig.ambiente || 'homologacao';
    const serie = ambiente === 'producao' ? (fiscalConfig.serieNFEProd || '1') : (fiscalConfig.serieNFEHom || '1');

    let highWaterMark = 0;
    if (db) {
      const { data: hwRow } = await db.from('fiscal_notes')
        .select('numero').eq('tenant_id', tenantId).eq('modelo', '55').eq('serie', serie).eq('ambiente', ambiente)
        .order('numero', { ascending: false }).limit(1).maybeSingle();
      highWaterMark = hwRow?.numero ?? 0;
    }
    await sincronizarContador(tenantId, '55', serie, ambiente, highWaterMark, db ?? null);

    const items: ItemNota[] = (order.items || [])
      .filter((i: any) => !i.removed)
      .map((i: any, idx: number) => ({
        seq: idx + 1,
        codigo: String(100 + idx),
        descricao: (i.name || 'Item').substring(0, 120),
        ncm: i.ncm || '21069090',
        cfop: i.cfop || '5102',
        csosn: i.csosn || '400',
        cst: i.cst,
        unidade: i.unidade || 'UN',
        origem: i.origem || '0',
        quantidade: i.quantity ?? 1,
        valorUnitario: i.price / (i.quantity ?? 1),
        valorTotal: i.price,
        piscofins: { cst: i.pisCofinsCst || '07' },
        gtin: i.gtin || undefined,
      }));

    if (items.length === 0) return res.status(400).json({ error: 'Pedido sem itens' });
    const total = items.reduce((s, i) => s + i.valorTotal, 0);

    const tPag = T_PAG[pagamento] || T_PAG.outros;
    const pagamentos: PagamentoNota[] = [{ tPag, vPag: total }];

    const emitente: EstabelecimentoFiscal = {
      tenantId,
      cnpj: fiscalConfig.cnpj.replace(/\D/g, ''),
      ie: fiscalConfig.ie || '',
      razaoSocial: fiscalConfig.razaoSocial,
      nomeFantasia: fiscalConfig.nomeFantasia,
      uf: fiscalConfig.uf || 'MT',
      codigoMunicipio: fiscalConfig.codigoMunicipio || '5103403',
      municipio: fiscalConfig.municipio || 'Cuiabá',
      logradouro: fiscalConfig.logradouro || '',
      numero: fiscalConfig.numero || 'SN',
      bairro: fiscalConfig.bairro || '',
      cep: (fiscalConfig.cep || '').replace(/\D/g, ''),
      telefone: fiscalConfig.telefone,
      crt: fiscalConfig.crt || '1',
      cnaePrincipal: fiscalConfig.cnae || '5611201',
      serieNFCeHom: fiscalConfig.serieNFCeHom || '1',
      serieNFCeProd: fiscalConfig.serieNFCeProd || '1',
      serieNFEHom:  fiscalConfig.serieNFEHom  || '1',
      serieNFEProd: fiscalConfig.serieNFEProd || '1',
      cscHomId: fiscalConfig.cscId || fiscalConfig.cscHomId || '',
      cscHom:   fiscalConfig.csc  || fiscalConfig.cscHom   || '',
      cscProdId: fiscalConfig.cscProdId || '',
      cscProd:   fiscalConfig.cscProd   || '',
      ambiente,
    };

    const intencao: IntencaoFiscal = {
      id: crypto.randomUUID(),
      tenantId, orderId: String(orderId),
      modelo: '55', ambiente, serie, tpEmis: '4',
      status: 'VALIDACAO_PENDENTE',
      emitente, items, pagamentos, total,
      cnpjConsumidor: cnpjDestinatario?.replace(/\D/g, '') || undefined,
      cpfConsumidor:  cpfDestinatario?.replace(/\D/g, '')  || undefined,
      xNomeConsumidor: xNomeDestinatario || undefined,
      observacoes: order.observations,
      hashPayload: createHash('sha256')
        .update(JSON.stringify({ orderId, items, total })).digest('hex'),
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      tentativas: [],
    };

    if (db) {
      await db.from('fiscal_notes').upsert({
        id: intencao.id, tenant_id: tenantId, order_id: String(orderId),
        status: 'VALIDACAO_PENDENTE', modelo: '55',
        serie, ambiente, total, hash_payload: intencao.hashPayload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    try {
      const result = await emitirEpecNFe(intencao, cert, highWaterMark, dhCont, xJust, db ?? null, { natOp });

      const intencaoParaDanfe = { ...intencao, xmlAssinado: undefined, xmlProcNfe: undefined };

      if (db) {
        await db.from('fiscal_notes').update({
          chave_acesso: result.chaveAcesso,
          status:       result.status,
          protocolo:    result.protocolo,
          cstat:        result.cStat,
          xmotivo:      result.xMotivo,
          numero:       intencao.numero,
          xml_assinado: result.xmlAssinado,  // necessário para re-transmissão pós-EPEC
          intencao_json: { ...intencaoParaDanfe, contingencia: true },
          updated_at:   new Date().toISOString(),
        }).eq('id', intencao.id);
      }

      const urlDanfe = `/danfe/nfe/${result.chaveAcesso}?tenant=${encodeURIComponent(tenantId)}`;

      io.to('tenant:' + tenantId).emit('fiscal_note_emitted', {
        orderId, status: result.status, chaveAcesso: result.chaveAcesso,
        protocolo: result.protocolo, cStat: result.cStat, xMotivo: result.xMotivo,
        modelo: '55', tpEmis: '4', urlDanfe,
      });
      return res.json({ ...result, intencaoId: intencao.id, urlDanfe, epec: true });

    } catch (err: any) {
      const errMsg = err.message || 'Erro desconhecido';
      if (db) {
        await db.from('fiscal_notes').update({
          status: 'REJEITADO', error_detail: errMsg,
          updated_at: new Date().toISOString(),
        }).eq('id', intencao.id);
      }
      return res.status(500).json({ error: errMsg });
    }
  });

  // POST /api/fiscal/nfe-svcrs/:orderId — SVC-RS contingência (tpEmis='7') para NF-e modelo 55
  // NF-e transmitida diretamente ao SVC-RS para autorização imediata — sem re-transmissão futura.
  app.post("/api/fiscal/nfe-svcrs/:orderId", express.json(), async (req, res) => {
    const { orderId } = req.params;
    const {
      tenantId, pagamento,
      cnpjDestinatario, cpfDestinatario, xNomeDestinatario,
      natOp, dhCont, xJust,
    } = req.body as {
      tenantId: string; pagamento: string;
      cnpjDestinatario?: string; cpfDestinatario?: string; xNomeDestinatario?: string;
      natOp?: string;
      dhCont: string;  // ISO 8601 início da contingência ex: "2026-11-11T10:00:00-04:00"
      xJust: string;   // justificativa 15–256 chars
    };

    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });
    if (!dhCont)   return res.status(400).json({ error: 'dhCont obrigatório (início da contingência)' });
    if (!xJust || xJust.length < 15) return res.status(400).json({ error: 'xJust deve ter pelo menos 15 caracteres' });

    // Configuração fiscal
    let fiscalConfig: FiscalConfig = tenants.get(tenantId)?.fiscalConfig;
    if (!fiscalConfig && db) {
      const { data } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
      fiscalConfig = data?.data || null;
    }
    if (!fiscalConfig?.cnpj) return res.status(400).json({ error: 'Configuração fiscal incompleta.' });

    // Certificado
    let cert = getCertificado(tenantId);
    if (!cert) {
      try {
        if (fiscalConfig.pfxEncrypted && fiscalConfig.senhaCifrada) {
          const pfxBuf = decryptPfx(fiscalConfig.pfxEncrypted);
          const senha  = decryptText(fiscalConfig.senhaCifrada);
          if (pfxBuf && senha) cert = carregarCertificado(tenantId, pfxBuf.toString('base64'), senha);
        } else if (fiscalConfig.certificadoA1Base64 && fiscalConfig.certificadoSenha) {
          cert = carregarCertificado(tenantId, fiscalConfig.certificadoA1Base64, fiscalConfig.certificadoSenha);
        }
      } catch (e: any) {
        return res.status(400).json({ error: `Certificado inválido: ${e.message}` });
      }
    }
    if (!cert) return res.status(400).json({ error: 'Certificado A1 não carregado.' });

    // Pedido
    const st = tenants.get(tenantId);
    let order: any = st?.orders.find((o: any) => String(o.id) === String(orderId));
    if (!order && db) {
      const { data } = await db.from('orders').select('*').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
      if (data) order = rowToOrder(data);
    }
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    // Verificar duplicata autorizada
    if (db) {
      const { data: existing } = await db.from('fiscal_notes')
        .select('chave_acesso,status').eq('tenant_id', tenantId).eq('order_id', String(orderId))
        .in('status', ['AUTORIZADO', 'AUTORIZADO_COM_ALERTA', 'EPEC_AUTORIZADO']).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Nota já emitida para este pedido.', chaveAcesso: existing.chave_acesso });
    }

    const ambiente: AmbienteFiscal = fiscalConfig.ambiente || 'homologacao';
    const serie = ambiente === 'producao' ? (fiscalConfig.serieNFEProd || '1') : (fiscalConfig.serieNFEHom || '1');

    let highWaterMark = 0;
    if (db) {
      const { data: hwRow } = await db.from('fiscal_notes')
        .select('numero').eq('tenant_id', tenantId).eq('modelo', '55').eq('serie', serie).eq('ambiente', ambiente)
        .order('numero', { ascending: false }).limit(1).maybeSingle();
      highWaterMark = hwRow?.numero ?? 0;
    }
    await sincronizarContador(tenantId, '55', serie, ambiente, highWaterMark, db ?? null);

    const items: ItemNota[] = (order.items || [])
      .filter((i: any) => !i.removed)
      .map((i: any, idx: number) => ({
        seq: idx + 1,
        codigo: String(100 + idx),
        descricao: (i.name || 'Item').substring(0, 120),
        ncm: i.ncm || '21069090',
        cfop: i.cfop || '5102',
        csosn: i.csosn || '400',
        cst: i.cst,
        unidade: i.unidade || 'UN',
        origem: i.origem || '0',
        quantidade: i.quantity ?? 1,
        valorUnitario: i.price / (i.quantity ?? 1),
        valorTotal: i.price,
        piscofins: { cst: i.pisCofinsCst || '07' },
        gtin: i.gtin || undefined,
      }));

    if (items.length === 0) return res.status(400).json({ error: 'Pedido sem itens' });
    const total = items.reduce((s, i) => s + i.valorTotal, 0);

    const tPag = T_PAG[pagamento] || T_PAG.outros;
    const pagamentos: PagamentoNota[] = [{ tPag, vPag: total }];

    const emitente: EstabelecimentoFiscal = {
      tenantId,
      cnpj: fiscalConfig.cnpj.replace(/\D/g, ''),
      ie: fiscalConfig.ie || '',
      razaoSocial: fiscalConfig.razaoSocial,
      nomeFantasia: fiscalConfig.nomeFantasia,
      uf: fiscalConfig.uf || 'MT',
      codigoMunicipio: fiscalConfig.codigoMunicipio || '5103403',
      municipio: fiscalConfig.municipio || 'Cuiabá',
      logradouro: fiscalConfig.logradouro || '',
      numero: fiscalConfig.numero || 'SN',
      bairro: fiscalConfig.bairro || '',
      cep: (fiscalConfig.cep || '').replace(/\D/g, ''),
      telefone: fiscalConfig.telefone,
      crt: fiscalConfig.crt || '1',
      cnaePrincipal: fiscalConfig.cnae || '5611201',
      serieNFCeHom: fiscalConfig.serieNFCeHom || '1',
      serieNFCeProd: fiscalConfig.serieNFCeProd || '1',
      serieNFEHom:  fiscalConfig.serieNFEHom  || '1',
      serieNFEProd: fiscalConfig.serieNFEProd || '1',
      cscHomId: fiscalConfig.cscId || fiscalConfig.cscHomId || '',
      cscHom:   fiscalConfig.csc  || fiscalConfig.cscHom   || '',
      cscProdId: fiscalConfig.cscProdId || '',
      cscProd:   fiscalConfig.cscProd   || '',
      ambiente,
    };

    const intencao: IntencaoFiscal = {
      id: crypto.randomUUID(),
      tenantId, orderId: String(orderId),
      modelo: '55', ambiente, serie, tpEmis: '7',
      status: 'VALIDACAO_PENDENTE',
      emitente, items, pagamentos, total,
      cnpjConsumidor: cnpjDestinatario?.replace(/\D/g, '') || undefined,
      cpfConsumidor:  cpfDestinatario?.replace(/\D/g, '')  || undefined,
      xNomeConsumidor: xNomeDestinatario || undefined,
      observacoes: order.observations,
      hashPayload: createHash('sha256')
        .update(JSON.stringify({ orderId, items, total })).digest('hex'),
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      tentativas: [],
    };

    if (db) {
      await db.from('fiscal_notes').upsert({
        id: intencao.id, tenant_id: tenantId, order_id: String(orderId),
        status: 'VALIDACAO_PENDENTE', modelo: '55',
        serie, ambiente, total, hash_payload: intencao.hashPayload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    try {
      const result = await emitirNFeSvcRs(intencao, cert, highWaterMark, dhCont, xJust, db ?? null, { natOp });

      const intencaoParaDanfe = { ...intencao, xmlAssinado: undefined, xmlProcNfe: undefined };

      if (db) {
        await db.from('fiscal_notes').update({
          chave_acesso: result.chaveAcesso,
          status:       result.status,
          protocolo:    result.protocolo,
          cstat:        result.cStat,
          xmotivo:      result.xMotivo,
          numero:       intencao.numero,
          xml_assinado: intencao.xmlAssinado,
          xml_proc_nfe: result.xmlProcNfe,
          intencao_json: { ...intencaoParaDanfe, contingencia: true },
          updated_at:   new Date().toISOString(),
        }).eq('id', intencao.id);
      }

      const urlDanfe = `/danfe/nfe/${result.chaveAcesso}?tenant=${encodeURIComponent(tenantId)}`;

      io.to('tenant:' + tenantId).emit('fiscal_note_emitted', {
        orderId, status: result.status, chaveAcesso: result.chaveAcesso,
        protocolo: result.protocolo, cStat: result.cStat, xMotivo: result.xMotivo,
        modelo: '55', tpEmis: '7', urlDanfe,
      });
      return res.json({ ...result, intencaoId: intencao.id, urlDanfe, svcrs: true });

    } catch (err: any) {
      const errMsg = err.message || 'Erro desconhecido';
      if (db) {
        await db.from('fiscal_notes').update({
          status: 'REJEITADO', error_detail: errMsg,
          updated_at: new Date().toISOString(),
        }).eq('id', intencao.id);
      }
      return res.status(500).json({ error: errMsg });
    }
  });

  // POST /api/fiscal/nfce-offline/:orderId — contingência offline NFC-e (tpEmis='9')
  // NFC-e gerada e assinada localmente; transmissão ao SEFAZ-MT ocorre via reconciliação.
  app.post("/api/fiscal/nfce-offline/:orderId", express.json(), async (req, res) => {
    const { orderId } = req.params;
    const {
      tenantId, pagamento,
      cpfConsumidor, cnpjConsumidor, xNomeConsumidor,
      dhCont, xJust,
    } = req.body as {
      tenantId: string; pagamento: string;
      cpfConsumidor?: string; cnpjConsumidor?: string; xNomeConsumidor?: string;
      dhCont: string;  // ISO 8601 início da contingência ex: "2026-11-11T10:00:00-04:00"
      xJust: string;   // justificativa 15–256 chars
    };

    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });
    if (!dhCont)   return res.status(400).json({ error: 'dhCont obrigatório (início da contingência)' });
    if (!xJust || xJust.length < 15) return res.status(400).json({ error: 'xJust deve ter pelo menos 15 caracteres' });

    // Configuração fiscal
    let fiscalConfig: FiscalConfig = tenants.get(tenantId)?.fiscalConfig;
    if (!fiscalConfig && db) {
      const { data } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
      fiscalConfig = data?.data || null;
    }
    if (!fiscalConfig?.cnpj) return res.status(400).json({ error: 'Configuração fiscal incompleta.' });

    // Certificado
    let cert = getCertificado(tenantId);
    if (!cert) {
      try {
        if (fiscalConfig.pfxEncrypted && fiscalConfig.senhaCifrada) {
          const pfxBuf = decryptPfx(fiscalConfig.pfxEncrypted);
          const senha  = decryptText(fiscalConfig.senhaCifrada);
          if (pfxBuf && senha) cert = carregarCertificado(tenantId, pfxBuf.toString('base64'), senha);
        } else if (fiscalConfig.certificadoA1Base64 && fiscalConfig.certificadoSenha) {
          cert = carregarCertificado(tenantId, fiscalConfig.certificadoA1Base64, fiscalConfig.certificadoSenha);
        }
      } catch (e: any) {
        return res.status(400).json({ error: `Certificado inválido: ${e.message}` });
      }
    }
    if (!cert) return res.status(400).json({ error: 'Certificado A1 não carregado.' });

    // Pedido
    const st = tenants.get(tenantId);
    let order: any = st?.orders.find((o: any) => String(o.id) === String(orderId));
    if (!order && db) {
      const { data } = await db.from('orders').select('*').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
      if (data) order = rowToOrder(data);
    }
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    // Verificar duplicata
    if (db) {
      const { data: existing } = await db.from('fiscal_notes')
        .select('chave_acesso,status').eq('tenant_id', tenantId).eq('order_id', String(orderId))
        .in('status', ['AUTORIZADO', 'AUTORIZADO_COM_ALERTA', 'CONTINGENCIA_PENDENTE_TRANSMISSAO']).maybeSingle();
      if (existing) return res.status(409).json({ error: 'Nota já emitida para este pedido.', chaveAcesso: existing.chave_acesso });
    }

    const ambiente: AmbienteFiscal = fiscalConfig.ambiente || 'homologacao';
    const serie = ambiente === 'producao' ? (fiscalConfig.serieNFCeProd || '1') : (fiscalConfig.serieNFCeHom || '1');

    let highWaterMark = 0;
    if (db) {
      const { data: hwRow } = await db.from('fiscal_notes')
        .select('numero').eq('tenant_id', tenantId).eq('modelo', '65').eq('serie', serie).eq('ambiente', ambiente)
        .order('numero', { ascending: false }).limit(1).maybeSingle();
      highWaterMark = hwRow?.numero ?? 0;
    }
    await sincronizarContador(tenantId, '65', serie, ambiente, highWaterMark, db ?? null);

    const items: ItemNota[] = (order.items || [])
      .filter((i: any) => !i.removed)
      .map((i: any, idx: number) => ({
        seq: idx + 1,
        codigo: String(100 + idx),
        descricao: (i.name || 'Item').substring(0, 120),
        ncm: i.ncm || '21069090',
        cfop: i.cfop || '5102',
        csosn: i.csosn || '400',
        cst: i.cst,
        unidade: i.unidade || 'UN',
        origem: i.origem || '0',
        quantidade: i.quantity ?? 1,
        valorUnitario: i.price / (i.quantity ?? 1),
        valorTotal: i.price,
        piscofins: { cst: i.pisCofinsCst || '07' },
        gtin: i.gtin || undefined,
      }));

    if (items.length === 0) return res.status(400).json({ error: 'Pedido sem itens' });
    const total = items.reduce((s, i) => s + i.valorTotal, 0);

    const tPag = T_PAG[pagamento] || T_PAG.outros;
    const pagamentos: PagamentoNota[] = [{ tPag, vPag: total }];

    const emitente: EstabelecimentoFiscal = {
      tenantId,
      cnpj: fiscalConfig.cnpj.replace(/\D/g, ''),
      ie: fiscalConfig.ie || '',
      razaoSocial: fiscalConfig.razaoSocial,
      nomeFantasia: fiscalConfig.nomeFantasia,
      uf: fiscalConfig.uf || 'MT',
      codigoMunicipio: fiscalConfig.codigoMunicipio || '5103403',
      municipio: fiscalConfig.municipio || 'Cuiabá',
      logradouro: fiscalConfig.logradouro || '',
      numero: fiscalConfig.numero || 'SN',
      bairro: fiscalConfig.bairro || '',
      cep: (fiscalConfig.cep || '').replace(/\D/g, ''),
      telefone: fiscalConfig.telefone,
      crt: fiscalConfig.crt || '1',
      cnaePrincipal: fiscalConfig.cnae || '5611201',
      serieNFCeHom: fiscalConfig.serieNFCeHom || '1',
      serieNFCeProd: fiscalConfig.serieNFCeProd || '1',
      serieNFEHom:  fiscalConfig.serieNFEHom  || '1',
      serieNFEProd: fiscalConfig.serieNFEProd || '1',
      cscHomId: fiscalConfig.cscId || fiscalConfig.cscHomId || '',
      cscHom:   fiscalConfig.csc  || fiscalConfig.cscHom   || '',
      cscProdId: fiscalConfig.cscProdId || '',
      cscProd:   fiscalConfig.cscProd   || '',
      ambiente,
    };

    const intencao: IntencaoFiscal = {
      id: crypto.randomUUID(),
      tenantId, orderId: String(orderId),
      modelo: '65', ambiente, serie, tpEmis: '9',
      status: 'VALIDACAO_PENDENTE',
      emitente, items, pagamentos, total,
      cpfConsumidor:  cpfConsumidor?.replace(/\D/g, '')  || undefined,
      cnpjConsumidor: cnpjConsumidor?.replace(/\D/g, '') || undefined,
      xNomeConsumidor: xNomeConsumidor || undefined,
      observacoes: order.observations,
      hashPayload: createHash('sha256')
        .update(JSON.stringify({ orderId, items, total })).digest('hex'),
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      tentativas: [],
    };

    if (db) {
      await db.from('fiscal_notes').upsert({
        id: intencao.id, tenant_id: tenantId, order_id: String(orderId),
        status: 'VALIDACAO_PENDENTE', modelo: '65',
        serie, ambiente, total, hash_payload: intencao.hashPayload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    try {
      const result = await emitirNFCeOffline(intencao, cert, highWaterMark, dhCont, xJust, db ?? null);

      const intencaoParaDanfe = {
        ...intencao, xmlAssinado: undefined, xmlProcNfe: undefined,
        qrCodeUrl: result.qrCode,  // necessário para o DANFE offline
      };

      if (db) {
        await db.from('fiscal_notes').update({
          chave_acesso: result.chaveAcesso,
          status:       result.status,
          numero:       intencao.numero,
          xml_assinado: result.xmlAssinado,  // obrigatório para transmissão posterior
          intencao_json: { ...intencaoParaDanfe, contingencia: true },
          updated_at:   new Date().toISOString(),
        }).eq('id', intencao.id);
      }

      const urlDanfe = `/danfe/nfce/${result.chaveAcesso}?tenant=${encodeURIComponent(tenantId)}`;

      io.to('tenant:' + tenantId).emit('fiscal_note_emitted', {
        orderId, status: result.status, chaveAcesso: result.chaveAcesso,
        modelo: '65', tpEmis: '9', urlDanfe,
      });
      return res.json({ ...result, intencaoId: intencao.id, urlDanfe, offline: true });

    } catch (err: any) {
      const errMsg = err.message || 'Erro desconhecido';
      if (db) {
        await db.from('fiscal_notes').update({
          status: 'REJEITADO', error_detail: errMsg,
          updated_at: new Date().toISOString(),
        }).eq('id', intencao.id);
      }
      return res.status(500).json({ error: errMsg });
    }
  });

  // POST /api/fiscal/cancel/:chaveAcesso
  app.post("/api/fiscal/cancel/:chaveAcesso", express.json(), async (req, res) => {
    const { chaveAcesso } = req.params;
    const { tenantId, motivo } = req.body as { tenantId: string; motivo: string };
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId || !motivo) return res.status(400).json({ error: 'tenantId e motivo obrigatórios' });
    if (motivo.length < 15) return res.status(400).json({ error: 'Motivo deve ter pelo menos 15 caracteres.' });

    const cert = getCertificado(tenantId);
    if (!cert) return res.status(400).json({ error: 'Certificado não carregado.' });

    // Buscar protocolo, ambiente, modelo e tpEmis da nota
    let protocolo = '', ambiente: AmbienteFiscal = 'homologacao', modelo = '', tpEmis = '';
    if (db) {
      const { data } = await db.from('fiscal_notes')
        .select('protocolo,ambiente,modelo,intencao_json').eq('chave_acesso', chaveAcesso).eq('tenant_id', tenantId).maybeSingle();
      protocolo = data?.protocolo ?? '';
      ambiente = (data?.ambiente as AmbienteFiscal) ?? 'homologacao';
      modelo = data?.modelo ?? '';
      tpEmis = data?.intencao_json?.tpEmis ?? '';
    }
    if (!protocolo) return res.status(400).json({ error: 'Protocolo não encontrado. A nota pode não ter sido autorizada.' });

    try {
      let result: { cStat: string; xMotivo: string };
      if (modelo === '55' && tpEmis === '7') {
        result = await cancelarNFeSvcRs(chaveAcesso, protocolo, motivo, ambiente, cert);
      } else if (modelo === '55') {
        result = await cancelarNFe(chaveAcesso, protocolo, motivo, ambiente, cert);
      } else {
        result = await cancelarNFCe(chaveAcesso, protocolo, motivo, ambiente, cert);
      }
      if (db) await db.from('fiscal_notes').update({ status: 'CANCELADO', updated_at: new Date().toISOString() }).eq('chave_acesso', chaveAcesso).eq('tenant_id', tenantId);
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/fiscal/inutilizar — inutilização de faixa numérica (prazo: até o 10º dia do mês seguinte)
  app.post("/api/fiscal/inutilizar", express.json(), async (req, res) => {
    const { tenantId, modelo, serie, nNFIni, nNFFin, xJust } = req.body as {
      tenantId: string; modelo: string; serie: string;
      nNFIni: number; nNFFin: number; xJust: string;
    };

    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId || !modelo || !serie || !nNFIni || !nNFFin || !xJust)
      return res.status(400).json({ error: 'tenantId, modelo, serie, nNFIni, nNFFin e xJust são obrigatórios' });
    if (xJust.length < 15)
      return res.status(400).json({ error: 'xJust deve ter pelo menos 15 caracteres.' });
    if (nNFIni > nNFFin)
      return res.status(400).json({ error: 'nNFIni deve ser <= nNFFin.' });
    if (modelo !== '55' && modelo !== '65')
      return res.status(400).json({ error: 'modelo deve ser "55" (NF-e) ou "65" (NFC-e).' });

    // Carregar configuração fiscal
    let fiscalConfig: FiscalConfig = tenants.get(tenantId)?.fiscalConfig;
    if (!fiscalConfig && db) {
      const { data } = await db.from('config').select('data').eq('id', `${tenantId}:fiscal`).maybeSingle();
      fiscalConfig = data?.data || null;
    }
    if (!fiscalConfig?.cnpj) return res.status(400).json({ error: 'Configuração fiscal incompleta. Acesse Configurações → Fiscal.' });

    let cert = getCertificado(tenantId);
    if (!cert) {
      try {
        if (fiscalConfig.pfxEncrypted && fiscalConfig.senhaCifrada) {
          const pfxBuf = decryptPfx(fiscalConfig.pfxEncrypted);
          const senha = decryptText(fiscalConfig.senhaCifrada);
          if (pfxBuf && senha) cert = carregarCertificado(tenantId, pfxBuf.toString('base64'), senha);
        } else if (fiscalConfig.certificadoA1Base64 && fiscalConfig.certificadoSenha) {
          cert = carregarCertificado(tenantId, fiscalConfig.certificadoA1Base64, fiscalConfig.certificadoSenha);
        }
      } catch (e: any) {
        return res.status(400).json({ error: `Certificado inválido: ${e.message}` });
      }
    }
    if (!cert) return res.status(400).json({ error: 'Certificado A1 não carregado. Configure em Configurações → Fiscal.' });

    const ambiente: AmbienteFiscal = fiscalConfig.ambiente || 'homologacao';
    const tpAmb = TP_AMB[ambiente];

    try {
      const result = await inutilizarNumeracao(
        { tpAmb, cnpj: fiscalConfig.cnpj, mod: modelo as '55' | '65', serie, nNFIni, nNFFin, xJust },
        modelo as '55' | '65',
        ambiente,
        cert,
      );

      if (db) {
        await db.from('fiscal_notes').insert({
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          status: 'INUTILIZADO',
          modelo,
          serie,
          ambiente,
          numero: nNFIni,
          protocolo: result.nProt,
          cstat: result.cStat,
          xmotivo: result.xMotivo,
          intencao_json: { nNFIni, nNFFin, xJust, ...result },
          updated_at: new Date().toISOString(),
        });
      }

      return res.json({ ok: true, ...result, nNFIni, nNFFin });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/fiscal/danfe/:chaveAcesso — privado, exige owner Supabase
  app.get("/api/fiscal/danfe/:chaveAcesso", async (req, res) => {
    const { chaveAcesso } = req.params;
    const { tenant } = req.query as { tenant: string };
    if (!await requireAdminHttp(req, res, [tenant])) return;
    if (!tenant) return res.status(400).json({ error: 'tenant obrigatório' });
    if (!db) return res.status(503).json({ error: 'Banco indisponível' });

    const { data, error } = await db.from('fiscal_notes')
      .select('intencao_json,protocolo,status,cstat,xmotivo,xml_assinado')
      .eq('chave_acesso', chaveAcesso)
      .eq('tenant_id', tenant)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: 'Nota não encontrada' });
    if (!data.intencao_json) return res.status(404).json({ error: 'DANFE indisponível para esta nota' });

    const intencao = {
      ...data.intencao_json,
      protocolo: data.protocolo ?? data.intencao_json.protocolo,
      status:    data.status    ?? data.intencao_json.status,
      cStat:     data.cstat     ?? data.intencao_json.cStat,
      xMotivo:   data.xmotivo   ?? data.intencao_json.xMotivo,
      xmlAssinado: data.xml_assinado ?? data.intencao_json.xmlAssinado,
    };

    return res.json({ intencao });
  });

  // GET /api/fiscal/xml/:chaveAcesso — download do XML assinado / procNFe
  app.get("/api/fiscal/xml/:chaveAcesso", async (req, res) => {
    const { chaveAcesso } = req.params;
    const { tenant } = req.query as { tenant: string };
    if (!await requireAdminHttp(req, res, [tenant])) return;
    if (!tenant) return res.status(400).json({ error: 'tenant obrigatório' });
    if (!db) return res.status(503).json({ error: 'Banco indisponível' });

    const { data, error } = await db.from('fiscal_notes')
      .select('xml_assinado,xml_proc_nfe,modelo,status')
      .eq('chave_acesso', chaveAcesso)
      .eq('tenant_id', tenant)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: 'Nota não encontrada' });

    const xml = data.xml_proc_nfe || data.xml_assinado;
    if (!xml) return res.status(404).json({ error: 'XML não disponível para esta nota' });

    const sufixo = data.xml_proc_nfe ? 'procNFe' : 'NFe';
    const filename = `${chaveAcesso}-${sufixo}.xml`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(xml);
  });

  // GET /api/fiscal/xml-lote — ZIP com todos os XMLs do mês (entrega à contabilidade)
  // Query: tenant=<tenantId>&ano=YYYY&mes=MM  (mes 1-based)
  app.get("/api/fiscal/xml-lote", async (req, res) => {
    const { tenant, ano, mes } = req.query as { tenant: string; ano: string; mes: string };
    if (!await requireAdminHttp(req, res, [tenant])) return;
    if (!tenant || !ano || !mes) return res.status(400).json({ error: 'tenant, ano e mes são obrigatórios' });
    if (!db) return res.status(503).json({ error: 'Banco indisponível' });

    const anoN = parseInt(ano);
    const mesN = parseInt(mes); // 1-based
    if (isNaN(anoN) || isNaN(mesN) || mesN < 1 || mesN > 12)
      return res.status(400).json({ error: 'ano/mes inválidos' });

    const inicio = new Date(anoN, mesN - 1, 1).toISOString();
    const fim    = new Date(anoN, mesN,     1).toISOString(); // exclusive

    const { data, error } = await db.from('fiscal_notes')
      .select('chave_acesso,xml_assinado,xml_proc_nfe,modelo,status,created_at')
      .eq('tenant_id', tenant)
      .in('status', ['AUTORIZADO', 'AUTORIZADO_COM_ALERTA', 'CANCELADO', 'EPEC_AUTORIZADO', 'CONTINGENCIA_PENDENTE_TRANSMISSAO'])
      .gte('created_at', inicio)
      .lt('created_at', fim)
      .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0)
      return res.status(404).json({ error: `Nenhum XML encontrado para ${String(mesN).padStart(2,'0')}/${anoN}` });

    const files: Record<string, Uint8Array> = {};
    for (const nota of data) {
      const xml = nota.xml_proc_nfe || nota.xml_assinado;
      if (!xml) continue;
      const sufixo = nota.xml_proc_nfe ? 'procNFe' : 'NFe';
      const filename = `${nota.chave_acesso}-${sufixo}.xml`;
      files[filename] = strToU8(xml);
    }

    if (Object.keys(files).length === 0)
      return res.status(404).json({ error: 'Nenhum XML disponível para o período' });

    const zip = zipSync(files, { level: 6 });
    const zipName = `xmls-${String(mesN).padStart(2,'0')}-${anoN}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    return res.send(Buffer.from(zip));
  });

  // GET /api/fiscal/consultar/:chaveAcesso
  app.get("/api/fiscal/consultar/:chaveAcesso", async (req, res) => {
    const { chaveAcesso } = req.params;
    const { tenantId } = req.query as { tenantId: string };
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });

    const cert = getCertificado(tenantId);
    if (!cert) return res.status(400).json({ error: 'Certificado não carregado.' });

    let ambiente: AmbienteFiscal = 'homologacao';
    let modelo = '65';
    if (db) {
      const { data } = await db.from('fiscal_notes')
        .select('ambiente,modelo').eq('chave_acesso', chaveAcesso).maybeSingle();
      ambiente = (data?.ambiente as AmbienteFiscal) ?? 'homologacao';
      modelo   = data?.modelo ?? '65';
    }

    try {
      const result = modelo === '55'
        ? await consultarNFe(chaveAcesso, ambiente, cert)
        : await consultarNFCe(chaveAcesso, ambiente, cert);

      // Resolver RESULTADO_DESCONHECIDO automaticamente
      if (db) {
        const statusMap: Record<string, string> = {
          '100': 'AUTORIZADO', '101': 'CANCELADO', '102': 'INUTILIZADO',
          '110': 'REJEITADO',  '150': 'AUTORIZADO_COM_ALERTA',
          '301': 'REJEITADO',  '302': 'REJEITADO',
        };
        const novoStatus = statusMap[result.cStat];
        if (novoStatus) {
          await db.from('fiscal_notes').update({
            status: novoStatus,
            protocolo: result.protocolo || undefined,
            cstat: result.cStat,
            xmotivo: result.xMotivo,
            updated_at: new Date().toISOString(),
          }).eq('chave_acesso', chaveAcesso).eq('tenant_id', tenantId);
        }
      }
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/fiscal/reconciliar — acionamento manual da reconciliação
  app.post("/api/fiscal/reconciliar", express.json(), async (req, res) => {
    const { tenantId } = req.body as { tenantId: string };
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });
    if (!db) return res.status(503).json({ error: 'Banco indisponível' });

    const cert = getCertificado(tenantId);
    if (!cert) return res.status(400).json({ error: 'Certificado não carregado. Faça login no PDV primeiro.' });

    try {
      const resultado = await reconciliarResultadoDesconhecido(tenantId, cert, db);

      // Emitir eventos de socket para notas que passaram para autorizado
      for (const d of resultado.detalhes) {
        if (d.statusNovo === 'AUTORIZADO' || d.statusNovo === 'AUTORIZADO_COM_ALERTA') {
          io.to('tenant:' + tenantId).emit('fiscal_note_reconciliada', {
            orderId:     d.orderId,
            status:      d.statusNovo,
            chaveAcesso: d.chaveAcesso,
            protocolo:   d.protocolo,
            cStat:       d.cStat,
            xMotivo:     d.xMotivo,
            retransmitida: d.retransmitida,
          });
        }
      }

      return res.json(resultado);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/fiscal/notes/:tenantId
  app.get("/api/fiscal/notes/:tenantId", async (req, res) => {
    const { tenantId } = req.params;
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!db) return res.json({ notes: [] });
    const { data } = await db.from('fiscal_notes')
      .select('id,order_id,chave_acesso,qr_code,status,protocolo,total,ambiente,modelo,serie,numero,error_detail,cstat,xmotivo,created_at')
      .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(50);
    return res.json({ notes: data || [] });
  });

  // GET /api/fiscal/cnpj/:cnpj — consulta CNPJ via CNPJ.ws (fallback BrasilAPI)
  app.get("/api/fiscal/cnpj/:cnpj", async (req, res) => {
    const rawCnpj = req.params.cnpj.replace(/\D/g, '');
    if (rawCnpj.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
    if (!await requireAdminHttp(req, res, [], false)) return;

    // helper: normaliza resposta para formato padrão
    const normalize = (data: any, source: 'cnpjws' | 'brasilapi') => {
      if (source === 'cnpjws') {
        const est = data.estabelecimento || {};
        const ddd = est.ddd1 || '';
        const tel = est.telefone1 || '';
        return {
          cnpj: rawCnpj,
          razaoSocial: data.razao_social || '',
          nomeFantasia: est.nome_fantasia || data.razao_social || '',
          situacao: est.situacao_cadastral || '',
          logradouro: est.logradouro || '',
          numero: est.numero || '',
          bairro: est.bairro || '',
          municipio: est.municipio?.nome || '',
          codigoMunicipio: String(est.municipio?.ibge_id || ''),
          uf: est.estado?.sigla || '',
          cep: (est.cep || '').replace(/\D/g, ''),
          telefone: ddd && tel ? `${ddd}${tel}`.replace(/\D/g, '') : '',
          email: est.email || '',
        };
      }
      // brasilapi
      return {
        cnpj: rawCnpj,
        razaoSocial: data.razao_social || data.nome || '',
        nomeFantasia: data.nome_fantasia || '',
        situacao: data.descricao_situacao_cadastral || '',
        logradouro: data.logradouro || '',
        numero: data.numero || '',
        bairro: data.bairro || '',
        municipio: data.municipio || '',
        codigoMunicipio: String(data.codigo_ibge || ''),
        uf: data.uf || '',
        cep: (data.cep || '').replace(/\D/g, ''),
        telefone: data.ddd_telefone_1 ? `${data.ddd_telefone_1}${data.telefone_1 || ''}`.replace(/\D/g, '') : '',
        email: data.email || '',
      };
    };

    // 1ª tentativa: CNPJ.ws (mais confiável em ambientes cloud)
    try {
      const r1 = await fetch(`https://publica.cnpj.ws/cnpj/${rawCnpj}`, { headers: { 'Accept': 'application/json' } });
      if (r1.ok) {
        const d1 = await r1.json() as any;
        return res.json(normalize(d1, 'cnpjws'));
      }
    } catch (_) { /* tenta próxima fonte */ }

    // 2ª tentativa: BrasilAPI
    try {
      const r2 = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${rawCnpj}`);
      if (r2.ok) {
        const d2 = await r2.json() as any;
        return res.json(normalize(d2, 'brasilapi'));
      }
      return res.status(r2.status).json({ error: 'CNPJ não encontrado ou indisponível' });
    } catch (e: any) {
      return res.status(502).json({ error: 'Falha ao consultar CNPJ — tente novamente' });
    }
  });

  // GET /api/fiscal/cep/:cep — consulta endereço via ViaCEP
  app.get("/api/fiscal/cep/:cep", async (req, res) => {
    const rawCep = req.params.cep.replace(/\D/g, '');
    if (rawCep.length !== 8) return res.status(400).json({ error: 'CEP inválido' });
    if (!await requireAdminHttp(req, res, [], false)) return;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);
      if (!r.ok) return res.status(r.status).json({ error: 'CEP não encontrado' });
      const d = await r.json() as any;
      if (d.erro) return res.status(404).json({ error: 'CEP não encontrado' });
      return res.json({
        logradouro: d.logradouro || '',
        bairro: d.bairro || '',
        municipio: d.localidade || '',
        codigoMunicipio: String(d.ibge || ''),
        uf: d.uf || '',
        cep: rawCep,
      });
    } catch (e: any) {
      return res.status(502).json({ error: 'Falha ao consultar CEP' });
    }
  });

  // GET /api/fiscal/cliente/:cpfcnpj — busca cliente salvo pelo CPF/CNPJ
  app.get("/api/fiscal/cliente/:cpfcnpj", async (req, res) => {
    if (!await requireAdminHttp(req, res, [], false)) return;
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    const digits = req.params.cpfcnpj.replace(/\D/g, '');
    if (digits.length !== 11 && digits.length !== 14) return res.status(400).json({ error: 'CPF/CNPJ inválido' });
    const tenantId = (req.headers['x-tenant-id'] as string) || '';
    const { data, error } = await db.from('clientes').select('*').eq('id', `${tenantId}:${digits}`).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Cliente não encontrado' });
    return res.json(data);
  });

  // POST /api/fiscal/cliente — salva/atualiza cliente
  app.post("/api/fiscal/cliente", express.json(), async (req, res) => {
    if (!await requireAdminHttp(req, res, [], false)) return;
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    const tenantId = (req.headers['x-tenant-id'] as string) || '';
    const { tipo, cpf_cnpj, nome, ie, email, logradouro, numero, bairro, municipio, codigo_municipio, uf, cep, telefone } = req.body;
    const digits = (cpf_cnpj || '').replace(/\D/g, '');
    if (!digits) return res.status(400).json({ error: 'CPF/CNPJ obrigatório' });
    const row = {
      id: `${tenantId}:${digits}`,
      tenant_id: tenantId,
      tipo: tipo || 'pf',
      cpf_cnpj: digits,
      nome: nome || null,
      ie: ie || null,
      email: email || null,
      logradouro: logradouro || null,
      numero: numero || null,
      bairro: bairro || null,
      municipio: municipio || null,
      codigo_municipio: codigo_municipio || null,
      uf: uf || null,
      cep: (cep || '').replace(/\D/g, '') || null,
      telefone: (telefone || '').replace(/\D/g, '') || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from('clientes').upsert(row, { onConflict: 'id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  });

  // GET /api/backup/list — lista backups disponíveis no Storage
  app.get("/api/backup/list", async (req, res) => {
    if (!await requireAdminHttp(req, res, [], false)) return;
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    const { data, error } = await db.storage.from('backups').list('', {
      limit: 30, sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ backups: (data || []).map(f => ({
      nome: f.name,
      tamanho: f.metadata?.size ?? 0,
      criadoEm: f.created_at,
    }))});
  });

  // GET /api/backup/download/:nome — URL assinada para baixar um backup
  app.get("/api/backup/download/:nome", async (req, res) => {
    if (!await requireAdminHttp(req, res, [], false)) return;
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    const { data, error } = await db.storage
      .from('backups')
      .createSignedUrl(req.params.nome, 300); // válida por 5 min
    if (error) return res.status(404).json({ error: error.message });
    return res.json({ url: data.signedUrl });
  });

  // POST /api/backup/now — dispara backup imediato (admin)
  app.post("/api/backup/now", express.json(), async (req, res) => {
    if (!await requireAdminHttp(req, res, [], false)) return;
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    try {
      const { executarBackup } = await import('./src/lib/backup.ts');
      const resultado = await executarBackup(db);
      return res.json(resultado);
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // Serve o executável do agente de impressão para download
  app.get("/download/fechaconta-agente.exe", (req, res) => {
    const agentPath = path.join(process.cwd(), "print-agent", "fechaconta-agente.exe");
    if (!fs.existsSync(agentPath)) {
      return res.status(404).json({ error: "Executável não encontrado. Execute 'npm run build' na pasta print-agent/." });
    }
    res.download(agentPath, "fechaconta-agente.exe");
  });

  // Serve o instalador PowerShell
  app.get("/download/install.ps1", (req, res) => {
    const scriptPath = path.join(process.cwd(), "print-agent", "install.ps1");
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).send("Not found");
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.download(scriptPath, "install.ps1");
  });

  app.post("/api/seed", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Supabase não inicializado" });

    const tenantId: string = String(req.body?.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    const steps: string[] = [];
    const log = (msg: string) => { steps.push(msg); console.log("[seed]", msg); };

    try {
      log("Limpando tabelas antigas...");
      await db.from('orders').delete().eq('tenant_id', tenantId);
      await db.from('stock').delete().eq('tenant_id', tenantId);
      await db.from('pizza_flavors').delete().eq('tenant_id', tenantId);
      await db.from('pizza_crusts').delete().eq('tenant_id', tenantId);

      log("Configurando 40 mesas...");
      await db.from('tables').upsert(
        Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: 'free', current_order: null, linked_to: null, tenant_id: tenantId })),
        { onConflict: 'tenant_id,id' }
      );

      log("Configurando 50 comandas...");
      await db.from('comandas').upsert(
        Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: 'free', current_order: null, linked_to: null, tenant_id: tenantId })),
        { onConflict: 'tenant_id,id' }
      );

      log("Carregando categorias do menu...");
      await db.from('menu').upsert(
        MENU_CATEGORIES.map((cat: any, idx: number) => ({ id: `${tenantId}:${cat.name}`, name: cat.name, position: idx, items: cat.items || [], tenant_id: tenantId }))
      );

      log("Carregando sabores de pizza...");
      await db.from('pizza_flavors').upsert(
        PIZZA_FLAVORS.map((f: any) => ({ id: `${tenantId}:${f.name}`, name: f.name, category: f.category || null, price: f.price || null, available: f.available !== false, tenant_id: tenantId }))
      );

      log("Carregando bordas...");
      await db.from('pizza_crusts').upsert(
        PIZZA_CRUSTS.map((c: any) => ({ id: `${tenantId}:${c}`, name: c, tenant_id: tenantId }))
      );

      log("Configurando sistema de caixa...");
      await db.from('config').upsert({ id: `${tenantId}:app`, data: { isCashRegisterOpen: false, dailyCounter: 0, lastOrderDate: '' }, tenant_id: tenantId });

      log("Resetando estado em memória...");
      // Reseta o estado de todos os tenants carregados
      tenants.forEach((st, tid) => {
        st.orders = [];
        st.tables = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, status: 'free', currentOrder: null, linkedTo: null }));
        st.comandas = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, status: 'free', currentOrder: null, linkedTo: null }));
        st.isCashRegisterOpen = false;
        st.loaded = false;
        const room = `tenant:${tid}`;
        io.to(room).emit('update_orders', st.orders);
        io.to(room).emit('update_tables', st.tables);
        io.to(room).emit('update_comandas', st.comandas);
        io.to(room).emit('update_cash_register', st.isCashRegisterOpen);
      });

      log("ConcluÃ­do!");
      res.json({ ok: true, steps });
    } catch (err: any) {
      console.error("[seed] Erro:", err);
      res.status(500).json({ error: err.message, steps });
    }
  });

  // Popula apenas as mesas (upsert, sem apagar pedidos ou outros dados)
  app.post("/api/seed-tables", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Supabase não inicializado" });
    const tenantId: string = String(req.body?.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    const count: number = Math.max(1, Math.min(200, Number(req.body?.count ?? 40)));
    try {
      await db.from('tables').upsert(
        Array.from({ length: count }, (_, i) => ({
          id: i + 1,
          status: 'free',
          current_order: null,
          linked_to: null,
          tenant_id: tenantId,
        })),
        { onConflict: 'tenant_id,id' }
      );
      const st = getState(tenantId);
      if (st.tables.length === 0) {
        st.tables = Array.from({ length: count }, (_, i) => ({ id: i + 1, status: 'free', currentOrder: null, linkedTo: null }));
        io.to(`tenant:${tenantId}`).emit('update_tables', st.tables);
      }
      res.json({ ok: true, count });
    } catch (err: any) {
      console.error("[seed-tables] Erro:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Atualiza apenas o menu (sem apagar pedidos, mesas, sabores, etc.)
  app.post("/api/seed-menu", async (req, res) => {
    if (!db) return res.status(503).json({ error: "Supabase não inicializado" });
    const tenantId: string = String(req.body?.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    try {
      await db.from('menu').upsert(
        MENU_CATEGORIES.map((cat: any, idx: number) => ({
          id: `${tenantId}:${cat.name}`,
          name: cat.name,
          position: idx,
          type: cat.type,
          items: cat.items || [],
          subcategories: cat.subcategories || [],
          tenant_id: tenantId,
        }))
      );
      const st = getState(tenantId);
      st.menu = JSON.parse(JSON.stringify(MENU_CATEGORIES));
      // NÃO resetar st.loaded para não disparar recarga completa (que emitiria update_cash_register=false)
      io.to(`tenant:${tenantId}`).emit('update_menu', st.menu);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Retorna config.json pré-configurado para o agente de impressão
  app.get("/api/agent-config", async (req, res) => {
    const tenantId = req.query.tenant as string;
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    if (!tenantId) return res.status(400).json({ error: 'tenant obrigatório' });
    const cfg = { serverUrl: 'https://fechaconta.app', agentSecret: '', tenantId };
    res.setHeader('Content-Disposition', 'attachment; filename="config.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(cfg, null, 2));
  });

  // Força liberação de mesa mesmo com pedido ativo (uso emergencial admin)
  app.post("/api/force-release-table", async (req, res) => {
    const tenantId: string = String(req.body?.tenantId || '').trim();
    const orderId: string = String(req.body?.orderId || '').trim();
    if (!tenantId || !orderId) return res.status(400).json({ error: 'tenantId e orderId obrigatórios' });
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    const st = getState(tenantId);
    const order = st.orders.find((o: any) => String(o.id) === orderId);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (order.status === 'finalizada' || order.status === 'paid') return res.json({ ok: true, message: 'Pedido já finalizado' });
    order.status = 'finalizada';
    (order as any).forceReleased = true;
    const entitiesToUpdate: any[] = [];
    st.tables = st.tables.map((t: any) => {
      if (t.currentOrder && String(t.currentOrder) === orderId) {
        const freed = { ...t, status: 'free', currentOrder: null, linkedTo: null };
        entitiesToUpdate.push({ entity: freed, collection: 'tables' });
        return freed;
      }
      return t;
    });
    st.comandas = st.comandas.map((c: any) => {
      if (c.currentOrder && String(c.currentOrder) === orderId) {
        const freed = { ...c, status: 'free', currentOrder: null, linkedTo: null };
        entitiesToUpdate.push({ entity: freed, collection: 'comandas' });
        return freed;
      }
      return c;
    });
    io.to(`tenant:${tenantId}`).emit('update_orders', st.orders);
    io.to(`tenant:${tenantId}`).emit('update_tables', st.tables);
    io.to(`tenant:${tenantId}`).emit('update_comandas', st.comandas);
    if (db) {
      saveToSupabase('orders', order, orderId, tenantId).catch(() => {});
      for (const item of entitiesToUpdate) {
        saveToSupabase(item.collection, item.entity, String(item.entity.id), tenantId).catch(() => {});
      }
    }
    writeAudit(tenantId, 'force_release' as any, 'ADM',
      `Mesa liberada à força (HTTP) — Pedido ${orderId}`, { orderId });
    res.json({ ok: true, freed: entitiesToUpdate.length });
  });

  // Libera mesas/comandas ocupadas sem pedido ativo (correção manual)
  app.post("/api/fix-tables", async (req, res) => {
    const tenantId: string = String(req.body?.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });
    if (!await requireAdminHttp(req, res, [tenantId])) return;
    const st = getState(tenantId);
    const activeIds = new Set(st.orders.filter((o: any) => o.status !== 'finalizada' && o.status !== 'paid').map((o: any) => String(o.id)));
    let fixed = 0;
    st.tables = st.tables.map((t: any) => {
      if (t.status !== 'free' && t.currentOrder && !activeIds.has(String(t.currentOrder))) {
        fixed++;
        if (db) saveToSupabase('tables', { ...t, status: 'free', currentOrder: null, linkedTo: null }, t.id.toString(), tenantId).catch(() => {});
        return { ...t, status: 'free', currentOrder: null, linkedTo: null };
      }
      return t;
    });
    st.comandas = st.comandas.map((c: any) => {
      if (c.status !== 'free' && c.currentOrder && !activeIds.has(String(c.currentOrder))) {
        fixed++;
        if (db) saveToSupabase('comandas', { ...c, status: 'free', currentOrder: null, linkedTo: null }, c.id.toString(), tenantId).catch(() => {});
        return { ...c, status: 'free', currentOrder: null, linkedTo: null };
      }
      return c;
    });
    if (fixed > 0) {
      io.to(`tenant:${tenantId}`).emit('update_tables', st.tables);
      io.to(`tenant:${tenantId}`).emit('update_comandas', st.comandas);
    }
    res.json({ ok: true, fixed });
  });

  app.post("/api/admin/create-waiter", express.json(), async (req, res) => {
    const { name, password, tenantId: claimedTenantId } = req.body;
    const adminAuth = await requireAdminHttp(req, res, claimedTenantId ? [claimedTenantId] : [], false);
    if (!adminAuth) return;
    const tenantId = adminAuth.userId;
    if (!name || !password) {
      return res.status(400).json({ error: "name e password sÃ£o obrigatÃ³rios" });
    }

    const st = getState(tenantId);
    const existing = st.waiters.find((w: any) => w.name === name);
    if (existing) {
      return res.status(409).json({ error: "Garçom com esse nome já existe" });
    }
    const newWaiter = {
      id: `waiter_${Date.now()}`,
      name,
      password,
      status: "approved",
      role: "waiter",
      createdAt: new Date().toISOString(),
    };
    st.waiters.push(newWaiter);
    io.to(`tenant:${tenantId}`).emit("update_waiters", publicWaiters(st.waiters));
    console.log(`[admin] GarÃ§om criado: ${name}`);
    return res.json({ success: true, waiter: { id: newWaiter.id, name: newWaiter.name, status: newWaiter.status } });
  });

  // ── Controle de Presença ──────────────────────────────────────────────────────

  function todayDateStr() {
    return new Date().toISOString().split('T')[0];
  }

  // Gera ou retorna o token do dia para um tenant
  app.post("/api/attendance/token", express.json(), async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB não disponível" });
    const { tenantId } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId obrigatório" });

    const today = todayDateStr();
    const { data: existing } = await db.from('fin_attendance_tokens').select('*').eq('tenant_id', tenantId).eq('date', today).single();
    if (existing) {
      return res.json({ token: existing.token, date: existing.date });
    }

    const newToken = {
      id: `att_${tenantId}_${today}`,
      tenant_id: tenantId,
      date: today,
      token: Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10),
    };
    const { data, error } = await db.from('fin_attendance_tokens').insert(newToken).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ token: (data as any).token, date: (data as any).date });
  });

  // Página pública: info do token (data + lista de colaboradores do tenant)
  app.get("/api/attendance/:token", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB não disponível" });
    const { token } = req.params;

    const { data: tokenData } = await db.from('fin_attendance_tokens').select('*').eq('token', token).single();
    if (!tokenData) return res.status(404).json({ error: "QR Code inválido ou expirado." });

    const today = todayDateStr();
    if ((tokenData as any).date !== today) return res.status(410).json({ error: "QR Code expirado. Solicite um novo ao gestor." });

    const { data: employees } = await db.from('fin_employees').select('id, name').eq('tenant_id', (tokenData as any).tenant_id).in('status', ['ativo', 'pago']).order('name');
    const { data: records } = await db.from('fin_attendance_records').select('employee_id').eq('tenant_id', (tokenData as any).tenant_id).eq('date', today);
    const confirmedIds = new Set(((records || []) as any[]).map(r => r.employee_id));

    return res.json({
      date: (tokenData as any).date,
      employees: ((employees || []) as any[]).map(e => ({ id: e.id, name: e.name, confirmed: confirmedIds.has(e.id) })),
    });
  });

  // Confirmação pública de presença
  app.post("/api/attendance/:token/confirm", express.json(), async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB não disponível" });
    const { token } = req.params;
    const { employee_id } = req.body;
    if (!employee_id) return res.status(400).json({ error: "employee_id obrigatório" });

    const { data: tokenData } = await db.from('fin_attendance_tokens').select('*').eq('token', token).single();
    if (!tokenData) return res.status(404).json({ error: "QR Code inválido." });

    const today = todayDateStr();
    if ((tokenData as any).date !== today) return res.status(410).json({ error: "QR Code expirado." });

    const { data: emp } = await db.from('fin_employees').select('name').eq('id', employee_id).single();
    if (!emp) return res.status(404).json({ error: "Colaborador não encontrado." });

    const record = {
      id: `rec_${(tokenData as any).tenant_id}_${employee_id}_${today}`,
      tenant_id: (tokenData as any).tenant_id,
      employee_id,
      employee_name: (emp as any).name,
      date: today,
      confirmed_at: new Date().toISOString(),
      token_id: (tokenData as any).id,
    };

    const { error } = await db.from('fin_attendance_records').upsert(record);
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, name: (emp as any).name });
  });

  // Registros de presença por tenant e período (usado pelo Dashboard)
  app.get("/api/attendance/records/:tenantId", async (req, res) => {
    if (!db) return res.status(503).json({ error: "DB não disponível" });
    const { tenantId } = req.params;
    const { from, to } = req.query as { from?: string; to?: string };

    let q = db.from('fin_attendance_records').select('*').eq('tenant_id', tenantId).order('date', { ascending: false }).order('confirmed_at', { ascending: true });
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ records: data || [] });
  });

  // ── PDF Reservation API ────────────────────────────────────────────────────

  interface PdfDrawOpServer {
    valueKey: string;
    centerX: number; y: number;
    maxWidth: number; maxFontSize: number; minFontSize: number;
    font: string; color: string;
    rotateDeg?: number;
    coverRect?: { x: number; y: number; width: number; height: number; fillColor: string };
  }

  // Page: 595.5 × 842.2 pt (A4 portrait)
  // Black bar bottom (frente): x=146.8 y=220.8 w=301.7 h=88.5 → center (297.6, 265.1)
  // Black bar top   (verso):   x=146.8 y=549.0 w=301.7 h=88.5 → center (297.6, 593.2)
  const PDF_TEMPLATES: Record<string, {
    file: string; page: number;
    draws: PdfDrawOpServer[];
    fields: { name: { centerX: number; y: number; maxWidth: number; maxFontSize: number; minFontSize: number; color: string } };
  }> = {
    reservaPrincipal: {
      file: 'templates/reserva.pdf',
      page: 0,
      draws: [
        // Frente — parte inferior, texto normal
        {
          valueKey: 'name',
          centerX: 297.6, y: 257,
          maxWidth: 280, maxFontSize: 52, minFontSize: 16,
          font: 'TimesRomanBoldItalic', color: '#0a0a0a',
          rotateDeg: 0,
          coverRect: { x: 146.8, y: 220.8, width: 301.7, height: 88.5, fillColor: '#ffffff' },
        },
        // Verso — parte superior, texto invertido 180°
        {
          valueKey: 'name',
          centerX: 297.6, y: 601,
          maxWidth: 280, maxFontSize: 52, minFontSize: 16,
          font: 'TimesRomanBoldItalic', color: '#0a0a0a',
          rotateDeg: 180,
          coverRect: { x: 146.8, y: 549.0, width: 301.7, height: 88.5, fillColor: '#ffffff' },
        },
      ],
      fields: {
        name: { centerX: 297.6, y: 257, maxWidth: 280, maxFontSize: 52, minFontSize: 16, color: '#0a0a0a' },
      },
    },
  };

  /** Finds the largest font size where text fits within maxWidth */
  function fitFontSize(
    text: string,
    widthFn: (t: string, s: number) => number,
    maxWidth: number, maxFs: number, minFs: number,
  ): number {
    let fs = maxFs;
    while (fs > minFs && widthFn(text, fs) > maxWidth) fs--;
    return fs;
  }

  /** Hex color string → pdf-lib rgb() */
  function hexToRgb(hex: string): ReturnType<typeof rgb> {
    const h = hex.replace('#', '');
    return rgb(
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255,
    );
  }

  /** Resolves a font name string to a pdf-lib StandardFonts value */
  function resolveFont(name: string): string {
    const map: Record<string, string> = {
      TimesRomanBoldItalic: StandardFonts.TimesRomanBoldItalic,
      TimesRomanBold:       StandardFonts.TimesRomanBold,
      TimesRoman:           StandardFonts.TimesRoman,
      HelveticaBold:        StandardFonts.HelveticaBold,
      Helvetica:            StandardFonts.Helvetica,
      CourierBold:          StandardFonts.CourierBold,
    };
    return map[name] ?? StandardFonts.TimesRomanBoldItalic;
  }

  // Upload a custom template PDF (base64-encoded)
  app.post("/api/reservas/upload-template", async (req, res) => {
    try {
      const { pdfBase64 } = req.body ?? {};
      if (!pdfBase64 || typeof pdfBase64 !== 'string') {
        return res.status(400).json({ error: 'Dados do PDF ausentes.' });
      }
      const headerBytes = Buffer.from(pdfBase64.slice(0, 8), 'base64').toString('ascii');
      if (!headerBytes.startsWith('%PDF')) {
        return res.status(400).json({ error: 'O arquivo enviado não é um PDF válido.' });
      }
      const decoded = Buffer.from(pdfBase64, 'base64');
      if (decoded.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'O arquivo excede o tamanho máximo de 10 MB.' });
      }
      const publicDir = path.resolve(process.cwd(), 'public');
      const dest = path.join(publicDir, 'templates', 'reserva.pdf');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, decoded);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[/api/reservas/upload-template]', err);
      return res.status(500).json({ error: 'Não foi possível salvar o template.' });
    }
  });

  app.post("/api/reservas/gerar-pdf", async (req, res) => {
    try {
      const { name, templateId = 'reservaPrincipal', fieldConfig } = req.body ?? {};

      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'O campo nome é obrigatório.' });
      }
      const safeName = name.trim().slice(0, 100);
      if (!/^[a-zA-ZÀ-ÿ0-9 \-'.]+$/u.test(safeName)) {
        return res.status(400).json({ error: 'Nome contém caracteres inválidos.' });
      }

      const template = PDF_TEMPLATES[templateId as string];
      if (!template) return res.status(400).json({ error: 'Template não encontrado.' });

      const publicDir = path.resolve(process.cwd(), 'public');
      const templatePath = path.join(publicDir, template.file);
      if (!templatePath.startsWith(publicDir)) return res.status(400).json({ error: 'Template inválido.' });
      if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Arquivo de template não encontrado.' });

      const pdfDoc = await PDFDocument.load(fs.readFileSync(templatePath));
      const pages = pdfDoc.getPages();
      const page = pages[template.page] ?? pages[0];

      // Cache for embedded fonts (avoid embedding the same font twice)
      const fontCache: Record<string, Awaited<ReturnType<typeof pdfDoc.embedFont>>> = {};
      const getFont = async (name: string) => {
        if (!fontCache[name]) fontCache[name] = await pdfDoc.embedFont(resolveFont(name));
        return fontCache[name];
      };

      // Apply fieldConfig override — only font size and color; position always from template
      const draws: PdfDrawOpServer[] = template.draws.map((draw) => {
        if (draw.valueKey !== 'name' || !fieldConfig) return draw;
        return {
          ...draw,
          maxFontSize: typeof fieldConfig.maxFontSize === 'number' ? fieldConfig.maxFontSize : draw.maxFontSize,
          minFontSize: typeof fieldConfig.minFontSize === 'number' ? fieldConfig.minFontSize : draw.minFontSize,
          color: (typeof fieldConfig.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(fieldConfig.color))
                   ? fieldConfig.color : draw.color,
        };
      });

      const values: Record<string, string> = { name: safeName };

      for (const draw of draws) {
        const text = values[draw.valueKey];
        if (!text) continue;

        const font = await getFont(draw.font);

        // Cover the placeholder bar with a solid rectangle
        if (draw.coverRect) {
          const cr = draw.coverRect;
          page.drawRectangle({
            x: cr.x, y: cr.y, width: cr.width, height: cr.height,
            color: hexToRgb(cr.fillColor),
            borderWidth: 0,
          });
        }

        const fontSize = fitFontSize(
          text, (t, s) => font.widthOfTextAtSize(t, s),
          draw.maxWidth, draw.maxFontSize, draw.minFontSize,
        );
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        const rotateDeg = draw.rotateDeg ?? 0;

        let x: number;
        let y: number;

        if (rotateDeg === 0) {
          // Normal: (x,y) = baseline-left
          x = draw.centerX - textWidth / 2;
          y = draw.y;
        } else {
          // 180° rotation: pdf-lib uses (x,y) as the anchor (bottom-left in local space).
          // After 180° rotation the visual text extends LEFT from x, with cap-height going DOWN.
          // To center visually at (centerX, y): anchor = (centerX + textWidth/2, y)
          x = draw.centerX + textWidth / 2;
          y = draw.y;
        }

        page.drawText(text, {
          x, y,
          size: fontSize,
          font,
          color: hexToRgb(draw.color),
          rotate: rotateDeg !== 0 ? degrees(rotateDeg) : undefined,
        });
      }

      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="reserva.pdf"');
      return res.end(Buffer.from(pdfBytes));
    } catch (err) {
      console.error('[/api/reservas/gerar-pdf]', err);
      return res.status(500).json({ error: 'Não foi possível gerar a reserva. Tente novamente.' });
    }
  });

  // ── End PDF Reservation API ────────────────────────────────────────────────

  // ── Activation Codes (stored in Supabase user_metadata) ─────────────────────

  app.post('/api/auth/request-activation', express.json(), async (req, res) => {
    const { email, name } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email é obrigatório' });
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    try {
      // Find user by email (avoids fake userId from Supabase's signUp security sanitization)
      const { data: listData, error: listErr } = await (db.auth as any).admin.listUsers({ perPage: 500 });
      if (listErr) return res.status(500).json({ error: listErr.message });
      const user = (listData?.users || []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
      if (!user) return res.status(404).json({ error: 'Usuário não localizado após cadastro. Aguarde e tente novamente.' });
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const { error: updateErr } = await (db.auth as any).admin.updateUserById(user.id, {
        user_metadata: { activation_code: code },
      });
      if (updateErr) {
        console.error('[activation] updateUserById error:', updateErr.message);
        return res.status(500).json({ error: updateErr.message });
      }
      console.log(`[activation] código ${code} gerado para ${email} (${user.id})`);
      return res.json({ ok: true, userId: user.id });
    } catch (e: any) {
      console.error('[activation] exception:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/auth/activate', express.json(), async (req, res) => {
    const { userId, code } = req.body || {};
    if (!userId || !code) return res.status(400).json({ error: 'userId e code são obrigatórios' });
    if (!db) return res.status(503).json({ error: 'DB não disponível' });
    try {
      const { data: listData, error: listErr } = await (db.auth as any).admin.listUsers({ perPage: 500 });
      if (listErr) return res.status(500).json({ error: listErr.message });
      const user = (listData?.users || []).find((u: any) => u.id === userId);
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
      const storedCode = user.user_metadata?.activation_code;
      if (!storedCode) return res.status(404).json({ error: 'Nenhum código gerado. Contate o administrador.' });
      if (String(storedCode) !== String(code)) return res.status(400).json({ error: 'Código incorreto' });
      const { error: confirmErr } = await (db.auth as any).admin.updateUserById(userId, {
        email_confirm: true,
        user_metadata: { activation_code: null },
      });
      if (confirmErr) return res.status(500).json({ error: confirmErr.message });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── Dev Admin API ────────────────────────────────────────────────────────────
  {
    const devTokens = new Set<string>();
    const DEV_USER = process.env.ADMIN_DEV_USER || 'urbanodev';
    const DEV_PASS = process.env.ADMIN_DEV_PASS || '';

    const requireDevToken = (req: any, res: any): boolean => {
      const token = req.headers['x-dev-token'];
      if (!token || !devTokens.has(String(token))) {
        res.status(401).json({ error: 'Token inválido' });
        return false;
      }
      return true;
    };

    app.post('/api/dev/login', express.json(), (req, res) => {
      const { username, password } = req.body || {};
      if (!DEV_PASS || username !== DEV_USER || password !== DEV_PASS) {
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }
      const token = randomUUID();
      devTokens.add(token);
      setTimeout(() => devTokens.delete(token), 24 * 60 * 60 * 1000);
      return res.json({ token });
    });

    app.get('/api/dev/tenants', async (req, res) => {
      if (!requireDevToken(req, res)) return;
      if (!db) return res.json({ tenants: [] });
      try {
        const { data, error } = await (db.auth as any).admin.listUsers({ perPage: 500 });
        if (error) return res.json({ tenants: [], error: error.message });
        const list = (data?.users || []).map((u: any) => ({
          id: u.id,
          email: u.email || '',
          name: u.user_metadata?.establishment_name || '',
          plan: u.user_metadata?.plan || 'free',
          createdAt: u.created_at,
          lastSignIn: u.last_sign_in_at,
          isOnline: tenants.has(u.id),
        }));
        return res.json({ tenants: list });
      } catch (e: any) {
        return res.json({ tenants: [], error: e.message });
      }
    });

    app.get('/api/dev/tenants/:id/orders', async (req, res) => {
      if (!requireDevToken(req, res)) return;
      const { id } = req.params;
      if (!db) return res.json({ orders: [] });
      const { data } = await db.from('orders')
        .select('id,table_id,waiter_name,status,is_comanda,timestamp,items,payment_log')
        .eq('tenant_id', id)
        .order('timestamp', { ascending: false })
        .limit(50);
      return res.json({ orders: data || [] });
    });

    app.get('/api/dev/tenants/:id/notes', async (req, res) => {
      if (!requireDevToken(req, res)) return;
      const { id } = req.params;
      if (!db) return res.json({ notes: [] });
      const { data } = await db.from('fiscal_notes')
        .select('id,order_id,chave_acesso,status,protocolo,total,ambiente,modelo,serie,numero,error_detail,created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      return res.json({ notes: data || [] });
    });

    app.get('/api/dev/tenants/:id/cashiers', async (req, res) => {
      if (!requireDevToken(req, res)) return;
      const { id } = req.params;
      if (!db) return res.json({ cashiers: [] });
      const { data } = await db.from('cash_register_reports')
        .select('id,cash_register_name,opened_at,closed_at,total_sales,created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })
        .limit(30);
      return res.json({ cashiers: data || [] });
    });

    app.get('/api/dev/tenants/:id/waiters', async (req, res) => {
      if (!requireDevToken(req, res)) return;
      const { id } = req.params;
      const st = tenants.get(id);
      if (st?.waiters?.length) {
        return res.json({ waiters: (st.waiters as any[]).map((w: any) => ({ id: w.id, name: w.name, status: w.status, role: w.role })) });
      }
      if (!db) return res.json({ waiters: [] });
      const { data } = await db.from('waiters')
        .select('id,name,status,role,created_at')
        .eq('tenant_id', id);
      return res.json({ waiters: data || [] });
    });

    app.post('/api/dev/confirm-user', express.json(), async (req, res) => {
      if (!requireDevToken(req, res)) return;
      const { email } = req.body || {};
      if (!email || typeof email !== 'string') return res.status(400).json({ error: 'email obrigatório' });
      if (!db) return res.status(503).json({ error: 'DB não disponível' });
      try {
        const { data: listData, error: listErr } = await (db.auth as any).admin.listUsers({ perPage: 500 });
        if (listErr) return res.status(500).json({ error: listErr.message });
        const user = (listData?.users || []).find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (!user) return res.status(404).json({ error: `Usuário com e-mail "${email}" não encontrado` });
        const { error: updateErr } = await (db.auth as any).admin.updateUserById(user.id, { email_confirm: true });
        if (updateErr) return res.status(500).json({ error: updateErr.message });
        return res.json({ ok: true, userId: user.id, email: user.email });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/dev/pending-activations', async (req, res) => {
      if (!requireDevToken(req, res)) return;
      if (!db) return res.json({ activations: [] });
      try {
        const { data: listData, error: listErr } = await (db.auth as any).admin.listUsers({ perPage: 500 });
        if (listErr) return res.status(500).json({ error: listErr.message });
        const list = (listData?.users || [])
          .filter((u: any) => !u.email_confirmed_at && u.user_metadata?.activation_code)
          .map((u: any) => ({
            userId: u.id,
            email: u.email || '',
            name: u.user_metadata?.establishment_name || u.user_metadata?.activation_name || '',
            code: u.user_metadata?.activation_code,
            createdAt: u.created_at,
          }))
          .sort((a: any, b: any) => (a.createdAt > b.createdAt ? -1 : 1));
        return res.json({ activations: list });
      } catch (e: any) {
        return res.status(500).json({ error: e.message });
      }
    });


    app.get('/api/dev/server', (req, res) => {
      if (!requireDevToken(req, res)) return;
      const mem = process.memoryUsage();
      return res.json({
        uptime: Math.floor(process.uptime()),
        memRss: mem.rss,
        memHeap: mem.heapUsed,
        memHeapTotal: mem.heapTotal,
        connectedSockets: (io.engine as any).clientsCount ?? 0,
        activeTenants: tenants.size,
        nodeVersion: process.version,
        platform: process.platform,
      });
    });
  }
  // ── End Dev Admin API ─────────────────────────────────────────────────────

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // Arquivos com hash no nome (JS/CSS/assets) podem ser cacheados por 1 ano
    // index.html e sw.js nunca devem ser cacheados — sempre buscar do servidor
    app.use(express.static(distPath, {
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (name === 'index.html' || name === 'sw.js' || name.startsWith('workbox-')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Só iniciar esta promessa depois de todas as declarações usadas pela carga
  // (em especial clientSessions), e só aceitar conexões após o snapshot real.
  startupReady = loadFromSupabase().then(() => seedBebidasSubcategories('default'));
  await startupReady;
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown: drena writes pendentes antes de sair (evita perda de dados no deploy)
  const drainAllPendingWrites = async () => {
    for (const [key, timer] of _writeTimers.entries()) {
      clearTimeout(timer);
      _writeTimers.delete(key);
      const p = _writePayload.get(key);
      if (p) {
        _writePayload.delete(key);
        try { await saveToSupabase(p.collection, p.data, p.docId, p.tenantId); } catch (e: any) {
          console.error(`[shutdown] falha ao salvar ${p.collection}/${p.docId}:`, e?.message);
        }
      }
    }
    const inFlight = [..._tenantWriteTails.values()];
    if (inFlight.length > 0) await Promise.allSettled(inFlight);
  };

  const gracefulShutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} recebido — drenando ${_writeTimers.size} writes pendentes...`);
    httpServer.close();
    try {
      await Promise.race([
        drainAllPendingWrites(),
        new Promise<void>(resolve => setTimeout(resolve, 8000)),
      ]);
      console.log('[shutdown] Writes drenados. Saindo.');
    } catch (e: any) {
      console.error('[shutdown] Erro ao drenar writes:', e?.message);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

  // Reconciliação automática de RESULTADO_DESCONHECIDO a cada 5 minutos.
  // Só processa tenants cujos certificados já estejam carregados em memória.
  const RECON_INTERVAL_MS = 5 * 60_000;
  setInterval(async () => {
    if (!db) return;
    try {
      // Descobrir tenants com notas pendentes
      const { data: rows } = await db.from('fiscal_notes')
        .select('tenant_id')
        .in('status', ['RESULTADO_DESCONHECIDO', 'PROCESSANDO'])
        .not('chave_acesso', 'is', null);

      const uniqueTenants = [...new Set((rows ?? []).map((r: any) => r.tenant_id as string))];

      for (const tid of uniqueTenants) {
        const cert = getCertificado(tid);
        if (!cert) continue; // Certificado não carregado — aguardar próximo ciclo

        try {
          const resultado = await reconciliarResultadoDesconhecido(tid, cert, db);
          if (resultado.resolvidos > 0) {
            console.log(`[Reconciliação] tenant=${tid} total=${resultado.total} resolvidos=${resultado.resolvidos} autorizados=${resultado.autorizados} rejeitados=${resultado.rejeitados}`);
            for (const d of resultado.detalhes) {
              if (d.statusNovo === 'AUTORIZADO' || d.statusNovo === 'AUTORIZADO_COM_ALERTA') {
                io.to('tenant:' + tid).emit('fiscal_note_reconciliada', {
                  orderId:     d.orderId,
                  status:      d.statusNovo,
                  chaveAcesso: d.chaveAcesso,
                  protocolo:   d.protocolo,
                  cStat:       d.cStat,
                  xMotivo:     d.xMotivo,
                  retransmitida: d.retransmitida,
                });
              }
            }
          }
        } catch (e: any) {
          console.error(`[Reconciliação] tenant=${tid} erro:`, e.message);
        }
      }
    } catch (e: any) {
      console.error('[Reconciliação] erro geral:', e.message);
    }
  }, RECON_INTERVAL_MS);
}

startServer();
