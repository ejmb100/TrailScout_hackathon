import React, { useEffect, useRef, useState } from 'react';
import { TrailData } from '../services/osmService';
import type { CampsiteStatus, CampsiteOperationalStatus } from '../services/campsiteStatusService';
import { buildTrailEndpointMarkers } from './trailEndpointMarkers';
import MapLibreTerrainMap from './MapLibreTerrainMap';

declare global {
  interface Window {
    initMap: () => void;
  }
}

// Simple fallback for google types if @types/google.maps is missing
declare var google: any;

const mapStyles = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] }
];

const DEFAULT_CENTER = { lat: 46.5197, lng: 6.6323 };
/** Default basemap when the map first loads (controls use same union type). */
const INITIAL_MAP_TYPE = 'terrain' as 'dark' | 'terrain' | 'satellite';

/**
 * Max gap (km) between consecutive path points before we treat them as
 * disconnected. Anything larger produces a phantom straight line on the map.
 */
const MAX_RENDER_GAP_KM = 0.8;
const DEG_TO_RAD = Math.PI / 180;

function fastDistKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLng * sinLng;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Split a path into contiguous sub-paths, breaking at gaps larger than MAX_RENDER_GAP_KM. */
function splitAtGaps(path: { lat: number; lng: number }[]): { lat: number; lng: number }[][] {
  if (path.length < 2) return [path];
  const subPaths: { lat: number; lng: number }[][] = [];
  let current = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (fastDistKm(path[i - 1], path[i]) > MAX_RENDER_GAP_KM) {
      if (current.length >= 2) subPaths.push(current);
      current = [path[i]];
    } else {
      current.push(path[i]);
    }
  }
  if (current.length >= 2) subPaths.push(current);
  return subPaths;
}

export interface MapMarkerData {
  lat: number;
  lng: number;
  name: string;
  type: 'campsite' | 'trailhead';
  status?: CampsiteOperationalStatus;
  /** Camping night number for itinerary overnight markers (1, 2, 3...). */
  night?: number;
}

interface MapContainerProps {
  trails: TrailData[];
  center?: { lat: number; lng: number };
  zoom?: number;
  focusedTrailId?: number | null;
  /** Optional campsite/trailhead markers with status-based coloring. */
  poiMarkers?: MapMarkerData[];
}

function poiMarkerColor(marker: MapMarkerData): string {
  if (marker.type === 'trailhead') return '#A78BFA'; // purple
  if (!marker.status) return '#6B7280'; // gray
  switch (marker.status) {
    case 'confirmed': return '#34D399'; // green
    case 'walk_in': return '#60A5FA'; // blue
    case 'seasonal_closure': case 'unverified': return '#FBBF24'; // amber
    case 'closed': return '#EF4444'; // red
    case 'fire_blocked': return '#DC2626'; // dark red
    default: return '#6B7280';
  }
}

