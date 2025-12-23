// =====================================================
//  CONFIG
// =====================================================
const ADMIN_API_BASE = "http://localhost:3000";
const ENDPOINT_USUARIOS = `${ADMIN_API_BASE}/api/admin/usuarios`;
const ENDPOINT_DGENERAL = `${ADMIN_API_BASE}/api/catalogos/dgeneral`;
const ENDPOINT_DAUXILIAR = `${ADMIN_API_BASE}/api/catalogos/dauxiliar`;

const ROLES_VALIDOS = ["GOD", "ADMIN", "AREA"];

// =====================================================
//  ACTOR (quién está logueado) -> para auditoría
// =====================================================
function getActorId() {
  try {
    const raw = localStorage.getItem("cp_usuario");
    if (!raw) return null;
    const u = JSON.parse(raw);
    const id = Number(u.id || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function actorHeaders(isJson = true) {
  const actorId = getActorId();
  const h = {};
  if (isJson) h["Content-Type"] = "application/json";
  if (actorId) h["x-user-id"] = String(actorId);
  return h;
}

// =====================================================
//  GUARD: solo Lucio / GOD
// =====================================================
(function adminGuard() {
  try {
    const raw = localStorage.getItem("cp_usuario");
    if (!raw) {
      window.location.href = "login.html";
      return;
    }

    const user = JSON.parse(raw);
    const username = String(user.usuario || "").trim().toLowerCase();
    const userId = Number(user.id || 0);

    const roles = Array.isArray(user.roles) ? user.roles : [];
    const rolesNorm = roles
      .filter((r) => r != null)
      .map((r) => String(r).trim().toUpperCase());

    const esLucio =
      userId === 1 ||
      username === "lucio" ||
      username === "ing. lucio" ||
      username === "ing. lucio salvador";

    const esDios = rolesNorm.includes("GOD");

    if (!(esLucio || esDios)) {
      console.warn("[ADMIN-GUARD] No es admin, mandando a index");
      window.location.href = "index.html";
    } else {
      console.log("[ADMIN-GUARD] Acceso permitido a admin-usuarios");
    }
  } catch (e) {
    console.error("[ADMIN-GUARD] Error parseando cp_usuario", e);
    window.location.href = "login.html";
  }
})();

// =====================================================
//  ESTADO
// =====================================================
let usuariosCache = [];
let usuarioModalInstance = null;

let dgeneralCatalog = [];
let dauxiliarCatalog = [];

let editingMode = false;

// =====================================================
//  UTILIDADES UI
// =====================================================
function showAlert(message, type = "info") {
  const alertBox = document.getElementById("alertBox");
  if (!alertBox) return;

  alertBox.className = "alert alert-" + type;
  alertBox.textContent = message;
  alertBox.classList.remove("d-none");
}

function hideAlert() {
  const alertBox = document.getElementById("alertBox");
  if (!alertBox) return;
  alertBox.classList.add("d-none");
}

function formatFecha(fechaStr) {
  if (!fechaStr) return "—";
  const d = new Date(fechaStr);
  if (isNaN(d.getTime())) return "—";
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${anio} ${hora}:${min}`;
}

// =====================================================
//  CATALOGO DGENERAL (SELECT)
// =====================================================
async function fetchDgeneralCatalog() {
  const res = await fetch(ENDPOINT_DGENERAL, { headers: actorHeaders(true) });
  const data = await res.json().catch(() => null);

  if (!res.ok) throw new Error((data && data.error) || "Error cargando catálogo dgeneral");
  if (!Array.isArray(data)) throw new Error("Catálogo dgeneral inválido");

  dgeneralCatalog = data;
}

function fillDgeneralSelect() {
  const sel = document.getElementById("idDgeneral");
  if (!sel) return;

  sel.innerHTML = `<option value="">Seleccione...</option>`;
  dgeneralCatalog.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = String(r.id);
    opt.textContent = `${r.clave} — ${r.dependencia}`;
    sel.appendChild(opt);
  });
}

// =====================================================
//  CATALOGO DAUXILIAR (SELECT)
// =====================================================
async function fetchDauxiliarCatalog() {
  const res = await fetch(ENDPOINT_DAUXILIAR, { headers: actorHeaders(true) });
  const data = await res.json().catch(() => null);

  if (!res.ok) throw new Error((data && data.error) || "Error cargando catálogo dauxiliar");
  if (!Array.isArray(data)) throw new Error("Catálogo dauxiliar inválido");

  dauxiliarCatalog = data;
}

function fillDauxiliarSelect() {
  const sel = document.getElementById("idDauxiliar");
  if (!sel) return;

  sel.innerHTML = `<option value="">Seleccione...</option>`;
  dauxiliarCatalog.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = String(r.id);
    opt.textContent = `${r.clave} — ${r.dependencia}`;
    sel.appendChild(opt);
  });
}

// =====================================================
//  API
// =====================================================
async function fetchUsuarios() {
  try {
    hideAlert();

    const res = await fetch(ENDPOINT_USUARIOS, { headers: actorHeaders(true) });
    const data = await res.json().catch(() => null);

    if (!res.ok) throw new Error((data && data.error) || "Error al obtener usuarios");
    if (!Array.isArray(data)) throw new Error("Respuesta inesperada del servidor");

    usuariosCache = data;
    renderTablaUsuarios();
  } catch (err) {
    console.error("[ADMIN-USUARIOS] Error:", err);
    showAlert(err.message || "No se pudieron cargar los usuarios", "danger");
    usuariosCache = [];
    renderTablaUsuarios();
  }
}

async function crearUsuario(payload) {
  const res = await fetch(ENDPOINT_USUARIOS, {
    method: "POST",
    headers: actorHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || "Error al crear usuario");
  return data;
}

async function actualizarUsuario(id, payload) {
  const res = await fetch(`${ENDPOINT_USUARIOS}/${id}`, {
    method: "PUT",
    headers: actorHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || "Error al actualizar usuario");
  return data;
}

async function eliminarUsuario(id) {
  const res = await fetch(`${ENDPOINT_USUARIOS}/${id}`, {
    method: "DELETE",
    headers: actorHeaders(false),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || "Error al eliminar usuario");
  return data;
}

// =====================================================
//  RENDERIZAR TABLA
// =====================================================
function renderTablaUsuarios() {
  const tbody = document.querySelector("#tablaUsuarios tbody");
  const emptyState = document.getElementById("emptyState");
  const resumen = document.getElementById("usuariosResumen");

  if (!tbody) return;
  tbody.innerHTML = "";

  if (!Array.isArray(usuariosCache) || usuariosCache.length === 0) {
    if (emptyState) emptyState.classList.remove("d-none");
    if (resumen) resumen.textContent = "";
    return;
  }

  if (emptyState) emptyState.classList.add("d-none");

  usuariosCache.forEach((u) => {
    const tr = document.createElement("tr");

    const rolesHtml = Array.isArray(u.roles)
      ? u.roles
          .map((r) => {
            const rol = String(r || "").toUpperCase();
            const cls =
              rol === "GOD" ? "text-bg-dark" :
              rol === "ADMIN" ? "text-bg-primary" :
              rol === "AREA" ? "text-bg-secondary" :
              "text-bg-light";
            return `<span class="badge ${cls} badge-role me-1">${rol}</span>`;
          })
          .join("")
      : "";

    tr.innerHTML = `
      <td>${u.id}</td>
      <td class="col-nombre">${u.nombre_completo || ""}</td>
      <td>${u.usuario || ""}</td>
      <td class="wrap">${u.dgeneral_nombre || ""}</td>
      <td class="wrap">${u.dauxiliar_nombre || ""}</td>
      <td>${rolesHtml}</td>
      <td>${
        u.activo
          ? `<span class="badge text-bg-success badge-role">ACTIVO</span>`
          : `<span class="badge text-bg-danger badge-role">INACTIVO</span>`
      }</td>
      <td class="col-fecha">${formatFecha(u.fecha_creacion)}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-primary btn-action me-1"
                data-action="edit" data-id="${u.id}">
          ✏️ Editar
        </button>
        <button class="btn btn-sm btn-outline-danger btn-action"
                data-action="delete" data-id="${u.id}">
          🗑️ Eliminar
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (resumen) resumen.textContent = `Total de usuarios: ${usuariosCache.length}`;
}

// =====================================================
//  MODAL: abrir / llenar / leer datos
// =====================================================
function setPasswordMode(isEdit) {
  const passInput = document.getElementById("password");
  if (!passInput) return;

  if (isEdit) {
    passInput.required = false;
    passInput.value = "";
    passInput.placeholder = "Dejar en blanco para no cambiar";
  } else {
    passInput.required = true;
    passInput.value = "";
    passInput.placeholder = "";
  }
}

function abrirModalNuevoUsuario() {
  editingMode = false;
  limpiarFormularioUsuario();

  const titulo = document.getElementById("usuarioModalLabel");
  if (titulo) titulo.textContent = "Nuevo usuario";

  const idInput = document.getElementById("usuarioId");
  if (idInput) idInput.value = "";

  setPasswordMode(false);

  if (!usuarioModalInstance) {
    const modalEl = document.getElementById("usuarioModal");
    usuarioModalInstance = new bootstrap.Modal(modalEl);
  }
  usuarioModalInstance.show();
}

function abrirModalEditarUsuario(usuario) {
  editingMode = true;
  limpiarFormularioUsuario();

  const titulo = document.getElementById("usuarioModalLabel");
  if (titulo) titulo.textContent = `Editar usuario #${usuario.id}`;

  document.getElementById("usuarioId").value = usuario.id;
  document.getElementById("nombreCompleto").value = usuario.nombre_completo || "";
  document.getElementById("usuarioInput").value = usuario.usuario || "";
  document.getElementById("correo").value = usuario.correo || "";
  document.getElementById("idDgeneral").value = usuario.id_dgeneral ? String(usuario.id_dgeneral) : "";

  const da = document.getElementById("idDauxiliar");
  if (da) da.value = usuario.id_dauxiliar ? String(usuario.id_dauxiliar) : "";

  document.getElementById("activo").checked = !!usuario.activo;

  setPasswordMode(true);

  const roles = Array.isArray(usuario.roles) ? usuario.roles : [];
  const rolesNorm = roles.map((r) => String(r).trim().toUpperCase());

  document.querySelectorAll(".rol-check").forEach((chk) => {
    const value = String(chk.value || "").trim().toUpperCase();
    chk.checked = rolesNorm.includes(value);
  });

  if (!usuarioModalInstance) {
    const modalEl = document.getElementById("usuarioModal");
    usuarioModalInstance = new bootstrap.Modal(modalEl);
  }
  usuarioModalInstance.show();
}

function limpiarFormularioUsuario() {
  document.getElementById("usuarioForm").reset();
  document.getElementById("usuarioId").value = "";

  const dg = document.getElementById("idDgeneral");
  if (dg) dg.value = "";

  const da = document.getElementById("idDauxiliar");
  if (da) da.value = "";

  document.querySelectorAll(".rol-check").forEach((chk) => {
    chk.checked = false;
  });
}

function obtenerPayloadFormulario() {
  const idStr = document.getElementById("usuarioId").value.trim();
  const id = idStr ? Number(idStr) : null;

  const nombre_completo = document.getElementById("nombreCompleto").value.trim();
  const usuario = document.getElementById("usuarioInput").value.trim();
  const correo = document.getElementById("correo").value.trim();
  const password = document.getElementById("password").value;

  const idDgeneralStr = document.getElementById("idDgeneral").value.trim();
  const id_dgeneral = idDgeneralStr ? Number(idDgeneralStr) : null;

  const idDauxiliarStr = (document.getElementById("idDauxiliar")?.value || "").trim();
  const id_dauxiliar = idDauxiliarStr ? Number(idDauxiliarStr) : null;

  const activo = document.getElementById("activo").checked;

  let roles = [];
  document.querySelectorAll(".rol-check").forEach((chk) => {
    if (chk.checked) roles.push(chk.value);
  });

  roles = roles
    .map((r) => String(r || "").trim().toUpperCase())
    .filter((r) => ROLES_VALIDOS.includes(r));

  if (!nombre_completo || !usuario) throw new Error("Nombre completo y usuario son obligatorios");

  if (id == null && (!password || !password.trim())) {
    throw new Error("La contraseña es obligatoria al crear un usuario");
  }

  const payload = {
    nombre_completo,
    usuario,
    correo: correo || null,
    id_dgeneral,
    id_dauxiliar,
    activo,
    roles,
  };

  if (password && password.trim().length > 0) {
    payload.password = password;
  }

  return { id, payload };
}

// =====================================================
//  INIT
// =====================================================
document.addEventListener("DOMContentLoaded", async () => {
  const btnVolver = document.getElementById("btnVolver");
  if (btnVolver) btnVolver.addEventListener("click", () => (window.location.href = "index.html"));

  const btnNuevoUsuario = document.getElementById("btnNuevoUsuario");
  if (btnNuevoUsuario) btnNuevoUsuario.addEventListener("click", abrirModalNuevoUsuario);

  try {
    await fetchDgeneralCatalog();
    fillDgeneralSelect();
  } catch (e) {
    console.error("[DGENERAL] Error:", e);
    showAlert("No se pudo cargar el catálogo de dependencias (dgeneral).", "danger");
  }

  try {
    await fetchDauxiliarCatalog();
    fillDauxiliarSelect();
  } catch (e) {
    console.error("[DAUXILIAR] Error:", e);
    showAlert("No se pudo cargar el catálogo de dependencias (dauxiliar).", "danger");
  }

  const form = document.getElementById("usuarioForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const { id, payload } = obtenerPayloadFormulario();

        if (id == null) {
          await crearUsuario(payload);
          showAlert("Usuario creado correctamente.", "success");
        } else {
          await actualizarUsuario(id, payload);
          showAlert("Usuario actualizado correctamente.", "success");
        }

        if (usuarioModalInstance) usuarioModalInstance.hide();
        await fetchUsuarios();
      } catch (err) {
        console.error("[USUARIO-FORM] Error:", err);
        showAlert(err.message || "No se pudo guardar el usuario", "danger");
      }
    });
  }

  const tbody = document.querySelector("#tablaUsuarios tbody");
  if (tbody) {
    tbody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = Number(btn.getAttribute("data-id") || "0");
      if (!id) return;

      const usuario = usuariosCache.find((u) => u.id === id);

      if (action === "edit") {
        if (!usuario) return;
        abrirModalEditarUsuario(usuario);
      }

      if (action === "delete") {
        if (!usuario) return;

        const confirmado = window.confirm(
          `¿Seguro que deseas eliminar al usuario "${usuario.usuario}" (#${usuario.id})?`
        );
        if (!confirmado) return;

        try {
          await eliminarUsuario(id);
          showAlert("Usuario eliminado correctamente.", "success");
          await fetchUsuarios();
        } catch (err) {
          console.error("[DELETE-USUARIO] Error:", err);
          showAlert(err.message || "No se pudo eliminar el usuario", "danger");
        }
      }
    });
  }

  fetchUsuarios();
});
