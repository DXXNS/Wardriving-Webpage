import { NextRequest, NextResponse } from "next/server";

const DEFAULT_CSV_URL =
  "https://raw.githubusercontent.com/DXXNS/Wardriving-DB/refs/heads/main/db.csv";

const OSRM_MATCH_URL = "https://router.project-osrm.org/match/v1/driving";

export interface WardrivingPoint {
  lat: number;
  lng: number;
  timestamp: string;
  ssid: string;
  type: string;
  rssi: number;
}

interface MatchedLeg {
  coordinates: [number, number][];
  avgDensity: number;
}

function parseCSV(raw: string): WardrivingPoint[] {
  const lines = raw.split("\n");

  let headerIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (lines[i].startsWith("MAC,SSID,")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) return [];

  const points: WardrivingPoint[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",");
    if (cols.length < 14) continue;

    const lat = parseFloat(cols[7]);
    const lng = parseFloat(cols[8]);
    const timestamp = cols[3];
    const ssid = cols[1];
    const type = cols[13];
    const rssi = parseInt(cols[6], 10);

    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) continue;

    points.push({ lat, lng, timestamp, ssid, type, rssi });
  }

  return points;
}

function sortPointsByProximity(
  points: { lat: number; lng: number; count: number }[]
): { lat: number; lng: number; count: number }[] {
  if (points.length <= 1) return points;

  const sorted: { lat: number; lng: number; count: number }[] = [];
  const remaining = new Set(points.map((_, i) => i));

  let currentIdx = 0;
  remaining.delete(currentIdx);
  sorted.push(points[currentIdx]);

  while (remaining.size > 0) {
    let closestIdx = -1;
    let closestDist = Infinity;

    for (const idx of remaining) {
      const dist = Math.sqrt(
        Math.pow(points[idx].lat - points[currentIdx].lat, 2) +
          Math.pow(points[idx].lng - points[currentIdx].lng, 2)
      );
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = idx;
      }
    }

    if (closestIdx !== -1) {
      remaining.delete(closestIdx);
      sorted.push(points[closestIdx]);
      currentIdx = closestIdx;
    }
  }

  return sorted;
}

async function matchToRoads(
  points: { lat: number; lng: number; count: number }[]
): Promise<MatchedLeg[]> {
  const BATCH_SIZE = 80;
  const matchedLegs: MatchedLeg[] = [];

  for (let i = 0; i < points.length; i += BATCH_SIZE - 10) {
    const batch = points.slice(i, i + BATCH_SIZE);
    if (batch.length < 2) continue;

    const coordinates = batch.map((p) => `${p.lng},${p.lat}`).join(";");
    const radiuses = batch.map(() => "25").join(";");

    const url = `${OSRM_MATCH_URL}/${coordinates}?overview=full&geometries=geojson&radiuses=${radiuses}&gaps=split`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;

      const data = await res.json();
      if (data.code !== "Ok" || !data.matchings) continue;

      for (const matching of data.matchings) {
        if (matching.geometry && matching.geometry.coordinates) {
          const coords = matching.geometry.coordinates as [number, number][];
          const avgDensity =
            batch.reduce((sum, p) => sum + p.count, 0) / batch.length;
          matchedLegs.push({ coordinates: coords, avgDensity });
        }
      }
    } catch {
      continue;
    }
  }

  return matchedLegs;
}

export async function GET(request: NextRequest) {
  try {
    const csvUrl =
      request.nextUrl.searchParams.get("csv") || DEFAULT_CSV_URL;

    const response = await fetch(csvUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch CSV data from URL" },
        { status: 500 }
      );
    }

    const raw = await response.text();
    const allPoints = parseCSV(raw);

    if (allPoints.length === 0) {
      return NextResponse.json(
        { error: "No valid points found in CSV. Make sure the file uses WiGLE CSV format." },
        { status: 400 }
      );
    }

    // Density grid
    const densityMap = new Map<
      string,
      { lat: number; lng: number; count: number }
    >();

    for (const point of allPoints) {
      const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
      const existing = densityMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        densityMap.set(key, { lat: point.lat, lng: point.lng, count: 1 });
      }
    }

    const densityPoints = Array.from(densityMap.values());
    const sortedPoints = sortPointsByProximity(densityPoints);

    // Try OSRM road matching (with timeout fallback)
    let matchedLegs: MatchedLeg[] = [];
    try {
      matchedLegs = await matchToRoads(sortedPoints);
    } catch {
      // OSRM failed entirely, continue without it
    }

    // Stats
    const totalPoints = allPoints.length;
    const uniqueLocations = densityPoints.length;
    const wifiPoints = allPoints.filter((p) => p.type === "WIFI").length;
    const blePoints = allPoints.filter(
      (p) => p.type === "BLE" || p.type === "BT"
    ).length;
    const gsmPoints = allPoints.filter((p) => p.type === "GSM").length;
    const uniqueSSIDs = new Set(
      allPoints.filter((p) => p.ssid).map((p) => p.ssid)
    ).size;

    const lats = densityPoints.map((p) => p.lat);
    const lngs = densityPoints.map((p) => p.lng);
    const bounds = {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };

    const center = {
      lat: (bounds.minLat + bounds.maxLat) / 2,
      lng: (bounds.minLng + bounds.maxLng) / 2,
    };

    const maxCount = Math.max(...densityPoints.map((p) => p.count));

    return NextResponse.json({
      matchedLegs,
      points: densityPoints,
      maxCount,
      stats: {
        totalPoints,
        uniqueLocations,
        wifiPoints,
        blePoints,
        gsmPoints,
        uniqueSSIDs,
      },
      bounds,
      center,
    });
  } catch (error) {
    console.error("Error processing wardriving data:", error);
    return NextResponse.json(
      { error: "Failed to process data" },
      { status: 500 }
    );
  }
}
