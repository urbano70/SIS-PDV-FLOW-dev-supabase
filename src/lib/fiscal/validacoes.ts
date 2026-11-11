// Validações de negócio NFC-e / NF-e — SEFAZ-MT
// Ajuste SINIEF 23/2026 (vigente desde 05/10/2026), Portarias 177 e 160/2021-MT

/** R$200.000 — limite máximo por operação em NFC-e (art. 7º Ajuste SINIEF 07/2005). */
export const LIMITE_VALOR_NFCE = 200_000;

/** R$1.000 — identificação do consumidor obrigatória acima deste valor. */
export const LIMITE_IDENTIFICACAO_NFCE = 1_000;

/** Prazo de cancelamento NFC-e em Mato Grosso: 30 minutos (Portaria 177/2021-MT). */
const PRAZO_CANCEL_NFCE_MIN = 30;

/** Prazo de cancelamento NF-e em Mato Grosso: 8 horas (Portaria 160/2021-MT). */
const PRAZO_CANCEL_NFE_MIN = 8 * 60;

export function validarLimiteNFCe(total: number): void {
  if (total >= LIMITE_VALOR_NFCE) {
    throw new Error(
      `Valor total R$${total.toFixed(2)} excede o limite de R$${LIMITE_VALOR_NFCE.toLocaleString('pt-BR')} por operação em NFC-e. Utilize NF-e modelo 55.`,
    );
  }
}

export function validarIdentificacaoObrigatoria(total: number, temDestinatario: boolean): void {
  if (total >= LIMITE_IDENTIFICACAO_NFCE && !temDestinatario) {
    throw new Error(
      `Operações acima de R$${LIMITE_IDENTIFICACAO_NFCE.toLocaleString('pt-BR')} exigem identificação do consumidor (CPF ou CNPJ).`,
    );
  }
}

/**
 * Ajuste SINIEF 23/2026 (vigente 05/10/2026):
 * NF-e modelo 55 obrigatória quando o destinatário é pessoa jurídica
 * inscrita no CNPJ (pode tomar crédito de ICMS).
 * Retorna true se deve emitir NF-e em vez de NFC-e.
 */
export function deveUsarNFe(cnpjDestinatario?: string): boolean {
  if (!cnpjDestinatario) return false;
  const cnpj = cnpjDestinatario.replace(/\D/g, '');
  return cnpj.length === 14;
}

export interface ResultadoPrazoCancelamento {
  dentro: boolean;
  minutosRestantes: number;
}

/**
 * Verifica se a nota ainda está dentro do prazo de cancelamento.
 * Prazos MT: NFC-e = 30 min, NF-e = 8h (após horário de autorização).
 */
export function verificarPrazoCancelamento(
  dhAutorizacao: string,
  modelo: '55' | '65',
): ResultadoPrazoCancelamento {
  const prazoMin = modelo === '65' ? PRAZO_CANCEL_NFCE_MIN : PRAZO_CANCEL_NFE_MIN;
  const autorizado = new Date(dhAutorizacao).getTime();
  const agora = Date.now();
  const minutosDecorridos = (agora - autorizado) / 60_000;
  const minutosRestantes = Math.max(0, prazoMin - minutosDecorridos);
  return { dentro: minutosDecorridos <= prazoMin, minutosRestantes };
}
