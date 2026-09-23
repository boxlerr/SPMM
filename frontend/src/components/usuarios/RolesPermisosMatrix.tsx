'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, ChevronDown, Lock, ShieldCheck } from 'lucide-react';
import {
  ARBOL,
  AREAS,
  type AreaCodigo,
  type Nivel,
  type SeccionCodigo,
} from '@/lib/permisos';
import {
  confidencialesDe,
  conNivelDeArea,
  conNivelDeSeccion,
  faltaServidor,
  mensajeDeError,
  nivelesDeRolEnArea,
  opcionesDeRolEnSeccion,
  type Matriz,
  type NivelDeSeccion,
  type RolDeLaMatriz,
} from '@/lib/permisosAdmin';
import { cn } from '@/lib/utils';
import { AREA_META, NIVEL_INFO } from './area-meta';
import { pedir } from './api';

/**
 * La matriz rol × área (RolesPermisosMatrix de Don Joaquín) y, debajo, el detalle por
 * solapa de cada rol.
 *
 * - Cada fila es un rol y cada columna un ítem del menú (acá cada área ES un ítem del
 *   menú, no hace falta agruparlas como en DJ). En cada cruce: Sin acceso, Ver o Editar.
 * - El Administrador tiene todo por regla y no se configura (candado «Protegido»).
 * - El detalle por solapa sólo RESTRINGE lo que da el área (una solapa no puede tener
 *   más que su pantalla), salvo en lo confidencial, donde «Cerrada» es lo de siempre y
 *   Ver o Editar la abren para ese rol.
 *
 * Cada cambio se ve al toque (lo que termina viendo el rol se recalcula con la misma
 * regla del backend, lib/permisosAdmin.ts) y, si el servidor dice que no, vuelve a como
 * estaba y dice por qué. Vale desde el próximo pedido de cada persona con ese rol: los
 * permisos se leen de la base en cada pedido, nadie tiene que volver a entrar.
 *
 * En el teléfono la tabla de 8 columnas no entra: va una tarjeta por rol.
 */

interface Props {
  matriz: Matriz;
  setMatriz: Dispatch<SetStateAction<Matriz | null>>;
  /** Sólo el rol Administrador cambia permisos. El resto (si ve esto) lo ve en lectura. */
  puedeEditar: boolean;
}

function Pastilla({ nivel, className = '' }: { nivel: Nivel; className?: string }) {
  const info = NIVEL_INFO[nivel];
  return (
    <span
      title={info.desc}
      className={cn('inline-flex items-center justify-center rounded border px-2 py-1 text-xs font-medium', info.clase, className)}
    >
      {info.label}
    </span>
  );
}

function textoDeError(r: { red: boolean; status: number; cuerpo: unknown }, porDefecto: string): string {
  if (r.red) return 'No se pudo guardar: revisá la conexión.';
  if (faltaServidor(r.status, r.cuerpo)) return 'No se pudo guardar: falta actualizar el servidor.';
  return mensajeDeError(r.cuerpo, porDefecto);
}

