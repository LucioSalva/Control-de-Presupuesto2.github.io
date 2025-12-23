// =====================================================
//  IMPORTS Y CONFIG
// =====================================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { query, getClient } from "./db.js";

dotenv.config();

const app = express();

// Para poder armar rutas absolutas (static, 404.html, etc.)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS abierto en desarrollo
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// =====================================================
//  STATIC (FRONTEND)
// =====================================================

// Sirve HTML/archivos desde: server/public
app.use(express.static(path.join(__dirname, "public")));

// Sirve CSS global desde: /css (carpeta fuera de server)
app.use("/css", express.static(path.join(__dirname, "..", "css")));

// (Opcional) si tienes JS global en /js fuera de server
app.use("/js", express.static(path.join(__dirname, "..", "js")));

// =====================================================
//  HELPERS
// =====================================================

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

function buildHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * ✅ Auditoría: quién ejecuta la acción (viene del front en header)
 * En el frontend manda: headers: { "x-user-id": <id del usuario logueado> }
 */
function getActorId(req) {
  const actorId = Number(req.headers["x-user-id"] || 0);
  return Number.isFinite(actorId) && actorId > 0 ? actorId : null;
}

/**
 * Valida que vengan id_dgeneral, id_dauxiliar, id_fuente
 * y el id_proyecto alfanumérico desde el front.
 */
async function getProjectKeys({
  id_proyecto,
  id_dgeneral,
  id_dauxiliar,
  id_fuente,
}) {
  const projectCode = String(id_proyecto || "").trim();

  // NOTA: id_proyecto es string, los demás son enteros
  const dg = Number(id_dgeneral);
  const da = Number(id_dauxiliar);
  const fu = Number(id_fuente);

  if (
    !projectCode ||
    !Number.isInteger(dg) ||
    dg <= 0 ||
    !Number.isInteger(da) ||
    da <= 0 ||
    !Number.isInteger(fu) ||
    fu <= 0
  ) {
    throw buildHttpError(
      "id_dgeneral, id_dauxiliar, id_fuente e id_proyecto son obligatorios y deben ser enteros > 0",
      400
    );
  }

  return {
    id_proyecto: projectCode,
    id_dgeneral: dg,
    id_dauxiliar: da,
    id_fuente: fu,
  };
}

// ---------- Salud ----------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* =====================================================
   LOGIN (simple, sin JWT por ahora)
   ===================================================== */
