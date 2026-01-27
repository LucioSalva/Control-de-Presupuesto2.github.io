// server/routes/devengado.routes.js
import express from "express";
import { query, getClient } from "../db.js";

const router = express.Router();

// ---------------------------
// Helpers (blindaje contra "" en numeric)
// ---------------------------
function toNullIfEmpty(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : v;
}

function toNumOrNull(v) {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toNumOrZero(v) {
  const s = String(v ?? "").trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function monthCode(dateStr) {
  const s = String(dateStr || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split("-")[1];
  if (s.includes("T")) return s.split("T")[0].split("-")[1];
  const now = new Date();
  return String(now.getMonth() + 1).padStart(2, "0");
}

// =====================================================
// POST /api/devengado
// Guarda cabecera + detalle en:
// - devengados
// - devengado_detalle
// =====================================================
router.post("/", async (req, res) => {
  const client = await getClient();

  try {
    const b = req.body || {};

    // ✅ ID suficiencia (en tu flujo, es el que SIEMPRE tienes)
    const idSuf = Number(b.id_suficiencia ?? b.id ?? 0);
    if (!Number.isFinite(idSuf) || idSuf <= 0) {
      return res.status(400).json({ error: "Falta id_suficiencia válido" });
    }

    // ✅ id_comprometido: si no viene, lo resolvemos por id_suficiencia
    let idComp = Number(b.id_comprometido ?? 0);
    if (!Number.isFinite(idComp) || idComp <= 0) {
      const rFind = await client.query(
        `
        SELECT id
        FROM comprometidos
        WHERE id_suficiencia = $1
        ORDER BY id DESC
        LIMIT 1
        `,
        [idSuf],
      );

      if (!rFind.rowCount) {
        return res.status(400).json({
          error:
            "No existe comprometido para esta suficiencia. Genera primero el Comprometido.",
        });
      }

      idComp = Number(rFind.rows[0].id);
    }

    // ✅ Evita duplicados: 1 devengado por comprometido
    const exists = await client.query(
      `
      SELECT id, folio_num, no_devengado
      FROM devengados
      WHERE id_comprometido = $1
      LIMIT 1
      `,
      [idComp],
    );

    if (exists.rowCount) {
      return res.json({
        ok: true,
        already_exists: true,
        id: exists.rows[0].id,
        folio_num: exists.rows[0].folio_num,
        no_devengado: exists.rows[0].no_devengado,
      });
    }

    // ✅ Trae datos del comprometido (fuente confiable)
    const rComp = await client.query(
      `
      SELECT
        c.id,
        c.id_suficiencia,
        c.id_dgeneral,
        c.id_dauxiliar,
        c.id_proyecto,
        c.id_fuente,
        c.dependencia,
        c.departamento,
        c.fuente,
        c.mes_pago,
        c.meta,
        c.clave_programatica,
        c.impuesto_tipo,
        c.isr_tasa,
        c.ieps_tasa,
        c.subtotal,
        c.iva,
        c.isr,
        c.ieps,
        c.total,
        c.cantidad_con_letra
      FROM comprometidos c
      WHERE c.id = $1
      LIMIT 1
      `,
      [idComp],
    );

    if (!rComp.rowCount) {
      return res.status(404).json({ error: "Comprometido no encontrado" });
    }

    const comp = rComp.rows[0];

    // ✅ Seguridad: que el comprometido corresponda a la misma suficiencia
    if (Number(comp.id_suficiencia) !== Number(idSuf)) {
      return res.status(400).json({
        error:
          "El id_suficiencia no corresponde al comprometido encontrado. Revisa el flujo.",
      });
    }

    // ✅ Validación: total devengado no puede exceder total comprometido
    const totalComp = toNumOrZero(comp.total);
    const totalDev = toNumOrZero(b.total ?? b.monto_devengado);
    if (totalDev > totalComp) {
      return res.status(400).json({
        error: `El total devengado (${totalDev}) no puede exceder el comprometido (${totalComp})`,
      });
    }

    // ✅ Folio: ECA-<mes>-DV-0001
    const fechaBase =
      toNullIfEmpty(b.fecha_devengado ?? b.fecha) ||
      new Date().toISOString().slice(0, 10);

    const mes = monthCode(fechaBase);
    const prefijo = `ECA-${mes}-DV-`;

    await client.query("BEGIN");
    await client.query("LOCK TABLE devengados IN EXCLUSIVE MODE");

    const rConsec = await client.query(
      `
      SELECT COALESCE(MAX(RIGHT(no_devengado, 4)::int), 0) + 1 AS consecutivo
      FROM devengados
      WHERE no_devengado LIKE $1
        AND DATE_PART('year', fecha) = DATE_PART('year', $2::date)
      `,
      [`${prefijo}%`, fechaBase],
    );

    const consecutivo = Number(rConsec.rows?.[0]?.consecutivo || 1);
    const noDevengado = `${prefijo}${String(consecutivo).padStart(4, "0")}`;

    // ✅ Inserta CABECERA
    const sqlHead = `
      INSERT INTO devengados (
        id_comprometido,
        id_suficiencia,
        id_usuario,

        id_dgeneral,
        id_dauxiliar,
        id_proyecto,
        id_fuente,

        no_devengado,
        fecha,
        dependencia,
        departamento,
        fuente,
        mes_pago,
        meta,
        clave_programatica,

        impuesto_tipo,
        isr_tasa,
        ieps_tasa,
        subtotal,
        iva,
        isr,
        ieps,
        total,
        cantidad_con_letra
      )
      VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24
      )
      RETURNING id, folio_num, no_devengado;
    `;

    const headParams = [
      idComp, // $1
      idSuf, // $2
      req.user.id, // $3

      comp.id_dgeneral, // $4
      comp.id_dauxiliar, // $5
      comp.id_proyecto, // $6
      comp.id_fuente, // $7

      noDevengado, // $8
      fechaBase, // $9
      comp.dependencia, // $10
      comp.departamento, // $11
      comp.fuente, // $12
      comp.mes_pago, // $13
      comp.meta, // $14
      comp.clave_programatica, // $15

      comp.impuesto_tipo ?? "NONE", // $16

      // ✅ blindaje numeric como en comprometido
      toNumOrNull(b.isr_tasa ?? comp.isr_tasa), // $17
      toNumOrNull(b.ieps_tasa ?? comp.ieps_tasa), // $18

      toNumOrZero(b.subtotal ?? comp.subtotal), // $19
      toNumOrZero(b.iva ?? comp.iva), // $20
      toNumOrZero(b.isr ?? comp.isr), // $21
      toNumOrZero(b.ieps ?? comp.ieps), // $22

      totalDev, // $23
      toNullIfEmpty(b.cantidad_con_letra ?? comp.cantidad_con_letra), // $24
    ];

    const rHead = await client.query(sqlHead, headParams);
    const idDev = Number(rHead.rows[0].id);

    // ✅ Inserta DETALLE (importe editable)
    const detalle = Array.isArray(b.detalle) ? b.detalle : [];
    if (detalle.length) {
      const values = [];
      const params = [];
      let i = 1;

      for (let idx = 0; idx < detalle.length; idx++) {
        const d = detalle[idx] || {};
        const renglon = Number(d.renglon ?? d.no ?? (idx + 1));

        values.push(
          `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
        );

        params.push(
          idDev,
          renglon,
          toNullIfEmpty(d.clave),
          toNullIfEmpty(d.concepto_partida),
          toNullIfEmpty(d.justificacion),
          toNullIfEmpty(d.descripcion),
          toNumOrZero(d.importe),
        );
      }

      await client.query(
        `
        INSERT INTO devengado_detalle
          (id_devengado, renglon, clave, concepto_partida, justificacion, descripcion, importe)
        VALUES ${values.join(",")}
        `,
        params,
      );
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      id: idDev,
      folio_num: rHead.rows[0].folio_num,
      no_devengado: rHead.rows[0].no_devengado,
      id_comprometido: idComp,
      id_suficiencia: idSuf,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[POST devengado] error:", err);
    return res
      .status(500)
      .json({ error: "Error al guardar devengado", db: err.message });
  } finally {
    client.release();
  }
});

export default router;
