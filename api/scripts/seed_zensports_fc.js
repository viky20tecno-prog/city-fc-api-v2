// Seed del club demo "Zensports FC": 120 atletas inventados (niños y niñas de 5 a 15 años,
// fútbol + voleibol + baloncesto) con TODO el año lleno — mensualidades con historial de pagos
// donde la mora baja de ~38% (cierre de enero) a ~6% (septiembre), uniformes por rondas,
// torneos, calendario con asistencia, finanzas, nómina, documentos, plantillas y comprobantes
// por conciliar. Sirve para mostrar todas las funcionalidades en ventas.
//
// Uso (desde api/api/, con .env.local → la BD de producción, la única que hay):
//   python3 scripts/assets_zensports_fc/generar_assets.py   # genera escudo, prendas, comprobantes, PDFs y el QR de pago
//   node scripts/seed_zensports_fc.js                       # dry-run: arma todo en memoria e imprime conteos + curva de mora
//   DEMO_PASSWORD='...' node scripts/seed_zensports_fc.js --apply
//   DEMO_PASSWORD='...' node scripts/seed_zensports_fc.js --apply --reset   # borra el club demo antes de sembrar
//   node scripts/seed_zensports_fc.js --solo-nuevos --apply   # solo agrega los 3 inscritos recientes al club existente
//
// Todos los datos son inventados. Los datos de contacto son de acudientes ficticios. El
// borrado total está en scripts/borrar_zensports_fc.js. Datos deterministas (PRNG con semilla).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });

const { createClient } = require('@supabase/supabase-js');
const { evolucionMora } = require('../services/mora');
const { borrarClubDemo, SLUG, EMAILS_DEMO } = require('./borrar_zensports_fc');

const APLICAR = process.argv.includes('--apply');
const RESET = process.argv.includes('--reset');
const SOLO_NUEVOS = process.argv.includes('--solo-nuevos');
const ASSETS = path.join(__dirname, 'assets_zensports_fc', 'out');
const HOY = new Date();
const ANIO = 2026;
const MES_ACTUAL = 9;
const CUOTA = 80000;
const OWNER_EMAIL = EMAILS_DEMO[0];

// ─── PRNG determinista ─────────────────────────────────────────────────────────
let _s = 20260928;
const rnd = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ent = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const barajar = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uuid = () => crypto.randomUUID();
const pad = (n) => String(n).padStart(2, '0');
// Fecha/hora de Colombia (UTC-5) → ISO
const col = (anio, mes, dia, h = 10, mi = 0) => new Date(Date.UTC(anio, mes - 1, dia, h + 5, mi)).toISOString();
const fechaISO = (anio, mes, dia) => `${anio}-${pad(mes)}-${pad(dia)}`;
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const diasDelMes = (m) => new Date(ANIO, m, 0).getDate();

// ─── Catálogos de datos inventados ─────────────────────────────────────────────
const NOMBRES_NINA = ['Valentina', 'Sofía', 'Isabella', 'Mariana', 'Salomé', 'Luciana', 'Gabriela', 'Sara', 'Antonella', 'Emilia', 'María José', 'Juliana', 'Manuela', 'Valeria', 'Samantha', 'Daniela', 'Mía', 'Victoria', 'Laura Sofía', 'Martina', 'Allison', 'Ana Lucía', 'Susana', 'Violeta', 'Paulina', 'Abigail', 'Hanna', 'Luisa Fernanda', 'Camila', 'Isabel'];
const NOMBRES_NINO = ['Santiago', 'Samuel', 'Matías', 'Sebastián', 'Emiliano', 'Jerónimo', 'Tomás', 'Martín', 'Juan José', 'Maximiliano', 'Thiago', 'Nicolás', 'Juan Pablo', 'Alejandro', 'Emmanuel', 'Jacobo', 'David', 'Simón', 'Miguel Ángel', 'Gabriel', 'Mateo', 'Agustín', 'Joaquín', 'Felipe', 'Esteban', 'Daniel', 'Julián', 'Andrés Felipe', 'Pablo', 'Benjamín'];
const APELLIDOS = ['Restrepo', 'Ospina', 'Zapata', 'Gómez', 'Arango', 'Cardona', 'Henao', 'Giraldo', 'Mejía', 'Montoya', 'Álvarez', 'Correa', 'Vélez', 'Posada', 'Duque', 'Echeverri', 'Úsuga', 'Rendón', 'Mesa', 'Quintero', 'Londoño', 'Betancur', 'Jaramillo', 'Agudelo', 'Castaño', 'Marín', 'Osorio', 'Rojas', 'Salazar', 'Tobón', 'Villa', 'Muñoz', 'Palacio', 'Rúa', 'Sierra', 'Toro', 'Uribe', 'Hoyos', 'Bedoya', 'Cano'];
const NOMBRES_MAMA = ['Luz Marina', 'Paola Andrea', 'Diana Patricia', 'Sandra Milena', 'Ana María', 'Gloria Estela', 'Catalina', 'Natalia', 'Adriana', 'Claudia Patricia', 'Liliana', 'Yuliana', 'Carolina', 'Marcela', 'Viviana', 'Eliana', 'Lina María', 'Jennifer', 'Paula', 'Alejandra'];
const NOMBRES_PAPA = ['Jorge Iván', 'Carlos Mario', 'Juan Camilo', 'Luis Fernando', 'John Jairo', 'Andrés', 'Diego Alejandro', 'Wilson', 'Hernán Darío', 'Óscar', 'Juan Carlos', 'Alexander', 'Fabio', 'Mauricio', 'Jhon Fredy', 'Rubén Darío', 'Álvaro', 'Gustavo', 'Sergio', 'Camilo'];
const ABUELAS = ['Rosalba', 'María Eugenia', 'Blanca Inés', 'Amparo', 'Gilma'];
const UBICACIONES = {
  'Medellín': ['Belén', 'Laureles', 'Robledo', 'Castilla', 'Buenos Aires', 'La América', 'Manrique', 'Aranjuez', 'San Javier', 'Guayabal', 'El Poblado', 'Floresta'],
  'Envigado': ['Zúñiga', 'La Magnolia', 'Alcalá', 'El Dorado', 'San Marcos'],
  'Itagüí': ['Santa María', 'Ditaires', 'San Pío', 'La Gloria'],
  'Bello': ['Niquía', 'Cabañas', 'Suárez', 'Fontidueño'],
  'Sabaneta': ['Aves María', 'Prados de Sabaneta', 'Calle del Banco'],
};
const EPS = ['Sura', 'Sura', 'Sura', 'Nueva EPS', 'Sanitas', 'Salud Total', 'Coomeva', 'Savia Salud', 'Famisanar'];
const RH = ['O+', 'O+', 'O+', 'O+', 'A+', 'A+', 'A+', 'B+', 'AB+', 'O-', 'A-'];
const PREFIJOS_CEL = ['300', '301', '302', '304', '305', '310', '311', '312', '313', '314', '315', '316', '317', '318', '319', '320', '321', '322', '323', '350', '351'];
const DOMINIOS = ['gmail.com', 'gmail.com', 'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com'];
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// Categorías: [nombre, deporte, equipos, cupos, añoNacDesde, añoNacHasta, %niñas]
const CATEGORIAS = [
  ['SUB-7', 'futbol', ['SUB-7'], 10, 2019, 2020, 0.4],
  ['SUB-9', 'futbol', ['SUB-9 A', 'SUB-9 B'], 14, 2017, 2018, 0.35],
  ['SUB-11', 'futbol', ['SUB-11 A', 'SUB-11 B'], 16, 2015, 2016, 0.25],
  ['SUB-13', 'futbol', ['SUB-13'], 12, 2013, 2014, 0.1],
  ['SUB-15', 'futbol', ['SUB-15'], 8, 2011, 2012, 0],
  ['FEMENINO', 'futbol', ['FEMENINO'], 10, 2012, 2016, 1],
  ['VOLEIBOL INFANTIL', 'voleibol', ['VOLEIBOL INFANTIL'], 12, 2014, 2016, 0.75],
  ['VOLEIBOL JUVENIL', 'voleibol', ['VOLEIBOL JUVENIL'], 13, 2011, 2013, 0.8],
  ['MINIBASKET', 'baloncesto', ['MINIBASKET'], 13, 2015, 2017, 0.4],
  ['BALONCESTO INFANTIL', 'baloncesto', ['BALONCESTO INFANTIL'], 12, 2012, 2014, 0.35],
];
const POSICIONES = {
  futbol: ['Portero', 'Defensa Central', 'Lateral Derecho', 'Lateral Izquierdo', 'Mediocampista', 'Mediocampista Ofensivo', 'Extremo Derecho', 'Extremo Izquierdo', 'Delantero'],
  voleibol: ['Armador', 'Opuesto', 'Central', 'Receptor', 'Libero'],
  baloncesto: ['Base', 'Escolta', 'Alero', 'Ala-Pívot', 'Pívot'],
};
const LUGARES = {
  futbol: ['Unidad Deportiva de Belén · Cancha 2', 'Cancha sintética La Floresta', 'Polideportivo Sur · Envigado'],
  voleibol: ['Coliseo Yesid Santos · Cancha auxiliar'],
  baloncesto: ['Coliseo de Baloncesto Iván de Bedout'],
};

