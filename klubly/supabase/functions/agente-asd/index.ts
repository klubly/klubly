import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_KEY = Deno.env.get("GOOGLE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// CAP rappresentativi per ogni provincia italiana
const CAP_ITALIA = [
  // PIEMONTE
  "10100","10141","10036","10024","10015","10064","10025","12100","12051","12038",
  "12084","12045","13100","13900","14100","14053","15100","15057","28100","28021",
  // VALLE D'AOSTA
  "11100",
  // LIGURIA
  "16100","16031","17100","17055","18100","18038","19100","19038",
  // LOMBARDIA
  "20100","20811","21100","21013","22100","22063","23100","23900","24100","24068",
  "25100","25125","26100","26013","27100","27058","46100","46030",
  // TRENTINO ALTO ADIGE
  "38100","38068","39100","39012",
  // VENETO
  "30100","30172","31100","31044","32100","32032","35100","35013","36100","36061",
  "37100","37060","45100","45030",
  // FRIULI VENEZIA GIULIA
  "33100","33044","34100","34074","34170","33170",
  // EMILIA ROMAGNA
  "40100","40064","41100","41049","42100","42048","43100","43126","44100","44124",
  "47100","47522","47900","48100","48125","29100","29010",
  // TOSCANA
  "50100","50053","51100","51016","52100","52048","53100","53036","54100","54028",
  "55100","55049","56100","56025","57100","57014","58100","58014","59100","59015",
  // UMBRIA
  "06100","06049","05100","05035",
  // MARCHE
  "60100","60044","61100","61032","62100","62010","63100","63074","60019",
  // LAZIO
  "00100","00118","01100","01033","02100","02047","03100","03043","04100","04023",
  // ABRUZZO
  "65100","65124","66100","66041","67100","67051","64100","64032",
  // MOLISE
  "86100","86079","86170",
  // CAMPANIA
  "80100","80011","81100","81055","82100","82034","83100","83052","84100","84091",
  // PUGLIA
  "70100","70126","71100","71036","72100","72023","73100","73028","74100","74121",
  "76100","76121","76125",
  // BASILICATA
  "85100","85052","75100","75025",
  // CALABRIA
  "87100","87036","88100","88050","89100","89133","88900","89822",
  // SICILIA
  "90100","90128","91100","91025","92100","92024","93100","93012","94100","94015",
  "95100","95030","96100","96011","97100","97015","98100","98057",
  // SARDEGNA
  "09100","09127","07100","07026","08100","08048","09170","09013",
];

async function geocodeCap(cap: string): Promise<{lat: number, lng: number, nome: string} | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${cap}+Italia&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.results?.length > 0) {
    const loc = data.results[0].geometry.location;
    const nome = data.results[0].address_components?.find((c: any) =>
      c.types.includes('locality') || c.types.includes('postal_town')
    )?.long_name ?? cap;
    return { lat: loc.lat, lng: loc.lng, nome };
  }
  return null;
}

async function cercaASD(lat: number, lng: number): Promise<any[]> {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=3000&keyword=associazione+sportiva+dilettantistica&language=it&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results ?? [];
}

async function getDettagli(placeId: string): Promise<{telefono: string, sito: string}> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${GOOGLE_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    return {
      telefono: data.result?.formatted_phone_number ?? "",
      sito: data.result?.website ?? ""
    };
  } catch { return { telefono: "", sito: "" }; }
}

async function salvaLead(place: any, cap: string, nomeCitta: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("place_id", place.place_id)
    .single();

  if (existing) return false;

  const det = await getDettagli(place.place_id);

  const { error } = await supabase.from("leads").insert({
    nome: place.name,
    indirizzo: place.vicinity ?? "",
    telefono: det.telefono,
    sito_web: det.sito,
    place_id: place.place_id,
    stato: "nuovo",
    note: `Agente notturno - CAP ${cap} (${nomeCitta})`
  });

  return !error;
}

serve(async (_req) => {
  let nuovi = 0;
  const log: string[] = [];

  const oggi = new Date().getDate();
  const totaleCap = CAP_ITALIA.length;
  const capPerNotte = 8;
  const startIdx = ((oggi - 1) * capPerNotte) % totaleCap;
  const capDiOggi = [];

  for (let i = 0; i < capPerNotte; i++) {
    capDiOggi.push(CAP_ITALIA[(startIdx + i) % totaleCap]);
  }

  log.push(`CAP di oggi: ${capDiOggi.join(', ')}`);

  for (const cap of capDiOggi) {
    try {
      const coords = await geocodeCap(cap);
      if (!coords) { log.push(`${cap}: geocoding fallito`); continue; }

      const places = await cercaASD(coords.lat, coords.lng);
      log.push(`${cap} (${coords.nome}): ${places.length} ASD trovate`);

      for (const place of places) {
        if (await salvaLead(place, cap, coords.nome)) nuovi++;
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      log.push(`${cap}: errore - ${e.message}`);
    }
  }

  const result = { nuovi_lead: nuovi, cap_scansionati: capDiOggi, log };
  console.log(JSON.stringify(result));

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" }
  });
});
