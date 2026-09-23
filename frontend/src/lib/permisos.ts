/**
 * Permisos por rol, área y sección (RF-24), del lado de la pantalla.
 *
 * DE DÓNDE SALE
 *
 * Es el modelo de usuarios y permisos de Don Joaquín, portado. Allá la pantalla recibe
 * los permisos ya resueltos por el servidor y decide qué mostrar con tres piezas:
 *
 *     DJ src/lib/permisos-nivel.ts                 -> Nivel, NIVEL_RANK
 *     DJ src/lib/auth.ts (hasArea / hasSeccion)    -> puede, puedeSeccion
 *     DJ components/layout/nav-items.ts            -> MENU, puedeVerItem (puedeVerNodo)
 *     DJ src/lib/ruta-inicio.ts                    -> rutaInicio
 *     DJ usuarios.pantalla_inicio (RF-28)          -> PANTALLAS_DE_INICIO, leerPantallaInicio
 *     DJ usuarios/sidebar-tree.ts (+ su test)      -> ARBOL, seccionesDelArbol
 *
 * Acá igual: los permisos los RESUELVE EL BACKEND (backend/core/permisos.py, contra la
 * base, en cada pedido) y viajan ya resueltos en la respuesta del login y de /auth/me:
 * `{ rol, es_admin, admin_permanente, areas: {area: nivel}, secciones: {seccion: nivel} }`.
 * La pantalla NO recalcula reglas (overrides, vencimientos, confidenciales): sólo mira
 * el nivel que le mandaron. Lo que se esconde acá es comodidad; el que bloquea de verdad
 * es el backend, que contesta 403 aunque alguien llegue a apretar el botón.
 *
 * SIN PERMISOS = ACCESO TOTAL
 *
 * Si los permisos NO vinieron —un backend de antes de RF-24, que es lo que corre en
 * producción hasta que Julián deploye a mano— la pantalla se comporta como siempre:
 * todo visible, todo editable. Hoy todos los usuarios son admin, así que es exactamente
 * lo que el backend nuevo también diría. Lo que NUNCA hace esta pantalla es esconder
 * todo porque falte un campo: un permiso que no se entiende no cierra la app.
 *
 * Este archivo no importa nada (ni React ni `@/`): se compila solo y lo prueba
 * backend/tests/test_permisos_front.py, que además exige que el catálogo de acá sea el
 * mismo que el del backend.
 */

// ─────────────────────────── vocabulario ───────────────────────────

export type Nivel = "none" | "read" | "write" | "admin";

export const NIVELES: Nivel[] = ["none", "read", "write", "admin"];

export const NIVEL_RANK: Record<Nivel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

export type AreaCodigo =
  | "dashboard"
  | "operaciones"
  | "planos"
  | "recursos"
  | "clientes"
  | "no_conformidades"
  | "auditoria"
  | "configuracion";

export type SeccionCodigo =
  | "dashboard_rendimiento"
  | "operaciones_ordenes"
  | "operaciones_planificador"
  | "operaciones_recurso_humano"
  | "operaciones_materia_prima"
  | "recursos_humano"
  | "recursos_maquinaria"
  | "recursos_procesos"
  | "recursos_rangos"
  | "recursos_sectores"
  | "auditoria_movimientos"
  | "auditoria_procesos"
  | "auditoria_planificacion"
  | "auditoria_ingresos"
  | "configuracion_usuarios";

export interface Area {
  codigo: AreaCodigo;
  nombre: string;
  orden: number;
}

export interface Seccion {
  codigo: SeccionCodigo;
  /** Área madre: de ahí hereda el nivel (salvo que sea confidencial). */
  area: AreaCodigo;
  nombre: string;
  orden: number;
  /** Cerrada para todo el que no sea admin salvo que se le otorgue a propósito. */
  confidencial: boolean;
}

// ─────────────────────────── catálogo ───────────────────────────
//
// ESPEJO de AREAS y SECCIONES de backend/core/permisos.py. Un test los compara campo por
// campo (código, nombre, área, orden, confidencial): si alguien agrega una sección de un
// lado y se olvida del otro, se pone rojo antes de llegar a producción.

export const AREAS: Area[] = [
  { codigo: "dashboard", nombre: "Dashboard", orden: 10 },
  { codigo: "operaciones", nombre: "Operaciones", orden: 20 },
  { codigo: "planos", nombre: "Planos", orden: 30 },
  { codigo: "recursos", nombre: "Recursos", orden: 40 },
  { codigo: "clientes", nombre: "Clientes", orden: 50 },
  { codigo: "no_conformidades", nombre: "No conformidades", orden: 60 },
  { codigo: "auditoria", nombre: "Auditoría", orden: 70 },
  { codigo: "configuracion", nombre: "Configuración", orden: 80 },
];