const PRENDAS = [
  { nombre: 'Camiseta titular oficial 2026', precio: 65000, precio_proveedor: 38000, archivo: 'camiseta_titular.png', requiere_numero: true, descripcion: 'Tela dry-fit transpirable, escudo bordado y número estampado en espalda y frente. Tallas niño 4 a 16 y adulto S a 2XL.' },
  { nombre: 'Camiseta alterna blanca edición aniversario', precio: 65000, precio_proveedor: 38000, archivo: 'camiseta_alterna.png', requiere_numero: true, descripcion: 'Edición especial por los 10 años del club. Cuello en V con ribete aguamarina y número estampado.' },
  { nombre: 'Camiseta de arquero manga larga con protecciones acolchadas', precio: 75000, precio_proveedor: 45000, archivo: 'camiseta_arquero.png', requiere_numero: true, descripcion: 'Acolchado en codos y antebrazos para amortiguar caídas. Solo para porteros de fútbol.' },
  { nombre: 'Pantaloneta', precio: 35000, precio_proveedor: 18000, archivo: 'pantaloneta.png', requiere_numero: false, descripcion: 'Pantaloneta azul noche con franjas laterales y cintura elástica con cordón.' },
  { nombre: 'Medias largas antideslizantes', precio: 18000, precio_proveedor: 9000, archivo: 'medias.png', requiere_numero: false, descripcion: 'Con agarre de silicona en la planta. Par.' },
  { nombre: 'Chaqueta de presentación impermeable con capucha desmontable', precio: 120000, precio_proveedor: 72000, archivo: 'chaqueta.png', requiere_numero: false, descripcion: 'Para viajes, torneos y ceremonias. Forro interno de malla, bolsillos con cremallera y escudo bordado al pecho.' },
  { nombre: 'Maleta deportiva', precio: 85000, precio_proveedor: 50000, archivo: 'maleta.png', requiere_numero: false, descripcion: 'Compartimiento separado para guayos o tenis y bolsillo lateral para hidratación.' },
];

const TORNEOS = [
  { id: uuid(), nombre: 'Copa Valle de Aburrá Infantil 2026', fecha: '2026-03-21', valor_oficial: 60000, valor_inscrito: 80000, descripcion: 'Fútbol · categorías SUB-9 a SUB-13 · sede Envigado', filtro: (j) => ['SUB-9', 'SUB-11', 'SUB-13'].includes(j.categoria), cupos: 34 },
  { id: uuid(), nombre: 'Festival Intercolegiado de Voleibol', fecha: '2026-06-13', valor_oficial: 40000, valor_inscrito: 55000, descripcion: 'Voleibol infantil y juvenil · Coliseo Yesid Santos', filtro: (j) => j.deporte === 'voleibol', cupos: 20 },
  { id: uuid(), nombre: 'Liga Metropolitana de Baloncesto Formativo', fecha: '2026-08-08', valor_oficial: 70000, valor_inscrito: 90000, descripcion: 'Baloncesto · 6 fechas de agosto a octubre', filtro: (j) => j.deporte === 'baloncesto', cupos: 20 },
  { id: uuid(), nombre: 'Torneo Navideño Zensports 2026', fecha: '2026-12-12', valor_oficial: 30000, valor_inscrito: 45000, descripcion: 'Festival de cierre de temporada · todas las categorías', filtro: () => true, cupos: 18 },
];

// Mora objetivo (% de jugadores en mora al cierre de cada mes, enero → septiembre)
const MORA_OBJETIVO = [0.38, 0.31, 0.25, 0.19, 0.15, 0.12, 0.09, 0.07, 0.06];

// ─── Construcción en memoria ──────────────────────────────────────────────────
function celular() { return pick(PREFIJOS_CEL) + String(ent(1000000, 9999999)); }

