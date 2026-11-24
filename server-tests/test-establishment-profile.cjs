#!/usr/bin/env node
'use strict';

require('tsx/cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ESTABLISHMENT_LOGO_BUCKET,
  LOGO_ALLOWED_MIME_TYPES,
  MAX_LOGO_BYTES,
  createEstablishmentProfileService,
  EstablishmentProfileError,
  isCanonicalLogoReference,
  validateLogoDataUrl,
} = require('../src/server/establishment-profile.ts');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const SUPABASE_URL = 'https://project.supabase.co';

// JPEG mínimo com SOF0 16x16: a validação não depende de biblioteca de imagem.
const jpegBytes = Buffer.from('ffd8ffc00011080010001003011100021100031100ffd9', 'hex');
const jpegDataUrl = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;
const svgDataUrl = 'data:image/svg+xml;base64,PHN2Zy8+';

const clone = (value) => value === undefined ? value : JSON.parse(JSON.stringify(value));

function makeFixture({ users = {}, bucketInitiallyExists = false, createConflict = false } = {}) {
  const state = {
    users: new Map(Object.entries(users).map(([id, user]) => [id, clone(user)])),
    bucketExists: bucketInitiallyExists,
    createConflict,
    bucketCalls: [],
    createCalls: [],
    updateBucketCalls: [],
    uploads: [],
    uploadFailures: 0,
    updateFailures: 0,
    silentWriteFailures: 0,
  };
  const storage = {
    async getBucket(bucket) {
      state.bucketCalls.push(bucket);
      return state.bucketExists
        ? { data: { id: bucket }, error: null }
        : { data: null, error: { status: 404, message: 'Bucket not found' } };
    },
    async createBucket(bucket, options) {
      state.createCalls.push({ bucket, options: clone(options) });
      state.bucketExists = true;
      return state.createConflict
        ? { data: null, error: { status: 409, message: 'Bucket already exists' } }
        : { data: { id: bucket }, error: null };
    },
    async updateBucket(bucket, options) {
      state.updateBucketCalls.push({ bucket, options: clone(options) });
      return { data: { id: bucket }, error: null };
    },
    from(bucket) {
      assert.equal(bucket, ESTABLISHMENT_LOGO_BUCKET);
      return {
        async upload(objectPath, bytes, options) {
          state.uploads.push({ objectPath, bytes: Buffer.from(bytes), options: clone(options) });
          if (state.uploadFailures > 0) {
            state.uploadFailures--;
            return { data: null, error: { status: 503, message: 'temporary storage failure' } };
          }
          const duplicate = state.uploads.filter((entry) => entry.objectPath === objectPath).length > 1;
          return duplicate
            ? { data: null, error: { status: 409, message: 'The object already exists' } }
            : { data: { path: objectPath }, error: null };
        },
        getPublicUrl(objectPath) {
          return { data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${ESTABLISHMENT_LOGO_BUCKET}/${objectPath}` } };
        },
      };
    },
  };
  const authAdmin = {
    async getUserById(userId) {
      const user = state.users.get(userId);
      return user ? { data: { user: clone(user) }, error: null } : { data: { user: null }, error: new Error('user not found') };
    },
    async updateUserById(userId, attributes) {
      if (state.updateFailures > 0) {
        state.updateFailures--;
        return { data: null, error: new Error('metadata write failed') };
      }
      const current = state.users.get(userId);
      assert.ok(current, 'fixture user must exist');
      // Simula o contrato Admin Auth: somente user_metadata foi solicitado;
      // app_metadata e campos não relacionados permanecem intactos.
      if (state.silentWriteFailures > 0) state.silentWriteFailures--;
      else state.users.set(userId, { ...current,
        user_metadata: { ...current.user_metadata, ...clone(attributes.user_metadata) },
      });
      return { data: { user: clone(state.users.get(userId)) }, error: null };
    },
  };
  return {
    state,
    service: createEstablishmentProfileService({ authAdmin, storage, supabaseUrl: SUPABASE_URL }),
  };
}

function user(id, metadata) {
  return {
    id,
    email: `${id}@example.test`,
    app_metadata: { provider: 'email', plan_guard: 'premium' },
    user_metadata: metadata,
  };
}

(async () => {
  const validated = validateLogoDataUrl(jpegDataUrl);
  assert.equal(validated.mimeType, 'image/jpeg');
  assert.equal(validated.extension, 'jpg');
  assert.equal(validated.width, 16);
  assert.equal(validated.height, 16);
  assert.equal(validated.bytes.length, jpegBytes.length);
  assert.throws(() => validateLogoDataUrl(svgDataUrl), /SVG não é aceito/);
  assert.throws(() => validateLogoDataUrl('data:image/jpeg;base64,not base64'), EstablishmentProfileError);

  const fixture = makeFixture({
    createConflict: true,
    users: {
      [TENANT_A]: user(TENANT_A, {
        plan: 'premium',
        establishment_name: 'A',
        responsible_name: 'Responsável A',
        logo_url: '',
      }),
      [TENANT_B]: user(TENANT_B, {
        plan: 'free',
        establishment_name: 'B',
        logo_url: '',
      }),
    },
  });

  const first = await fixture.service.update(TENANT_A, {
    fields: { establishment_name: 'A atualizado', cnpj: '111' },
    logoDataUrl: jpegDataUrl,
  });
  assert.equal(first.profile.establishment_name, 'A atualizado');
  assert.match(first.profile.logo_url, new RegExp(`/${TENANT_A}/[a-f0-9]{64}\\.jpg$`));
  assert.equal(fixture.state.users.get(TENANT_A).user_metadata.plan, 'premium');
  assert.equal(fixture.state.users.get(TENANT_A).user_metadata.responsible_name, 'Responsável A');
  assert.deepEqual(fixture.state.users.get(TENANT_A).app_metadata, { provider: 'email', plan_guard: 'premium' });
  assert.equal(fixture.state.createCalls[0].bucket, ESTABLISHMENT_LOGO_BUCKET);
  assert.equal(fixture.state.createCalls[0].options.public, true);
  assert.equal(fixture.state.createCalls[0].options.fileSizeLimit, MAX_LOGO_BYTES);
  assert.deepEqual(fixture.state.createCalls[0].options.allowedMimeTypes, [...LOGO_ALLOWED_MIME_TYPES]);
  assert.equal(fixture.state.bucketCalls.length, 2, 'getBucket inicial + confirmação do conflito de criação');
  assert.equal(fixture.state.uploads[0].objectPath, `${TENANT_A}/${validated.sha256}.jpg`);
  assert.equal(fixture.state.uploads[0].options.upsert, false, 'objetos são imutáveis');

  const retry = await fixture.service.update(TENANT_A, { fields: {}, logoDataUrl: jpegDataUrl });
  assert.equal(retry.profile.logo_url, first.profile.logo_url, 'mesmo conteúdo reutiliza referência imutável');
  assert.equal(fixture.state.uploads.length, 2);
  assert.equal(fixture.state.users.get(TENANT_A).user_metadata.plan, 'premium');

  const second = await fixture.service.update(TENANT_B, { fields: {}, logoDataUrl: jpegDataUrl });
  assert.notEqual(second.profile.logo_url, first.profile.logo_url, 'tenants não compartilham referência');
  assert.match(second.profile.logo_url, new RegExp(`/${TENANT_B}/[a-f0-9]{64}\\.jpg$`));

  const beforeFailure = clone(fixture.state.users.get(TENANT_A).user_metadata);
  fixture.state.uploadFailures = 1;
  await assert.rejects(
    fixture.service.update(TENANT_A, { fields: { address: 'não persistir' }, logoDataUrl: jpegDataUrl }),
    (error) => error.code === 'STORAGE_UPLOAD_FAILED',
  );
  assert.deepEqual(fixture.state.users.get(TENANT_A).user_metadata, beforeFailure, 'falha de upload não altera metadata');

  fixture.state.updateFailures = 1;
  await assert.rejects(
    fixture.service.update(TENANT_A, { fields: { address: 'também não persistir' }, logoDataUrl: jpegDataUrl }),
    (error) => error.code === 'AUTH_METADATA_UPDATE_FAILED',
  );
  assert.equal(fixture.state.uploads.at(-1).objectPath, `${TENANT_A}/${validated.sha256}.jpg`, 'asset fica disponível para retry');
  assert.deepEqual(fixture.state.users.get(TENANT_A).user_metadata, beforeFailure, 'falha Auth preserva metadata anterior');

  const removed = await fixture.service.update(TENANT_A, { fields: { address: 'endereço novo' }, removeLogo: true });
  assert.equal(removed.profile.logo_url, '');
  assert.equal(removed.profile.address, 'endereço novo');
  assert.equal(fixture.state.users.get(TENANT_A).user_metadata.plan, 'premium');
  assert.equal(fixture.state.users.get(TENANT_A).user_metadata.responsible_name, 'Responsável A');
  assert.equal(fixture.state.uploads.length, 5, 'remoção não apaga nem altera assets');

  const legacy = makeFixture({
    users: {
      [TENANT_A]: user(TENANT_A, { plan: 'premium', establishment_name: 'Legado', logo_url: jpegDataUrl }),
    },
  });
  const migrated = await legacy.service.migrateLegacyLogo(await legacy.service.getUser(TENANT_A));
  assert.equal(migrated.migrated, true);
  assert.match(migrated.profile.logo_url, new RegExp(`/${TENANT_A}/[a-f0-9]{64}\\.jpg$`));
  const migratedAgain = await legacy.service.migrateLegacyLogo(await legacy.service.getUser(TENANT_A));
  assert.equal(migratedAgain.migrated, false, 'migração é idempotente após referência curta');
  assert.equal(legacy.state.uploads.length, 1);
  assert.equal(legacy.state.users.get(TENANT_A).user_metadata.plan, 'premium');

  const legacyField = makeFixture({
    users: {
      [TENANT_A]: user(TENANT_A, { plan: 'premium', logo: jpegDataUrl }),
    },
  });
  const legacyFieldMigration = await legacyField.service.migrateLegacyLogo(await legacyField.service.getUser(TENANT_A));
  assert.equal(legacyFieldMigration.migrated, true);
  assert.equal(legacyField.state.users.get(TENANT_A).user_metadata.logo, '', 'sentinela remove a Base64 mesmo com merge GoTrue');
  assert.match(legacyFieldMigration.profile.logo_url, new RegExp(`/${TENANT_A}/[a-f0-9]{64}\\.jpg$`));

  const concurrent = makeFixture({
    users: { [TENANT_A]: user(TENANT_A, { plan: 'premium', logo_url: jpegDataUrl }) },
  });
  const concurrentUser = await concurrent.service.getUser(TENANT_A);
  const migrating = concurrent.service.migrateLegacyLogo(concurrentUser);
  const removing = concurrent.service.update(TENANT_A, { fields: {}, removeLogo: true });
  await Promise.allSettled([migrating, removing]);
  assert.equal(concurrent.state.users.get(TENANT_A).user_metadata.logo_url, '', 'remoção concorrente não pode ser ressuscitada pela migração');

  const invalidLegacy = makeFixture({ users: { [TENANT_A]: user(TENANT_A, { logo_url: svgDataUrl, plan: 'premium' }) } });
  await assert.rejects(
    invalidLegacy.service.migrateLegacyLogo(await invalidLegacy.service.getUser(TENANT_A)),
    (error) => error.code === 'LOGO_DATA_URL_INVALID',
  );
  assert.equal(invalidLegacy.state.uploads.length, 0, 'SVG legado falha antes do upload e não é descartado');

  assert.equal(isCanonicalLogoReference(first.profile.logo_url, TENANT_A, SUPABASE_URL), true);
  assert.equal(isCanonicalLogoReference(first.profile.logo_url, TENANT_B, SUPABASE_URL), false);
  assert.equal(isCanonicalLogoReference('https://evil.example/tenant-a/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', TENANT_A, SUPABASE_URL), false);

  const existingUrl = 'https://cdn.example.test/existing-brand.jpg';
  const safeExisting = makeFixture({ users: { [TENANT_A]: user(TENANT_A,
    { logo_url: existingUrl, logo: 'unrelated text', plan: 'premium' }) } });
  const preservedExisting = await safeExisting.service.migrateLegacyLogo(await safeExisting.service.getUser(TENANT_A));
  assert.equal(preservedExisting.migrated, false);
  assert.equal(preservedExisting.profile.logo_url, existingUrl);
  assert.equal(safeExisting.state.users.get(TENANT_A).user_metadata.logo, 'unrelated text');
  const removedWithSecondary = makeFixture({ users: { [TENANT_A]: user(TENANT_A,
    { logo_url: '', logo: jpegDataUrl, plan: 'premium' }) } });
  const noResurrection = await removedWithSecondary.service.migrateLegacyLogo(await removedWithSecondary.service.getUser(TENANT_A));
  assert.equal(noResurrection.profile.logo_url, '');
  assert.equal(removedWithSecondary.state.uploads.length, 1, 'preservar imagem secundaria fora Auth antes limpar');
  const canonicalWithSecondary = makeFixture({ users: { [TENANT_A]: user(TENANT_A,
    { logo_url: first.profile.logo_url, logo: jpegDataUrl, plan: 'premium' }) } });
  const noReplace = await canonicalWithSecondary.service.migrateLegacyLogo(await canonicalWithSecondary.service.getUser(TENANT_A));
  assert.equal(noReplace.profile.logo_url, first.profile.logo_url);
  fixture.state.silentWriteFailures = 1;
  await assert.rejects(fixture.service.update(TENANT_A, { fields: { address: 'unconfirmed' } }),
    error => error.code === 'AUTH_METADATA_NOT_CONFIRMED');
  assert.equal(fixture.state.users.get(TENANT_A).user_metadata.address, 'endereço novo');

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
  assert.match(serverSource, /\/api\/establishment\/profile/);
  assert.match(serverSource, /issueAuthGrant\('refresh_token'/);
  assert.match(serverSource, /migrateGrantBeforeResponse/);
  assert.match(serverSource, /user: cleanPayload\.user/);
  assert.match(serverSource, /publicEstablishmentProfile/);
  const helperSource = fs.readFileSync(path.join(__dirname, '..', 'src/server/establishment-profile.ts'), 'utf8');
  assert.match(helperSource, /upsert: false/);
  assert.ok(!serverSource.includes("emit('update_establishment_profile', { tenantId, profile });"), 'broadcast não pode transportar metadata privada inteira');

  console.log('test-establishment-profile: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
