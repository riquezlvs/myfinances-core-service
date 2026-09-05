import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY } from '../config/env';

let instance: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!instance) {
    instance = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return instance;
}