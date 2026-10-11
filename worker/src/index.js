// P.07 Listado de moldes — API (Cloudflare Worker + Neon)
// Roles: "planta" (cambiadores: ver, mover, estado) y "admin" (Diego: altas y edición de datos maestros).
// Toda escritura exige un nombre y deja el sello nombre + IP + fecha en el molde.

import { neon } from '@neondatabase/serverless';

const ESTADOS = [
  'EN MAQUINA', 'CAMBIO', 'ETIQUETADOS', 'FALTA ETIQUETAR',
  'MOLDE SIN INGRESAR', 'SALIDA', 'NUEVO', 'EN REPARACION ESTANTERIA ROJA',
];
const TIPOS = ['ESTANTE', 'PALLET', 'DEPOSITO', 'SIN_ASIGNAR', 'OTRO'];
const DEFAULT_ORIGINS = ['https://diegortizdao-collab.github.io'];

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

// Un binding de Secrets Store expone .get(); un secret/var común es un string.
async function secret(binding) {
  if (binding == null) return null;
  if (typeof binding === 'string') return binding;
  if (typeof binding.get === 'function') return await binding.get();
  return null;
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function roleOf(req, env) {
  const given = req.headers.get('X-Clave');
  if (!given) return null;
  const [admin, planta] = await Promise.all([secret(env.ADMIN_KEY), secret(env.PLANTA_KEY)]);
  if (admin && await safeEqual(given, admin)) return 'admin';
  if (planta && await safeEqual(given, planta)) return 'planta';
  return null;
}

function corsHeaders(req, env) {
  const allowed = (env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(',').map(s => s.trim()) : DEFAULT_ORIGINS);
  const origin = req.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Clave',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(req, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req, env) },
  });
}

// ---------- validaciones ----------
function cleanNombre(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!/^[\p{L}\p{N} .'\-]{2,60}$/u.test(s)) throw new HttpError(400, 'Falta tu nombre (2 a 60 letras).');
  return s;
}
function cleanText(v, max, { required = false, label = 'campo' } = {}) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').replace(/\r/g, '').replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim();
  if (!s) { if (required) throw new HttpError(400, `${label} no puede quedar vacío.`); return null; }
  if (s.length > max) throw new HttpError(400, `${label} es demasiado largo (máx. ${max}).`);
  return s;
}
function cleanEstado(v) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return null;
  if (!ESTADOS.includes(s)) throw new HttpError(400, `Estado inválido: ${s}`);
  return s;
}
function cleanPersonal(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 9) throw new HttpError(400, 'Personal para mover debe ser un número de 1 a 9.');
  return n;
}
async function readBody(req) {
  try { const b = await req.json(); if (b && typeof b === 'object') return b; } catch (_) { /* cae al error */ }
  throw new HttpError(400, 'Cuerpo JSON inválido.');
}
function ordenDe(codigo, tipo, cantidadOtros) {
  let m;
  if (/^\d+$/.test(codigo)) return Number(codigo) * 10;
  if ((m = codigo.match(/^(\d+) BIS$/i))) return Number(m[1]) * 10 + 5;
  if ((m = codigo.match(/^P(\d+)$/i))) return 10000 + Number(m[1]);
  return 20010 + cantidadOtros;
}

// ---------- acceso a datos ----------
const COLS = (admin) => `m.id, m.n_control, m.especificacion, m.cliente, m.posicion, m.personal_para_mover, m.estado,
  m.actualizado_por, m.actualizado_en${admin ? ', m.actualizado_ip' : ''}`;

async function resolverPosicion(sql, texto) {
  const code = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!code) throw new HttpError(400, 'Falta la posición.');
  const r = await sql.query('select codigo, tipo from posiciones where upper(codigo) = upper($1) and activa', [code]);
  if (!r.length) throw new HttpError(400, `La posición "${code}" no existe. Revisá el código (ej. 214, P6, S/A).`);
  return r[0];
}

async function getMolde(sql, id, admin = false) {
  const r = await sql.query(`select ${COLS(admin)} from moldes m where m.id = $1`, [id]);
  if (!r.length) throw new HttpError(404, 'Molde no encontrado.');
  return r[0];
}

function parseId(s) {
  const id = Number(s);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Id inválido.');
  return id;
}

