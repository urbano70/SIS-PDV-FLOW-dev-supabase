// Backup automático das tabelas críticas para o Supabase Storage
// Roda no servidor Node.js — nunca expor ao browser.
// Bucket: "backups" (criar no Supabase Storage com acesso privado)

import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'backups';
const TABELAS_CRITICAS = ['orders', 'fiscal_notes', 'config', 'tables', 'comandas'];
const RETENCAO_DIAS = 7;

export interface BackupResult {
  arquivo: string;
  tamanho: number;
  tabelas: Record<string, number>; // tabela → quantidade de linhas
  erros: string[];
}

export async function executarBackup(db: SupabaseClient): Promise<BackupResult> {
  const agora = new Date();
  const timestamp = agora.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const arquivo = `backup-${timestamp}.json`;

  const snapshot: Record<string, unknown[]> = {};
  const contagens: Record<string, number> = {};
  const erros: string[] = [];

  // Exportar cada tabela
  for (const tabela of TABELAS_CRITICAS) {
    try {
      let todas: unknown[] = [];
      let pagina = 0;
      const TAMANHO_PAGINA = 1000;

      // Paginar para tabelas grandes
      while (true) {
        const { data, error } = await db
          .from(tabela)
          .select('*')
          .range(pagina * TAMANHO_PAGINA, (pagina + 1) * TAMANHO_PAGINA - 1);

        if (error) { erros.push(`${tabela}: ${error.message}`); break; }
        if (!data || data.length === 0) break;

        todas = todas.concat(data);
        if (data.length < TAMANHO_PAGINA) break;
        pagina++;
      }

      snapshot[tabela] = todas;
      contagens[tabela] = todas.length;
    } catch (e: any) {
      erros.push(`${tabela}: ${e.message}`);
    }
  }

  const payload = JSON.stringify({
    geradoEm: agora.toISOString(),
    versao: 1,
    tabelas: snapshot,
  });

  const bytes = Buffer.from(payload, 'utf8');

  // Upload para Supabase Storage
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(arquivo, bytes, {
      contentType: 'application/json',
      upsert: false,
    });

  if (uploadError) {
    // Se o bucket não existe ainda, tentar criar e reenviar
    if (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket')) {
      await db.storage.createBucket(BUCKET, { public: false });
      await db.storage.from(BUCKET).upload(arquivo, bytes, { contentType: 'application/json', upsert: false });
    } else {
      erros.push(`upload: ${uploadError.message}`);
    }
  }

  // Remover backups com mais de RETENCAO_DIAS dias
  await limparBackupsAntigos(db, agora);

  return { arquivo, tamanho: bytes.length, tabelas: contagens, erros };
}

async function limparBackupsAntigos(db: SupabaseClient, agora: Date): Promise<void> {
  try {
    const { data: lista } = await db.storage.from(BUCKET).list('', { limit: 200 });
    if (!lista) return;

    const limite = new Date(agora.getTime() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
    const expirados = lista
      .filter(f => f.created_at && new Date(f.created_at) < limite)
      .map(f => f.name);

    if (expirados.length > 0) {
      await db.storage.from(BUCKET).remove(expirados);
      console.log(`[backup] ${expirados.length} arquivo(s) antigo(s) removido(s)`);
    }
  } catch {
    // Falha na limpeza não é crítica
  }
}

/** Agenda backup diário. Chama no startup do servidor. */
export function agendarBackupDiario(db: SupabaseClient): void {
  const INTERVALO_MS = 24 * 60 * 60 * 1000; // 24 horas

  // Primeiro backup: 5 minutos após o startup (deixa o servidor estabilizar)
  setTimeout(async () => {
    await rodarBackup(db);
    // Depois, repetir a cada 24h
    setInterval(() => rodarBackup(db), INTERVALO_MS);
  }, 5 * 60 * 1000);

  console.log('[backup] Agendado: próximo backup em ~5 min, depois a cada 24h');
}

async function rodarBackup(db: SupabaseClient): Promise<void> {
  console.log('[backup] Iniciando backup das tabelas críticas...');
  try {
    const resultado = await executarBackup(db);
    const linhas = Object.entries(resultado.tabelas)
      .map(([t, n]) => `${t}:${n}`)
      .join(', ');
    console.log(`[backup] Concluído → ${resultado.arquivo} (${(resultado.tamanho / 1024).toFixed(1)} KB) | ${linhas}`);
    if (resultado.erros.length > 0) {
      console.warn('[backup] Avisos:', resultado.erros.join('; '));
    }
  } catch (e: any) {
    console.error('[backup] Falha:', e.message);
  }
}
