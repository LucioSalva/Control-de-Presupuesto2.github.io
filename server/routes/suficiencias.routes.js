import express from "express";
import { query } from "../db.js";

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
   ✅ GET /api/suficiencias/next-folio
   (Ejemplo simple, ajusta a tu lógica real si ya existe)
   ===================================================== */
router.get("/next-folio", async (req, res) => {
  try {
    // Si tu sistema usa folio_num como consecutivo numérico:
    const r = await query(`SELECT COALESCE(MAX(folio_num),0) + 1 AS folio_num FROM suficiencias`);
    return res.json({ folio_num: Number(r.rows?.[0]?.folio_num || 1) });
  } catch (err) {
    console.error("[next-folio] error:", err);
    return res.status(500).json({ error: "Error al obtener folio" });
  }
});

/* =====================================================
   ✅ POST /api/suficiencias
   (Ejemplo: tu backend real quizá ya lo tenga)
   ===================================================== */
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};

    // Inserta lo mínimo que tu tabla pide (ajusta a tu implementación real)
    const r = await query(
      `INSERT INTO suficiencias
        (id_usuario, id_dgeneral, id_dauxiliar, id_proyecto, id_fuente, no_suficiencia, fecha, dependencia, departamento, fuente, mes_pago, total, cantidad_con_letra, created_at, folio_num)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW(), $14)
       RETURNING id, folio_num, no_suficiencia`,
      [
        b.id_usuario ?? null,
        b.id_dgeneral ?? null,
        b.id_dauxiliar ?? null,
        b.id_proyecto ?? null,
        b.id_fuente ?? null,
        b.no_suficiencia ?? null,
        b.fecha ?? null,
        b.dependencia ?? null,
        b.departamento ?? null,
        b.fuente ?? null,
        b.mes_pago ?? null,
        b.total ?? 0,
        b.cantidad_con_letra ?? "",
        b.folio_num ?? null,
      ]
    );

    return res.json({ id: r.rows[0].id, folio_num: r.rows[0].folio_num });
  } catch (err) {
    console.error("[POST suficiencias] error:", err);
    return res.status(500).json({ error: "Error al guardar suficiencia" });
  }
});

/* =====================================================
   ✅ NUEVO: GET /api/suficiencias/buscar
   SOLO:
   - ?numero=000001

   Candado:
   - GOD/ADMIN -> todo
   - AREA -> solo su id_dgeneral
     (porque tu tabla NO tiene 'area' ni 'dgeneral_clave')
   ===================================================== */
router.get("/buscar", async (req, res) => {
  try {
    const role = getRole(req);

    // 🚨 AREA: candado por id_dgeneral (lo tienes en tu tabla)
    const userIdDgeneral = req.user?.id_dgeneral ? Number(req.user.id_dgeneral) : null;

    const numero = pad6(req.query.numero);
    if (!numero) {
      return res.status(400).json({ ok: false, msg: "Debes enviar numero." });
    }

    // Buscar por no_suficiencia (tu columna existe)
    const params = [];
    let sql = `SELECT * FROM suficiencias WHERE no_suficiencia = $1`;
    params.push(numero);

    // Candado AREA
    if (role === "AREA") {
      if (!userIdDgeneral) {
        return res.status(403).json({ ok: false, msg: "Usuario AREA sin id_dgeneral en token." });
      }
      sql += ` AND id_dgeneral = $2`;
      params.push(userIdDgeneral);
    }

    sql += ` ORDER BY id DESC LIMIT 50`;

    const r = await query(sql, params);
    return res.json({ ok: true, data: r.rows });
  } catch (err) {
    console.error("[/buscar] error:", err);
    return res.status(500).json({ ok: false, msg: "Error interno", error: err.message });
  }

  if (role === "AREA") {
  if (!userIdDgeneral) {
    return res.status(403).json({
      ok: false,
      msg: "Usuario AREA sin id_dgeneral (authRequired no lo está cargando en req.user).",
    });
  }
  sql += ` AND id_dgeneral = $2`;
  params.push(userIdDgeneral);
}

});

export default router;
