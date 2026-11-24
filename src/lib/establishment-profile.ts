import { adminFetch } from './admin-http';
import { removeEstablishmentLogoViaProxy } from './auth';

export interface ProfileFields {
  establishment_name: string;
  establishment_type: string;
  establishment_type_other: string;
  cnpj: string;
  responsible_name: string;
  address: string;
  phone_whatsapp: string;
  responsible_whatsapp: string;
  establishment_email: string;
}

export interface EstablishmentProfile extends ProfileFields {
  logo_url: string;
}

export interface AuthUser {
  id?: string;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EstablishmentProfileResponse {
  ok: true;
  user: AuthUser;
  profile: EstablishmentProfile;
}

export interface SaveEstablishmentProfileInput {
  fields: ProfileFields;
  logoDataUrl?: string;
  removeLogo?: boolean;
}

export interface BrandingPatch {
  establishmentName?: string;
  cnpj?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
}

/** An HTTP failure keeps its status so callers/tests can distinguish transport failures. */
export class EstablishmentProfileHttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'EstablishmentProfileHttpError';
    this.status = status;
    this.code = code;
  }
}

const PROFILE_ENDPOINT = '/api/establishment/profile';
const hasOwn = (value: unknown, key: string): boolean =>
  !!value && Object.prototype.hasOwnProperty.call(value, key);

function responseMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const candidate = (payload as Record<string, unknown>).error ??
      (payload as Record<string, unknown>).message;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return fallback;
}

async function parseProfileResponse(response: Response): Promise<EstablishmentProfileResponse> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const fallback = response.statusText || `HTTP ${response.status}`;
    const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    throw new EstablishmentProfileHttpError(
      responseMessage(payload, fallback),
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
    );
  }

  if (!payload || typeof payload !== 'object' || (payload as Record<string, unknown>).ok !== true) {
    throw new EstablishmentProfileHttpError(
      responseMessage(payload, 'Resposta inválida do perfil do estabelecimento.'),
      response.status || 200,
    );
  }

  const body = payload as Record<string, unknown>;
  const profile = body.profile;
  if (!profile || typeof profile !== 'object' || !hasOwn(profile, 'logo_url') ||
      !body.user || typeof body.user !== 'object') {
    throw new EstablishmentProfileHttpError(
      'Resposta incompleta do perfil do estabelecimento.',
      response.status || 200,
    );
  }

  return body as unknown as EstablishmentProfileResponse;
}

export async function getEstablishmentProfile(): Promise<EstablishmentProfileResponse> {
  const response = await adminFetch(PROFILE_ENDPOINT, { method: 'GET' });
  return parseProfileResponse(response);
}

export async function saveEstablishmentProfile(
  input: SaveEstablishmentProfileInput,
): Promise<EstablishmentProfileResponse> {
  if (input.removeLogo && input.logoDataUrl !== undefined) {
    throw new Error('Upload e remoção da logo não podem ser enviados juntos.');
  }
  if (input.removeLogo === true) {
    return removeEstablishmentLogoViaProxy(input.fields);
  }

  const body: Record<string, unknown> = { fields: input.fields };
  if (input.logoDataUrl !== undefined) body.logoDataUrl = input.logoDataUrl;

  const response = await adminFetch(PROFILE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseProfileResponse(response);
}

/**
 * Converts only explicitly stored Auth metadata into the branding shape used by
 * the app. An explicit empty logo_url is intentional and means "remove it".
 */
export function brandingFromMetadata(meta: unknown): BrandingPatch {
  if (!meta || typeof meta !== 'object') return {};
  const source = meta as Record<string, unknown>;
  const patch: BrandingPatch = {};
  const value = (key: string): string => {
    const raw = source[key];
    return raw == null ? '' : String(raw);
  };

  if (hasOwn(source, 'establishment_name')) patch.establishmentName = value('establishment_name');
  if (hasOwn(source, 'cnpj')) patch.cnpj = value('cnpj');
  if (hasOwn(source, 'address')) patch.address = value('address');
  if (hasOwn(source, 'phone_whatsapp')) patch.phone = value('phone_whatsapp');
  if (hasOwn(source, 'establishment_email')) patch.email = value('establishment_email');
  if (hasOwn(source, 'logo_url')) {
    const logo = value('logo_url');
    // A legacy image remains remotely intact until migration succeeds; it
    // must not be copied back into printer/cache/auth configuration meanwhile.
    patch.logoUrl = /^data:/i.test(logo) || logo.length > 2048 ? '' : logo;
  }
  return patch;
}
