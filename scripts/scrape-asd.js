import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { WebSocket } from 'ws';

globalThis.WebSocket = WebSocket;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const SEARCH_TARGETS = [
  'Torino', 'Milano', 'Roma', 'Napoli', 'Bologna',
  'Firenze', 'Venezia', 'Genova', 'Palermo', 'Bari',
  'Cuneo', 'Savigliano', 'Fossano', 'Alba', 'Asti'
];

async function searchASD(city) {
  const query = encodeURIComponent(`ASD associazione sportiva dilettantistica ${city}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}

async function getPlaceDetails(placeId) {
  const fields = 'name,formatted_address,formatted_phone_number,website';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result || {};
}

async function findEmailFromWebsite(website) {
  if (!website) return null;
  try {
    const res = await fetch(website, { 
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();
    const matches = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
    if (!matches) return null;
    // Filtra email generiche/sistema
    const filtered = matches.filter(e => 
      !e.includes('sentry') && !e.includes('example') && 
      !e.includes('wordpress') && !e.includes('schema')
    );
    return filtered[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  if (!fs.existsSync('logs')) fs.mkdirSync('logs');
  const log = [];
  let totalNew = 0;

  for (const city of SEARCH_TARGETS) {
    console.log(`Searching ASD in: ${city}`);
    const results = await searchASD(city);

    for (const place of results) {
      const details = await getPlaceDetails(place.place_id);
      const website = details.website || null;
      const email = await findEmailFromWebsite(website);

      const record = {
        place_id: place.place_id,
        nome: details.name || place.name,
        indirizzo: details.formatted_address || place.formatted_address,
        telefono: details.formatted_phone_number || null,
        sito_web: website,
        email: email,
        stato: 'nuovo',
        created: new Date().toISOString()
      };

      const { error } = await supabase
        .from('leads')
        .upsert(record, { onConflict: 'place_id' });

      if (!error) {
        totalNew++;
        console.log(`✓ ${record.nome} ${email ? '| email: ' + email : ''}`);
      } else {
        log.push({ error: error.message, record: record.nome });
      }
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`Done. Processed: ${totalNew} ASD`);
  fs.writeFileSync(`logs/run-${Date.now()}.json`, JSON.stringify(log, null, 2));
}

main().catch(console.error);

