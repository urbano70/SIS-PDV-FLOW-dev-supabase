# Modo Parquinho — plano confirmado

Implementar na aplicação existente, preservando React/Vite, Express/Socket.IO, autenticação Supabase dos administradores, fluxo de mesas/pagamentos e visual serifado neutro do FechaConta. Hospedagem permanece no Easypanel, uma réplica e sem Zero Downtime. Não inicializar outro projeto nem acessar banco real nos testes.

## Decisões do usuário

Em 16/11/2026, o usuário confirmou: preço definido pelo ADM nas configurações do Modo Parquinho; cobrança por criança, com exatamente um lançamento/unidade por criança; produto canônico Parquinho na categoria Outros quando o módulo estiver ativado. Não inventar preço nem cobrança por tempo. Preço não configurado é null; bloquear lançamentos até existir valor monetário válido configurado. Módulo off por padrão, nome obrigatório configurável; uma mudança de preço afeta somente lançamentos futuros.

## Arquitetura

Configurações parquinhoEnabled, parquinhoChildNameRequired e parquinhoPrice no PizzeriaConfig existente, salvo em config.data por tenant. Produto gerenciado com ID estável parquinho:<tenantId>, nome Parquinho, categoria Outros e origem identificável; sincronizar o catálogo sem duplicar produto nem confundir PLAY KIDS com este módulo.

Operadores têm papel exclusivo playground_operator, cadastro/aprovação compatível com colaboradores e credencial hash em tabela própria parquinho_operators, para não misturar permissões ou IDs dos garçons. QR contém rota e tenant, nunca credencial de administrador; acesso depende de autenticação/aprovação real. Aplicativo próprio /parquinho?tenant=..., conectado a socket exclusivo. Nenhum init_data ou broadcast completo deve alcançar operadores ou conexões não autenticadas; projeção restrita em sala playground:<tenant>. Bloquear chamadas diretas aos outros eventos e APIs privadas. Validar o JWT administrativo com Supabase Auth, não apenas decodificar sub.

Lançamento dedicado parquinho_add_entry envia tableId, childName e requestId; não recebe preço/produto/operador confiáveis do navegador. Resolver preço e produto no servidor, validar módulo, nome, aprovação e caixa/mesa/pedido, impor quantidade 1. Mesma conta da mesa, sem conta paralela. Persistência transacional e chave de idempotência; confirmar sucesso somente depois de gravar, preservar formulário/requestId quando desconectado/sem confirmação. Serializar mutações relacionadas de pedidos/mesas com a rotina de lançamento para evitar sobrescritas concorrentes de snapshots.

Uma nova tabela parquinho_entries mantém identificação do tenant, pedido, item, mesa, produto, criança, operador, horário, início de turno, quantidade/valor original e situação/motivo. Baixa normal não exclui registros. Capturar o shiftStartedAt persistente e restaurá-lo ao reiniciar; filtrar relatório por turno e não pela data de calendário. Auditoria de remoção/cancelamento/pagamento/baixa deve acompanhar as alterações do pedido, inclusive exclusão explícita. Nenhuma tabela nova de turnos ou eventos extra é necessária se o registro existente conservar as informações pedidas.

Operador vê todas as mesas, mas ocupação é calculada somente sobre Parquinho ativo do pedido corrente, ignorando pedidos históricos/finalizados/removidos/cancelados; pagamento parcial ou aguardando_baixa não liberam antes da baixa definitiva. ADM e garçons recebem conta completa e nome da criança; operador recebe somente sua projeção. Produto não deve criar tickets de cozinha nem alterar cálculo/impressão dos demais produtos.

A limpeza existente de teste continua uma rotina separada, allowlisted, por novo build, sem limpeza ao desativar Parquinho nem novos gatilhos. Se o histórico específico precisar ser limpo para respeitar a política autorizada, usar exclusivamente a mesma rotina e o mesmo marcador/flag; nunca ampliar para outras contas. Antes de uso real, PDV_TEST_RESET_ON_DEPLOY=false.

