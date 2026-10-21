// POST /api/alturas — numeración oficial de cada cuadra (servicio de direcciones del Gobierno de la Ciudad, USIG)
// Recibe { puntos: [[lat, lon], ...] } (el punto medio de cada cuadra) y devuelve [{ calle, altura } | null, ...]
import { exigirAdmin, json, manejar, HttpError } from '../lib/comun.mjs';

const USIG = 'https://ws.usig.buenosaires.gob.ar/geocoder/2.2/reversegeocoding';

async function consultar([lat, lon]) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(`${USIG}?x=${lon}&y=${lat}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const t = (await r.text()).trim().replace(/^\(/, '').replace(/\);?$/, '');
    const d = JSON.parse(t);
    const m = String(d.puerta || '').match(/^(.*?)\s+(\d+)\s*$/);
    if (!m) return null;
    return { calle: m[1], altura: Number(m[2]), rango: d.calle_alturas || '' };
  } catch { return null; }
  finally { clearTimeout(to); }
}

export default manejar(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
  await exigirAdmin(req);
  const { puntos } = await req.json();
  if (!Array.isArray(puntos) || puntos.length > 500) throw new HttpError(400, 'Puntos inválidos');
  const out = new Array(puntos.length).fill(null);
  let i = 0;
  const trabajador = async () => { while (i < puntos.length) { const k = i++; out[k] = await consultar(puntos[k]); } };
  await Promise.all(Array.from({ length: 8 }, trabajador));
  return json(200, { resultados: out });
});

export const config = { path: '/api/alturas' };
