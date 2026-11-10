// Gerenciamento seguro de certificado A1 (PKCS#12)
// Roda somente no servidor Node.js — nunca expor ao browser.
// node-forge está disponível como dependência transitiva.

import forge from 'node-forge';
import crypto from 'node:crypto';
import type { CertificadoRef } from './types.js';

export interface CertificadoCarregado {
  ref: CertificadoRef;
  pfxBuffer: Buffer;
  privateKeyPem: string;
  certificatePem: string;
  caCertsPem: string[];
}

// Cache em memória por tenantId
const _cache = new Map<string, CertificadoCarregado>();

// ── Criptografia de envelope para persistir PFX no banco ────────────────────
// Chave derivada de CERT_ENCRYPTION_KEY (variável de ambiente obrigatória em produção).
// Sem ela o PFX não é persistido — apenas retido em memória até reinício do processo.

const ALGO = 'aes-256-gcm';

function getEncKey(): Buffer | null {
  const raw = process.env.CERT_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptPfx(pfxBuffer: Buffer): string | null {
  const key = getEncKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(pfxBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  // formato: iv(12) + tag(16) + ciphertext — tudo em base64
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptPfx(encrypted: string): Buffer | null {
  const key = getEncKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(encrypted, 'base64');
    const iv  = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch {
    return null;
  }
}

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

export function encryptText(text: string): string | null {
  const key = getEncKey();
  if (!key) return null;
  return encryptPfx(Buffer.from(text, 'utf8'));
}

export function decryptText(encrypted: string): string | null {
  const buf = decryptPfx(encrypted);
  return buf ? buf.toString('utf8') : null;
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