export const SECCIONES: Seccion[] = [
  { codigo: "dashboard_rendimiento", area: "dashboard", nombre: "Rendimiento por persona", orden: 10, confidencial: true },
  { codigo: "operaciones_ordenes", area: "operaciones", nombre: "Órdenes de trabajo", orden: 10, confidencial: false },
  { codigo: "operaciones_planificador", area: "operaciones", nombre: "Planificador", orden: 11, confidencial: false },
  { codigo: "operaciones_recurso_humano", area: "operaciones", nombre: "Recurso humano", orden: 12, confidencial: false },
  { codigo: "operaciones_materia_prima", area: "operaciones", nombre: "Materia prima", orden: 13, confidencial: false },
  { codigo: "recursos_humano", area: "recursos", nombre: "Recurso humano", orden: 10, confidencial: false },
  { codigo: "recursos_maquinaria", area: "recursos", nombre: "Recurso maquinaria", orden: 11, confidencial: false },
  { codigo: "recursos_procesos", area: "recursos", nombre: "Procesos", orden: 12, confidencial: false },
  { codigo: "recursos_rangos", area: "recursos", nombre: "Rangos", orden: 13, confidencial: false },
  { codigo: "recursos_sectores", area: "recursos", nombre: "Sectores", orden: 14, confidencial: false },
  { codigo: "auditoria_movimientos", area: "auditoria", nombre: "Todo lo que se hizo", orden: 10, confidencial: false },
  { codigo: "auditoria_procesos", area: "auditoria", nombre: "Pasos de las OT", orden: 11, confidencial: false },
  { codigo: "auditoria_planificacion", area: "auditoria", nombre: "Planificaciones", orden: 12, confidencial: false },
  // Ingresos (IP, navegador, intentos contra cada cuenta) y Actividad por persona.
  // Confidencial: no se abre por tener Auditoría (revisión del 23/09).
  { codigo: "auditoria_ingresos", area: "auditoria", nombre: "Ingresos y actividad por persona", orden: 13, confidencial: true },
  { codigo: "configuracion_usuarios", area: "configuracion", nombre: "Usuarios y permisos", orden: 10, confidencial: true },
];

const AREA_POR_CODIGO = new Map<string, Area>(AREAS.map((a) => [a.codigo, a]));
const SECCION_POR_CODIGO = new Map<string, Seccion>(SECCIONES.map((s) => [s.codigo, s]));

export function nombreDeArea(area: AreaCodigo): string {
  return AREA_POR_CODIGO.get(area)?.nombre ?? area;
}

export function nombreDeSeccion(seccion: SeccionCodigo): string {
  const s = SECCION_POR_CODIGO.get(seccion);
  return s ? `${s.nombre} (${nombreDeArea(s.area)})` : seccion;
}

// ─────────────────────────── los permisos que manda el backend ───────────────────────────

export interface Permisos {
  rol: string | null;
  es_admin: boolean;
  /** null = el backend no lo pudo leer (la columna todavía no existe en esa base). */
  admin_permanente: boolean | null;
  /**
   * Si maneja usuarios y permisos: admin y, si hay administradores permanentes, uno de
   * ellos (como DJ). null = el backend no lo manda (de antes del 23/09): lo que diga
   * `es_admin`, como siempre.
   */
  gestiona_usuarios: boolean | null;
  areas: Partial<Record<AreaCodigo, Nivel>>;
  secciones: Partial<Record<SeccionCodigo, Nivel>>;
}

function esNivel(x: unknown): x is Nivel {
  return typeof x === "string" && x in NIVEL_RANK;
}

function mapaDeNiveles(crudo: unknown): Record<string, Nivel> {
  const salida: Record<string, Nivel> = {};
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return salida;
  for (const [clave, valor] of Object.entries(crudo as Record<string, unknown>)) {
    // Un nivel que no se entiende vale «none», igual que en el backend (nivel_valido):
    // un permiso raro no abre nada. Pero la clave queda: así no se confunde con «no vino».
    salida[clave] = esNivel(valor) ? valor : "none";
  }
  return salida;
}

