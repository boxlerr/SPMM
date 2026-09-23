/**
 * La lógica de la pantalla «Usuarios y permisos» (RF-24), sin React.
 *
 * DE DÓNDE SALE
 *
 * Es la pantalla de usuarios de Don Joaquín (src/app/(dashboard)/usuarios/*), portada.
 * Allá la matriz, los permisos puntuales y las secciones confidenciales llaman a server
 * actions que hablan con Supabase; acá llaman a la API de administración del backend
 * (backend/presentation/PermisosAPI.py, /permisos/*), que es la que decide y guarda.
 * Lo que vive en este archivo es lo que la pantalla necesita para no mentir mientras
 * espera la respuesta —el cambio se ve al toque y se revierte si falla— y para no
 * ofrecer lo que el servidor va a rechazar:
 *
 *     qué niveles se ofrecen para un rol en un área, en una sección y para una persona
 *         (espejo de las reglas de PermisosAPI: el rol sólo RESTRINGE una sección que
 *          no es confidencial; Configuración llega hasta «editar» y «Usuarios y
 *          permisos» hasta «ver» para cualquiera que no sea el Administrador);
 *     qué termina viendo un rol en cada sección (espejo de _nivel_de_seccion de
 *         backend/core/permisos.py, sin lo de las personas);
 *     leer lo que manda /permisos/* sin romperse si viene otra cosa;
 *     los vencimientos, que viajan en hora del taller y SIN zona;
 *     a qué pantalla entra cada rol y cada persona (RF-28), y si la puede abrir: los
 *         permisos de una persona se arman con la regla de resolver_permisos (backend),
 *         rol + permisos de más vigentes.
 *
 * El que manda sigue siendo el backend. Un test (backend/tests/test_permisos_admin_front.py)
 * compila este archivo y exige que conteste lo mismo que el backend en cada combinación.
 *
 * No importa nada fuera de ./permisos (ni React ni `@/`): se compila solo.
 */

import {
  ARBOL,
  AREAS,
  NIVEL_RANK,
  SECCIONES,
  leerPantallaInicio,
  puedeAbrirRuta,
  rutaInicio,
  type AreaCodigo,
  type Nivel,
  type Permisos,
  type SeccionCodigo,
} from "./permisos";

// ─────────────────────────── vocabulario ───────────────────────────

/** Lo que se le puede poner a un rol en una sección: un nivel, o «hereda» (sin override). */
export type NivelDeSeccion = Nivel | "hereda";

function esNivel(x: unknown): x is Nivel {
  return typeof x === "string" && x in NIVEL_RANK;
}

function rango(n: string | null | undefined): number {
  return n && esNivel(n) ? NIVEL_RANK[n] : 0;
}

/** Como nivel_valido del backend: lo que no se entiende vale «none». */
export function nivelValido(n: unknown): Nivel {
  return esNivel(n) ? n : "none";
}

// ─────────────────────────── los topes (espejo de PermisosAPI) ───────────────────────────
//
// Administrar usuarios y permisos es sólo del rol Administrador: quien puede tocar
// permisos se da admin solo. Por eso, para cualquier otro rol o persona, Configuración
// llega hasta «editar» y «Usuarios y permisos» hasta «ver». El backend contesta 409 si
// se pide más (PermisosAPI._TOPE_AREA / _TOPE_SECCION); acá directamente no se ofrece.

export const TOPE_AREA: Partial<Record<AreaCodigo, Nivel>> = { configuracion: "write" };
export const TOPE_SECCION: Partial<Record<SeccionCodigo, Nivel>> = { configuracion_usuarios: "read" };

// «admin» no se ofrece nunca para un rol que no sea el Administrador ni para una persona:
// ninguna pantalla lo pide salvo Configuración, que tiene tope. Igual que DJ («"admin" ya
// no se ofrece»). Si la base tiene uno viejo, la pantalla lo muestra tal cual.
const NIVELES_OFRECIBLES: Nivel[] = ["none", "read", "write"];

function topeDe(codigo: string): Nivel {
  return (
    TOPE_AREA[codigo as AreaCodigo] ??
    TOPE_SECCION[codigo as SeccionCodigo] ??
    "write"
  );
}

