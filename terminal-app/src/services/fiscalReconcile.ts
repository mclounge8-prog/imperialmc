/** Чистая сверка «касса уже пробила / можно ли повторять sell». Без native/API. */

export function isSellLikeJob(type: string | null | undefined): boolean {
  return type === 'receipt' || type === 'receipt_return';
}

export function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

export function extractResponseFields(response: unknown): {
  fiscalDocNumber: number | null;
  fiscalSign: string | null;
  fiscalDatetime: string | null;
} {
  const root = asRecord(response);
  if (!root) {
    return { fiscalDocNumber: null, fiscalSign: null, fiscalDatetime: null };
  }
  const fp = asRecord(root.fiscalParams) ?? root;
  const doc = coerceNumber(fp.fiscalDocumentNumber ?? fp.documentNumber ?? null);
  const signRaw = fp.fiscalDocumentSign ?? fp.fiscalSign ?? null;
  const sign = signRaw == null || signRaw === '' ? null : String(signRaw);
  const dtRaw = fp.fiscalDocumentDateTime ?? null;
  const fiscalDatetime = typeof dtRaw === 'string' && dtRaw ? dtRaw : null;
  return { fiscalDocNumber: doc, fiscalSign: sign, fiscalDatetime };
}

/** Для sell достаточно номера ФД. ФПД часто пустой в IPC-обёртке — из‑за этого раньше уходил повтор. */
export function receiptHasFiscalDoc(
  fields: { fiscalDocNumber: number | null },
  jobType: string
): boolean {
  if (!isSellLikeJob(jobType)) return true;
  return fields.fiscalDocNumber != null && fields.fiscalDocNumber > 0;
}

/**
 * Повторный sell нельзя слать, если на ФН уже есть документ новее последнего
 * записанного в нашу очередь — это почти наверняка «призрак» первой попытки.
 */
export function shouldAdoptLastDocument(args: {
  jobType: string;
  attempts: number;
  venueLastFiscalDocNumber: number | null | undefined;
  lastDocNumber: number | null | undefined;
}): boolean {
  if (!isSellLikeJob(args.jobType)) return false;
  if ((args.attempts || 0) < 2) return false;
  const last = args.lastDocNumber ?? 0;
  if (last <= 0) return false;
  const watermark = args.venueLastFiscalDocNumber ?? 0;
  return last > watermark;
}
