import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID inválido" });

    // 1️⃣ CABECERA
    const cab = await query(
      `SELECT *
       FROM suficiencias
       WHERE id = $1`,
      [id]
    );

    if (!cab.rows.length) {
      return res.status(404).json({ error: "Suficiencia no encontrada" });
    }

    // 2️⃣ DETALLE (🔥 ESTO ERA LO QUE NO TENÍAS 🔥)
    const det = await query(
      `SELECT
         renglon,
         clave,
         concepto_partida,
         justificacion,
         descripcion,
         importe
       FROM suficiencia_detalle
       WHERE id_suficiencia = $1
       ORDER BY renglon`,
      [id]
    );

    return res.json({
      ok: true,
      cabecera: cab.rows[0],
      detalle: det.rows,
    });
  } catch (err) {
    console.error("[COMPROMETIDO] error:", err);
    return res.status(500).json({ error: err.message });
  }
});


export default router;