app.post("/api/login", async (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res
      .status(400)
      .json({ error: "Usuario y contraseña son requeridos" });
  }

  try {
    const sql = `
      SELECT u.id,
             u.nombre_completo,
             u.usuario,
             u.correo,
             u.password,
             u.id_dgeneral,
             u.id_dauxiliar,
             u.activo,
             d.clave AS dgeneral_clave,
             d.dependencia AS dgeneral_nombre,
             ARRAY(
               SELECT r.clave
               FROM usuario_rol ur
               JOIN roles r ON r.id = ur.id_rol
               WHERE ur.id_usuario = u.id
             ) AS roles
      FROM usuarios u
      LEFT JOIN dgeneral d ON d.id = u.id_dgeneral
      LEFT JOIN dauxiliar da ON da.id = u.id_dauxiliar
      WHERE u.usuario = $1
      LIMIT 1;
    `;

    const result = await query(sql, [usuario]);

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const user = result.rows[0];

    if (!user.activo) {
      return res.status(403).json({ error: "Usuario inactivo" });
    }

    // ⚠ SIN bcrypt, comparación directa
    if (user.password !== password) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const token = `token-${user.id}-${Date.now()}`;

    return res.json({
      token,
      usuario: {
        id: user.id,
        nombre_completo: user.nombre_completo,
        usuario: user.usuario,
        correo: user.correo,
        roles: user.roles,
        id_dgeneral: user.id_dgeneral,
        id_dauxiliar: user.id_dauxiliar,
        dgeneral_clave: user.dgeneral_clave,
        dgeneral_nombre: user.dgeneral_nombre,
      },
    });
  } catch (err) {
    console.error("Error en /api/login:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});

/* =====================================================
   SUFICIENCIA PRESUPUESTAL - FOLIO
   ===================================================== */
app.get("/api/suficiencias/next-folio", async (_req, res) => {
  try {
    const r = await query(`
      SELECT COALESCE(MAX(folio_num), 0) + 1 AS folio_num
      FROM suficiencias
    `);
    res.json({ folio_num: Number(r.rows[0].folio_num) });
  } catch (e) {
    console.error("GET /api/suficiencias/next-folio", e);
    res.status(500).json({ error: "Error obteniendo folio" });
  }
});

/* =====================================================
   DETALLES (partidas por proyecto)
   ===================================================== */

// GET /api/detalles?project=A001...
app.get("/api/detalles", async (req, res) => {
  try {
    const project = String(req.query.project || "").trim();
    if (!project) return res.json([]);

    const r = await query(
      `SELECT id,
              id_proyecto AS "idProyecto",
              partida,
              presupuesto,
              fecha_cuando_se_gasto,
              en_que_se_gasto,
              total_gastado,
              fecha_reconduccion,
              motivo_reconduccion,
              total_reconducido,
              saldo_disponible,
              fecha_registro
         FROM presupuesto_detalle
        WHERE id_proyecto = $1
        ORDER BY partida`,
      [project]
    );

    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/detalles error:", e);
    res.status(500).json({ error: "Error obteniendo detalles" });
  }
});

// POST /api/detalles
app.post("/api/detalles", async (req, res) => {
  try {
    const {
      project,
      partida,
      presupuesto,
      mes, // no se guarda
      id_dgeneral,
      id_dauxiliar,
      id_fuente,
    } = req.body;

    if (!project || !partida || !Number.isFinite(Number(presupuesto))) {
      return res
        .status(400)
        .json({ error: "project, partida y presupuesto son obligatorios" });
    }

    const keys = await getProjectKeys({
      id_proyecto: project,
      id_dgeneral,
      id_dauxiliar,
      id_fuente,
    });

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const sql = `
        INSERT INTO presupuesto_detalle (
          fecha_registro,
          id_dgeneral,
          id_dauxiliar,
          id_fuente,
          id_proyecto,
          partida,
          presupuesto,
          total_gastado,
          total_reconducido,
          saldo_disponible
        )
        VALUES (
          NOW(),
          $1,$2,$3,$4,$5,$6,
          0,0,
          $6
        )
        ON CONFLICT (
          id_dgeneral,
          id_dauxiliar,
          id_fuente,
          id_proyecto,
          partida
        )
        DO UPDATE SET
          presupuesto      = presupuesto_detalle.presupuesto + EXCLUDED.presupuesto,
          saldo_disponible = presupuesto_detalle.saldo_disponible + EXCLUDED.presupuesto
        RETURNING *;
      `;

      const params = [
        keys.id_dgeneral,
        keys.id_dauxiliar,
        keys.id_fuente,
        keys.id_proyecto,
        partida,
        Number(presupuesto),
      ];

      const { rows } = await client.query(sql, params);
      await client.query("COMMIT");
      return res.json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("POST /api/detalles error:", err);
      return res.status(500).json({ error: "Error guardando detalle" });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("POST /api/detalles error (outer):", err);
    return res
      .status(err.statusCode || 500)
      .json({ error: err.message || "Error guardando detalle" });
  }
});

/* =====================================================
   GASTOS
   ===================================================== */

app.get("/api/gastos", async (req, res) => {
  try {
    const project = String(req.query.project || "").trim();
    if (!project) return res.json([]);

    const r = await query(
      `SELECT id,
              id_proyecto AS "idProyecto",
              partida,
              fecha,
              descripcion,
              monto
         FROM public.gastos_detalle
        WHERE id_proyecto = $1
        ORDER BY fecha DESC, id DESC`,
      [project]
    );

    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/gastos", e);
    res.status(500).json({ error: "Error obteniendo gastos" });
  }
});

app.post("/api/gastos", async (req, res) => {
  try {
    const project = String(req.body.project || "").trim();
    const partida = String(req.body.partida || "").trim();
    const monto = Number(req.body.monto || 0);
    const fecha = req.body.fecha || null;
    const descripcion = req.body.descripcion || null;

    if (!project)
      return res.status(400).json({ error: "project es obligatorio" });
    if (!partida || isNaN(monto) || monto <= 0) {
      return res.status(400).json({ error: "partida y monto > 0 requeridos" });
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const detResult = await client.query(
        `
        SELECT id_dgeneral,
               id_dauxiliar,
               id_fuente,
               presupuesto,
               total_gastado,
               total_reconducido
          FROM presupuesto_detalle
         WHERE id_proyecto = $1
           AND partida      = $2
         FOR UPDATE
        `,
        [project, partida]
      );

      if (!detResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error:
            "No existe presupuesto para la partida seleccionada en este proyecto.",
        });
      }

      let {
        id_dgeneral,
        id_dauxiliar,
        id_fuente,
        presupuesto,
        total_reconducido,
      } = detResult.rows[0];

      if (id_dgeneral == null || id_dauxiliar == null || id_fuente == null) {
        const keysFallback = await client.query(
          `
          SELECT id_dgeneral, id_dauxiliar, id_fuente
            FROM presupuesto_detalle
           WHERE id_proyecto = $1
             AND id_dgeneral IS NOT NULL
             AND id_dauxiliar IS NOT NULL
             AND id_fuente IS NOT NULL
           ORDER BY id
           LIMIT 1
          `,
          [project]
        );

        if (!keysFallback.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error:
              "No se encontraron llaves de catálogo (id_dgeneral, id_dauxiliar, id_fuente) para este proyecto. " +
              "Elimina el proyecto y vuélvelo a crear desde la pantalla 'Crear proyecto'.",
          });
        }

        id_dgeneral = keysFallback.rows[0].id_dgeneral;
        id_dauxiliar = keysFallback.rows[0].id_dauxiliar;
        id_fuente = keysFallback.rows[0].id_fuente;
      }

      await client.query(
        `
        INSERT INTO public.gastos_detalle (
          id_dgeneral,
          id_dauxiliar,
          id_fuente,
          id_proyecto,
          partida,
          fecha,
          descripcion,
          monto
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          id_dgeneral,
          id_dauxiliar,
          id_fuente,
          project,
          partida,
          fecha,
          descripcion,
          monto,
        ]
      );

      const tot = await client.query(
        `
        SELECT COALESCE(SUM(monto),0) AS total_gastado
          FROM public.gastos_detalle
         WHERE id_proyecto = $1
           AND partida      = $2
        `,
        [project, partida]
      );
      const total_gastado = Number(tot.rows[0].total_gastado || 0);

      const saldo = computeSaldo({
        presupuesto,
        total_gastado,
        total_reconducido,
      });

      const upd = await client.query(
        `
        UPDATE presupuesto_detalle
           SET total_gastado    = $1,
               saldo_disponible = $2
         WHERE id_proyecto = $3
           AND partida      = $4
         RETURNING *
        `,
        [total_gastado, saldo, project, partida]
      );

      await client.query("COMMIT");
      return res.json({ ok: true, detalle: upd.rows[0] });
    } catch (txErr) {
      await client.query("ROLLBACK");
      console.error("POST /api/gastos (tx) error:", txErr);
      return res.status(500).json({ error: "Error guardando gasto" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("POST /api/gastos error:", e);
    res.status(500).json({ error: "Error guardando gasto" });
  }
});

app.delete("/api/gastos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "id inválido" });

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const old = await client.query(
        `SELECT id_proyecto AS "idProyecto", partida
           FROM public.gastos_detalle
          WHERE id = $1`,
        [id]
      );

      if (!old.rows.length) {
        await client.query("ROLLBACK");
        return res.json({ ok: true, deleted: false });
      }

      const { idProyecto, partida } = old.rows[0];

      await client.query(`DELETE FROM public.gastos_detalle WHERE id = $1`, [
        id,
      ]);

      const tot = await client.query(
        `SELECT COALESCE(SUM(monto),0) AS total_gastado
           FROM public.gastos_detalle
          WHERE id_proyecto = $1 AND partida = $2`,
        [idProyecto, partida]
      );
      const total_gastado = Number(tot.rows[0].total_gastado || 0);

      const det = await client.query(
        `SELECT presupuesto, total_reconducido
           FROM presupuesto_detalle
          WHERE id_proyecto = $1 AND partida = $2`,
        [idProyecto, partida]
      );

      if (!det.rows.length) {
        await client.query("COMMIT");
        return res.json({ ok: true, deleted: true, detalle: null });
      }

      const row = det.rows[0];
      const saldo = computeSaldo({
        presupuesto: row.presupuesto,
        total_gastado,
        total_reconducido: row.total_reconducido,
      });

      const upd = await client.query(
        `UPDATE presupuesto_detalle
            SET total_gastado    = $1,
                saldo_disponible = $2
          WHERE id_proyecto = $3 AND partida = $4
          RETURNING *`,
        [total_gastado, saldo, idProyecto, partida]
      );

      await client.query("COMMIT");
      res.json({ ok: true, deleted: true, detalle: upd.rows[0] });
    } catch (txErr) {
      await client.query("ROLLBACK");
      console.error("DELETE /api/gastos/:id (tx)", txErr);
      res.status(500).json({ error: "Error eliminando gasto" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("DELETE /api/gastos/:id (outer)", e);
    res.status(500).json({ error: "Error eliminando gasto" });
  }
});

/* =====================================================
   RECONDUCCIÓN
   ===================================================== */

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
    if (!origen || !destino || isNaN(monto) || monto <= 0) {
      return res
        .status(400)
        .json({ error: "origen, destino y monto > 0 requeridos" });
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");

      const qOrigen = await client.query(
        `SELECT id_dgeneral,
                id_dauxiliar,
                id_fuente,
                presupuesto,
                total_gastado,
                total_reconducido
           FROM presupuesto_detalle
          WHERE id_proyecto = $1
            AND partida      = $2
          FOR UPDATE`,
        [project, origen]
      );

      if (!qOrigen.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error:
            "No existe presupuesto para la partida origen en este proyecto.",
        });
      }

      const origenRow = qOrigen.rows[0];

      let qDestino = await client.query(
        `SELECT id_dgeneral,
                id_dauxiliar,
                id_fuente,
                presupuesto,
                total_gastado,
                total_reconducido
           FROM presupuesto_detalle
          WHERE id_proyecto = $1
            AND partida      = $2
          FOR UPDATE`,
        [project, destino]
      );

      if (!qDestino.rows.length) {
        await client.query(
          `INSERT INTO presupuesto_detalle (
             fecha_registro,
             id_dgeneral,
             id_dauxiliar,
             id_fuente,
             id_proyecto,
             partida,
             presupuesto,
             total_gastado,
             total_reconducido,
             saldo_disponible
           )
           VALUES (NOW(), $1,$2,$3, $4, $5, 0,0,0,0)`,
          [
            origenRow.id_dgeneral,
            origenRow.id_dauxiliar,
            origenRow.id_fuente,
            project,
            destino,
          ]
        );

        qDestino = await client.query(
          `SELECT id_dgeneral,
                  id_dauxiliar,
                  id_fuente,
                  presupuesto,
                  total_gastado,
                  total_reconducido
             FROM presupuesto_detalle
            WHERE id_proyecto = $1
              AND partida      = $2
            FOR UPDATE`,
          [project, destino]
        );
      }

      const destinoRow = qDestino.rows[0];

      const nuevoReconOrigen = Number(origenRow.total_reconducido || 0) - monto;

      const saldoOrigen = computeSaldo({
        presupuesto: origenRow.presupuesto,
        total_gastado: origenRow.total_gastado,
        total_reconducido: nuevoReconOrigen,
      });

      await client.query(
        `UPDATE presupuesto_detalle
            SET total_reconducido  = $1,
                fecha_reconduccion = COALESCE($2, fecha_reconduccion),
                motivo_reconduccion= COALESCE($3, motivo_reconduccion),
                saldo_disponible   = $4
          WHERE id_proyecto = $5
            AND partida      = $6`,
        [nuevoReconOrigen, fecha, concepto, saldoOrigen, project, origen]
      );

      const nuevoReconDestino =
        Number(destinoRow.total_reconducido || 0) + monto;

      const saldoDestino = computeSaldo({
        presupuesto: destinoRow.presupuesto,
        total_gastado: destinoRow.total_gastado,
        total_reconducido: nuevoReconDestino,
      });

      await client.query(
        `UPDATE presupuesto_detalle
            SET total_reconducido  = $1,
                fecha_reconduccion = COALESCE($2, fecha_reconduccion),
                motivo_reconduccion= COALESCE($3, motivo_reconduccion),
                saldo_disponible   = $4
          WHERE id_proyecto = $5
            AND partida      = $6`,
        [nuevoReconDestino, fecha, concepto, saldoDestino, project, destino]
      );

      await client.query("COMMIT");
      return res.json({
        ok: true,
        origenNegativo: saldoOrigen < 0,
        saldos: { origen: saldoOrigen, destino: saldoDestino },
      });
    } catch (txErr) {
      await client.query("ROLLBACK");
      console.error("POST /api/reconducir", txErr);
      return res.status(500).json({ error: "Error en reconducción" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("POST /api/reconducir", e);
    res.status(500).json({ error: "Error en reconducción" });
  }
});

/* =====================================================
   Borrar todo un proyecto
   ===================================================== */
app.delete("/api/project", async (req, res) => {
  try {
    const project = String(req.query.project || "").trim();
    if (!project)
      return res.status(400).json({ error: "project es obligatorio" });

    const r = await query(
      "DELETE FROM presupuesto_detalle WHERE id_proyecto = $1",
      [project]
    );
    res.json({ ok: true, deleted_rows: r.rowCount });
  } catch (e) {
    console.error("DELETE /api/project", e);
    res.status(500).json({ error: "No se pudo borrar el proyecto" });
  }
});

/* =====================================================
   PROYECTOS (LISTADO)
   ===================================================== */
app.get("/api/projects", async (_req, res) => {
  try {
    const r = await query(`
      SELECT
        id_proyecto                       AS project,
        MIN(id_dgeneral)                  AS id_dgeneral,
        COUNT(*)                          AS partidas,
        COALESCE(SUM(presupuesto),0)      AS presupuesto_total,
        COALESCE(SUM(total_gastado),0)    AS gastado_total,
        COALESCE(SUM(saldo_disponible),0) AS saldo_total
      FROM presupuesto_detalle
      GROUP BY id_proyecto
      ORDER BY id_proyecto
    `);
    res.json(r.rows);
  } catch (err) {
    console.error("GET /api/projects", err);
    res.status(500).json({ error: "Error obteniendo proyectos" });
  }
});

/* =====================================================
   Checadores de duplicados
   ===================================================== */
app.get("/api/check-duplicates", async (req, res) => {
  try {
    const { project, partida } = req.query;
    const result = await query(
      `SELECT partida, presupuesto, fecha_registro
         FROM public.presupuesto_detalle
        WHERE id_proyecto = $1 AND partida = $2
        ORDER BY fecha_registro DESC`,
      [project, partida]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/check-duplicates", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/check-recon-duplicates", async (req, res) => {
  try {
    const { project, origen, destino, monto } = req.query;
    const result = await query(
      `SELECT origen, destino, monto, fecha_reconduccion
         FROM public.reconducciones
        WHERE id_proyecto = $1 AND origen = $2 AND destino = $3 AND monto = $4
        ORDER BY fecha_reconduccion DESC`,
      [project, origen, destino, monto]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/check-recon-duplicates", error);
    res.status(500).json({ error: error.message });
  }
});

/* =====================================================
   Catálogos
   ===================================================== */
app.get("/api/catalogos/dgeneral", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, dependencia FROM dgeneral ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/dgeneral", e);
    res.status(500).json({ error: "Error obteniendo catálogo dgeneral" });
  }
});

app.get("/api/catalogos/dauxiliar", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, dependencia FROM dauxiliar ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/dauxiliar", e);
    res.status(500).json({ error: "Error obteniendo catálogo dauxiliar" });
  }
});

app.get("/api/catalogos/fuentes", async (_req, res) => {
  try {
    const r = await query(`SELECT id, clave, fuente FROM fuentes ORDER BY clave`);
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/fuentes", e);
    res.status(500).json({ error: "Error obteniendo catálogo fuentes" });
  }
});

app.get("/api/catalogos/programas", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, descripcion FROM programas ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/programas", e);
    res.status(500).json({ error: "Error obteniendo catálogo programas" });
  }
});

app.get("/api/catalogos/proyectos", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, descripcion FROM proyectos ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/proyectos", e);
    res.status(500).json({ error: "Error obteniendo catálogo proyectos" });
  }
});

app.get("/api/catalogos/partidas", async (_req, res) => {
  try {
    const r = await query(`
      SELECT id, clave, descripcion
      FROM partidas
      ORDER BY clave
    `);
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/partidas", e);
    res.status(500).json({ error: "Error obteniendo catálogo partidas" });
  }
});

/* =====================================================
   SUFICIENCIA PRESUPUESTAL
   ===================================================== */
app.post("/api/suficiencias", async (req, res) => {
  const {
    fecha,
    dependencia,
    departamento,
    programa,
    proyecto,
    fuente,
    partida,
    mes_pago,
    justificacion_general,
    cantidad_con_letra,
    total,
    detalle = [],
  } = req.body || {};

  const totalNum = Number(total || 0);

  if (!fecha) return res.status(400).json({ error: "fecha es obligatoria" });
  if (!Array.isArray(detalle))
    return res.status(400).json({ error: "detalle debe ser arreglo" });

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE suficiencias IN EXCLUSIVE MODE");

    const folioQ = await client.query(`
      SELECT COALESCE(MAX(folio_num), 0) + 1 AS folio_num
      FROM suficiencias
    `);
    const folio_num = Number(folioQ.rows[0].folio_num);

    const insCab = await client.query(
      `
      INSERT INTO suficiencias (
        folio_num,
        fecha,
        dependencia,
        departamento,
        programa,
        proyecto,
        fuente,
        partida,
        mes_pago,
        justificacion_general,
        cantidad_con_letra,
        total
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id, folio_num;
      `,
      [
        folio_num,
        fecha,
        dependencia || null,
        departamento || null,
        programa || null,
        proyecto || null,
        fuente || null,
        partida || null,
        mes_pago || null,
        justificacion_general || null,
        cantidad_con_letra || null,
        totalNum,
      ]
    );

    const id = insCab.rows[0].id;

    for (let idx = 0; idx < detalle.length; idx++) {
      const r = detalle[idx] || {};
      const no = idx + 1;

      await client.query(
        `
        INSERT INTO suficiencia_detalle (
          id_suficiencia,
          no,
          clave,
          concepto_partida,
          justificacion,
          descripcion,
          importe
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          id,
          no,
          String(r.clave || "").trim() || null,
          String(r.concepto_partida || "").trim() || null,
          String(r.justificacion || "").trim() || null,
          String(r.descripcion || "").trim() || null,
          Number(r.importe || 0),
        ]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, id, folio_num });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/suficiencias", e);
    res.status(500).json({ error: "Error guardando suficiencia" });
  } finally {
    client.release();
  }
});