export default function RolesPermisosMatrix({ matriz, setMatriz, puedeEditar }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<ReadonlySet<string>>(new Set());
  const noAdmins = matriz.roles.filter((r) => !r.es_admin);
  const [rolDetalle, setRolDetalle] = useState<string | null>(noAdmins[0]?.codigo ?? null);
  const conf = confidencialesDe(matriz);
  const detalle = noAdmins.find((r) => r.codigo === rolDetalle) ?? noAdmins[0] ?? null;

  const marcar = (clave: string, prendido: boolean) =>
    setGuardando((prev) => {
      const s = new Set(prev);
      if (prendido) s.add(clave);
      else s.delete(clave);
      return s;
    });

  const cambiarArea = async (rol: RolDeLaMatriz, area: AreaCodigo, nivel: Nivel) => {
    const previo: Nivel = rol.areas[area] ?? 'none';
    if (previo === nivel) return;
    const clave = `${rol.codigo}:${area}`;
    setError(null);
    setMatriz((m) => (m ? conNivelDeArea(m, rol.codigo, area, nivel) : m));
    marcar(clave, true);
    const r = await pedir(
      `/permisos/roles/${encodeURIComponent(rol.codigo)}/areas/${area}`,
      { method: 'PUT', body: { nivel } },
    );
    marcar(clave, false);
    if (!r.ok) {
      // Vuelve atrás sólo si nadie lo cambió de nuevo mientras tanto.
      setMatriz((m) => {
        const actual = m?.roles.find((x) => x.codigo === rol.codigo)?.areas[area];
        return m && actual === nivel ? conNivelDeArea(m, rol.codigo, area, previo) : m;
      });
      setError(textoDeError(r, 'No se pudo guardar el permiso del rol.'));
    }
  };

  const cambiarSeccion = async (rol: RolDeLaMatriz, seccion: SeccionCodigo, valor: NivelDeSeccion) => {
    const previo: NivelDeSeccion = rol.secciones[seccion] ?? 'hereda';
    if (previo === valor) return;
    const clave = `${rol.codigo}:${seccion}`;
    setError(null);
    setMatriz((m) => (m ? conNivelDeSeccion(m, rol.codigo, seccion, valor) : m));
    marcar(clave, true);
    const r = await pedir(
      `/permisos/roles/${encodeURIComponent(rol.codigo)}/secciones/${seccion}`,
      { method: 'PUT', body: { nivel: valor } },
    );
    marcar(clave, false);
    if (!r.ok) {
      setMatriz((m) => {
        const actual = m?.roles.find((x) => x.codigo === rol.codigo)?.secciones[seccion] ?? 'hereda';
        return m && actual === valor ? conNivelDeSeccion(m, rol.codigo, seccion, previo) : m;
      });
      setError(textoDeError(r, 'No se pudo guardar el permiso de la solapa.'));
    }
  };

  const selectorDeArea = (rol: RolDeLaMatriz, area: AreaCodigo) => {
    const valor: Nivel = rol.areas[area] ?? 'none';
    if (!puedeEditar) return <Pastilla nivel={valor} />;
    const opciones = nivelesDeRolEnArea(area);
    // Un nivel que no se ofrece (un «admin» viejo en la base) se muestra igual.
    const todas = opciones.includes(valor) ? opciones : [...opciones, valor];
    const ocupado = guardando.has(`${rol.codigo}:${area}`);
    return (
      <select
        aria-label={`${rol.nombre} en ${AREA_META[area].titulo}`}
        value={valor}
        disabled={ocupado}
        onChange={(e) => cambiarArea(rol, area, e.target.value as Nivel)}
        className={`h-8 max-md:h-10 w-full min-w-[86px] rounded-md border pl-1 pr-0.5 text-[11px] font-medium transition-opacity focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30 ${NIVEL_INFO[valor].clase} ${ocupado ? 'opacity-60' : ''}`}
      >
        {todas.map((n) => (
          <option key={n} value={n}>
            {NIVEL_INFO[n].label}
          </option>
        ))}
      </select>
    );
  };

  const titulo = (area: AreaCodigo) => `Controla: ${AREA_META[area].pantallas.join(' · ')}`;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-200 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#DC143C] shrink-0" />
          <h4 className="text-sm font-semibold text-gray-900">Roles y permisos</h4>
        </div>
        <p className="text-xs text-gray-600">
          Cada <b className="text-gray-900">fila</b> es un rol y cada <b className="text-gray-900">columna</b> una
          pantalla del menú. En cada cruce elegís qué puede hacer ese rol ahí. Lo{' '}
          <b className="text-gray-900">confidencial</b> queda cerrado aunque el rol tenga la pantalla, salvo que
          se lo abras abajo. El <b className="text-gray-900">Administrador</b> siempre tiene todo. Los cambios valen
          al toque, sin que nadie tenga que volver a entrar.
        </p>
        <div className="flex flex-col gap-1 pt-0.5 sm:flex-row sm:flex-wrap sm:gap-x-4">
          {(['none', 'read', 'write'] as Nivel[]).map((n) => (
            <span key={n} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
              <Pastilla nivel={n} className="px-1.5 py-0.5 text-[11px] min-w-[72px]" />
              <span>{NIVEL_INFO[n].desc}</span>
            </span>
          ))}
        </div>
        <details className="group text-xs text-gray-600">
          <summary className="inline-flex cursor-pointer select-none items-center gap-1 font-medium text-gray-700 hover:text-gray-900 max-md:py-1.5">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            ¿Qué controla cada pantalla?
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {AREAS.map((a) => (
              <div key={a.codigo}>
                <dt className="font-semibold text-gray-800">{AREA_META[a.codigo].titulo}</dt>
                <dd className="text-gray-600">{AREA_META[a.codigo].pantallas.join(' · ')}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-gray-500">
            Las listas que usan varias pantallas (procesos, personas, máquinas, rangos, sectores, prioridades,
            artículos, materia prima y los feriados) las puede ver cualquiera que entre; cambiarlas pide la
            pantalla donde se editan.
          </p>
        </details>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 sm:px-5 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Computadora: la matriz (con el menú al costado, recién desde lg entra). */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 min-w-[140px]">
                Rol
              </th>
              {AREAS.map((a) => (
                <th
                  key={a.codigo}
                  title={titulo(a.codigo)}
                  className="bg-gray-50 px-1.5 py-2 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-gray-500 border-b border-gray-200 cursor-help"
                >
                  {AREA_META[a.codigo].titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matriz.roles.map((rol) => (
              <tr key={rol.codigo} className="hover:bg-gray-50/60">
                <td className="sticky left-0 z-10 bg-white px-4 py-2 border-b border-gray-100 align-middle">
                  <div className="flex items-center gap-1.5 font-medium text-gray-900 whitespace-nowrap">
                    {rol.nombre}
                    {rol.es_admin && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        <Lock className="h-2.5 w-2.5" /> Protegido
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-500">
                    {rol.usuarios_activos} persona{rol.usuarios_activos === 1 ? '' : 's'}
                  </span>
                </td>
                {AREAS.map((a) => (
                  <td key={a.codigo} className="px-1 py-2 text-center border-b border-gray-100">
                    {rol.es_admin ? <Pastilla nivel="admin" /> : selectorDeArea(rol, a.codigo)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Teléfono y tableta: una tarjeta por rol. */}
      <div className="lg:hidden divide-y divide-gray-200">
        {matriz.roles.map((rol) => (
          <div key={rol.codigo} className="px-4 py-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium text-gray-900">
                {rol.nombre}
                {rol.es_admin && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    <Lock className="h-2.5 w-2.5" /> Protegido
                  </span>
                )}
              </div>
              <span className="text-[11px] text-gray-500">
                {rol.usuarios_activos} persona{rol.usuarios_activos === 1 ? '' : 's'}
              </span>
            </div>
            {rol.es_admin ? (
              <p className="text-xs text-gray-600">Puede todo, incluido manejar usuarios y permisos.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                {AREAS.map((a) => (
                  <label key={a.codigo} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600">{AREA_META[a.codigo].titulo}</span>
                    <span className="w-32 shrink-0">{selectorDeArea(rol, a.codigo)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* El detalle por solapa, de a un rol. */}
      {detalle && (
        <div className="border-t border-gray-200">
          <div className="px-4 sm:px-5 py-4 space-y-3">
            <div>
              <h5 className="text-sm font-semibold text-gray-900">Solapas y partes sensibles, por rol</h5>
              <p className="text-xs text-gray-600 mt-1">
                Una solapa hace lo mismo que su pantalla, salvo que acá le pongas <b>menos</b> (por ejemplo: que el
                Operario vea Operaciones pero no el Planificador). Lo marcado con{' '}
                <Lock className="inline h-3 w-3 text-amber-600 -mt-0.5" /> es confidencial: está cerrado salvo que
                lo abras para el rol.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Rol">
              {noAdmins.map((r) => (
                <button
                  key={r.codigo}
                  type="button"
                  role="tab"
                  aria-selected={detalle.codigo === r.codigo}
                  onClick={() => setRolDetalle(r.codigo)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors max-md:py-2 ${
                    detalle.codigo === r.codigo
                      ? 'border-[#DC143C] bg-[#DC143C] text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {r.nombre}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {ARBOL.filter((p) => p.secciones.length > 0).map((pagina) => {
                const nivelArea: Nivel = detalle.areas[pagina.area] ?? 'none';
                return (
                  <div key={pagina.area} className="self-start overflow-hidden rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
                      <span className="text-xs font-semibold text-gray-800">{pagina.nombre}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        la pantalla: <Pastilla nivel={nivelArea} className="px-1.5 py-0.5 text-[10px]" />
                      </span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {pagina.secciones.map((hoja) => {
                        const esConf = !!conf[hoja.seccion];
                        const valor: NivelDeSeccion = detalle.secciones[hoja.seccion] ?? 'hereda';
                        const efectiva: Nivel = detalle.secciones_efectivas[hoja.seccion] ?? 'none';
                        const opciones = opcionesDeRolEnSeccion(hoja.seccion, nivelArea, esConf);
                        const todas = opciones.includes(valor) ? opciones : [...opciones, valor];
                        const etiqueta = (v: NivelDeSeccion) =>
                          v === 'hereda'
                            ? esConf
                              ? 'Cerrada'
                              : `Como la pantalla (${NIVEL_INFO[nivelArea].label})`
                            : opciones.includes(v)
                              ? NIVEL_INFO[v].label
                              : `${NIVEL_INFO[v].label} (no cambia nada)`;
                        const ocupado = guardando.has(`${detalle.codigo}:${hoja.seccion}`);
                        return (
                          <div
                            key={hoja.seccion}
                            className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-800">
                              {esConf && <Lock className="h-3 w-3 shrink-0 text-amber-600" />}
                              <span className="truncate">{hoja.nombre}</span>
                            </span>
                            <span className="flex items-center gap-2">
                              {puedeEditar ? (
                                <select
                                  aria-label={`${detalle.nombre} en ${pagina.nombre} › ${hoja.nombre}`}
                                  value={valor}
                                  disabled={ocupado}
                                  onChange={(e) => cambiarSeccion(detalle, hoja.seccion, e.target.value as NivelDeSeccion)}
                                  className={`h-8 max-md:h-10 flex-1 sm:w-48 sm:flex-none rounded-md border border-gray-300 bg-white px-1.5 text-xs text-gray-900 transition-opacity focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30 ${ocupado ? 'opacity-60' : ''}`}
                                >
                                  {todas.map((v) => (
                                    <option key={v} value={v}>
                                      {etiqueta(v)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-xs text-gray-600">{etiqueta(valor)}</span>
                              )}
                              <span className="shrink-0" title="Lo que termina pudiendo este rol ahí">
                                <Pastilla nivel={efectiva} className="px-1.5 py-0.5 text-[10px] min-w-[64px]" />
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
