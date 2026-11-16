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

## Evidências

Migração: 16 cenários SQL em banco descartável. Handlers, controles de permissão, catálogo reservado, turno/múltiplos caixas, HTTP, persistência, conexão, impressão, fechamento e atualização manual passaram nas suítes isoladas. Build passou; 13 diagnósticos TypeScript da linha de base, sem novos. Revisão independente concluída e bloqueios confirmados corrigidos. Não foram realizados pagamentos, emissão/cancelamento fiscal, login de operador ou impressão em hardware reais.
