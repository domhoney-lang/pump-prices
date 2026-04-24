export const NEARBY_BENCHMARK_RADIUS_MILES = 3;

export function formatNearbyRadiusText(radiusMiles: number) {
  return radiusMiles === 1 ? '1 mile' : `${radiusMiles} miles`;
}

export function formatNearbyRadiusShortText(radiusMiles: number) {
  return radiusMiles === 1 ? '1 mi' : `${radiusMiles} mi`;
}
