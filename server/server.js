// server.js (project alfanumérico)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { query, getClient } from "./db.js";

dotenv.config();

const app = express();

// CORS abierto en desarrollo
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// saldo = presupuesto - total_gastado + total_reconducido
function computeSaldo({
  presupuesto = 0,
  total_gastado = 0,
  total_reconducido = 0,
}) {
  return (
    Number(presupuesto) - Number(total_gastado) + Number(total_reconducido)
  );
}

// Salud
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ---------- DETALLES (partidas por proyecto) ---------- */
// GET /api/detalles?project=A001...
app.get("/api/detalles", async (req, res) => {
  try {
    const project = String(req.query.project || "").trim();
    if (!project) return res.json([]);
    const r = await query(
      `SELECT id, idProyecto, partida, presupuesto,
              fecha_cuando_se_gasto, en_que_se_gasto, total_gastado,
              fecha_reconduccion, motivo_reconduccion, total_reconducido,
              saldo_disponible
         FROM presupuesto_detalle
        WHERE idProyecto = $1
        ORDER BY partida`,
      [project]
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/detalles", e);
    res.status(500).json({ error: "Error obteniendo detalles" });
  }
});

// POST /api/detalles { project, partida, presupuesto }
app.post("/api/detalles", async (req, res) => {
  try {
    const project = String(req.body.project || "").trim();
    const partida = String(req.body.partida || "").trim();
    const presupuesto = Number(req.body.presupuesto);

    if (!project)
      return res.status(400).json({ error: "project es obligatorio" });
    if (!partida || isNaN(presupuesto))
      return res
        .status(400)
        .json({ error: "partida y presupuesto válidos requeridos" });

    // Verificar si ya existe fila para recuperar totales
    const sel = await query(
      `SELECT total_gastado, total_reconducido
         FROM presupuesto_detalle
        WHERE idProyecto = $1 AND partida = $2`,
      [project, partida]
    );

    let total_gastado = 0,
      total_reconducido = 0;
    if (sel.rows.length) {
      total_gastado = Number(sel.rows[0].total_gastado || 0);
      total_reconducido = Number(sel.rows[0].total_reconducido || 0);
    }

    const saldo = presupuesto - total_gastado + total_reconducido;

    const r = await query(
      `INSERT INTO presupuesto_detalle (idProyecto, partida, presupuesto, saldo_disponible)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (idProyecto, partida)
       DO UPDATE SET presupuesto = EXCLUDED.presupuesto,
                     saldo_disponible = $4
       RETURNING *`,
      [project, partida, presupuesto, saldo]
    );

    res.json(r.rows[0]);
  } catch (e) {
    console.error("POST /api/detalles", e);
    res.status(500).json({ error: "Error guardando detalle" });
  }
});

/* ---------- GASTOS (acumula totales) ---------- */
// POST /api/gastos { project, partida, fecha, descripcion, monto }
app.post("/api/gastos", async (req, res) => {
  try {
    const project = String(req.body.project || "").trim();
    const partida = String(req.body.partida || "").trim();
    const monto = Number(req.body.monto || 0);
    const fecha = req.body.fecha || null;
    const descripcion = req.body.descripcion || null;

    if (!project)
      return res.status(400).json({ error: "project es obligatorio" });
    if (!partida || isNaN(monto) || monto <= 0)
      return res.status(400).json({ error: "partida y monto > 0 requeridos" });

    const client = await getClient();
    try {
      await client.query("BEGIN");

      // asegurar existencia de fila
      await client.query(
        `INSERT INTO presupuesto_detalle (idProyecto, partida, presupuesto, saldo_disponible)
         VALUES ($1,$2,0,0)
         ON CONFLICT (idProyecto, partida) DO NOTHING`,
        [project, partida]
      );

      // acumular gasto
      const upd = await client.query(
        `UPDATE presupuesto_detalle
            SET total_gastado = COALESCE(total_gastado,0) + $1,
                fecha_cuando_se_gasto = COALESCE($2, fecha_cuando_se_gasto),
                en_que_se_gasto = COALESCE($3, en_que_se_gasto)
          WHERE idProyecto = $4 AND partida = $5
          RETURNING presupuesto, total_gastado, total_reconducido`,
        [monto, fecha, descripcion, project, partida]
      );

      const row = upd.rows[0] || {
        presupuesto: 0,
        total_gastado: 0,
        total_reconducido: 0,
      };
      const saldo = computeSaldo(row);

      const updSaldo = await client.query(
        `UPDATE presupuesto_detalle
            SET saldo_disponible = $1
          WHERE idProyecto = $2 AND partida = $3
          RETURNING *`,
        [saldo, project, partida]
      );

      await client.query("COMMIT");
      res.json({ ok: true, detalle: updSaldo.rows[0] });
    } catch (txErr) {
      await client.query("ROLLBACK");
      console.error("POST /api/gastos", txErr);
      res.status(500).json({ error: "Error guardando gasto" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("POST /api/gastos", e);
    res.status(500).json({ error: "Error guardando gasto" });
  }
});

/* ---------- RECONDUCCIÓN ---------- */
// POST /api/reconducir { project, origen, destino, monto, concepto, fecha }
app.post("/api/reconducir", async (req, res) => {
  try {
    const project = String(req.body.project || "").trim();
    const origen = String(req.body.origen || "").trim();
    const destino = String(req.body.destino || "").trim();
    const monto = Number(req.body.monto || 0);
    const concepto = req.body.concepto || null;
    const fecha = req.body.fecha || null;

    if (!project)
      return res.status(400).json({ error: "project es obligatorio" });
    if (!origen || !destino || isNaN(monto) || monto <= 0)
      return res
        .status(400)
        .json({ error: "origen, destino y monto > 0 requeridos" });

    const client = await getClient();
    try {
      await client.query("BEGIN");

      // asegurar filas
      await client.query(
        `INSERT INTO presupuesto_detalle (idProyecto, partida, presupuesto, saldo_disponible)
         VALUES ($1,$2,0,0)
         ON CONFLICT (idProyecto, partida) DO NOTHING`,
        [project, origen]
      );
      await client.query(
        `INSERT INTO presupuesto_detalle (idProyecto, partida, presupuesto, saldo_disponible)
         VALUES ($1,$2,0,0)
         ON CONFLICT (idProyecto, partida) DO NOTHING`,
        [project, destino]
      );

      // origen (-)
      const upOrigen = await client.query(
        `UPDATE presupuesto_detalle
            SET total_reconducido = COALESCE(total_reconducido,0) - $1,
                fecha_reconduccion = COALESCE($2, fecha_reconduccion),
                motivo_reconduccion = COALESCE($3, motivo_reconduccion)
          WHERE idProyecto = $4 AND partida = $5
          RETURNING presupuesto, total_gastado, total_reconducido`,
        [monto, fecha, concepto, project, origen]
      );
      const saldoOrigen = computeSaldo(upOrigen.rows[0]);

      await client.query(
        `UPDATE presupuesto_detalle
            SET saldo_disponible = $1
          WHERE idProyecto = $2 AND partida = $3`,
        [saldoOrigen, project, origen]
      );

      // destino (+)
      const upDestino = await client.query(
        `UPDATE presupuesto_detalle
            SET total_reconducido = COALESCE(total_reconducido,0) + $1,
                fecha_reconduccion = COALESCE($2, fecha_reconduccion),
                motivo_reconduccion = COALESCE($3, motivo_reconduccion)
          WHERE idProyecto = $4 AND partida = $5
          RETURNING presupuesto, total_gastado, total_reconducido`,
        [monto, fecha, concepto, project, destino]
      );
      const saldoDestino = computeSaldo(upDestino.rows[0]);

      await client.query(
        `UPDATE presupuesto_detalle
            SET saldo_disponible = $1
          WHERE idProyecto = $2 AND partida = $3`,
        [saldoDestino, project, destino]
      );

      await client.query("COMMIT");
      res.json({
        ok: true,
        origenNegativo: saldoOrigen < 0,
        saldos: { origen: saldoOrigen, destino: saldoDestino },
      });
    } catch (txErr) {
      await client.query("ROLLBACK");
      console.error("POST /api/reconducir", txErr);
      res.status(500).json({ error: "Error en reconducción" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("POST /api/reconducir", e);
    res.status(500).json({ error: "Error en reconducción" });
  }
});

/* ---------- Borrar todo un proyecto ---------- */
// DELETE /api/project?project=A001...
app.delete("/api/project", async (req, res) => {
  try {
    const project = String(req.query.project || "").trim();
    if (!project)
      return res.status(400).json({ error: "project es obligatorio" });
    const r = await query(
      "DELETE FROM presupuesto_detalle WHERE idProyecto = $1",
      [project]
    );
    res.json({ ok: true, deleted_rows: r.rowCount });
  } catch (e) {
    console.error("DELETE /api/project", e);
    res.status(500).json({ error: "No se pudo borrar el proyecto" });
  }
});

/* ======================== Arranque ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("API escuchando en http://localhost:" + PORT);
});
