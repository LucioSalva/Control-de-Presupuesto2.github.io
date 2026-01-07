// =====================================================
//  IMPORTS Y CONFIG
// =====================================================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Routers
import catalogosRoutes from "./routes/catalogos.routes.js";
import adminUsuariosRouter from "./routes/admin-usuarios.routes.js";
import authRouter from "./routes/auth.routes.js";
import suficienciasRouter from "./routes/suficiencias.routes.js";
import presupuestoRouter from "./routes/presupuesto.routes.js";
import comprometidoRouter from "./routes/comprometido.routes.js";


dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================================================
//  MIDDLEWARE BASE
// =====================================================

// CORS abierto en desarrollo
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// =====================================================
//  STATIC (FRONTEND)
// =====================================================

// Sirve HTML/archivos desde: server/public
app.use(express.static(path.join(__dirname, "public")));

// Sirve CSS global desde: /css (carpeta fuera de server)
app.use("/css", express.static(path.join(__dirname, "..", "css")));

// (Opcional) si tienes JS global en /js fuera de server
app.use("/js", express.static(path.join(__dirname, "..", "js")));

// =====================================================
//  ROUTERS API
// =====================================================

app.use("/api/catalogos", catalogosRoutes);

app.use("/api/admin", adminUsuariosRouter);

// Auth (login)
app.use("/api", authRouter);

// Suficiencias
app.use("/api/suficiencias", suficienciasRouter);

// Comprometido (solo lectura)
app.use("/api/comprometido", comprometidoRouter);

// Presupuesto / detalles / gastos / reconducir / projects / etc.
app.use("/api", presupuestoRouter);



// =====================================================
//  HELPERS 
// =====================================================

// saldo = presupuesto - total_gastado + total_reconducido
function computeSaldo({
  presupuesto = 0,
  total_gastado = 0,
  total_reconducido = 0,
}) {
  return Number(presupuesto) - Number(total_gastado) + Number(total_reconducido);
}

function buildHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Auditoría: quién ejecuta la acción (viene del front en header)
 * En el frontend manda: headers: { "x-user-id": <id del usuario logueado> }
 */
function getActorId(req) {
  const actorId = Number(req.headers["x-user-id"] || 0);
  return Number.isFinite(actorId) && actorId > 0 ? actorId : null;
}

/**
 * Valida que vengan id_dgeneral, id_dauxiliar, id_fuente
 * y el id_proyecto alfanumérico desde el front.
 */
async function getProjectKeys({
  id_proyecto,
  id_dgeneral,
  id_dauxiliar,
  id_fuente,
}) {
  const projectCode = String(id_proyecto || "").trim();

  const dg = Number(id_dgeneral);
  const da = Number(id_dauxiliar);
  const fu = Number(id_fuente);

  if (
    !projectCode ||
    !Number.isInteger(dg) ||
    dg <= 0 ||
    !Number.isInteger(da) ||
    da <= 0 ||
    !Number.isInteger(fu) ||
    fu <= 0
  ) {
    throw buildHttpError(
      "id_dgeneral, id_dauxiliar, id_fuente e id_proyecto son obligatorios y deben ser enteros > 0",
      400
    );
  }

  return {
    id_proyecto: projectCode,
    id_dgeneral: dg,
    id_dauxiliar: da,
    id_fuente: fu,
  };
}

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
