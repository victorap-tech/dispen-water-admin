// src/AdminPanel.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

// 🔗 Backend fijo en Railway
const API_URL = "https://web-production-e7d2.up.railway.app".replace(/\/$/, "");

// Admin-secret básico guardado en sessionStorage
const getAdminSecret = () => sessionStorage.getItem("adminSecret") || "";
const setAdminSecret = (s) => sessionStorage.setItem("adminSecret", s || "");

// ========================
// HELPERS FETCH
// ========================
async function apiGet(path) {
  const r = await fetch(`${API_URL}${path}`, {
    headers: { "x-admin-secret": getAdminSecret() },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`GET ${path} → ${r.status} ${t}`);
  }
  return r.json();
}

async function apiJson(method, path, body) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": getAdminSecret(),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${method} ${path} → ${r.status} ${t}`);
  }
  return r.status === 204 ? { ok: true } : r.json();
}

// ========================
// HELPERS VARIOS
// ========================
const prettyMoney = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(Number(n || 0));

const fmtDate = (s) => (s ? new Date(s).toLocaleString() : "—");

// Normaliza a 2 slots (1 = fría, 2 = caliente)
function normalizeTwo(products) {
  const map = {};
  (products || []).forEach((p) => (map[p.slot] = p));
  const arr = [];
  for (let s = 1; s <= 2; s++) {
    arr.push(
      map[s] || {
        id: null,
        nombre: s === 1 ? "Agua fría" : "Agua caliente",
        precio: "",
        slot: s,
        habilitado: false,
        __placeholder: true,
      }
    );
  }
  return arr;
}

