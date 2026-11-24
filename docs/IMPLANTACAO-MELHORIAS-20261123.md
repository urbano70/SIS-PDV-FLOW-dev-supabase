# FechaConta PDV — implantação das melhorias de 23/11/2026

**Regra vigente desde 23/11/2026 às 20:39:** o usuário revogou a limpeza automática para atualizações futuras. A rotina foi removida; todos os pedidos e históricos devem ser preservados, inclusive da conta original de teste. Manter `PDV_TEST_RESET_ON_DEPLOY=false`. As aprovações abaixo documentam apenas a entrega anterior do PR #503, já mergeado; não autorizam nova limpeza nem repetição de SQLs confirmados.

O código está preparado no PR #503 para o merge solicitado. O usuário confirmou em 23/11 que executou os dois scripts do Supabase sem erros e aceitou a limpeza dos pedidos e do histórico de teste neste deploy. Às 17:26, decidiu configurar o envio de e-mail depois, autorizando publicar as melhorias e o download do ZIP com envio pendente. Essas confirmações não precisam ser repetidas. A publicação do PDV no Easypanel deve ser confirmada após o merge.

## O que foi corrigido

A mistura de produtos vinha da reintrodução automática do catálogo empacotado, de uma importação automática no Dashboard e da cópia contínua de sabores, bordas e configurações da conta modelo. Não foi encontrada evidência de que o cache atual entregasse linhas de outra conta. Essas cargas automáticas foram retiradas; catálogo vazio passa a ser respeitado e as operações de cadastro são escopadas pelo estabelecimento. Os produtos que já estavam misturados não foram excluídos: precisam de exportação/backup e identificação segura de procedência antes de qualquer reconciliação.

Os indicadores F2/F4/F8 do Dashboard ganharam tamanho, contraste e foco visível, sem mudar os comandos. Free e Essencial estão indisponíveis para seleção no painel da conta; Premium continua acionável. Isso não cria cobrança nem converte assinaturas existentes.

Produtos podem ser arrastados entre categorias/subcategorias compatíveis. O servidor grava o movimento de forma atômica antes de atualizar ADM/garçons ou confirmar sucesso. Identidade, preço e campos do produto são mantidos; pedidos anteriores não são reclassificados. O produto gerenciado do Parquinho e a estrutura especial de pizzas continuam protegidos contra movimentos incompatíveis.

O relatório do caixa usa o modelo do PDF fornecido, com colunas Computado/Digitado/Diferença, produtos, totais, classes e demais informações disponíveis. Os builders ESC/POS e HTML compartilham o modelo térmico de 80 mm. Campos que o sistema não coletava aparecem como N/D, em vez de dados inventados. Acentos, área imprimível e corte devem ser conferidos na Bematech física. As vias de bebidas listam as informações dos copos em linhas separadas e negrito; Junto com pedido vem imediatamente abaixo, também em negrito.

## XMLs para contabilidade

O pacote inclui os documentos autorizados disponíveis, inclusive os de notas posteriormente canceladas, e os eventos de cancelamento arquivados. Um cancelamento no mês selecionado pode levar também o documento original de um mês anterior. Produção e homologação são identificadas separadamente. XMLs ou eventos não armazenados são apontados no manifesto; não há reconstrução de protocolos ou documentos.

A norma da SEFAZ-MT exige guarda do arquivo digital e trata o cancelamento como evento com protocolo. O e-mail mensal ao contador é uma facilidade adicional: não substitui essa guarda nem é apresentado como obrigação geral de envio por e-mail. Confirme com seu contador documentos adicionais da escrituração.[1] [2]

A autorização fiscal utiliza a data oficial do retorno quando disponível. A migração não transforma created_at em autorização, especialmente em contingência pendente. Registros históricos sem data oficial continuam com o fallback de exportação, sem alterar a data existente.

O Supabase executa a função fiscal-xml-email; o envio de anexos usa Resend conforme a integração documentada. O SMTP de autenticação do Supabase não foi usado para enviar ZIPs fiscais.[3] A função exige sessão válida, deriva a conta do usuário autenticado e filtra os documentos dessa conta; o navegador não envia chaves de serviço nem anexos arbitrários.[4]

## Antes de publicar

