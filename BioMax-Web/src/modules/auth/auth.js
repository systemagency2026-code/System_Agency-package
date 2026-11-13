// MÓDULO DE AUTENTICACIÓN Y GESTIÓN DE FORMULARIOS
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_CONFIG } from "../../core/js/config.js";

let supabase = null;
if (SUPABASE_CONFIG.url.includes("TU_PROYECTO")) {
  console.warn(
    "⚠️ Configura tus credenciales reales de Supabase en src/core/js/config.js",
  );
} else {
  supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
}

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const toRegisterLink = document.getElementById("to-register");
  const toLoginLink = document.getElementById("to-login");
  const formTitle = document.getElementById("form-title");
  const formSubtitle = document.getElementById("form-subtitle");
  const alertBox = document.getElementById("alert-box");

  if (toRegisterLink && toLoginLink) {
    toRegisterLink.addEventListener("click", (e) => {
      e.preventDefault();
      loginForm.style.display = "none";
      registerForm.style.display = "block";
      formTitle.textContent = "Solicitud de Afiliación";
      formSubtitle.textContent = "Únete a nuestra red logística como agencia";
      hideAlert();
    });

    toLoginLink.addEventListener("click", (e) => {
      e.preventDefault();
      registerForm.style.display = "none";
      loginForm.style.display = "block";
      formTitle.textContent = "Iniciar Sesión";
      formSubtitle.textContent =
        "Ingresa tus credenciales para acceder al sistema";
      hideAlert();
    });
  }

  // Enlaces directos desde biomaxlogistics.com: #login o #afiliacion.
  // Conserva el comportamiento anterior si se abre sin fragmento.
  function aplicarDestinoInicial() {
    const destino = window.location.hash.toLowerCase();
    if (destino === "#login" || destino === "#iniciar-sesion") {
      toLoginLink?.click();
    } else if (destino === "#afiliacion" || destino === "#registro") {
      toRegisterLink?.click();
    }
  }
  aplicarDestinoInicial();
  window.addEventListener("hashchange", aplicarDestinoInicial);

  function showAlert(message, type = "error") {
    alertBox.textContent = message;
    alertBox.className = `alert ${type}`;
    alertBox.style.display = "block";
  }

  function hideAlert() {
    alertBox.style.display = "none";
  }

  // --- Solicitud de Afiliación ---
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideAlert();

      if (!supabase) {
        showAlert("Error: Supabase no está configurado en config.js");
        return;
      }

      const btn = document.getElementById("register-btn");
      btn.textContent = "Enviando solicitud...";
      btn.disabled = true;

      const nombre_negocio = document
        .getElementById("reg-negocio")
        .value.trim();
      const nombre_contacto = document
        .getElementById("reg-contacto")
        .value.trim();
      const correo = document.getElementById("reg-correo").value.trim();
      const telefono =
        document.getElementById("reg-telefono")?.value.trim() || null;
      const departamento =
        document.getElementById("reg-departamento").value.trim() || null;
      const codigo_referencia =
        document.getElementById("reg-referencia").value.trim() || null;

      try {
        const { error } = await supabase.from("solicitudes_afiliacion").insert([
          {
            nombre_negocio,
            nombre_contacto,
            correo,
            telefono,
            departamento,
            codigo_referencia,
            estado: "pendiente",
          },
        ]);

        if (error) throw error;

        showAlert(
          "¡Solicitud enviada con éxito! El administrador la revisará pronto.",
          "success",
        );
        registerForm.reset();
      } catch (err) {
        showAlert(
          err.message || "Error al enviar la solicitud. Verifica los datos.",
        );
      } finally {
        btn.textContent = "Enviar Solicitud de Afiliación";
        btn.disabled = false;
      }
    });
  }

  // --- Login ---
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      hideAlert();

      if (!supabase) {
        showAlert("Error: Supabase no está configurado en config.js");
        return;
      }

      const btn = document.getElementById("login-btn");
      btn.textContent = "Verificando...";
      btn.disabled = true;

      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;

      try {
        const { data: authData, error: authError } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          });

        if (authError) throw authError;

        const { data: perfil, error: perfilError } = await supabase
          .from("perfiles")
          .select("rol, agencia_id, activo")
          .eq("id", authData.user.id)
          .single();

        if (perfilError || !perfil || !perfil.activo) {
          throw new Error("Usuario sin perfil activo o sin autorización.");
        }

        const rol = String(perfil.rol || "").toLowerCase();

        // admin y operador → mismo panel admin
        if (rol === "admin" || rol === "operador") {
          window.location.href = "./src/modules/admin/dashboard-admin.html";
        } else if (rol === "agente") {
          window.location.href = "./src/modules/agency/dashboard-agency.html";
        } else {
          throw new Error("Rol de usuario no reconocido.");
        }
      } catch (err) {
        showAlert(err.message || "Credenciales inválidas o error de conexión.");
        btn.textContent = "Ingresar al Sistema";
        btn.disabled = false;
      }
    });
  }
});

// PRELOADER → 100% → botón Entrar → audio → login
function entrarAlSistema() {
  const preloader = document.getElementById("app-preloader");
  const authContainer = document.getElementById("main-auth-container");
  const audio = document.getElementById("preloader-audio");
  const enterBtn = document.getElementById("preloader-enter-btn");

  if (enterBtn) {
    enterBtn.disabled = true;
    enterBtn.textContent = "Entrando…";
  }

  if (audio) {
    try {
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    } catch (_) {}
  }

  if (preloader) preloader.classList.add("fade-out");
  if (authContainer) authContainer.style.opacity = "1";

  // Limpieza del nodo tras la transición
  setTimeout(() => {
    if (preloader && preloader.parentNode) {
      preloader.style.display = "none";
    }
  }, 750);
}

function iniciarPreloader() {
  const preloader = document.getElementById("app-preloader");
  const barFill = document.getElementById("preloader-fill");
  const textPercent = document.getElementById("preloader-text");
  const subtitle = document.getElementById("preloader-subtitle");
  const progressBlock = document.getElementById("preloader-progress-block");
  const enterBtn = document.getElementById("preloader-enter-btn");
  const authContainer = document.getElementById("main-auth-container");

  if (!preloader || !barFill) {
    if (authContainer) authContainer.style.opacity = "1";
    return;
  }

  // Por si el auth ya estaba oculto
  if (authContainer) authContainer.style.opacity = "0";

  let progreso = 0;
  const intervalo = setInterval(() => {
    progreso += Math.floor(Math.random() * 10) + 4;

    if (progreso >= 100) {
      progreso = 100;
      clearInterval(intervalo);

      barFill.style.width = "100%";
      if (textPercent) textPercent.textContent = "100%";
      if (subtitle) subtitle.textContent = "Listo";

      // Oculta barra y muestra botón
      setTimeout(() => {
        if (progressBlock) progressBlock.classList.add("is-done");
        if (subtitle) subtitle.textContent = "Sistema listo para ingresar";
        if (enterBtn) {
          enterBtn.hidden = false;
          enterBtn.disabled = false;
          enterBtn.textContent = "Entrar al sistema";
          enterBtn.focus();
        }
      }, 280);
    } else {
      barFill.style.width = `${progreso}%`;
      if (textPercent) textPercent.textContent = `${progreso}%`;
    }
  }, 90);

  if (enterBtn) {
    enterBtn.addEventListener("click", entrarAlSistema);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciarPreloader);
} else {
  iniciarPreloader();
}
