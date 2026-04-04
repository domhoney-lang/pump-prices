const UK_LATITUDE_RANGE = {
  min: 49.5,
  max: 61.5,
} as const;

const UK_LONGITUDE_RANGE = {
  min: -8.75,
  max: 2.5,
} as const;

const ALLOWED_POSITIVE_LONGITUDE_PREFIXES = new Set([
  'CB',
  'CM',
  'CO',
  'CT',
  'IP',
  'ME',
  'NR',
  'PE',
  'SS',
  'TN',
  'TS',
  'YO',
]);

const FORCE_NEGATIVE_LONGITUDE_PREFIXES = new Set([
  'AB',
  'B',
  'BB',
  'BD',
  'BF',
  'BL',
  'BT',
  'CA',
  'DG',
  'DH',
  'G',
  'GL',
  'HS',
  'IV',
  'LA',
  'M',
  'ML',
  'NE',
  'OL',
  'PA',
  'PR',
  'SK',
  'SP',
  'WF',
  'WN',
  'WR',
  'WV',
  'ZE',
]);

export type NormalizedStationCoordinates = {
  lat: number;
  lng: number;
  wasSwapped: boolean;
  wasLongitudeMirrored: boolean;
};

function isFiniteCoordinate(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidUkStationCoordinate(lat: number, lng: number) {
  return (
    lat >= UK_LATITUDE_RANGE.min &&
    lat <= UK_LATITUDE_RANGE.max &&
    lng >= UK_LONGITUDE_RANGE.min &&
    lng <= UK_LONGITUDE_RANGE.max
  );
}

function getPostcodePrefix(postcode: string | null | undefined) {
  if (!postcode) {
    return null;
  }

  const outwardCode = postcode.trim().split(/\s+/)[0] ?? '';
  const lettersOnly = outwardCode.replace(/[^A-Za-z]/g, '').toUpperCase();

  if (lettersOnly.length === 0) {
    return null;
  }

  return lettersOnly.slice(0, Math.min(2, lettersOnly.length));
}

function shouldMirrorLongitude(lat: number, lng: number, postcode?: string | null) {
  if (lng <= 0.5) {
    return false;
  }

  const postcodePrefix = getPostcodePrefix(postcode);

  if (postcodePrefix && FORCE_NEGATIVE_LONGITUDE_PREFIXES.has(postcodePrefix)) {
    return true;
  }

  if (postcodePrefix && ALLOWED_POSITIVE_LONGITUDE_PREFIXES.has(postcodePrefix)) {
    return false;
  }

  return lat >= 50;
}

function finalizeNormalizedCoordinates(
  lat: number,
  lng: number,
  postcode?: string | null,
  options?: { wasSwapped?: boolean },
): NormalizedStationCoordinates | null {
  const shouldMirror = shouldMirrorLongitude(lat, lng, postcode);
  const normalizedLng = shouldMirror ? -lng : lng;

  if (!isValidUkStationCoordinate(lat, normalizedLng)) {
    return null;
  }

  return {
    lat,
    lng: normalizedLng,
    wasSwapped: options?.wasSwapped ?? false,
    wasLongitudeMirrored: shouldMirror,
  };
}

export function normalizeUkStationCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
  postcode?: string | null,
): NormalizedStationCoordinates | null {
  if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lng)) {
    return null;
  }

  if (isValidUkStationCoordinate(lat, lng)) {
    return finalizeNormalizedCoordinates(lat, lng, postcode);
  }

  if (isValidUkStationCoordinate(lng, lat)) {
    return finalizeNormalizedCoordinates(lng, lat, postcode, { wasSwapped: true });
  }

  return null;
}

