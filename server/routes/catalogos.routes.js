import express from "express";
import { query } from "../db.js";

const router = express.Router();

/* =========================
   CATÁLOGOS
   ========================= */

router.get("/dgeneral", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, dependencia FROM dgeneral ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /catalogos/dgeneral", e);
    res.status(500).json({ error: "Error obteniendo catálogo dgeneral" });
  }
});

router.get("/dauxiliar", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, dependencia FROM dauxiliar ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /catalogos/dauxiliar", e);
    res.status(500).json({ error: "Error obteniendo catálogo dauxiliar" });
  }
});

router.get("/fuentes", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, fuente FROM fuentes ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /catalogos/fuentes", e);
    res.status(500).json({ error: "Error obteniendo catálogo fuentes" });
  }
});

router.get("/programas", async (_req, res) => {
  try {
    const r = await query(
      `SELECT id, clave, descripcion FROM programas ORDER BY clave`
    );
    res.json(r.rows);
  } catch (e) {
    console.error("GET /catalogos/programas", e);
    res.status(500).json({ error: "Error obteniendo catálogo programas" });
  }
});

router.get("/partidas", async (req, res) => {
  try {
    const r = await query(`
      SELECT clave, descripcion
      FROM public.partidas
      ORDER BY clave
    `);
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/partidas", e);
    res.status(500).json({ error: "Error obteniendo partidas" });
  }
});

router.get("/proyectos", async (req, res) => {
  try {
    const r = await query(`
      SELECT id, clave, conac, descripcion
      FROM public.proyectos
      ORDER BY clave
    `);
    res.json(r.rows);
  } catch (e) {
    console.error("GET /api/catalogos/proyectos", e);
    res.status(500).json({ error: "Error obteniendo proyectos" });
  }
});

export default router;
