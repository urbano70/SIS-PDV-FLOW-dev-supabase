# Modo Parquinho — plano confirmado

**Regra vigente desde 23/11/2026 às 20:39:** nenhuma melhoria/correção deve limpar dados em deploys. Manter `PDV_TEST_RESET_ON_DEPLOY=false`; as aprovações históricas de limpeza não são permissões futuras. O ajuste ao final deste plano substitui qualquer orientação anterior incompatível.

Implementar na aplicação existente, preservando React/Vite, Express/Socket.IO, autenticação Supabase dos administradores, fluxo de mesas/pagamentos e visual serifado neutro do FechaConta. Hospedagem permanece no Easypanel, uma réplica e sem Zero Downtime. Não inicializar outro projeto nem acessar banco real nos testes.

## Decisões do usuário

Em 16/11/2026, o usuário confirmou: preço definido pelo ADM nas configurações do Modo Parquinho; cobrança por criança, com exatamente um lançamento/unidade por criança; produto canônico Parquinho na categoria Outros quando o módulo estiver ativado. Não inventar preço nem cobrança por tempo. Preço não configurado é null; bloquear lançamentos até existir valor monetário válido configurado. Módulo off por padrão, nome obrigatório configurável; uma mudança de preço afeta somente lançamentos futuros.

## Arquitetura

Configurações parquinhoEnabled, parquinhoChildNameRequired e parquinhoPrice no PizzeriaConfig existente, salvo em config.data por tenant. Produto gerenciado com ID estável parquinho:<tenantId>, nome Parquinho, categoria Outros e origem identificável; sincronizar o catálogo sem duplicar produto nem confundir PLAY KIDS com este módulo.

Operadores têm papel exclusivo playground_operator, cadastro/aprovação compatível com colaboradores e credencial hash em tabela própria parquinho_operators, para não misturar permissões ou IDs dos garçons. QR contém rota e tenant, nunca credencial de administrador; acesso depende de autenticação/aprovação real. Aplicativo próprio /parquinho?tenant=..., conectado a socket exclusivo. Nenhum init_data ou broadcast completo deve alcançar operadores ou conexões não autenticadas; projeção restrita em sala playground:<tenant>. Bloquear chamadas diretas aos outros eventos e APIs privadas. Validar o JWT administrativo com Supabase Auth, não apenas decodificar sub.

Lançamento dedicado parquinho_add_entry envia tableId, childName e requestId; não recebe preço/produto/operador confiáveis do navegador. Resolver preço e produto no servidor, validar módulo, nome, aprovação e caixa/mesa/pedido, impor quantidade 1. Mesma conta da mesa, sem conta paralela. Persistência transacional e chave de idempotência; confirmar sucesso somente depois de gravar, preservar formulário/requestId quando desconectado/sem confirmação. Serializar mutações relacionadas de pedidos/mesas com a rotina de lançamento para evitar sobrescritas concorrentes de snapshots.

Uma nova tabela parquinho_entries mantém identificação do tenant, pedido, item, mesa, produto, criança, operador, horário, início de turno, quantidade/valor original e situação/motivo. Baixa normal não exclui registros. Capturar o shiftStartedAt persistente e restaurá-lo ao reiniciar; filtrar relatório por turno e não pela data de calendário. Auditoria de remoção/cancelamento/pagamento/baixa deve acompanhar as alterações do pedido, inclusive exclusão explícita. Nenhuma tabela nova de turnos ou eventos extra é necessária se o registro existente conservar as informações pedidas.

Operador vê todas as mesas, mas ocupação é calculada somente sobre Parquinho ativo do pedido corrente, ignorando pedidos históricos/finalizados/removidos/cancelados; pagamento parcial ou aguardando_baixa não liberam antes da baixa definitiva. ADM e garçons recebem conta completa e nome da criança; operador recebe somente sua projeção. Produto não deve criar tickets de cozinha nem alterar cálculo/impressão dos demais produtos.

Política histórica, substituída em 23/11/2026 às 20:39: a limpeza era allowlisted por novo build. A regra vigente é preservar dados em todas as atualizações, inclusive na conta de teste original, e manter PDV_TEST_RESET_ON_DEPLOY=false. Não reutilizar autorizações de limpeza de entregas anteriores.

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

Helper src/lib/kitchenStatus.ts compartilha elegibilidade, etapas/rótulos e validações; KitchenItemStatusBadge apresenta Na fila, Em preparo, No forno, Pronto — retirar e Entregue/responsável/horário por item. UI espera ACK e nunca apresenta sucesso desconectada. A orientação antiga de avisar sobre limpeza foi substituída: publicações futuras preservam todos os lançamentos; nenhum reset automático.

