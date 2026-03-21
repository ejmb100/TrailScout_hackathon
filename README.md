<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# TrailScout: AI Hackathon Project

TrailScout is an intent-based outdoor expedition planner. By simply describing how you want your hike to feel (e.g., "A challenging ridge walk near Lausanne"), our AI constructs your preferences, queries OpenStreetMap (OSM) for real geolocations, and visualizes rated routes on an interactive Google Map framework.

## 🚀 Features (MVP)
1. **Gemini Natural Language Parsing:** We lean heavily on `@google/generative-ai` to parse raw user intent into structured JSON preferences, including a dynamic geolocation bounding box (`bbox`).
2. **OpenStreetMap Data Hook:** Uses the Overpass API to pull genuine real-world trail geometries instead of mocked data.
3. **Interactive Map Visualization:** Renders `TrailPoint` polylines onto a customized, dark-themed Google Maps layer dynamically fitting the camera viewport.
4. **Draggable Itinerary Shortlist:** Integrated `@hello-pangea/dnd` for drag-and-drop Trail discovery tiles allowing users to save specific branches to a shortlist. 

## ⚠️ Known Hackathon Limitations
- **No Backend:** For the hackathon scope, API calls are fired directly from Vite development environment, meaning the API keys (`VITE_GEMINI_API_KEY`) live in the client memory. We strongly advise moving `parseUserIntent` to a secure serverless backend in production.
- **Overpass API Rate-Limiting:** Heavy, consecutive searches covering extremely wide regions will likely cause timeout errors strictly enforced by public OSM rules.
- **Best-Effort Heuristics:** Because OSM tags like `sac_scale` (difficulty) and `surface` are crowd-sourced, some missing tags resort to approximation fallbacks in our trail scoring utility (`trailScoring.ts`).

## 🛠 Run Locally

**Prerequisites:**  Node.js (LTS version)

1. Clone repository and install dependencies:
   ```bash
   npm install
   ```
2. Set your environment variables in `.env`
   ```bash
   VITE_GEMINI_API_KEY="your_ai_studio_api_key_here"
   VITE_GOOGLE_MAPS_API_KEY="your_google_cloud_maps_js_key_here"
   ```
3. Run the application:
   ```bash
   npm run dev
   ```
4. View your app locally and prepare to build your adventure!