function construir(clubId) {
  const cedulasUsadas = new Set();
  const nuevaCedula = () => { let c; do { c = String(ent(1025000000, 1041999999)); } while (cedulasUsadas.has(c)); cedulasUsadas.add(c); return c; };
  const numerosPorEquipo = {};

  const jugadores = [];
  // Hermanos: algunos acudientes tienen 2 hijos en el club (mismo apellido y acudiente)
  let familiaPrevia = null;
  for (const [cat, deporte, equipos, cupos, desde, hasta, pNinas] of CATEGORIAS) {
    for (let i = 0; i < cupos; i++) {
      const nina = rnd() < pNinas;
      const hermano = familiaPrevia && rnd() < 0.08;
      const ap1 = hermano ? familiaPrevia.ap1 : pick(APELLIDOS);
      let ap2 = hermano ? familiaPrevia.ap2 : pick(APELLIDOS); if (ap2 === ap1) ap2 = pick(APELLIDOS);
      const anioNac = ent(desde, hasta);
      const mesNac = ent(1, 12); const diaNac = ent(1, 28);
      const edad = ANIO - anioNac;
      const equipo = equipos[i % equipos.length];
      numerosPorEquipo[equipo] = numerosPorEquipo[equipo] || barajar(Array.from({ length: 30 }, (_, k) => k + 1));
      const municipio = pick(['Medellín', 'Medellín', 'Medellín', 'Envigado', 'Itagüí', 'Bello', 'Sabaneta']);
      const acudiente = hermano ? familiaPrevia.acudiente : (() => {
        const tipo = rnd() < 0.68 ? 'Mamá' : rnd() < 0.85 ? 'Papá' : 'Abuela';
        const nom = tipo === 'Mamá' ? pick(NOMBRES_MAMA) : tipo === 'Papá' ? pick(NOMBRES_PAPA) : pick(ABUELAS);
        const apA = tipo === 'Papá' ? ap1 : ap2;
        const apB = pick(APELLIDOS);
        const otroTipo = tipo === 'Papá' ? 'Mamá' : 'Papá';
        const otroNom = otroTipo === 'Mamá' ? pick(NOMBRES_MAMA) : pick(NOMBRES_PAPA);
        return {
          nombre: `${nom} ${apA} ${apB}`, tipo, celular: celular(),
          correo: `${sinTildes(nom.split(' ')[0])}.${sinTildes(apA)}${ent(10, 99)}@${pick(DOMINIOS)}`,
          segundo: `${otroNom} ${otroTipo === 'Papá' ? ap1 : ap2}`, segundoTipo: otroTipo, segundoCel: celular(),
          municipio, barrio: pick(UBICACIONES[municipio]),
          direccion: `${pick(['Calle', 'Carrera', 'Circular', 'Transversal', 'Diagonal'])} ${ent(10, 99)}${pick(['', 'A', 'B', 'C'])} # ${ent(10, 99)}-${ent(10, 99)}${rnd() < 0.5 ? ` Apto ${ent(1, 12)}0${ent(1, 4)}` : ''}`,
        };
      })();
      const j = {
        id: uuid(), club_id: clubId, cedula: nuevaCedula(),
        nombre: nina ? pick(NOMBRES_NINA) : pick(NOMBRES_NINO), apellidos: `${ap1} ${ap2}`,
        tipo_id: edad >= 7 ? 'TI' : 'RC',
        celular: acudiente.celular, correo_electronico: acudiente.correo,
        instagram: '', lugar_de_nacimiento: `${pick(['Medellín', 'Medellín', 'Envigado', 'Itagüí', 'Bello', 'Rionegro'])}, Antioquia`,
        fecha_nacimiento: fechaISO(anioNac, mesNac, diaNac),
        tipo_sangre: pick(RH), eps: pick(EPS),
        estatura: Math.round((0.75 + edad * 0.058 + (rnd() - 0.5) * 0.08) * 100) / 100,
        peso: Math.round((edad * 2.9 + 7 + (rnd() - 0.5) * 6) * 10) / 10,
        municipio: acudiente.municipio, barrio: acudiente.barrio, direccion: acudiente.direccion,
        familiar_emergencia: `${acudiente.nombre} (${acudiente.tipo})`,
        celular_contacto: acudiente.segundoCel,
        notas: `Acudiente principal: ${acudiente.nombre} (${acudiente.tipo}). Segundo contacto: ${acudiente.segundo} (${acudiente.segundoTipo}).`,
        categoria: cat, equipo, categorias: [{ categoria: cat, equipo }], deporte,
        posicion: pick(POSICIONES[deporte]), numero_camiseta: numerosPorEquipo[equipo].pop(),
        activo: true, descuento_pct: 0, tipo_descuento: 'NA',
        created_at: col(ANIO, 1, ent(8, 24), ent(8, 19), ent(0, 59)),
        _nina: nina, _inicio: 1,
      };
      jugadores.push(j);
      familiaPrevia = { ap1, ap2, acudiente };
    }
  }

  // Cumpleaños en los próximos días (la campana los muestra)
  barajar(jugadores).slice(0, 4).forEach((j, k) => {
    const d = new Date(HOY.getTime() + (k + 1) * 86400000);
    j.fecha_nacimiento = `${j.fecha_nacimiento.slice(0, 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  // Becas / descuentos
  const orden = barajar(jugadores);
  [[50, 'BECA_DEPORTIVA'], [50, 'BECA_DEPORTIVA'], [30, 'BECA_SOCIAL'], [30, 'BECA_SOCIAL'], [25, 'CONDICION_ESPECIAL'], [100, 'BECA_SOCIAL']]
    .forEach(([pct, tipo], k) => { orden[k].descuento_pct = pct; orden[k].tipo_descuento = tipo; });
  // Inscritos a mitad de año (meses previos NO_APLICA)
  [5, 6, 7, 8].forEach((mes, k) => { const j = orden[10 + k]; j._inicio = mes; j.created_at = col(ANIO, mes, ent(2, 12), 10); });
  // 3 archivados (retirados en abril), además de los 120 activos
  const archivados = [];
  for (let k = 0; k < 3; k++) {
    const base = pick(jugadores);
    const ced = nuevaCedula();
    archivados.push({ ...base, id: uuid(), cedula: ced, nombre: base._nina ? pick(NOMBRES_NINA) : pick(NOMBRES_NINO), apellidos: `${pick(APELLIDOS)} ${pick(APELLIDOS)}`, activo: false, celular: celular(), celular_contacto: celular(), numero_camiseta: null, _inicio: 1, _fin: 4, descuento_pct: 0, tipo_descuento: 'NA', notas: 'Se retiró en abril por cambio de ciudad.' });
  }

  // Suspensiones (meses no se cobran)
  const suspensiones = [];
  const suspendidos = orden.slice(20, 23);
  [['LESION', 'Esguince de tobillo grado II, incapacidad médica', 7, 8], ['VIAJE', 'Viaje familiar fuera del país', 6, 6], ['RETIRO_TEMPORAL', 'Pausa por rendimiento académico, regresa en octubre', 8, 9]]
    .forEach(([motivo, detalle, ini, fin], k) => suspensiones.push({ id: uuid(), club_id: clubId, cedula: suspendidos[k].cedula, motivo, detalle, mes_inicio: ini, mes_fin: fin, anio: ANIO, activa: true, created_at: col(ANIO, ini, 2) }));
  const mesSuspendido = (ced, m) => suspensiones.some(s => s.cedula === ced && s.mes_inicio <= m && m <= s.mes_fin);

  // ── Mensualidades + pagos calibrados a la curva de mora ──
  const todos = [...jugadores, ...archivados];
  const valorDe = (j) => Math.round(CUOTA * (1 - j.descuento_pct / 100));
  const confiabilidad = {}; todos.forEach(j => { confiabilidad[j.cedula] = rnd(); });
  const causa = (j, m) => m >= j._inicio && (!j._fin || m <= j._fin) && valorDe(j) > 0 && !mesSuspendido(j.cedula, m);

  const deudores = []; // deudores[m] = Set de cédulas en mora al cierre del mes m
  // Racha = meses seguidos en mora. Los de baja confiabilidad caen más seguido, pero nadie
  // encadena más de 2-3 meses (en la vida real el club los llama y se ponen al día), así la
  // deuda de hoy es de 1 a 3 meses, no de todo el año.
  const racha = {};
  for (let m = 1; m <= MES_ACTUAL; m++) {
    const elegibles = jugadores.filter(j => { for (let k = 1; k <= m; k++) if (causa(j, k)) return true; return false; });
    const n = Math.round(MORA_OBJETIVO[m - 1] * elegibles.length);
    const set = new Set(elegibles
      .map(j => { const r = racha[j.cedula] || 0; return { j, s: confiabilidad[j.cedula] + (rnd() - 0.5) * 0.5 - (r === 1 ? 0.15 : 0) + (r >= 2 ? (rnd() < 0.2 ? 0 : 5) : 0) }; })
      .sort((a, b) => a.s - b.s).slice(0, n).map(x => x.j.cedula));
    elegibles.forEach(j => { racha[j.cedula] = set.has(j.cedula) ? (racha[j.cedula] || 0) + 1 : 0; });
    deudores[m] = set;
  }

  const mensualidades = [];
  const pagos = [];
  const refUnica = () => `${pick(['M', 'T', 'N', 'D'])}${ent(10000000, 99999999)}`;
  const bancoDe = (m) => {
    const wa = rnd() < 0.15 + m * 0.07; // cada mes más acudientes envían el comprobante por WhatsApp
    return { wa, banco: pick(wa ? ['Nequi', 'Nequi', 'Bancolombia', 'Daviplata'] : ['Efectivo', 'Efectivo', 'Bancolombia', 'Nequi']) };
  };

  for (const j of todos) {
    const valor = valorDe(j);
    const filas = {};
    for (let m = 1; m <= 12; m++) {
      let estado = 'PENDIENTE', vo = valor;
      if (m < j._inicio || (j._fin && m > j._fin)) { estado = 'NO_APLICA'; vo = 0; }
      else if (mesSuspendido(j.cedula, m)) { estado = 'SUSPENDIDO'; vo = 0; }
      else if (valor === 0) { estado = 'AL_DIA'; }
      filas[m] = { id: uuid(), club_id: clubId, player_id: j.id, cedula: j.cedula, anio: ANIO, mes: MESES[m - 1], numero_mes: m,
        valor_oficial: vo, valor_pagado: 0, saldo_pendiente: estado === 'PENDIENTE' ? vo : 0, estado, penalidad: 0,
        fecha_ultima_actualizacion: col(ANIO, Math.min(m, MES_ACTUAL), 1) };
    }
    let cola = [];
    const ultimo = j._fin ? Math.min(j._fin, MES_ACTUAL) : MES_ACTUAL;
    for (let m = 1; m <= ultimo; m++) {
      if (causa(j, m)) cola.push(m);
      const enMora = j.activo ? deudores[m].has(j.cedula) : rnd() < MORA_OBJETIVO[m - 1];
      if (enMora || cola.length === 0) continue;
      const monto = cola.reduce((s, k) => s + filas[k].valor_oficial, 0);
      const tarde = cola[0] < m;
      const diaMax = m === MES_ACTUAL ? Math.min(HOY.getDate() - 1, 26) : diasDelMes(m) - 2;
      // A tiempo = primeros 7 días; los que se ponen al día pagan más tarde en el mes
      const dia = tarde ? ent(8, diaMax) : ent(1, Math.min(7 + Math.max(0, 5 - m), diaMax));
      const { wa, banco } = bancoDe(m);
      const fecha = col(ANIO, m, dia, ent(7, 20), ent(0, 59));
      pagos.push({ id: uuid(), club_id: clubId, player_id: j.id, cedula: j.cedula, monto, banco,
        concepto: wa ? 'mensualidad_wa' : 'mensualidad', referencia: banco === 'Efectivo' ? `Recibo de caja #${ent(1000, 9999)}` : refUnica(),
        estado_revision: 'aprobado_manual', url_comprobante: null, tipo_origen: wa ? 'WA_COMPROBANTE' : 'MANUAL', created_at: fecha });
      cola.forEach(k => { Object.assign(filas[k], { valor_pagado: filas[k].valor_oficial, saldo_pendiente: 0, estado: 'AL_DIA', fecha_ultima_actualizacion: fecha }); });
      cola = [];
    }
    // Lo que quedó sin pagar hoy → MORA (el GET /invoices lo marcaría igual). Algunos con abono parcial.
    if (j.activo && cola.length) {
      if (rnd() < 0.4) {
        const k = cola[0]; const abono = Math.round(filas[k].valor_oficial / 2);
        const fecha = col(ANIO, MES_ACTUAL, ent(10, Math.max(10, HOY.getDate() - 1)), 11);
        pagos.push({ id: uuid(), club_id: clubId, player_id: j.id, cedula: j.cedula, monto: abono, banco: 'Nequi', concepto: 'mensualidad_wa',
          referencia: refUnica(), estado_revision: 'aprobado_manual', url_comprobante: null, tipo_origen: 'WA_COMPROBANTE', created_at: fecha });
        Object.assign(filas[k], { valor_pagado: abono, saldo_pendiente: filas[k].valor_oficial - abono, estado: 'PARCIAL', fecha_ultima_actualizacion: fecha });
      }
      cola.forEach(k => { if (filas[k].estado === 'PENDIENTE') filas[k].estado = 'MORA'; });
    }
    Object.values(filas).forEach(f => mensualidades.push(f));
  }

  // ── Conciliación: comprobantes por revisar, saldo a favor, rechazados, alerta de fraude ──
  const urlComp = (i) => `__STORAGE__/club-assets/${SLUG}/comprobantes/comprobante_${i}.png`;
  const morososHoy = jugadores.filter(j => mensualidades.some(f => f.cedula === j.cedula && ['MORA', 'PARCIAL'].includes(f.estado) && f.numero_mes <= MES_ACTUAL));
  const alDiaHoy = jugadores.filter(j => !morososHoy.includes(j) && valorDe(j) > 0);
  const actividad = [];
  const pendientes = [
    [morososHoy[0] || alDiaHoy[40], 80000, 'mensualidad_wa', 1],
    [morososHoy[1] || alDiaHoy[41], 80000, 'mensualidad_wa', 2],
    [morososHoy[2] || alDiaHoy[42], 160000, 'mensualidad_wa', 3],
    [alDiaHoy[3], 40000, 'uniformes_wa', 4],
    [alDiaHoy[4], 90000, 'torneo_wa', 9],
    [alDiaHoy[5], 80000, 'mensualidad_wa', 10],
  ];
  pendientes.forEach(([j, monto, concepto, img], k) => pagos.push({ id: uuid(), club_id: clubId, player_id: j.id, cedula: j.cedula, monto,
    banco: pick(['Nequi', 'Bancolombia', 'Daviplata']), concepto, referencia: refUnica(), estado_revision: 'pendiente',
    url_comprobante: urlComp(img), tipo_origen: 'WA_COMPROBANTE', created_at: col(ANIO, MES_ACTUAL, Math.min(20 + k, HOY.getDate()), 9 + k, 12) }));
  // Referencia repetida contra un pago ya aprobado → badge de posible fraude
  const aprobadoConRef = pagos.find(p => p.estado_revision === 'aprobado_manual' && /^[MTND]\d+$/.test(p.referencia) && p.created_at < col(ANIO, 8, 31));
  pagos[pagos.length - 1].referencia = aprobadoConRef.referencia;
  // Saldo a favor: pagó de más y dejó una nota
  const excedente = { id: uuid(), club_id: clubId, player_id: alDiaHoy[6].id, cedula: alDiaHoy[6].cedula, monto: 240000, banco: 'Bancolombia',
    concepto: 'mensualidad_wa', referencia: refUnica(), estado_revision: 'excedente_pendiente', url_comprobante: urlComp(6),
    tipo_origen: 'TRANSFERENCIA_EXCEDENTE', created_at: col(ANIO, MES_ACTUAL, Math.min(24, HOY.getDate()), 18, 40) };
  pagos.push(excedente);
  actividad.push({ id: uuid(), club_id: clubId, club_slug: SLUG, user_email: alDiaHoy[6].correo_electronico, user_role: 'JUGADOR', user_name: alDiaHoy[6].familiar_emergencia,
    action: 'NOTA_JUGADOR_COMPROBANTE', entity_type: 'pago', entity_id: excedente.id, entity_label: `${alDiaHoy[6].nombre} ${alDiaHoy[6].apellidos}`,
    details: { nota: 'Adelanto octubre, noviembre y diciembre para dejar el año pago 🙌' }, created_at: excedente.created_at });
  [[alDiaHoy[7], 80000, 5, 'Comprobante ilegible, se pidió reenviar'], [alDiaHoy[8], 60000, 8, 'El valor no coincide con la transferencia recibida']]
    .forEach(([j, monto, img], k) => pagos.push({ id: uuid(), club_id: clubId, player_id: j.id, cedula: j.cedula, monto, banco: 'Nequi',
      concepto: 'mensualidad_wa', referencia: refUnica(), estado_revision: 'rechazado', url_comprobante: urlComp(img), tipo_origen: 'WA_COMPROBANTE',
      created_at: col(ANIO, 8, 12 + k * 6, 16) }));

  // ── Uniformes: 2 rondas a fábrica + pedidos sin ronda ──
  const catalogo = PRENDAS.map(p => ({ nombre: p.nombre, precio: p.precio, precio_proveedor: p.precio_proveedor, imagen_url: `__STORAGE__/club-assets/${SLUG}/prendas/${p.archivo}`, descripcion: p.descripcion, requiere_numero: p.requiere_numero }));
  const P = Object.fromEntries(PRENDAS.map(p => [p.nombre.split(' ')[0] + (p.nombre.includes('alterna') ? 'A' : p.nombre.includes('arquero') ? 'Q' : ''), p]));
  const tallaDe = (j) => { const e = ANIO - parseInt(j.fecha_nacimiento); return e <= 6 ? '6' : e <= 8 ? '8' : e <= 10 ? '10' : e <= 12 ? '12' : e <= 14 ? '14' : '16'; };
  const pedidos = []; const prendasPedido = [];
  const conPedido = barajar(jugadores).slice(0, 82);
  conPedido.forEach((j, idx) => {
    const ronda = idx < 44 ? '2026-02-14' : idx < 72 ? '2026-07-18' : null;
    const creado = ronda === '2026-02-14' ? col(ANIO, 1, ent(20, 31), 12) : ronda ? col(ANIO, 6, ent(20, 30), 12) : col(ANIO, 9, ent(1, Math.min(25, HOY.getDate() - 1)), 12);
    const items = [P.Camiseta, P.Pantaloneta, P.Medias];
    if (j.posicion === 'Portero') items[0] = P.CamisetaQ;
    if (rnd() < 0.35) items.push(P.CamisetaA);
    if (rnd() < 0.3) items.push(P.Chaqueta);
    if (rnd() < 0.2) items.push(P.Maleta);
    const proveedor = rnd() < 0.06; // becados / hijos de entrenadores a precio de proveedor
    const precioDe = (p) => proveedor ? p.precio_proveedor : p.precio;
    const total = items.reduce((s, p) => s + precioDe(p), 0);
    let fraccion = ronda === '2026-02-14' ? 1 : ronda ? pick([1, 1, 1, 0.5, 0.6, 0]) : pick([0, 0, 0.3, 0.5, 1]);
    const estadoPedido = fraccion >= 1 ? (ronda === '2026-02-14' || (ronda && rnd() < 0.6) ? 'ENTREGADO' : 'PAGADO') : fraccion > 0 ? 'ABONO' : 'PENDIENTE';
    const pedidoId = uuid();
    let porRepartir = Math.round(total * fraccion);
    const pagadoTotal = porRepartir;
    items.forEach(p => {
      const precio = precioDe(p); const pagado = Math.min(precio, porRepartir); porRepartir -= pagado;
      prendasPedido.push({ id: uuid(), pedido_id: pedidoId, nombre: p.nombre, cantidad: 1, precio_unitario: precio, precio_proveedor: p.precio_proveedor,
        valor_pagado: pagado, estado: pagado <= 0 ? 'PENDIENTE' : pagado >= precio ? 'PAGADO' : 'ABONO', created_at: creado });
    });
    pedidos.push({ id: pedidoId, club_id: clubId, player_id: j.id, cedula: j.cedula, nombre: `${j.nombre} ${j.apellidos}`, tipo: 'Jugador',
      campeon: false, talla: tallaDe(j), nombre_estampar: j.nombre.split(' ')[0].toUpperCase(), numero_estampar: String(j.numero_camiseta || ''),
      prendas: items.map(p => p.nombre).join(', '), total, valor_pagado: pagadoTotal, abono_legacy: 0, estado: estadoPedido,
      ronda_fecha: ronda, a_precio_proveedor: proveedor, created_at: creado });
  });
  // Personal / staff
  [['Coordinación deportiva', '1017845521', 'L'], ['Entrenador fútbol', '1036654102', 'M'], ['Entrenadora voleibol', '1152447893', 'S']].forEach(([rol, ced, talla], k) => {
    const pedidoId = uuid(); const items = [P.Chaqueta, P.Camiseta];
    const total = items.reduce((s, p) => s + p.precio_proveedor, 0);
    items.forEach(p => prendasPedido.push({ id: uuid(), pedido_id: pedidoId, nombre: p.nombre, cantidad: 1, precio_unitario: p.precio_proveedor, precio_proveedor: p.precio_proveedor, valor_pagado: p.precio_proveedor, estado: 'PAGADO', created_at: col(ANIO, 7, 1) }));
    pedidos.push({ id: pedidoId, club_id: clubId, player_id: null, cedula: ced, nombre: ['Ricardo Álvarez Toro', 'Julián Mesa Arango', 'Paula Andrea Rendón'][k], tipo: 'Personal',
      campeon: false, talla, nombre_estampar: rol.split(' ')[0].toUpperCase(), numero_estampar: '', prendas: items.map(p => p.nombre).join(', '),
      total, valor_pagado: total, abono_legacy: 0, estado: 'ENTREGADO', ronda_fecha: '2026-07-18', a_precio_proveedor: true, created_at: col(ANIO, 7, 1) });
  });

  // ── Torneos ──
  const torneos = [];
  TORNEOS.forEach((t, ti) => {
    barajar(jugadores.filter(t.filtro)).slice(0, t.cupos).forEach(j => {
      const pasado = t.fecha < fechaISO(ANIO, MES_ACTUAL, HOY.getDate());
      const descuento = rnd() < 0.08 ? 10000 : 0;
      const neto = t.valor_inscrito - descuento;
      const pagado = pasado ? (ti === 2 && rnd() < 0.25 ? pick([0, Math.round(neto / 2)]) : neto) : pick([0, 0, Math.round(neto / 2), neto]);
      const saldo = neto - pagado;
      torneos.push({ id: uuid(), club_id: clubId, player_id: j.id, cedula: j.cedula, nombre_torneo: t.nombre, torneo_id: t.id,
        valor_oficial: t.valor_oficial, valor_inscrito: t.valor_inscrito, valor_pagado: pagado, saldo_pendiente: saldo, descuento,
        concepto_descuento: descuento ? 'Descuento hermanos' : null, estado: saldo === 0 ? 'AL_DIA' : pagado > 0 ? 'ABONO' : 'PENDIENTE',
        monto_inscripcion: t.valor_inscrito, pagado: saldo === 0, fecha_ultima_actualizacion: col(parseInt(t.fecha), parseInt(t.fecha.slice(5, 7)), 1) });
    });
  });

  // ── Calendario + asistencia ──
  const equipos = [...new Set(jugadores.map(j => j.equipo))];
  const deporteDe = (eq) => jugadores.find(j => j.equipo === eq).deporte;
  const calendario = []; const asistencia = [];
  const DIAS_EQUIPO = {}; equipos.forEach((eq, k) => { DIAS_EQUIPO[eq] = [k % 5, (k + 2) % 5]; });
  const inicio = new Date(Date.UTC(ANIO, 7, 3)); // lunes 3 ago
  for (let semana = 0; semana < 12; semana++) {
    equipos.forEach((eq, k) => {
      DIAS_EQUIPO[eq].forEach((dow, n) => {
        const f = new Date(inicio.getTime() + (semana * 7 + dow) * 86400000);
        const hora = 15 + (k % 3);
        const inicioISO = col(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), hora, 30);
        calendario.push({ id: uuid(), club_id: SLUG, tipo: 'ENTRENAMIENTO', titulo: `Entrenamiento ${eq}`, descripcion: n === 0 ? 'Técnica y coordinación' : 'Táctica y juego reducido',
          fecha_inicio: inicioISO, fecha_fin: col(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate(), hora + 1, 45), lugar: LUGARES[deporteDe(eq)][k % LUGARES[deporteDe(eq)].length],
          equipo: eq, suspendido: false, monto_arbitraje: null, convocados: null });
      });
    });
  }
  // Un entrenamiento suspendido por lluvia
  const lluvia = calendario.find(e => e.fecha_inicio > col(ANIO, 9, 15) && e.equipo === 'SUB-11 A'); if (lluvia) lluvia.suspendido = true;
  // Partidos: sábados
  const RIVALES = ['Escuela Deportiva Los Halcones', 'Club Atlético Guayabal', 'Fundación Balón de Barrio', 'Estrellas del Sur FC', 'Academia Real Envigado', 'Club Bello Horizonte', 'Deportivo La Frontera', 'Tigres de Itagüí'];
  const sabados = Array.from({ length: 11 }, (_, k) => new Date(Date.UTC(ANIO, 7, 8 + k * 7)));
  sabados.forEach((s, k) => {
    [equipos[k % equipos.length], equipos[(k + 5) % equipos.length]].forEach((eq, n) => {
      const rival = RIVALES[(k + n) % RIVALES.length];
      const plantel = jugadores.filter(j => j.equipo === eq);
      calendario.push({ id: uuid(), club_id: SLUG, tipo: 'PARTIDO', titulo: `Zensports ${eq} vs ${rival}`, descripcion: n === 0 ? 'Fecha de liga' : 'Partido amistoso',
        fecha_inicio: col(ANIO, s.getUTCMonth() + 1, s.getUTCDate(), 8 + n * 2), fecha_fin: col(ANIO, s.getUTCMonth() + 1, s.getUTCDate(), 9 + n * 2, 30),
        lugar: LUGARES[deporteDe(eq)][0], equipo: eq, suspendido: false, monto_arbitraje: deporteDe(eq) === 'futbol' ? 10000 : 8000,
        convocados: barajar(plantel).slice(0, Math.min(plantel.length, 12)).map(j => j.cedula) });
    });
  });
  calendario.push({ id: uuid(), club_id: SLUG, tipo: 'EVENTO', titulo: 'Reunión general de acudientes', descripcion: 'Balance del semestre, torneo navideño y nuevos uniformes',
    fecha_inicio: col(ANIO, 10, 4, 10), fecha_fin: col(ANIO, 10, 4, 12), lugar: 'Auditorio Casa de la Cultura de Belén', equipo: null, suspendido: false, monto_arbitraje: null, convocados: null });
  calendario.push({ id: uuid(), club_id: SLUG, tipo: 'EVENTO', titulo: 'Jornada de valoración física', descripcion: 'Talla, peso y pruebas de velocidad para todas las categorías',
    fecha_inicio: col(ANIO, 9, 5, 8), fecha_fin: col(ANIO, 9, 5, 13), lugar: 'Unidad Deportiva de Belén', equipo: null, suspendido: false, monto_arbitraje: null, convocados: null });

  const NOTAS_JUSTIF = ['Cita médica', 'Enfermo (gripa)', 'Evento del colegio', 'Viaje familiar', 'Calamidad doméstica'];
  calendario.filter(e => e.fecha_inicio < HOY.toISOString() && !e.suspendido && e.equipo).forEach(e => {
    const lista = e.convocados ? jugadores.filter(j => e.convocados.includes(j.cedula)) : jugadores.filter(j => j.equipo === e.equipo);
    lista.forEach(j => {
      const r = rnd();
      const estado = r < 0.84 ? 'PRESENTE' : r < 0.93 ? 'AUSENTE' : 'JUSTIFICADO';
      asistencia.push({ id: uuid(), evento_id: e.id, club_id: clubId, cedula: j.cedula, estado, nota: estado === 'JUSTIFICADO' ? pick(NOTAS_JUSTIF) : null,
        pago_arbitraje: e.tipo === 'PARTIDO' && estado === 'PRESENTE' && rnd() < 0.9, created_at: e.fecha_fin, updated_at: e.fecha_fin });
    });
  });

  // ── Finanzas manuales + nómina ──
  const finanzas = []; const empleados = []; const nominaPagos = [];
  const EMPLEADOS = [['Ricardo Álvarez Toro', 'Coordinador deportivo', 1800000], ['Julián Mesa Arango', 'Entrenador de fútbol', 1200000],
    ['Andrés Felipe Cano', 'Entrenador de fútbol', 1200000], ['Paula Andrea Rendón', 'Entrenadora de voleibol', 1100000], ['Sergio Bedoya Hoyos', 'Entrenador de baloncesto', 1100000]];
  EMPLEADOS.forEach(([nombre, cargo, salario], k) => {
    const emp = { id: 900000 + k, _tmpId: k, club_id: clubId, nombre, cargo, salario_mensual: salario, activo: true, created_at: col(ANIO, 1, 5) };
    empleados.push(emp);
    for (let m = 1; m <= (k === 4 ? MES_ACTUAL - 1 : MES_ACTUAL); m++) { // baloncesto aún no cobra septiembre → aparece pendiente
      if (m === MES_ACTUAL && HOY.getDate() < 25) continue;
      const fecha = fechaISO(ANIO, m, m === MES_ACTUAL ? Math.min(25, HOY.getDate()) : 30 - (m === 2 ? 2 : 0));
      nominaPagos.push({ _empleado: k, club_id: clubId, mes: `${ANIO}-${pad(m)}`, monto: salario, fecha_pago: fecha, notas: 'Transferencia Bancolombia' });
      finanzas.push({ club_id: clubId, tipo: 'gasto', categoria: 'Nómina', descripcion: `Nómina ${MESES[m - 1]} — ${nombre}`, monto: salario, fecha });
    }
  });
  for (let m = 1; m <= MES_ACTUAL; m++) {
    const f = (d) => fechaISO(ANIO, m, Math.min(d, m === MES_ACTUAL ? HOY.getDate() : 28));
    finanzas.push({ club_id: clubId, tipo: 'gasto', categoria: 'Alquiler de cancha', descripcion: `Alquiler canchas y coliseos ${MESES[m - 1]}`, monto: 1400000, fecha: f(5) });
    finanzas.push({ club_id: clubId, tipo: 'gasto', categoria: 'Servicios (agua, luz)', descripcion: 'Hidratación y botiquín', monto: ent(12, 20) * 10000, fecha: f(12) });
    if (m % 2 === 0) finanzas.push({ club_id: clubId, tipo: 'gasto', categoria: 'Transporte', descripcion: 'Bus a partidos fuera de Medellín', monto: ent(35, 60) * 10000, fecha: f(18) });
    if ([2, 7].includes(m)) finanzas.push({ club_id: clubId, tipo: 'gasto', categoria: 'Uniformes y equipamiento', descripcion: m === 2 ? 'Balones, conos y petos temporada' : 'Reposición de balones y mallas', monto: m === 2 ? 1850000 : 960000, fecha: f(9) });
    if ([3, 6, 8].includes(m)) finanzas.push({ club_id: clubId, tipo: 'gasto', categoria: 'Inscripción torneo', descripcion: `Inscripción ${TORNEOS[[3, 6, 8].indexOf(m)].nombre}`, monto: [34 * 60000, 20 * 40000, 20 * 70000][[3, 6, 8].indexOf(m)], fecha: f(2) });
    if (m >= 8) finanzas.push({ club_id: clubId, tipo: 'gasto', categoria: 'Árbitros', descripcion: 'Arbitraje partidos de liga', monto: 180000, fecha: f(22) });
    if (m >= 4) finanzas.push({ club_id: clubId, tipo: 'ingreso', categoria: 'Patrocinio / Sponsor', descripcion: 'Patrocinio Panadería y Repostería El Trigal', monto: 800000, fecha: f(3) });
  }
  finanzas.push({ club_id: clubId, tipo: 'ingreso', categoria: 'Evento / Rifa', descripcion: 'Rifa pro-viaje Festival de Voleibol', monto: 1350000, fecha: fechaISO(ANIO, 5, 30) });
  finanzas.push({ club_id: clubId, tipo: 'ingreso', categoria: 'Donación', descripcion: 'Donación de balones — Ferretería Los Andes', monto: 450000, fecha: fechaISO(ANIO, 8, 14) });
  finanzas.push({ club_id: clubId, tipo: 'gasto', categoria: 'Mantenimiento', descripcion: 'Arreglo de arcos portátiles', monto: 320000, fecha: fechaISO(ANIO, 6, 11) });

  // ── Plantillas, log de envíos, documentos ──
  const plantillas = [
    ['Recordatorio de entrenamiento', 'ENTRENAMIENTO', '14:00', false, 'Hola {nombre} 👋 Te esperamos hoy {dia} en {lugar} de {hora_inicio} a {hora_fin}. ¡Trae hidratación y llega 15 minutos antes! — {club_nombre}'],
    ['Convocatoria a partido', 'PARTIDO', '18:00', false, '⚽ {nombre}, estás convocado(a) para el partido del {dia} a las {hora_inicio} en {lugar}. Uniforme titular completo. ¡Vamos Zensports!'],
    ['Reunión de acudientes', 'EVENTO', '09:00', false, 'Estimada familia de {nombre}: los esperamos el {dia} a las {hora_inicio} en {lugar}. Tu asistencia es muy importante. — {club_nombre}'],
    ['Recordatorio de mensualidad', 'todos', '08:00', true, 'Hola familia de {nombre} 💙 Recuerda que la mensualidad se paga dentro de los primeros 7 días del mes. Puedes pagar con la llave {llave_pago} y enviarnos el comprobante por aquí.'],
  ].map(([nombre, tipo_evento, hora_envio, incluir_qr, mensaje]) => ({ id: uuid(), club_id: clubId, nombre, mensaje, incluir_qr, hora_envio, activa: true, tipo_plantilla: 'evento', tipo_evento, created_at: col(ANIO, 2, 1) }));
  const waLog = barajar(jugadores).slice(0, 78).map(j => ({ id: uuid(), club_id: clubId, cedula: j.cedula, tipo_mensaje: 'estado_cuenta', mes: MES_ACTUAL, anio: ANIO, enviado_at: col(ANIO, MES_ACTUAL, ent(1, 6), ent(8, 18)) }));
  const documentos = [
    ['Reglamento interno', 'reglamento_interno.pdf', 'Normas de convivencia, puntualidad, pagos y uniformes', true],
    ['Autorización de acudientes', 'autorizacion_acudientes.pdf', 'Formato de autorización para menores de edad', true],
    ['Política de tratamiento de datos', 'tratamiento_datos.pdf', 'Ley 1581 de 2012 — habeas data', true],
    ['Calendario de la temporada 2026', 'calendario_temporada.pdf', 'Torneos y fechas clave del año', false],
  ].map(([nombre, archivo, descripcion, enviar], k) => ({ id: uuid(), club_id: clubId, nombre, url: `__STORAGE__/club-assets/${SLUG}/documentos/${archivo}`, descripcion, enviar_al_inscribirse: enviar, activo: true, orden: k + 1, created_at: col(ANIO, 1, 3) }));

  const nuevos = nuevosInscritos(clubId);
  jugadores.push(...nuevos.jugadores); mensualidades.push(...nuevos.mensualidades); pagos.push(...nuevos.pagos);

  return { jugadores, archivados, suspensiones, mensualidades, pagos, actividad, catalogo, pedidos, prendasPedido, torneos, calendario, asistencia, finanzas, empleados, nominaPagos, plantillas, waLog, documentos, equipos };
}