/**
 * Lee lo que vino en `permisos` (login o /auth/me). Devuelve null si no vino o no tiene
 * la forma esperada: null quiere decir ACCESO TOTAL, como antes de RF-24.
 *
 * Alcanza con que venga el mapa de áreas para tomarlo en serio. Sin él no hay cómo
 * decidir nada, y cerrar todo por un campo que falta es justo lo que no puede pasar.
 */
export function leerPermisos(crudo: unknown): Permisos | null {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  const p = crudo as Record<string, unknown>;
  if (!p.areas || typeof p.areas !== "object" || Array.isArray(p.areas)) return null;
  const rol = typeof p.rol === "string" ? p.rol : null;
  return {
    rol,
    es_admin: p.es_admin === true || rol === "admin",
    admin_permanente: typeof p.admin_permanente === "boolean" ? p.admin_permanente : null,
    gestiona_usuarios: typeof p.gestiona_usuarios === "boolean" ? p.gestiona_usuarios : null,
    areas: mapaDeNiveles(p.areas) as Permisos["areas"],
    secciones: mapaDeNiveles(p.secciones) as Permisos["secciones"],
  };
}

// ─────────────────────────── las preguntas ───────────────────────────

export function rango(nivel: Nivel | null | undefined): number {
  return nivel && esNivel(nivel) ? NIVEL_RANK[nivel] : 0;
}

export function alcanza(tiene: Nivel | null | undefined, pide: Nivel): boolean {
  return rango(tiene) >= NIVEL_RANK[pide];
}

/** El nivel efectivo en un área. Sin permisos (backend viejo) o admin: "admin". */
export function nivelDeArea(permisos: Permisos | null | undefined, area: AreaCodigo): Nivel {
  if (!permisos || permisos.es_admin) return "admin";
  return permisos.areas[area] ?? "none";
}

/**
 * El nivel efectivo en una sección, tal cual lo resolvió el backend.
 *
 * Si el backend no mandó ESA sección (es más viejo que esta pantalla y todavía no la
 * conoce) se aplica la regla de siempre en su versión más corta: una confidencial está
 * cerrada y una común hereda el área. Es lo que el backend diría sin overrides.
 */
export function nivelDeSeccion(permisos: Permisos | null | undefined, seccion: SeccionCodigo): Nivel {
  if (!permisos || permisos.es_admin) return "admin";
  const resuelto = permisos.secciones[seccion];
  if (resuelto) return resuelto;
  const info = SECCION_POR_CODIGO.get(seccion);
  if (!info || info.confidencial) return "none";
  return nivelDeArea(permisos, info.area);
}

/** ¿Llega a `nivel` en el área? (DJ: hasArea). Sin permisos, sí. */
export function puede(permisos: Permisos | null | undefined, area: AreaCodigo, nivel: Nivel = "read"): boolean {
  return alcanza(nivelDeArea(permisos, area), nivel);
}

/** ¿Llega a `nivel` en la sección? (DJ: hasSeccion). Sin permisos, sí. */
export function puedeSeccion(
  permisos: Permisos | null | undefined,
  seccion: SeccionCodigo,
  nivel: Nivel = "read",
): boolean {
  return alcanza(nivelDeSeccion(permisos, seccion), nivel);
}

// ─────────────────────────── el menú ───────────────────────────
//
// Los ítems de la barra lateral y qué pide cada uno para VERSE. Los íconos no van acá
// (este archivo no importa nada): los pone Sidebar.tsx por `href`.
//
// La regla es la de DJ (puedeVerNodo):
//   · un ítem con `solapas` se ve si se puede leer AL MENOS UNA (las solapas de
//     Operaciones, Recursos y Auditoría son secciones: el rol puede cerrar algunas);
//   · un ítem con `area`, si se puede leer el área;
//   · un ítem sin nada, lo ve todo el que entra.
//
// Configuración va sin permiso a propósito: adentro está «Mi cuenta» (cambiar la
// contraseña) y las notificaciones, que son de todos. Lo que tiene de restringido —la
// lista de usuarios— es una solapa y se esconde adentro.

export interface Requisito {
  area?: AreaCodigo;
  seccion?: SeccionCodigo;
  /** Alcanza con leer una. */
  solapas?: SeccionCodigo[];
}

export interface ItemMenu extends Requisito {
  href: string;
  nombre: string;
}

