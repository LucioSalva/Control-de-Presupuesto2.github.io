// =====================================================
//  IMPORTS Y CONFIG
// =====================================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";
import catalogosRoutes from "./routes/catalogos.routes.js";
import adminUsuariosRouter from "./routes/admin-usuarios.routes.js";
import authRouter from "./routes/auth.routes.js";
import suficienciasRouter from "./routes/suficiencias.routes.js";
import presupuestoRouter from "./routes/presupuesto.routes.js";
import comprometidoRouter from "./routes/comprometido.routes.js";
import devengadoRouter from "./routes/devengado.routes.js";
import metasRouter from "./routes/metas.routes.js";
dotenv.config();
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// =====================================================
//  MIDDLEWARE BASE
// =====================================================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// =====================================================
//  STATIC (FRONTEND)
// =====================================================
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => {
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.use("/public", express.static(path.join(__dirname, "..", "public")));
app.use("/PDF", express.static(path.join(__dirname, "..", "public", "PDF")));
app.use("/css", express.static(path.join(__dirname, "..", "css")));
app.use("/js", express.static(path.join(__dirname, "..", "js")));

// =====================================================
//  AUTH (token de mentiritas) + roles reales en BD
// =====================================================
function parseFakeToken(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const token = m[1].trim(); // token-<id>-<timestamp>
  const parts = token.split("-");
  if (parts.length < 3) return null;
  if (parts[0] !== "token") return null;

  const userId = Number(parts[1]);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  return { token, userId };
}

async function authRequired(req, res, next) {
  try {
    const parsed = parseFakeToken(req);
    if (!parsed) return res.status(401).json({ error: "Token requerido" });

    const { userId } = parsed;

    const sql = `
      SELECT u.id,
             u.activo,
             u.id_dgeneral,
             u.id_dauxiliar,
             ARRAY(
               SELECT r.clave
               FROM usuario_rol ur
               JOIN roles r ON r.id = ur.id_rol
               WHERE ur.id_usuario = u.id
             ) AS roles
      FROM usuarios u
      WHERE u.id = $1
      LIMIT 1;
    `;

    const r = await query(sql, [userId]);

    if (r.rowCount === 0)
      return res.status(401).json({ error: "Token inválido" });

    const user = r.rows[0];
    if (!user.activo)
      return res.status(403).json({ error: "Usuario inactivo" });

    const roles = Array.isArray(user.roles) ? user.roles : [];

    req.user = {
      id: user.id,
      id_dgeneral: user.id_dgeneral,
      id_dauxiliar: user.id_dauxiliar,
      roles: roles.map((x) => String(x).trim().toUpperCase()),
    };

    next();
  } catch (e) {
    console.error("[AUTH] Error:", e);
    return res.status(500).json({ error: "Error interno de autenticación" });
  }
}

function isGodOrAdmin(req) {
  const roles = req.user?.roles || [];
  return roles.includes("GOD") || roles.includes("ADMIN");
}

/**
 * ✅ Bloquea escritura en catálogo PARTIDAS
 * (aunque hoy solo tienes GET, esto te blinda si mañana agregas POST/PUT/DELETE)
 */
function blockPartidasWrite(req, res, next) {
  const method = String(req.method || "").toUpperCase();
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  if (!isWrite) return next();

  if (!isGodOrAdmin(req)) {
    return res.status(403).json({
      error:
        "AREA no puede modificar el catálogo de partidas (solo GOD/ADMIN).",
    });
  }
  next();
}

// =====================================================
//  ROUTERS API
// =====================================================

app.use("/api", authRouter);
app.use("/api/admin/usuarios", adminUsuariosRouter);
app.use("/api/suficiencias", authRequired, suficienciasRouter);
app.use("/api/comprometido", authRequired, comprometidoRouter);
app.use("/api/devengado", authRequired, devengadoRouter);
app.use("/api", presupuestoRouter);
app.use("/api/catalogos/partidas", authRequired, blockPartidasWrite);
app.use("/api/catalogos", authRequired, catalogosRoutes);
app.use("/api/catalogos/metas", authRequired, metasRouter);

// =====================================================
//  HEALTH
// =====================================================
app.get("/api/health", (_req, res) => res.json({ ok: true }));
// =====================================================
//  404 — RUTAS NO ENCONTRADAS
// =====================================================
app.use((req, res) => {
  if (req.originalUrl.startsWith("/api/")) {
    return res.status(404).json({ error: "Ruta de API no encontrada" });
  }
  return res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});
// =====================================================
//  ARRANQUE
// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("API escuchando en http://localhost:" + PORT);
});
