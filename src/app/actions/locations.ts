'use server';

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

export type LocationSearchResult = {
  lat: number;
  lng: number;
  label: string;
};

type LocationSearchResponse = {
  lat: string;
  lon: string;
  display_name: string;
};

async function fetchLocationMatches(
  query: string,
  limit: number,
): Promise<{ results?: LocationSearchResult[]; error?: string }> {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    return {
      error: 'Enter at least 2 characters to search.',
    };
  }

  const searchParams = new URLSearchParams({
    q: trimmedQuery,
    format: 'jsonv2',
    limit: String(limit),
    countrycodes: 'gb',
    addressdetails: '0',
  });

  try {
    const response = await fetch(`${NOMINATIM_SEARCH_URL}?${searchParams.toString()}`, {
      cache: 'no-store',
      headers: {
        'Accept-Language': 'en-GB',
        'User-Agent': 'pump-prices/0.1',
      },
    });

    if (!response.ok) {
      return {
        error: 'Location search is unavailable right now.',
      };
    }

    const matches = (await response.json()) as LocationSearchResponse[];
    const results = matches
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

    return { results };
  } catch (error) {
    console.error('Location search failed', error);

    return {
      error: 'Location search is unavailable right now.',
    };
  }
}

export async function searchLocations(
  query: string,
  limit = 5,
): Promise<{ results?: LocationSearchResult[]; error?: string }> {
  return fetchLocationMatches(query, Math.max(1, Math.min(limit, 5)));
}

export async function searchLocation(
  query: string,
): Promise<{ result?: LocationSearchResult; error?: string }> {
  const response = await fetchLocationMatches(query, 1);

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