/* =====================================================
   ADMINISTRACIÓN DE USUARIOS (CRUD) ✅ Auditoría
   ===================================================== */

// LISTA completa
app.get("/api/admin/usuarios", async (_req, res) => {
  try {
    const sql = `
      SELECT
        u.id,
        u.nombre_completo,
        u.usuario,
        u.correo,
        u.activo,
        u.fecha_creacion,

        u.id_dgeneral,
        dg.clave AS dgeneral_clave,
        dg.dependencia AS dgeneral_nombre,

        u.id_dauxiliar,
        da.clave AS dauxiliar_clave,
        da.dependencia AS dauxiliar_nombre,

        u.updated_by,
        u.updated_at,

        COALESCE(
          ARRAY_AGG(DISTINCT r.clave) FILTER (WHERE r.clave IS NOT NULL),
          '{}'::text[]
        ) AS roles

      FROM public.usuarios u
      LEFT JOIN public.dgeneral dg ON dg.id = u.id_dgeneral
      LEFT JOIN public.dauxiliar da ON da.id = u.id_dauxiliar
      LEFT JOIN public.usuario_rol ur ON ur.id_usuario = u.id
      LEFT JOIN public.roles r ON r.id = ur.id_rol

      GROUP BY
        u.id,
        dg.clave,
        dg.dependencia,
        da.clave,
        da.dependencia

      ORDER BY u.id;
    `;

    const result = await query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/admin/usuarios error:", err);
    res.status(500).json({ error: "Error obteniendo usuarios" });
  }
});