## Melhorias solicitadas em 23/11/2026

Trabalhar sobre a main atual do repositório, preservando mudanças posteriores ao Parquinho e o trabalho anterior ainda não integrado. Reutilizar a arquitetura, Supabase, Socket.IO, impressão e identidade visual existentes. Não criar outra aplicação nem alterar hospedagem.

Investigar a mistura de produtos seguindo identificação de estabelecimento, carga inicial, seeds/defaults, persistência e cache. A conta modelo urbano70@gmail.com não deve sincronizar continuamente seu catálogo para outras contas. Uma cópia inicial explícita é diferente de misturar catálogos em cada deploy. Preservar itens cadastrados e não excluir dados reais na investigação.

Aumentar a legibilidade dos indicadores de atalhos no Dashboard sem trocar as teclas ou ações. No painel da conta, manter somente Premium selecionável até nova instrução, sem criar cobrança/assinatura ou migrar dados de usuários por conta própria.

Permitir arrastar produtos entre categorias/subcategorias com persistência por estabelecimento e propagação imediata ao ADM/garçons. Não modificar pedidos históricos, preços, estoque, identidade do item ou o produto reservado do Parquinho fora das regras existentes. Rejeitar alterações sem conexão e preservar dados se a gravação falhar.

Exportação mensal fiscal fundamentada em SEFAZ-MT/Portal NF-e: incluir XMLs e eventos aplicáveis, sem fabricar protocolos ou confundir XML com DANFE. Reutilizar autenticação e filtro mensal; permitir download e inserção do e-mail do contador para envio explicitamente acionado pelo usuário. Usar mecanismo de envio suportado via Supabase, informar dependência de provedor/configuração e não usar e-mail de autenticação para anexos fiscais. Não enviar e-mails reais nem emitir/cancelar notas nos testes.

Reproduzir grupos/campos do PDF RELATORIOCAIXA.pdf em relatório térmico Bematech 80 mm. Usar dados do relatório atual e sinalizar campos indisponíveis, sem inventar valores ou mudar a conciliação. Via de bebidas: copos/gelo/limão em lista, cada informação em uma linha e em negrito; Junto com pedido imediatamente abaixo, também em negrito. Preservar produto/quantidade, pizzas e recibos de cliente.

### Organização do trabalho

Cada melhoria será desenvolvida em uma worktree independente da mesma main, com patch e testes próprios. Uma integração reunirá os patches em src/components/src/pages, helpers src/lib e handlers existentes, mantendo autenticação, persistência e tipagem. Recursos fiscais adicionais ficarão em supabase/functions/migrations se necessários e com instruções explícitas de implantação. Não fazer merge que acione deploy antes de apresentar pendências Supabase/fiscais; pela regra vigente, limpeza em deploy não é permitida.

## Correção de 23/11/2026 — pedido bloqueado na conta nova

O vídeo mostra itens que não entram, pagamento que exibe mensagem local de impressão e botão Forçar liberação sem atualização da mesa. As PKs tenant-scoped e os campos de persistência foram confirmados; não repetir migrações. Os handlers atuais ignoram prontidão ou não aguardam ACK, e auth_error após prontidão é ignorado pelo provider. Corrigir o protocolo comum no aplicativo existente, sem atribuir uma causa runtime única sem logs.

FirebaseProvider deve invalidar autorização/prontidão em erros e reautenticar com barreiras de tenant e conexão. Dashboard/PaymentModal devem bloquear comandos não prontos, abandonar fila silenciosa de closures de itens e aguardar resultado confirmado, mantendo o modal em falha e bloqueando duplo envio. Um helper de comando administra timeout, tenant/conexão e resultado; nunca reenviar pagamento automaticamente após timeout. Servidor deve responder rejeições e sucesso de adição/pagamento/baixa/liberação com ACK após persistência, sem anunciar estado composto confirmado antes de gravar; preservar comportamento de pagamento ADM versus garçom e não criar transações fictícias ou liberar mesa por erro. Preservar idempotência de itens e não modificar impressão fiscal/recibo além da ordem de confirmação. Testes isolados em scripts/server-tests; sem subir servidor com banco de produção.