// 3 jugadores inscritos en los últimos días (sin PRNG, para no alterar el resto del seed):
// son los que aparecen en Calendario → "Ingresos" para agendar sus 2 primeras clases.
// Pagaron la mensualidad de septiembre al inscribirse; los meses previos son NO_APLICA.
function nuevosInscritos(clubId) {
  const NUEVOS = [
    { cedula: '1042310551', nombre: 'Antonella', apellidos: 'Zapata Villa', nina: true, categoria: 'SUB-9', equipo: 'SUB-9 A', deporte: 'futbol', posicion: 'Mediocampista', nac: '2017-05-14', dias: 6,
      acudiente: 'Paola Andrea Villa Rojas (Mamá)', cel: '3017845120', cel2: '3124459087', correo: 'paola.villa84@gmail.com', municipio: 'Medellín', barrio: 'Belén', dir: 'Carrera 76 # 30-45' },
    { cedula: '1042310552', nombre: 'Simón', apellidos: 'Rendón Mesa', nina: false, categoria: 'MINIBASKET', equipo: 'MINIBASKET', deporte: 'baloncesto', posicion: 'Base', nac: '2016-02-03', dias: 4,
      acudiente: 'Jorge Iván Rendón Toro (Papá)', cel: '3158820417', cel2: '3006631295', correo: 'jorge.rendon71@hotmail.com', municipio: 'Envigado', barrio: 'La Magnolia', dir: 'Calle 38 Sur # 42-18 Apto 402' },
    { cedula: '1042310553', nombre: 'Luciana', apellidos: 'Ospina Cardona', nina: true, categoria: 'VOLEIBOL INFANTIL', equipo: 'VOLEIBOL INFANTIL', deporte: 'voleibol', posicion: 'Receptor', nac: '2015-09-22', dias: 2,
      acudiente: 'Diana Patricia Cardona Gil (Mamá)', cel: '3206674031', cel2: '3113380952', correo: 'diana.cardona77@gmail.com', municipio: 'Itagüí', barrio: 'Santa María', dir: 'Calle 45 # 52-10' },
  ];
  const jugadores = []; const mensualidades = []; const pagos = [];
  NUEVOS.forEach(n => {
    const creado = new Date(HOY.getTime() - n.dias * 86400000);
    const j = {
      id: uuid(), club_id: clubId, cedula: n.cedula, nombre: n.nombre, apellidos: n.apellidos, tipo_id: 'TI',
      celular: n.cel, correo_electronico: n.correo, instagram: '', lugar_de_nacimiento: 'Medellín, Antioquia', fecha_nacimiento: n.nac,
      tipo_sangre: 'O+', eps: 'Sura', estatura: 1.32, peso: 29.5, municipio: n.municipio, barrio: n.barrio, direccion: n.dir,
      familiar_emergencia: n.acudiente, celular_contacto: n.cel2, notas: `Inscripción nueva. Acudiente principal: ${n.acudiente}.`,
      categoria: n.categoria, equipo: n.equipo, categorias: [{ categoria: n.categoria, equipo: n.equipo }], deporte: n.deporte,
      posicion: n.posicion, numero_camiseta: null, activo: true, descuento_pct: 0, tipo_descuento: 'NA', created_at: creado.toISOString(), _nina: n.nina,
    };
    jugadores.push(j);
    const pagoSep = { id: uuid(), club_id: clubId, player_id: j.id, cedula: j.cedula, monto: CUOTA, banco: 'Nequi', concepto: 'mensualidad',
      referencia: `N${n.cedula.slice(-8)}`, estado_revision: 'aprobado_manual', url_comprobante: null, tipo_origen: 'MANUAL', created_at: creado.toISOString() };
    pagos.push(pagoSep);
    for (let m = 1; m <= 12; m++) {
      const antes = m < MES_ACTUAL, actual = m === MES_ACTUAL;
      mensualidades.push({ id: uuid(), club_id: clubId, player_id: j.id, cedula: j.cedula, anio: ANIO, mes: MESES[m - 1], numero_mes: m,
        valor_oficial: antes ? 0 : CUOTA, valor_pagado: actual ? CUOTA : 0, saldo_pendiente: antes || actual ? 0 : CUOTA,
        estado: antes ? 'NO_APLICA' : actual ? 'AL_DIA' : 'PENDIENTE', penalidad: 0, fecha_ultima_actualizacion: creado.toISOString() });
    }
  });
  return { jugadores, mensualidades, pagos };
}

