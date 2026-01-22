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
    const fechaBaseRaw = b.fecha ? new Date(b.fecha) : new Date();
    const fechaBase = Number.isNaN(fechaBaseRaw.getTime())
      ? new Date()
      : fechaBaseRaw;
    const mes = String(fechaBase.getMonth() + 1).padStart(2, "0");
    const tipo = "SP";
    const prefijo = `ECA-${mes}-${tipo}-`;

    await client.query("BEGIN");
    await client.query("LOCK TABLE suficiencias IN EXCLUSIVE MODE");

    const rConsec = await client.query(
      `
        SELECT COALESCE(MAX(RIGHT(no_suficiencia, 4)::int), 0) + 1 AS consecutivo
        FROM suficiencias
        WHERE no_suficiencia LIKE $1
          AND DATE_PART('year', fecha) = DATE_PART('year', $2::date)
      `,
      [`${prefijo}%`, fechaBase]
    );
    const consecutivo = Number(rConsec.rows?.[0]?.consecutivo || 1);
    const noSuficiencia = `${prefijo}${String(consecutivo).padStart(4, "0")}`;

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
        ieps_tasa,
        subtotal,
        iva,
        isr,
        ieps,

        total,
        cantidad_con_letra,
        created_at,
        folio_num
      )
      SELECT
        $1, $2, $3, $4, $5,
        $6,
        $7, $8, $9, $10, $11, $12,
        $13,
        $14, $15, $16, $17, $18, $19, 
        $20, $21, $22,
        NOW(),
        n.folio_num
      FROM n
      RETURNING id, folio_num, no_suficiencia;
    `;

    const headParams = [
      req.user.id,
      b.id_dgeneral,
      b.id_dauxiliar,
      b.id_proyecto,
      b.id_fuente,

      noSuficiencia,
      b.fecha,
      b.dependencia,
      b.departamento,
      b.fuente,
      b.mes_pago,
      b.clave_programatica,

      b.meta,
      b.impuesto_tipo,
      b.isr_tasa,
      b.ieps_tasa,
      b.subtotal,
      b.iva,
      b.isr,
      b.ieps,

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
   GET /api/suficiencias/buscar?numero=000001
   (ejemplo básico por folio)
   ===================================================== */
router.get("/buscar", async (req, res) => {
  try {
    const numero = pad6(req.query.numero);
    if (!numero) {
      return res.status(400).json({ error: "Falta parametro numero" });
    }

    // Ajusta la columna a lo que realmente usas:
    // - si buscas por folio_num (int) -> convierte a number
    // - si buscas por no_suficiencia (texto ECA-..) -> usa texto
    const folio = Number(numero);
    if (!Number.isFinite(folio)) {
      return res.status(400).json({ error: "numero inválido" });
    }

    const r = await query(
      `SELECT * FROM suficiencias WHERE folio_num = $1 ORDER BY id DESC LIMIT 50`,
      [folio]
    );

    return res.json({ ok: true, data: r.rows });
  } catch (err) {
    console.error("[GET buscar] error:", err);
    return res.status(500).json({ error: "Error al buscar", db: err.message });
  }
});


export default router;