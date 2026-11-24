import { createHash } from 'node:crypto';

export const ESTABLISHMENT_LOGO_BUCKET = 'pdv-establishment-logos';
export const MAX_LOGO_BYTES = 600_000;
export const MAX_LOGO_DIMENSION = 4096;
export const MAX_LOGO_PIXELS = 16_000_000;
export const LOGO_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const ESTABLISHMENT_PROFILE_FIELDS = [
  'establishment_name',
  'establishment_type',
  'establishment_type_other',
  'cnpj',
  'responsible_name',
  'address',
  'phone_whatsapp',
  'responsible_whatsapp',
  'establishment_email',
] as const;

export type EstablishmentProfileField = typeof ESTABLISHMENT_PROFILE_FIELDS[number];
export type EstablishmentProfileFields = Partial<Record<EstablishmentProfileField, string>>;

export interface AuthUserLike {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface EstablishmentProfile {
  establishment_name: string;
  establishment_type: string;
  establishment_type_other: string;
  cnpj: string;
  responsible_name: string;
  address: string;
  phone_whatsapp: string;
  responsible_whatsapp: string;
  establishment_email: string;
  logo_url: string;
}

export interface ProfileMutation {
  fields: EstablishmentProfileFields;
  logoDataUrl?: string;
  removeLogo?: boolean;
}

interface AuthAdminLike {
  getUserById(userId: string): Promise<{ data?: { user?: AuthUserLike | null } | null; error?: any }>;
  updateUserById(userId: string, attributes: { user_metadata: Record<string, unknown> }): Promise<{ data?: { user?: AuthUserLike | null } | null; error?: any }>;
}

interface StorageObjectLike {
  upload(path: string, body: Buffer, options?: Record<string, unknown>): Promise<{ data?: unknown; error?: any }>;
  getPublicUrl(path: string): { data?: { publicUrl?: string }; error?: any };
}

interface StorageLike {
  from(bucket: string): StorageObjectLike;
  getBucket(bucket: string): Promise<{ data?: unknown; error?: any }>;
  createBucket(bucket: string, options: Record<string, unknown>): Promise<{ data?: unknown; error?: any }>;
  updateBucket?: (bucket: string, options: Record<string, unknown>) => Promise<{ data?: unknown; error?: any }>;
}

export interface EstablishmentProfileDependencies {
  authAdmin: AuthAdminLike;
  storage: StorageLike;
  supabaseUrl?: string;
}

export class EstablishmentProfileError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = 'ESTABLISHMENT_PROFILE_ERROR', status = 400) {
    super(message);
    this.name = 'EstablishmentProfileError';
    this.code = code;
    this.status = status;
  }
}

const hasOwn = (value: unknown, key: string): boolean =>
  Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

const cloneMetadata = (metadata: unknown): Record<string, unknown> => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return { ...(metadata as Record<string, unknown>) };
};

const errorText = (error: any): string => String(error?.message || error?.error_description || error?.msg || error || 'erro desconhecido');
const errorStatus = (error: any): number => Number(error?.status || error?.statusCode || error?.code || 0) || 0;

function isNotFound(error: any): boolean {
  const status = errorStatus(error);
  return status === 404 || /not found|does not exist|bucket.*(missing|not)/i.test(errorText(error));
}

function isConflict(error: any): boolean {
  const status = errorStatus(error);
  return status === 409 || /already exists|already_exists|duplicate|conflict/i.test(errorText(error));
}

function base64IsStrict(encoded: string): boolean {
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const padding = encoded.indexOf('=');
  if (padding >= 0 && padding < encoded.length - 2 && encoded.slice(padding).includes('=')) return false;
  try {
    return Buffer.from(encoded, 'base64').toString('base64') === encoded;
  } catch {
    return false;
  }
}

