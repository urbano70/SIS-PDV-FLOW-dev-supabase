# Modo Parquinho — critérios de aceite

Os itens concluídos correspondem à implementação e às evidências isoladas, não à publicação ou à validação na conta real. A migração, o merge/deploy e a confirmação autenticada do usuário permanecem pendentes.

## Configuração e produto

- [x] Configurações → Salão → Cadastro/Estrutura do Salão: toggle Modo Parquinho off por padrão e configuração Nome da criança obrigatório, opcional/obrigatório no lançamento. Salvar por estabelecimento e sincronizar entre PCs, não apenas localStorage. Desativar impede novos lançamentos sem apagar registros.
- [x] Valor informado nas configurações do Modo Parquinho, sem preço inventado ou cobrança por tempo. Cobrar por criança, exatamente um lançamento/unidade por criança. Sem valor válido configurado, não lançar. Quando ativado, Parquinho é um item da categoria Outros, sem duplicar o produto e sem assumir preço do PLAY KIDS.

## Operador e acesso

- [x] Módulo ativo exibe card Operador de Parquinho na aba Garçom, com QR Code vinculado ao tenant correto. Reutilizar cadastro, identificação, login e aprovação compatíveis, com função/permissão própria distinta do garçom. QR nunca concede acesso administrativo nem a outra conta.
- [x] Aplicativo segue o padrão visual/navegação dos garçons, restrito ao Parquinho. Operador visualiza mesas e somente produto/lançamentos Parquinho, incluindo lançamentos de todos os operadores do mesmo estabelecimento. Não recebe alimentos, bebidas, outros itens nem poderes de pagamento, baixa, cancelamento ou administração não definidos. Garantir a restrição também em eventos/APIs diretos do servidor, não só esconder a UI.

## Lançamento e sincronização

- [x] Selecionar mesa e informar criança; nome obrigatório vazio/só espaços rejeitado no cliente/servidor e nome opcional permite lançamento sem nome. Cada lançamento possui tenant, pedido/mesa, produto, criança quando informada, operador, data/hora, quantidade 1 e valor configurado. Nome pertence ao lançamento, permitindo crianças diferentes na mesa. Servidor valida aprovação, permissões, produto e valor, sem confiar no navegador.
- [x] Recarregar, reconectar e trocar tela não apaga nem duplica lançamentos. Dois operadores veem os mesmos lançamentos. Desconexão mantém formulário e não informa falso sucesso. Idempotência e persistência transacional protegem retry/lançamento simultâneo com alterações da conta.

## Conta e ocupação

- [x] Parquinho integra o pedido normal; ADM/garçons visualizam conta completa, criança e valor somado aos outros produtos pelo fluxo existente, sem duplicar cobranças nem alterar cálculo de outros itens. Operador vê somente Parquinho.
- [x] Mesa ocupada na visão do operador apenas se houver Parquinho ativo no pedido atual. Mesa só com comida/bebida aparece livre nessa visão. Ignorar históricos, removidos, cancelados e finalizados. Baixa/finalização verdadeira libera em todas as telas; pagamento parcial/aguardando baixa não libera antes da conclusão.

## Relatório e isolamento

- [x] Aba Relatórios: Relatório do Parquinho exclusivo ADM, com todos os lançamentos da noite/turno, mesa, horário, operador, criança ou Não informado, quantidade/valor e situação diferenciando removidos/cancelados. Turno atravessa meia-noite; reinício não perde vínculo. Baixa preserva histórico. Respeitar política de limpeza de teste separadamente, sem novos resets automáticos.
- [x] Dados/configurações de estabelecimentos isolados. Desativar módulo não exclui histórico. Fluxos atuais de garçons, cozinha, impressão, pagamentos e fechamento continuam funcionando. Preservar guardas canMutate, listeners e atualização manual sem contagem.

## Entrega

