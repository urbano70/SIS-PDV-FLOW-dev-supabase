/**
 * TESTE DE FOGO — SIS-PDV-FLOW
 * Simula 25 garçons fazendo lançamentos aleatórios em paralelo.
 *
 * Uso:
 *   node teste-de-fogo.cjs <URL_PRODUCAO>
 *   node teste-de-fogo.cjs https://fechaconta.app
 */

'use strict';
const { io }        = require('socket.io-client');
const { randomUUID } = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────
const SERVER_URL    = process.argv[2] || 'https://fechaconta.app';
const TOTAL_WAITERS = 25;
const MAX_TABLES    = 40;
const MIN_DELAY_MS  = 500;
const MAX_DELAY_MS  = 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep    = (ms) => new Promise(r => setTimeout(r, ms));
const rand     = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick     = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ── Métricas globais ──────────────────────────────────────────────────────────
const metrics = {
  registered:       0,
  approved:         0,
  inactivated:      0,
  ordersAttempted:  0,
  ordersOk:         0,
  ordersFailed:     0,
  errors:           [],
  latencies:        [],
  start:            Date.now(),
};

function logEvent(waiterName, msg) {
  const elapsed = ((Date.now() - metrics.start) / 1000).toFixed(1);
  console.log(`[${elapsed}s] [${waiterName}] ${msg}`);
}

// ── Relatório Final ───────────────────────────────────────────────────────────
function printReport() {
  const elapsed = ((Date.now() - metrics.start) / 1000).toFixed(1);
  const lat = metrics.latencies.slice().sort((a, b) => a - b);
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 'N/A';
  const min = lat.length ? lat[0] : 'N/A';
  const max = lat.length ? lat[lat.length - 1] : 'N/A';
  const p95 = lat.length ? lat[Math.floor(lat.length * 0.95)] : 'N/A';

  console.log('\n' + '='.repeat(62));
  console.log('  RELATÓRIO FINAL — TESTE DE FOGO');
  console.log('='.repeat(62));
  console.log(`  Duração total             : ${elapsed}s`);
  console.log(`  Garçons registrados       : ${metrics.registered} / ${TOTAL_WAITERS}`);
  console.log(`  Garçons aprovados (ADM)   : ${metrics.approved}`);
  console.log(`  Garçons inativados (ADM)  : ${metrics.inactivated}`);
  console.log(`  Lançamentos tentados      : ${metrics.ordersAttempted}`);
  console.log(`  Lançamentos confirmados   : ${metrics.ordersOk}`);
  console.log(`  Lançamentos sem confirm.  : ${metrics.ordersFailed}`);
  const taxa = metrics.ordersAttempted
    ? ((metrics.ordersOk / metrics.ordersAttempted) * 100).toFixed(1) : '0.0';
  console.log(`  Taxa de confirmação       : ${taxa}%`);
  console.log('');
  console.log(`  Latência média            : ${avg}ms`);
  console.log(`  Latência mínima           : ${min}ms`);
  console.log(`  Latência máxima           : ${max}ms`);
  console.log(`  Latência p95              : ${p95}ms`);
  console.log('');

  if (metrics.errors.length === 0) {
    console.log('  ✅  Nenhum erro registrado.');
  } else {
    console.log(`  ❌  ${metrics.errors.length} ocorrência(s) de erro/aviso:`);
    const grouped = {};
    metrics.errors.forEach(e => { grouped[e] = (grouped[e] || 0) + 1; });
    Object.entries(grouped).forEach(([msg, count]) => {
      console.log(`       • ${msg}  (×${count})`);
    });
  }

  console.log('');
  // Avaliação automática
  const p95v = typeof p95 === 'number' ? p95 : 0;
  const maxv  = typeof max  === 'number' ? max  : 0;
  const avgv  = typeof avg  === 'number' ? avg  : 0;

  if (p95v > 3000) {
    console.log('  ⚠️  GARGALO CRÍTICO: p95 > 3s — contenção no servidor ou banco.');
  } else if (p95v > 1500) {
    console.log('  ⚠️  GARGALO MODERADO: p95 entre 1.5s–3s — monitorar sob carga real.');
  } else if (maxv > 5000) {
    console.log('  ⚠️  PICO ISOLADO: ao menos um lançamento levou > 5s.');
  } else if (metrics.ordersFailed > 0) {
    console.log('  ⚠️  Alguns lançamentos não tiveram confirmação no tempo esperado.');
  } else if (avgv < 400 && metrics.ordersFailed === 0) {
    console.log('  ✅  EXCELENTE: média < 400ms, zero falhas. Sistema passou no Teste de Fogo.');
  } else {
    console.log('  ✅  SATISFATÓRIO: desempenho dentro do esperado para 25 usuários simultâneos.');
  }
  console.log('='.repeat(62) + '\n');
  process.exit(0);
}