function configClub(logoUrl, qrUrl, catalogo, equipos) {
  const cats = CATEGORIAS.map(([nombre, , eqs]) => ({ nombre, equipos: eqs }));
  return {
    nombre: 'Zensports FC', subtitulo: 'Escuela deportiva formativa · Medellín', ciudad: 'Medellín', codigo_pais: '57',
    color: '#00B8A9', logo_url: logoUrl, plan: 'scale', trial_ends_at: null,
    modulos: { dashboard: true, jugadores: true, calendario: true, equipos: true, uniformes: true, torneos: true, conciliacion: true, finanzas: true, plantillas: true, documentos: true },
    deporte: 'futbol', deportes: ['futbol', 'voleibol', 'baloncesto'],
    valor_mensualidad: CUOTA, dias_gracia_mora: 7, penalidad_mora: 0, penalidad_habilitada: false,
    onboarding_completed: true, carnet_v2: true, carnet_fondo: 'onyx',
    categorias_jugadores: cats, prendas_uniforme: catalogo,
    torneos_iniciales: TORNEOS.map(({ id, nombre, fecha, valor_oficial, valor_inscrito, descripcion }) => ({ id, nombre, fecha, valor_oficial, valor_inscrito, descripcion })),
    llave_pago: '@zensportsfc', qr_pago_url: qrUrl, whatsapp: '3009990000',
    redes_sociales: { instagram: '@zensportsfc', facebook: 'facebook.com/zensportsfc', tiktok: '@zensportsfc' },
    cuenta_bancaria: { tipo: 'Ahorros', banco: 'Bancolombia', numero: '000-000000-00' }, razon_social: 'Club Deportivo Zensports FC', nit: '900.000.000-0',
    emails_enviados: { bienvenida: true, dia3: true, dia5: true, dia7: true },
  };
}

