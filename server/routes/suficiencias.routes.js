import express from "express";
import { query, getClient } from "../db.js"; // 👈 necesitas getClient para transacción

const router = express.Router();

/* =====================================================
   Helpers roles
   ===================================================== */
function getRole(req) {
  const roles = (req.user?.roles || []).map((r) => String(r).toUpperCase());
  if (roles.includes("GOD")) return "GOD";
  if (roles.includes("ADMIN")) return "ADMIN";
  return "AREA";
}

function pad6(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s.padStart(6, "0");
  return s;
}

/* =====================================================
   GET /api/suficiencias/next-folio
   ===================================================== */
router.get("/next-folio", async (req, res) => {
  try {
    const r = await query(
      `SELECT COALESCE(MAX(folio_num),0) + 1 AS folio_num FROM suficiencias`
    );
    return res.json({ folio_num: Number(r.rows?.[0]?.folio_num || 1) });
  } catch (err) {
    console.error("[next-folio] error:", err);
    return res.status(500).json({ error: "Error al obtener folio" });
  }
});

/* =====================================================
   ✅ POST /api/suficiencias  (CABECERA + DETALLE)
   ===================================================== */
router.post("/", async (req, res) => {
  const client = await getClient();
  try {
    const b = req.body || {};

    await client.query("BEGIN");

    // ================================
    // 1️⃣ INSERT CABECERA
    // ================================
    const sqlHead = `
      WITH n AS (
        SELECT nextval('suficiencias_folio_seq')::int AS folio_num
      )
      INSERT INTO suficiencias (
        id_usuario,
        id_dgeneral,
        id_dauxiliar,
        id_proyecto,
        id_fuente,

        no_suficiencia,
        fecha,
        dependencia,
        departamento,
        fuente,
        mes_pago,
        clave_programatica,

        meta,
        impuesto_tipo,
        isr_tasa,
        subtotal,
        iva,
        isr,

        total,
        cantidad_con_letra,
        created_at,
        folio_num
      )
      SELECT
        $1, $2, $3, $4, $5,
        LPAD(n.folio_num::text, 6, '0'),
        $6, $7, $8, $9, $10, $11,
        $12,
        $13, $14, $15, $16, $17,
        $18, $19,
        NOW(),
        n.folio_num
      FROM n
      RETURNING id, folio_num, no_suficiencia;
    `;

    const headParams = [
      b.id_usuario,
      b.id_dgeneral,
      b.id_dauxiliar,
      b.id_proyecto,
      b.id_fuente,

      b.fecha,
      b.dependencia,
      b.departamento,
      b.fuente,
      b.mes_pago,
      b.clave_programatica,

      b.meta,
      b.impuesto_tipo,
      b.isr_tasa,
      b.subtotal,
      b.iva,
      b.isr,

      b.total,
      b.cantidad_con_letra,
    ];

    const rHead = await client.query(sqlHead, headParams);
    const idSuf = rHead.rows[0].id;

    // ================================
    // 2️⃣ INSERT DETALLE
    // ================================
    if (Array.isArray(b.detalle) && b.detalle.length > 0) {
      const values = [];
      const params = [];
      let idx = 1;

      for (const d of b.detalle) {
        values.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
        );
        params.push(
          idSuf,
          d.renglon,
          d.clave,
          d.concepto_partida,
          d.justificacion,
          d.descripcion,
          d.importe
        );
      }

      const sqlDet = `
        INSERT INTO suficiencia_detalle
        (id_suficiencia, renglon, clave, concepto_partida, justificacion, descripcion, importe)
        VALUES ${values.join(",")}
      `;

      await client.query(sqlDet, params);
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      id: idSuf,
      folio_num: rHead.rows[0].folio_num,
      no_suficiencia: rHead.rows[0].no_suficiencia,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[POST suficiencias] error:", err);
    return res.status(500).json({
      error: "Error al guardar suficiencia",
      db: err.message,
    });
  } finally {
    client.release();
  }
});


/* =====================================================
   GET /api/suficiencias/buscar
   ===================================================== */
router.post("/", async (req, res) => {
  const client = await getClient();

  try {
    const b = req.body;

    await client.query("BEGIN");

    // 1️⃣ CABECERA
    const headSql = `
      WITH n AS (
        SELECT nextval('suficiencias_folio_seq')::int AS folio_num
      )
      INSERT INTO suficiencias (
        id_usuario,
        id_dgeneral,
        id_dauxiliar,
        id_proyecto,
        id_fuente,
        no_suficiencia,
        fecha,
        dependencia,
        fuente,
        mes_pago,
        clave_programatica,
        meta,
        impuesto_tipo,
        isr_tasa,
        subtotal,
        iva,
        isr,
        total,
        cantidad_con_letra,
        created_at,
        folio_num
      )
      SELECT
        $1,$2,$3,$4,$5,
        LPAD(n.folio_num::text,6,'0'),
        $6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,
        NOW(),
        n.folio_num
      FROM n
      RETURNING id;
    `;

    const headParams = [
      b.id_usuario,
      b.id_dgeneral,
      b.id_dauxiliar,
      b.id_proyecto,
      b.id_fuente,
      b.fecha,
      b.dependencia,
      b.fuente,
      b.mes_pago,
      b.clave_programatica,
      b.meta,
      b.impuesto_tipo,
      b.isr_tasa,
      b.subtotal,
      b.iva,
      b.isr,
      b.total,
      b.cantidad_con_letra,
    ];

    const headRes = await client.query(headSql, headParams);
    const idSuf = headRes.rows[0].id;

    // 2️⃣ DETALLE (AQUÍ ESTABA TODO EL PEDO)
    const detSql = `
      INSERT INTO suficiencia_detalle
      (id_suficiencia, renglon, clave, concepto_partida, justificacion, descripcion, importe)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `;

    for (const r of b.detalle || []) {
      await client.query(detSql, [
        idSuf,
        r.renglon,
        r.clave,
        r.concepto_partida,
        r.justificacion,
        r.descripcion,
        r.importe,
      ]);
    }

    await client.query("COMMIT");

    res.json({ ok: true, id: idSuf });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[POST suficiencias]", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


export default router;
