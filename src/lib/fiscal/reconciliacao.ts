// Reconciliação de documentos fiscais com status RESULTADO_DESCONHECIDO
// ou PROCESSANDO — consulta o SEFAZ, re-transmite se necessário, atualiza o banco.
//
// Roda somente no servidor Node.js — requer Supabase service_role client.
//
// Fluxo:
//   1. Timeout na transmissão → autorizarNFCe/autorizarNFe retorna RESULTADO_DESCONHECIDO
//   2. Reconciliação consulta a chave de acesso no SEFAZ
//   3a. SEFAZ retornou 100/150 → nota foi autorizada → atualiza status + protocolo
//   3b. SEFAZ retornou 217 (não encontrada) + xml_assinado disponível → re-transmite
//   3c. SEFAZ retornou 217 sem xml → marca REJEITADO (re-emissão manual necessária)
//   3d. SEFAZ retornou 105/151 → ainda processando → mantém pendente para próximo ciclo
//   3e. Outros códigos → atualiza status conforme tabela SEFAZ

import type { FiscalDocStatus, AmbienteFiscal, ModeloFiscal } from './types.js';
import type { CertificadoCarregado } from './certificate.js';
import { getEndpoint } from './endpoints.js';
import { montarEnvelopeAutorizacao, soapCall, extrairCampo } from './sefaz-soap.js';
import { consultarNFCe, consultarNFe } from './sefaz-direct.js';

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface DetalheReconciliacao {
  id: string;
  chaveAcesso: string;
  modelo: ModeloFiscal;
  orderId?: string;
  statusAnterior: FiscalDocStatus;
  statusNovo: FiscalDocStatus;
  cStat: string;
  xMotivo: string;
  protocolo?: string;
  retransmitida: boolean;
}

