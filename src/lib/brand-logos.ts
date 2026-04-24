export type BrandLogoKey =
  | 'asda'
  | 'bp'
  | 'costco'
  | 'esso'
  | 'gulf'
  | 'jet'
  | 'morrisons'
  | 'sainsburys'
  | 'shell'
  | 'tesco'
  | 'texaco';

type BrandLogoDefinition = {
  key: BrandLogoKey;
  displayName: string;
  src: string;
  aliases: string[];
  snapshotStationCount: number;
};

const BRAND_LOGOS: Record<BrandLogoKey, BrandLogoDefinition> = {
  esso: {
    key: 'esso',
    displayName: 'Esso',
    src: '/brands/esso%20svg.svg',
    aliases: ['esso'],
    snapshotStationCount: 1365,
  },
  bp: {
    key: 'bp',
    displayName: 'BP',
    src: '/brands/bp%20svg.svg',
    aliases: ['bp', 'british petroleum'],
    snapshotStationCount: 877,
  },
  costco: {
    key: 'costco',
    displayName: 'Costco Wholesale',
    src: '/brands/costco%20svg.svg',
    aliases: ['costco', 'costco wholesale'],
    snapshotStationCount: 20,
  },
  shell: {
    key: 'shell',
    displayName: 'Shell',
    src: '/brands/shell%20svg.svg',
    aliases: ['shell'],
    snapshotStationCount: 780,
  },
  tesco: {
    key: 'tesco',
    displayName: 'Tesco',
    src: '/brands/tesco%20svg.svg',
    aliases: ['tesco', 'tesco petrol'],
    snapshotStationCount: 516,
  },
  texaco: {
    key: 'texaco',
    displayName: 'Texaco',
    src: '/brands/texaco%20svg.svg',
    aliases: ['texaco'],
    snapshotStationCount: 427,
  },
  morrisons: {
    key: 'morrisons',
    displayName: 'Morrisons',
    src: '/brands/morrisons%20svg.svg',
    aliases: ['morrisons'],
    snapshotStationCount: 340,
  },
  asda: {
    key: 'asda',
    displayName: 'Asda',
    src: '/brands/asda%20svg.svg',
    aliases: ['asda', 'asda express'],
    snapshotStationCount: 321,
  },
  sainsburys: {
    key: 'sainsburys',
    displayName: "Sainsbury's",
    src: '/brands/sainsburys%20svg.svg',
    aliases: ["sainsbury's", 'sainsburys', 'sainsbury'],
    snapshotStationCount: 316,
  },
  jet: {
    key: 'jet',
    displayName: 'Jet',
    src: '/brands/jet%20svg.svg',
    aliases: ['jet'],
    snapshotStationCount: 224,
  },
  gulf: {
    key: 'gulf',
    displayName: 'Gulf',
    src: '/brands/gulf%20svg.svg',
    aliases: ['gulf'],
    snapshotStationCount: 213,
  },
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

// Snapshot counts from the current station dataset, used to freeze the initial top-10 rollout.

export function normalizeBrandName(rawBrand: string | null | undefined) {
  if (!rawBrand) {
    return null;
  }

  const normalized = normalizeWhitespace(
    rawBrand
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, ' '),
  );

  return normalized || null;
}

const logoKeyByAlias = new Map<string, BrandLogoKey>();

for (const brand of Object.values(BRAND_LOGOS)) {
  for (const alias of brand.aliases) {
    const normalizedAlias = normalizeBrandName(alias);

    if (!normalizedAlias) {
      continue;
    }

    logoKeyByAlias.set(normalizedAlias, brand.key);
  }
}

export function getBrandLogo(rawBrand: string | null | undefined) {
  const normalizedBrand = normalizeBrandName(rawBrand);

  if (!normalizedBrand) {
    return null;
  }

  const key = logoKeyByAlias.get(normalizedBrand);

  return key ? BRAND_LOGOS[key] : null;
}

export function hasBrandLogo(rawBrand: string | null | undefined) {
  return getBrandLogo(rawBrand) !== null;
}

export function getBrandMonogram(rawBrand: string | null | undefined) {
  const brand = getBrandLogo(rawBrand)?.displayName ?? rawBrand ?? '';
  const tokens = normalizeWhitespace(brand.replace(/[’']/g, ''))
    .split(' ')
    .filter(Boolean);

  if (tokens.length === 0) {
    return '?';
  }

  if (tokens.length === 1) {
    return tokens[0]!.slice(0, 2).toUpperCase();
  }

  return `${tokens[0]![0] ?? ''}${tokens[1]![0] ?? ''}`.toUpperCase();
}

export const topBrandLogos = Object.values(BRAND_LOGOS).sort(
  (left, right) => right.snapshotStationCount - left.snapshotStationCount,
);
