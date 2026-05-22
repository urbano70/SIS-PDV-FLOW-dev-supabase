# PRD — FechaConta PDV
**Documento de Requisitos de Produto**
Versão 1.0 | Maio 2026

---

## 1. Visão Geral do Produto

**Nome:** FechaConta PDV  
**Descrição:** Sistema de ponto de venda (PDV) para restaurantes e bares, com foco em gestão de mesas, controle de comandas, gestão de estoque e controle de caixa. Opera em tempo real via WebSocket, permitindo que garçons, caixa e administrador atuem simultaneamente sobre os mesmos dados.

**Problema resolvido:** Estabelecimentos que ainda usam papel ou sistemas lentos para anotar pedidos, gerenciar mesas e fechar contas. O FechaConta centraliza tudo em um único painel acessível por qualquer dispositivo na rede local.

**Usuários-alvo:**
- Administrador / dono do estabelecimento
- Garçons (via link de acesso no celular)
- Caixa / operador de PDV

**Premissas:**
- Operação em rede local (LAN) ou servidor VPS com acesso remoto
- Dados em memória RAM no servidor (reiniciar o servidor = perda de dados não finalizados)
- Firebase Firestore como persistência opcional (configurável)
- Sessão única por estabelecimento (arquitetura single-tenant)

---

## 2. Arquitetura Técnica

### Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 |
| Estilo | Tailwind CSS 4 |
| Animações | Framer Motion |
| Backend | Node.js + Express |
| Tempo real | Socket.io (WebSocket) |
| Autenticação | Firebase Auth (Google OAuth) |
| Persistência opcional | Firebase Firestore |
| Build do servidor | esbuild (TypeScript → JavaScript) |
| Deploy | Docker + docker-compose + Caddy (HTTPS automático) |

### Diagrama de Arquitetura

```
[Browser / Celular Garçom]
        |
        | HTTP (Vite dev) ou dist/ (produção)
        |
[React SPA — Dashboard.tsx]
        |
        | Socket.io (ws:// ou wss://)
        |
[Express + Socket.io — server.ts]
        |
        |--- Estado em memória (orders, tables, stock...)
        |
        |--- Firebase Firestore (opcional, via service-account.json)
```

### Modelos de Dados (TypeScript)

```typescript
interface Order {
  id: string;
  tableId: string | null;
  comandaId: string | null;
  waiterId: string;
  items: OrderItem[];
  status: 'aberta' | 'finalizada' | 'cancelada';
  createdAt: string;           // ISO 8601
  discount?: number;
  discountType?: 'percent' | 'value';
  paymentLog?: PaymentLogEntry[];
}

interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  paid?: boolean;              // marcação de item pago
  notes?: string;
}

interface PaymentLogEntry {
  id: string;
  type: 'partial' | 'items';
  value: number;               // valor monetário abatido
  method: string;              // 'dinheiro' | 'cartão' | 'pix' etc.
  timestamp: string;
}

interface Table {
  id: string;
  status: 'livre' | 'ocupada' | 'reservada';
  orderId?: string;
  capacity?: number;
}

interface Comanda {
  id: string;
  status: 'livre' | 'ocupada';
  orderId?: string;
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  quantity: number;            // estoque atual
  minQuantity: number;        // estoque mínimo (alerta)
  unit: string;               // 'un', 'kg', 'L' etc.
}

interface StockLogEntry {
  id: string;
  itemName: string;
  change: number;             // positivo = entrada, negativo = saída
  reason: string;
  timestamp: string;
}

interface CashRegister {
  isOpen: boolean;
  openedAt?: string;
  openedBy?: string;
  initialAmount: number;
  transactions: CashTransaction[];
}

interface Waiter {
  id: string;             // uid Firebase
  name: string;
  email: string;
  role: 'admin' | 'waiter';
  active: boolean;
}
```

---

## 3. Telas e Funcionalidades

### 3.1 Tela de Login (`App.tsx`)