export interface ResultadoReconciliacao {
  total: number;
  resolvidos: number;
  autorizados: number;
  rejeitados: number;
  ainda_pendentes: number;
  detalhes: DetalheReconciliacao[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ClassificacaoConsulta = FiscalDocStatus | 'RETRANSMITIR' | 'AGUARDAR';

function classificarCstatConsulta(cStat: string): ClassificacaoConsulta {
  switch (cStat) {
    case '100': return 'AUTORIZADO';
    case '101': return 'CANCELADO';
    case '102': return 'INUTILIZADO';
    case '110':
    case '301':
    case '302': return 'REJEITADO';
    case '150': return 'AUTORIZADO_COM_ALERTA';
    // 105 = Lote em processamento; 151 = NF não cadastrada no Autorizador de Contingência
    case '105':
    case '151': return 'AGUARDAR';
    // 217 = NF-e não consta na Base de Dados → re-transmitir se houver XML
    case '217': return 'RETRANSMITIR';
    default:    return 'RETORNO_NAO_CLASSIFICADO';
  }
}

function classificarCstatAutorizacao(cStat: string): FiscalDocStatus {
  if (cStat === '100') return 'AUTORIZADO';
  const n = parseInt(cStat || '0');
  if (cStat === '120' || (n >= 150 && n <= 199)) return 'AUTORIZADO_COM_ALERTA';
  if (cStat === '105') return 'RESULTADO_DESCONHECIDO'; // still processing
  return 'REJEITADO';
}

async function retransmitirXml(
  xmlAssinado: string,
  modelo: ModeloFiscal,
  ambiente: AmbienteFiscal,
  cert: CertificadoCarregado,
): Promise<{ cStat: string; xMotivo: string; protocolo: string; dhRecbto: string }> {
  const nfeStart = xmlAssinado.indexOf('<NFe');
  const nfeEnd   = xmlAssinado.lastIndexOf('</NFe>') + '</NFe>'.length;
  const xmlNFe   = (nfeStart >= 0 && nfeEnd > nfeStart)
    ? xmlAssinado.slice(nfeStart, nfeEnd)
    : xmlAssinado;

  const url      = getEndpoint(modelo === '65' ? 'nfce' : 'nfe', ambiente, 'autorizacao');
  const envelope = montarEnvelopeAutorizacao(xmlNFe);
  const { body } = await soapCall(url, envelope, cert, 30_000);

  return {
    cStat:    extrairCampo(body, 'cStat'),
    xMotivo:  extrairCampo(body, 'xMotivo'),
    protocolo: extrairCampo(body, 'nProt'),
    dhRecbto:  extrairCampo(body, 'dhRecbto'),
  };
}

// ── Reconciliação principal ───────────────────────────────────────────────────

/**
 * Consulta o SEFAZ para todas as notas pendentes do tenant e resolve
 * o status de cada uma. Re-transmite automaticamente notas que não
 * chegaram ao SEFAZ (cStat 217) quando o XML assinado está disponível.
 *
 * @param limit máximo de notas por execução (padrão 10, para não sobrecarregar o SEFAZ)
 */
export async function reconciliarResultadoDesconhecido(
  tenantId: string,
  cert: CertificadoCarregado,
  db: any,
  limit = 10,
): Promise<ResultadoReconciliacao> {
  const { data: notas, error } = await db.from('fiscal_notes')
    .select('id,chave_acesso,modelo,ambiente,xml_assinado,intencao_json,status,order_id')
    .eq('tenant_id', tenantId)
    .in('status', ['RESULTADO_DESCONHECIDO', 'PROCESSANDO', 'EPEC_AUTORIZADO', 'CONTINGENCIA_PENDENTE_TRANSMISSAO'])
    .not('chave_acesso', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Erro ao buscar notas: ${error.message}`);
  if (!notas || notas.length === 0) {
    return { total: 0, resolvidos: 0, autorizados: 0, rejeitados: 0, ainda_pendentes: 0, detalhes: [] };
  }

  const detalhes: DetalheReconciliacao[] = [];
  let autorizados = 0, rejeitados = 0, ainda_pendentes = 0;

  for (const nota of notas) {
    const ambiente = nota.ambiente as AmbienteFiscal;
    const modelo   = nota.modelo   as ModeloFiscal;

    let cStat: string, xMotivo: string, protocolo: string;
    let statusNovo: FiscalDocStatus;
    let retransmitida = false;

    // ── NFC-e offline / EPEC: re-transmitir diretamente ao SEFAZ principal ──────
    if (nota.status === 'EPEC_AUTORIZADO' || nota.status === 'CONTINGENCIA_PENDENTE_TRANSMISSAO') {
      if (!nota.xml_assinado) {
        statusNovo = 'REJEITADO';
        cStat      = '';
        xMotivo    = 'XML não encontrado para re-transmissão — re-emissão necessária';
        protocolo  = '';
      } else {
        try {
          const rt = await retransmitirXml(nota.xml_assinado, modelo, ambiente, cert);
          cStat     = rt.cStat;
          xMotivo   = rt.xMotivo;
          protocolo = rt.protocolo;
          retransmitida = true;
          statusNovo = classificarCstatAutorizacao(cStat);
          if (statusNovo === 'RESULTADO_DESCONHECIDO') {
            // SEFAZ ainda processando — aguardar próximo ciclo
            ainda_pendentes++;
            continue;
          }
        } catch {
          // SEFAZ-MT ainda inacessível — manter EPEC_AUTORIZADO
          ainda_pendentes++;
          continue;
        }
      }

    } else {
      // ── Notas com status desconhecido/processando: consultar antes de re-transmitir ─

      // 1. Consultar status no SEFAZ
      try {
        const r = modelo === '55'
          ? await consultarNFe(nota.chave_acesso, ambiente, cert)
          : await consultarNFCe(nota.chave_acesso, ambiente, cert);
        cStat    = r.cStat;
        xMotivo  = r.xMotivo;
        protocolo = r.protocolo;
      } catch {
        // Falha de rede — tentar no próximo ciclo
        ainda_pendentes++;
        continue;
      }

      const classificacao = classificarCstatConsulta(cStat);

      // 2. Tratar resultado
      if (classificacao === 'AGUARDAR') {
        ainda_pendentes++;
        continue;

      } else if (classificacao === 'RETRANSMITIR') {
        if (nota.xml_assinado) {
          try {
            const rt = await retransmitirXml(nota.xml_assinado, modelo, ambiente, cert);
            cStat     = rt.cStat;
            xMotivo   = rt.xMotivo;
            protocolo = rt.protocolo;
            retransmitida = true;
            statusNovo = classificarCstatAutorizacao(cStat);
            if (statusNovo === 'RESULTADO_DESCONHECIDO') {
              ainda_pendentes++;
              continue;
            }
          } catch {
            ainda_pendentes++;
            continue;
          }
        } else {
          statusNovo = 'REJEITADO';
          xMotivo    = 'NF não encontrada no SEFAZ — re-emissão necessária';
          protocolo  = '';
        }

      } else {
        statusNovo = classificacao as FiscalDocStatus;
      }
    }

    // 3. Atualizar banco
    const updatePayload: Record<string, unknown> = {
      status:    statusNovo,
      cstat:     cStat,
      xmotivo:   xMotivo,
      updated_at: new Date().toISOString(),
    };
    if (protocolo) updatePayload.protocolo = protocolo;

    // Espelhar atualização no intencao_json para o DANFE refletir o protocolo
    if (nota.intencao_json) {
      updatePayload.intencao_json = {
        ...nota.intencao_json,
        status:   statusNovo,
        protocolo: protocolo || nota.intencao_json.protocolo,
        cStat,
        xMotivo,
      };
    }

    await db.from('fiscal_notes').update(updatePayload).eq('id', nota.id);

    if (statusNovo === 'AUTORIZADO' || statusNovo === 'AUTORIZADO_COM_ALERTA') autorizados++;
    else if (statusNovo === 'REJEITADO') rejeitados++;

    detalhes.push({
      id:             nota.id,
      chaveAcesso:    nota.chave_acesso,
      modelo,
      orderId:        nota.order_id ?? undefined,
      statusAnterior: nota.status as FiscalDocStatus,
      statusNovo,
      cStat,
      xMotivo,
      protocolo:      protocolo || undefined,
      retransmitida,
    });
  }

  return {
    total:           notas.length,
    resolvidos:      detalhes.length,
    autorizados,
    rejeitados,
    ainda_pendentes: notas.length - detalhes.length + ainda_pendentes,
    detalhes,
  };
}
