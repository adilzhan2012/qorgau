"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Map, {
  AttributionControl,
  Marker,
  NavigationControl,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { DeviceMarker } from "@/components/DeviceMarker";
import {
  MAP_STYLES,
  MAP_STYLE_LABELS,
  resolveDefaultStyle,
  type MapStyleName,
} from "@/lib/mapStyles";
import type { Device } from "@/lib/types";

/** Ile-Alatau National Park, south of Almaty. */
const INITIAL_VIEW = {
  longitude: 76.98,
  latitude: 43.11,
  zoom: 11.2,
};

export interface LatLng {
  lat: number;
  lng: number;
}

interface DeviceMapProps {
  devices: Device[];
  selectedId: string | null;
  onSelect: (device: Device) => void;
  mapRef: React.RefObject<MapRef | null>;
  /**
   * While set, a click on the map picks a location instead of deselecting,
   * and the draft point (if any) is drawn so the user sees where it landed.
   */
  pick?: { draft: LatLng | null; onPick: (point: LatLng) => void } | null;
}

export function DeviceMap({ devices, selectedId, onSelect, mapRef, pick = null }: DeviceMapProps) {
  const fitted = useRef(false);
  const [style, setStyle] = useState<MapStyleName>(resolveDefaultStyle);
  // fitBounds is a no-op until the style has loaded, so wait for it rather
  // than firing once into the void and never retrying.
  const [ready, setReady] = useState(false);

  // Frame every device once, the first time a snapshot arrives.
  useEffect(() => {
    if (!ready || fitted.current || devices.length === 0) return;
    const map = mapRef.current;
    if (!map) return;

    const lngs = devices.map((device) => device.lng);
    const lats = devices.map((device) => device.lat);

    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: { top: 110, bottom: 110, left: 110, right: 110 }, duration: 1200, maxZoom: 13 },
    );
    fitted.current = true;
  }, [devices, mapRef, ready]);

  const handleMarkerClick = useCallback(
    (device: Device) => (event: { originalEvent: MouseEvent }) => {
      // Otherwise the map swallows it as a background click.
      event.originalEvent.stopPropagation();
      if (pick) return;
      onSelect(device);
    },
    [onSelect, pick],
  );

  const handleMapClick = useCallback(
    (event: MapLayerMouseEvent) => {
      if (!pick) return;
      pick.onPick({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    },
    [pick],
  );

  return (
    <>
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={MAP_STYLES[style]}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        onLoad={() => setReady(true)}
        onClick={handleMapClick}
        cursor={pick ? "crosshair" : "auto"}
      >
        <AttributionControl compact position="bottom-left" />
        <NavigationControl position="bottom-right" showCompass={false} />

        {devices.map((device) => (
          <Marker
            key={device.id}
            longitude={device.lng}
            latitude={device.lat}
            anchor="center"
            onClick={handleMarkerClick(device)}
          >
            <button
              type="button"
              aria-label={`${device.name}, ${device.status}`}
              className="cursor-pointer border-0 bg-transparent p-0 transition-transform duration-300 ease-apple hover:scale-110"
            >
              <DeviceMarker device={device} selected={device.id === selectedId} />
            </button>
          </Marker>
        ))}

        {pick?.draft && (
          <Marker longitude={pick.draft.lng} latitude={pick.draft.lat} anchor="center">
            <span className="relative flex h-8 w-8 items-center justify-center">
              <span className="absolute inset-0 animate-breathe rounded-full bg-ink" />
              <span className="relative block h-[14px] w-[14px] rounded-full bg-ink ring-2 ring-canvas/80 shadow-lifted" />
            </span>
          </Marker>
        )}
      </Map>


      {/* Basemap picker — a Control Center style glass pill */}
      <div className="glass absolute right-4 top-4 z-10 flex rounded-full p-[3px] shadow-card md:right-[416px]">
        {(Object.keys(MAP_STYLES) as MapStyleName[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setStyle(name)}
            aria-pressed={style === name}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-all duration-300 ease-apple ${
              style === name
                ? "bg-raised text-ink shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {MAP_STYLE_LABELS[name]}
          </button>
        ))}
      </div>
    </>
  );
}