/** Los niveles que se le pueden poner a un rol en un área. */
export function nivelesDeRolEnArea(area: AreaCodigo): Nivel[] {
  const tope = topeDe(area);
  return NIVELES_OFRECIBLES.filter((n) => rango(n) <= rango(tope));
}

/**
 * Lo que se le puede poner a un rol en una sección.
 *
 * - Sección común: «hereda» (lo que diga el área) o algo MENOR que el área. Igualarlo o
 *   superarlo no significa nada y el backend lo rechaza (DJ: «el override no puede
 *   igualar ni superar el nivel del área; para igualarlo usá "Hereda del área"»).
 * - Sección confidencial: «hereda» es CERRADA; «ver» o «editar» la abren para el rol.
 */
export function opcionesDeRolEnSeccion(
  seccion: SeccionCodigo,
  nivelArea: Nivel,
  confidencial: boolean,
): NivelDeSeccion[] {
  const tope = topeDe(seccion);
  if (confidencial) {
    return ["hereda", ...(["read", "write"] as Nivel[]).filter((n) => rango(n) <= rango(tope))];
  }
  return [
    "hereda",
    ...NIVELES_OFRECIBLES.filter((n) => rango(n) < rango(nivelArea) && rango(n) <= rango(tope)),
  ];
}

/** Los niveles de un permiso de más para una persona: tiene que dar algo, y con tope. */
export function nivelesDePersona(codigo: AreaCodigo | SeccionCodigo): Nivel[] {
  const tope = topeDe(codigo);
  return (["read", "write"] as Nivel[]).filter((n) => rango(n) <= rango(tope));
}

// ─────────────────────────── lo que termina viendo un rol ───────────────────────────

/**
 * El nivel de un ROL en una sección. Espejo de _nivel_de_seccion (backend/core/permisos.py)
 * sin lo que se le da a cada persona:
 *   - confidencial: lo que el rol tenga abierto en esa sección, o nada;
 *   - común: el del área; si el rol la restringe a algo MENOR, eso.
 */
export function efectivaDeRolEnSeccion(
  nivelArea: Nivel | null | undefined,
  override: Nivel | null | undefined,
  confidencial: boolean,
): Nivel {
  const ov = override == null ? null : nivelValido(override);
  if (confidencial) return ov ?? "none";
  const area = nivelValido(nivelArea);
  return ov !== null && rango(ov) < rango(area) ? ov : area;
}

/** Todas las secciones de un rol que no es admin, ya resueltas. */
export function efectivasDeRol(
  areas: Partial<Record<string, Nivel>>,
  secciones: Partial<Record<string, Nivel>>,
  confidenciales: Partial<Record<string, boolean>>,
): Record<SeccionCodigo, Nivel> {
  const salida = {} as Record<SeccionCodigo, Nivel>;
  for (const s of SECCIONES) {
    const conf = confidenciales[s.codigo] ?? s.confidencial;
    salida[s.codigo] = efectivaDeRolEnSeccion(areas[s.area], secciones[s.codigo], !!conf);
  }
  return salida;
}

// ─────────────────────────── lo que manda /permisos/* ───────────────────────────

export interface SeccionDelCatalogo {
  codigo: SeccionCodigo;
  nombre: string;
  orden: number;
  confidencial: boolean;
  confidencial_por_defecto: boolean;
}

export interface AreaDelCatalogo {
  codigo: AreaCodigo;
  nombre: string;
  orden: number;
  secciones: SeccionDelCatalogo[];
}

export interface RolDeLaMatriz {
  codigo: string;
  nombre: string;
  es_admin: boolean;
  usuarios_activos: number;
  /** Nivel del rol en cada área. */
  areas: Partial<Record<AreaCodigo, Nivel>>;
  /** Sólo los overrides que tiene: la sección que falta hereda. */
  secciones: Partial<Record<SeccionCodigo, Nivel>>;
  /** Lo que termina viendo en cada sección. */
  secciones_efectivas: Partial<Record<SeccionCodigo, Nivel>>;
  /**
   * RF-28: la pantalla por la que entran los de este rol que no tienen una propia; null =
   * la de siempre. `undefined` = el servidor no la sabe (no la manda: backend o base
   * viejos), y entonces no se ofrece cambiarla.
   */
  pantalla_inicio?: string | null;
}