- Título: "Bem-vindo ao FechaConta"
- Botão: "Entrar com Google" (Firebase Auth)
- Após autenticação: verifica se o UID está na lista de garçons cadastrados no servidor
- Se não cadastrado: exibe erro "Usuário não autorizado"
- Se cadastrado: redireciona para Dashboard com papel correto (admin ou waiter)

---

### 3.2 Dashboard Admin (`Dashboard.tsx`)

Painel principal dividido em 3 colunas:

**Coluna 1 — Navegação e Seleção**
- Barra superior: logo FechaConta + nome do usuário + botão logout
- Abas: Mesas | Comandas
- Botão discreto de histórico (ícone de relógio) ao lado das abas
- Grid de mesas: cards coloridos por status (livre=verde, ocupada=vermelho/amarelo)
- Grid de comandas: idem

**Coluna 2 — Painel de Detalhes**
- Quando mesa/comanda selecionada: exibe `OrderDetails`
  - Lista de itens do pedido com quantidade e preço
  - Total, desconto, pendente
  - Botões de ação: Adicionar Item, Pagamento Parcial, Fechar Conta
- Quando histórico ativado: exibe lista de pedidos recentes
  - Cards com: mesa, garçom, itens, total, pendente, status, horário
  - Clique no card abre detalhes daquele pedido

**Coluna 3 — Ações**
- Menu de itens para adicionar ao pedido
- Filtro por categoria
- Campo de busca

---

### 3.3 Aba Cardápio (Admin)

- Lista de categorias + itens do menu
- Cada item: nome, preço, categoria
- Botões: Editar | Remover
- Formulário para adicionar novo item
- Sem controle de estoque nesta aba (estoque fica na aba Estoque)

---

### 3.4 Aba Estoque (Admin)

- Tabela de insumos: nome, categoria, quantidade atual, mínimo, unidade
- Itens com quantidade abaixo do mínimo destacados em vermelho/amarelo
- Campos de quantidade com `onFocus={e => e.target.select()}` (seleciona ao clicar)
- Botão "Salvar":
  - Se nova quantidade > atual: salva direto (entrada de estoque)
  - Se nova quantidade < atual: abre modal de motivo antes de salvar
- Modal de motivo: 4 opções rápidas + campo livre, botão Confirmar desabilitado até selecionar motivo
- Log de movimentações: tabela com data, item, variação, motivo

---

### 3.5 Aba Relatórios (Admin)

- Período selecionável (hoje / semana / mês / personalizado)
- Total de vendas no período
- Ticket médio
- Itens mais vendidos (ranking)
- Movimentações de estoque com motivos
- Exportação: botão "Backup" gera JSON com timestamp no nome (`fechaconta_backup_YYYYMMDD_HHmmss.json`)

---

### 3.6 Aba Configurações (Admin)

- Gestão de garçons: adicionar (por e-mail Google), remover, ativar/desativar
- Link para acesso do garçom (URL da aplicação)
- Controle de caixa: abrir / fechar
- Seed DB: zera todos os pedidos, log de estoque e libera todas as mesas/comandas
- Configurações de mesas: número de mesas, número de comandas

---

### 3.7 Dashboard Garçom (modo waiter)

- Visão simplificada: apenas mesas/comandas atribuídas ou todas
- Pode adicionar itens a pedidos existentes
- Não acessa: relatórios, configurações, estoque, cardápio
- Recebe atualizações em tempo real dos outros garçons

---

## 4. Sistema de Pagamento

### Fluxo Completo

1. Mesa ocupada com pedido aberto
2. Cliente solicita fechamento
3. Garçom/Caixa clica em "Fechar Conta"
4. Sistema exibe total + desconto + pendente
5. Opções de pagamento:
   - **Pagamento total:** seleciona método, confirma → pedido finalizado
   - **Pagamento parcial por valor:** informa valor + método → subtrai do pendente, pedido continua aberto
   - **Pagamento parcial por itens:** marca itens específicos como pagos → pendente recalculado
6. Quando pendente = 0: pedido finalizado automaticamente, mesa liberada

### Fórmula de Cálculo