- [ ] SQL aditivo preparado e validado; usuário confirma execução manual antes de publicar dependência. Testar só dados fictícios, sem ações financeiras reais nem alterar contas reais. PR e merge respeitam esse bloqueio. Distinguir GitHub integrado de Easypanel publicado, informar testes e pendências.

## Ajuste adicional — KDS sincronizado

- [x] kdsEnabled oficial por estabelecimento persistido/sincronizado, não sobrescrito indevidamente por cache/valores fixos. Off preserva uso atual sem exigir preparo. Reutilizar KitchenDisplay, WaiterTerminal, Dashboard, kitchen_start_item/oven/finish, deliver_item e campos existentes.
- [x] Status individual por item: Na fila, Em preparo, No forno e Pronto — retirar conforme transições existentes; não inventar etapa nem impor forno a não pizzas. Todos os garçons e ADM veem mudanças em tempo real na mesa/comanda; dois itens podem estar em etapas diferentes. Parquinho não entra no KDS.
- [x] Pronto não é entregue. Apenas confirmação de garçom autorizado/ação existente registra Entregue, responsável/data/hora e propaga sem F5. Duas confirmações simultâneas não duplicam deliveryLog, e KDS atrasado não reverte entregue. Entrega não muda preço, pagamento nem fecha mesa.
- [x] Servidor oficial valida preparo/entrega/tenant/pedido/item, persiste status através de F5/login/reconexão. Desconectado não exibe sucesso sem ACK nem apaga/duplica itens/ressuscita estado antigo. Preservar pedidos, impressão, cobrança, pagamentos e baixa existentes.
- [x] Testar critérios com dados fictícios, informar alterações/testes/pendências e avisar antes da publicação que limpeza de teste existente pode apagar lançamentos da conta autorizada. Nenhuma limpeza adicional.

## Pendências de implantação

- [ ] Confirmar execução da migração aditiva no Supabase.
- [ ] Avisar sobre a limpeza existente de teste antes do merge que aciona o deploy; confirmar configuração do Easypanel conforme o guia.
- [ ] Confirmar publicação pelo identificador de build de servidor/frontend, sem confundir com PR criado.
- [ ] Validar na sessão real dois operadores, KDS, reconexão, impressão e fluxo de pagamento/baixa.

## Melhorias pendentes

- [x] **Sabores de pizza em ordem alfabética**: ordenar a lista de sabores (pizza_flavors) em ordem alfabética na tela de seleção do garçom/operador.

## Evidências

Migração: 16 cenários SQL em banco descartável. Handlers, controles de permissão, catálogo reservado, turno/múltiplos caixas, HTTP, persistência, conexão, impressão, fechamento e atualização manual passaram nas suítes isoladas. Build passou; 13 diagnósticos TypeScript da linha de base, sem novos. Revisão independente concluída e bloqueios confirmados corrigidos. Não foram realizados pagamentos, emissão/cancelamento fiscal, login de operador ou impressão em hardware reais.

## Melhorias de 23/11/2026

- [x] Corrigir mistura de catálogo: usuário novo criado com modelo urbano70@gmail.com não recebe produtos de outras contas a cada melhoria/deploy. Investigar seed, cache, chave de persistência e identificador; preservar cadastro legítimo, sem apagar dados reais durante testes.
  - Status: código integrado e testes fictícios de dois tenants, restart/deploy, catálogo vazio, IDs iguais, tenant incorreto e falha de leitura passaram. Migração validada em PostgreSQL descartável com preservação/rollback; usuário confirmou aplicação no Supabase sem erros em 23/11. Produtos já misturados não foram excluídos ou reconciliados.
- [x] Dashboard: rótulos das teclas de atalho já configuradas ficam mais visíveis e um pouco maiores; preservar teclas, ações e responsividade.
  - Status: helper e foco visível integrados; teste estático e fixture visual isolada passaram. Publicação e conferência na sessão real continuam pendentes.
