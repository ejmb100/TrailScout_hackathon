/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Compass, 
  Map as MapIcon, 
  Search, 
  MessageSquare, 
  Navigation, 
  CheckCircle2, 
  ArrowRight, 
  Menu, 
  X, 
  Mountain, 
  Wind, 
  Sun, 
  Dog,
  ChevronDown,
  Download,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { parseUserIntent } from './services/geminiService';
import { fetchTrailsInBBox, TrailData } from './services/osmService';
import MapContainer from './components/MapContainer';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { scoreAndFilterTrails, calculateDistance } from './utils/trailScoring';

// --- Components ---

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'How it Works', href: '#how-it-works' },
    { name: 'Features', href: '#features' },
    { name: 'Preview', href: '#preview' },
    { name: 'Waitlist', href: '#waitlist' },
  ];

  return (
    <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled ? 'bg-navy/90 backdrop-blur-md shadow-sm py-4' : 'bg-transparent py-6'}`}>
      <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="bg-teal p-1.5 rounded-lg">
            <Compass className="text-navy w-6 h-6" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight text-offwhite">TrailScout</span>
        </div>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a 
              key={link.name} 
              href={link.href} 
              className="text-sm font-medium text-offwhite/70 hover:text-teal transition-colors"
            >
              {link.name}
            </a>
          ))}
          <a 
            href="#waitlist" 
            className="bg-orange text-offwhite px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-peach hover:text-navy transition-all shadow-md hover:shadow-lg"
          >
            Join Waitlist
          </a>
        </div>

        {/* Mobile Toggle */}
        <button className="md:hidden text-offwhite" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-full left-0 w-full bg-navy border-b border-white/10 p-6 flex flex-col gap-4 md:hidden shadow-xl"
          >
            {navLinks.map((link) => (
              <a 
                key={link.name} 
                href={link.href} 
                className="text-lg font-medium text-offwhite"
                onClick={() => setIsOpen(false)}
              >
                {link.name}
              </a>
            ))}
            <a 
              href="#waitlist" 
              className="bg-orange text-offwhite px-6 py-3 rounded-xl text-center font-semibold"
              onClick={() => setIsOpen(false)}
            >
              Join Waitlist
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

const getTrailDescription = (trail: TrailData) => {
  const dist = calculateDistance(trail.path).toFixed(1);
  const diff = trail.tags.sac_scale ? trail.tags.sac_scale.replace('hiking', 'hiking trail').replace(/_/g, ' ') : 'unrated path';
  const surface = trail.tags.surface ? ` mostly over ${trail.tags.surface.replace(/_/g, ' ')}` : '';
  const type = trail.tags.highway ? trail.tags.highway.replace(/_/g, ' ') : 'route';
  return `This is a ${dist}km ${diff} ${surface}. Ideal for an outdoor ${type} adventure.`;
};

const getEstimatedTime = (distanceKm: number) => {
  // Simple Naismith's rule (assuming 4 km/h avg pace)
  const totalMinutes = Math.round((distanceKm / 4) * 60);
  if (totalMinutes === 0) return '< 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
};

export default function App() {
  const [intent, setIntent] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [reasoning, setReasoning] = useState('');

  const [availableTrails, setAvailableTrails] = useState<TrailData[]>([]);
  const [itineraryTrails, setItineraryTrails] = useState<TrailData[]>([]);
  const [regionFocus, setRegionFocus] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim()) return;

    setIsSearching(true);
    setRegionFocus(null);
    try {
      const prefs = await parseUserIntent(intent);
      setReasoning(prefs.reasoning);
      setRegionFocus(prefs.estimatedRegionName);

      const bbox = prefs.bbox || { minLat: 46.51, maxLat: 46.54, minLon: 6.61, maxLon: 6.64 }; // Tighter bbox fallback to prevent OSM timeout
      const results = await fetchTrailsInBBox(bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon);
      const rankedTrails = scoreAndFilterTrails(results, prefs).slice(0, 15);
      
      setAvailableTrails(rankedTrails);
      setItineraryTrails([]);

      document.getElementById('preview')?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      console.error('Search failed:', error);
      setReasoning("I encountered an error analyzing your request, please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const startList = source.droppableId === 'available' ? availableTrails : itineraryTrails;
    const endList = destination.droppableId === 'available' ? availableTrails : itineraryTrails;

    if (startList === endList) {
      const newList = Array.from(startList);
      const [removed] = newList.splice(source.index, 1);
      newList.splice(destination.index, 0, removed);
      
      if (source.droppableId === 'available') setAvailableTrails(newList);
      else setItineraryTrails(newList);
    } else {
      const startCopy = Array.from(startList);
      const endCopy = Array.from(endList);
      const [removed] = startCopy.splice(source.index, 1);
      endCopy.splice(destination.index, 0, removed);

      if (source.droppableId === 'available') {
        setAvailableTrails(startCopy);
        setItineraryTrails(endCopy);
      } else {
        setItineraryTrails(startCopy);
        setAvailableTrails(endCopy);
      }
    }
  };

  const shortlistStats = {
    count: itineraryTrails.length,
    distance: itineraryTrails.reduce((acc, t) => acc + calculateDistance(t.path), 0).toFixed(1),
    isStrenuous: itineraryTrails.some(t => t.tags.sac_scale && ['mountain_hiking', 't3', 't4', 't5', 't6'].some(s => t.tags.sac_scale?.includes(s)))
  };

  const downloadExpedition = () => {
    if (itineraryTrails.length === 0) return;
    
    let content = `# TrailScout Expedition Plan\n`;
    content += `Region: ${regionFocus || 'Custom Selection'}\n`;
    content += `Total Distance: ${shortlistStats.distance}km\n`;
    content += `Effort Level: ${shortlistStats.isStrenuous ? 'High' : 'Moderate'}\n\n`;
    content += `## Shortlisted Trails\n\n`;
    
    itineraryTrails.forEach((t, i) => {
      content += `${i+1}. ${t.name || 'Unnamed Trail'} (${calculateDistance(t.path).toFixed(2)}km)\n`;
      if (t.tags.difficulty) content += `   - Difficulty: ${t.tags.difficulty}\n`;
      if (t.tags.surface) content += `   - Terrain: ${t.tags.surface}\n`;
      content += `\n`;
    });
    
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trailscout_expedition_${regionFocus?.toLowerCase().replace(/\s+/g, '_') || 'plan'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-navy selection:bg-teal selection:text-navy">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden bg-navy">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=2000" 
            alt="Mountain Background" 
            className="w-full h-full object-cover opacity-30"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-navy/80 via-navy/60 to-navy" />
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-4xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md text-teal px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider mb-8 border border-white/10">
              <Compass className="w-3 h-3" />
              TrailScout Alpine Kinetic
            </div>
            
            <h1 className="font-display text-6xl md:text-8xl font-bold text-offwhite leading-[1] mb-8">
              Describe your <br />
              <span className="text-orange italic">ideal hike.</span>
            </h1>
            
            <p className="text-lg md:text-xl text-offwhite/70 max-w-2xl mx-auto mb-12 leading-relaxed">
              Our Digital Sherpa uses intent-based planning to find trails that match your mood, pace, and thirst for adventure.
            </p>

            <form onSubmit={handleSearch} className="max-w-2xl mx-auto bg-white/5 backdrop-blur-xl border border-white/10 rounded-full p-2 flex items-center mb-12 shadow-2xl">
              <div className="pl-6 pr-4">
                <MapIcon className="text-offwhite/40 w-5 h-5" />
              </div>
              <input 
                type="text" 
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="e.g. A challenging ridge walk with lake views..." 
                className="flex-1 bg-transparent border-none text-offwhite placeholder:text-offwhite/30 focus:ring-0 text-lg"
              />
              <button 
                type="submit"
                disabled={isSearching}
                className="bg-orange text-offwhite px-8 py-4 rounded-full font-bold text-lg hover:bg-peach hover:text-navy transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isSearching ? 'Analyzing...' : 'Start Planning'} <ArrowRight className="w-5 h-5" />
              </button>
            </form>

            {reasoning && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="bg-white/5 border border-teal/20 p-6 rounded-3xl max-w-2xl mx-auto mb-12 text-teal text-sm italic"
              >
                "{reasoning}"
              </motion.div>
            )}
          </motion.div>
        </div>
      </section>

      {/* Presentation Layer: Interactive Map & Tiles */}
      <section id="preview" className="py-32 bg-navy border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-5xl font-display font-bold text-offwhite mb-4">
              Live Expedition Map {regionFocus && <span className="text-teal text-3xl block mt-2">📍 {regionFocus}</span>}
            </h2>
            <p className="text-offwhite/50 text-lg">Drag your curated trail recommendations onto your Shortlist.</p>
          </div>
          
          <div className="flex flex-col gap-8">
            {/* Map Section (Full Width Above) */}
            <div className="h-[450px] w-full">
              <MapContainer trails={[
                ...availableTrails.map(t => ({...t, tags: {...t.tags, color: '#334155'}})), // dim available trails
                ...itineraryTrails.map(t => ({...t, tags: {...t.tags, color: '#FF7D0F'}})) // highlight with Apricot Orange
              ]} />
            </div>
            
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="grid grid-cols-2 gap-8">
                {/* Recommendations Column */}
                <Droppable droppableId="available">
                {(provided) => (
                  <div 
                    ref={provided.innerRef} 
                    {...provided.droppableProps}
                    className="flex flex-col gap-4 overflow-y-auto h-[800px] pr-2 bg-white/5 p-4 rounded-3xl"
                  >
                    <h3 className="font-bold text-offwhite text-lg border-b border-white/10 pb-2 mb-2">Recommended</h3>
                    {availableTrails.map((trail, index) => (
                      <Draggable {...{ key: `avail-${trail.id}`, draggableId: `avail-${trail.id}`, index } as any}>
                        {(provided: any) => (
                          <div 
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className="bg-navy/80 backdrop-blur-md border border-white/10 p-5 rounded-[2rem] hover:border-teal/30 transition-all shadow-lg select-none"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <h3 className="font-bold text-md text-offwhite pr-4">
                                <span className="text-offwhite/40 mr-2">#{index + 1}</span>
                                {trail.name || 'Unnamed Trail'}
                              </h3>
                              <span className="text-teal font-bold text-xs whitespace-nowrap bg-teal/10 px-2 py-1 rounded-md">
                                {calculateDistance(trail.path).toFixed(1)} km
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="text-[10px] uppercase tracking-wider bg-teal/20 px-2 py-1 rounded-full text-teal flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {getEstimatedTime(calculateDistance(trail.path))}
                              </span>
                              <span className="text-[10px] uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full text-offwhite/70">
                                {trail.tags.highway ? trail.tags.highway.replace(/_/g, ' ') : 'hiking route'}
                              </span>
                              <span className="text-[10px] uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full text-offwhite/70">
                                {trail.tags.surface ? trail.tags.surface.replace(/_/g, ' ') : 'mixed terrain'}
                              </span>
                              <span className="text-[10px] uppercase tracking-wider bg-orange/10 px-2 py-1 rounded-full text-orange">
                                {trail.tags.sac_scale ? trail.tags.sac_scale.replace('hiking', '').replace('_', ' ') : 'unrated'}
                              </span>
                              {trail.tags.ele && <span className="text-[10px] uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full text-offwhite/70 flex items-center gap-1"><Mountain className="w-3 h-3" /> {trail.tags.ele}m</span>}
                              {trail.tags.incline && <span className="text-[10px] uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full text-offwhite/70 flex items-center gap-1">Incline: {trail.tags.incline}</span>}
                              {trail.tags.dog && trail.tags.dog !== 'no' && <span className="text-[10px] uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full text-offwhite/70 flex items-center gap-1"><Dog className="w-3 h-3" /> {trail.tags.dog === 'yes' ? 'Allowed' : trail.tags.dog}</span>}
                              {trail.tags.trail_visibility && <span className="text-[10px] uppercase tracking-wider bg-white/5 px-2 py-1 rounded-full text-offwhite/70 flex items-center gap-1"><Compass className="w-3 h-3" /> {trail.tags.trail_visibility}</span>}
                            </div>
                            <p className="text-xs text-offwhite/50 mt-4 leading-relaxed italic border-l-2 border-teal/30 pl-3 py-0.5">
                              {getTrailDescription(trail)}
                            </p>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {availableTrails.length === 0 && <div className="text-center opacity-30 mt-10">No matches yet. Search above!</div>}
                  </div>
                )}
              </Droppable>

              {/* Shortlist Column */}
              <Droppable droppableId="itinerary">
                {(provided) => (
                  <div 
                    ref={provided.innerRef} 
                    {...provided.droppableProps}
                    className="flex flex-col gap-4 overflow-y-auto h-[800px] pr-2 bg-teal/5 border border-teal/20 p-4 rounded-3xl"
                  >
                    <div className="flex justify-between items-center border-b border-teal/20 pb-2 mb-2">
                       <h3 className="font-bold text-teal text-lg">My Shortlist</h3>
                       {shortlistStats.count > 0 && (
                         <div className="flex gap-2 items-center">
                           <span className="bg-teal/20 text-teal text-[10px] px-2 py-0.5 rounded-full font-bold">{shortlistStats.distance}km</span>
                           <button 
                             onClick={downloadExpedition}
                             className="p-1.5 hover:bg-teal/20 rounded-lg text-teal transition-colors"
                             title="Download Expedition Summary"
                           >
                              <Download className="w-4 h-4" />
                           </button>
                         </div>
                       )}
                    </div>

                    {shortlistStats.count > 0 && (
                      <div className="bg-teal/10 p-3 rounded-2xl border border-teal/30 mb-2">
                        <p className="text-[10px] text-teal/80 font-bold uppercase tracking-tight mb-1">Adventure Summary</p>
                        <div className="flex items-center gap-3 text-offwhite text-xs">
                          <div className="flex items-center gap-1">
                            <Navigation className="w-3 h-3 text-teal" />
                            <span>{shortlistStats.count} segments</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Sun className="w-3 h-3 text-orange" />
                            <span>{shortlistStats.isStrenuous ? 'High Effort' : 'Easy Pace'}</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {itineraryTrails.map((trail, index) => (
                      <Draggable {...{ key: `itin-${trail.id}`, draggableId: `itin-${trail.id}`, index } as any}>
                        {(provided: any) => (
                          <div 
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className="bg-teal/10 backdrop-blur-md border border-teal/30 p-5 rounded-[2rem] shadow-lg select-none"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <h3 className="font-bold text-md text-offwhite pr-4">{trail.name || 'Unnamed Trail'}</h3>
                              <span className="text-teal font-bold text-xs whitespace-nowrap bg-navy/50 px-2 py-1 rounded-md">
                                {calculateDistance(trail.path).toFixed(1)} km
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="text-[10px] uppercase tracking-wider bg-teal/20 px-2 py-1 rounded-full text-teal flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {getEstimatedTime(calculateDistance(trail.path))}
                              </span>
                              <span className="text-[10px] uppercase tracking-wider bg-navy/50 px-2 py-1 rounded-full text-offwhite/70">
                                {trail.tags.highway ? trail.tags.highway.replace(/_/g, ' ') : 'hiking route'}
                              </span>
                              <span className="text-[10px] uppercase tracking-wider bg-navy/50 px-2 py-1 rounded-full text-offwhite/70">
                                {trail.tags.surface ? trail.tags.surface.replace(/_/g, ' ') : 'mixed terrain'}
                              </span>
                              <span className="text-[10px] uppercase tracking-wider bg-orange/20 px-2 py-1 rounded-full text-orange">
                                {trail.tags.sac_scale ? trail.tags.sac_scale.replace('hiking', '').replace('_', ' ') : 'unrated'}
                              </span>
                              {trail.tags.ele && <span className="text-[10px] uppercase tracking-wider bg-navy/50 px-2 py-1 rounded-full text-offwhite/70 flex items-center gap-1"><Mountain className="w-3 h-3" /> {trail.tags.ele}m</span>}
                              {trail.tags.incline && <span className="text-[10px] uppercase tracking-wider bg-navy/50 px-2 py-1 rounded-full text-offwhite/70 flex items-center gap-1">Incline: {trail.tags.incline}</span>}
                              {trail.tags.dog && trail.tags.dog !== 'no' && <span className="text-[10px] uppercase tracking-wider bg-navy/50 px-2 py-1 rounded-full text-offwhite/70 flex items-center gap-1"><Dog className="w-3 h-3" /> {trail.tags.dog === 'yes' ? 'Allowed' : trail.tags.dog}</span>}
                              {trail.tags.trail_visibility && <span className="text-[10px] uppercase tracking-wider bg-navy/50 px-2 py-1 rounded-full text-offwhite/70 flex items-center gap-1"><Compass className="w-3 h-3" /> {trail.tags.trail_visibility}</span>}
                            </div>
                            <p className="text-xs text-teal/70 mt-4 leading-relaxed italic border-l-2 border-teal/50 pl-3 py-0.5">
                              {getTrailDescription(trail)}
                            </p>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {itineraryTrails.length === 0 && (
                       <div className="flex-1 flex items-center justify-center text-center opacity-40 p-4 border-2 border-dashed border-teal/20 rounded-2xl mt-4 text-xs font-bold text-teal">
                         Drag trails here to save them.
                       </div>
                    )}
                  </div>
                )}
              </Droppable>
            </div>
          </DragDropContext>
          </div>
        </div>
      </section>

      <ProblemSection />
      <WaitlistForm />
      
      <footer className="bg-navy text-offwhite pt-32 pb-16 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:row justify-between items-center gap-12 text-center md:text-left">
          <div>
            <div className="flex items-center gap-2 mb-4 justify-center md:justify-start">
              <Compass className="text-teal w-8 h-8" />
              <span className="font-display font-bold text-2xl tracking-tight">TrailScout</span>
            </div>
            <p className="text-offwhite/40 text-[10px] uppercase tracking-widest">
              Data source: OpenStreetMap • Recommendations: Google Gemini
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

const ProblemSection = () => {
  return (
    <section className="py-32 bg-navy text-offwhite border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              title: "AI Powered Intent",
              desc: "Don't just search for \"hikes\". Describe how you want to feel—secluded, challenged, or inspired.",
              icon: <Wind className="w-6 h-6 text-orange" />
            },
            {
              title: "Precision Vitals",
              desc: "Live elevation tracking and real-time oxygen density data for high-alpine expeditions.",
              icon: <Mountain className="w-6 h-6 text-teal" />
            },
            {
              title: "The Community Lab",
              desc: "Access trail data shared by the TrailScout collective, verified by digital sherpas.",
              icon: <Compass className="w-6 h-6 text-offwhite" />
            }
          ].map((item, i) => (
            <div key={i} className="bg-white/5 border border-white/10 p-10 rounded-3xl hover:bg-white/[0.07] transition-colors group">
              <div className="mb-8 bg-navy p-4 rounded-2xl inline-block border border-white/10 group-hover:border-teal/50 transition-colors">
                {item.icon}
              </div>
              <h3 className="text-2xl font-bold mb-4">{item.title}</h3>
              <p className="text-offwhite/50 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const WaitlistForm = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
      setEmail('');
    }
  };

  return (
    <section id="waitlist" className="py-32 bg-navy">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="font-display text-5xl md:text-7xl font-bold text-offwhite mb-8">Join the collective.</h2>
        <p className="text-offwhite/50 text-xl mb-12 max-w-xl mx-auto">
          Get early access to the Digital Sherpa beta and start planning your next expedition.
        </p>

        {submitted ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-teal text-navy p-8 rounded-3xl inline-flex items-center gap-3"
          >
            <CheckCircle2 className="w-6 h-6" />
            <span className="font-bold text-lg">You're on the list. Welcome to TrailScout.</span>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 max-w-lg mx-auto">
            <input 
              type="email" 
              placeholder="Your email address" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 px-8 py-5 rounded-full border border-white/10 focus:outline-none focus:ring-2 focus:ring-teal bg-white/5 text-offwhite text-lg"
            />
            <button 
              type="submit" 
              className="bg-orange text-offwhite px-10 py-5 rounded-full font-bold text-lg hover:bg-peach hover:text-navy transition-all shadow-xl"
            >
              Join Waitlist
            </button>
          </form>
        )}
      </div>
    </section>
  );
};