export const MENU: ItemMenu[] = [
  { href: "/dashboard", nombre: "Dashboard", area: "dashboard" },
  {
    href: "/operaciones",
    nombre: "Operaciones",
    area: "operaciones",
    solapas: ["operaciones_ordenes", "operaciones_planificador", "operaciones_recurso_humano", "operaciones_materia_prima"],
  },
  { href: "/planos", nombre: "Planos", area: "planos" },
  {
    href: "/recursos",
    nombre: "Recursos",
    area: "recursos",
    solapas: ["recursos_humano", "recursos_maquinaria", "recursos_procesos", "recursos_rangos", "recursos_sectores"],
  },
  { href: "/clientes", nombre: "Clientes", area: "clientes" },
  { href: "/configuracion", nombre: "Configuración" },
  { href: "/no-conformidades", nombre: "No conformidades", area: "no_conformidades" },
  {
    href: "/auditoria",
    nombre: "Auditoría",
    area: "auditoria",
    solapas: ["auditoria_movimientos", "auditoria_procesos", "auditoria_planificacion", "auditoria_ingresos"],
  },
  { href: "/novedades", nombre: "Novedades" },
];

/** ¿Cumple el requisito para LEER? Espejo de puedeVerNodo (DJ). */
export function cumple(permisos: Permisos | null | undefined, req: Requisito, nivel: Nivel = "read"): boolean {
  if (req.solapas && req.solapas.length > 0) {
    return req.solapas.some((s) => puedeSeccion(permisos, s, nivel));
  }
  if (req.seccion) return puedeSeccion(permisos, req.seccion, nivel);
  if (req.area) return puede(permisos, req.area, nivel);
  return true;
}

export function puedeVerItem(permisos: Permisos | null | undefined, item: ItemMenu): boolean {
  return cumple(permisos, item, "read");
}

export function menuVisible(permisos: Permisos | null | undefined): ItemMenu[] {
  return MENU.filter((item) => puedeVerItem(permisos, item));
}

// ─────────────────────────── las rutas ───────────────────────────
//
// Qué pide cada pantalla para ABRIRSE. Las del menú piden lo mismo que su ítem; las
// sueltas son páginas de la época de las pruebas que no están en el menú pero se abren
// escribiendo la dirección, y piden lo de la solapa que las reemplazó. Un test exige que
// toda carpeta con page.tsx de frontend/src/app esté en una de las tres listas.

export const RUTAS_SUELTAS: Record<string, Requisito> = {
  // Redirige a Operaciones (la solapa Órdenes de Trabajo).
  "/ordenes": { seccion: "operaciones_ordenes" },
  "/planificacion": { seccion: "operaciones_planificador" },
  "/operarios": { seccion: "recursos_humano" },
  "/procesos": { seccion: "recursos_procesos" },
  "/sectores": { seccion: "recursos_sectores" },
  "/prioridades": { area: "recursos" },
  // Los artículos no tienen pantalla que los edite; si la tienen, son un catálogo de
  // Recursos (así está en el mapa del backend).
  "/articulos": { area: "recursos" },
};

/** Sin permiso: las ve todo el que entra (o todavía no entró). */
export const RUTAS_LIBRES: string[] = ["/", "/login", "/configuracion", "/novedades"];

