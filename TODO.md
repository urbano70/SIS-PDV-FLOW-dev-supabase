# Modo Parquinho — critérios de aceite

**Regra vigente desde 23/11/2026 às 20:39:** melhorias/correções e deploys devem preservar dados de todas as contas, inclusive a conta original de teste. `PDV_TEST_RESET_ON_DEPLOY` permanece desabilitado. As aprovações de limpeza abaixo são somente registros históricos, não permissões futuras.

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
- [x] Política antiga de limpeza antes do merge substituída pela decisão de preservação em 23/11 às 20:39; não solicitar nem reativar limpeza em futuras melhorias.
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

## Correção de 23/11/2026 — pedido da conta nova não libera

- [x] Conta nova: permitir lançar itens e concluir o pedido da mesa pelo fluxo existente; pagamento integral do ADM libera, pagamento parcial e pagamento do garçom mantêm a baixa prevista. Não remover pedidos, pagamentos ou produtos para disfarçar falha.
- [x] Adição, pagamento e Forçar liberação não informam sucesso sem autorização, prontidão e confirmação de persistência do servidor. Se houver falha ou ausência de confirmação, preservar formulário e apresentar erro claro; não imprimir/iniciar efeitos fiscais antes do pagamento confirmado.
- [x] Rejeição de autenticação após conexão pronta invalida prontidão e permite nova autenticação/snapshot seguro; fila de comandos não atravessa contas nem reconexões, nem reproduz pagamento automaticamente.
- [x] Preservar isolamento por estabelecimento, histórico, regras de baixa/Parquinho/KDS e impressões existentes; nenhuma alteração ou teste de escrita no Supabase real, nenhuma nova limpeza de dados. Comparar com baseline TypeScript atual de 31 diagnósticos, build e testes afetados.
- [x] Preparar PR da correção; antes do merge que aciona deploy automático, confirmar o impacto da limpeza de teste para esta nova entrega. Não executar ou monitorar Easypanel; e-mail fiscal continua adiado.

Evidências desta seção: 20 cenários dos handlers reais por extração AST passaram, incluindo pedido finalizado com mesa ocupada, dois tenants/IDs iguais, pagamento ADM/garçom/parcial, retry e falha de persistência. Helpers cliente/provider/barreira, regressões afetadas e SQL em PGlite descartável passaram. Build integrado passou; baseline 31 e atual 31 diagnósticos TypeScript, zero novos, lint ainda com falhas legadas. Revisão independente não encontrou novo bloqueio de código. RPC SQL instalada pelo conector Supabase em 23/11 às 19:27, após aprovação explícita do usuário às 19:26; assinatura, corpo e permissões service_role-only conferidos por metadados, sem invocar a função sobre pedidos. PR #504 preparado e merge autorizado; usuário aceitou a limpeza existente desta entrega às 19:15. Validação autenticada/hardware e confirmação do deploy automático permanecem pendentes; não haverá monitoramento do Easypanel.

## Preservação em atualizações — 23/11/2026 às 20:39

- [x] A partir de agora, atualizações de melhorias/correções não removem pedidos, itens, pagamentos, histórico das mesas ou registros de Parquinho, inclusive da conta de teste original. Deploy, restart, login/F5 e reconexão não acionam reset nem escondem pedidos de Teste de Fogo.
- [x] `PDV_TEST_RESET_ON_DEPLOY` permanece desabilitado: variável ausente, false, true antiga ou valores alternativos e mudança de build/marcador não podem reativar a rotina removida. Padrão da imagem/exemplo false; preservar marcadores antigos sem alterar banco real.
- [x] Manter ações manuais legítimas, pagamento/baixa, histórico, isolamento de tenants e recuperação do PR #504. Validar com fixtures e comparar TypeScript com a main atual; não executar escrita/limpeza em produção.
- [ ] Fazer PR e merge, sem deploy/restart manual nem monitorar Easypanel. Não alegar que a variável externa do serviço foi alterada sem evidência; configuração de e-mail segue adiada.