function resumen(d) {
  const ev = evolucionMora({ mensualidades: d.mensualidades, pagos: d.pagos, jugadores: d.jugadores, suspensiones: d.suspensiones, anio: ANIO, hoy: HOY, diasGracia: 7 });
  console.log('\nConteos:');
  [['jugadores activos', d.jugadores], ['archivados', d.archivados], ['mensualidades', d.mensualidades], ['pagos', d.pagos], ['suspensiones', d.suspensiones],
    ['pedidos uniforme', d.pedidos], ['prendas de pedido', d.prendasPedido], ['inscripciones torneo', d.torneos], ['eventos calendario', d.calendario],
    ['asistencias', d.asistencia], ['movimientos finanzas', d.finanzas], ['empleados', d.empleados], ['pagos nómina', d.nominaPagos],
    ['plantillas', d.plantillas], ['envíos WA', d.waLog], ['documentos', d.documentos]].forEach(([k, v]) => console.log(`  ${k.padEnd(22)} ${v.length}`));
  console.log('\nEvolución de la mora (confiable=' + ev.confiable + '):');
  console.log('  ' + ev.meses.map(m => `${m.mes.slice(0, 3)} ${m.porcentaje}%`).join(' · '));
  const enMora = new Set(d.mensualidades.filter(m => ['MORA', 'PARCIAL'].includes(m.estado) && m.numero_mes <= MES_ACTUAL).map(m => m.cedula));
  const meses = [...enMora].map(c => d.mensualidades.filter(m => m.cedula === c && ['MORA', 'PARCIAL'].includes(m.estado)).length);
  console.log(`  Jugadores con deuda hoy: ${enMora.size} (meses adeudados: ${meses.sort().join(', ')})`);
  return ev;
}