// CREAR usuario ✅ updated_by/updated_at
app.post("/api/admin/usuarios", async (req, res) => {
  const {
    nombre_completo,
    usuario,
    correo,
    password,
    id_dgeneral,
    id_dauxiliar,
    activo = true,
    roles = [],
  } = req.body;

  if (!nombre_completo || !usuario || !password) {
    return res.status(400).json({
      error: "Nombre completo, usuario y contraseña son obligatorios",
    });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const actorId = getActorId(req);

    const ins = await client.query(
      `
      INSERT INTO usuarios (
        nombre_completo,
        usuario,
        correo,
        password,
        id_dgeneral,
        id_dauxiliar,
        activo,
        updated_by,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      RETURNING id;
      `,
      [
        nombre_completo,
        usuario,
        correo || null,
        password,
        id_dgeneral || null,
        id_dauxiliar || null,
        !!activo,
        actorId,
      ]
    );

    const newId = ins.rows[0].id;

    await client.query("DELETE FROM usuario_rol WHERE id_usuario = $1", [newId]);

    if (Array.isArray(roles) && roles.length > 0) {
      for (const rClave of roles) {
        const r = String(rClave || "").trim().toUpperCase();
        if (!r) continue;

        const rolRow = await client.query(
          "SELECT id FROM roles WHERE UPPER(clave) = $1 LIMIT 1",
          [r]
        );

        if (rolRow.rowCount > 0) {
          const idRol = rolRow.rows[0].id;
          await client.query(
            `INSERT INTO usuario_rol (id_usuario, id_rol)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING;`,
            [newId, idRol]
          );
        }
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, id: newId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("POST /api/admin/usuarios ERROR:", e);

    if (e.code === "23505") {
      return res
        .status(400)
        .json({ error: "Usuario o correo ya existen en el sistema" });
    }
    res.status(500).json({ error: "Error creando usuario" });
  } finally {
    client.release();
  }
});

// ACTUALIZAR usuario ✅ updated_by/updated_at
app.put("/api/admin/usuarios/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const {
    nombre_completo,
    usuario,
    correo,
    password,
    id_dgeneral,
    id_dauxiliar,
    activo = true,
    roles = [],
  } = req.body;

  if (!nombre_completo || !usuario) {
    return res
      .status(400)
      .json({ error: "Nombre completo y usuario son obligatorios" });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const actorId = getActorId(req);

    if (password && password.trim().length > 0) {
      await client.query(
        `
        UPDATE usuarios
           SET nombre_completo = $1,
               usuario         = $2,
               correo          = $3,
               password        = $4,
               id_dgeneral     = $5,
               id_dauxiliar    = $6,
               activo          = $7,
               updated_by      = $8,
               updated_at      = NOW()
         WHERE id = $9;
        `,
        [
          nombre_completo,
          usuario,
          correo || null,
          password,
          id_dgeneral || null,
          id_dauxiliar || null,
          !!activo,
          actorId,
          id,
        ]
      );
    } else {
      await client.query(
        `
        UPDATE usuarios
           SET nombre_completo = $1,
               usuario         = $2,
               correo          = $3,
               id_dgeneral     = $4,
               id_dauxiliar    = $5,
               activo          = $6,
               updated_by      = $7,
               updated_at      = NOW()
         WHERE id = $8;
        `,
        [
          nombre_completo,
          usuario,
          correo || null,
          id_dgeneral || null,
          id_dauxiliar || null,
          !!activo,
          actorId,
          id,
        ]
      );
    }

    await client.query("DELETE FROM usuario_rol WHERE id_usuario = $1", [id]);

    if (Array.isArray(roles) && roles.length > 0) {
      for (const rClave of roles) {
        const r = String(rClave || "").trim().toUpperCase();
        if (!r) continue;

        const rolRow = await client.query(
          "SELECT id FROM roles WHERE UPPER(clave) = $1 LIMIT 1",
          [r]
        );

        if (rolRow.rowCount > 0) {
          const idRol = rolRow.rows[0].id;
          await client.query(
            `INSERT INTO usuario_rol (id_usuario, id_rol)
             VALUES ($1,$2)
             ON CONFLICT DO NOTHING;`,
            [id, idRol]
          );
        }
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("PUT /api/admin/usuarios/:id ERROR:", e);

    if (e.code === "23505") {
      return res
        .status(400)
        .json({ error: "Usuario o correo ya existen en el sistema" });
    }
    res.status(500).json({ error: "Error actualizando usuario" });
  } finally {
    client.release();
  }
});

// ELIMINAR usuario ✅ guarda updated_by/updated_at antes del DELETE
app.delete("/api/admin/usuarios/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ error: "ID inválido" });

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const actorId = getActorId(req);

    // ✅ importante: para que el trigger capture actor antes del delete
    await client.query(
      `UPDATE public.usuarios
          SET updated_by = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [actorId, id]
    );

    await client.query("DELETE FROM usuario_rol WHERE id_usuario = $1", [id]);
    await client.query("DELETE FROM usuarios WHERE id = $1", [id]);

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/admin/usuarios/:id ERROR:", e);
    res.status(500).json({ error: "Error eliminando usuario" });
  } finally {
    client.release();
  }
});

/* =====================================================
   404 — RUTAS NO ENCONTRADAS
   ===================================================== */
app.use((req, res) => {
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(404).json({ error: "Ruta de API no encontrada" });
  }
  return res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

/* ======================== Arranque ============================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("API escuchando en http://localhost:" + PORT);
});
