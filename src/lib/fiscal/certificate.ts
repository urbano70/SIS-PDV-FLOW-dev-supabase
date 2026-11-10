// Gerenciamento seguro de certificado A1 (PKCS#12)
// Roda somente no servidor Node.js — nunca expor ao browser.
// node-forge está disponível como dependência transitiva.

import forge from 'node-forge';
import crypto from 'node:crypto';
import type { CertificadoRef } from './types.js';

export interface CertificadoCarregado {
  ref: CertificadoRef;
  pfxBuffer: Buffer;        // bytes originais do PFX — retidos em memória
  privateKeyPem: string;
  certificatePem: string;
  caCertsPem: string[];
}

// Cache em memória por tenantId — nunca persiste PFX fora desta estrutura
const _cache = new Map<string, CertificadoCarregado>();

export function carregarCertificado(
  tenantId: string,
  pfxBase64: string,
  senha: string,
): CertificadoCarregado {
  const pfxBuffer = Buffer.from(pfxBase64, 'base64');
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha);
  } catch {
    throw new Error('Certificado A1 inválido ou senha incorreta.');
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const keyBags  = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  const keyBag  = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];

  if (!certBag?.cert) throw new Error('Certificado não encontrado no PFX.');
  if (!keyBag?.key)   throw new Error('Chave privada não encontrada no PFX.');

  const cert = certBag.cert;
  const now = new Date();

  if (now > cert.validity.notAfter) {
    throw new Error(`Certificado expirado em ${cert.validity.notAfter.toISOString()}.`);
  }

  const cn = cert.subject.getField('CN')?.value as string | undefined;
  const cnpjMatch = cn?.match(/\d{14}/);
  if (!cnpjMatch) throw new Error('CNPJ não encontrado no CN do certificado.');

  const fingerprint = crypto
    .createHash('sha256')
    .update(pfxBuffer)
    .digest('hex')
    .toUpperCase();

  const privateKeyPem   = forge.pki.privateKeyToPem(keyBag.key as forge.pki.PrivateKey);
  const certificatePem  = forge.pki.certificateToPem(cert);

  // Coletar CAs da cadeia
  const allCerts = certBags[forge.pki.oids.certBag] ?? [];
  const caCertsPem = allCerts
    .filter(b => b.cert !== cert)
    .map(b => forge.pki.certificateToPem(b.cert!));

  const ref: CertificadoRef = {
    id: `cert-${tenantId}-${fingerprint.slice(0, 8)}`,
    fingerprint,
    titular: cn ?? '',
    cnpjTitular: cnpjMatch[0],
    emissora: cert.issuer.getField('CN')?.value as string ?? '',
    serial: cert.serialNumber,
    validadeInicio: cert.validity.notBefore.toISOString(),
    validadeFim: cert.validity.notAfter.toISOString(),
    estabelecimentosAutorizados: [cnpjMatch[0]],
    importadoEm: now.toISOString(),
    importadoPor: tenantId,
  };

  const loaded: CertificadoCarregado = { ref, pfxBuffer, privateKeyPem, certificatePem, caCertsPem };
  _cache.set(tenantId, loaded);
  return loaded;
}

export function getCertificado(tenantId: string): CertificadoCarregado | null {
  return _cache.get(tenantId) ?? null;
}

export function validarCNPJ(cnpj: string, cert: CertificadoCarregado): void {
  const cnpjLimpo = cnpj.replace(/\D/g, '');
  // Permitir certificado de CNPJ-base (8 dígitos) cobrindo filiais do mesmo contribuinte
  const baseCert = cert.ref.cnpjTitular.slice(0, 8);
  const baseDoc  = cnpjLimpo.slice(0, 8);
  if (baseCert !== baseDoc) {
    throw new Error(
      `Certificado pertence ao CNPJ ${cert.ref.cnpjTitular} — incompatível com emitente ${cnpjLimpo}.`
    );
  }
}