```
total_pedido = Σ (item.price × item.quantity) × (1 - discount)

pago_parcial = Σ paymentLog[type='partial'].value
              + Σ item.price × item.quantity onde item.paid = true

pendente = total_pedido - pago_parcial
```

### Agrupamento de Mesas (`link_tables`)

Quando duas mesas são agrupadas, o servidor:
1. Move todos os `items` da mesa origem para a mesa destino
2. Move todo o `paymentLog` da mesa origem para a mesa destino
3. Marca o pedido da mesa origem como `finalizada`
4. Libera a mesa origem

Isso garante que pagamentos parciais já realizados na mesa origem são preservados no cálculo do pendente.

---

## 5. Regras de Negócio Globais

| # | Regra |
|---|---|
| R01 | Apenas admin pode: abrir/fechar caixa, gerenciar garçons, acessar relatórios, editar cardápio, editar estoque |
| R02 | Caixa deve estar aberto para adicionar itens a pedidos |
| R03 | Mesa/comanda ocupada não pode ser reutilizada sem fechar o pedido anterior |
| R04 | Pedido com itens pagos parcialmente não pode ser excluído diretamente |
| R05 | Seed DB exige caixa fechado e confirmação explícita |
| R06 | Redução de estoque manual exige motivo preenchido |
| R07 | Log de estoque mantém no máximo 100 registros (LIFO) |
| R08 | Backup exportado em JSON inclui: pedidos, estoque, log de estoque, garçons |
| R09 | Agrupamento de mesas preserva histórico de pagamentos parciais |
| R10 | Status do caixa é verificado no momento de adicionar item (não só no login) |

---

## 6. Eventos Socket.io

### Cliente → Servidor

| Evento | Parâmetros | Descrição |
|---|---|---|
| `authenticate` | `{ uid, token }` | Valida sessão Firebase |
| `get_initial_state` | — | Solicita estado completo do servidor |
| `add_order` | `{ tableId?, comandaId?, waiterId, items }` | Cria novo pedido |
| `add_item_to_order` | `{ orderId, item }` | Adiciona item a pedido existente |
| `remove_item_from_order` | `{ orderId, itemId }` | Remove item do pedido |
| `close_order` | `{ orderId, paymentMethod, discount? }` | Finaliza pedido com pagamento total |
| `partial_payment` | `{ orderId, value, method }` | Registra pagamento parcial por valor |
| `mark_items_paid` | `{ orderId, itemIds }` | Marca itens específicos como pagos |
| `link_tables` | `{ sourceOrderId, targetOrderId }` | Agrupa duas mesas |
| `update_menu_item` | `{ id, name, price, category }` | Edita item do cardápio |
| `add_menu_item` | `{ name, price, category }` | Adiciona item ao cardápio |
| `remove_menu_item` | `{ id }` | Remove item do cardápio |
| `update_stock_item` | `{ menuItemId, quantity, minQuantity, unit, reason? }` | Atualiza estoque |
| `add_waiter` | `{ email }` | Cadastra novo garçom (por e-mail) |
| `remove_waiter` | `{ uid }` | Remove garçom |
| `open_cash_register` | `{ initialAmount }` | Abre caixa |
| `close_cash_register` | — | Fecha caixa |
| `reset_system` | — | Zera pedidos e log de estoque (Seed DB) |

### Servidor → Cliente (broadcasts)

| Evento | Payload | Trigger |
|---|---|---|
| `initial_state` | Estado completo | Após autenticação |
| `update_orders` | `Order[]` | Qualquer mudança em pedidos |
| `update_tables` | `Table[]` | Mudança de status de mesa |
| `update_comandas` | `Comanda[]` | Mudança de status de comanda |
| `update_menu` | `MenuItem[]` | Mudança no cardápio |
| `update_stock` | `MenuItem[]` | Mudança no estoque |
| `update_stock_log` | `StockLogEntry[]` | Nova movimentação de estoque |
| `update_waiters` | `Waiter[]` | Mudança na lista de garçons |
| `update_cash_register` | `CashRegister` | Abertura/fechamento de caixa |
| `error` | `{ message }` | Erros de validação ou permissão |