async function handle(req, env, url, ctx) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') return json(req, env, { ok: true });

  const role = await roleOf(req, env);
  if (!role) {
    await new Promise(r => setTimeout(r, 600)); // frena la prueba de claves por fuerza bruta
    throw new HttpError(401, 'Clave incorrecta.');
  }
  const admin = role === 'admin';
  const ip = req.headers.get('CF-Connecting-IP') || null;

  if (pathname === '/api/login' && method === 'POST') return json(req, env, { ok: true, rol: role });

  const dbUrl = await secret(env.DATABASE_URL);
  if (!dbUrl) throw new HttpError(500, 'Servidor sin base de datos configurada.');
  const sql = neon(dbUrl);

  // ---- listado completo (la base es chica: ~400 moldes) ----
  if (pathname === '/api/p07' && method === 'GET') {
    const [moldes, posiciones, ult] = await Promise.all([
      sql.query(`select ${COLS(admin)} from moldes m order by m.id`),
      sql.query('select codigo, tipo, orden, activa from posiciones order by orden, codigo'),
      sql.query('select max(actualizado_en) as ultima from moldes'),
    ]);
    return json(req, env, { rol: role, estados: ESTADOS, ultima_actualizacion: ult[0]?.ultima ?? null, posiciones, moldes });
  }

  // ---- mover molde ----
  let m = pathname.match(/^\/api\/moldes\/(\d+)\/mover$/);
  if (m && method === 'POST') {
    const id = parseId(m[1]);
    const b = await readBody(req);
    const nombre = cleanNombre(b.nombre);
    const estado = cleanEstado(b.estado);
    const pos = await resolverPosicion(sql, b.posicion);
    const actual = await getMolde(sql, id);

    const mismaPos = actual.posicion === pos.codigo;
    const mismoEstado = estado === undefined || estado === actual.estado;
    if (mismaPos && mismoEstado) return json(req, env, { sin_cambios: true, molde: actual });

    if (pos.tipo === 'ESTANTE' && !mismaPos && b.confirmar !== true) {
      const ocupantes = await sql.query(
        'select id, especificacion, cliente, n_control from moldes where posicion = $1 and id <> $2', [pos.codigo, id]);
      if (ocupantes.length) throw new HttpError(409, `La posición ${pos.codigo} ya tiene un molde.`, { ocupado_por: ocupantes });
    }

    const r = await sql.query(
      `update moldes set posicion = $1,
         estado = case when $2::boolean then $3 else estado end,
         actualizado_por = $4, actualizado_ip = $5, actualizado_en = now()
       where id = $6
       returning id, n_control, especificacion, cliente, posicion, personal_para_mover, estado, actualizado_por, actualizado_en`,
      [pos.codigo, estado !== undefined, estado ?? null, nombre, ip, id]);
    return json(req, env, { molde: r[0] });
  }

  // ---- editar molde ----
  m = pathname.match(/^\/api\/moldes\/(\d+)$/);
  if (m && method === 'PATCH') {
    const id = parseId(m[1]);
    const b = await readBody(req);
    const nombre = cleanNombre(b.nombre);
    const campos = {
      estado: cleanEstado(b.estado),
      personal_para_mover: cleanPersonal(b.personal_para_mover),
      especificacion: cleanText(b.especificacion, 300, { required: true, label: 'La especificación' }),
      cliente: cleanText(b.cliente, 120),
      n_control: cleanText(b.n_control, 40),
    };
    const soloAdmin = ['especificacion', 'cliente', 'n_control'];
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(campos)) {
      if (v === undefined) continue;
      if (soloAdmin.includes(k) && !admin) throw new HttpError(403, 'Ese dato solo lo edita el administrador.');
      vals.push(v); sets.push(`${k} = $${vals.length}`);
    }
    if (!sets.length) throw new HttpError(400, 'No hay nada para actualizar.');
    await getMolde(sql, id);
    vals.push(nombre, ip, id);
    const r = await sql.query(
      `update moldes set ${sets.join(', ')}, actualizado_por = $${vals.length - 2}, actualizado_ip = $${vals.length - 1}, actualizado_en = now()
       where id = $${vals.length}
       returning id, n_control, especificacion, cliente, posicion, personal_para_mover, estado, actualizado_por, actualizado_en`, vals);
    return json(req, env, { molde: r[0] });
  }

  // ---- alta de molde (admin) ----
  if (pathname === '/api/moldes' && method === 'POST') {
    if (!admin) throw new HttpError(403, 'Solo el administrador da de alta moldes.');
    const b = await readBody(req);
    const nombre = cleanNombre(b.nombre);
    const especificacion = cleanText(b.especificacion, 300, { required: true, label: 'La especificación' });
    const cliente = cleanText(b.cliente, 120) ?? null;
    const n_control = cleanText(b.n_control, 40) ?? null;
    const pos = await resolverPosicion(sql, b.posicion ?? 'S/A');
    const personal = cleanPersonal(b.personal_para_mover) ?? null;
    const estado = cleanEstado(b.estado) ?? null;
    const r = await sql.query(
      `insert into moldes (n_control, especificacion, cliente, posicion, personal_para_mover, estado, actualizado_por, actualizado_ip)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id, n_control, especificacion, cliente, posicion, personal_para_mover, estado, actualizado_por, actualizado_en`,
      [n_control, especificacion, cliente, pos.codigo, personal, estado, nombre, ip]);
    return json(req, env, { molde: r[0] }, 201);
  }

  // ---- alta de posición (admin) ----
  if (pathname === '/api/posiciones' && method === 'POST') {
    if (!admin) throw new HttpError(403, 'Solo el administrador da de alta posiciones.');
    const b = await readBody(req);
    cleanNombre(b.nombre);
    const codigo = String(b.codigo ?? '').replace(/\s+/g, ' ').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 ./-]{0,19}$/.test(codigo)) throw new HttpError(400, 'Código de posición inválido.');
    const tipo = String(b.tipo ?? '').toUpperCase();
    if (!TIPOS.includes(tipo)) throw new HttpError(400, `Tipo inválido. Opciones: ${TIPOS.join(', ')}`);
    const dup = await sql.query('select 1 from posiciones where upper(codigo) = upper($1)', [codigo]);
    if (dup.length) throw new HttpError(409, `La posición ${codigo} ya existe.`);
    const otros = await sql.query("select count(*)::int as n from posiciones where orden >= 20010");
    const r = await sql.query('insert into posiciones (codigo, tipo, orden) values ($1,$2,$3) returning codigo, tipo, orden, activa',
      [codigo, tipo, ordenDe(codigo, tipo, otros[0].n)]);
    return json(req, env, { posicion: r[0] }, 201);
  }

  throw new HttpError(404, 'Ruta inexistente.');
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    try {
      return await handle(req, env, url, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json(req, env, { error: e.message, ...e.extra }, e.status);
      console.error('P07 error:', e && e.stack || e);
      return json(req, env, { error: 'Error interno. Reintentá en unos segundos.' }, 500);
    }
  },
};
