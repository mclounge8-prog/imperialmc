import {
  extractResponseFields,
  isSellLikeJob,
  receiptHasFiscalDoc,
  shouldAdoptLastDocument,
} from '../src/services/fiscalReconcile';

describe('fiscalReconcile', () => {
  test('isSellLikeJob', () => {
    expect(isSellLikeJob('receipt')).toBe(true);
    expect(isSellLikeJob('receipt_return')).toBe(true);
    expect(isSellLikeJob('close_shift')).toBe(false);
  });

  test('extracts fiscalParams and treats missing sign as empty', () => {
    expect(
      extractResponseFields({
        fiscalParams: { fiscalDocumentNumber: 5931, fiscalDocumentSign: '' },
      })
    ).toEqual({ fiscalDocNumber: 5931, fiscalSign: null, fiscalDatetime: null });
  });

  test('receipt is complete with document number only', () => {
    expect(receiptHasFiscalDoc({ fiscalDocNumber: 5931 }, 'receipt')).toBe(true);
    expect(receiptHasFiscalDoc({ fiscalDocNumber: null }, 'receipt')).toBe(false);
    expect(receiptHasFiscalDoc({ fiscalDocNumber: null }, 'cash_in')).toBe(true);
  });

  test('adopts last FN document only on retry when it is newer than watermark', () => {
    expect(
      shouldAdoptLastDocument({
        jobType: 'receipt',
        attempts: 2,
        venueLastFiscalDocNumber: 5930,
        lastDocNumber: 5931,
      })
    ).toBe(true);
    expect(
      shouldAdoptLastDocument({
        jobType: 'receipt',
        attempts: 2,
        venueLastFiscalDocNumber: 5930,
        lastDocNumber: 5930,
      })
    ).toBe(false);
    expect(
      shouldAdoptLastDocument({
        jobType: 'receipt',
        attempts: 1,
        venueLastFiscalDocNumber: 5930,
        lastDocNumber: 5931,
      })
    ).toBe(false);
  });
});