## Estrutura de projeto e responsabilidades

- src/types.ts: extensões de configuração/item e tipos do Parquinho.
- src/components/Dashboard.tsx: configuração, card QR/aprovação e relatório ADM.
- src/components/PlaygroundTerminal.tsx e auxiliares: login/cadastro e tela limitada, mesma identidade visual e aviso manual de atualização.
- src/App.tsx e WaiterTerminal.tsx: rota do operador e apresentação de criança na conta completa, preservando os fluxos atuais.
- src/server/playground*.ts: validações, projeção, credenciais/sessões e persistência do módulo, dependências injetáveis para testes.
- server.ts: integração, papéis server-side, audiências e proteção contra corridas de pedido/fechamento.
- supabase/migrations/20261116_playground_mode.sql: tabelas/RLS/permissões, índices/idempotência, transação e auditoria necessárias. Migração aditiva compatível com chaves compostas já aplicadas.
- src/db-pg.ts: paridade de acesso PostgreSQL quando necessária, sem mudar o banco utilizado pelo usuário.
- scripts/server-tests: testes isolados com dados fictícios, sem iniciar servidor conectado ao banco real.

## Publicação

Preparar e validar SQL em banco descartável, entregar para execução manual no Supabase e explicar sequência. Desenvolver/testar em branch feat/playground-mode. Não integrar na main nem publicar código dependente da migração antes de o usuário confirmar sua aplicação. Só informar deploy concluído após confirmar frontend e servidor publicados; fluxo autenticado real deve ser conferido em dados de teste pelo usuário.

## Ajuste adicional solicitado — KDS sincronizado

O usuário enviou pasted_content_2.txt durante a implementação, em 16/11/2026, pedindo adicionalmente sincronizar o preparo por item entre KitchenDisplay, WaiterTerminal e detalhes ADM. Reutilizar kitchen_start_item, kitchen_oven_item, kitchen_finish_item e deliver_item; campos kitchenStatus, deliveredAt, deliveredBy e deliveryLog no JSON existente. Não adicionar migração ou novas etapas para o KDS. Reutilizar a configuração kdsEnabled por tenant, preservando restrições legítimas de plano e sem valor fixo sobrescrever escolha do estabelecimento.

Fonte oficial no servidor: validar papéis/tenant/item, persistir antes de confirmar/broadcast, serializar entrega/preparo com a fila de comandos. Garçom aprovado confirma entrega, com responsável e timestamp, uma única vez. Ready não é delivered; eventos tardios não retrocedem entregue nem etapas concluídas. Com KDS off, não exigir preparo; quando on, usar somente os itens/transições das filas existentes (pizzas e lanches, forno apenas pizzas). Parquinho/bebidas e demais itens sem fila não ficam obrigados a essas etapas. Não alterar preço, pagamentos, mesa ou cobranças por efeito da entrega.

Helper src/lib/kitchenStatus.ts compartilha elegibilidade, etapas/rótulos e validações; KitchenItemStatusBadge apresenta Na fila, Em preparo, No forno, Pronto — retirar e Entregue/responsável/horário por item. UI espera ACK e nunca apresenta sucesso desconectada. Antes de publicar, avisar que a limpeza de teste está habilitada e o deploy poderá apagar os lançamentos da conta allowlisted; nenhum reset adicional.

## Melhorias solicitadas em 23/11/2026

Trabalhar sobre a main atual do repositório, preservando mudanças posteriores ao Parquinho e o trabalho anterior ainda não integrado. Reutilizar a arquitetura, Supabase, Socket.IO, impressão e identidade visual existentes. Não criar outra aplicação nem alterar hospedagem.

Investigar a mistura de produtos seguindo identificação de estabelecimento, carga inicial, seeds/defaults, persistência e cache. A conta modelo urbano70@gmail.com não deve sincronizar continuamente seu catálogo para outras contas. Uma cópia inicial explícita é diferente de misturar catálogos em cada deploy. Preservar itens cadastrados e não excluir dados reais na investigação.