export interface Matriz {
  areas: AreaDelCatalogo[];
  roles: RolDeLaMatriz[];
  /** RF-28: el servidor sabe guardar la pantalla de inicio (la migración ya corrió). */
  inicioDisponible: boolean;
}

function objeto(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function mapaDeNiveles(crudo: unknown): Record<string, Nivel> {
  const salida: Record<string, Nivel> = {};
  const o = objeto(crudo);
  if (!o) return salida;
  for (const [k, v] of Object.entries(o)) salida[k] = nivelValido(v);
  return salida;
}

/** El catálogo de código, con la marca de confidencial que diga `confidenciales`. */
export function catalogoLocal(confidenciales: Partial<Record<string, boolean>> = {}): AreaDelCatalogo[] {
  return AREAS.map((a) => ({
    codigo: a.codigo,
    nombre: a.nombre,
    orden: a.orden,
    secciones: SECCIONES.filter((s) => s.area === a.codigo).map((s) => ({
      codigo: s.codigo,
      nombre: s.nombre,
      orden: s.orden,
      confidencial: confidenciales[s.codigo] ?? s.confidencial,
      confidencial_por_defecto: s.confidencial,
    })),
  }));
}

/**
 * Lee lo que devolvió GET /permisos/matriz (el `data` del ResponseDTO). null si no tiene
 * la forma esperada: la pantalla lo trata como «no se pudo», nunca como «no hay nada».
 *
 * De las áreas del servidor se toma sólo la marca de confidencial de cada sección: la
 * forma (qué secciones hay y en qué orden) es la del catálogo de la pantalla, que un
 * test ata al del backend.
 */
export function leerMatriz(crudo: unknown): Matriz | null {
  const o = objeto(crudo);
  if (!o || !Array.isArray(o.roles)) return null;
  const confidenciales: Record<string, boolean> = {};
  if (Array.isArray(o.areas)) {
    for (const a of o.areas) {
      const ao = objeto(a);
      if (!ao || !Array.isArray(ao.secciones)) continue;
      for (const s of ao.secciones) {
        const so = objeto(s);
        if (so && typeof so.codigo === "string" && typeof so.confidencial === "boolean") {
          confidenciales[so.codigo] = so.confidencial;
        }
      }
    }
  }
  const roles: RolDeLaMatriz[] = [];
  for (const r of o.roles) {
    const ro = objeto(r);
    if (!ro || typeof ro.codigo !== "string" || !ro.codigo) continue;
    const es_admin = ro.es_admin === true || ro.codigo === "admin";
    const areas = mapaDeNiveles(ro.areas) as RolDeLaMatriz["areas"];
    const secciones = mapaDeNiveles(ro.secciones) as RolDeLaMatriz["secciones"];
    const efectivasCrudas = mapaDeNiveles(ro.secciones_efectivas) as RolDeLaMatriz["secciones_efectivas"];
    const rol: RolDeLaMatriz = {
      codigo: ro.codigo,
      nombre: typeof ro.nombre === "string" && ro.nombre ? ro.nombre : ro.codigo,
      es_admin,
      usuarios_activos: typeof ro.usuarios_activos === "number" ? ro.usuarios_activos : 0,
      areas,
      secciones,
      // Si el servidor no las mandó, se calculan con la misma regla.
      secciones_efectivas: Object.keys(efectivasCrudas).length
        ? efectivasCrudas
        : es_admin
          ? (Object.fromEntries(SECCIONES.map((s) => [s.codigo, "admin"])) as RolDeLaMatriz["secciones_efectivas"])
          : efectivasDeRol(areas, secciones, confidenciales),
    };
    // RF-28: sólo si vino la clave (null incluido); si no, queda sin saberse.
    if ("pantalla_inicio" in ro) rol.pantalla_inicio = leerPantallaInicio(ro.pantalla_inicio);
    roles.push(rol);
  }
  return {
    areas: catalogoLocal(confidenciales),
    roles,
    // Hace falta que lo diga el servidor Y que haya venido la de cada rol: nunca se ofrece
    // guardar algo que el servidor no sabe guardar.
    inicioDisponible: o.pantalla_inicio_disponible === true && roles.every((r) => r.pantalla_inicio !== undefined),
  };
}

/** {sección: confidencial} como la tiene la matriz (o el catálogo, si no hay matriz). */
export function confidencialesDe(matriz: Matriz | null | undefined): Record<SeccionCodigo, boolean> {
  const salida = {} as Record<SeccionCodigo, boolean>;
  for (const s of SECCIONES) salida[s.codigo] = s.confidencial;
  for (const a of matriz?.areas ?? []) {
    for (const s of a.secciones) salida[s.codigo] = s.confidencial;
  }
  return salida;
}

// ── cambios sobre la matriz, para pintarlos antes de que conteste el servidor ──

function recalcular(rol: RolDeLaMatriz, confidenciales: Partial<Record<string, boolean>>): RolDeLaMatriz {
  if (rol.es_admin) return rol;
  return { ...rol, secciones_efectivas: efectivasDeRol(rol.areas, rol.secciones, confidenciales) };
}

/** La matriz con el nivel de `rol` en `area` cambiado (y lo que eso arrastra). */
export function conNivelDeArea(matriz: Matriz, rol: string, area: AreaCodigo, nivel: Nivel): Matriz {
  const conf = confidencialesDe(matriz);
  return {
    ...matriz,
    roles: matriz.roles.map((r) =>
      r.codigo === rol && !r.es_admin ? recalcular({ ...r, areas: { ...r.areas, [area]: nivel } }, conf) : r,
    ),
  };
}

/** La matriz con lo de `rol` en `seccion` cambiado. «hereda» saca el override. */
export function conNivelDeSeccion(
  matriz: Matriz,
  rol: string,
  seccion: SeccionCodigo,
  nivel: NivelDeSeccion,
): Matriz {
  const conf = confidencialesDe(matriz);
  return {
    ...matriz,
    roles: matriz.roles.map((r) => {
      if (r.codigo !== rol || r.es_admin) return r;
      const secciones = { ...r.secciones };
      if (nivel === "hereda") delete secciones[seccion];
      else secciones[seccion] = nivel;
      return recalcular({ ...r, secciones }, conf);
    }),
  };
}

/** La matriz con la marca de confidencial de `seccion` cambiada (y lo que ve cada rol). */
export function conConfidencial(matriz: Matriz, seccion: SeccionCodigo, confidencial: boolean): Matriz {
  const areas = matriz.areas.map((a) => ({
    ...a,
    secciones: a.secciones.map((s) => (s.codigo === seccion ? { ...s, confidencial } : s)),
  }));
  const siguiente = { ...matriz, areas };
  const conf = confidencialesDe(siguiente);
  return { ...siguiente, roles: siguiente.roles.map((r) => recalcular(r, conf)) };
}

/** La matriz con la pantalla de inicio de `rol` cambiada (RF-28). null = la de siempre. */
export function conPantallaDeRol(matriz: Matriz, rol: string, ruta: string | null): Matriz {
  return {
    ...matriz,
    roles: matriz.roles.map((r) => (r.codigo === rol ? { ...r, pantalla_inicio: ruta } : r)),
  };
}

/** Cambia cuántas personas activas tiene cada rol (al cambiarle el rol a alguien). */
export function conPersonaMovida(matriz: Matriz, de: string, a: string): Matriz {
  if (de === a) return matriz;
  return {
    ...matriz,
    roles: matriz.roles.map((r) =>
      r.codigo === de
        ? { ...r, usuarios_activos: Math.max(0, r.usuarios_activos - 1) }
        : r.codigo === a
          ? { ...r, usuarios_activos: r.usuarios_activos + 1 }
          : r,
    ),
  };
}

/**
 * Una línea que dice qué puede un rol: «Edita: Operaciones, Planos · Ve: Dashboard».
 * La usa el alta de usuario para que quien elige el rol sepa qué está dando.
 */
export function resumenDeRol(rol: RolDeLaMatriz | null | undefined): string {
  if (!rol) return "";
  if (rol.es_admin) return "Puede todo, incluido manejar usuarios y permisos.";
  const edita: string[] = [];
  const ve: string[] = [];
  for (const a of AREAS) {
    const n = rol.areas[a.codigo] ?? "none";
    if (rango(n) >= rango("write")) edita.push(a.nombre);
    else if (rango(n) >= rango("read")) ve.push(a.nombre);
  }
  const partes: string[] = [];
  if (edita.length) partes.push(`Edita: ${edita.join(", ")}`);
  if (ve.length) partes.push(`Ve: ${ve.join(", ")}`);
  return partes.length ? partes.join(" · ") : "Todavía no tiene ninguna pantalla habilitada.";
}

// ── los permisos de más (GET /permisos/overrides y /permisos/usuarios/{id}) ──

export interface PermisoDeMas {
  tipo: "area" | "seccion";
  id_usuario: number;
  codigo: string;
  nivel: Nivel;
  /** Hora del taller, sin zona: «2026-09-30T18:00:00». null = permanente. */
  vence_en: string | null;
  /** Lo decide el servidor, con su reloj. */
  vigente: boolean;
  motivo: string | null;
  otorgado_por: number | null;
  otorgado_por_nombre: string | null;
  creado_en: string | null;
  /** A quién se le dio, como lo manda el servidor (sirve aunque ya no esté en la lista). */
  persona: string;
}

function leerFilas(crudo: unknown, tipo: PermisoDeMas["tipo"]): PermisoDeMas[] {
  if (!Array.isArray(crudo)) return [];
  const salida: PermisoDeMas[] = [];
  for (const f of crudo) {
    const o = objeto(f);
    if (!o || typeof o.id_usuario !== "number" || typeof o.codigo !== "string") continue;
    salida.push({
      tipo,
      id_usuario: o.id_usuario,
      codigo: o.codigo,
      nivel: nivelValido(o.nivel),
      vence_en: typeof o.vence_en === "string" && o.vence_en ? o.vence_en : null,
      vigente: o.vigente !== false,
      motivo: typeof o.motivo === "string" && o.motivo ? o.motivo : null,
      otorgado_por: typeof o.otorgado_por === "number" ? o.otorgado_por : null,
      otorgado_por_nombre: typeof o.otorgado_por_nombre === "string" && o.otorgado_por_nombre
        ? o.otorgado_por_nombre
        : null,
      creado_en: typeof o.creado_en === "string" ? o.creado_en : null,
      persona: nombreDePersona({
        nombre: typeof o.nombre === "string" ? o.nombre : null,
        apellido: typeof o.apellido === "string" ? o.apellido : null,
        username: typeof o.username === "string" ? o.username : `#${o.id_usuario}`,
      }),
    });
  }
  return salida;
}

/** `{areas: [...], secciones: [...]}` -> una sola lista. null si no tiene esa forma. */
export function leerPermisosDeMas(crudo: unknown): PermisoDeMas[] | null {
  const o = objeto(crudo);
  if (!o || !Array.isArray(o.areas) || !Array.isArray(o.secciones)) return null;
  return [...leerFilas(o.areas, "area"), ...leerFilas(o.secciones, "seccion")];
}

export function mismoPermiso(a: Pick<PermisoDeMas, "tipo" | "id_usuario" | "codigo">, b: Pick<PermisoDeMas, "tipo" | "id_usuario" | "codigo">): boolean {
  return a.tipo === b.tipo && a.id_usuario === b.id_usuario && a.codigo === b.codigo;
}

/** Qué se puede dar a una persona, con la forma del menú (DJ: el árbol del sidebar). */
export interface OpcionDePermiso {
  tipo: "area" | "seccion";
  codigo: AreaCodigo | SeccionCodigo;
  area: AreaCodigo;
  nombre: string;
}

export function opcionesDePermisoDeMas(): OpcionDePermiso[] {
  const salida: OpcionDePermiso[] = [];
  for (const pagina of ARBOL) {
    salida.push({ tipo: "area", codigo: pagina.area, area: pagina.area, nombre: `${pagina.nombre} (toda la pantalla)` });
    for (const hoja of pagina.secciones) {
      salida.push({ tipo: "seccion", codigo: hoja.seccion, area: pagina.area, nombre: `${pagina.nombre} › ${hoja.nombre}` });
    }
  }
  return salida;
}

/** El nombre de lo que se dio: «Clientes» o «Operaciones › Planificador». */
export function nombreDePermiso(tipo: "area" | "seccion", codigo: string): string {
  for (const pagina of ARBOL) {
    if (tipo === "area" && pagina.area === codigo) return pagina.nombre;
    for (const hoja of pagina.secciones) {
      if (tipo === "seccion" && hoja.seccion === codigo) return `${pagina.nombre} › ${hoja.nombre}`;
    }
  }
  return codigo;
}

// ─────────────────────────── la pantalla de inicio (RF-28) ───────────────────────────
//
// A qué pantalla entra cada rol y cada persona, y si la puede abrir. Para eso hacen falta
// SUS permisos, con la misma regla del backend (resolver_permisos): los del rol, y encima
// lo que se le dio a la persona y está vigente (sólo suma). Un test los compara con los
// que resuelve el backend (backend/tests/test_permisos_admin_front.py).
//
// Fijar una pantalla NO da permiso para verla: si no la puede abrir, entra al Dashboard o
// a la primera que pueda ver (rutaInicio, la misma que usa el login). La pantalla lo avisa
// al lado del selector; el servidor no lo rechaza (no se pierde nada).

/** Todo en «admin»: lo que tiene el Administrador por regla. */
function permisosDeAdmin(rol: string): Permisos {
  return {
    rol,
    es_admin: true,
    admin_permanente: null,
    areas: Object.fromEntries(AREAS.map((a) => [a.codigo, "admin"])) as Permisos["areas"],
    secciones: Object.fromEntries(SECCIONES.map((s) => [s.codigo, "admin"])) as Permisos["secciones"],
  };
}

/**
 * Lo que puede un ROL (sin lo de ninguna persona), en la forma de lib/permisos.ts: sus
 * áreas y lo que termina viendo en cada sección (`secciones_efectivas`, que ya tiene en
 * cuenta lo confidencial tal como está en la matriz).
 */
export function permisosDeRol(rol: RolDeLaMatriz): Permisos {
  if (rol.es_admin) return permisosDeAdmin(rol.codigo);
  const areas = {} as Record<AreaCodigo, Nivel>;
  for (const a of AREAS) areas[a.codigo] = nivelValido(rol.areas[a.codigo]);
  const secciones = {} as Record<SeccionCodigo, Nivel>;
  for (const s of SECCIONES) secciones[s.codigo] = nivelValido(rol.secciones_efectivas[s.codigo]);
  return { rol: rol.codigo, es_admin: false, admin_permanente: null, areas, secciones };
}

/**
 * Lo que puede una persona de `rol` con estos permisos de más (sólo cuentan los vigentes),
 * en la forma de lib/permisos.ts. Espejo de resolver_permisos (backend/core/permisos.py):
 *   - área = lo del rol o lo que se le dio, lo que sea más;
 *   - sección = la regla de siempre (confidencial: lo del rol o nada; común: el área, o lo
 *     que el rol la restrinja) con el área YA sumada, y encima lo que se le dio.
 */
export function permisosDePersona(
  rol: RolDeLaMatriz,
  extras: Pick<PermisoDeMas, "tipo" | "codigo" | "nivel" | "vigente">[],
  confidenciales: Partial<Record<string, boolean>>,
): Permisos {
  if (rol.es_admin) return permisosDeAdmin(rol.codigo);
  const extra = (tipo: "area" | "seccion", codigo: string): Nivel | null => {
    let mejor: Nivel | null = null;
    for (const p of extras) {
      if (!p.vigente || p.tipo !== tipo || p.codigo !== codigo) continue;
      if (mejor === null || rango(p.nivel) > rango(mejor)) mejor = nivelValido(p.nivel);
    }
    return mejor;
  };
  const areas = {} as Record<AreaCodigo, Nivel>;
  for (const a of AREAS) {
    const delRol = nivelValido(rol.areas[a.codigo]);
    const suma = extra("area", a.codigo);
    areas[a.codigo] = suma !== null && rango(suma) > rango(delRol) ? suma : delRol;
  }
  const secciones = {} as Record<SeccionCodigo, Nivel>;
  for (const s of SECCIONES) {
    const conf = !!(confidenciales[s.codigo] ?? s.confidencial);
    let nivel = efectivaDeRolEnSeccion(areas[s.area], rol.secciones[s.codigo], conf);
    const suma = extra("seccion", s.codigo);
    if (suma !== null && rango(suma) > rango(nivel)) nivel = suma;
    secciones[s.codigo] = nivel;
  }
  return { rol: rol.codigo, es_admin: false, admin_permanente: null, areas, secciones };
}

export interface Inicio {
  /** La que se le fijó (la de la persona, o si no tiene, la de su rol); null = ninguna. */
  fijada: string | null;
  /** Por dónde entra de verdad: la fijada si la puede abrir; si no, rutaInicio. */
  ruta: string;
  /** Tiene una fijada que no puede abrir (entra a `ruta` en su lugar). */
  fijadaSinAcceso: boolean;
}

/**
 * Por dónde entra alguien con estos permisos y esta pantalla fijada. Es rutaInicio de
 * lib/permisos.ts, la MISMA que usa el login.
 */
export function inicioSegun(permisos: Permisos, fijada: string | null | undefined): Inicio {
  const f = leerPantallaInicio(fijada);
  return {
    fijada: f,
    ruta: rutaInicio(permisos, f),
    fijadaSinAcceso: f !== null && !puedeAbrirRuta(permisos, f),
  };
}

/** Por dónde entran los de un rol que no tienen una propia. */
export function inicioDeRol(rol: RolDeLaMatriz): Inicio {
  return inicioSegun(permisosDeRol(rol), rol.pantalla_inicio);
}

/**
 * Por dónde entra una persona: la suya pisa la de su rol (backend: pantalla_de_inicio).
 * Sus permisos: los de su rol en la matriz más los permisos de más que tenga vigentes. Un
 * rol que la matriz no tiene no ve nada (como en el backend: sin fila en la matriz, nada).
 */
export function inicioDePersona(
  persona: { id_usuario: number; rol: string; pantalla_inicio?: string | null },
  matriz: Matriz,
  permisosDeMas: PermisoDeMas[] | null,
): Inicio {
  return inicioSegun(
    permisosDeLaPersona(persona, matriz, permisosDeMas),
    leerPantallaInicio(persona.pantalla_inicio) ?? rolDeLaPersona(persona, matriz).pantalla_inicio,
  );
}

function rolDeLaPersona(persona: { rol: string }, matriz: Matriz): RolDeLaMatriz {
  return matriz.roles.find((r) => r.codigo === persona.rol) ?? {
    codigo: persona.rol,
    nombre: persona.rol,
    es_admin: persona.rol === "admin",
    usuarios_activos: 0,
    areas: {},
    secciones: {},
    secciones_efectivas: {},
  };
}

/** Los permisos de una persona de la lista: su rol en la matriz + sus permisos de más. */
export function permisosDeLaPersona(
  persona: { id_usuario: number; rol: string },
  matriz: Matriz,
  permisosDeMas: PermisoDeMas[] | null,
): Permisos {
  const extras = (permisosDeMas ?? []).filter((p) => p.id_usuario === persona.id_usuario);
  return permisosDePersona(rolDeLaPersona(persona, matriz), extras, confidencialesDe(matriz));
}

// ─────────────────────────── vencimientos ───────────────────────────
//
// Viajan SIN zona y en hora del taller (backend/dto/PermisosRequestDTO.py): el
// <input type="datetime-local"> ya da «2026-09-30T18:00», que es exactamente eso. Nada de
// toISOString(): la Z lo correría tres horas.

const RE_FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

function dos(n: number): string {
  return String(n).padStart(2, "0");
}

export type VencimientoLeido =
  | { ok: true; valor: string | null }
  | { ok: false; error: string };

/**
 * Lo que se escribió en el campo de vencimiento -> lo que se manda.
 * Vacío = permanente (null). Una fecha que ya pasó no sirve: el permiso no contaría nunca.
 */
export function leerVencimiento(valor: string, ahora: Date): VencimientoLeido {
  const v = (valor || "").trim();
  if (!v) return { ok: true, valor: null };
  const m = RE_FECHA_HORA.exec(v);
  if (!m) return { ok: false, error: "La fecha de vencimiento no se entiende." };
  const [, a, me, d, h, mi] = m;
  const cuando = new Date(Number(a), Number(me) - 1, Number(d), Number(h), Number(mi), 0);
  if (cuando.getTime() <= ahora.getTime()) {
    return { ok: false, error: "Esa fecha de vencimiento ya pasó: el permiso no contaría nunca." };
  }
  return { ok: true, valor: `${a}-${me}-${d}T${h}:${mi}:00` };
}

/** «Hoy hasta las 23:59», para el botón «Sólo hoy» (DJ finDeHoy). */
export function finDeHoy(ahora: Date): string {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}T23:59`;
}

/**
 * «Permanente» o «hasta el 30/09/2026 18:00». Se lee del texto tal cual, sin `new Date`:
 * el servidor ya la manda en hora del taller, y convertirla con la zona de la PC la
 * correría en una computadora con la zona mal puesta.
 */
export function textoDeVencimiento(vence_en: string | null | undefined): string {
  if (!vence_en) return "Permanente";
  const m = RE_FECHA_HORA.exec(vence_en);
  if (!m) return `hasta ${vence_en}`;
  const [, a, me, d, h, mi] = m;
  return `hasta el ${d}/${me}/${a} ${h}:${mi}`;
}

/** Ahora, en el formato de la base (hora de la PC, sin zona). Sólo para pintar. */
export function ahoraSinZona(ahora: Date): string {
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}T${dos(ahora.getHours())}:${dos(ahora.getMinutes())}:${dos(ahora.getSeconds())}`;
}

