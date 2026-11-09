// DotCompany API client — NFC-e (modelo 65)
// Docs: https://app.dotcompany.com.br/developer/guias/fiscal-nfce.md
// Base: https://api.dotcompany.com.br/api/v1

const BASE_URL = 'https://api.dotcompany.com.br/api/v1';

export interface FiscalConfig {
  cnpj: string;
  ie: string;
  uf: string;
  regime: '1' | '2' | '3'; // 1=Simples Nacional, 2=Simples excesso, 3=Regime Normal
  csc: string;
  cscId: string;
  serie: string; // default '001'
  ambiente: 'homologacao' | 'producao';
  razaoSocial: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  codigoMunicipio: string; // código IBGE
  cep: string;
  certificadoA1Base64?: string;
  certificadoSenha?: string;
}

export interface NfceItem {
  nome: string;
  ncm: string;
  cfop: string;
  csosn?: string;
  cst?: string;
  unidade: string;
  origem: string;
  pisCofinsCst: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
}

export type FormaPagamento = 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix' | 'outros';

export interface NfceRequest {
  tenantId: string;
  orderId: string;
  fiscalConfig: FiscalConfig;
  items: NfceItem[];
  total: number;
  pagamento: FormaPagamento;
  cpfConsumidor?: string;
  sandbox?: boolean;
}

export interface NfceResult {
  chaveAcesso: string;
  qrCode: string;
  urlDanfe: string;
  xml: string;
  status: 'autorizada' | 'rejeitada' | 'contingencia';
  protocolo: string;
  idempotencyKey: string;
}

export interface DotCompanyError extends Error {
  code: string;
  detail: string;
  requestId?: string;
  docsUrl?: string;
  status: number;
}

function isSandboxKey(apiKey: string): boolean {
  return apiKey.startsWith('dc_test_');
}

function makeDotError(status: number, body: any): DotCompanyError {
  const msg = body?.detail || body?.message || body?.error || (typeof body === 'string' ? body : null) || `HTTP ${status}`;
  const err = new Error(msg) as DotCompanyError;
  err.code = body?.code || `HTTP_${status}`;
  err.detail = msg;
  err.requestId = body?.request_id;
  err.docsUrl = body?.docs_url;
  err.status = status;
  return err;
}

async function dotFetch(
  path: string,
  apiKey: string,
  options: RequestInit & { idempotencyKey?: string; sandboxMode?: boolean } = {},
  timeoutMs = 15000,
): Promise<any> {
  const { idempotencyKey, sandboxMode, ...fetchOpts } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    ...(fetchOpts.headers as Record<string, string> || {}),
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (sandboxMode || isSandboxKey(apiKey)) headers['X-Sandbox-Mode'] = 'simulado';

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let lastError: any;
  const delays = [2000, 4000, 8000];

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        ...fetchOpts,
        headers,
        signal: controller.signal,
      });
      clearTimeout(tid);

      if (res.ok) {
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      }

      // Parse error body
      let body: any = {};
      let rawText = '';
      try { rawText = await res.text(); body = JSON.parse(rawText); } catch { body = { detail: rawText || `HTTP ${res.status}` }; }
      console.error(`[dotcompany] ${res.status} ${path}:`, rawText);

      // 4xx — do not retry (except 429)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw makeDotError(res.status, body);
      }

      lastError = makeDotError(res.status, body);

      if (attempt < 3) {
        const retryAfter = res.headers.get('Retry-After');
        const wait = retryAfter ? parseInt(retryAfter) * 1000 : delays[attempt];
        await new Promise(r => setTimeout(r, wait));
      }
    } catch (err: any) {
      clearTimeout(tid);
      if (err.code) throw err; // already a DotCompanyError
      lastError = err;
      if (attempt < 3) await new Promise(r => setTimeout(r, delays[attempt] ?? 8000));
    }
  }

  throw lastError;
}

// ── Emissores ────────────────────────────────────────────────────────────────

