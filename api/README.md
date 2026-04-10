# City FC API

API REST que lee Google Sheets y expone endpoints para Dashboard + Make.

## Setup Rápido

### 1. Instalar dependencias
```bash
cd api
npm install
```

### 2. Credenciales Google

#### Opción A: Service Account (Recomendado para Vercel)
1. Abre https://console.cloud.google.com
2. Crea proyecto (ej: "city-fc-api")
3. Habilita Google Sheets API
4. Crea Service Account:
   - IAM & Admin → Service Accounts → Create
   - Descarga JSON key
5. Comparte el Sheets con el email de la service account:
   - Ejemplo: `city-fc@city-fc-api.iam.gserviceaccount.com`
6. Copia el JSON a `api/service-account.json`

#### Opción B: OAuth (para desarrollo local)
```bash
gcloud auth application-default login
```

### 3. .env.local
```bash
cp .env.example .env.local
```

Edita `.env.local`:
```
GOOGLE_SHEETS_ID=1oyrm3WeCXJbmxMhSWFjhnvpZ2XDr6DK9Dm__rLqO6gA
GOOGLE_SERVICE_ACCOUNT_KEY=./service-account.json
PORT=3001
```

### 4. Test local
```bash
npm run dev
curl "http://localhost:3001/api/players?club_id=city-fc"
```

## Deploy a Vercel

### 1. Conecta repo a Vercel
```bash
vercel link
```

### 2. Agrega variables de entorno en Vercel
```
GOOGLE_SHEETS_ID = 1oyrm3WeCXJbmxMhSWFjhnvpZ2XDr6DK9Dm__rLqO6gA
GOOGLE_SERVICE_ACCOUNT_KEY = (contenido del JSON)
```

### 3. Deploy
```bash
vercel deploy --prod
```

## Endpoints

### Players
- `GET /api/players?club_id=city-fc`
- `GET /api/players/:cedula?club_id=city-fc`

### Invoices
- `GET /api/invoices?club_id=city-fc&status=PENDIENTE`
- `GET /api/invoices/player/:cedula?club_id=city-fc`

### Payments
- `GET /api/payments?club_id=city-fc`
- `POST /api/payments` (manual o desde Make)

### Config
- `GET /api/config?club_id=city-fc`

### Reports
- `GET /api/reports/summary?club_id=city-fc`
- `GET /api/reports/defaulters?club_id=city-fc`

## Estructura

```
api/
├── index.js                 # Express server
├── services/
│   └── sheets.js           # Google Sheets client
├── routes/
│   ├── players.js
│   ├── invoices.js
│   ├── payments.js
│   ├── config.js
│   └── reports.js
├── package.json
├── vercel.json
└── .env.local              # Local (NO commitar)
```

## Next Steps

1. Configura Service Account en Google Cloud
2. Comparte Sheets con service account email
3. Deploy a Vercel
4. Apunta Make a esta API (próxima fase)
5. Apunta Dashboard a esta API (próxima fase)
