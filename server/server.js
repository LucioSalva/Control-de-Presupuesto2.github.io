import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query, getClient } from './db.js';

dotenv.config();
const app = express();

// CORS: en dev puedes dejarlo abierto. En prod restringe "origin".
app.use(cors());
app.use(express.json());

/* ---------- Endpoints ---------- */

// Salud
app.get('/api/health', (_, res) => res.json({ ok: true }));

// Partidas
app.get('/api/partidas', async (_, res) => {
  const { rows } = await query('SELECT clave, presupuesto FROM partidas ORDER BY clave');
  res.json(rows);
});

app.post('/api/partidas', async (req, res) => {
  const { clave, presupuesto } = req.body;
  if (!clave || isNaN(presupuesto)) return res.status(400).json({ error: 'Datos inválidos' });
  await query(`
    INSERT INTO partidas (clave, presupuesto)
    VALUES ($1, $2)
    ON CONFLICT (clave) DO UPDATE SET presupuesto = EXCLUDED.presupuesto
  `, [clave, presupuesto]);
  res.json({ ok: true });
});

// Gastos
app.get('/api/gastos', async (_, res) => {
  const { rows } = await query('SELECT id, fecha, descripcion, partida_clave, monto FROM gastos ORDER BY COALESCE(fecha, CURRENT_DATE), id');
  res.json(rows);
});

app.post('/api/gastos', async (req, res) => {
  const { fecha, descripcion, partida, monto } = req.body;
  if (!descripcion || isNaN(monto)) return res.status(400).json({ error: 'Datos inválidos' });
  await query(
    'INSERT INTO gastos (fecha, descripcion, partida_clave, monto) VALUES ($1, $2, $3, $4)',
    [fecha || null, descripcion, (partida || '') || null, monto]
  );
  res.json({ ok: true });
});

// Reconducción (transacción)
app.post('/api/reconducir', async (req, res) => {
  const { concepto, origen, destino, monto } = req.body;
  if (!origen || !destino || !monto || isNaN(monto) || monto <= 0) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Asegurar que existan origen/destino
    await client.query('INSERT INTO partidas (clave, presupuesto) VALUES ($1, 0) ON CONFLICT (clave) DO NOTHING', [origen]);
    await client.query('INSERT INTO partidas (clave, presupuesto) VALUES ($1, 0) ON CONFLICT (clave) DO NOTHING', [destino]);

    // Restar del origen y sumar al destino
    await client.query('UPDATE partidas SET presupuesto = presupuesto - $1 WHERE clave = $2', [monto, origen]);
    await client.query('UPDATE partidas SET presupuesto = presupuesto + $1 WHERE clave = $2', [monto, destino]);

    // Guardar histórico
    await client.query(
      'INSERT INTO reconducciones (concepto, origen, destino, monto) VALUES ($1, $2, $3, $4)',
      [concepto || null, origen, destino, monto]
    );

    // Consultar presupuesto del origen para avisar si quedó negativo
    const neg = await client.query('SELECT presupuesto FROM partidas WHERE clave = $1', [origen]);

    await client.query('COMMIT');

    const presupuestoOrigen = neg.rows?.[0]?.presupuesto ?? 0;
    res.json({ ok: true, negativo: presupuestoOrigen < 0, presupuestoOrigen });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Error en reconducción' });
  } finally {
    client.release();
  }
});

// Histórico reconducciones
app.get('/api/reconducciones', async (_, res) => {
  const { rows } = await query('SELECT id, concepto, origen, destino, monto, created_at FROM reconducciones ORDER BY created_at DESC, id DESC');
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API escuchando en http://localhost:' + PORT));
