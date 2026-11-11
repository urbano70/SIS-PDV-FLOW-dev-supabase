// Fila durável de contingência NFC-e (tpEmis='9')
// Roda somente no servidor Node.js — requer Supabase service_role client.
//
// Fluxo:
//   1. PDV detecta SEFAZ offline → gera NFC-e com tpEmis='9' + dhCont + xJust
//   2. autorizarNFCe() assina o XML e preenche intencao.xmlAssinado
//   3. Chamador invoca enfileirarContingencia() com a intencao já assinada
//   4. Quando SEFAZ volta, chamador invoca processarFilaContingencia() para drenar
//   5. O processador re-transmite o XML assinado original (não regenera)

import type { IntencaoFiscal, FiscalDocStatus } from './types.js';
import type { CertificadoCarregado } from './certificate.js';
import { getEndpoint } from './endpoints.js';
import { montarEnvelopeAutorizacao, soapCall, extrairCampo } from './sefaz-soap.js';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type StatusFilaContingencia =
  | 'PENDENTE'
  | 'TRANSMITINDO'
  | 'AUTORIZADO'
  | 'REJEITADO'
  | 'FALHA_PERMANENTE';

export interface ItemFilaContingencia {
  id: string;
  tenant_id: string;
  intencao_json: IntencaoFiscal;
  status: StatusFilaContingencia;
  tentativas: number;
  max_tentativas: number;
  proxima_tentativa_em: string | null;
  prazo_transmissao_em: string | null;
  protocolo: string | null;
  cstat: string | null;
  xmotivo: string | null;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ResultadoProcessamento {
  processados: number;
  autorizados: number;
  erros: number;
  detalhes: Array<{ id: string; chaveAcesso: string; status: StatusFilaContingencia; cstat: string }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Próximo instante para re-tentativa — backoff exponencial, máx 60 min. */
function proximaTentativaEm(tentativas: number): string {
  const mins = Math.min(Math.pow(2, tentativas), 60);
  return new Date(Date.now() + mins * 60_000).toISOString();
}

/** Mapeia cStat de autorização para FiscalDocStatus. */
function classificarCstat(cStat: string): FiscalDocStatus {
  if (cStat === '100') return 'AUTORIZADO';
  const n = parseInt(cStat || '0');
  if (cStat === '120' || (n >= 150 && n <= 199)) return 'AUTORIZADO_COM_ALERTA';
  if (cStat === '105') return 'PROCESSANDO';
  return 'REJEITADO';
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Persiste uma NFC-e contingente na fila.
 * A intencao deve ter xmlAssinado, chaveAcesso, numero e serie já preenchidos
 * (ou seja, autorizarNFCe() já foi executado até a etapa de assinatura).
 *
 * Prazo padrão de transmissão: 168h (7 dias) — equivalente à janela de
 * cancelamento por substituição (NT 2018.004 / Portaria 177/2021-MT).
 */
export async function enfileirarContingencia(
  intencao: IntencaoFiscal,
  db: any,
  prazoHoras = 168,
): Promise<string> {
  if (!intencao.xmlAssinado) {
    throw new Error('IntencaoFiscal.xmlAssinado ausente — assine o XML antes de enfileirar.');
  }
  if (!intencao.chaveAcesso) {
    throw new Error('IntencaoFiscal.chaveAcesso ausente.');
  }

  const prazo = new Date(Date.now() + prazoHoras * 60 * 60_000).toISOString();

  const { data, error } = await db
    .from('fiscal_contingencia_queue')
    .insert({
      tenant_id:            intencao.tenantId,
      intencao_json:        intencao,
      prazo_transmissao_em: prazo,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Erro ao enfileirar contingência: ${error.message}`);
  return data.id as string;
}

/**
 * Processa até `limit` itens pendentes da fila do tenant.
 * Usa dequeue atômico (FOR UPDATE SKIP LOCKED) — seguro para múltiplos containers.
 * Deve ser chamado quando a conectividade com SEFAZ for restaurada.
 */
export async function processarFilaContingencia(
  tenantId: string,
  cert: CertificadoCarregado,
  db: any,
  limit = 5,
): Promise<ResultadoProcessamento> {
  const { data: itens, error } = await db.rpc('fiscal_contingencia_dequeue', {
    p_tenant_id: tenantId,
    p_limit:     limit,
  });

  if (error) throw new Error(`Erro ao dequeue fila de contingência: ${error.message}`);

  const resultado: ResultadoProcessamento = {
    processados: 0, autorizados: 0, erros: 0, detalhes: [],
  };

  if (!itens || itens.length === 0) return resultado;

  for (const item of itens as ItemFilaContingencia[]) {
    try {
      const docStatus = await _transmitirItem(item, cert, db);
      resultado.processados++;
      if (docStatus === 'AUTORIZADO' || docStatus === 'AUTORIZADO_COM_ALERTA') resultado.autorizados++;
      const statusFinal = await _lerStatus(item.id, db);
      resultado.detalhes.push({
        id:          item.id,
        chaveAcesso: item.intencao_json.chaveAcesso ?? '',
        status:      statusFinal as StatusFilaContingencia,
        cstat:       item.cstat ?? '',
      });
    } catch (err: any) {
      resultado.erros++;
      resultado.detalhes.push({
        id:          item.id,
        chaveAcesso: item.intencao_json.chaveAcesso ?? '',
        status:      'FALHA_PERMANENTE',
        cstat:       '',
      });
    }
  }

  return resultado;
}

/** Retorna todos os itens da fila do tenant, opcionalmente filtrados por status. */
export async function consultarFilaContingencia(
  tenantId: string,
  db: any,
  status?: StatusFilaContingencia,
): Promise<ItemFilaContingencia[]> {
  let q = db
    .from('fiscal_contingencia_queue')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('criado_em', { ascending: false });

  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) throw new Error(`Erro ao consultar fila de contingência: ${error.message}`);
  return (data ?? []) as ItemFilaContingencia[];
}

/** Conta itens pendentes — útil para exibir badge de alerta no PDV. */
export async function contarPendentes(tenantId: string, db: any): Promise<number> {
  const { count, error } = await db
    .from('fiscal_contingencia_queue')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'PENDENTE');

  if (error) throw new Error(`Erro ao contar pendentes: ${error.message}`);
  return count ?? 0;
}

// ── Implementação interna ────────────────────────────────────────────────────

async function _transmitirItem(
  item: ItemFilaContingencia,
  cert: CertificadoCarregado,
  db: any,
): Promise<FiscalDocStatus> {
  const intencao = item.intencao_json;

  if (!intencao.xmlAssinado) {
    await _atualizarItem(db, item.id, {
      status: 'FALHA_PERMANENTE',
      erro:   'xmlAssinado ausente no snapshot',
    });
    return 'REJEITADO';
  }

  // Extrai <NFe>...</NFe> do XML já assinado (inclui <infNFeSupl>)
  const xml     = intencao.xmlAssinado;
  const nfeStart = xml.indexOf('<NFe');
  const nfeEnd   = xml.lastIndexOf('</NFe>') + '</NFe>'.length;
  const xmlNFe   = (nfeStart >= 0 && nfeEnd > nfeStart)
    ? xml.slice(nfeStart, nfeEnd)
    : xml;

  const url      = getEndpoint('nfce', intencao.ambiente, 'autorizacao');
  const envelope = montarEnvelopeAutorizacao(xmlNFe);

  let cStat = '';
  let xMotivo = '';
  let nProt = '';

  try {
    const { body } = await soapCall(url, envelope, cert, 30_000);
    cStat   = extrairCampo(body, 'cStat');
    xMotivo = extrairCampo(body, 'xMotivo');
    nProt   = extrairCampo(body, 'nProt');
  } catch (err: any) {
    return _reagendar(db, item, err.message);
  }

  const docStatus = classificarCstat(cStat);

  if (docStatus === 'AUTORIZADO' || docStatus === 'AUTORIZADO_COM_ALERTA') {
    await _atualizarItem(db, item.id, {
      status:    'AUTORIZADO',
      protocolo: nProt,
      cstat:     cStat,
      xmotivo:   xMotivo,
    });
    return docStatus;
  }

  if (docStatus === 'PROCESSANDO') {
    return _reagendar(db, item, `cStat ${cStat}: ${xMotivo}`);
  }

  // cStat 656 = NF-e já existe — foi autorizada em transmissão anterior (idempotente)
  if (cStat === '656') {
    await _atualizarItem(db, item.id, {
      status:  'AUTORIZADO',
      cstat:   cStat,
      xmotivo: xMotivo,
    });
    return 'AUTORIZADO';
  }

  // Rejeição definitiva SEFAZ
  const novas = item.tentativas + 1;
  if (novas >= item.max_tentativas) {
    await _atualizarItem(db, item.id, {
      status:     'REJEITADO',
      tentativas: novas,
      cstat:      cStat,
      xmotivo:    xMotivo,
    });
    return 'REJEITADO';
  }

  // Ainda tem tentativas — pode ser erro transitório
  return _reagendar(db, item, `cStat ${cStat}: ${xMotivo}`);
}

async function _reagendar(
  db: any,
  item: ItemFilaContingencia,
  motivo: string,
): Promise<FiscalDocStatus> {
  const novas = item.tentativas + 1;
  if (novas >= item.max_tentativas) {
    await _atualizarItem(db, item.id, {
      status:     'FALHA_PERMANENTE',
      tentativas: novas,
      erro:       motivo,
    });
    return 'REJEITADO';
  }
  await _atualizarItem(db, item.id, {
    status:               'PENDENTE',
    tentativas:           novas,
    proxima_tentativa_em: proximaTentativaEm(novas),
    erro:                 motivo,
  });
  return 'RESULTADO_DESCONHECIDO';
}

async function _atualizarItem(db: any, id: string, campos: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from('fiscal_contingencia_queue')
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Erro ao atualizar item ${id}: ${error.message}`);
}

async function _lerStatus(id: string, db: any): Promise<string> {
  const { data, error } = await db
    .from('fiscal_contingencia_queue')
    .select('status')
    .eq('id', id)
    .single();
  if (error) return 'FALHA_PERMANENTE';
  return data.status as string;
}
