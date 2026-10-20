// Mide pantallas de SPMM con Chrome headless por el protocolo de DevTools (lo mismo que
// usa el MCP de Chrome DevTools, sin instalar nada): red, JS, tiempo de CPU, tareas
// largas y cuántos componentes de React se dibujan.
//
// Uso: node medir_pantallas.mjs <base http://localhost:3107> <salida.json> [rutas...]
//   CPU=4 (por defecto) frena la CPU 4x, como una PC vieja del taller.
//   ESCENARIOS=1 corre además las interacciones (volver a la pestaña, tipear en el buscador).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://localhost:3107";
const SALIDA = process.argv[3] || "medicion.json";
const RUTAS = process.argv.slice(4).length ? process.argv.slice(4) : [
  "/dashboard", "/operaciones", "/planificacion", "/recursos", "/materia-prima",
  "/planos", "/auditoria", "/configuracion", "/clientes", "/no-conformidades", "/novedades",
];
const CPU = Number(process.env.CPU || 4);
const PUERTO = 9300 + Math.floor(Math.random() * 500);
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const perfil = mkdtempSync(join(tmpdir(), "spmm-medir-"));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--disable-background-networking", "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(url)).json(); } catch { await esperar(200); }
  }
  throw new Error("Chrome no levantó");
}

const lista = await json(`http://127.0.0.1:${PUERTO}/json/list`);
const pagina = lista.find((t) => t.type === "page");
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let sec = 0;
const pendientes = new Map();
const oyentes = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendientes.has(m.id)) {
    const { ok, mal } = pendientes.get(m.id);
    pendientes.delete(m.id);
    m.error ? mal(new Error(JSON.stringify(m.error))) : ok(m.result);
  } else if (m.method) {
    for (const f of oyentes) f(m);
  }
});
const cdp = (method, params = {}) => new Promise((ok, mal) => {
  const id = ++sec;
  pendientes.set(id, { ok, mal });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluar = async (expr) => {
  const r = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
  return r.result.value;
};

// Gancho de React DevTools: cuenta commits y componentes que se dibujaron en cada uno
// (fibra con el flag PerformedWork). Anda en el build de producción.
const GANCHO = `
(() => {
  const st = { commits: 0, renders: 0, porNombre: {} };
  window.__medir = st;
  const COMPONENTE = new Set([0, 1, 11, 14, 15]);
  function nombre(f) { const t = f.type; return (t && (t.displayName || t.name)) || (t && t.render && (t.render.displayName || t.render.name)) || (t && t.type && (t.type.displayName || t.type.name)) || "?"; }
  function recorrer(f) {
    while (f) {
      if (COMPONENTE.has(f.tag) && (f.flags & 1)) {
        st.renders++;
        const n = nombre(f); st.porNombre[n] = (st.porNombre[n] || 0) + 1;
      }
      if (f.child) recorrer(f.child);
      f = f.sibling;
    }
  }
  let id = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(r) { id++; this.renderers.set(id, r); return id; },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) { st.commits++; try { recorrer(root.current.child); } catch (e) {} },
    setStrictMode() {},
  };
  window.__largas = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__largas.push(e.duration); })
      .observe({ type: "longtask", buffered: true });
  } catch (e) {}
  window.__lcp = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; })
      .observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {}
})();`;

// JWT de mentira (el front sólo lee `exp`) y un usuario con nombre Y apellido (sin
// apellido el Sidebar tumba la app). Sin `permisos` = acceso total, como un backend viejo.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "banco", exp: 4102444800 })}.firma`;
const USUARIO = { id_usuario: 1, username: "banco", email: "banco@local", nombre: "Banco", apellido: "Medicion", rol: "admin", activo: true };

await cdp("Page.enable");
await cdp("Network.enable");
await cdp("Performance.enable");
await cdp("Runtime.enable");
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: GANCHO });
if (CPU > 1) await cdp("Emulation.setCPUThrottlingRate", { rate: CPU });
// Sin el prefetch de <Link> (RSC + JS de las otras pantallas): se mide lo que cuesta
// ESTA pantalla. El prefetch se mide aparte con PREFETCH=1.
if (process.env.PREFETCH !== "1") await cdp("Network.setBlockedURLs", { urls: ["*_rsc=*"] });

