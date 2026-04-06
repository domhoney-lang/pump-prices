'use server';

import {
  getRequiredLocationIqApiKey,
  LOCATIONIQ_AUTOCOMPLETE_URL,
  LOCATIONIQ_SEARCH_URL,
} from '@/lib/locationiq';

const LOCATION_SEARCH_TIMEOUT_MS = 5_000;
const LOCATION_SEARCH_CACHE_TTL_MS = 5 * 60_000;
const MINIMUM_QUERY_LENGTH = 2;

export type LocationSearchResult = {
  lat: number;
  lng: number;
  label: string;
};

type LocationIqSearchResponse = {
  lat: string;
  lon: string;
  display_name: string;
};

type LocationIqErrorResponse = {
  error?: string;
};

type LocationSearchCacheEntry = {
  expiresAt: number;
  results: LocationSearchResult[];
};

const locationSearchCache = new Map<string, LocationSearchCacheEntry>();

function normalizeLocationQuery(query: string) {
  const collapsedWhitespace = query.trim().replace(/\s+/g, ' ');

  if (collapsedWhitespace.length < MINIMUM_QUERY_LENGTH) {
    return collapsedWhitespace;
  }

  const postcodeCandidate = collapsedWhitespace.toUpperCase().replace(/\s+/g, '');

  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(postcodeCandidate)) {
    return `${postcodeCandidate.slice(0, -3)} ${postcodeCandidate.slice(-3)}`;
  }

  return collapsedWhitespace;
}

function getCachedLocationSearchResults(cacheKey: string) {
  const cachedEntry = locationSearchCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    locationSearchCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.results;
}

function setCachedLocationSearchResults(cacheKey: string, results: LocationSearchResult[]) {
  locationSearchCache.set(cacheKey, {
    expiresAt: Date.now() + LOCATION_SEARCH_CACHE_TTL_MS,
    results,
  });
}

function toLocationSearchResults(matches: LocationIqSearchResponse[]) {
  return matches
    .map((match) => {
      const lat = Number(match.lat);
      const lng = Number(match.lon);

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return null;
      }

      return {
        lat,
        lng,
        label: match.display_name,
      } satisfies LocationSearchResult;
    })
    .filter((match): match is LocationSearchResult => match !== null);
}

async function fetchLocationMatches(
  query: string,
  limit: number,
  endpoint: 'search' | 'autocomplete',
): Promise<{ results?: LocationSearchResult[]; error?: string }> {
  const normalizedQuery = normalizeLocationQuery(query);

  if (normalizedQuery.length < MINIMUM_QUERY_LENGTH) {
    return {
      error: 'Enter at least 2 characters to search.',
    };
  }

  const cacheKey = `${endpoint}:${limit}:${normalizedQuery.toLowerCase()}`;
  const cachedResults = getCachedLocationSearchResults(cacheKey);

  if (cachedResults) {
    return { results: cachedResults };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, LOCATION_SEARCH_TIMEOUT_MS);

  try {
    const searchParams = new URLSearchParams({
      key: getRequiredLocationIqApiKey(),
      q: normalizedQuery,
      limit: String(limit),
      countrycodes: 'gb',
      dedupe: '1',
      normalizecity: '1',
    });

    if (endpoint === 'search') {
      searchParams.set('format', 'json');
      searchParams.set('addressdetails', '0');
    }

    const endpointUrl =
      endpoint === 'autocomplete' ? LOCATIONIQ_AUTOCOMPLETE_URL : LOCATIONIQ_SEARCH_URL;
    const response = await fetch(`${endpointUrl}?${searchParams.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Accept-Language': 'en-GB',
      },
    });

    if (response.status === 429) {
      return {
        error: 'Location search is busy right now. Please try again in a moment.',
      };
    }

    if (response.status === 404) {
      const responseBody = (await response.json().catch(() => null)) as LocationIqErrorResponse | null;

      if (responseBody?.error === 'Unable to geocode') {
        setCachedLocationSearchResults(cacheKey, []);
        return { results: [] };
      }
    }

    if (!response.ok) {
      return {
        error: 'Location search is unavailable right now.',
      };
    }

    const responseBody = (await response.json()) as unknown;
    const results = toLocationSearchResults(
      Array.isArray(responseBody) ? (responseBody as LocationIqSearchResponse[]) : [],
    );
    setCachedLocationSearchResults(cacheKey, results);

    return { results };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Location search timed out', error);
    } else {
      console.error('Location search failed', error);
    }

    return {
      error: 'Location search is unavailable right now.',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function searchLocations(
  query: string,
  limit = 5,
): Promise<{ results?: LocationSearchResult[]; error?: string }> {
  return fetchLocationMatches(query, Math.max(1, Math.min(limit, 5)), 'autocomplete');
}

export async function searchLocation(
  query: string,
): Promise<{ result?: LocationSearchResult; error?: string }> {
  const response = await fetchLocationMatches(query, 1, 'search');

  if (response.error) {
    return response;
  }

  const topMatch = response.results?.[0];

  if (!topMatch) {
    return {
      error: 'No matching address, postcode, or area was found.',
    };
  }

  return {
    result: topMatch,
  };
}