---

## 7. Configuração de Deploy (Produção)

### Docker Compose (`docker-compose.prod.yml`)

```yaml
services:
  fechaconta:
    build: .
    image: fechaconta:latest
    container_name: fechaconta-app
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - ./firebase-applet-config.json:/app/firebase-applet-config.json:ro
      - ./service-account.json:/app/service-account.json:ro

  caddy:
    image: caddy:2-alpine
    container_name: fechaconta-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - fechaconta

volumes:
  caddy_data:
  caddy_config:
```

### Caddyfile

```
seu-dominio.com {
  reverse_proxy fechaconta:3000
}
```

### Dockerfile (multi-stage)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./server.js
COPY package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["node", "server.js"]
```

### Requisitos de VPS

| Item | Mínimo |
|---|---|
| CPU | 1 vCPU |
| RAM | 1 GB |
| Disco | 10 GB SSD |
| SO | Ubuntu 22.04 LTS |
| Portas | 80 (HTTP), 443 (HTTPS) |
| DNS | Registro A apontando IP do VPS |

---

## 8. Limitações Conhecidas

| # | Limitação | Impacto | Mitigação Futura |
|---|---|---|---|
| L01 | Estado em memória — reiniciar servidor perde dados | Alto | Persistência completa no Firestore |
| L02 | Single-tenant — 1 estabelecimento por instância | Alto para SaaS | Separação por `tenantId` em todos os models |
| L03 | Sem modo offline — depende de conexão ao servidor | Médio | Service Worker + IndexedDB local |
| L04 | Sem impressão de comanda na cozinha | Médio | Integração com impressora térmica (ESC/POS) |
| L05 | Backup apenas manual (botão) | Baixo | Backup automático agendado |
| L06 | Firebase Firestore falha silenciosamente se credenciais ausentes | Baixo | Validação de credenciais no startup |
| L07 | Log de estoque limitado a 100 entradas | Baixo | Paginação ou persistência externa |
| L08 | Sem gestão de múltiplos turnos de caixa | Baixo | Histórico de registros de caixa |
| L09 | Sem NF-e ou integração fiscal | Alto para formalização | Integração com SAT/NF-CE |
| L10 | Sem controle de acesso por mesa (garçom vê todas) | Baixo | Atribuição de mesas por garçom |

---

## 9. Métricas de Uso

### Capacidade Estimada (1 VPS básico, 1 GB RAM)

| Métrica | Valor estimado |
|---|---|
| Conexões simultâneas | ~50 clientes Socket.io |
| Pedidos abertos simultâneos | ~30 mesas/comandas |
| Itens por pedido | Sem limite (prático: ~30) |
| Log de estoque em memória | 100 entradas |
| Eventos por segundo | ~10 (uso normal) |

### KPIs de Negócio

- **Tempo para abrir pedido:** < 10 segundos
- **Latência de sincronização entre dispositivos:** < 200ms (LAN)
- **Disponibilidade alvo (VPS):** 99,5% mensual
- **Tempo de treinamento de garçom:** < 30 minutos

---

## 10. Roadmap Sugerido

### Fase 1 — Estabilização (próximos 30 dias)
- [ ] Persistência completa no Firestore (não apenas auth)
- [ ] Backup automático diário
- [ ] Validação de credenciais Firebase no startup com mensagem clara

### Fase 2 — Funcionalidades Operacionais (30–90 dias)
- [ ] Impressão de comanda na cozinha (WebSocket → impressora térmica)
- [ ] Histórico de caixa por turno
- [ ] Atribuição de mesa por garçom
- [ ] Notificação de estoque baixo (alerta visual em tempo real)

### Fase 3 — Multi-tenancy / SaaS (90–180 dias)
- [ ] Separação de dados por `tenantId`
- [ ] Painel de superadmin para gerenciar estabelecimentos
- [ ] Planos e cobrança
- [ ] Onboarding self-service

---

*Documento gerado em: 22/05/2026*  
*Repositório: https://github.com/urbano70/SISTEMAPDV-FLOW*
