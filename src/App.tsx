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
  Instagram,
  Linkedin,
  Github
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
          <span className={`font-display font-bold text-xl tracking-tight ${scrolled || true ? 'text-offwhite' : 'text-navy'}`}>TrailScout</span>
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

const Hero = () => {
  return (
    <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden bg-navy">
      {/* Background Image with Overlay */}
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

          <div className="max-w-2xl mx-auto bg-white/5 backdrop-blur-xl border border-white/10 rounded-full p-2 flex items-center mb-12 shadow-2xl">
            <div className="pl-6 pr-4">
              <MapIcon className="text-offwhite/40 w-5 h-5" />
            </div>
            <input 
              type="text" 
              placeholder="e.g. A challenging ridge walk with lake views..." 
              className="flex-1 bg-transparent border-none text-offwhite placeholder:text-offwhite/30 focus:ring-0 text-lg"
            />
            <button className="bg-orange text-offwhite px-8 py-4 rounded-full font-bold text-lg hover:bg-peach hover:text-navy transition-all flex items-center gap-2">
              Start Planning <ArrowRight className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-8 text-offwhite/60">
            <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <MapIcon className="w-4 h-4 text-teal" />
              <span className="text-sm font-medium">Browse Trails</span>
            </div>
            <div className="flex -space-x-3">
              {[1,2,3].map(i => (
                <img 
                  key={i}
                  src={`https://picsum.photos/seed/hiker${i}/100/100`} 
                  className="w-10 h-10 rounded-full border-2 border-navy object-cover"
                  referrerPolicy="no-referrer"
                />
              ))}
              <div className="w-10 h-10 rounded-full border-2 border-navy bg-teal text-navy text-[10px] font-bold flex items-center justify-center">
                +2k
              </div>
            </div>
            <span className="text-sm font-medium">Joined by 2,400+ Scouts today</span>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1 }}
          className="mt-24 flex flex-col items-center gap-2 text-teal/40"
        >
          <span className="text-[10px] uppercase tracking-[0.3em] font-bold">The Descent</span>
          <ChevronDown className="w-5 h-5 animate-bounce" />
        </motion.div>
      </div>
    </section>
  );
};

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

const AppPreview = () => {
  return (
    <section id="preview" className="py-32 bg-navy">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="relative rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10">
            <img 
              src="https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&q=80&w=1200" 
              alt="Hiker on ridge" 
              className="w-full aspect-[4/3] object-cover"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-navy via-transparent to-transparent" />
            <div className="absolute bottom-10 left-10 right-10">
              <div className="inline-block bg-orange text-navy text-[10px] font-bold px-3 py-1 rounded-full mb-4">
                FEATURED REGION
              </div>
              <h3 className="text-4xl font-bold text-offwhite mb-2">Dolomites Expedition</h3>
              <p className="text-offwhite/60">12 Active Routes • High Intensity</p>
            </div>
          </div>

          <div className="space-y-8">
            <div className="bg-white/5 border border-white/10 p-10 rounded-[2.5rem]">
              <h3 className="text-3xl font-bold text-offwhite mb-4">Digital Sherpa Beta</h3>
              <p className="text-offwhite/50 mb-8 leading-relaxed">
                Planning complicated trips now takes seconds instead of hours with our new AI engine.
              </p>
              <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  whileInView={{ width: "75%" }}
                  className="h-full bg-teal"
                />
              </div>
              <div className="flex justify-between mt-4">
                <span className="text-[10px] font-bold text-teal uppercase tracking-widest">Optimizing</span>
                <span className="text-[10px] font-bold text-offwhite/40 uppercase tracking-widest">75% Optimized</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="bg-orange p-10 rounded-[2.5rem] flex flex-col justify-center items-center text-center">
                <span className="text-5xl font-bold text-navy mb-2">4.2k</span>
                <span className="text-[10px] font-bold text-navy/60 uppercase tracking-widest">Feet Avg Gain</span>
              </div>
              <div className="bg-white/5 border border-white/10 p-10 rounded-[2.5rem] flex flex-col justify-center items-center text-center group hover:border-teal/50 transition-colors">
                <div className="w-12 h-12 bg-navy rounded-full flex items-center justify-center mb-4 border border-white/10 group-hover:border-teal/50">
                  <Wind className="text-teal w-6 h-6" />
                </div>
                <span className="text-sm font-bold text-teal">Offline Vector Maps</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const Footer = () => {
  return (
    <footer className="bg-navy text-offwhite pt-32 pb-16 border-t border-white/5">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-12">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Compass className="text-teal w-8 h-8" />
              <span className="font-display font-bold text-2xl tracking-tight">TrailScout</span>
            </div>
            <p className="text-offwhite/40 text-xs">
              © 2024 TRAILSCOUT ALPINE KINETIC. ALL RIGHTS RESERVED.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-8">
            {['Privacy Policy', 'Terms of Service', 'Trail Safety', 'Contact'].map(link => (
              <a key={link} href="#" className="text-[10px] font-bold uppercase tracking-widest text-offwhite/40 hover:text-teal transition-colors">
                {link}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
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

export default function App() {
  return (
    <div className="min-h-screen bg-navy selection:bg-teal selection:text-navy">
      <Navbar />
      <Hero />
      <ProblemSection />
      <AppPreview />
      <WaitlistForm />
      <Footer />
    </div>
  );
}
