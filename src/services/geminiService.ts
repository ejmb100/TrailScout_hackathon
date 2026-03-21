import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Service to interact with the Google Gemini AI API.
 * Responsible for parsing user intent into structured recommendation preferences.
 */

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface RecommendationPreferences {
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'extreme';
  maxDistance?: number; // in km
  terrain?: string[];
  features?: string[];
  reasoning: string;
  locationQuery: string;
  estimatedRegionName: string;
  bbox?: BoundingBox;
}

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * Parses a natural language user description into structured hiking preferences.
 */
export async function parseUserIntent(intent: string): Promise<RecommendationPreferences> {
  const prompt = `
    You are an AI Hiking Assistant for TrailScout. Your goal is to translate a user's natural language "hiking intent" 
    into a structured object that can be used to filter trails from OpenStreetMap (OSM).

    Crucially, you must determine WHERE the user wants to go. Extrapolate a sensible bounding box (bbox) for their desired location.
    The bounding box size MUST reflect the user's distance goal. For a "10 mile" or "20km" hike, use at least a 0.25 degree difference in Lat/Lon. 
    For smaller walks, 0.05 to 0.1 degrees is fine. 
    If the user does not specify a location, pick a beautiful outdoor destination arbitrarily (e.g., Swiss Alps, Yosemite, Patagonia).

    USER INTENT: "${intent}"

    Respond ONLY with a JSON object in the following format:
    {
      "difficulty": "beginner" | "intermediate" | "advanced" | "extreme",
      "maxDistance": number (in km),
      "terrain": ["rocky", "forest", "ridge", "meadow", etc.],
      "features": ["waterfall", "summit", "lake", "viewpoint", etc.],
      "reasoning": "A brief explanation of why you chose these parameters and location based on the user's input.",
      "locationQuery": "The specific place mentioned by user or your chosen default",
      "estimatedRegionName": "Human readable region name",
      "bbox": {
        "minLat": number,
        "maxLat": number,
        "minLon": number,
        "maxLon": number
      }
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Clean and parse the response (Gemini sometimes adds markdown backticks)
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('Failed to parse user intent with Gemini:', error);
    return {
      reasoning: "I encountered an error while analyzing your request, so I'm showing general results.",
      locationQuery: 'Unknown',
      estimatedRegionName: 'General Extent'
    };
  }
}
