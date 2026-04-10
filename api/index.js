const API_BASE_URL = 'https://city-fc-api-v2.vercel.app/api';
const CLUB_ID = 'city-fc';

async function apiCall(endpoint) {
  const url = `${API_BASE_URL}${endpoint}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('API error');
  return res.json();
}

export async function fetchAllData() {
  try {
    const playersRes = await apiCall(`/players?club_id=${CLUB_ID}`);

    return {
      jugadores: playersRes.data || [],
      mensualidades: [],
      uniformes: [],
      torneos: [],
      registroPagos: [],
      morosos: [],
      reporteSummary: {}
    };

  } catch (error) {
    console.error(error);
    throw error;
  }
}
