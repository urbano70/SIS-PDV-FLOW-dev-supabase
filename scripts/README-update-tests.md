# Testes da atualização manual

A identificação de compilação é compartilhada entre o servidor e o frontend. O aviso consulta a versão publicada pelo Socket.IO; as atualizações da PWA aguardam o clique do usuário. O recarregamento automático por contagem regressiva e o listener global de `controllerchange` foram removidos.

## Teste isolado de lógica

Depois de instalar as dependências do projeto:

```bash
node scripts/test-app-update.cjs
```

O teste não inicia o aplicativo nem acessa banco ou serviços externos. Cobre comparação dos identificadores, instalação/ativação simulada, erros sem recarregamento e as proteções contra atualização automática.

## Simulação visual no navegador

```bash
npm run build
node scripts/test-update-notification-browser.cjs
```

Esse teste opcional requer Playwright e Chromium. Playwright não foi acrescentado às dependências de produção. Para instalá-lo em um diretório separado e usar um Chromium já existente, por exemplo em Linux:

```bash
npm install --prefix /tmp/fechaconta-browser-test --no-save playwright
PLAYWRIGHT_MODULE_PATH=/tmp/fechaconta-browser-test/node_modules/playwright \
CHROMIUM_PATH=/usr/bin/chromium \
node scripts/test-update-notification-browser.cjs
```

Adapte os caminhos ao seu ambiente. Se usar o navegador fornecido pelo Playwright, instale-o conforme o procedimento desse pacote e omita `CHROMIUM_PATH`. `UPDATE_TEST_OUTPUT_DIR` permite escolher onde salvar as evidências; por padrão, elas ficam em `test-results/update-notification`, ignorado pelo Git.

O script serve um ambiente isolado na interface de loopback e usa o componente real, React, DOM e Socket.IO. Confere oito cenários, incluindo a espera real de 35 segundos sem recarregamento, o botão “Mais tarde”, reconexão e recarregamento após “Atualizar agora”.

O registro da PWA é simulado e os service workers reais são bloqueados nesse teste; ele não valida a instalação de uma PWA real nem a implantação. Nenhum banco, variável de ambiente da aplicação ou servidor de produção é carregado. O navegador e o servidor de teste são encerrados ao final.

## Ativação com service worker real

O teste adicional usa APIs reais de registro, instalação e ativação da PWA em Chromium. Exercita diretamente o helper de atualização, sem carregar o aplicativo completo ou acessar dados de produção. Use a mesma instalação separada do Playwright do exemplo anterior:

```bash
PLAYWRIGHT_MODULE_PATH=/tmp/fechaconta-browser-test/node_modules/playwright \
CHROMIUM_PATH=/usr/bin/chromium \
PWA_UPDATE_SOURCE=current \
node scripts/test-pwa-activation-browser.cjs
```

O teste confirma a ativação e um único recarregamento manual, incluindo uma página inicialmente sem controlador. Também verifica duas abas no mesmo contexto de navegador, ativação realizada antes do clique e erro sem recarregamento. As evidências são salvas em `test-results/pwa-activation`; `PWA_UPDATE_OUTPUT_DIR` permite escolher outro destino.

Para reproduzir a mensagem “Não foi possível ativar a atualização. Tente novamente.” no código anterior, execute com `PWA_UPDATE_SOURCE=baseline`. Esse modo exige que o commit `32ce2f0` esteja disponível no histórico Git local. Ele mostra um worker que fica ativo sem emitir `controllerchange` na página inicialmente sem controlador, causando o timeout da lógica antiga. A correção observa o estado real `activated`, sem depender apenas daquele evento.

O teste usa service workers reais em uma aplicação mínima isolada; não monta o componente `UpdateBanner` nem verifica a publicação em produção. Nenhuma das execuções configura ou reinicia o servidor Easypanel.

## Publicação

Servidor e frontend devem ser publicados juntos, a partir do mesmo `npm run build`. A primeira publicação deste mecanismo pode exigir recarregar manualmente as abas ainda com o código anterior. Um PR aberto ou apenas integrado no GitHub não corresponde a uma versão já publicada no servidor.
