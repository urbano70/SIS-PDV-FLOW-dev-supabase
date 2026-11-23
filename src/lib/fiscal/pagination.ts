export const FISCAL_EXPORT_PAGE_SIZE = 500;
export const FISCAL_EXPORT_MAX_RECORDS = 10_000;

export class FiscalExportPaginationLimitError extends Error {
  readonly resource: string;
  readonly maxRecords: number;

  constructor(resource: string, maxRecords = FISCAL_EXPORT_MAX_RECORDS) {
    super(`A exportação fiscal excede o limite seguro de ${maxRecords} registros em ${resource}; nenhum arquivo foi gerado.`);
    this.name = 'FiscalExportPaginationLimitError';
    this.resource = resource;
    this.maxRecords = maxRecords;
  }
}

interface ReadTenantRowsOptions<T> {
  resource: string;
  pageSize?: number;
  maxRecords?: number;
  fetchPage: (from: number, to: number) => Promise<T[]>;
  hasAdditionalRow: (offset: number) => Promise<boolean>;
}

/** Reads bounded tenant pages and refuses to return an ambiguous full result. */
export async function readTenantRows<T>({
  resource,
  pageSize = FISCAL_EXPORT_PAGE_SIZE,
  maxRecords = FISCAL_EXPORT_MAX_RECORDS,
  fetchPage,
  hasAdditionalRow,
}: ReadTenantRowsOptions<T>): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Tamanho de página fiscal inválido.');
  if (!Number.isInteger(maxRecords) || maxRecords < pageSize) throw new Error('Limite fiscal inválido.');

  const rows: T[] = [];
  for (let offset = 0; offset < maxRecords; offset += pageSize) {
    const page = await fetchPage(offset, Math.min(offset + pageSize - 1, maxRecords - 1));
    if (page.length > pageSize) throw new Error(`A consulta fiscal retornou uma página maior que ${pageSize} registros.`);
    rows.push(...page);
    if (page.length < pageSize) return rows;

    if (rows.length >= maxRecords) {
      if (await hasAdditionalRow(maxRecords)) throw new FiscalExportPaginationLimitError(resource, maxRecords);
      return rows;
    }
  }

  return rows;
}