function dimensionsAreSafe(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width <= MAX_LOGO_DIMENSION && height <= MAX_LOGO_DIMENSION && width * height <= MAX_LOGO_PIXELS;
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 33 || bytes.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return dimensionsAreSafe(width, height) ? { width, height } : null;
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segmentLength >= 7) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return dimensionsAreSafe(width, height) ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 16 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) return null;
    if (chunk === 'VP8X' && size >= 10) {
      const width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
      const height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
      return dimensionsAreSafe(width, height) ? { width, height } : null;
    }
    if (chunk === 'VP8 ' && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      const width = bytes.readUInt16LE(data + 6) & 0x3fff;
      const height = bytes.readUInt16LE(data + 8) & 0x3fff;
      return dimensionsAreSafe(width, height) ? { width, height } : null;
    }
    if (chunk === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
      const bits = bytes[data + 1] | (bytes[data + 2] << 8) | (bytes[data + 3] << 16) | (bytes[data + 4] << 24);
      const width = 1 + (bits & 0x3fff);
      const height = 1 + ((bits >>> 14) & 0x3fff);
      return dimensionsAreSafe(width, height) ? { width, height } : null;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

export interface ValidatedLogo {
  mimeType: typeof LOGO_ALLOWED_MIME_TYPES[number];
  extension: 'png' | 'jpg' | 'webp';
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
}

export function validateLogoDataUrl(dataUrl: unknown): ValidatedLogo {
  if (typeof dataUrl !== 'string') {
    throw new EstablishmentProfileError('A logo deve ser uma imagem raster em Data URL.', 'LOGO_DATA_URL_INVALID');
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || !base64IsStrict(match[2])) {
    throw new EstablishmentProfileError('Logo inválida: envie PNG, JPEG ou WebP em Base64 estrito. SVG não é aceito pelo servidor.', 'LOGO_DATA_URL_INVALID');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) {
    throw new EstablishmentProfileError('A logo excede o limite de 600 KB.', 'LOGO_TOO_LARGE');
  }
  const mimeType = match[1] as ValidatedLogo['mimeType'];
  const dimensions = mimeType === 'image/png'
    ? readPngDimensions(bytes)
    : mimeType === 'image/jpeg' ? readJpegDimensions(bytes) : readWebpDimensions(bytes);
  if (!dimensions) {
    throw new EstablishmentProfileError('Logo inválida: assinatura raster ou dimensões não reconhecidas.', 'LOGO_RASTER_INVALID');
  }
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  return {
    mimeType,
    extension,
    bytes,
    width: dimensions.width,
    height: dimensions.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function ensureLogoBucket(storage: StorageLike): Promise<void> {
  const desired = {
    public: true,
    fileSizeLimit: MAX_LOGO_BYTES,
    allowedMimeTypes: [...LOGO_ALLOWED_MIME_TYPES],
  };
  const existing = await storage.getBucket(ESTABLISHMENT_LOGO_BUCKET);
  if (!existing?.error) {
    if (typeof storage.updateBucket === 'function') {
      const updated = await storage.updateBucket(ESTABLISHMENT_LOGO_BUCKET, desired);
      if (updated?.error) throw new EstablishmentProfileError(`Não foi possível configurar o bucket de logos: ${errorText(updated.error)}`, 'STORAGE_BUCKET_FAILED', 503);
    }
    return;
  }
  if (!isNotFound(existing.error)) {
    throw new EstablishmentProfileError(`Não foi possível consultar o bucket de logos: ${errorText(existing.error)}`, 'STORAGE_BUCKET_FAILED', 503);
  }
  const created = await storage.createBucket(ESTABLISHMENT_LOGO_BUCKET, desired);
  if (created?.error && !isConflict(created.error)) {
    throw new EstablishmentProfileError(`Não foi possível criar o bucket de logos: ${errorText(created.error)}`, 'STORAGE_BUCKET_FAILED', 503);
  }
  if (created?.error && isConflict(created.error)) {
    const raced = await storage.getBucket(ESTABLISHMENT_LOGO_BUCKET);
    if (raced?.error) throw new EstablishmentProfileError(`O bucket de logos não ficou disponível após uma criação concorrente: ${errorText(raced.error)}`, 'STORAGE_BUCKET_FAILED', 503);
  }
  if (typeof storage.updateBucket === 'function') {
    const updated = await storage.updateBucket(ESTABLISHMENT_LOGO_BUCKET, desired);
    if (updated?.error) throw new EstablishmentProfileError(`Não foi possível configurar o bucket de logos: ${errorText(updated.error)}`, 'STORAGE_BUCKET_FAILED', 503);
  }
}

function canonicalPathForTenant(value: string, tenantId: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  const escapedTenant = tenantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|/)${escapedTenant}/[a-f0-9]{64}\\.(?:png|jpg|webp)$`);
  return pattern.test(value);
}

export function isCanonicalLogoReference(value: unknown, tenantId: string, supabaseUrl?: string): value is string {
  if (typeof value !== 'string' || !value || value.length > 600) return false;
  if (canonicalPathForTenant(value, tenantId)) return true;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  if (supabaseUrl) {
    try {
      if (new URL(supabaseUrl).origin !== parsed.origin) return false;
    } catch { return false; }
  }
  return canonicalPathForTenant(parsed.pathname, tenantId) && parsed.pathname.includes(`/storage/v1/object/public/${ESTABLISHMENT_LOGO_BUCKET}/`);
}

function isReadableLogoReference(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s<>"'\\]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function publicLogoReference(value: unknown, tenantId: string, supabaseUrl?: string): string {
  return isCanonicalLogoReference(value, tenantId, supabaseUrl) || isReadableLogoReference(value) ? value as string : '';
}

const isInlineLogo = (value: unknown): value is string =>
  typeof value === 'string' && /^data:image\//i.test(value);

export function hasLegacyLogoMetadata(user: AuthUserLike, supabaseUrl?: string): boolean {
  const metadata = cloneMetadata(user.user_metadata);
  const existing = metadata.logo_url;
  const readable = isCanonicalLogoReference(existing, String(user.id), supabaseUrl) || isReadableLogoReference(existing);
  return Boolean((existing !== undefined && existing !== null && existing !== '' && !readable) || isInlineLogo(metadata.logo));
}

async function uploadValidatedLogo(deps: EstablishmentProfileDependencies, tenantId: string, logo: ValidatedLogo): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) {
    throw new EstablishmentProfileError('Tenant inválido para armazenamento da logo.', 'TENANT_INVALID');
  }
  await ensureLogoBucket(deps.storage);
  const objectPath = `${tenantId}/${logo.sha256}.${logo.extension}`;
  const object = deps.storage.from(ESTABLISHMENT_LOGO_BUCKET);
  const uploaded = await object.upload(objectPath, logo.bytes, {
    contentType: logo.mimeType,
    cacheControl: '31536000',
    upsert: false,
  });
  if (uploaded?.error && !isConflict(uploaded.error)) {
    throw new EstablishmentProfileError(`Não foi possível armazenar a logo: ${errorText(uploaded.error)}`, 'STORAGE_UPLOAD_FAILED', 503);
  }
  const publicUrl = object.getPublicUrl(objectPath)?.data?.publicUrl;
  if (!publicUrl || !isCanonicalLogoReference(publicUrl, tenantId, deps.supabaseUrl)) {
    throw new EstablishmentProfileError('O Storage não retornou uma referência pública curta e válida para a logo.', 'STORAGE_URL_INVALID', 503);
  }
  return publicUrl;
}

export function profileFromUser(user: AuthUserLike, supabaseUrl?: string): EstablishmentProfile {
  const metadata = cloneMetadata(user.user_metadata);
  const fields = Object.fromEntries(ESTABLISHMENT_PROFILE_FIELDS.map((key) => [
    key,
    typeof metadata[key] === 'string' ? metadata[key] : '',
  ])) as EstablishmentProfileFields;
  const logo = metadata.logo_url;
  if (logo !== undefined && logo !== null && logo !== '' &&
      !isCanonicalLogoReference(logo, String(user.id), supabaseUrl) && !isReadableLogoReference(logo)) {
    throw new EstablishmentProfileError('A logo legada ainda não foi migrada; faça login novamente para concluir a recuperação.', 'LEGACY_LOGO_UNMIGRATED', 409);
  }
  if (isInlineLogo(metadata.logo)) {
    throw new EstablishmentProfileError('A sessão ainda contém uma cópia legada da logo; faça login novamente para concluir a recuperação.', 'LEGACY_LOGO_UNMIGRATED', 409);
  }
  return { ...(fields as EstablishmentProfile), logo_url: typeof logo === 'string' ? logo : '' };
}

export function brandingFromUser(user: AuthUserLike, supabaseUrl?: string): {
  establishmentName?: string;
  cnpj?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
} {
  const metadata = cloneMetadata(user.user_metadata);
  const branding: ReturnType<typeof brandingFromUser> = {};
  if (hasOwn(metadata, 'establishment_name')) branding.establishmentName = typeof metadata.establishment_name === 'string' ? metadata.establishment_name : '';
  if (hasOwn(metadata, 'cnpj')) branding.cnpj = typeof metadata.cnpj === 'string' ? metadata.cnpj : '';
  if (hasOwn(metadata, 'address')) branding.address = typeof metadata.address === 'string' ? metadata.address : '';
  if (hasOwn(metadata, 'phone_whatsapp')) branding.phone = typeof metadata.phone_whatsapp === 'string' ? metadata.phone_whatsapp : '';
  if (hasOwn(metadata, 'establishment_email')) branding.email = typeof metadata.establishment_email === 'string' ? metadata.establishment_email : '';
  if (isInlineLogo(metadata.logo)) {
    throw new EstablishmentProfileError('A logo legada ainda não foi migrada; faça login novamente para concluir a recuperação.', 'LEGACY_LOGO_UNMIGRATED', 409);
  }
  if (hasOwn(metadata, 'logo_url')) {
    const logo = metadata.logo_url;
    if (logo === '' || logo === null || logo === undefined) branding.logoUrl = '';
    else if (isCanonicalLogoReference(logo, String(user.id), supabaseUrl) || isReadableLogoReference(logo)) branding.logoUrl = logo;
    else throw new EstablishmentProfileError('A logo legada ainda não foi migrada; faça login novamente para concluir a recuperação.', 'LEGACY_LOGO_UNMIGRATED', 409);
  }
  return branding;
}

async function getCurrentUser(deps: EstablishmentProfileDependencies, userId: string): Promise<AuthUserLike> {
  const result = await deps.authAdmin.getUserById(userId);
  const user = result?.data?.user;
  if (result?.error || !user?.id) {
    throw new EstablishmentProfileError(`Não foi possível consultar o perfil autenticado: ${errorText(result?.error)}`, 'AUTH_USER_LOOKUP_FAILED', 503);
  }
  return user;
}

function validateMutation(input: ProfileMutation): ProfileMutation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new EstablishmentProfileError('Corpo do perfil inválido.');
  }
  if (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) {
    throw new EstablishmentProfileError('fields é obrigatório e deve ser um objeto.');
  }
  for (const key of Object.keys(input.fields)) {
    if (!(ESTABLISHMENT_PROFILE_FIELDS as readonly string[]).includes(key)) {
      throw new EstablishmentProfileError(`Campo de perfil não permitido: ${key}.`, 'PROFILE_FIELD_NOT_ALLOWED');
    }
    if (typeof input.fields[key as EstablishmentProfileField] !== 'string') {
      throw new EstablishmentProfileError(`O campo ${key} deve ser texto.`);
    }
    if (input.fields[key as EstablishmentProfileField]!.length > 500) {
      throw new EstablishmentProfileError(`O campo ${key} excede o limite permitido.`);
    }
  }
  if (input.removeLogo !== undefined && typeof input.removeLogo !== 'boolean') {
    throw new EstablishmentProfileError('removeLogo deve ser booleano.');
  }
  const hasLogo = input.logoDataUrl !== undefined;
  if (hasLogo && input.removeLogo === true) {
    throw new EstablishmentProfileError('Envie logoDataUrl ou removeLogo, nunca ambos.', 'PROFILE_LOGO_CONFLICT');
  }
  if (hasLogo && typeof input.logoDataUrl !== 'string') {
    throw new EstablishmentProfileError('logoDataUrl deve ser texto.');
  }
  return input;
}

export async function migrateLegacyLogo(
  deps: EstablishmentProfileDependencies,
  user: AuthUserLike,
): Promise<{ user: AuthUserLike; migrated: boolean; profile: EstablishmentProfile }> {
  const current = await getCurrentUser(deps, String(user.id));
  const metadata = cloneMetadata(current.user_metadata);
  const existing = metadata.logo_url;
  if (!hasLegacyLogoMetadata(current, deps.supabaseUrl)) {
    return { user: current, migrated: false, profile: profileFromUser(current, deps.supabaseUrl) };
  }
  const nextMetadata: Record<string, unknown> = { ...metadata };
  if (existing && !isReadableLogoReference(existing) &&
      !isCanonicalLogoReference(existing, String(current.id), deps.supabaseUrl)) {
    nextMetadata.logo_url = await uploadValidatedLogo(deps, String(current.id), validateLogoDataUrl(existing));
  }
  if (isInlineLogo(metadata.logo)) {
    // Preserve even a different secondary image in Storage, but never replace
    // a canonical logo or resurrect an explicitly removed logo_url: ''.
    const preservedUrl = await uploadValidatedLogo(deps, String(current.id), validateLogoDataUrl(metadata.logo));
    if (!hasOwn(metadata, 'logo_url')) nextMetadata.logo_url = preservedUrl;
    // GoTrue merges user_metadata: deleting the key from a patch would leave
    // its previous Base64 remotely intact. Empty is an intentional sentinel.
    nextMetadata.logo = '';
  }
  const updated = await deps.authAdmin.updateUserById(String(current.id), { user_metadata: nextMetadata });
  if (updated?.error) {
    throw new EstablishmentProfileError(`A logo foi armazenada, mas o perfil Auth não pôde ser atualizado: ${errorText(updated.error)}`, 'AUTH_METADATA_UPDATE_FAILED', 503);
  }
  const refreshed = await getCurrentUser(deps, String(current.id));
  assertMetadataPersisted(refreshed, nextMetadata);
  return { user: refreshed, migrated: true, profile: profileFromUser(refreshed, deps.supabaseUrl) };
}

function assertMetadataPersisted(user: AuthUserLike, expected: Record<string, unknown>): void {
  const actual = cloneMetadata(user.user_metadata);
  if (Object.keys(expected).some(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))) {
    throw new EstablishmentProfileError('O Auth não confirmou a persistência do perfil. Tente novamente.', 'AUTH_METADATA_NOT_CONFIRMED', 503);
  }
}

export function createEstablishmentProfileService(deps: EstablishmentProfileDependencies) {
  const mutationTails = new Map<string, Promise<unknown>>();
  const withTenantProfileLock = async <T>(userId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = mutationTails.get(userId);
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(operation);
    const tracked = current.finally(() => {
      if (mutationTails.get(userId) === tracked) mutationTails.delete(userId);
    });
    tracked.catch(() => undefined);
    mutationTails.set(userId, tracked);
    return current;
  };
  return {
    getUser: (userId: string) => getCurrentUser(deps, userId),
    getProfile: (userId: string) => withTenantProfileLock(userId, async () => {
      const user = await getCurrentUser(deps, userId);
      return { user, profile: profileFromUser(user, deps.supabaseUrl) };
    }),
    update: (userId: string, rawInput: ProfileMutation) => withTenantProfileLock(userId, async () => {
      const input = validateMutation(rawInput);
      const current = await getCurrentUser(deps, userId);
      // Uma alteração textual não pode ocultar uma logo legada inválida nem
      // retornar erro depois de persistir metade do perfil.
      profileFromUser(current, deps.supabaseUrl);
      const metadata = cloneMetadata(current.user_metadata);
      const nextMetadata = { ...metadata };
      for (const key of Object.keys(input.fields) as EstablishmentProfileField[]) {
        nextMetadata[key] = input.fields[key];
      }
      if (input.logoDataUrl !== undefined) {
        const validated = validateLogoDataUrl(input.logoDataUrl);
        nextMetadata.logo_url = await uploadValidatedLogo(deps, userId, validated);
      } else if (input.removeLogo === true) {
        nextMetadata.logo_url = '';
      }
      const updated = await deps.authAdmin.updateUserById(userId, { user_metadata: nextMetadata });
      if (updated?.error) throw new EstablishmentProfileError(`Não foi possível persistir o perfil: ${errorText(updated.error)}`, 'AUTH_METADATA_UPDATE_FAILED', 503);
      const refreshed = await getCurrentUser(deps, userId);
      assertMetadataPersisted(refreshed, nextMetadata);
      return { user: refreshed, profile: profileFromUser(refreshed, deps.supabaseUrl) };
    }),
    migrateLegacyLogo: (user: AuthUserLike) => withTenantProfileLock(String(user.id), () => migrateLegacyLogo(deps, user)),
  };
}

export type EstablishmentProfileService = ReturnType<typeof createEstablishmentProfileService>;