function campsiteSvgIcon(color: string, night?: number): string {
  const label = night != null ? String(night).replace(/[^0-9]/g, '') : '';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
      <ellipse cx="24" cy="50" rx="14" ry="4" fill="rgba(0,0,0,0.35)"/>
      <circle cx="24" cy="24" r="21" fill="#0B1020" stroke="white" stroke-width="3"/>
      <path d="M24 8 L42 40 H6 Z" fill="${color}" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>
      <path d="M24 12 L31 40 H17 Z" fill="#111827" fill-opacity="0.55" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M6 40 H42" stroke="white" stroke-width="3" stroke-linecap="round"/>
      <path d="M24 12 V40" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.75"/>
      ${label ? `<circle cx="34" cy="14" r="10" fill="#0B1020" stroke="white" stroke-width="2"/><text x="34" y="18" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="800" fill="white">${label}</text>` : `<text x="24" y="31" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="900" fill="white">⛺</text>`}
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function LegendRow({ symbol, color, label }: { symbol: 'arrow' | 'circle' | 'tent'; color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {symbol === 'arrow' ? (
        <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
          <polygon points="5,0 10,10 0,10" fill={color} />
        </svg>
      ) : symbol === 'tent' ? (
        <svg width="14" height="14" viewBox="0 0 48 56" className="shrink-0">
          <circle cx="24" cy="24" r="20" fill="#0B1020" stroke="white" strokeWidth="3" />
          <path d="M24 9 L42 40 H6 Z" fill={color} stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M24 13 L31 40 H17 Z" fill="#111827" fillOpacity="0.55" stroke="white" strokeWidth="1.5" />
          <path d="M6 40 H42" stroke="white" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
          <circle cx="5" cy="5" r="4.5" fill={color} />
        </svg>
      )}
      <span className="text-[9px] text-offwhite/70">{label}</span>
    </div>
  );
}

const MapContainer: React.FC<MapContainerProps> = ({ 
  trails, 
  center: centerProp,
  zoom = 12,
  focusedTrailId = null,
  poiMarkers = [],
}) => {
  const center = centerProp ?? DEFAULT_CENTER;
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMap = useRef<google.maps.Map | null>(null);
  const polylines = useRef<google.maps.Polyline[]>([]);
  const markers = useRef<google.maps.Marker[]>([]);
  const poiMarkersRef = useRef<google.maps.Marker[]>([]);
  const prevTrailsCount = useRef<number>(0);
  
  const [mapType, setMapType] = useState<'dark' | 'terrain' | 'satellite'>(INITIAL_MAP_TYPE);
  const [is3D, setIs3D] = useState(false);
  const [showTerrain3D, setShowTerrain3D] = useState(false);
  const [showTrails, setShowTrails] = useState(true);
  const [isTopoExpanded, setIsTopoExpanded] = useState(false);
  const [mapReady, setMapReady] = useState(false);

    useEffect(() => {
      const initGoogleMapInner = () => {
        if (mapRef.current && !googleMap.current && window.google) {
          const mapTypeId =
            INITIAL_MAP_TYPE === 'dark'
              ? 'roadmap'
              : INITIAL_MAP_TYPE === 'terrain'
                ? 'terrain'
                : 'satellite';

          googleMap.current = new google.maps.Map(mapRef.current, {
            center,
            zoom,
            mapId: 'DEMO_MAP_ID',
            mapTypeId,
            tilt: 0,
            heading: 0,
            disableDefaultUI: true, // Prevents overlaps with our custom UI
            zoomControl: true, // Keep zoom buttons
            tiltControl: true, // Explicitly enable the manual 3D tilt control
            scaleControl: true,
            scaleControlOptions: {
              position: google.maps.ControlPosition.BOTTOM_CENTER,
            },
          });
          
          setMapReady(true);
          
          if (!is3D) {
            if (INITIAL_MAP_TYPE === 'dark') {
              googleMap.current.setOptions({ styles: mapStyles });
            } else {
              googleMap.current.setOptions({ styles: [] });
            }
          }
          
          renderTrails();
        }
      };

      if (!window.google && !document.getElementById('google-maps-script')) {
        const script = document.createElement('script');
        script.id = 'google-maps-script';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&callback=initMap&v=weekly`;
        script.async = true;
        script.defer = true;
        window.initMap = () => {
          initGoogleMapInner();
        };
        document.head.appendChild(script);
      } else if (window.google) {
        initGoogleMapInner();
      } else {
        // Script is downloading, ensure callback catches this mount
        window.initMap = () => {
          initGoogleMapInner();
        };
      }

      return () => {
        polylines.current.forEach(p => {
          try { p.setMap(null); } catch (e) {}
        });
        markers.current.forEach(m => {
          try { m.setMap(null); } catch (e) {}
        });
        poiMarkersRef.current.forEach(m => {
          try { m.setMap(null); } catch (e) {}
        });
      };
    }, []);

    useEffect(() => {
      if (!googleMap.current) return;
      if (is3D) {
        // Explicitly move the camera and clear styles for 3D compatibility
        googleMap.current.setOptions({ 
          mapTypeId: 'satellite',
          styles: [], 
          gestureHandling: 'greedy',
          scaleControl: false,
        });
        googleMap.current.setTilt(65);
        googleMap.current.setHeading(45);
      } else {
        googleMap.current.setOptions({ 
          gestureHandling: 'cooperative', // Make 2D dragging safer
          scaleControl: true,
          scaleControlOptions: {
            position: google.maps.ControlPosition.BOTTOM_CENTER,
          },
        });
        googleMap.current.setTilt(0);
        googleMap.current.setHeading(0);
        
        // Restore manual Map Types
        if (mapType === 'dark') {
          googleMap.current.setMapTypeId('roadmap');
          googleMap.current.setOptions({ styles: mapStyles });
        } else if (mapType === 'terrain') {
          googleMap.current.setMapTypeId('terrain');
          googleMap.current.setOptions({ styles: [] });
        } else if (mapType === 'satellite') {
          googleMap.current.setMapTypeId('satellite');
          googleMap.current.setOptions({ styles: [] });
        }
      }
    }, [is3D, mapType]);

    useEffect(() => {
      if (googleMap.current) {
        renderTrails();
      }
    }, [trails, focusedTrailId]);

    useEffect(() => {
      if (!googleMap.current || !mapReady) return;
      // Clear old POI markers
      poiMarkersRef.current.forEach(m => { try { m.setMap(null); } catch {} });
      poiMarkersRef.current = [];

      if (!showTrails) return;

      for (const poi of poiMarkers) {
        const color = poiMarkerColor(poi);
        const isTrailhead = poi.type === 'trailhead';
        const isCampsite = poi.type === 'campsite';
        const isNumberedCampsite = isCampsite && poi.night != null;
        const marker = new google.maps.Marker({
          position: { lat: poi.lat, lng: poi.lng },
          map: googleMap.current,
          title: `${poi.name}${poi.status ? ` (${poi.status})` : ''}`,
          icon: isCampsite
            ? {
                url: campsiteSvgIcon(color, poi.night),
                scaledSize: new google.maps.Size(44, 52),
                anchor: new google.maps.Point(22, 50),
              }
            : {
                path: isTrailhead
                  ? google.maps.SymbolPath.BACKWARD_CLOSED_ARROW
                  : google.maps.SymbolPath.CIRCLE,
                scale: isTrailhead ? 5 : 6,
                fillColor: color,
                fillOpacity: 0.85,
                strokeWeight: 1.5,
                strokeColor: '#FFFFFF',
              },
          zIndex: isNumberedCampsite ? 40 + (poi.night ?? 0) : isCampsite ? 30 : isTrailhead ? 10 : 20,
        });
        poiMarkersRef.current.push(marker);
      }
    }, [poiMarkers, showTrails, mapReady]);

    useEffect(() => {
      const map = showTrails ? googleMap.current : null;
      polylines.current.forEach(p => { try { p.setMap(map); } catch {} });
      markers.current.forEach(m => { try { m.setMap(map); } catch {} });
    }, [showTrails]);

    useEffect(() => {
      if (googleMap.current && focusedTrailId) {
        const trail = trails.find(t => t.id === focusedTrailId);
        if (trail) {
          const focusBounds = new google.maps.LatLngBounds();
          trail.path.forEach(p => focusBounds.extend(p));
          googleMap.current.fitBounds(focusBounds, { padding: 100 });
          console.log(`Explicitly zooming to trail: ${trail.name}`);
        }
      }
    }, [focusedTrailId]);

    useEffect(() => {
      if (!googleMap.current || trails.length > 0) return;
      googleMap.current.setCenter(center);
    }, [center.lat, center.lng, trails.length]);

    useEffect(() => {
      if (googleMap.current) {
        window.setTimeout(() => {
          if (!googleMap.current) return;
          google.maps.event.trigger(googleMap.current, 'resize');
          renderTrails();
        }, 0);
      }
    }, [isTopoExpanded]);

    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setIsTopoExpanded(false);
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

  const renderTrails = () => {
    if (!googleMap.current) return;
    
    // Clear old polylines
    polylines.current.forEach(p => {
      try { p.setMap(null); } catch (e) {}
    });
    polylines.current = [];

    // Clear old markers
    markers.current.forEach(m => {
      try { m.setMap(null); } catch (e) {}
    });
    markers.current = [];

    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    // Draw new trails
    trails.forEach(trail => {
      try {
        const isHighlight = trail.tags.color === '#FF7D0F';
        const subPaths = splitAtGaps(trail.path);
        for (const subPath of subPaths) {
          const polyline = new google.maps.Polyline({
            path: subPath,
            geodesic: true,
            strokeColor: trail.tags.color || '#FF4500',
            strokeOpacity: isHighlight ? 1.0 : 0.8,
            strokeWeight: isHighlight ? 5 : 3,
            map: googleMap.current
          });
          polylines.current.push(polyline);
        }

        if (trail.path && trail.path.length > 0) {
          // Adjust bounds for the map to frame everything
          trail.path.forEach(point => {
            if (point && typeof point.lat === 'number' && typeof point.lng === 'number') {
              bounds.extend(point);
              hasPoints = true;
            }
          });
        }
      } catch (e) {
        console.error(`Failed to render trail ${trail.name}:`, e);
      }
    });

    for (const endpoint of buildTrailEndpointMarkers(trails)) {
      const marker = new google.maps.Marker({
        position: { lat: endpoint.lat, lng: endpoint.lng },
        map: googleMap.current,
        title: endpoint.title,
        label: {
          text: endpoint.label === 'Start' ? 'S' : 'E',
          color: '#FFFFFF',
          fontSize: '11px',
          fontWeight: '800',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: endpoint.label === 'Start' ? 9 : 8,
          fillColor: endpoint.color,
          fillOpacity: 1,
          strokeWeight: endpoint.label === 'Start' ? 4 : 3,
          strokeColor: endpoint.strokeColor,
        },
        zIndex: endpoint.label === 'Start' ? 55 : 54,
      });
      markers.current.push(marker);
    }

    if (hasPoints && googleMap.current) {
      try {
        const highlightedTrails = trails.filter(t => t.tags.color === '#FF7D0F');
        
        if (highlightedTrails.length > 0) {
          const highlightBounds = new google.maps.LatLngBounds();
          highlightedTrails.forEach(t => {
            t.path.forEach(p => highlightBounds.extend(p));
          });
          
          if (!highlightBounds.isEmpty()) {
            // Use fitBounds with padding to ensure we "zero in" effectively
            googleMap.current.fitBounds(highlightBounds, {
              top: 50,
              bottom: 50,
              left: 50,
              right: 50
            });
            console.log('Zeroing in on shortlisted trail...');
          }
        } else if (trails.length !== prevTrailsCount.current && !bounds.isEmpty()) {
          googleMap.current.fitBounds(bounds, { padding: 40 });
          prevTrailsCount.current = trails.length;
        }
      } catch (e) {
        console.error('Map fitBounds failed:', e);
      }
    }
  };

  return (
    <div
      className={`relative w-full h-full rounded-[2.5rem] overflow-hidden border border-white/10 shadow-2xl group ${
        isTopoExpanded
          ? 'fixed inset-3 sm:inset-6 z-[80] rounded-[2rem] bg-navy'
          : ''
      }`}
    >
      <div ref={mapRef} className={`w-full h-full ${showTerrain3D ? 'opacity-0 pointer-events-none' : ''}`} />
      {showTerrain3D && (
        <div className="absolute inset-0 z-10">
          <MapLibreTerrainMap
            trails={showTrails ? trails : []}
            center={center}
            zoom={zoom}
            poiMarkers={showTrails ? poiMarkers : []}
            resizeSignal={isTopoExpanded}
          />
        </div>
      )}
      
      {/* Floating Map Dashboard */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 z-20">
        <div className="bg-navy/80 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-[10px] font-bold text-teal uppercase tracking-widest shadow-xl pointer-events-auto">
          {trails.length} Trails Loaded via OSM
        </div>
        {trails.length > 0 && (
          <div className="bg-navy/80 backdrop-blur-md px-3 py-2 rounded-xl border border-white/10 shadow-xl pointer-events-auto">
            <div className="text-[8px] text-offwhite/40 uppercase tracking-widest font-bold mb-1.5">Legend</div>
            <div className="flex flex-col gap-1">
              <LegendRow symbol="circle" color="#F97316" label="Trail start (green outline)" />
              <LegendRow symbol="circle" color="#EF4444" label="Trail end" />
              <LegendRow symbol="arrow" color="#A855F7" label="Trailhead" />
              <LegendRow symbol="tent" color="#22C55E" label="Camp night # (confirmed)" />
              <LegendRow symbol="tent" color="#3B82F6" label="Camp night # (walk-in)" />
              <LegendRow symbol="tent" color="#FBBF24" label="Camp night # (unverified)" />
              <LegendRow symbol="circle" color="#EF4444" label="Campsite (closed / fire)" />
            </div>
          </div>
        )}
      </div>

      {/* Floating Map Base Controls */}
      <div className="absolute top-4 right-4 flex bg-navy/80 backdrop-blur-md rounded-full border border-white/10 p-1 shadow-xl z-20 pointer-events-auto">
        <button 
          onClick={() => setMapType('dark')}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${mapType === 'dark' ? 'bg-teal text-navy' : 'text-offwhite/70 hover:text-offwhite'}`}
        >
          Dark
        </button>
        <button 
          onClick={() => setMapType('terrain')}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${mapType === 'terrain' ? 'bg-teal text-navy' : 'text-offwhite/70 hover:text-offwhite'}`}
        >
          Topo
        </button>
        <button 
          onClick={() => setMapType('satellite')}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${mapType === 'satellite' ? 'bg-teal text-navy' : 'text-offwhite/70 hover:text-offwhite'}`}
        >
          Sat
        </button>
        <div className="w-px h-4 bg-white/20 mx-1 self-center" />
        <button 
          onClick={() => setIs3D(!is3D)}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${is3D ? 'bg-orange text-navy shadow-[0_0_15px_rgba(255,125,15,0.5)]' : 'text-offwhite/70 hover:text-offwhite'}`}
        >
          3D Angle
        </button>
        <button
          onClick={() => setShowTerrain3D(!showTerrain3D)}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${showTerrain3D ? 'bg-green text-navy shadow-[0_0_15px_rgba(34,197,94,0.45)]' : 'text-offwhite/70 hover:text-offwhite'}`}
          title="Render true DEM-based mountain terrain with MapLibre + MapTiler"
        >
          3D Terrain
        </button>
        <div className="w-px h-4 bg-white/20 mx-1 self-center" />
        <button
          onClick={() => setShowTrails(!showTrails)}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${showTrails ? 'bg-teal text-navy' : 'text-offwhite/70 hover:text-offwhite'}`}
        >
          Trail
        </button>
        <div className="w-px h-4 bg-white/20 mx-1 self-center" />
        <button
          onClick={() => setIsTopoExpanded((value) => !value)}
          className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${isTopoExpanded ? 'bg-orange text-navy shadow-[0_0_15px_rgba(255,125,15,0.5)]' : 'text-offwhite/70 hover:text-offwhite'}`}
          title={isTopoExpanded ? 'Collapse the expanded topo map' : 'Expand the topo map for a larger route view'}
          aria-pressed={isTopoExpanded}
        >
          {isTopoExpanded ? 'Collapse' : 'Expand Topo'}
        </button>
      </div>

      <div className="absolute bottom-6 left-6 right-6 pointer-events-none z-20">
        <div className="flex justify-between items-end gap-4">
           {/* Tooltip */}
           <div className="bg-navy/90 backdrop-blur-md p-4 rounded-3xl border border-white/10 shadow-2xl max-w-sm pointer-events-auto">
              <h4 className="text-white font-bold mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                Live Map Interaction
              </h4>
              <p className="text-offwhite/60 text-xs leading-relaxed">
                {showTerrain3D
                  ? 'MapLibre terrain mode uses MapTiler DEM tiles: drag to rotate, pitch, and inspect mountain relief.'
                  : 'Hold '}
                {!showTerrain3D && <kbd className="bg-white/10 px-1 rounded">Shift</kbd>}
                {!showTerrain3D && ' and drag to manually tilt and observe trails.'}
              </p>
           </div>
           
           <div className="bg-teal/90 backdrop-blur-md px-3 py-1 rounded-full border border-white/20 text-[10px] font-bold text-navy shadow-2xl pointer-events-auto hover:bg-teal transition-colors">
             Live Sync Active
           </div>
        </div>
      </div>
    </div>
  );
};

export default MapContainer;