// Red: pedidos a la API y bytes de JS, por pantalla.
let red = new Map();
let tLoad = null;
oyentes.push((m) => {
  if (m.method === "Page.loadEventFired") tLoad = m.params.timestamp;
  if (m.method === "Network.requestWillBeSent") {
    red.set(m.params.requestId, { url: m.params.request.url, metodo: m.params.request.method, tipo: m.params.type, t0: m.params.timestamp, bytes: 0, fin: null, status: null });
  } else if (m.method === "Network.responseReceived") {
    const r = red.get(m.params.requestId); if (r) r.status = m.params.response.status;
  } else if (m.method === "Network.loadingFinished") {
    const r = red.get(m.params.requestId); if (r) { r.bytes = m.params.encodedDataLength; r.fin = m.params.timestamp; }
  } else if (m.method === "Network.loadingFailed") {
    const r = red.get(m.params.requestId); if (r) { r.fin = m.params.timestamp; r.fallo = m.params.errorText; }
  }
});

async function quieto(maxMs = 45000, quietoMs = 2500) {
  const t0 = Date.now(); let ultimo = Date.now(); let antes = -1;
  while (Date.now() - t0 < maxMs) {
    await esperar(250);
    const vivos = [...red.values()].filter((r) => r.fin === null).length;
    const total = red.size;
    if (vivos > 0 || total !== antes) { ultimo = Date.now(); antes = total; }
    if (Date.now() - ultimo > quietoMs) return Date.now() - t0;
  }
  return maxMs;
}