1. Faça backup/exportação do projeto Supabase. Evite novos lançamentos ou alterações de cadastro durante a aplicação dos scripts e a atualização. Não use scripts que atribuam dados desconhecidos à conta modelo.
2. [Migração do catálogo](../supabase/migrations/20261123_menu_catalog_tenant_keys.sql): execução sem erros confirmada pelo usuário. Não executar novamente nesta implantação.
3. [Migração fiscal](../supabase/migrations/20261123_fiscal_xml_export.sql): execução sem erros confirmada pelo usuário. A inspeção dos nomes e tipos de colunas confirmou a data oficial e a tabela de eventos no projeto ativo plataforma_fechaconta, sem ler documentos fiscais. Não executar novamente.
4. Os scripts, a limpeza e a publicação com envio pendente foram autorizados. Não solicitar nova aprovação desses pontos.
5. A função fiscal-xml-email foi publicada no Supabase em 23/11 às 17:26: versão 1, status ACTIVE e verify_jwt=true. Preflight público respondeu 204 e POST sem autenticação foi rejeitado com 401; não foram consultadas notas. Para ativar o envio depois, configure RESEND_API_KEY e RESEND_FROM nos secrets da função, nunca no frontend. O remetente precisa estar autorizado em domínio verificado no Resend. Manter verificação JWT ativa e auth: user.[3] [4]
6. Apenas após confirmar dependências e avisar sobre os riscos, o merge na main aciona o deploy automático do Easypanel. Manter a configuração previamente confirmada: uma réplica e Zero Downtime desativado. Confirmar a nova versão no servidor e no cliente; PR criado não significa versão publicada.

O envio ao contador permanece pendente por decisão do usuário, que configurará o serviço depois. O download do ZIP não depende do Resend e o banco fiscal já foi preparado. Nenhuma ativação de acesso ao Resend ocorreu nesta tarefa; nenhuma mensagem real foi enviada. O código foi ajustado à ausência da coluna dh_recbto no banco real e recusa exportações que ultrapassem o limite de leitura de 10.000 registros, sem gerar ou enviar um pacote silenciosamente incompleto.

## Cuidados com fluxos existentes

A compilação passou. A comparação final encontrou 31 diagnósticos TypeScript preexistentes contra 32 na main de referência, sem novos. Lint continua não limpo; não há garantia de ausência de todo bug legado. O teste antigo da descrição de pizza já falhava na main por divergência de prefixo e não foi alterado. Os testes isolados de bebidas/recibo, caixa, KDS, Parquinho, persistência, sincronização e os casos novos passaram. No Supabase real houve somente leitura do esquema; os testes não leram notas, não alteraram registros e não usaram impressora física.

O trabalho anterior de autorização automática do Parquinho permanece separado e não foi aplicado silenciosamente nesta atualização.

A limpeza por build foi removida pela decisão de 23/11 às 20:39. Na nova versão, deploy, reinício, F5, login e reconexão preservam pedidos e histórico, mesmo se ainda existir uma variável externa true. Marcadores antigos são mantidos sem leitura/escrita pela carga. O padrão da imagem Docker é false; manter também no Easypanel:

```env
PDV_TEST_RESET_ON_DEPLOY=false
```

Esta alteração de código não comprova que o ambiente externo do serviço tenha sido editado. Conservar false também evita reativação ao retornar a um bundle antigo. Nenhum dado excluído anteriormente é recuperado automaticamente por este patch.

Não usar documentos reais para testar envio ao contador sem autorização explícita. Após a publicação autorizada, conferir com lançamentos fictícios: duas contas, produto movido no ADM/garçom, F5/reconexão, pagamento/baixa, relatório e vias físicas.

## Referências

[1]: http://app1.sefaz.mt.gov.br/Sistema/legislacao/legislacaotribut23-04.nsf/07fa81bed2760c6b84256710004d3940/2e3207efa299ebf98425808b006bfc3c?OpenDocument "SEFAZ-MT — guarda do arquivo digital NFC-e e cancelamento por evento"
[2]: https://www.confaz.fazenda.gov.br/legislacao/ajustes/2005/AJ007_05 "CONFAZ — Ajuste SINIEF 07/05"
[3]: https://supabase.com/docs/guides/functions/examples/send-emails "Supabase — envio de e-mails com Edge Functions e Resend"
[4]: https://supabase.com/docs/guides/functions/auth "Supabase — autenticação de Edge Functions e withSupabase"
