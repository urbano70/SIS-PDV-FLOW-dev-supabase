# Segurança HTTP administrativa e Parquinho

## Regra de identidade

As APIs administrativas não aceitam um UUID de tenant como identidade. Em cada requisição privada, o servidor extrai o token `Authorization: Bearer <access_token>` e chama `db.auth.getUser(access_token)` no Supabase Auth. O `user.id` retornado pelo Auth é a única identidade usada para autorizar o owner e para determinar o tenant.

O helper `src/server/admin-auth.ts` não decodifica JWT, não confia em claims/profile enviados pelo cliente e não reconhece QR UUID, token opaco de operador do Parquinho ou sessão de Socket.IO como administração. Um token forjado, expirado, ausente ou opaco falha fechado. Se o cliente Supabase Auth não estiver disponível (por exemplo, modo PostgreSQL sem Supabase), a API privada responde indisponível em vez de liberar a operação.

## Escopo de tenant

Rotas que recebem `tenantId`/`tenant` no path, body ou query passam esse valor ao helper. O valor é comparado literalmente com o `user.id` confirmado pelo Auth; qualquer tenant diferente retorna `403 TENANT_FORBIDDEN`. Rotas destrutivas não usam mais `default` quando o tenant está ausente.

O transporte legado ainda aceito para compatibilidade é `body.token` em POST e `query.token` em GET. Esses campos são apenas transporte: continuam obrigatoriamente sujeitos ao `getUser` real. Clientes novos devem usar o header Authorization.

## Rotas privadas

- Todos os endpoints `/api/fiscal/*`, incluindo configuração, status, emissão/contingência, cancelamento, inutilização, consulta, reconciliação, notas, DANFE, XML e lote XML.
- `/api/backup/list`, `/api/backup/download/:nome` e `/api/backup/now`; listagem/download exigem owner autenticado em toda requisição mesmo sem tenant na URL.
- `/api/seed`, `/api/seed-menu`, `/api/agent-config` e `/api/fix-tables`.
- `/api/admin/create-waiter`, que usa o UID autenticado como tenant e valida um tenant declarado opcionalmente.

`agent-config` permanece sem segredo no payload. Se a configuração futura contiver segredo, a própria rota já estará protegida por este mesmo guard.

## Rotas públicas preservadas

`/api/health`, `/api/version`, instaladores em `/download/fechaconta-agente.exe` e `/download/install.ps1`, além das rotas de cliente/mesa e sessão pública existentes, não recebem middleware global nem exigência de login. A sessão pública de cliente continua sendo validada pelo token de mesa/comanda mantido no servidor.

O DANFE não é uma rota de cliente: suas páginas usam `src/lib/admin-http.ts` para buscar a sessão Supabase atual e enviar Bearer no header. Links e `window.open` não recebem token na URL, evitando vazamento por histórico, referrer e logs.

## Verificação local

O teste `server-tests/test-admin-http-auth.cjs` usa apenas tokens e UUIDs fictícios com um `getUser` fake: cobre token confirmado, JWT forjado, ausência, token opaco, tenant estrangeiro (`403`) e ausência do cliente Auth (`503`). A compilação do servidor usa o controller real; nenhum banco de produção, SQL, segredo ou submissão fiscal é usado pelo teste.
