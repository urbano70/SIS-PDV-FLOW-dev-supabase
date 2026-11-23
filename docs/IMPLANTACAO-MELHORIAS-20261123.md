# FechaConta PDV — implantação das melhorias de 23/11/2026

O código está preparado em uma branch de revisão. Ainda não é a versão publicada no Easypanel. Não integrar na main antes de confirmar os scripts do Supabase e as dependências abaixo. O usuário confirmou que utiliza somente lançamentos de teste.

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
2. No SQL Editor do projeto correto, execute primeiro [a migração do catálogo](../supabase/migrations/20261123_menu_catalog_tenant_keys.sql). Ela preserva linhas e aborta se houver tenant ausente, pares duplicados, chave customizada, índice único global extra ou dependência de chave estrangeira. Se falhar, pare e envie a mensagem do erro; não remova bloqueios por conta própria.
3. Execute depois [a migração fiscal](../supabase/migrations/20261123_fiscal_xml_export.sql), que adiciona a data oficial e a tabela de eventos com RLS restrita ao serviço. Não é necessário emitir ou cancelar uma nota para executá-la.
4. Confirme a conclusão dos dois scripts antes do merge. Sem eles, a nova movimentação de produtos e os recursos fiscais dependentes podem falhar.
5. Para ativar o envio, publique supabase/functions/fiscal-xml-email/index.ts no Supabase e configure RESEND_API_KEY e RESEND_FROM nos secrets da função, nunca no frontend. O remetente precisa estar autorizado em domínio verificado no Resend. Não publique com verificação JWT desligada; a função também usa auth: user. As variáveis padrão de runtime são provisionadas pelo Supabase/CLI.[3] [4]
6. Apenas após confirmar dependências e avisar sobre os riscos, o merge na main aciona o deploy automático do Easypanel. Manter a configuração previamente confirmada: uma réplica e Zero Downtime desativado. Confirmar a nova versão no servidor e no cliente; PR criado não significa versão publicada.

Sem a configuração do provedor/função, o envio ao contador não estará operacional. O download do ZIP não depende do Resend, mas depende do banco fiscal preparado. Nenhum e-mail real foi enviado nesta implementação.

## Cuidados com fluxos existentes

A compilação passou. A comparação final encontrou 31 diagnósticos TypeScript preexistentes contra 32 na main de referência, sem novos. Lint continua não limpo; não há garantia de ausência de todo bug legado. O teste antigo da descrição de pizza já falhava na main por divergência de prefixo e não foi alterado. Os testes isolados de bebidas/recibo, caixa, KDS, Parquinho, persistência, sincronização e os casos novos passaram; não houve operação em banco real ou impressora física.

O trabalho anterior de autorização automática do Parquinho permanece separado e não foi aplicado silenciosamente nesta atualização.

A limpeza de teste existente pode apagar os pedidos e o histórico da conta expressamente configurada na rotina ao publicar um novo build. Ela não foi ampliada para produtos, outras contas, F5, login ou reconexão. Antes de atender clientes reais, configurar no Easypanel:

```env
PDV_TEST_RESET_ON_DEPLOY=false
```

Não usar documentos reais para testar envio ao contador sem autorização explícita. Após a publicação autorizada, conferir com lançamentos fictícios: duas contas, produto movido no ADM/garçom, F5/reconexão, pagamento/baixa, relatório e vias físicas.

## Referências

[1]: http://app1.sefaz.mt.gov.br/Sistema/legislacao/legislacaotribut23-04.nsf/07fa81bed2760c6b84256710004d3940/2e3207efa299ebf98425808b006bfc3c?OpenDocument "SEFAZ-MT — guarda do arquivo digital NFC-e e cancelamento por evento"
[2]: https://www.confaz.fazenda.gov.br/legislacao/ajustes/2005/AJ007_05 "CONFAZ — Ajuste SINIEF 07/05"
[3]: https://supabase.com/docs/guides/functions/examples/send-emails "Supabase — envio de e-mails com Edge Functions e Resend"
[4]: https://supabase.com/docs/guides/functions/auth "Supabase — autenticação de Edge Functions e withSupabase"