export async function registerEmitter(fiscalConfig: FiscalConfig, apiKey: string): Promise<void> {
  const body: any = {
    cnpj: (fiscalConfig.cnpj || '').replace(/\D/g, ''),
    inscricao_estadual: (() => {
      const ie = (fiscalConfig.ie || '').replace(/\D/g, '');
      // IE vazia, placeholder ou regime Simples Nacional → ISENTO
      if (!ie || ie === '000000000000' || fiscalConfig.regime === '1' || fiscalConfig.regime === '2') return 'ISENTO';
      return fiscalConfig.ie;
    })(),
    uf: fiscalConfig.uf || 'SP',
    regime_tributario: fiscalConfig.regime || '1',
    razao_social: fiscalConfig.razaoSocial || '',
    nome_fantasia: fiscalConfig.razaoSocial || '',
    endereco: {
      logradouro: fiscalConfig.logradouro || 'N/I',
      numero: fiscalConfig.numero || 'S/N',
      bairro: fiscalConfig.bairro || 'N/I',
      municipio: fiscalConfig.municipio || 'N/I',
      codigo_municipio: fiscalConfig.codigoMunicipio || '3550308',
      uf: fiscalConfig.uf || 'SP',
      cep: (fiscalConfig.cep || '00000000').replace(/\D/g, ''),
    },
    nfce: {
      serie: fiscalConfig.serie || '001',
      csc: fiscalConfig.csc,
      id_csc: fiscalConfig.cscId,
      ambiente: fiscalConfig.ambiente === 'producao' ? 'producao' : 'homologacao',
    },
  };

  if (fiscalConfig.certificadoA1Base64 && fiscalConfig.certificadoSenha) {
    body.certificado = {
      conteudo: fiscalConfig.certificadoA1Base64,
      senha: fiscalConfig.certificadoSenha,
    };
  }

  await dotFetch('/emitters', apiKey, { method: 'POST', body: JSON.stringify(body) });
}

// ── NFC-e ─────────────────────────────────────────────────────────────────────

function mapPagamento(p: FormaPagamento): string {
  const map: Record<FormaPagamento, string> = {
    dinheiro: '01',
    cartao_credito: '03',
    cartao_debito: '04',
    pix: '17',
    outros: '99',
  };
  return map[p] || '99';
}

export async function emitNfce(req: NfceRequest, apiKey: string): Promise<NfceResult> {
  const { fiscalConfig, items, total, pagamento, cpfConsumidor, orderId } = req;
  const idempotencyKey = `nfce-${orderId}-${(fiscalConfig.cnpj || '').replace(/\D/g, '')}`;

  const detalhes = items.map((item, idx) => ({
    numero_item: idx + 1,
    codigo_produto: `ITEM${idx + 1}`,
    descricao: item.nome,
    ncm: item.ncm || '21069090',
    cfop: item.cfop || '5102',
    unidade_comercial: item.unidade || 'UN',
    quantidade_comercial: item.quantidade,
    valor_unitario_comercial: item.valorUnitario,
    valor_bruto: item.valorTotal,
    origem: item.origem || '0',
    // Simples Nacional
    ...(fiscalConfig.regime === '1' || fiscalConfig.regime === '2'
      ? { csosn: item.csosn || '400' }
      : { cst_icms: item.cst || '00', aliquota_icms: 0, valor_icms: 0 }),
    pis: { cst: item.pisCofinsCst || '07' },
    cofins: { cst: item.pisCofinsCst || '07' },
  }));

  const body: any = {
    cnpj_emitente: (fiscalConfig.cnpj || '').replace(/\D/g, ''),
    serie: fiscalConfig.serie || '001',
    ambiente: fiscalConfig.ambiente === 'producao' ? 'producao' : 'homologacao',
    detalhes,
    pagamentos: [{
      forma_pagamento: mapPagamento(pagamento),
      valor: total,
    }],
  };

  if (cpfConsumidor) {
    body.destinatario = { cpf: cpfConsumidor.replace(/\D/g, '') };
  }

  const data = await dotFetch('/nfce', apiKey, {
    method: 'POST',
    body: JSON.stringify(body),
    idempotencyKey,
  });

  return {
    chaveAcesso: data.chave_acesso || data.chave || '',
    qrCode: data.qr_code || data.qrcode || '',
    urlDanfe: data.url_danfe || data.danfe_url || '',
    xml: data.xml || '',
    status: data.status || 'autorizada',
    protocolo: data.numero_protocolo || data.protocolo || '',
    idempotencyKey,
  };
}

// ── Cancelamento ──────────────────────────────────────────────────────────────

export async function cancelNfce(
  chaveAcesso: string,
  motivo: string,
  fiscalConfig: FiscalConfig,
  apiKey: string,
): Promise<void> {
  const idempotencyKey = `cancel-${chaveAcesso}`;
  await dotFetch(`/nfce/${chaveAcesso}/cancelamento`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      cnpj_emitente: (fiscalConfig.cnpj || '').replace(/\D/g, ''),
      justificativa: motivo,
      ambiente: fiscalConfig.ambiente === 'producao' ? 'producao' : 'homologacao',
    }),
    idempotencyKey,
  });
}

// ── Consulta ──────────────────────────────────────────────────────────────────

export async function consultNfce(
  chaveAcesso: string,
  apiKey: string,
): Promise<{ status: string; protocolo?: string }> {
  const data = await dotFetch(`/nfce/${chaveAcesso}`, apiKey, { method: 'GET' });
  return {
    status: data?.status || 'desconhecido',
    protocolo: data?.numero_protocolo || data?.protocolo,
  };
}
