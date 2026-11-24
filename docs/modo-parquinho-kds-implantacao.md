# Modo Parquinho e KDS — ordem de implantação

## Status

**Atualização de política em 23/11/2026 às 20:39:** a limpeza automática em deploys foi revogada e removida do código. Autorizações antigas não se aplicam às próximas publicações. Este guia mantém os registros da implantação original; para novas entregas, preservar todos os dados e não repetir migrações já confirmadas.

O código foi implementado e validado localmente no repositório existente. A execução da migração no seu Supabase ainda precisa ser confirmada. O PR permanece separado da `main`: este guia não significa que as melhorias já estejam rodando no Easypanel.

## O que foi implementado

**Parquinho:** configuração por estabelecimento em Configurações → Salão, valor informado pelo ADM, nome da criança obrigatório ou opcional, produto gerenciado em Outros e um lançamento de quantidade 1 por criança. O preço começa não configurado; não há preço inventado nem cobrança por tempo. Alterar o valor afeta apenas novos lançamentos. Desativar o módulo bloqueia novos lançamentos, sem apagar o histórico.

O card Operador de Parquinho, na aba Garçom, fornece QR Code para o estabelecimento. Cadastro depende da aprovação do ADM. O operador utiliza uma conexão própria e recebe somente mesas e lançamentos de Parquinho; não recebe os demais produtos nem permissões para pagar, dar baixa ou administrar. Os lançamentos integram a conta normal, com criança e operador identificados. O relatório do ADM usa o turno de atendimento, inclusive após a meia-noite, e mantém a situação do lançamento após a baixa.

**KDS:** indicadores individuais de Na fila, Em preparo, No forno e Pronto — retirar reutilizam o fluxo existente. A etapa de forno só se aplica a pizzas. Pronto não significa entregue: a ação de entrega registra responsável e horário, exige confirmação do servidor e protege contra confirmação dupla ou evento atrasado. Pagamento não é entrega física. Parquinho e produtos fora das filas existentes não são obrigados a passar pelo KDS. Com KDS desativado, não é exigido preparo para usar o fluxo de entrega existente.

## Sequência segura

1. Faça backup/exportação do Supabase e pause lançamentos enquanto executar a migração. Ela é aditiva, mas restringe o acesso direto às tabelas privadas: o PDV usa o servidor autenticado. Não execute scripts `test-*` no banco real.
2. No SQL Editor, execute somente `ativar-modo-parquinho-supabase.sql` e confirme o resultado. O arquivo é a mesma migração validada no banco descartável, sem alteração posterior. Não faça merge/deploy enquanto este passo estiver pendente.
3. Antes de liberar o merge, confira que o serviço PDV continua com **uma réplica e Zero Downtime desativado**, como configurado na implantação anterior. Leia o aviso de limpeza abaixo. Só então integre o PR na `main`, acionando o deploy automático configurado no Easypanel.
4. Aguarde a compilação e o deploy concluírem. Compare a identificação do build em `/api/version` e no rodapé do Dashboard. Merge no GitHub não comprova publicação concluída.
5. Reabra o Dashboard com Ctrl + Shift + R. Configure o valor, a obrigatoriedade do nome e ative o Modo Parquinho. Use o QR Code para cadastrar operadores e aprove-os no painel ADM. O lançamento de criança é feito pelo aplicativo do operador, não pelo lançamento manual de produtos genéricos.
6. Se o agente de impressão aparecer aguardando pareamento, use o pareamento já disponível no Dashboard. Um agente anônimo não pode se vincular a uma conta apenas por informar seu identificador; não forneça credenciais ADM ao operador.
7. Valide na sua sessão com dados de teste: dois operadores na mesma mesa, duas crianças diferentes, F5/reconexão, conta completa no ADM/garçom, pagamento/baixa e relatório por turno. Com KDS ativo, teste dois itens em etapas diferentes e entrega simultânea; com KDS desativado, confira que não se exige preparo. A validação autenticada no seu ambiente continua pendente.

## Preservação de dados — regra vigente

A rotina antiga de limpeza por build e seu caminho na carga foram removidos. Novos deploys devem preservar pedidos e histórico de todas as contas, inclusive a conta de teste original e os registros de Parquinho. Um valor true antigo da variável não reativa a rotina removida.

Desativar o Parquinho, F5, login, reconexão, reinício ou publicação não devem apagar registros. A baixa normal conserva o histórico necessário ao relatório. A exceção autorizada anteriormente foi revogada em 23/11 às 20:39.

Manter no ambiente do serviço PDV no Easypanel, desde agora:

```env
PDV_TEST_RESET_ON_DEPLOY=false
```

O padrão da imagem Docker é false; a ausência da rotina protege a nova versão mesmo sem alteração no painel. A variável externa do Easypanel não foi conferida/alterada nesta entrega. Manter false também protege contra retorno a versões antigas. Não há SQL de limpeza ou migração nova para executar.

## Testes e limites

A migração passou em **16 cenários em PostgreSQL descartável em memória**, incluindo idempotência, preço/nome, aprovação, isolamento, conta normal, mesas vinculadas, baixa, remoção/cancelamento, turno após meia-noite e restrição de acesso direto. Nenhum Supabase real foi usado nos testes.

As suítes isoladas cobriram handlers de Parquinho/KDS, autorização ADM e garçom, duas entregas concorrentes, falha de gravação, produto reservado, estado de múltiplos caixas, preservação de turno, cliente HTTP autenticado, filas de persistência, reconexão, impressão, fechamento e atualização manual. Foram corrigidas falhas de integração encontradas na revisão independente.

A compilação de frontend e servidor passou. A checagem TypeScript continua com os **13 diagnósticos legados da linha de base**, sem novos diagnósticos desta implementação. Isso não equivale a declarar toda a aplicação livre de erros.

Não foram executados login real de operador, pagamento real, emissão/cancelamento fiscal, impressão em hardware, alteração de cadastros ou teste de cobrança na sua conta. A confirmação operacional no seu Easypanel e nos seus dispositivos será feita depois da publicação autorizada.
