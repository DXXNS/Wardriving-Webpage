import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DEFAULT_CSV_URL =
  "https://raw.githubusercontent.com/DXXNS/Wardriving-DB/refs/heads/main/db.csv";

export interface WardrivingPoint {
  lat: number;
  lng: number;
  timestamp: string;
  ssid: string;
  type: string;
  rssi: number;
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

export async function GET(request: NextRequest) {
  const csvUrl = request.nextUrl.searchParams.get("csv") || DEFAULT_CSV_URL;

  console.log("(Wardriving App) Fetching CSV from:", csvUrl);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(csvUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "WardriveScan/1.0",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log("(Wardriving App) CSV fetch failed with status:", response.status);
      return NextResponse.json(
        { error: `Failed to fetch CSV (HTTP ${response.status})` },
        { status: 502 }
      );
    }

    const raw = await response.text();
    console.log("(Wardriving App) CSV fetched, size:", raw.length, "bytes");

    const allPoints = parseCSV(raw);
    console.log("(Wardriving App) Parsed", allPoints.length, "points");

    if (allPoints.length === 0) {
      return NextResponse.json(
        {
          error:
            "No valid points found in CSV. Make sure the file uses WiGLE CSV format.",
        },
        { status: 400 }
      );
    }

    // Build density grid (~11m resolution)
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

    // Stats
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

    console.log("(Wardriving App) Returning", densityPoints.length, "density points, maxCount:", maxCount);

    return NextResponse.json({
      points: densityPoints,
      maxCount,
      stats: {
        totalPoints: allPoints.length,
        uniqueLocations: densityPoints.length,
        wifiPoints,
        blePoints,
        gsmPoints,
        uniqueSSIDs,
      },
      bounds,
      center,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("(Wardriving App) Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
