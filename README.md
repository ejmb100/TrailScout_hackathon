<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# TrailScout: AI Hackathon Project

TrailScout is an intent-based hiking and backpacking discovery planner. By describing a trip (for example, "Find a four-day hiking trail in Colorado in July"), TrailScout parses structured constraints, queries open/public trail and recreation sources, ranks candidates with source-aware confidence, and visualizes routes, warnings, and campsite context.

TrailScout is separate from the Marathon Preview and Orientr projects. Race-course or VR-orienteering logic should live outside TrailScout unless it becomes a shared geospatial utility.

## 🚀 Features (MVP)
1. **Gemini Natural Language Parsing:** We lean heavily on `@google/generative-ai` to parse raw user intent into structured JSON preferences, including a dynamic geolocation bounding box (`bbox`).
2. **Layered Public Data:** Uses OSM/Overpass, USFS EDW, COTREX, RIDB/Recreation.gov, USGS 3DEP, Open-Meteo, and WFIGS fire feeds where available.
3. **Interactive Map Visualization:** Renders `TrailPoint` polylines and campsite/trailhead markers onto Google Maps and optional MapTiler terrain.
4. **Source-Aware Planning:** Applies deterministic scoring, feasibility gates, safety/seasonality warnings, source attribution, and multi-day itinerary/campsite checks.

## ⚠️ Known Hackathon Limitations
- **Gemini Still Runs Client-Side:** Gemini calls are currently bundled into the browser build. Move intent/research calls server-side before production use.
- **Overpass API Rate-Limiting:** Heavy, consecutive searches covering extremely wide regions will likely cause timeout errors strictly enforced by public OSM rules.
- **Best-Effort Heuristics:** Public data can be incomplete or stale. TrailScout preserves attribution and surfaces conservative warnings rather than claiming permits, availability, or current conditions are verified.

See `docs/trailscout-data-sources.md`, `docs/trailscout-architecture.md`, and `docs/trailscout-gap-audit.md` for source and architecture details.

## 🛠 Run Locally

**Prerequisites:**  Node.js (LTS version)

1. Clone repository and install dependencies:
   ```bash
   npm install
   ```
2. Set your environment variables in `.env`
   ```bash
   GEMINI_API_KEY="your_ai_studio_api_key_here"
   VITE_GOOGLE_MAPS_API_KEY="your_google_cloud_maps_js_key_here"
   VITE_MAPTILER_KEY="optional_maptiler_key"
   RIDB_API_KEY="optional_recreation_gov_key_for_server_proxy"
   ```
3. Run the application:
   ```bash
   npm run dev
   ```
4. View your app locally and prepare to build your adventure!