Aumentar a legibilidade dos indicadores de atalhos no Dashboard sem trocar as teclas ou ações. No painel da conta, manter somente Premium selecionável até nova instrução, sem criar cobrança/assinatura ou migrar dados de usuários por conta própria.

Permitir arrastar produtos entre categorias/subcategorias com persistência por estabelecimento e propagação imediata ao ADM/garçons. Não modificar pedidos históricos, preços, estoque, identidade do item ou o produto reservado do Parquinho fora das regras existentes. Rejeitar alterações sem conexão e preservar dados se a gravação falhar.

Exportação mensal fiscal fundamentada em SEFAZ-MT/Portal NF-e: incluir XMLs e eventos aplicáveis, sem fabricar protocolos ou confundir XML com DANFE. Reutilizar autenticação e filtro mensal; permitir download e inserção do e-mail do contador para envio explicitamente acionado pelo usuário. Usar mecanismo de envio suportado via Supabase, informar dependência de provedor/configuração e não usar e-mail de autenticação para anexos fiscais. Não enviar e-mails reais nem emitir/cancelar notas nos testes.

Reproduzir grupos/campos do PDF RELATORIOCAIXA.pdf em relatório térmico Bematech 80 mm. Usar dados do relatório atual e sinalizar campos indisponíveis, sem inventar valores ou mudar a conciliação. Via de bebidas: copos/gelo/limão em lista, cada informação em uma linha e em negrito; Junto com pedido imediatamente abaixo, também em negrito. Preservar produto/quantidade, pizzas e recibos de cliente.

### Organização do trabalho

Cada melhoria será desenvolvida em uma worktree independente da mesma main, com patch e testes próprios. Uma integração reunirá os patches em src/components/src/pages, helpers src/lib e handlers existentes, mantendo autenticação, persistência e tipagem. Recursos fiscais adicionais ficarão em supabase/functions/migrations se necessários e com instruções explícitas de implantação. Não fazer merge que acione deploy antes de apresentar pendências Supabase/fiscais e avisar sobre a limpeza de teste existente.

## Correção de 23/11/2026 — pedido bloqueado na conta nova

O vídeo mostra itens que não entram, pagamento que exibe mensagem local de impressão e botão Forçar liberação sem atualização da mesa. As PKs tenant-scoped e os campos de persistência foram confirmados; não repetir migrações. Os handlers atuais ignoram prontidão ou não aguardam ACK, e auth_error após prontidão é ignorado pelo provider. Corrigir o protocolo comum no aplicativo existente, sem atribuir uma causa runtime única sem logs.

FirebaseProvider deve invalidar autorização/prontidão em erros e reautenticar com barreiras de tenant e conexão. Dashboard/PaymentModal devem bloquear comandos não prontos, abandonar fila silenciosa de closures de itens e aguardar resultado confirmado, mantendo o modal em falha e bloqueando duplo envio. Um helper de comando administra timeout, tenant/conexão e resultado; nunca reenviar pagamento automaticamente após timeout. Servidor deve responder rejeições e sucesso de adição/pagamento/baixa/liberação com ACK após persistência, sem anunciar estado composto confirmado antes de gravar; preservar comportamento de pagamento ADM versus garçom e não criar transações fictícias ou liberar mesa por erro. Preservar idempotência de itens e não modificar impressão fiscal/recibo além da ordem de confirmação. Testes isolados em scripts/server-tests; sem subir servidor com banco de produção.

Estrutura permanece a existente: src/components para provider, Dashboard e modal; src/lib para helper de comandos; server.ts e helpers server para contrato/persistência; scripts/server-tests para fixtures. Nenhuma migração, mudança de hospedagem, limpeza adicional ou configuração de e-mail faz parte deste patch. A publicação continuará por PR/merge autorizado e Easypanel automático, com decisão explícita sobre eventual limpeza de teste desta nova entrega.