// ========================
// COMPONENTE PRINCIPAL
// ========================
export default function AdminPanel() {
  const [authOk, setAuthOk] = useState(!!getAdminSecret());
  const [checkingAuth, setCheckingAuth] = useState(false);

  const [mpMode, setMpMode] = useState("test");
  const live = mpMode === "live";

  // ⚠️ Backend actual: { vinculado: bool, user_id: "123..." }
  const [mpStatus, setMpStatus] = useState({ vinculado: false, user_id: "" });

  const [dispensers, setDispensers] = useState([]);
  const [slotsByDisp, setSlotsByDisp] = useState({});
  const [expanded, setExpanded] = useState({});
  const editRef = useRef({});

  const [pagos, setPagos] = useState([]);
  const pagosTimer = useRef(null);

  const [qrLink, setQrLink] = useState("");
  const [showQR, setShowQR] = useState(false);

  // ========================
  // MERCADOPAGO – OAUTH
  // ========================
  const loadOAuthStatus = async () => {
    try {
      const data = await apiGet("/api/mp/oauth/status");
      setMpStatus(data || {});
    } catch (e) {
      console.warn("oauth/status error", e);
    }
  };

  const iniciarVinculacion = async () => {
    try {
      const r = await apiGet("/api/mp/oauth/init");
      const url = r.url || r.auth_url;
      if (!url) return alert("No se pudo obtener URL de autorización.");
      window.open(url, "_blank");
    } catch (e) {
      alert("Error iniciando OAuth: " + e.message);
    }
  };

  const desvincular = async () => {
    if (!window.confirm("¿Desvincular la cuenta de MercadoPago?")) return;
    try {
      await apiJson("POST", "/api/mp/oauth/unlink", {});
      await loadOAuthStatus();
      alert("Cuenta MercadoPago desvinculada correctamente.");
    } catch (e) {
      alert("Error desvinculando: " + e.message);
    }
  };

  // ========================
  // LOGIN ADMIN
  // ========================
  const promptPassword = async () => {
    const pwd = window.prompt("Ingresá la contraseña de admin:");
    if (!pwd) return false;

    setAdminSecret(pwd);
    setCheckingAuth(true);

    try {
      const r = await fetch(`${API_URL}/api/dispensers`, {
        headers: { "x-admin-secret": pwd },
      });
      if (!r.ok) throw new Error("auth_failed");
      setAuthOk(true);
      return true;
    } catch {
      alert("Contraseña inválida o backend inaccesible.");
      setAdminSecret("");
      setAuthOk(false);
      return false;
    } finally {
      setCheckingAuth(false);
    }
  };

  // ========================
  // CONFIG MP (modo test/live)
  // ========================
  const loadConfig = async () => {
    try {
      const c = await apiGet("/api/config");
      setMpMode((c?.mp_mode || "test").toLowerCase());
    } catch (e) {
      console.warn("config error", e);
    }
  };

  const toggleMode = async () => {
    try {
      await apiJson("POST", "/api/mp/mode", {
        mode: live ? "test" : "live",
      });
      await loadConfig();
    } catch (e) {
      alert(e.message);
    }
  };

  // ========================
  // DISPENSERS
  // ========================
  const loadDispensers = async () => {
    const ds = await apiGet("/api/dispensers");
    setDispensers(ds || []);
    const ex = {};
    (ds || []).forEach((d, i) => (ex[d.id] = i === 0)); // el primero abierto
    setExpanded(ex);
  };

  // Botón "Agregar dispenser"
  const crearDispenser = async () => {
    try {
      const res = await apiJson("POST", "/api/dispensers", {});
      await loadDispensers();
      alert(
        `Dispenser creado: ${
          res?.dispenser?.nombre || res?.dispenser?.device_id || "nuevo"
        }`
      );
    } catch (e) {
      alert("Error creando dispenser: " + e.message);
    }
  };

  const loadProductosOf = async (dispId) => {
    try {
      const data = await apiGet(`/api/productos?dispenser_id=${dispId}`);
      const two = normalizeTwo(data);

      // Evitar pisar cambios mientras se edita
      const prefix = `${dispId}-`;
      const editing = Object.keys(editRef.current).some(
        (k) => k.startsWith(prefix) && editRef.current[k]
      );
      if (!editing) {
        setSlotsByDisp((prev) => ({
          ...prev,
          [dispId]: two,
        }));
      }
    } catch (e) {
      console.warn("loadProductosOf error", e);
    }
  };

  const loadAllSlots = async () => {
    await Promise.all((dispensers || []).map((d) => loadProductosOf(d.id)));
  };

  const loadPagos = async () => {
    try {
      const data = await apiGet(`/api/pagos?limit=10`);
      setPagos(data || []);
    } catch (e) {
      console.warn("loadPagos error", e);
    }
  };

  // ========================
  // EFECTOS
  // ========================
  useEffect(() => {
    if (!authOk) return;
    (async () => {
      await Promise.all([loadConfig(), loadOAuthStatus(), loadDispensers()]);
    })();
    return () => pagosTimer.current && clearInterval(pagosTimer.current);
  }, [authOk]);

  useEffect(() => {
    if (!authOk || (dispensers || []).length === 0) return;
    loadAllSlots();
    loadPagos();
    pagosTimer.current = setInterval(() => loadPagos(), 5000);
  }, [dispensers.length, authOk]);

  const setEditing = (dispId, slot, v) => {
    editRef.current[`${dispId}-${slot}`] = v;
  };

  const updateSlotField = (dispId, slot, field, value) => {
    setSlotsByDisp((prev) => {
      const arr = prev[dispId] ? [...prev[dispId]] : [];
      const idx = slot - 1;
      arr[idx] = { ...arr[idx], [field]: value };
      return { ...prev, [dispId]: arr };
    });
  };

  // ---------------------
  // Guardar producto
  // ---------------------
  const saveSlot = (disp, slotIdx) => async () => {
    const slotNum = slotIdx + 1;
    const row = (slotsByDisp[disp.id] || [])[slotIdx];
    if (!row) return;

    try {
      const payload = {
        nombre: String(row.nombre || "").trim(),
        precio: Number(row.precio || 0),
        habilitado: !!row.habilitado,
        slot: slotNum,
      };

      if (!payload.nombre) return alert("Ingresá un nombre");
      if (!payload.precio || payload.precio <= 0)
        return alert("Ingresá un precio mayor a 0");

      let res;
      if (row.__placeholder || !row.id) {
        // crear producto
        res = await apiJson("POST", "/api/productos", {
          ...payload,
          dispenser_id: disp.id,
        });
      } else {
        // actualizar producto
        res = await apiJson("PUT", `/api/productos/${row.id}`, payload);
      }

      const p = res?.producto;
      if (p) {
        setSlotsByDisp((prev) => {
          const arr = [...(prev[disp.id] || [])];
          arr[slotIdx] = p;
          return { ...prev, [disp.id]: arr };
        });
      }

      alert("Guardado");
    } catch (e) {
      alert(e.message);
    } finally {
      await loadProductosOf(disp.id);
      setEditing(disp.id, slotNum, false);
    }
  };

  // ---------------------
  // Toggle habilitado
  // ---------------------
  const toggleHabilitado = (disp, slotIdx) => async (checked) => {
    const row = (slotsByDisp[disp.id] || [])[slotIdx];
    if (!row?.id) return alert("Primero guardá el producto");

    updateSlotField(disp.id, slotIdx + 1, "habilitado", checked);

    try {
      const res = await apiJson("PUT", `/api/productos/${row.id}`, {
        habilitado: !!checked,
      });

      const p = res?.producto;
      if (p) {
        setSlotsByDisp((prev) => {
          const arr = [...(prev[disp.id] || [])];
          arr[slotIdx] = p;
          return { ...prev, [disp.id]: arr };
        });
      }
    } catch (e) {
      console.warn("toggleHabilitado error", e);
    }
  };

  // ---------------------
  // Mostrar QR
  // ---------------------
  const mostrarQR = (row) => async () => {
    if (!row?.id) return alert("Guardá primero el producto");
    try {
      const r = await apiJson("POST", "/api/pagos/preferencia", {
        product_id: row.id,
      });
      if (!r.ok || !r.link) return alert("Error creando link de pago");
      setQrLink(r.link);
      setShowQR(true);
    } catch (e) {
      alert(e.message);
    }
  };

  const qrImg = useMemo(() => {
    if (!qrLink) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
      qrLink
    )}`;
  }, [qrLink]);

  // ========================
  // LOGIN VIEW
  // ========================
  if (!authOk)
    return (
      <div style={styles.page}>
        <div style={{ ...styles.card, maxWidth: 460, margin: "100px auto" }}>
          <h1 style={styles.title}>Dispen-Agua · Admin</h1>
          <button
            style={{ ...styles.primaryBtn, marginTop: 12, width: "100%" }}
            onClick={promptPassword}
            disabled={checkingAuth}
          >
            {checkingAuth ? "Ingresando…" : "Ingresar"}
          </button>
        </div>
      </div>
    );

  // ========================
  // PANEL PRINCIPAL
  // ========================
  return (
    <div style={styles.page}>
      {/* HEADER */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Administración Dispen-Agua</h1>
          <div style={styles.subtitle}>
            Backend: <code>{API_URL}</code>
          </div>

          {/* Estado de MP */}
          <div style={{ marginTop: 6, fontSize: 13 }}>
            <b>MercadoPago:</b>{" "}
            {mpStatus.vinculado ? (
              <span style={{ color: "#10b981", fontWeight: 700 }}>
                Vinculado (user_id: {mpStatus.user_id || "?"})
              </span>
            ) : (
              <span style={{ color: "#ef4444", fontWeight: 700 }}>
                No vinculado
              </span>
            )}
          </div>
        </div>

        {/* ACCIONES HEADER */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={styles.secondaryBtn} onClick={crearDispenser}>
            + Agregar dispenser
          </button>

          <button style={styles.secondaryBtn} onClick={iniciarVinculacion}>
            Vincular MP
          </button>
          <button style={styles.dangerBtn} onClick={desvincular}>
            Desvincular
          </button>

          <span
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              background: live ? "#10b981" : "#f59e0b",
              fontWeight: 800,
            }}
          >
            {live ? "PROD" : "TEST"}
          </span>
          <button style={styles.secondaryBtn} onClick={toggleMode}>
            Cambiar modo
          </button>
        </div>
      </header>

      {/* DISPENSERS */}
      {dispensers.map((disp) => {
        const rows = slotsByDisp[disp.id] || normalizeTwo([]);
        return (
          <section key={disp.id} style={styles.card}>
            <div
              style={styles.dispHeader}
              onClick={() =>
                setExpanded((e) => ({ ...e, [disp.id]: !e[disp.id] }))
              }
            >
              <div style={styles.dispTitle}>
                <span style={styles.dispBadge}>{disp.device_id}</span>
                <b>{disp.nombre}</b>
              </div>
            </div>

            {expanded[disp.id] && (
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Nombre</th>
                      <th>Precio</th>
                      <th>Activo</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((row, idx) => {
                      const slotNum = idx + 1;
                      return (
                        <tr key={`${disp.id}-${slotNum}`}>
                          <td>{slotNum}</td>

                          <td>
                            <input
                              style={styles.inputInline}
                              value={row.nombre}
                              onChange={(e) =>
                                updateSlotField(
                                  disp.id,
                                  slotNum,
                                  "nombre",
                                  e.target.value
                                )
                              }
                            />
                          </td>

                          <td>
                            <input
                              style={styles.inputInline}
                              type="number"
                              value={row.precio}
                              onChange={(e) =>
                                updateSlotField(
                                  disp.id,
                                  slotNum,
                                  "precio",
                                  e.target.value
                                )
                              }
                            />
                          </td>

                          <td>
                            <Toggle
                              checked={!!row.habilitado}
                              onChange={(v) => toggleHabilitado(disp, idx)(v)}
                            />
                          </td>

                          <td>
                            <button
                              style={styles.primaryBtn}
                              onClick={saveSlot(disp, idx)}
                            >
                              Guardar
                            </button>

                            <button
                              style={styles.qrBtn}
                              onClick={mostrarQR(row)}
                            >
                              QR
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {/* PAGOS */}
      <section style={styles.card}>
        <h2 style={styles.h2}>Pagos recientes</h2>

        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>mp_payment_id</th>
                <th>Estado</th>
                <th>Monto</th>
                <th>Slot</th>
                <th>Producto</th>
                <th>Device</th>
                <th>Fecha</th>
                <th>Reintentar</th>
              </tr>
            </thead>

            <tbody>
              {pagos.map((p) => {
                const puede = p.estado === "approved" && !p.dispensado;
                return (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{p.mp_payment_id}</td>
                    <td>{p.estado}</td>
                    <td>{prettyMoney(p.monto)}</td>
                    <td>{p.slot_id}</td>
                    <td>{p.producto}</td>
                    <td>{p.device_id}</td>
                    <td>{fmtDate(p.created_at)}</td>
                    <td>
                      <button
                        style={{
                          ...styles.secondaryBtn,
                          opacity: puede ? 1 : 0.5,
                        }}
                        disabled={!puede}
                        onClick={() =>
                          apiJson("POST", `/api/pagos/${p.id}/reenviar`).then(
                            (r) => alert(r.msg || "OK")
                          )
                        }
                      >
                        ↻
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* MODAL QR */}
      {showQR && (
        <div
          style={styles.modalBackdrop}
          onClick={() => setShowQR(false)}
        >
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>Link de pago</h3>
            <p
              style={{
                wordBreak: "break-all",
                fontSize: 13,
                background: "#020617",
                padding: 8,
                borderRadius: 8,
              }}
            >
              {qrLink}
            </p>
            {qrImg && (
              <img
                src={qrImg}
                alt="QR"
                style={{ width: 220, height: 220, borderRadius: 8 }}
              />
            )}
            <button
              style={{ ...styles.primaryBtn, marginTop: 12 }}
              onClick={() => setShowQR(false)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================
// COMPONENTE TOGGLE
// ========================
function Toggle({ checked, onChange }) {
  return (
    <label style={styles.switch}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ display: "none" }}
      />
      <span
        style={{
          ...styles.slider,
          background: checked ? "#10b981" : "#374151",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 22 : 2,
            width: 18,
            height: 18,
            borderRadius: "999px",
            background: "#0b1120",
            transition: ".2s",
          }}
        />
      </span>
    </label>
  );
}

// ========================
// STYLES
// ========================
const styles = {
  page: {
    background: "#0b1220",
    color: "#e5e7eb",
    minHeight: "100vh",
    fontFamily: "Inter, system-ui",
    padding: 24,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 16,
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
  },
  title: { margin: 0, fontSize: 22, fontWeight: 800 },
  subtitle: { fontSize: 12, opacity: 0.7 },
  h2: { fontSize: 18, marginBottom: 12 },

  card: {
    background: "rgba(255,255,255,0.04)",
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    marginBottom: 16,
  },

  primaryBtn: {
    background: "#10b981",
    padding: "8px 12px",
    border: "none",
    borderRadius: 10,
    color: "#06251d",
    fontWeight: 700,
    cursor: "pointer",
  },

  secondaryBtn: {
    background: "#1f2937",
    padding: "8px 12px",
    border: "1px solid #374151",
    borderRadius: 10,
    color: "#e5e7eb",
    cursor: "pointer",
  },

  dangerBtn: {
    background: "#ef4444",
    padding: "8px 12px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    color: "#2a0a0a",
    fontWeight: 700,
  },

  qrBtn: {
    background: "#3b82f6",
    padding: "8px 10px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    color: "#061528",
    fontWeight: 700,
    marginLeft: 8,
  },

  inputInline: {
    width: "100%",
    padding: "6px 8px",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 8,
    color: "#e5e7eb",
    outline: "none",
  },

  table: {
    width: "100%",
    borderSpacing: 0,
    fontSize: 13,
  },

  dispHeader: { cursor: "pointer" },
  dispTitle: { display: "flex", gap: 8, alignItems: "center" },
  dispBadge: {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    background: "#1f2937",
    border: "1px solid #374151",
  },

  switch: { position: "relative", width: 44, height: 24, display: "inline-block" },
  slider: {
    position: "absolute",
    inset: 0,
    borderRadius: 999,
    transition: ".2s",
  },

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "grid",
    placeItems: "center",
    zIndex: 20,
  },
  modal: {
    background: "#020617",
    padding: 22,
    borderRadius: 16,
    maxWidth: 480,
    width: "90%",
    boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
  },
};
