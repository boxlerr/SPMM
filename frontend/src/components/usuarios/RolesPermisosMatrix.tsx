'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, Check, ChevronDown, DoorOpen, Lock, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ARBOL,
  AREAS,
  nombreDePantalla,
  puedeAbrirRuta,
  rutaInicio,
  type AreaCodigo,
  type Nivel,
  type SeccionCodigo,
} from '@/lib/permisos';
import {
  confidencialesDe,
  conNivelDeArea,
  conNivelDeSeccion,
  conPantallaDeRol,
  conRolNuevo,
  conRolRenombrado,
  faltaServidor,
  inicioDeRol,
  mensajeDeError,
  nivelesDeRolEnArea,
  opcionesDeRolEnSeccion,
  permisosDeRol,
  sinRol,
  type Matriz,
  type NivelDeSeccion,
  type RolDeLaMatriz,
} from '@/lib/permisosAdmin';
import { cn } from '@/lib/utils';
import { AREA_META, NIVEL_INFO } from './area-meta';
import { datos, pedir } from './api';
import SelectorDePantalla from './SelectorDePantalla';

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
 *
 * Debajo, «Por dónde entra cada rol» (RF-28): la pantalla a la que va cada uno después del
 * login si no tiene una propia (la de la persona se elige en la lista de usuarios y pisa
 * ésta). No da permisos: si el rol no la puede ver, se avisa adónde entra en su lugar.
 * Sólo aparece si el servidor la sabe guardar (`matriz.inicioDisponible`).
 *
 * Los roles se crean, se renombran y se borran acá mismo, en línea (el ABM de roles de DJ,
 * que faltaba hasta el 23/09): «Crear rol» al final de la lista (arranca sin ningún
 * permiso), el lápiz para renombrar y el tacho para borrar uno que nadie tiene. El
 * Administrador no se toca. Sólo si el servidor lo sabe hacer (`matriz.abmDeRoles`).
 */

interface Props {
  matriz: Matriz;
  setMatriz: Dispatch<SetStateAction<Matriz | null>>;
  /** Sólo el rol Administrador cambia permisos. El resto (si ve esto) lo ve en lectura. */
  puedeEditar: boolean;
  /**
   * Cuántas personas tiene cada rol, contando a las que no tienen acceso (sale de la lista
   * de usuarios). Un rol con gente no se borra. null = no se sabe: se usan las activas.
   */
  personasPorRol?: ReadonlyMap<string, number> | null;
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

export default function RolesPermisosMatrix({ matriz, setMatriz, puedeEditar, personasPorRol }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<ReadonlySet<string>>(new Set());
  // El ABM de roles.
  const abm = puedeEditar && matriz.abmDeRoles;
  const [editandoRol, setEditandoRol] = useState<string | null>(null);
  const [nombreEditado, setNombreEditado] = useState('');
  const [creandoRol, setCreandoRol] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [ocupadoRol, setOcupadoRol] = useState(false);
  const [borrando, setBorrando] = useState<RolDeLaMatriz | null>(null);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);
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

  const cambiarInicio = async (rol: RolDeLaMatriz, ruta: string | null) => {
    const previo = rol.pantalla_inicio ?? null;
    if (previo === ruta) return;
    const clave = `${rol.codigo}:inicio`;
    setError(null);
    setMatriz((m) => (m ? conPantallaDeRol(m, rol.codigo, ruta) : m));
    marcar(clave, true);
    const r = await pedir(
      `/permisos/roles/${encodeURIComponent(rol.codigo)}/pantalla-inicio`,
      { method: 'PUT', body: { pantalla_inicio: ruta } },
    );
    marcar(clave, false);
    if (!r.ok) {
      setMatriz((m) => {
        const actual = m?.roles.find((x) => x.codigo === rol.codigo)?.pantalla_inicio ?? null;
        return m && actual === ruta ? conPantallaDeRol(m, rol.codigo, previo) : m;
      });
      setError(textoDeError(r, 'No se pudo guardar la pantalla de inicio del rol.'));
    }
  };

  // ── crear, renombrar y borrar roles ──

  const personas = (rol: RolDeLaMatriz) => personasPorRol?.get(rol.codigo) ?? rol.usuarios_activos;

  const crearRol = async () => {
    const nombre = nombreNuevo.trim().replace(/\s+/g, ' ');
    if (nombre.length < 2 || ocupadoRol) return;
    setError(null);
    setOcupadoRol(true);
    const r = await pedir('/permisos/roles', { method: 'POST', body: { nombre } });
    setOcupadoRol(false);
    const creado = datos(r) as { codigo?: unknown; nombre?: unknown } | undefined;
    if (!r.ok || typeof creado?.codigo !== 'string') {
      setError(textoDeError(r, 'No se pudo crear el rol.'));
      return;
    }
    const codigo = creado.codigo;
    setMatriz((m) => (m ? conRolNuevo(m, codigo, typeof creado.nombre === 'string' ? creado.nombre : nombre) : m));
    setNombreNuevo('');
    setCreandoRol(false);
    setRolDetalle(codigo);
  };

