// server/routes/devengados.routes.js
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

/**
 * Folio oficial: ECA/AÑO/MES/TIPO/ID
 */
function generarFolioOficial(tipo, id) {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const idPadded = String(id).padStart(3, "0");
  return `ECA/${year}/${month}/${tipo}/${idPadded}`;
}

/**
 * GET /api/devengados/next-folio
 */
router.get("/next-folio", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COALESCE(MAX(folio_devengado),0) + 1 AS folio
      FROM suficiencias
      WHERE folio_devengado IS NOT NULL
    `);
    return res.json({ folio: Number(r.rows?.[0]?.folio || 1) });
  } catch (err) {
    console.error("[next-folio devengado] error:", err);
    return res
      .status(500)
      .json({ error: "Error al obtener folio de devengado" });
  }
});

/**
 * GET /api/devengados/por-vencer
 * (Importante: antes de /:id para que no lo capture)
 */
router.get("/por-vencer", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.id,
        s.no_suficiencia,
        s.folio_comprometido,
        s.fecha_comprometido,
        s.dependencia,
        s.total,
        s.estatus,
        u.nombre AS usuario,
        u.email,
        (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE - CURRENT_DATE AS dias_restantes
      FROM suficiencias s
      LEFT JOIN usuarios u ON s.id_usuario = u.id
      WHERE s.estatus = 'VIGENTE'
      AND s.folio_comprometido IS NOT NULL
      AND EXTRACT(MONTH FROM s.fecha_comprometido) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(YEAR FROM s.fecha_comprometido) = EXTRACT(YEAR FROM CURRENT_DATE)
      AND (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE - CURRENT_DATE <= 5
      ORDER BY dias_restantes ASC
    `);

    return res.json({ total: result.rowCount, documentos: result.rows });
  } catch (err) {
    console.error("[API][DEVENGADO POR-VENCER] Error:", err);
    return res
      .status(500)
      .json({ error: "Error consultando documentos por vencer" });
  }
});

/**
 * GET /api/devengados/vigencia/verificar/:id
 */