Estrutura permanece a existente: src/components para provider, Dashboard e modal; src/lib para helper de comandos; server.ts e helpers server para contrato/persistência; scripts/server-tests para fixtures. Nenhuma migração, mudança de hospedagem, limpeza adicional ou configuração de e-mail faz parte deste patch. A correção foi entregue no PR #504; a aprovação de limpeza daquela entrega é histórica e foi revogada para atualizações futuras.

## Regra vigente — preservação dos dados em deploys (23/11/2026, 20:39)

Remover de server.ts a rotina destrutiva de reset por build, seus imports, a chamada na carga e a transformação de pedidos/mesas/sessões em memória. Remover o helper obsoleto. Carregar todos os pedidos persistidos, inclusive históricos e pedidos de Teste de Fogo; limpeza manual explicitamente acionada permanece separada. Manter pagamento/baixa e recuperação idempotente de vínculos inconsistentes do PR #504 sem excluir histórico.

Definir PDV_TEST_RESET_ON_DEPLOY=false como padrão na imagem Docker e no exemplo de ambiente; a proteção principal é a ausência do caminho de reset, mesmo diante de variável antiga true ou marcador/build diferente. Preservar marcadores existentes sem lê-los, sobrescrevê-los ou apagá-los. Não alterar banco, aplicar migration, executar seed/reset real ou abrir uma nova frente de hospedagem. Atualizar os guias distinguindo autorizações históricas da decisão vigente.

Entrega pela branch baseada na main atual, PR e merge; Easypanel executa o deploy automático. Não fazer deploy/restart manual ou monitoramento. Não afirmar alteração da variável do serviço Easypanel sem acesso e evidência; registrar a diferença entre o padrão da imagem e a configuração externa.

## Correção autorizada — logo e autenticação (23/11/2026, 21:06)

Armazenar logos em bucket Supabase específico por estabelecimento, com arquivos imutáveis identificados por conteúdo e somente escrita service-role no servidor. O perfil Auth conservará apenas logo_url curta (URL pública de imagem da marca), nunca imagem Base64. Usar metadata validado do usuário como fonte de identificação/branding; reaplicar nome/logo/contatos no Dashboard e na impressão a partir de perfil confirmado, sem cache global de outra conta ou config antigo ressuscitar logo removida. Preservar configurações de impressoras não relacionadas.

Criar helper server/establishment-profile para validação de perfil/imagem, Storage, migração idempotente de logo legada e atualização Auth. Criar API privada same-origin GET/POST de perfil que deriva tenant do usuário validado; campos editáveis em allowlist, sem alterar email de login, plano, senha ou app_metadata. Arquivo pode ser selecionado no cliente como prévia, mas cache/sucesso somente após persistência confirmada. SVG novo deve ser convertido no browser para raster antes de enviar; servidor aceita apenas formatos raster validados e até 600 KB, limitando dimensão e referência. Não apagar objetos antigos ao trocar/remover logo nesta entrega.

Recuperar sessão legada nos proxies de signin/refresh somente depois de concessão real de credenciais/refresh-token pelo Supabase: guardar a imagem, trocar apenas logo_url no metadata por referência curta, renovar de novo para emitir JWT limpo, preservando demais campos. Nunca confiar em sub decodificado ou criar bypass de token grande. Não precisa nova tabela nem executar SQL destrutivo; bucket é provisionado por servidor com service-role. A recuperação pode ocorrer no próximo login/refresh da nova versão, sem expor senha ou solicitar token em chat.

UserPanel utilizará a API de perfil; App/FirebaseProvider aplicarão perfil confirmado nas fontes de branding e aguardarão ACK em alterações de config. Reutilizar impressão atual e guarda de tenants; evitar sucesso por timer. Estrutura: src/lib/establishmentProfile (contrato/cliente), src/server/establishment-profile (persistência/migração), server.ts (APIs/grants/projeções), UserPanel/App/Dashboard/FirebaseProvider (consumidores). Entregar por PR e merge, sem deploy/restart manual ou monitorar Easypanel. PDV_TEST_RESET_ON_DEPLOY permanece false; envio fiscal segue adiado.

## Reparo da recuperação de logo — 23/11/2026 às 21:35
Investigar somente Auth/Storage/handshake e edição do perfil existente. Recuperar sessão antes de autenticar socket, sem fallback para JWT/Base64 legado. Remoção explícita deve funcionar por concessão validada sem exigir upload da imagem retirada. Manter formulário e dados em falhas, exibir motivo recuperável sem sincronização eterna e sem liberar comandos antes de snapshot autorizado. Mesma estrutura/estilo; nenhum reset, mudança em pedido/pagamento/histórico ou deploy manual.