  const empezarARenombrar = (rol: RolDeLaMatriz) => {
    setError(null);
    setEditandoRol(rol.codigo);
    setNombreEditado(rol.nombre);
  };

  /** Se ve al toque y, si el servidor dice que no, vuelve al nombre de antes. */
  const renombrarRol = async (rol: RolDeLaMatriz) => {
    const nombre = nombreEditado.trim().replace(/\s+/g, ' ');
    setEditandoRol(null);
    if (nombre.length < 2 || nombre === rol.nombre) return;
    const antes = rol.nombre;
    setError(null);
    setMatriz((m) => (m ? conRolRenombrado(m, rol.codigo, nombre) : m));
    const r = await pedir(`/permisos/roles/${encodeURIComponent(rol.codigo)}`, { method: 'PUT', body: { nombre } });
    if (!r.ok) {
      setMatriz((m) => {
        const actual = m?.roles.find((x) => x.codigo === rol.codigo)?.nombre;
        return m && actual === nombre ? conRolRenombrado(m, rol.codigo, antes) : m;
      });
      setError(textoDeError(r, 'No se pudo renombrar el rol.'));
    }
  };

  const borrarRol = async () => {
    const rol = borrando;
    if (!rol || ocupadoRol) return;
    setErrorBorrar(null);
    setOcupadoRol(true);
    const r = await pedir(`/permisos/roles/${encodeURIComponent(rol.codigo)}`, { method: 'DELETE' });
    setOcupadoRol(false);
    if (!r.ok) {
      setErrorBorrar(textoDeError(r, 'No se pudo borrar el rol.'));
      return;
    }
    setMatriz((m) => (m ? sinRol(m, rol.codigo) : m));
    setBorrando(null);
  };

