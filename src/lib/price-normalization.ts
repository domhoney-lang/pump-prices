export const MIN_REASONABLE_PRICE_PENCE = 80;
export const MAX_REASONABLE_PRICE_PENCE = 300;
export const MIN_REASONABLE_PRICE_POUNDS = 0.8;
export const MAX_REASONABLE_PRICE_POUNDS = 3;
export const MIN_PENCE_WITH_MISSING_DECIMAL = 800;
export const MAX_PENCE_WITH_MISSING_DECIMAL = 3000;

export type PriceNormalizationReason = 'already-pence' | 'converted-from-pounds' | 'fixed-decimal';

export type PriceNormalizationResult = {
  normalizedPrice: number;
  reason: PriceNormalizationReason;
};

export function normalizeFuelPriceValue(price: number): PriceNormalizationResult | null {
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  if (price >= MIN_REASONABLE_PRICE_PENCE && price <= MAX_REASONABLE_PRICE_PENCE) {
    return {
      normalizedPrice: price,
      reason: 'already-pence',
    };
  }

  if (price >= MIN_REASONABLE_PRICE_POUNDS && price <= MAX_REASONABLE_PRICE_POUNDS) {
    return {
      normalizedPrice: Number((price * 100).toFixed(3)),
      reason: 'converted-from-pounds',
    };
  }

  if (price >= MIN_PENCE_WITH_MISSING_DECIMAL && price <= MAX_PENCE_WITH_MISSING_DECIMAL) {
    return {
      normalizedPrice: Number((price / 10).toFixed(3)),
      reason: 'fixed-decimal',
    };
  }

  return null;
}