// ── Escolhe item do cardápio (Lanches ou Bebidas) ─────────────────────────────
function pickMenuItem(menu) {
  const targetKeywords = ['lanche', 'bebida', 'drink', 'food', 'snack'];
  let candidates = [];

  for (const cat of (menu || [])) {
    if (cat.visible === false) continue;
    const catKey = (cat.type || cat.name || '').toLowerCase();
    const isTarget = targetKeywords.some(k => catKey.includes(k));

    const items = (cat.items || []).filter(i => i.visible !== false && i.price > 0);
    if (isTarget && items.length) {
      items.forEach(i => candidates.push({ ...i, _catType: cat.type || catKey }));
    }

    for (const sub of (cat.subcategories || [])) {
      if (sub.visible === false) continue;
      const subItems = (sub.items || []).filter(i => i.visible !== false && i.price > 0);
      if (isTarget && subItems.length) {
        subItems.forEach(i => candidates.push({ ...i, _catType: cat.type || catKey }));
      }
    }
  }

  // Fallback: qualquer item não-pizza
  if (candidates.length === 0) {
    for (const cat of (menu || [])) {
      if (cat.visible === false) continue;
      if ((cat.type || '').toLowerCase() === 'pizzas') continue;
      const items = (cat.items || []).filter(i => i.visible !== false && i.price > 0);
      items.forEach(i => candidates.push({ ...i, _catType: cat.type || '' }));
      for (const sub of (cat.subcategories || [])) {
        if (sub.visible === false) continue;
        const subItems = (sub.items || []).filter(i => i.visible !== false && i.price > 0);
        subItems.forEach(i => candidates.push({ ...i, _catType: cat.type || '' }));
      }
    }
  }

  return candidates.length ? pick(candidates) : null;
}

