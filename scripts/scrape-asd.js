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

async function main() {
  if (!fs.existsSync('logs')) fs.mkdirSync('logs');
  const log = [];
  let totalNew = 0;

  for (const city of SEARCH_TARGETS) {
    console.log(`Searching ASD in: ${city}`);
    const results = await searchASD(city);

    for (const place of results) {
      const details = await getPlaceDetails(place.place_id);
      const record = {
        google_place_id: place.place_id,
        name: details.name || place.name,
        address: details.formatted_address || place.formatted_address,
        phone: details.formatted_phone_number || null,
        website: details.website || null,
        city: city,
        scraped_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('asd_leads')
        .upsert(record, { onConflict: 'google_place_id' });

      if (!error) totalNew++;
      else log.push({ error: error.message, record: record.name });
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`Done. Processed: ${totalNew} ASD`);
  fs.writeFileSync(`logs/run-${Date.now()}.json`, JSON.stringify(log, null, 2));
}

main().catch(console.error);