// ─────────────────────────── respuestas del servidor ───────────────────────────

/** El mensaje de error del backend, venga como venga. */
export function mensajeDeError(cuerpo: unknown, porDefecto: string): string {
  const o = objeto(cuerpo);
  if (!o) return porDefecto;
  if (Array.isArray(o.errors) && o.errors.length) {
    const e = objeto(o.errors[0]);
    if (e && typeof e.message === "string" && e.message) return e.message;
  }
  const detalle = o.detail;
  if (typeof detalle === "string" && detalle) return detalle;
  const d = objeto(detalle);
  if (d && typeof d.message === "string" && d.message) return d.message;
  return porDefecto;
}

/**
 * ¿La ruta no existe en ese servidor? Es el backend de antes de esta pantalla (producción
 * hasta que Julián lo deploya a mano). Un 404 «Not Found» pelado es la ruta que falta; un
 * 404 con mensaje propio es otra cosa (un usuario que no existe).
 */
export function faltaServidor(status: number, cuerpo: unknown): boolean {
  if (status !== 404) return false;
  const mensaje = mensajeDeError(cuerpo, "");
  return !mensaje || mensaje === "Not Found";
}

/** Los errores por campo de un 400 de validación: {campo: mensaje}. */
export function erroresPorCampo(cuerpo: unknown): Record<string, string> {
  const salida: Record<string, string> = {};
  const o = objeto(cuerpo);
  if (!o || !Array.isArray(o.errors)) return salida;
  for (const e of o.errors) {
    const eo = objeto(e);
    if (!eo || typeof eo.message !== "string") continue;
    const campo = typeof eo.campo === "string" && eo.campo ? eo.campo : "global";
    if (!salida[campo]) salida[campo] = eo.message;
  }
  return salida;
}

// ─────────────────────────── personas ───────────────────────────

export function nombreDePersona(p: { nombre?: string | null; apellido?: string | null; username?: string | null }): string {
  const nombre = [p.nombre, p.apellido].filter((x) => x && String(x).trim()).join(" ").trim();
  return nombre || p.username || "—";
}