  /** El nombre del rol en la fila (o en la tarjeta), con el lápiz y el tacho del ABM. */
  const nombreDelRol = (rol: RolDeLaMatriz, cuantas: 'fila' | 'tarjeta') => {
    if (editandoRol === rol.codigo) {
      return (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            aria-label={`Nuevo nombre de ${rol.nombre}`}
            value={nombreEditado}
            maxLength={80}
            onChange={(e) => setNombreEditado(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void renombrarRol(rol);
              if (e.key === 'Escape') setEditandoRol(null);
            }}
            className="h-8 max-md:h-10 w-32 sm:w-40 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30"
          />
          <button
            type="button"
            title="Guardar"
            aria-label="Guardar el nombre"
            onClick={() => void renombrarRol(rol)}
            className="flex size-7 max-md:size-10 shrink-0 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Cancelar"
            aria-label="Cancelar"
            onClick={() => setEditandoRol(null)}
            className="flex size-7 max-md:size-10 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }
    const n = personas(rol);
    return (
      <div className="flex items-center gap-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium text-gray-900 whitespace-nowrap">
            {rol.nombre}
            {rol.es_admin && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                <Lock className="h-2.5 w-2.5" /> Protegido
              </span>
            )}
          </div>
          {cuantas === 'fila' && (
            <span className="text-[11px] text-gray-500">
              {rol.usuarios_activos} persona{rol.usuarios_activos === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {/* En la computadora aparecen al pasar el mouse por la fila (como DJ); en el
            teléfono no hay mouse: se ven siempre. */}
        {abm && !rol.es_admin && (
          <div className="flex items-center gap-0.5 transition-opacity lg:opacity-0 lg:group-hover/rol:opacity-100 lg:focus-within:opacity-100">
            <button
              type="button"
              title="Renombrar"
              aria-label={`Renombrar ${rol.nombre}`}
              onClick={() => empezarARenombrar(rol)}
              className="flex size-7 max-md:size-10 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-[#DC143C]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={n > 0 ? `No se puede borrar: lo tiene${n > 1 ? 'n' : ''} ${n} persona${n > 1 ? 's' : ''}` : 'Borrar el rol'}
              aria-label={`Borrar ${rol.nombre}`}
              disabled={n > 0}
              onClick={() => {
                setErrorBorrar(null);
                setBorrando(rol);
              }}
              className="flex size-7 max-md:size-10 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const crearRolControl = creandoRol ? (
    <div className="flex flex-wrap items-center gap-1">
      <input
        autoFocus
        aria-label="Nombre del rol nuevo"
        placeholder="Nombre del rol nuevo"
        value={nombreNuevo}
        maxLength={80}
        disabled={ocupadoRol}
        onChange={(e) => setNombreNuevo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void crearRol();
          if (e.key === 'Escape') {
            setCreandoRol(false);
            setNombreNuevo('');
          }
        }}
        className="h-8 max-md:h-10 w-40 sm:w-48 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30"
      />
      <button
        type="button"
        title="Crear"
        aria-label="Crear el rol"
        onClick={() => void crearRol()}
        disabled={ocupadoRol || nombreNuevo.trim().length < 2}
        className="flex size-7 max-md:size-10 shrink-0 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Cancelar"
        aria-label="Cancelar"
        onClick={() => {
          setCreandoRol(false);
          setNombreNuevo('');
        }}
        disabled={ocupadoRol}
        className="flex size-7 max-md:size-10 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
      >
        <X className="h-4 w-4" />
      </button>
      <span className="w-full text-[11px] text-gray-500">
        {ocupadoRol ? 'Creando…' : 'Arranca sin ningún permiso: se los das en la matriz una vez creado.'}
      </span>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => {
        setError(null);
        setCreandoRol(true);
      }}
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-[#DC143C] hover:underline max-md:min-h-10"
    >
      <Plus className="h-4 w-4" /> Crear rol
    </button>
  );

  const selectorDeInicio = (rol: RolDeLaMatriz) => {
    const permisos = permisosDeRol(rol);
    const siempre = rutaInicio(permisos, null);
    const actual = inicioDeRol(rol);
    return (
      <SelectorDePantalla
        valor={rol.pantalla_inicio ?? null}
        textoNinguna={`La de siempre (${nombreDePantalla(siempre) ?? siempre})`}
        puedeAbrir={(ruta) => puedeAbrirRuta(permisos, ruta)}
        entraEnSuLugar={actual.fijadaSinAcceso ? actual.ruta : null}
        editable={puedeEditar}
        guardando={guardando.has(`${rol.codigo}:inicio`)}
        etiqueta={`Pantalla de inicio de ${rol.nombre}`}
        onCambiar={(ruta) => void cambiarInicio(rol, ruta)}
        className="w-full"
      />
    );
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
              <tr key={rol.codigo} className="group/rol hover:bg-gray-50/60">
                <td
                  className="sticky left-0 z-10 bg-white px-4 py-2 border-b border-gray-100 align-middle"
                  title={`Código interno: ${rol.codigo}`}
                >
                  {nombreDelRol(rol, 'fila')}
                </td>
                {AREAS.map((a) => (
                  <td key={a.codigo} className="px-1 py-2 text-center border-b border-gray-100">
                    {rol.es_admin ? <Pastilla nivel="admin" /> : selectorDeArea(rol, a.codigo)}
                  </td>
                ))}
              </tr>
            ))}
            {abm && (
              <tr className="bg-gray-50/40">
                <td colSpan={AREAS.length + 1} className="px-4 py-2.5 border-b border-gray-100">
                  {crearRolControl}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Teléfono y tableta: una tarjeta por rol. */}
      <div className="lg:hidden divide-y divide-gray-200">
        {matriz.roles.map((rol) => (
          <div key={rol.codigo} className="px-4 py-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              {nombreDelRol(rol, 'tarjeta')}
              <span className="shrink-0 text-[11px] text-gray-500">
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

      {abm && <div className="lg:hidden border-t border-gray-200 px-4 py-3">{crearRolControl}</div>}

      {/* RF-28: por dónde entra cada rol. */}
      {matriz.inicioDisponible && (
        <div className="border-t border-gray-200 px-4 sm:px-5 py-4 space-y-3">
          <div>
            <h5 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <DoorOpen className="h-4 w-4 shrink-0 text-[#DC143C]" />
              Por dónde entra cada rol
            </h5>
            <p className="text-xs text-gray-600 mt-1">
              La pantalla que ve cada uno apenas entra al sistema. Si a una persona le elegís otra en la lista de
              usuarios, vale la suya. No da permisos: si el rol no puede ver esa pantalla, entra al Dashboard (o a
              la primera que pueda ver). Vale desde la próxima vez que cada uno abra el sistema.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {matriz.roles.map((rol) => (
              <label key={rol.codigo} className="block min-w-0 rounded-lg border border-gray-200 px-3 py-2.5">
                <span className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-800">{rol.nombre}</span>
                  <span className="text-[11px] text-gray-500">
                    {rol.usuarios_activos} persona{rol.usuarios_activos === 1 ? '' : 's'}
                  </span>
                </span>
                {selectorDeInicio(rol)}
              </label>
            ))}
          </div>
        </div>
      )}

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

      <Dialog open={!!borrando} onOpenChange={(v) => !v && !ocupadoRol && setBorrando(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Borrar rol</DialogTitle>
            <DialogDescription>
              {borrando ? (
                <>
                  Vas a borrar el rol <b className="text-gray-900">{borrando.nombre}</b> con sus permisos. Nadie lo
                  tiene, así que no le cambia nada a nadie. No se puede deshacer: si hace falta de nuevo, se crea otra
                  vez.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {errorBorrar && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorBorrar}</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBorrando(null)} disabled={ocupadoRol}>
              Cancelar
            </Button>
            <Button onClick={() => void borrarRol()} disabled={ocupadoRol} className="bg-red-600 hover:bg-red-700 text-white">
              {ocupadoRol ? 'Borrando…' : 'Borrar rol'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
