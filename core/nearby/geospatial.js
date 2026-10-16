const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";
const EARTH_RADIUS_KM = 6371.0088;

export function normalizeNearbyArea(value = "") {
  return String(value)
    .trim()
    .toLocaleLowerCase("ar-EG")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

export function roundNearbyCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 1000) / 1000;
}

export function geohashForLocation(latitude, longitude, precision = 5) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("INVALID_LATITUDE");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error("INVALID_LONGITUDE");

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let evenBit = true;
  let bit = 0;
  let character = 0;
  let hash = "";

  while (hash.length < precision) {
    if (evenBit) {
      const midpoint = (lngMin + lngMax) / 2;
      if (lng >= midpoint) {
        character |= 1 << (4 - bit);
        lngMin = midpoint;
      } else {
        lngMax = midpoint;
      }
    } else {
      const midpoint = (latMin + latMax) / 2;
      if (lat >= midpoint) {
        character |= 1 << (4 - bit);
        latMin = midpoint;
      } else {
        latMax = midpoint;
      }
    }

    evenBit = !evenBit;
    if (bit < 4) {
      bit += 1;
    } else {
      hash += GEOHASH_ALPHABET[character];
      bit = 0;
      character = 0;
    }
  }

  return hash;
}

export function geohashPrefixesForRadius(latitude, longitude, radiusKm) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const radius = Number(radiusKm);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("INVALID_LATITUDE");
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error("INVALID_LONGITUDE");
  if (![2, 5].includes(radius)) throw new Error("INVALID_NEARBY_RADIUS");

  const latitudeDelta = radius / 110.574;
  const longitudeScale = Math.max(0.01, Math.cos(lat * Math.PI / 180));
  const longitudeDelta = Math.min(180, radius / (111.32 * longitudeScale));
  // Include the half-width of a precision-5 cell so cells intersecting the
  // search box are not missed at its edges.
  const cellMargin = 0.023;
  const minLatitude = Math.max(-90, lat - latitudeDelta - cellMargin);
  const maxLatitude = Math.min(90, lat + latitudeDelta + cellMargin);
  const minLongitude = lng - longitudeDelta - cellMargin;
  const maxLongitude = lng + longitudeDelta + cellMargin;
  const step = 0.02;
  const latitudes = sampleRange(minLatitude, maxLatitude, step);
  const longitudes = sampleRange(minLongitude, maxLongitude, step);
  if (latitudes.length * longitudes.length > 900) throw new Error("NEARBY_AREA_TOO_LARGE");
  const hashes = new Set();

  for (const sampleLat of latitudes) {
    for (const sampleLng of longitudes) {
      hashes.add(geohashForLocation(sampleLat, normalizeLongitude(sampleLng), 5));
    }
  }

  return [...hashes];
}

export function distanceInKm(firstLatitude, firstLongitude, secondLatitude, secondLongitude) {
  const lat1 = Number(firstLatitude) * Math.PI / 180;
  const lat2 = Number(secondLatitude) * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLng = (Number(secondLongitude) - Number(firstLongitude)) * Math.PI / 180;
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function sampleRange(min, max, step) {
  if (min === max) return [min];
  const values = [min];
  for (let value = min + step; value < max; value += step) values.push(value);
  values.push(max);
  return values;
}

function normalizeLongitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}
