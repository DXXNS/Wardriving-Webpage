"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface DensityPoint {
  lat: number;
  lng: number;
  count: number;
}

interface MatchedLeg {
  coordinates: [number, number][];
  avgDensity: number;
}

interface WardrivingData {
  matchedLegs: MatchedLeg[];
  points: DensityPoint[];
  maxCount: number;
  stats: {
    totalPoints: number;
    uniqueLocations: number;
    wifiPoints: number;
    blePoints: number;
    gsmPoints: number;
    uniqueSSIDs: number;
  };
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  center: { lat: number; lng: number };
}

function getColorForDensity(count: number, maxCount: number): string {
  const ratio = count / maxCount;
  if (ratio > 0.6) return "#ef4444";
  if (ratio > 0.25) return "#f59e0b";
  return "#3b82f6";
}

function getOpacityForDensity(count: number, maxCount: number): number {
  const ratio = count / maxCount;
  return Math.max(0.6, Math.min(0.95, 0.5 + ratio * 0.5));
}

function getWeightForDensity(count: number, maxCount: number): number {
  const ratio = count / maxCount;
  return Math.max(4, Math.min(8, 3 + ratio * 5));
}

export default function WardrivingMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const dataLayersRef = useRef<L.Layer[]>([]);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userCircleRef = useRef<L.Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const [data, setData] = useState<WardrivingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [customCsvUrl, setCustomCsvUrl] = useState("");
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Fetch wardriving data
  const fetchData = useCallback(async (csvUrl?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = csvUrl
        ? `/api/wardriving?csv=${encodeURIComponent(csvUrl)}`
        : "/api/wardriving";
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to fetch data");
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
      setLoadingCustom(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [48.189, 14.099],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        maxZoom: 20,
        subdomains: "abcd",
      }
    ).addTo(map);

    L.control
      .attribution({ position: "bottomright" })
      .addAttribution(
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      )
      .addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Render wardriving data on map
  useEffect(() => {
    if (!data || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;

    // Clear existing data layers
    dataLayersRef.current.forEach((layer) => map.removeLayer(layer));
    dataLayersRef.current = [];

    const { matchedLegs, points, maxCount, bounds } = data;

    // Fit to data bounds
    map.fitBounds([
      [bounds.minLat - 0.002, bounds.minLng - 0.002],
      [bounds.maxLat + 0.002, bounds.maxLng + 0.002],
    ]);

    if (matchedLegs && matchedLegs.length > 0) {
      matchedLegs.forEach((leg) => {
        if (!leg.coordinates || leg.coordinates.length < 2) return;

        const latlngs: [number, number][] = leg.coordinates.map(
          (coord) => [coord[1], coord[0]] as [number, number]
        );

        const color = getColorForDensity(leg.avgDensity, maxCount);

        const glow = L.polyline(latlngs, {
          color: color,
          weight: getWeightForDensity(leg.avgDensity, maxCount) + 6,
          opacity: 0.15,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(map);
        dataLayersRef.current.push(glow);

        const line = L.polyline(latlngs, {
          color: color,
          weight: getWeightForDensity(leg.avgDensity, maxCount),
          opacity: getOpacityForDensity(leg.avgDensity, maxCount),
          lineJoin: "round",
          lineCap: "round",
        }).addTo(map);
        dataLayersRef.current.push(line);
      });
    }

    // Always render points as a fallback/supplement
    if (points && points.length > 0) {
      points.forEach((p) => {
        const color = getColorForDensity(p.count, maxCount);
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: Math.max(2, Math.min(5, 1.5 + (p.count / maxCount) * 3.5)),
          fillColor: color,
          fillOpacity: 0.6,
          color: color,
          weight: 0,
        }).addTo(map);
        dataLayersRef.current.push(marker);
      });
    }
  }, [data]);

  const handleLoadCustomCsv = () => {
    if (!customCsvUrl.trim()) return;
    setLoadingCustom(true);
    fetchData(customCsvUrl.trim());
  };

  // Live location tracking
  const startTracking = useCallback(() => {
    if (!("geolocation" in navigator)) return;

    setIsTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });

        if (mapInstanceRef.current) {
          const map = mapInstanceRef.current;

          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([latitude, longitude]);
          } else {
            const icon = L.divIcon({
              html: '<div style="width:16px;height:16px;background:#22d3ee;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px rgba(34,211,238,0.6);"></div>',
              iconSize: [16, 16],
              iconAnchor: [8, 8],
              className: "",
            });
            userMarkerRef.current = L.marker([latitude, longitude], {
              icon,
              zIndexOffset: 1000,
            }).addTo(map);
          }

          if (userCircleRef.current) {
            userCircleRef.current.setLatLng([latitude, longitude]);
            userCircleRef.current.setRadius(accuracy);
          } else {
            userCircleRef.current = L.circle([latitude, longitude], {
              radius: accuracy,
              color: "#22d3ee",
              fillColor: "#22d3ee",
              fillOpacity: 0.1,
              weight: 1,
            }).addTo(map);
          }
        }
      },
      () => {
        setIsTracking(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );
  }, []);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    if (userMarkerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(userMarkerRef.current);
      userMarkerRef.current = null;
    }
    if (userCircleRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(userCircleRef.current);
      userCircleRef.current = null;
    }
  }, []);

  const centerOnUser = useCallback(() => {
    if (userLocation && mapInstanceRef.current) {
      mapInstanceRef.current.setView([userLocation.lat, userLocation.lng], 16);
    }
  }, [userLocation]);

  const centerOnData = useCallback(() => {
    if (data && mapInstanceRef.current) {
      mapInstanceRef.current.fitBounds([
        [data.bounds.minLat - 0.002, data.bounds.minLng - 0.002],
        [data.bounds.maxLat + 0.002, data.bounds.maxLng + 0.002],
      ]);
    }
  }, [data]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0f172a]">
      {/* Map container */}
      <div ref={mapRef} className="absolute inset-0 z-0" />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0f172a]">
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#3b82f6] border-t-transparent" />
            <p className="text-sm text-[#94a3b8]">
              {loadingCustom ? "Loading custom CSV..." : "Loading wardriving data..."}
            </p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && !loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0f172a]/80 backdrop-blur-sm">
          <div className="mx-4 max-w-md rounded-xl bg-[#1e293b] p-6 text-center">
            <p className="text-sm text-[#ef4444]">Error: {error}</p>
            <button
              onClick={() => {
                setError(null);
                fetchData();
              }}
              className="mt-4 rounded-lg bg-[#3b82f6] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2563eb]"
            >
              Retry with default
            </button>
          </div>
        </div>
      )}

      {/* Top left - title + custom CSV input */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-2 md:left-6 md:top-6">
        {/* Title bar */}
        <div className="flex items-center gap-3 rounded-xl bg-[#0f172a]/90 px-4 py-3 shadow-lg shadow-black/30 backdrop-blur-md md:min-w-[340px]">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3b82f6]/20">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5.5 8.5 9 12l-3.5 3.5L2 12l3.5-3.5Z" />
              <path d="m12 2 3.5 3.5L12 9 8.5 5.5 12 2Z" />
              <path d="M18.5 8.5 22 12l-3.5 3.5L15 12l3.5-3.5Z" />
              <path d="m12 15 3.5 3.5L12 22l-3.5-3.5L12 15Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[#e2e8f0]">
              WardriveScan
            </h1>
            <p className="text-xs text-[#64748b]">
              {data
                ? `${data.stats.uniqueLocations.toLocaleString()} locations mapped`
                : "Loading..."}
            </p>
          </div>
        </div>

        {/* Custom CSV URL input */}
        <div className="rounded-xl bg-[#0f172a]/90 p-3 shadow-lg shadow-black/30 backdrop-blur-md md:min-w-[340px]">
          <input
            type="url"
            placeholder="Paste a .csv URL here..."
            value={customCsvUrl}
            onChange={(e) => setCustomCsvUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLoadCustomCsv();
            }}
            className="w-full rounded-lg bg-[#1e293b] px-3 py-2 text-xs text-[#e2e8f0] placeholder-[#475569] outline-none ring-1 ring-[#334155] transition-all focus:ring-[#3b82f6]"
          />
          <button
            onClick={handleLoadCustomCsv}
            disabled={!customCsvUrl.trim() || loadingCustom}
            className="mt-2 w-full rounded-lg bg-[#3b82f6] px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingCustom ? "Loading..." : "Load CSV"}
          </button>
        </div>
      </div>

      {/* Right side controls */}
      <div className="absolute right-4 top-4 z-10 flex flex-col gap-2 md:right-6 md:top-6">
        <button
          onClick={() => setShowStats((prev) => !prev)}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0f172a]/90 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-[#1e293b]"
          title="Toggle Stats"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke={showStats ? "#3b82f6" : "#94a3b8"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3v18h18" />
            <path d="M18 17V9" />
            <path d="M13 17V5" />
            <path d="M8 17v-3" />
          </svg>
        </button>

        <button
          onClick={isTracking ? stopTracking : startTracking}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0f172a]/90 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-[#1e293b]"
          title={isTracking ? "Stop tracking" : "Track my location"}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isTracking ? "#22d3ee" : "#94a3b8"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
          </svg>
        </button>

        {isTracking && userLocation && (
          <button
            onClick={centerOnUser}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0f172a]/90 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-[#1e293b]"
            title="Center on my location"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#22d3ee"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
          </button>
        )}

        <button
          onClick={centerOnData}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0f172a]/90 shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-[#1e293b]"
          title="Center on wardriving data"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M3 15h18" />
            <path d="M9 3v18" />
            <path d="M15 3v18" />
          </svg>
        </button>
      </div>

      {/* Stats panel */}
      {showStats && data && (
        <div className="absolute bottom-20 left-4 right-4 z-10 md:bottom-auto md:left-auto md:right-6 md:top-[220px] md:w-[280px]">
          <div className="rounded-xl bg-[#0f172a]/90 p-4 shadow-lg shadow-black/30 backdrop-blur-md">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#64748b]">
              Scan Statistics
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <StatItem
                label="Total Points"
                value={data.stats.totalPoints.toLocaleString()}
              />
              <StatItem
                label="Locations"
                value={data.stats.uniqueLocations.toLocaleString()}
              />
              <StatItem
                label="WiFi"
                value={data.stats.wifiPoints.toLocaleString()}
                color="#3b82f6"
              />
              <StatItem
                label="BLE/BT"
                value={data.stats.blePoints.toLocaleString()}
                color="#a855f7"
              />
              <StatItem
                label="GSM"
                value={data.stats.gsmPoints.toLocaleString()}
                color="#f59e0b"
              />
              <StatItem
                label="SSIDs"
                value={data.stats.uniqueSSIDs.toLocaleString()}
                color="#22d3ee"
              />
            </div>

            <div className="mt-4 border-t border-[#1e293b] pt-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#64748b]">
                Density
              </h3>
              <div className="flex items-center gap-4">
                <LegendItem color="#3b82f6" label="Low" />
                <LegendItem color="#f59e0b" label="Medium" />
                <LegendItem color="#ef4444" label="High" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom bar: legend + credit */}
      <div className="absolute bottom-4 left-4 right-4 z-10 flex items-end justify-between">
        {/* Legend (mobile) */}
        <div className="flex items-center gap-3 rounded-lg bg-[#0f172a]/90 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur-md md:hidden">
          <LegendItem color="#3b82f6" label="Low" />
          <LegendItem color="#f59e0b" label="Med" />
          <LegendItem color="#ef4444" label="High" />
        </div>

        {/* Made by DXXNS */}
        <div className="rounded-lg bg-[#0f172a]/90 px-3 py-2 shadow-lg shadow-black/30 backdrop-blur-md">
          <span className="flex items-center gap-1.5 text-xs text-[#64748b]">
            Made with{" "}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="#ef4444"
              stroke="none"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>{" "}
            by <span className="font-medium text-[#94a3b8]">DXXNS</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function StatItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-[#64748b]">{label}</span>
      <span
        className="text-sm font-semibold"
        style={{ color: color || "#e2e8f0" }}
      >
        {value}
      </span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs text-[#94a3b8]">{label}</span>
    </div>
  );
}