// ─── Aplicar ──────────────────────────────────────────────────────────────────
async function insertar(sb, tabla, filas, lote = 500) {
  for (let i = 0; i < filas.length; i += lote) {
    const { error } = await sb.from(tabla).insert(filas.slice(i, i + lote));
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
  console.log(`  ✓ ${tabla} (${filas.length})`);
}

async function subir(sb, bucket, ruta, cuerpo, tipo) {
  const { error } = await sb.storage.from(bucket).upload(ruta, cuerpo, { contentType: tipo, upsert: true });
  if (error) throw new Error(`storage ${bucket}/${ruta}: ${error.message}`);
  return sb.storage.from(bucket).getPublicUrl(ruta).data.publicUrl;
}

async function avatar(j) {
  const pelo = j._nina ? 'long01,long03,long04,long06,long08,long11,long13,long16,long19,long22' : 'short01,short02,short04,short05,short08,short11,short12,short16,short19';
  const url = `https://api.dicebear.com/9.x/adventurer/png?size=256&seed=${encodeURIComponent(j.cedula)}&hair=${pelo}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf,d1f4e0&earringsProbability=${j._nina ? 30 : 0}&glassesProbability=8`;
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    await new Promise(res => setTimeout(res, 1500));
  }
  throw new Error('No se pudo generar el avatar de ' + j.cedula);
}