router.get("/vigencia/verificar/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        fecha_comprometido,
        estatus,
        EXTRACT(MONTH FROM fecha_comprometido) AS mes_comprometido,
        EXTRACT(YEAR FROM fecha_comprometido) AS anio_comprometido,
        EXTRACT(MONTH FROM CURRENT_DATE) AS mes_actual,
        EXTRACT(YEAR FROM CURRENT_DATE) AS anio_actual,
        (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS fin_mes,
        (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE - CURRENT_DATE AS dias_restantes
      FROM suficiencias
      WHERE id = $1
    `,
      [id],
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Documento no encontrado" });

    const doc = result.rows[0];
    const vigente =
      doc.estatus === "VIGENTE" &&
      parseInt(doc.mes_comprometido) === parseInt(doc.mes_actual) &&
      parseInt(doc.anio_comprometido) === parseInt(doc.anio_actual);

    return res.json({
      vigente,
      estatus: doc.estatus,
      dias_restantes: parseInt(doc.dias_restantes),
      fin_mes: doc.fin_mes,
      mensaje: vigente
        ? `Documento vigente. Quedan ${doc.dias_restantes} días para el fin del mes.`
        : doc.estatus !== "VIGENTE"
          ? `Documento ${doc.estatus}`
          : "Documento fuera de vigencia (mes anterior)",
    });
  } catch (err) {
    console.error("[API][DEVENGADO VIGENCIA] Error:", err);
    return res.status(500).json({ error: "Error verificando vigencia" });
  }
});

/**
 * POST /api/devengados/vigencia/cancelar-vencidos
 */
router.post("/vigencia/cancelar-vencidos", async (req, res) => {
  try {
    const mesActual = new Date().getMonth() + 1;
    const anioActual = new Date().getFullYear();

    const result = await pool.query(
      `
      UPDATE suficiencias SET
        estatus = 'CANCELADO_VIGENCIA',
        fecha_cancelacion = CURRENT_TIMESTAMP,
        motivo_cancelacion = 'Cancelado automáticamente por exceder vigencia mensual',
        monto_liberado = COALESCE(monto_devengado, total)
      WHERE estatus = 'VIGENTE'
      AND folio_comprometido IS NOT NULL
      AND (
        EXTRACT(MONTH FROM COALESCE(fecha_comprometido, fecha)) < $1
        OR EXTRACT(YEAR FROM COALESCE(fecha_comprometido, fecha)) < $2
      )
      RETURNING id, no_suficiencia, folio_comprometido, total
    `,
      [mesActual, anioActual],
    );

    return res.json({
      success: true,
      cancelados: result.rowCount,
      documentos: result.rows,
      mensaje: `Se cancelaron ${result.rowCount} documentos por exceder vigencia mensual`,
    });
  } catch (err) {
    console.error("[API][DEVENGADO CANCELAR-VENCIDOS] Error:", err);
    return res
      .status(500)
      .json({ error: "Error cancelando documentos vencidos" });
  }
});

/**
 * GET /api/devengados/:id
 * Devuelve un devengado existente (cabecera + detalle con importe_devengado)
 */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const qHead = await pool.query(
      `
      SELECT
        s.id,
        s.folio_num,
        s.folio_comprometido,
        s.folio_devengado,
        s.folio_oficial_suficiencia,
        s.folio_oficial_comprometido,
        s.folio_oficial_devengado,
        s.no_suficiencia,
        s.fecha,
        s.fecha_comprometido,
        s.fecha_devengado,
        s.dependencia,
        s.clave_programatica,
        s.id_proyecto,
        s.id_fuente,
        s.fuente,
        s.mes_pago,
        s.total AS monto_comprometido,
        s.monto_devengado,
        s.monto_liberado,
        s.subtotal,
        s.iva,
        s.isr,
        s.isr_tasa,
        s.total,
        s.meta,
        s.cantidad_con_letra,
        s.estatus,
        s.fecha_cancelacion,
        s.motivo_cancelacion,
        s.firmante_coordinacion,
        s.firmante_area,
        s.firmante_direccion,
        p.nombre AS programa
      FROM suficiencias s
      LEFT JOIN proyectos p ON p.id = s.id_proyecto
      WHERE s.id = $1
    `,
      [id],
    );

    if (qHead.rowCount === 0)
      return res.status(404).json({ error: "No encontrado" });

    const head = qHead.rows[0];

    const qDet = await pool.query(
      `
      SELECT
        renglon AS no,
        clave,
        concepto_partida,
        justificacion,
        descripcion,
        importe AS importe_comprometido,
        COALESCE(importe_devengado, importe) AS importe
      FROM suficiencias_detalle
      WHERE id_suficiencia = $1
      ORDER BY renglon ASC
    `,
      [id],
    );

    return res.json({ ...head, detalle: qDet.rows || [] });
  } catch (err) {
    console.error("[API][DEVENGADO] Error:", err);
    return res
      .status(500)
      .json({ error: "Error interno consultando devengado" });
  }
});

/**
 * POST /api/devengados
 * Guarda devengado: actualiza montos + guarda importe_devengado por renglón
 * + guarda firmantes variables en columnas existentes:
 *   firmante_area, firmante_direccion, firmante_coordinacion
 */
router.post("/", async (req, res) => {
  try {
    const {
      id_suficiencia,
      id_comprometido,
      fecha_devengado,

      monto_devengado,
      monto_liberado,

      subtotal,
      iva,
      isr,
      isr_tasa,
      total,
      cantidad_con_letra,

      firmante_area,
      firmante_direccion,
      firmante_coordinacion,

      detalle,
    } = req.body;

    const suficienciaId = id_suficiencia || id_comprometido;
    if (!suficienciaId) {
      return res
        .status(400)
        .json({ error: "ID de suficiencia/comprometido requerido" });
    }

    const checkResult = await pool.query(
      `
      SELECT id, folio_comprometido, folio_devengado, folio_oficial_devengado,
             total AS monto_comprometido, estatus
      FROM suficiencias
      WHERE id = $1
    `,
      [suficienciaId],
    );

    if (checkResult.rowCount === 0)
      return res.status(404).json({ error: "Suficiencia no encontrada" });

    const doc = checkResult.rows[0];

    if (!doc.folio_comprometido) {
      return res
        .status(400)
        .json({
          error:
            "Este documento no tiene comprometido. Primero debe generarse el comprometido.",
        });
    }

    if (doc.estatus === "CANCELADO" || doc.estatus === "CANCELADO_VIGENCIA") {
      return res
        .status(400)
        .json({ error: `No se puede devengar un documento ${doc.estatus}` });
    }

    if (parseFloat(monto_devengado) > parseFloat(doc.monto_comprometido)) {
      return res.status(400).json({
        error: `El monto devengado ($${monto_devengado}) no puede exceder el monto comprometido ($${doc.monto_comprometido})`,
      });
    }

    // Folio devengado si no existe
    let folioDevengado = doc.folio_devengado;
    let folioOficialDevengado = doc.folio_oficial_devengado;

    if (!folioDevengado) {
      const rFolio = await pool.query(`
        SELECT COALESCE(MAX(folio_devengado),0) + 1 AS folio
        FROM suficiencias
        WHERE folio_devengado IS NOT NULL
      `);
      folioDevengado = Number(rFolio.rows?.[0]?.folio || 1);
      folioOficialDevengado = generarFolioOficial("DV", folioDevengado);
    }

    // Actualiza cabecera (incluye firmantes variables)
    await pool.query(
      `
      UPDATE suficiencias SET
        monto_devengado = $1,
        monto_liberado = $2,
        subtotal = COALESCE($3, subtotal),
        iva = COALESCE($4, iva),
        isr = COALESCE($5, isr),
        isr_tasa = COALESCE($6, isr_tasa),
        total = COALESCE($7, total),
        cantidad_con_letra = COALESCE($8, cantidad_con_letra),
        fecha_devengado = COALESCE($9::date, fecha_devengado, CURRENT_DATE),
        folio_devengado = COALESCE(folio_devengado, $10),
        folio_oficial_devengado = COALESCE(folio_oficial_devengado, $11),

        firmante_area = COALESCE($12, firmante_area),
        firmante_direccion = COALESCE($13, firmante_direccion),
        firmante_coordinacion = COALESCE($14, firmante_coordinacion)
      WHERE id = $15
    `,
      [
        monto_devengado,
        monto_liberado,
        subtotal ?? null,
        iva ?? null,
        isr ?? null,
        isr_tasa ?? null,
        total ?? null,
        cantidad_con_letra ?? null,
        fecha_devengado ?? null,
        folioDevengado,
        folioOficialDevengado,
        firmante_area ?? null,
        firmante_direccion ?? null,
        firmante_coordinacion ?? null,
        suficienciaId,
      ],
    );

    // Detalle: guarda importe_devengado por renglón
    if (Array.isArray(detalle)) {
      for (let i = 0; i < detalle.length; i++) {
        const item = detalle[i];
        const renglon = item.no || item.renglon || i + 1;
        const importeDev = item.importe;

        if (importeDev !== undefined) {
          await pool.query(
            `
            UPDATE suficiencias_detalle SET
              importe_devengado = $1
            WHERE id_suficiencia = $2 AND renglon = $3
          `,
            [importeDev, suficienciaId, renglon],
          );
        }
      }
    }

    return res.json({
      success: true,
      message: "Devengado guardado correctamente",
      id: suficienciaId,
      folio_num: folioDevengado,
      folio_oficial: folioOficialDevengado,
      monto_liberado: monto_liberado,
    });
  } catch (err) {
    console.error("[API][DEVENGADO POST] Error:", err);
    return res.status(500).json({ error: "Error interno guardando devengado" });
  }
});

/**
 * POST /api/devengados/:id/cancelar
 */
router.post("/:id/cancelar", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { motivo } = req.body;

    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ error: "ID inválido" });
    if (!motivo || motivo.trim() === "")
      return res
        .status(400)
        .json({ error: "Debe proporcionar un motivo de cancelación" });

    const checkResult = await pool.query(
      `
      SELECT id, estatus, total, monto_devengado
      FROM suficiencias
      WHERE id = $1
    `,
      [id],
    );

    if (checkResult.rowCount === 0)
      return res.status(404).json({ error: "Documento no encontrado" });

    const doc = checkResult.rows[0];

    if (doc.estatus === "CANCELADO" || doc.estatus === "CANCELADO_VIGENCIA") {
      return res.status(400).json({ error: "El documento ya está cancelado" });
    }

    await pool.query(
      `
      UPDATE suficiencias SET
        estatus = 'CANCELADO',
        fecha_cancelacion = CURRENT_TIMESTAMP,
        motivo_cancelacion = $1,
        monto_liberado = COALESCE(monto_devengado, total)
      WHERE id = $2
    `,
      [motivo.trim(), id],
    );

    return res.json({
      success: true,
      message: "Documento cancelado correctamente",
      monto_liberado: doc.monto_devengado || doc.total,
    });
  } catch (err) {
    console.error("[API][DEVENGADO CANCELAR] Error:", err);
    return res
      .status(500)
      .json({ error: "Error interno cancelando documento" });
  }
});

export default router;
