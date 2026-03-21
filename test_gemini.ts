import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function test() {
  try {
    const result = await model.generateContent('Say hello world');
    const response = await result.response;
    console.log(response.text());
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