async function main() {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local'); process.exit(1); }
  if (!fs.existsSync(path.join(ASSETS, 'escudo.png'))) { console.error('Faltan assets: corré primero python3 scripts/assets_zensports_fc/generar_assets.py'); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Supabase: ${url} — ${APLICAR ? 'MODO APLICAR (va a escribir)' : 'dry-run (no escribe nada)'}`);

  const { data: existente } = await sb.from('clubs').select('id').eq('slug', SLUG).maybeSingle();
  if (SOLO_NUEVOS) { await agregarNuevos(sb, existente); return; }
  if (existente && !RESET) { console.error(`El club ${SLUG} ya existe. Usá --reset para borrarlo y volver a sembrar.`); process.exit(1); }

  const clubId = uuid();
  const d = construir(clubId);
  resumen(d);
  if (!APLICAR) { console.log('\nDry-run: nada se escribió. Agregá --apply para sembrar.'); return; }
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 8) { console.error('Definí DEMO_PASSWORD (≥ 8 caracteres) para la cuenta demo.'); process.exit(1); }

  if (existente) { console.log('\n--reset: borrando el club demo existente…'); await borrarClubDemo(sb); }

  console.log('\nSubiendo assets…');
  const STORAGE = `${url}/storage/v1/object/public`;
  const leer = (f) => fs.readFileSync(path.join(ASSETS, f));
  const logoUrl = await subir(sb, 'player-photos', `clubs/${SLUG}/logo.png`, leer('escudo.png'), 'image/png');
  const qrUrl = await subir(sb, 'club-assets', `clubs/${SLUG}/qr-pago.png`, leer('qr_pago.png'), 'image/png');
  for (const p of PRENDAS) await subir(sb, 'club-assets', `${SLUG}/prendas/${p.archivo}`, leer(p.archivo), 'image/png');
  for (let i = 1; i <= 10; i++) await subir(sb, 'club-assets', `${SLUG}/comprobantes/comprobante_${i}.png`, leer(`comprobante_${i}.png`), 'image/png');
  for (const f of ['reglamento_interno', 'autorizacion_acudientes', 'tratamiento_datos', 'calendario_temporada']) await subir(sb, 'club-assets', `${SLUG}/documentos/${f}.pdf`, leer(`${f}.pdf`), 'application/pdf');
  console.log('  ✓ escudo, QR, prendas, comprobantes, documentos');

  const todos = [...d.jugadores, ...d.archivados];
  for (let i = 0; i < todos.length; i += 8) {
    await Promise.all(todos.slice(i, i + 8).map(async j => { j.foto_url = await subir(sb, 'player-photos', `${SLUG}/${j.cedula}.png`, await avatar(j), 'image/png'); }));
  }
  console.log(`  ✓ avatares (${todos.length})`);

  const conStorage = (s) => s.replace('__STORAGE__', STORAGE);
  d.catalogo.forEach(p => { p.imagen_url = conStorage(p.imagen_url); });
  d.pagos.forEach(p => { if (p.url_comprobante) p.url_comprobante = conStorage(p.url_comprobante); });
  d.documentos.forEach(x => { x.url = conStorage(x.url); });

  console.log('\nCuentas…');
  const usuarios = [];
  for (const [email, nombre] of [[OWNER_EMAIL, 'Coordinación Zensports FC'], [EMAILS_DEMO[1], 'Julián Mesa Arango'], [EMAILS_DEMO[2], 'Paula Andrea Rendón']]) {
    const pass = email === OWNER_EMAIL ? password : crypto.randomBytes(18).toString('base64url');
    const { data, error } = await sb.auth.admin.createUser({ email, password: pass, email_confirm: true, user_metadata: { nombre, club_slug: SLUG } });
    if (error) throw new Error(`auth ${email}: ${error.message}`);
    usuarios.push(data.user.id);
  }
  console.log('  ✓ ' + EMAILS_DEMO.join(', '));

  console.log('\nInsertando…');
  const { error: e1 } = await sb.from('clubs').insert({ id: clubId, name: 'Zensports FC', slug: SLUG, plan: 'scale', is_active: true, owner_user_id: usuarios[0],
    celular_admin: '3009990000', config: configClub(logoUrl, qrUrl, d.catalogo, d.equipos), created_at: col(ANIO, 1, 6), admin_notes: 'Club DEMO (datos inventados) — scripts/seed_zensports_fc.js' });
  if (e1) throw new Error('clubs: ' + e1.message);
  console.log('  ✓ clubs');
  await insertar(sb, 'club_members', [
    { user_id: usuarios[0], club_id: SLUG, role: 'ADMIN', nombre: 'Coordinación Zensports FC', activo: true, celular: '3009990000' },
    { user_id: usuarios[1], club_id: SLUG, role: 'ENTRENADOR', nombre: 'Julián Mesa Arango', activo: true, celular: '3009990001' },
    { user_id: usuarios[2], club_id: SLUG, role: 'ENTRENADOR', nombre: 'Paula Andrea Rendón', activo: true, celular: '3009990002' },
  ]);
  const limpio = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
  await insertar(sb, 'players', todos.map(limpio));
  await insertar(sb, 'suspensiones', d.suspensiones);
  await insertar(sb, 'mensualidades', d.mensualidades);
  await insertar(sb, 'pagos', d.pagos);
  await insertar(sb, 'club_activity_logs', d.actividad);
  await insertar(sb, 'pedido_uniformes', d.pedidos);
  await insertar(sb, 'pedido_uniforme_prendas', d.prendasPedido);
  await insertar(sb, 'torneos', d.torneos);
  await insertar(sb, 'calendario', d.calendario);
  await insertar(sb, 'asistencia', d.asistencia);
  await insertar(sb, 'finanzas', d.finanzas);
  const { data: emps, error: e2 } = await sb.from('nomina_empleados').insert(d.empleados.map(({ id, _tmpId, ...r }) => r)).select('id, nombre');
  if (e2) throw new Error('nomina_empleados: ' + e2.message);
  console.log(`  ✓ nomina_empleados (${emps.length})`);
  const idPorNombre = Object.fromEntries(emps.map(e => [e.nombre, e.id]));
  await insertar(sb, 'nomina_pagos', d.nominaPagos.map(({ _empleado, ...r }) => ({ ...r, empleado_id: idPorNombre[d.empleados[_empleado].nombre] })));
  await insertar(sb, 'plantillas_mensajes', d.plantillas);
  await insertar(sb, 'wa_log_envios', d.waLog);
  await insertar(sb, 'club_documents', d.documentos);

  console.log(`\nListo. Entrá a https://zensports.zenpra.ai/login con ${OWNER_EMAIL}.`);
}

// --solo-nuevos: agrega a un club demo YA sembrado los 3 inscritos recientes (idempotente:
// salta las cédulas que ya existan), sin borrar ni resembrar nada más.
async function agregarNuevos(sb, club) {
  if (!club) { console.error(`El club ${SLUG} no existe: sembralo primero.`); process.exit(1); }
  const n = nuevosInscritos(club.id);
  const { data: ya } = await sb.from('players').select('cedula').eq('club_id', club.id).in('cedula', n.jugadores.map(j => j.cedula));
  const existentes = new Set((ya || []).map(x => x.cedula));
  const jugadores = n.jugadores.filter(j => !existentes.has(j.cedula));
  console.log(`Nuevos inscritos por agregar: ${jugadores.length} (${existentes.size} ya estaban)`);
  if (!APLICAR || jugadores.length === 0) { if (!APLICAR) console.log('Dry-run: agregá --apply.'); return; }
  const ced = new Set(jugadores.map(j => j.cedula));
  for (const j of jugadores) j.foto_url = await subir(sb, 'player-photos', `${SLUG}/${j.cedula}.png`, await avatar(j), 'image/png');
  const limpio = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
  await insertar(sb, 'players', jugadores.map(limpio));
  await insertar(sb, 'mensualidades', n.mensualidades.filter(m => ced.has(m.cedula)));
  await insertar(sb, 'pagos', n.pagos.filter(p => ced.has(p.cedula)));
}

if (require.main === module) {
  main().catch(err => { console.error('\n✗ ERROR:', err.message); process.exit(1); });
}
