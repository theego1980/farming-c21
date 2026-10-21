// GET /api/config — datos públicos para que la página se conecte a Supabase
import { cfg, json } from '../lib/comun.mjs';

export default async () => {
  const { url, anon } = cfg();
  return json(200, { supabaseUrl: url || null, supabaseAnonKey: anon || null });
};

export const config = { path: '/api/config' };
