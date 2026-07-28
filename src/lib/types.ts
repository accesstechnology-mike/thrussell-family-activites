export type LatLng = {
  lat: number;
  lng: number;
};

export type ActivitySource =
  | "reluctant-explorers"
  | "national-trust"
  | "english-heritage"
  | "yorkshire-tots"
  | "teesside-family-life"
  | "muddy-boots-mummy"
  | "little-vikings"
  | "alltrails"
  | "openstreetmap";

export type TerrainLevel = "flat" | "gentle" | "hilly" | "steep" | "unknown";

export type Activity = {
  id: string;
  source: ActivitySource;
  sourceUrl: string;
  title: string;
  summary: string;
  imageUrl: string | null;
  imageAlt: string | null;
  locationLabel: string | null;
  postcode: string | null;
  what3words: string | null;
  coordinates: LatLng;
  parking: string | null;
  cost: string | null;
  /** True when the outing itself is free (parking may still cost). */
  isFree: boolean | null;
  distanceMiles: number | null;
  terrain: TerrainLevel;
  terrainNotes: string | null;
  features: string[];
  categories: string[];
  driveMinutes: number | null;
  lastSyncedAt: string;
  rawFacts: Record<string, string>;
};

export type WeatherSnapshot = {
  temperatureC: number;
  condition: string;
  precipitationChance: number | null;
  windMph: number | null;
  fetchedAt: string;
};

export type DirectionsLinks = {
  googleMaps: string;
  googleMapsDirections: string;
  appleMaps: string;
  postcode: string | null;
  what3words: string | null;
  destinationLabel: string;
};

export type ActivityStore = {
  version: 1;
  originPostcode: string;
  origin: LatLng;
  maxDriveMinutes: number;
  syncedAt: string | null;
  activities: Activity[];
  sourceStatuses: SourceStatus[];
};

export type SourceStatus = {
  source: ActivitySource;
  ok: boolean;
  fetched: number;
  kept: number;
  error: string | null;
  finishedAt: string;
};

export type SyncResult = {
  store: ActivityStore;
  statuses: SourceStatus[];
};