const metricas = async () => Object.fromEntries((await cdp("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));

function resumenRed() {
  const filas = [...red.values()];
  const api = filas.filter((r) => /:801\d\//.test(r.url) && r.metodo !== "OPTIONS");
  const porUrl = {};
  for (const r of api) { const u = r.url.replace(/^https?:\/\/[^/]+/, ""); porUrl[u] = (porUrl[u] || 0) + 1; }
  const repetidos = Object.fromEntries(Object.entries(porUrl).filter(([, n]) => n > 1));
  const js = filas.filter((r) => r.url.includes("/_next/static/") && r.url.endsWith(".js"));
  // El JS pedido antes del evento load es el que hay que bajar y ejecutar para que la
  // pantalla ande; lo que se pide después es precarga en segundo plano (o lo que se abre).
  const jsArranque = tLoad === null ? js : js.filter((r) => r.t0 <= tLoad);
  const css = filas.filter((r) => r.url.includes(".css"));
  const fuentes = filas.filter((r) => r.url.includes(".woff"));
  return {
    api_pedidos: api.length, api_distintos: Object.keys(porUrl).length, api_repetidos: repetidos,
    api_kb: Math.round(api.reduce((a, r) => a + r.bytes, 0) / 1024),
    js_archivos: js.length, js_kb: Math.round(js.reduce((a, r) => a + r.bytes, 0) / 1024),
    js_arranque_kb: Math.round(jsArranque.reduce((a, r) => a + r.bytes, 0) / 1024),
    css_kb: Math.round(css.reduce((a, r) => a + r.bytes, 0) / 1024),
    fuentes: fuentes.length, fuentes_kb: Math.round(fuentes.reduce((a, r) => a + r.bytes, 0) / 1024),
    total_pedidos: filas.length,
    api_urls: porUrl,
  };
}

// Primero el origen, para plantar la sesión.
await cdp("Page.navigate", { url: `${BASE}/login` });
await esperar(3000);
await evaluar(`localStorage.setItem('access_token', ${JSON.stringify(TOKEN)}); localStorage.setItem('user', ${JSON.stringify(JSON.stringify(USUARIO))}); localStorage.setItem('spmm_aviso_visto', 'x'); localStorage.setItem('spmm_aviso_leido', 'x'); 1`);

const resultados = {};
for (const ruta of RUTAS) {
  for (const intento of [0, 1]) { // la primera vuelta calienta el caché de Next/Chrome; se mide la segunda
    red = new Map();
    tLoad = null;
    await cdp("Network.clearBrowserCache");
    const m0 = await metricas();
    const t0 = Date.now();
    await cdp("Page.navigate", { url: `${BASE}${ruta}` });
    const espera = await quieto();
    const m1 = await metricas();
    const r = await evaluar(`(() => ({ commits: window.__medir?.commits, renders: window.__medir?.renders,
      top: Object.entries(window.__medir?.porNombre || {}).sort((a,b)=>b[1]-a[1]).slice(0,8),
      largas: (window.__largas||[]).length, tbt: Math.round((window.__largas||[]).reduce((a,d)=>a+Math.max(0,d-50),0)),
      lcp: Math.round(window.__lcp||0), dom: document.getElementsByTagName('*').length,
      heapMB: Math.round(performance.memory ? performance.memory.usedJSHeapSize/1048576 : 0),
      url: location.pathname }))()`);
    if (intento === 0) continue;
    resultados[ruta] = {
      ms_hasta_quieto: Date.now() - t0 - 2500, espera_ms: espera,
      // Las métricas de Performance arrancan de cero con cada documento nuevo.
      cpu_script_ms: Math.round(m1.ScriptDuration * 1000),
      cpu_tareas_ms: Math.round(m1.TaskDuration * 1000),
      layout_ms: Math.round(m1.LayoutDuration * 1000),
      estilos_ms: Math.round(m1.RecalcStyleDuration * 1000),
      ...r, ...resumenRed(),
    };
    console.error(`${ruta}: ${resultados[ruta].js_kb}K JS (${resultados[ruta].js_arranque_kb}K hasta load), ${resultados[ruta].api_pedidos} pedidos API (${Object.keys(resultados[ruta].api_repetidos).length} repetidos), script ${resultados[ruta].cpu_script_ms} ms, TBT ${r.tbt} ms, ${r.renders} renders/${r.commits} commits, LCP ${r.lcp}`);
  }

  if (process.env.ESCENARIOS === "1") {
    // 1) Volver a la pestaña: AuthContext vuelve a pedir /auth/me.
    await evaluar(`window.__medir.commits = 0; window.__medir.renders = 0; window.__medir.porNombre = {}; window.__largas = []; 1`);
    red = new Map();
    const m0 = await metricas();
    await evaluar(`Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); 1`);
    await quieto(15000, 2000);
    const m1 = await metricas();
    const v = await evaluar(`({ commits: window.__medir.commits, renders: window.__medir.renders, top: Object.entries(window.__medir.porNombre).sort((a,b)=>b[1]-a[1]).slice(0,6), tbt: Math.round(window.__largas.reduce((a,d)=>a+Math.max(0,d-50),0)) })`);
    resultados[ruta].al_volver = { ...v, cpu_script_ms: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), api: resumenRed().api_urls };
    console.error(`   al volver a la pestaña: ${v.renders} renders/${v.commits} commits, script ${resultados[ruta].al_volver.cpu_script_ms} ms`);
    // 2) Quieto 10 s: qué corre solo (timers, intervalos).
    await evaluar(`window.__medir.commits = 0; window.__medir.renders = 0; window.__medir.porNombre = {}; 1`);
    red = new Map();
    const q0 = await metricas();
    await esperar(10000);
    const q1 = await metricas();
    const q = await evaluar(`({ commits: window.__medir.commits, renders: window.__medir.renders, top: Object.entries(window.__medir.porNombre).sort((a,b)=>b[1]-a[1]).slice(0,6) })`);
    resultados[ruta].quieto_10s = { ...q, cpu_script_ms: Math.round((q1.ScriptDuration - q0.ScriptDuration) * 1000), cpu_tareas_ms: Math.round((q1.TaskDuration - q0.TaskDuration) * 1000), pedidos: resumenRed().total_pedidos };
    console.error(`   10 s sin tocar nada: ${q.renders} renders, script ${resultados[ruta].quieto_10s.cpu_script_ms} ms, tareas ${resultados[ruta].quieto_10s.cpu_tareas_ms} ms`);
  }
}

writeFileSync(SALIDA, JSON.stringify({ base: BASE, cpu: CPU, fecha: new Date().toISOString(), resultados }, null, 1));
ws.close();
chrome.kill();
await esperar(500);
try { rmSync(perfil, { recursive: true, force: true }); } catch {}
console.error("listo:", SALIDA);
