import { readFileSync } from 'fs'
import { GoogleGenAI } from '@google/genai'

// Load production env
const envContent = readFileSync('.env.production', 'utf8')
const envVars = {}
for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/)
    if (match) envVars[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
}

const GEMINI_API_KEY = envVars['GEMINI_API_KEY']
if (!GEMINI_API_KEY) { console.error('No GEMINI_API_KEY found'); process.exit(1) }

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

console.log('Listing available models...\n')
const models = await ai.models.list()

const modelList = []
for await (const model of models) {
    modelList.push(model.name)
}

// Filter for flash-lite variants
const flashLite = modelList.filter(m => m.toLowerCase().includes('flash') && m.toLowerCase().includes('lite'))
const gemini3 = modelList.filter(m => m.includes('3.') || m.includes('gemini-3'))

console.log('=== Flash Lite models ===')
flashLite.forEach(m => console.log(' ', m))

console.log('\n=== Gemini 3.x models ===')
gemini3.forEach(m => console.log(' ', m))

console.log('\n=== All models ===')
modelList.sort().forEach(m => console.log(' ', m))
