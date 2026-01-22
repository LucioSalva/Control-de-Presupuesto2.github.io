// server/routes/comprometido.routes.js
import express from "express";
import { query } from "../db.js";

const router = express.Router();

/**
 * GET /api/comprometido/:id
 * Devuelve: encabezado + detalle de una suficiencia (para llenar comprometido)
 *
 * Nota:
 * - La protección por token normalmente la haces en server.js con authRequired
 *   ej: app.use("/api/comprometido", authRequired, comprometidoRouter);
 * - Por eso en navegador directo te sale: "Token requerido"
 */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    // Encabezado
    const head = await query(
      `
      SELECT
        s.id,
        s.folio_num,
        s.no_suficiencia,
        s.fecha,

        s.dependencia,
        s.id_dgeneral,

        s.id_dauxiliar,
        s.id_proyecto,
        s.id_fuente,
        s.fuente,
        s.mes_pago,
        s.clave_programatica,
        s.meta,

        s.subtotal,
        s.iva,
        s.isr,
        s.ieps,
        s.total,
        s.cantidad_con_letra,

        s.impuesto_tipo,
        s.isr_tasa,
        s.ieps_tasa,

        s.created_at
      FROM suficiencias s
      WHERE s.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!head?.rows?.length) {
      return res.status(404).json({ error: "No encontrado" });
    }

    // ✅ Detalle: tu tabla real es "suficiencia_detalle"
    const det = await query(
      `
      SELECT
        d.renglon,
        d.clave,
        d.concepto_partida,
        d.justificacion,
        d.descripcion,
        d.importe
      FROM suficiencia_detalle d
      WHERE d.id_suficiencia = $1
      ORDER BY d.renglon ASC
      `,
      [id]
    );

    return res.json({
      ok: true,
      data: {
        ...head.rows[0],
        detalle: det?.rows || [],
      },
    });
  } catch (err) {
    console.error("[COMPROMETIDO] error:", err);
    return res.status(500).json({
      error: "Error interno",
      db: { message: err.message },
    });
  }
});

export default router;
