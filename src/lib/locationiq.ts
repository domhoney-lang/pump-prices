export const LOCATIONIQ_AUTOCOMPLETE_URL = 'https://api.locationiq.com/v1/autocomplete';
export const LOCATIONIQ_SEARCH_URL = 'https://api.locationiq.com/v1/search';

export function getRequiredLocationIqApiKey() {
  const value = process.env.LOCATIONIQ_API_KEY;

  if (!value) {
    throw new Error('Missing required env var: LOCATIONIQ_API_KEY');
  }

  return value;
}