function coincide(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Lo que pide la pantalla de `pathname` para abrirse, o null si no pide nada (una libre,
 * o una ruta que no existe y va a dar 404 por su cuenta).
 */
export function requisitoDeRuta(pathname: string): Requisito | null {
  const ruta = (pathname || "/").split("?")[0].split("#")[0] || "/";
  for (const item of MENU) {
    if (coincide(ruta, item.href)) {
      const { href: _h, nombre: _n, ...req } = item;
      return req.area || req.seccion || req.solapas ? req : null;
    }
  }
  for (const [href, req] of Object.entries(RUTAS_SUELTAS)) {
    if (coincide(ruta, href)) return req;
  }
  return null;
}

export function puedeAbrirRuta(permisos: Permisos | null | undefined, pathname: string): boolean {
  const req = requisitoDeRuta(pathname);
  return req === null || cumple(permisos, req, "read");
}

/** El piso: Novedades no pide nada, así que la ve cualquiera con sesión. */
export const RUTA_ANCLA = "/novedades";

// ─────────────────────────── la pantalla de inicio (RF-28) ───────────────────────────
//
// «Personalizar el dashboard inicial por tipo de usuario» (SRS). Es la `pantalla_inicio`
// de Don Joaquín más una por ROL: el backend manda en el login y en /auth/me la que le
// toca a cada uno —la suya pisa la de su rol— ya resuelta, en `pantalla_inicio`. Se puede
// fijar cualquier pantalla del menú y sólo ésas (DJ: `puedeAbrir` mira que esté en el
// menú). ESPEJO de PANTALLAS_DE_INICIO de backend/core/permisos.py: un test compara las
// dos, requisitos incluidos.

export interface PantallaDeInicio {
  ruta: string;
  nombre: string;
}

export const PANTALLAS_DE_INICIO: PantallaDeInicio[] = MENU.map((i) => ({ ruta: i.href, nombre: i.nombre }));

export function nombreDePantalla(ruta: string | null | undefined): string | null {
  return PANTALLAS_DE_INICIO.find((p) => p.ruta === ruta)?.nombre ?? null;
}

/**
 * Lo que vino en `pantalla_inicio` (login, /auth/me, la lista de usuarios, la matriz):
 * una pantalla del menú, o null. Cualquier otra cosa —un backend viejo que no la manda,
 * una ruta que ya no está en el menú— es null: el inicio de siempre, nunca un 404.
 */
export function leerPantallaInicio(crudo: unknown): string | null {
  if (typeof crudo !== "string") return null;
  const ruta = crudo.trim();
  return PANTALLAS_DE_INICIO.some((p) => p.ruta === ruta) ? ruta : null;
}

/**
 * A qué pantalla va alguien cuando entra o cuando no puede quedarse donde está.
 * Espejo de rutaInicio (DJ ruta-inicio.ts), en orden de preferencia:
 *
 *   1. la que se le haya fijado (`pantallaFijada`, RF-28: la suya o la de su rol), si es
 *      una pantalla del menú y la puede abrir;
 *   2. la primera del menú que pueda ver (el Dashboard va primero: si no puede abrir la
 *      fijada, «cae al Dashboard»);
 *   3. Novedades, que no pide nada.
 *
 * El paso 1 se valida a propósito: una pantalla fijada que quedó vieja —le sacaron el
 * permiso y nadie la actualizó— mandaría a un cartel de «no tenés acceso» cada vez que
 * entra. SÓLO devuelve rutas que la persona puede abrir, así no hay rebotes.
 */
export function rutaInicio(permisos: Permisos | null | undefined, pantallaFijada?: string | null): string {
  const fijada = leerPantallaInicio(pantallaFijada);
  if (fijada && puedeAbrirRuta(permisos, fijada)) return fijada;
  for (const item of MENU) {
    if (puedeVerItem(permisos, item)) return item.href;
  }
  return RUTA_ANCLA;
}

// ─────────────────────────── las tarjetas del Dashboard (RF-28) ───────────────────────────
//
// El Dashboard resume las otras pantallas y cada tarjeta es de UN área: cada uno ve sólo
// las de las áreas que puede leer (el Operario, sin Clientes, no ve el ranking de
// clientes). Una tarjeta que no se ve TAMPOCO SE PIDE: el backend la contesta 403 y el
// aviso «No tenés permiso» saldría solo al abrir el Dashboard.
//
// ESPEJO de TARJETAS_DASHBOARD de backend/core/permisos_rutas.py, que exige lo mismo en
// cada ruta de la tarjeta. Un test compara las dos listas y, para cada rol, que la
// pantalla muestre exactamente las tarjetas cuyas rutas el backend le deja leer.
// Sin permisos (backend viejo) se ven todas, como siempre.

export type TarjetaCodigo =
  | "estado_ordenes"
  | "ordenes_criticas"
  | "incidencias_planos"
  | "rendimiento"
  | "timeline_entregas"
  | "top_articulos"
  | "top_clientes"
  | "distribucion_prioridades";

export interface TarjetaDashboard extends Requisito {
  codigo: TarjetaCodigo;
  nombre: string;
}

export const TARJETAS_DASHBOARD: TarjetaDashboard[] = [
  { codigo: "estado_ordenes", nombre: "Estado de las órdenes", area: "operaciones" },
  { codigo: "ordenes_criticas", nombre: "Órdenes críticas", area: "operaciones" },
  { codigo: "incidencias_planos", nombre: "Interpretación de planos", area: "no_conformidades" },
  { codigo: "rendimiento", nombre: "Rendimiento estimado vs. real", seccion: "dashboard_rendimiento" },
  { codigo: "timeline_entregas", nombre: "Próximas entregas", area: "operaciones" },
  { codigo: "top_articulos", nombre: "Artículos más producidos", area: "operaciones" },
  { codigo: "top_clientes", nombre: "Clientes con más órdenes", area: "clientes" },
  { codigo: "distribucion_prioridades", nombre: "Órdenes por prioridad", area: "operaciones" },
];

/** ¿Ve esa tarjeta del Dashboard? Sin permisos (backend viejo), sí. */
export function puedeVerTarjeta(permisos: Permisos | null | undefined, codigo: TarjetaCodigo): boolean {
  const t = TARJETAS_DASHBOARD.find((x) => x.codigo === codigo);
  return t ? cumple(permisos, t, "read") : false;
}

/** Las tarjetas que ve, en el orden del Dashboard. */
export function tarjetasVisibles(permisos: Permisos | null | undefined): TarjetaCodigo[] {
  return TARJETAS_DASHBOARD.filter((t) => cumple(permisos, t, "read")).map((t) => t.codigo);
}

// ─────────────────────────── el árbol (la pantalla de permisos) ───────────────────────────
//
// Espejo de sidebar-tree.ts (DJ): las secciones con la forma del menú —página y, adentro,
// sus solapas o lo sensible que tiene— para que el editor de la matriz, el de las
// confidenciales y el de los permisos por persona se vean y ordenen igual que la barra
// lateral. NO se deriva del menú porque es más fino: «Rendimiento por persona» no es una
// página, es una parte del Dashboard, y es justo lo que se otorga.
//
// Garantía (test_permisos_front.py): TODA sección del catálogo está acá exactamente una
// vez, y nada de acá está fuera del catálogo. Una sección que no se puede otorgar desde
// la pantalla es una parte del sistema que nadie más que el admin puede abrir.

export interface ArbolHoja {
  seccion: SeccionCodigo;
  nombre: string;
}

export interface ArbolPagina {
  area: AreaCodigo;
  nombre: string;
  secciones: ArbolHoja[];
}

export const ARBOL: ArbolPagina[] = [
  {
    area: "dashboard",
    nombre: "Dashboard",
    secciones: [{ seccion: "dashboard_rendimiento", nombre: "Rendimiento por persona" }],
  },
  {
    area: "operaciones",
    nombre: "Operaciones",
    secciones: [
      { seccion: "operaciones_ordenes", nombre: "Órdenes de trabajo" },
      { seccion: "operaciones_planificador", nombre: "Planificador" },
      { seccion: "operaciones_recurso_humano", nombre: "Recurso humano" },
      { seccion: "operaciones_materia_prima", nombre: "Materia prima" },
    ],
  },
  { area: "planos", nombre: "Planos", secciones: [] },
  {
    area: "recursos",
    nombre: "Recursos",
    secciones: [
      { seccion: "recursos_humano", nombre: "Recurso humano" },
      { seccion: "recursos_maquinaria", nombre: "Recurso maquinaria" },
      { seccion: "recursos_procesos", nombre: "Procesos" },
      { seccion: "recursos_rangos", nombre: "Rangos" },
      { seccion: "recursos_sectores", nombre: "Sectores" },
    ],
  },
  { area: "clientes", nombre: "Clientes", secciones: [] },
  { area: "no_conformidades", nombre: "No conformidades", secciones: [] },
  {
    area: "auditoria",
    nombre: "Auditoría",
    secciones: [
      { seccion: "auditoria_movimientos", nombre: "Todo lo que se hizo" },
      { seccion: "auditoria_procesos", nombre: "Pasos de las OT" },
      { seccion: "auditoria_planificacion", nombre: "Planificaciones" },
      { seccion: "auditoria_ingresos", nombre: "Ingresos y actividad por persona" },
    ],
  },
  {
    area: "configuracion",
    nombre: "Configuración",
    secciones: [{ seccion: "configuracion_usuarios", nombre: "Usuarios y permisos" }],
  },
];

/** Todas las secciones que el árbol deja otorgar. */
export function seccionesDelArbol(): SeccionCodigo[] {
  const salida: SeccionCodigo[] = [];
  for (const pagina of ARBOL) for (const hoja of pagina.secciones) salida.push(hoja.seccion);
  return salida;
}

/**
 * ¿Maneja usuarios y permisos? Sin permisos (backend viejo), sí, como siempre. Con
 * permisos: admin, salvo que el backend diga que no (hay administradores permanentes y no
 * es uno de ellos: el requireDueño de DJ). Esconderlo es comodidad: el backend lo exige.
 */
export function gestionaUsuarios(permisos: Permisos | null | undefined): boolean {
  if (!permisos) return true;
  return permisos.es_admin && permisos.gestiona_usuarios !== false;
}
