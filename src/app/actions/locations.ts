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

export async function searchLocation(
  query: string,
): Promise<{ result?: LocationSearchResult; error?: string }> {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    return {
      error: 'Enter at least 2 characters to search.',
    };
  }

  const searchParams = new URLSearchParams({
    q: trimmedQuery,
    format: 'jsonv2',
    limit: '1',
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
    const topMatch = matches[0];

    if (!topMatch) {
      return {
        error: 'No matching address, postcode, or area was found.',
      };
    }

    const lat = Number(topMatch.lat);
    const lng = Number(topMatch.lon);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return {
        error: 'The selected location could not be mapped.',
      };
    }

    return {
      result: {
        lat,
        lng,
        label: topMatch.display_name,
      },
    };
  } catch (error) {
    console.error('Location search failed', error);

    return {
      error: 'Location search is unavailable right now.',
    };
  }
}