// ── Cria e roda um garçom ─────────────────────────────────────────────────────
function createWaiter(index) {
  const name  = `Garcom_Fogo_${String(index + 1).padStart(2, '0')}`;
  const cpf   = `000.000.${String(index).padStart(3, '0')}-99`;
  const phone = `11987${String(600000 + index).padStart(6, '0')}`;

  return new Promise((resolve) => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 15000,
    });

    let menuData  = [];
    let ordersData = [];
    let tablesData = [];
    let active  = false;
    let stopped = false;

    socket.on('connect', () => {
      logEvent(name, `Conectado — ${socket.id}`);
    });

    socket.on('connect_error', (err) => {
      metrics.errors.push(`Erro de conexão: ${err.message}`);
      logEvent(name, `⛔ connect_error: ${err.message}`);
    });

    socket.on('init_data', (data) => {
      if (data.menu)   menuData   = data.menu;
      if (data.orders) ordersData = data.orders;
      if (data.tables) tablesData = data.tables;

      socket.emit('waiter_register', { name, cpf, phone, password: 'teste123' });
      metrics.registered++;
      logEvent(name, `📋 Cadastro enviado — aguardando aprovação ADM`);
    });

    socket.on('update_menu',   (m) => { menuData   = m; });
    socket.on('update_orders', (o) => { ordersData = o; });
    socket.on('update_tables', (t) => { tablesData = t; });

    socket.on('waiter_approved', ({ status }) => {
      if (status === 'approved' && !active) {
        active = true;
        metrics.approved++;
        logEvent(name, `✅ Aprovado — iniciando lançamentos`);
        runOrders();
      }
    });

    socket.on('waiter_status_changed', ({ status }) => {
      if ((status === 'inactive' || status === 'inactivated') && !stopped) {
        stopped = true;
        metrics.inactivated++;
        logEvent(name, `🛑 Inativado — encerrando`);
        socket.disconnect();
        resolve();
        activeCount--;
        if (activeCount <= 0) {
          logEvent('SISTEMA', 'Todos os garçons encerrados.');
          printReport();
        }
      }
    });

    socket.on('error_message', (msg) => {
      metrics.errors.push(`server_error: ${msg}`);
      logEvent(name, `⚠️  Mensagem do servidor: ${msg}`);
    });

    async function runOrders() {
      while (!stopped) {
        await sleep(rand(MIN_DELAY_MS, MAX_DELAY_MS));
        if (stopped) break;

        const tableId = rand(1, MAX_TABLES);
        const tableRow = tablesData.find(t => t.id === tableId);
        const isOccupied = tableRow && tableRow.status !== 'free';

        const item = pickMenuItem(menuData);
        if (!item) {
          metrics.errors.push('Cardápio sem itens em Lanches/Bebidas');
          await sleep(2000);
          continue;
        }

        const qty = rand(1, 3);
        const cartItem = {
          id: randomUUID(),
          menuItemId: item.id,
          name: item.name,
          type: item._catType || 'lanches',
          flavors: [item.name],
          size: 'U',
          extras: [],
          observations: '',
          price: item.price * qty,
          quantity: qty,
        };

        metrics.ordersAttempted++;
        const t0 = Date.now();

        if (!isOccupied) {
          doEmit('new_order', { tableId, isComanda: false, items: [cartItem], observations: '', waiterName: name }, t0);
        } else {
          const activeOrder = ordersData.find(o =>
            String(o.tableId) === String(tableId) && o.status !== 'finalizada'
          );
          if (activeOrder) {
            doEmit('add_item_to_order', { orderId: activeOrder.id, item: { ...cartItem, waiterName: name } }, t0);
          } else {
            doEmit('new_order', { tableId, isComanda: false, items: [cartItem], observations: '', waiterName: name }, t0);
          }
        }
      }
    }

    // Fire-and-forget com medição por evento update_orders/tables
    function doEmit(event, data, t0) {
      socket.emit(event, data);

      // Aguarda o broadcast de confirmação (ou timeout de 5s)
      let settled = false;
      const settle = (ok) => {
        if (settled) return;
        settled = true;
        socket.off('update_orders', onConfirm);
        socket.off('update_tables', onConfirm);
        clearTimeout(tid);
        const lat = Date.now() - t0;
        metrics.latencies.push(lat);
        if (ok) {
          metrics.ordersOk++;
          logEvent(name, `✔  ${event} Mesa ${data.tableId ?? '—'} | ${qty(data)}x ${itemName(data)} | ${lat}ms`);
        } else {
          metrics.ordersFailed++;
          metrics.errors.push(`Sem confirm. em 5s: ${event}`);
          logEvent(name, `⚠️  Sem confirmação em ${lat}ms — ${event}`);
        }
      };

      const onConfirm = () => settle(true);
      socket.once('update_orders', onConfirm);
      socket.once('update_tables', onConfirm);
      const tid = setTimeout(() => settle(false), 5000);
    }

    function qty(data)      { return (data.items?.[0]?.quantity || data.item?.quantity || 1); }
    function itemName(data) { return (data.items?.[0]?.name || data.item?.name || '?'); }
  });
}

// ── Controle de garçons ativos ────────────────────────────────────────────────
let activeCount = TOTAL_WAITERS;

process.on('SIGINT', () => {
  console.log('\n⚡ Interrompido manualmente — relatório parcial:\n');
  printReport();
});

// ── Inicialização ─────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║          🔥  TESTE DE FOGO — SIS-PDV-FLOW  🔥           ║');
console.log(`║  Servidor : ${SERVER_URL.padEnd(44)}║`);
console.log(`║  Garçons  : ${String(TOTAL_WAITERS).padEnd(44)}║`);
console.log(`║  Mesas    : 1 – ${String(MAX_TABLES).padEnd(41)}║`);
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');
console.log('▶  Conectando os 25 garçons (rampa de 100ms entre cada)…');
console.log('▶  Cada garçom vai aguardar aprovação no painel ADM.');
console.log('▶  Inative cada garçom no ADM para encerrá-lo.');
console.log('▶  Ctrl+C gera relatório parcial a qualquer momento.\n');

(async () => {
  const promises = [];
  for (let i = 0; i < TOTAL_WAITERS; i++) {
    await sleep(100);
    promises.push(createWaiter(i));
  }
  await Promise.all(promises);
})();
