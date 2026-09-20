import type { LatLng } from "./types";

/**
 * Ordnance Survey National Grid → WGS84.
 * Airy 1830 + OS Helmert transform (OSTN15-compatible to ~5m; fine for drive pins).
 */

const GRID_LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"; // no I

const GRID_PREFIX =
  /\b([HNOST][A-HJ-Z])\s*(?:(\d{2})\s*(\d{2})|(\d{3})\s*(\d{3})|(\d{4})\s*(\d{4})|(\d{5})\s*(\d{5}))\b/i;

const LABELLED_GRID =
  /grid\s*ref(?:erence)?\s*:?\s*([HNOST][A-HJ-Z]\s*\d{2,5}\s*\d{2,5})/i;

export function extractOsGridRef(text: string): string | null {
  const labelled = text.match(LABELLED_GRID);
  if (labelled?.[1]) return normaliseGridRef(labelled[1]);
  const m = text.match(GRID_PREFIX);
  if (!m) return null;
  return normaliseGridRef(m[0]);
}

export function normaliseGridRef(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 6) return null;
  const letters = compact.slice(0, 2);
  const digits = compact.slice(2);
  if (!/^[HNOST][A-HJ-Z]$/.test(letters)) return null;
  if (digits.length % 2 !== 0 || digits.length < 4 || digits.length > 10) {
    return null;
  }
  const half = digits.length / 2;
  return `${letters} ${digits.slice(0, half)} ${digits.slice(half)}`;
}

export function osGridToWgs84(gridRef: string): LatLng | null {
  const en = gridRefToEastingNorthing(gridRef);
  if (!en) return null;
  return osgbToWgs84(en.easting, en.northing);
}

export function gridRefToEastingNorthing(
  gridRef: string,
): { easting: number; northing: number } | null {
  const normalised = normaliseGridRef(gridRef);
  if (!normalised) return null;
  const compact = normalised.replace(/\s+/g, "");
  const l1 = GRID_LETTERS.indexOf(compact[0]!);
  const l2 = GRID_LETTERS.indexOf(compact[1]!);
  if (l1 < 0 || l2 < 0) return null;

  const e100km = ((l1 - 2 + 25) % 5) * 5 + (l2 % 5);
  const n100km = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5);
  if (e100km < 0 || n100km < 0) return null;

  const digits = compact.slice(2);
  const half = digits.length / 2;
  const scale = 10 ** (5 - half);
  const easting = e100km * 100000 + Number(digits.slice(0, half)) * scale;
  const northing = n100km * 100000 + Number(digits.slice(half)) * scale;
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) return null;
  return { easting, northing };
}

function osgbToWgs84(easting: number, northing: number): LatLng | null {
  // Airy 1830 ellipsoid / National Grid projection
  const a = 6377563.396;
  const b = 6356256.909;
  const f0 = 0.9996012717;
  const lat0 = toRad(49);
  const lon0 = toRad(-2);
  const n0 = -100000;
  const e0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);

  let lat = lat0;
  let m = 0;
  for (let i = 0; i < 15; i += 1) {
    lat = (northing - n0 - m) / (a * f0) + lat;
    const ma = (1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * (lat - lat0);
    const mb =
      (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) *
      Math.sin(lat - lat0) *
      Math.cos(lat + lat0);
    const mc =
      ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) *
      Math.sin(2 * (lat - lat0)) *
      Math.cos(2 * (lat + lat0));
    const md =
      (35 / 24) *
      n ** 3 *
      Math.sin(3 * (lat - lat0)) *
      Math.cos(3 * (lat + lat0));
    m = b * f0 * (ma - mb + mc - md);
    if (Math.abs(northing - n0 - m) < 0.01) break;
  }

  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const nu = (a * f0) / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = (a * f0 * (1 - e2)) / (1 - e2 * sinLat * sinLat) ** 1.5;
  const eta2 = nu / rho - 1;
  const tanLat = Math.tan(lat);

  const dE = easting - e0;
  const dE2 = dE * dE;
  const dE3 = dE2 * dE;
  const dE4 = dE2 * dE2;
  const dE5 = dE4 * dE;
  const dE6 = dE3 * dE3;
  const dE7 = dE6 * dE;

  const lat1 =
    lat -
    (tanLat / (2 * rho * nu)) * dE2 +
    (tanLat / (24 * rho * nu ** 3)) *
      (5 + 3 * tanLat ** 2 + eta2 - 9 * tanLat ** 2 * eta2) *
      dE4 -
    (tanLat / (720 * rho * nu ** 5)) *
      (61 + 90 * tanLat ** 2 + 45 * tanLat ** 4) *
      dE6;
  const lon =
    lon0 +
    dE / (cosLat * nu) -
    (dE3 / (6 * cosLat * nu ** 3)) * (1 + 2 * tanLat ** 2 + eta2) +
    (dE5 / (120 * cosLat * nu ** 5)) *
      (5 + 28 * tanLat ** 2 + 24 * tanLat ** 4 + 6 * eta2 + 8 * tanLat ** 2 * eta2) -
    (dE7 / (5040 * cosLat * nu ** 7)) *
      (61 + 662 * tanLat ** 2 + 1320 * tanLat ** 4 + 720 * tanLat ** 6);

  return airyToWgs84(lat1, lon);
}

/** Helmert transform OSGB36 (Airy) → WGS84. */
function airyToWgs84(lat: number, lon: number): LatLng {
  const a = 6377563.396;
  const b = 6356256.909;
  const e2 = 1 - (b * b) / (a * a);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const nu = a / Math.sqrt(1 - e2 * sinLat * sinLat);

  const x = nu * cosLat * cosLon;
  const y = nu * cosLat * sinLon;
  const z = nu * (1 - e2) * sinLat;

  const tx = -446.448;
  const ty = 125.157;
  const tz = -542.06;
  const s = 20.4894e-6;
  const rx = toRad(-0.1502 / 3600);
  const ry = toRad(-0.247 / 3600);
  const rz = toRad(-0.8421 / 3600);

  const x2 = tx + (1 + s) * x + (-rz) * y + ry * z;
  const y2 = ty + rz * x + (1 + s) * y + (-rx) * z;
  const z2 = tz + (-ry) * x + rx * y + (1 + s) * z;

  const a2 = 6378137;
  const b2 = 6356752.3142;
  const e2w = 1 - (b2 * b2) / (a2 * a2);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let phi = Math.atan2(z2, p * (1 - e2w));
  for (let i = 0; i < 10; i += 1) {
    const nu2 = a2 / Math.sqrt(1 - e2w * Math.sin(phi) ** 2);
    const next = Math.atan2(z2 + e2w * nu2 * Math.sin(phi), p);
    if (Math.abs(next - phi) < 1e-16) {
      phi = next;
      break;
    }
    phi = next;
  }
  const lambda = Math.atan2(y2, x2);
  return { lat: toDeg(phi), lng: toDeg(lambda) };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
