import React, { useEffect, useRef, useState } from 'react';
import { TrailData } from '../services/osmService';

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

interface MapContainerProps {
  trails: TrailData[];
  center?: { lat: number; lng: number };
  zoom?: number;
  focusedTrailId?: number | null;
}

const MapContainer: React.FC<MapContainerProps> = ({ 
  trails, 
  center = { lat: 46.5197, lng: 6.6323 },
  zoom = 12,
  focusedTrailId = null
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMap = useRef<google.maps.Map | null>(null);
  const polylines = useRef<google.maps.Polyline[]>([]);
  const markers = useRef<google.maps.Marker[]>([]);
  const prevTrailsCount = useRef<number>(0);
  
  const [mapType, setMapType] = useState<'dark' | 'terrain' | 'satellite'>('dark');
  const [is3D, setIs3D] = useState(false);

    useEffect(() => {
      const initGoogleMapInner = () => {
        if (mapRef.current && !googleMap.current && window.google) {
          googleMap.current = new google.maps.Map(mapRef.current, {
            center,
            zoom,
            mapId: 'DEMO_MAP_ID',
            tilt: 0,
            heading: 0,
            disableDefaultUI: true, // Prevents overlaps with our custom UI
            zoomControl: true, // Keep zoom buttons
            tiltControl: true, // Explicitly enable the manual 3D tilt control
          });
          
          if (!is3D) {
            googleMap.current.setOptions({ styles: mapStyles });
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
      };
    }, []);

    useEffect(() => {
      if (!googleMap.current) return;
      if (is3D) {
        // Explicitly move the camera and clear styles for 3D compatibility
        googleMap.current.setOptions({ 
          mapTypeId: 'satellite',
          styles: [], 
          gestureHandling: 'greedy'
        });
        googleMap.current.setTilt(65);
        googleMap.current.setHeading(45);
      } else {
        googleMap.current.setOptions({ 
          gestureHandling: 'cooperative' // Make 2D dragging safer
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
        const polyline = new google.maps.Polyline({
          path: trail.path,
          geodesic: true,
          strokeColor: trail.tags.color || '#FF4500',
          strokeOpacity: isHighlight ? 1.0 : 0.8,
          strokeWeight: isHighlight ? 8 : 4,
          map: googleMap.current
        });

        polylines.current.push(polyline);

        if (trail.path && trail.path.length > 0) {
          // Adjust bounds for the map to frame everything
          trail.path.forEach(point => {
            if (point && typeof point.lat === 'number' && typeof point.lng === 'number') {
              bounds.extend(point);
              hasPoints = true;
            }
          });

          // Markers check
          if (trail.path[0]) {
            const marker = new google.maps.Marker({
              position: trail.path[0],
              map: googleMap.current,
              title: trail.name,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: isHighlight ? 7 : 5,
                fillColor: trail.tags.color || '#03B2BA',
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#FFFFFF'
              }
            });
            markers.current.push(marker);
          }
        }
      } catch (e) {
        console.error(`Failed to render trail ${trail.name}:`, e);
      }
    });

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
    <div className="relative w-full h-full rounded-[2.5rem] overflow-hidden border border-white/10 shadow-2xl group">
      <div ref={mapRef} className="w-full h-full" />
      
      {/* Floating Map Dashboard */}
      <div className="absolute top-4 left-4 flex flex-col gap-2">
        <div className="bg-navy/80 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-[10px] font-bold text-teal uppercase tracking-widest shadow-xl pointer-events-auto">
          {trails.length} Trails Loaded via OSM
        </div>
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
      </div>

      <div className="absolute bottom-6 left-6 right-6 pointer-events-none">
        <div className="flex justify-between items-end gap-4">
           {/* Tooltip */}
           <div className="bg-navy/90 backdrop-blur-md p-4 rounded-3xl border border-white/10 shadow-2xl max-w-sm pointer-events-auto">
              <h4 className="text-white font-bold mb-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
                Live Map Interaction
              </h4>
              <p className="text-offwhite/60 text-xs leading-relaxed">
                Hold <kbd className="bg-white/10 px-1 rounded">Shift</kbd> and drag to manually tilt and observe trails.
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
