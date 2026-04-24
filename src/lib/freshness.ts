export type FreshnessBand = 'fresh' | 'still-good' | 'stale';
export type FreshnessLabel = 'Fresh' | 'Still good' | 'Stale';

export type FreshnessTone = {
  band: FreshnessBand;
  badgeClassName: string;
  label: FreshnessLabel;
};

export function getFreshnessTone(updatedAt: Date | string, now = new Date()): FreshnessTone {
  const timestamp = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const ageHours = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);

  if (ageHours < 48) {
    return {
      band: 'fresh',
      badgeClassName: 'bg-emerald-100 text-emerald-700',
      label: 'Fresh',
    };
  }

  if (ageHours < 144) {
    return {
      band: 'still-good',
      badgeClassName: 'bg-amber-100 text-amber-700',
      label: 'Still good',
    };
  }

  return {
    band: 'stale',
    badgeClassName: 'bg-rose-100 text-rose-700',
    label: 'Stale',
  };
}

export function formatFreshnessBandLabel(band: FreshnessBand | null | undefined): FreshnessLabel | null {
  switch (band) {
    case 'fresh':
      return 'Fresh';
    case 'still-good':
      return 'Still good';
    case 'stale':
      return 'Stale';
    default:
      return null;
  }
}
