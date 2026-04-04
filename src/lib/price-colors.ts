type PriceTone = 'cheap' | 'average' | 'expensive' | 'unknown';

type PriceScale = {
  cheapThreshold: number;
  expensiveThreshold: number;
  absoluteCheapestPrice: number | null;
};

export function getPriceScale(prices: Array<number | null | undefined>): PriceScale {
  const validPrices = prices
    .filter((price): price is number => typeof price === 'number')
    .sort((left, right) => left - right);

  if (validPrices.length === 0) {
    return {
      cheapThreshold: 0,
      expensiveThreshold: Infinity,
      absoluteCheapestPrice: null,
    };
  }

  const cheapIndex = Math.floor(validPrices.length * 0.2);
  const expensiveIndex = Math.floor(validPrices.length * 0.8);

  return {
    cheapThreshold: validPrices[cheapIndex] ?? validPrices[0],
    expensiveThreshold: validPrices[expensiveIndex] ?? validPrices[validPrices.length - 1],
    absoluteCheapestPrice: validPrices[0],
  };
}

export function getPriceTone(
  price: number | null | undefined,
  scale: PriceScale,
): PriceTone {
  if (typeof price !== 'number') {
    return 'unknown';
  }

  if (price <= scale.cheapThreshold) {
    return 'cheap';
  }

  if (price >= scale.expensiveThreshold) {
    return 'expensive';
  }

  return 'average';
}

export function getMapPriceColorClasses(tone: PriceTone) {
  switch (tone) {
    case 'cheap':
      return {
        bg: 'bg-emerald-600',
        hoverBg: 'group-hover:bg-emerald-700',
        border: 'border-t-emerald-600',
        hoverBorder: 'group-hover:border-t-emerald-700',
        ring: 'bg-emerald-600/30',
      };
    case 'expensive':
      return {
        bg: 'bg-rose-600',
        hoverBg: 'group-hover:bg-rose-700',
        border: 'border-t-rose-600',
        hoverBorder: 'group-hover:border-t-rose-700',
        ring: 'bg-rose-600/30',
      };
    case 'average':
      return {
        bg: 'bg-amber-500',
        hoverBg: 'group-hover:bg-amber-600',
        border: 'border-t-amber-500',
        hoverBorder: 'group-hover:border-t-amber-600',
        ring: 'bg-amber-500/30',
      };
    default:
      return {
        bg: 'bg-gray-500',
        hoverBg: 'group-hover:bg-gray-600',
        border: 'border-t-gray-500',
        hoverBorder: 'group-hover:border-t-gray-600',
        ring: 'bg-gray-500/30',
      };
  }
}

export function getPriceTextClassName(tone: PriceTone) {
  switch (tone) {
    case 'cheap':
      return 'text-emerald-700';
    case 'expensive':
      return 'text-rose-700';
    case 'average':
      return 'text-amber-600';
    default:
      return 'text-gray-900';
  }
}

export function getPriceSurfaceClassName(tone: PriceTone) {
  switch (tone) {
    case 'cheap':
      return 'border-emerald-100/70 bg-gradient-to-br from-emerald-50 to-emerald-50/40';
    case 'expensive':
      return 'border-rose-100/70 bg-gradient-to-br from-rose-50 to-rose-50/40';
    case 'average':
      return 'border-amber-100/70 bg-gradient-to-br from-amber-50 to-amber-50/40';
    default:
      return 'border-blue-100/50 bg-gradient-to-br from-blue-50 to-indigo-50/30';
  }
}
