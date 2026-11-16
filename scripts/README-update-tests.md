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

## Publicação

Servidor e frontend devem ser publicados juntos, a partir do mesmo `npm run build`. A primeira publicação deste mecanismo pode exigir recarregar manualmente as abas ainda com o código anterior. Um PR aberto ou apenas integrado no GitHub não corresponde a uma versão já publicada no servidor.