- [ ] Fiscal: verificar fontes oficiais SEFAZ-MT sobre XMLs autorizados/cancelados e eventos; filtro mês/ano gera ZIP correto para contabilidade, permite baixar e inserir e-mail para enviar via mecanismo suportado no Supabase. Envio apenas por ação explícita, autenticado, restrito à conta, sem segredos no browser nem envio real nos testes. Informar dependências e documentos ausentes em vez de fabricar XML.
  - Status: código integrado; testes mensal/fiscal, eventos legados, data oficial e limites passaram. SQL real confirmado pelo usuário sem erros. Esquema conferido sem consultar notas; SELECT corrigido para não exigir dh_recbto inexistente. Edge Function publicada versão 1 ACTIVE, JWT ativo; preflight 204 e POST sem autenticação 401. Ainda pendem `RESEND_API_KEY`, `RESEND_FROM`, domínio e validação operacional do envio. Em 23/11 às 17:26 o usuário decidiu configurar o e-mail depois e autorizou o merge com melhorias/ZIP e envio pendente. Nenhum envio real ocorreu.
- [x] Painel de dados do usuário: até segunda ordem, apenas Premium fica ativo/selecionável; Free/Essencial e outros planos não podem ser selecionados. Não criar cobrança nem assinatura real.
  - Status: política/guard de seleção e semântica disabled no painel passaram no teste; nenhuma cobrança, assinatura ou migração de entitlement foi acionada.
- [x] Itens: arrastar produto para categoria/subcategoria movimenta com persistência e efeito imediato no catálogo de lançamento do Dashboard e dos garçons. Preservar identidade, preços, estoque e pedidos históricos; não duplicar nem atravessar contas, tratar falha/desconexão e produto reservado.
  - Status: operação Socket.IO autenticada, persistência atômica por bulk upsert/transação antes do ACK/broadcast, fronteiras de Pizza/Parquinho e consumidor `update_menu` passaram nos testes. Importação PostgreSQL e nome de borda preservados. Migração do catálogo confirmada pelo usuário sem erros; pende validação autenticada real com ADM/garçom, reconexão e restart.
- [x] Relatório do caixa: imprimir em Bematech 80 mm conforme PDF anexo, incluindo identificação/abertura/fechamento/fundo, meios Computado-Digitado-Diferença, vendas por produto, totais bruto/desconto/líquido/à vista, cartões/classes/vales/usuário quando dados existirem; não inventar informações nem mudar fechamento.
  - Status: modelo compartilhado, snapshot, ESC/POS 80 mm, fallback HTML, fixture e testes passaram. Teste em Bematech/agente físico, acentos CP850, corte e alinhamento reais permanecem pendentes.
- [x] Via de bebidas: copos com gelo/limão em lista com uma informação por linha e negrito; Junto com pedido imediatamente abaixo, em negrito. Preservar descrição/quantidade, outros itens, via de pizza e comprovante do cliente.
  - Status: helper aplicado aos caminhos ESC/POS, Bluetooth e HTML; teste de bebidas e preservação byte-a-byte do recibo passaram. Impressora física e implantação permanecem pendentes; a falha do teste legado de pizza é preexistente e foi preservada.
- [x] Integrar os sete patches sem sobrescrever alterações recentes da main e validar os fluxos anteriores com dados fictícios. Distinguir código, PR/merge e versão publicada; apresentar pendências e avisar sobre limpeza de teste antes do deploy.
  - Status: sete melhorias integradas e revisão corrigida, incluindo compatibilidade do esquema e proteção contra truncamento fiscal. Build final após Supabase passou; lint conserva 31 diagnósticos preexistentes, zero novos contra baseline32. Testes afetados passaram, exceto falha legada de pizza documentada. SQLs e limpeza confirmados; em 23/11 às 17:26 o usuário autorizou publicar com envio de e-mail pendente. PR #503 preparado para merge; confirmar deploy por servidor e frontend. Não foi ampliada nem alterada a limpeza.