Evidências: rotina/helper/caminho em memória removidos; 378 cargas reais extraídas por AST com fixtures, 3 tenants/IDs iguais, 7 valores da variável, 3 marcadores, 2 builds e 3 cargas por processo passaram. Falha de leitura preserva visualização e readiness fechado; recuperação de vínculo finalizado mantém histórico/pagamentos. As 14 suítes afetadas passaram, incluindo 20 cenários de fechamento do PR #504; build passou. TypeScript: baseline fresca 31, atual 31, zero novos, exit 2 legado. Sem acesso/escrita no banco real ou painel Easypanel; a variável externa não foi conferida/alterada. Regra registrada no contexto da habilidade reutilizável e guias de implantação.

## Correção de logo/autenticação — 23/11/2026 às 21:06

- [x] Separar logo da autenticação: imagem em Storage/configuração própria por estabelecimento, somente referência curta em user_metadata. Não permitir Base64 novo no token; preservar imagem legada antes de trocar a referência.
- [x] Formulário, Dashboard e impressão leem a mesma logo confirmada por conta; salvar/trocar/remover persiste entre PCs, F5 e reconexão, sem logo antiga/cache ressurgir. Manter nome/contatos e demais campos do perfil; não alterar plano, senha ou email de login.
- [x] Prévia permanece rascunho; gravação/remoção apresentam sucesso somente após persistência, com erro claro e formulário preservado em falha. Tenant autenticado no servidor, sem aceitar tenant arbitrário ou URL/arquivo inválido.
- [ ] Recuperar conta afetada com migração legada idempotente e renovação por grant de login/refresh validado, sem bypass JWT, perda de dados ou pedir segredos no chat. Banco real não será usado para testes; distinguir recuperação preparada de executada na sessão real.
- [x] Preservar pedidos/pagamentos/histórico, guardas recentes, impressão/Parquinho/KDS e PDV_TEST_RESET_ON_DEPLOY=false; validar testes/build/TypeScript com baseline fresca. Fazer PR/merge sem deploy manual nem monitorar Easypanel; e-mail fiscal permanece adiado.

Evidências: build aprovado; 14 suítes essenciais passaram, incluindo 378 cargas reais de preservação, grants/handlers extraídos por AST e SDK real com fetch simulado. TypeScript baseline31/atual31, zero novos. Recuperação legada implementada e testada, mas TESTE01 real permanece intacta até próximo login/refresh da versão publicada. Bucket será criado/configurado somente no primeiro upload/migração válida pelo servidor service-role. Nenhum dado real alterado, sem deploy/restart/monitoramento manual. O teste legado test-auth-role falha também na fonte main por expectativa obsoleta; hardware e sessão real pendentes.

## Reparo após atualização — 23/11/2026 às 21:35
- [x] Abrir Caixa não fica preso indefinidamente em Sincronizando: recuperar sessão/logo, autenticar e receber snapshot correto antes de permitir comandos; falha exibe motivo e opção segura de tentar novamente.
- [x] Permitir editar e remover logo legada ou nova por ação explícita confirmada, sem exigir upload da imagem retirada nem restaurá-la em cache/branding/impressão. Falha preserva formulário, sem sucesso falso.
- [x] Preservar demais dados do perfil, pedidos, pagamentos, histórico e isolamento; manter limpeza por deploy desativada. Validar caminhos afetados e entregar por PR/merge, sem deploy manual.

Evidências: 12 suítes focais passaram (uma chamada inicial usou caminho inexistente; execução corrigida em scripts). Build final aprovado, TypeScript baseline31/atual31, zero novos. Diagnóstico real somente de leitura confirmou refresh-token de12caracteres e logo ainda inline; nenhuma credencial/imagem retornada. Nenhum dado real alterado; recuperação real aguarda publicação/renovação da sessão.
