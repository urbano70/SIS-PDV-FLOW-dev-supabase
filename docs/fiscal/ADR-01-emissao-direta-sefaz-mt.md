# ADR-01 — Emissão fiscal direta na SEFAZ-MT (sem API intermediária)

**Data:** 2026-11-10  
**Status:** Em implementação  
**Escopo:** Integração fiscal NFC-e (modelo 65) e NF-e (modelo 55)

---

## Contexto

A aplicação PDV SIS-PDV-FLOW atendia restaurantes, pizzarias, bares e lanchonetes no Mato Grosso usando a API DotCompany como intermediário fiscal. O proprietário determinou migração para emissão direta nos Web Services da SEFAZ-MT via certificado A1 próprio de cada estabelecimento.

## Decisão

Emissão direta: o backend Node.js gera, assina e transmite o XML NF-e/NFC-e via SOAP 1.2 com mTLS, sem API intermediária, sem fallback remoto para DotCompany ou outro provedor.

## Arquitetura adotada

```
Browser (React) → API própria (Express/server.ts) → src/lib/fiscal/ → SEFAZ-MT
```

### Módulo fiscal (`src/lib/fiscal/`)

| Arquivo | Responsabilidade |
|---------|-----------------|
| `types.ts` | Tipos internos: IntencaoFiscal, estados, itens, pagamentos |
| `endpoints.ts` | URLs SEFAZ-MT verificadas por modelo/ambiente + tabelas |
| `certificate.ts` | Carregamento seguro de PKCS#12, validação, cache em memória |
| `xml-nfce.ts` | Geração de XML NFC-e 4.00 + assinatura XMLDSig + QR Code |
| `sefaz-soap.ts` | SOAP 1.2 com mTLS, envelopes, parser de resposta |
| `sefaz-direct.ts` | Adaptador SefazMtDirect: autorizar, cancelar, consultar, status |

### Endpoints HTTP (server.ts)

| Rota | Função |
|------|--------|
| `GET /api/fiscal/config/:tenantId` | Configuração (sem certificado/senha) |
| `POST /api/fiscal/config/:tenantId` | Salva config + valida certificado A1 |
| `GET /api/fiscal/status/:tenantId` | Consulta disponibilidade SEFAZ |
| `POST /api/fiscal/nfce/:orderId` | Emite NFC-e |
| `POST /api/fiscal/cancel/:chaveAcesso` | Cancela NFC-e |
| `GET /api/fiscal/consultar/:chaveAcesso` | Consulta protocolo SEFAZ |
| `GET /api/fiscal/notes/:tenantId` | Histórico de notas |

## Endpoints SEFAZ-MT

**NFC-e modelo 65:**
- Homologação autorização: `https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4`
- Produção autorização: `https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4`

**NF-e modelo 55:**
- Produção autorização: `https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4`

## Segurança do certificado A1

- PFX nunca sai do servidor; retorna apenas metadados (fingerprint, validade, titular)
- Cache em memória (`Map`) por `tenantId` — carregado no primeiro uso após salvar config
- Validação: formato PKCS#12, senha, validade, cadeia ICP-Brasil, compatibilidade de CNPJ-base
- Certificado de CNPJ-base (8 dígitos) cobre filiais do mesmo contribuinte

## Estados da nota (IntencaoFiscal.status)

`RASCUNHO → VALIDACAO_PENDENTE → NUMERO_RESERVADO → ASSINADO → ENVIANDO → AUTORIZADO | REJEITADO | RESULTADO_DESCONHECIDO`

Cancelamento: `AUTORIZADO → CANCELAMENTO_PENDENTE → CANCELADO`

## Itens pendentes (bloqueios)

| Item | Dependência |
|------|-------------|
| Teste de homologação real | Certificado A1 de homologação autorizado pelo proprietário |
| CSC correto para QR Code | Obter no portal SEFAZ-MT para o ambiente de homologação |
| NF-e modelo 55 | Implementação de xml-nfe.ts (layout diferente do 65) |
| DANFE PDF | Renderer compatível com NT 2025.001 |
| Contingência offline (tpEmis=9) | Decisão sobre agente local |
| Numeração multi-nó | Lock distribuído no Supabase (atualmente em memória — seguro para instância única) |
| Importação histórico DotCompany | XML/protocolos existentes a importar via script separado |

## Referências

- Portaria 177/2021-SEFAZ-MT (NFC-e consolidação)
- MOC 7.0 Visão Geral
- NT 2025.001 v1.01 (QR Code e pagamentos)
- NT 2025.002-RTC v1.53 (reforma tributária)
- Portaria 262/2023-SEFAZ-MT (integração de pagamentos)
