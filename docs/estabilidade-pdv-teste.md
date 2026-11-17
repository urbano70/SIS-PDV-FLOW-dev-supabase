# Estabilização do PDV — modo de teste

## Ordem de implantação

1. Pausar os lançamentos durante a manutenção e preservar um backup do banco.
2. Aplicar **somente** `supabase/migrations/20261116_tenant_scoped_primary_keys.sql` no SQL Editor do Supabase. Verificar `PRIMARY KEY (tenant_id, id)` em `orders`, `tables` e `comandas`.
3. Integrar o PR de estabilização somente após a confirmação da migração. O código usa `onConflict: 'tenant_id,id'` e exige essas chaves.
4. No Easypanel, usar **uma única instância/réplica** do servidor e evitar sobreposição de servidores antigos e novos enquanto o modo de limpeza de teste estiver ativo. As filas e o estado de atendimento são por processo; esta entrega não implementa coordenação distribuída.
5. Aguardar o deploy terminar; reabrir o PDV com uma atualização completa uma vez para abandonar a versão antiga em cache.
6. Conferir o identificador `Versão <8 caracteres>` no rodapé com os primeiros oito caracteres de `buildId` em `/api/version`.

A migração muda apenas as chaves, não apaga dados. Se detectar chave estrangeira dependente, índice único incompatível ou outro erro, ela aborta a transação. Não retirar as verificações nem adicionar `CASCADE`.

No Easypanel, o painel **Advanced → Deploy** reúne as opções de réplicas e zero-downtime, conforme a [documentação oficial](https://easypanel.io/docs/services/app#deploy-settings). Para esta etapa: **Replicas = 1** e **Zero-downtime deployments desativado**. Salvar uma configuração não necessariamente a aplica ao serviço; seguir a confirmação do painel e coordenar a implantação, sem encerrar lançamentos em andamento.

## Limpeza de teste autorizada

A autorização de 16/11/2026 restringe a limpeza ao estabelecimento `c5c88a54-4bcc-477d-aa8e-d095423484d6`.

No primeiro carregamento desse estabelecimento em uma **nova compilação publicada**, antes de aceitar ações ou enviar o snapshot inicial, o servidor remove pedidos de mesa, incluindo seus itens e registros internos de pagamento/entrega, e libera as mesas. Pedidos históricos de mesa também são removidos. Pedidos de comandas são preservados.

São preservados cadastros, cardápio, usuários, garçons, estoque, documentos fiscais, relatórios de caixa, configurações e outros estabelecimentos. A rotina não usa `/api/seed` nem o reset geral do sistema.

O marcador fica no registro de configuração separado `<tenantId>:test_table_reset`. Abrir/fechar o caixa e atualizar contadores não o sobrescreve. F5, login, reconexão e reinício do mesmo bundle não acionam outra limpeza.

**Antes de usar dados reais**, definir `PDV_TEST_RESET_ON_DEPLOY=false` no ambiente do Easypanel. A limpeza está habilitada por padrão apenas para o UUID autorizado; nenhum outro estabelecimento é elegível.

As operações REST de limpeza são sequenciais, não uma transação distribuída. Em falha, o servidor não grava o marcador nem libera a carga desse estabelecimento; a limpeza idempotente pode ser repetida antes de aceitar novos lançamentos. Não se deve usar múltiplos servidores concorrentes para esse modo.

## Proteção dos lançamentos e da tela

- Identificação ocorre antes da carga inicial; snapshots de outro estabelecimento, pré-autenticação ou de uma conexão antiga não substituem o estado válido.
- Reconexões preservam a última visualização enquanto aguardam o snapshot correto. Um snapshot vazio legítimo da limpeza substitui o cache; itens antigos não são mesclados de volta.
- Escritas usam cópias dos dados e filas por estabelecimento/registro. A carga aguarda escritas pendentes para não aplicar uma leitura anterior aos últimos itens.
- Lançamentos no Dashboard e no terminal do garçom são recusados enquanto a conexão não estiver sincronizada, sem limpar formulário/carrinho nem informar sucesso falso.
- Trocar de tela remove apenas os callbacks daquela tela, não os listeners do provider compartilhado.
- O aviso de nova versão é pequeno, não tem contagem regressiva e não recarrega automaticamente. “Mais tarde” lembra o adiamento da mesma versão na sessão da aba.
- O layout calcula a altura útil considerando o zoom; listas rolam internamente sem cortar os totais. O fluxo de pagamentos/baixa e a impressão de pizzas são preservados.

## Testes isolados

Nenhum dos testes abaixo deve iniciar o servidor usando credenciais reais:

```bash
node server-tests/test-persistence-races.cjs
node server-tests/test-server-race-flows.cjs
node server-tests/test-table-reset.cjs
npx tsx scripts/test-firebase-sync.ts
node scripts/test-client-connection-guards.cjs
node scripts/test-app-update.cjs
node scripts/test-close-table-sync.cjs
node scripts/test-pizza-kitchen-print.cjs
```

Os testes de navegador usam Playwright opcional indicado por `PLAYWRIGHT_MODULE_PATH`, Chromium por `CHROMIUM_PATH` e evidências locais em `.test-artifacts` ou diretório informado. Não clicam em ações financeiras reais.

O runner SQL `scripts/test-tenant-scoped-primary-keys.mjs` usa apenas PostgreSQL-WASM descartável, com a dependência opcional indicada por `PGLITE_MODULE_PATH`. **Nunca executar a fixture `scripts/test-tenant-scoped-primary-keys.sql` no banco real:** ela recria tabelas de teste. O único arquivo entregue para o SQL Editor real é a migração de `supabase/migrations`.

A compilação é validada separadamente da checagem de tipos. A linha de base tinha 14 diagnósticos TypeScript; a validação final ficou com 13 preexistentes e nenhum novo. A revisão geral dessas pendências não faz parte desta entrega e a checagem de tipos não deve ser apresentada como totalmente limpa. Esta entrega também não equivale a uma auditoria completa de segurança/autorização da aplicação.
