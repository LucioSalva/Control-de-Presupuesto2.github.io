// server/routes/comprometido.routes.js
import { Router } from "express";
import pool from "../db.js"; // <-- ajusta si tu pool está en otra ruta

const router = Router();

/**
 * GET /api/comprometido/:id
 * Devuelve la suficiencia + detalle para pintar la vista "Comprometido" (solo lectura)
 */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    // 1) Cabecera
    const qHead = await pool.query(
      `
      SELECT
        id,
        folio_num,
        fecha,
        dependencia,
        id_proyecto_programatico,
        id_fuente,
        id_programa,
        mes_pago,
        cantidad_pago,
        impuesto_tipo,
        isr_tasa,
        subtotal,
        iva,
        isr,
        total,
        meta,
        cantidad_con_letra
      FROM suficiencias
      WHERE id = $1
      `,
      [id]
    );

    if (qHead.rowCount === 0) {
      return res.status(404).json({ error: "No encontrado" });
    }

    const head = qHead.rows[0];

    // 2) Detalle
    const qDet = await pool.query(
      `
      SELECT
        no,
        clave,
        concepto_partida,
        justificacion,
        descripcion,
        importe
      FROM suficiencias_detalle
      WHERE id_suficiencia = $1
      ORDER BY no ASC
      `,
      [id]
    );

    return res.json({
      ...head,
      detalle: qDet.rows || [],
    });
  } catch (err) {
    console.error("[API][COMPROMETIDO] Error:", err);
    return res.status(500).json({ error: "Error interno consultando comprometido" });
  }
});

export default router;
