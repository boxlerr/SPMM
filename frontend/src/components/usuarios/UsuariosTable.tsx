'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Edit,
  Lock,
  LockOpen,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { capitalizeName } from '@/lib/utils';
import { nombreDePersona } from '@/lib/permisosAdmin';
import { claseDeRol } from './area-meta';
import type { RolElegible, UsuarioFila } from './api';
import SelectorDePantalla from './SelectorDePantalla';

/**
 * El listado de usuarios de «Usuarios y permisos» (RF-24 y RF-26).
 *
 * Es el UsuariosListaClient de Don Joaquín, con lo de SPMM:
 * - El rol se cambia desde la misma fila (selector), y se ve al toque: si el servidor
 *   dice que no, vuelve a como estaba y avisa por qué. No se puede cambiar el propio rol,
 *   ni el de un administrador permanente (candado), igual que en DJ; el backend lo
 *   exige igual (application/reglas_de_roles.py).
 * - «Bloqueado hasta HH:MM» y el botón Desbloquear del RF-26 (5 contraseñas malas).
 * - «Entra por» (RF-28): la pantalla a la que entra cada uno después del login. La suya
 *   pisa la de su rol; «Como su rol» dice adónde lleva eso hoy. Si la elegida no la puede
 *   ver, avisa adónde va a entrar en su lugar.
 * - En la computadora es una tabla; en el teléfono, una tarjeta por persona (seis
 *   columnas no entran en 375px). Los controles son los mismos componentes.
 *
 * La lista y los cambios los maneja UsuariosYPermisos; esto sólo los muestra.
 */

/**
 * «21:04», o «23/09 00:05» si no es hoy. Se lee del texto tal cual y no con `new Date`:
 * el servidor ya la manda en hora del taller, y convertirla con la zona de la PC la
 * correría en una computadora con la zona mal puesta.
 */
function horaDeDesbloqueo(iso: string): string {
  const hora = iso.slice(11, 16);
  const hoy = new Date();
  const dia = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const suDia = `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return suDia === dia ? hora : `${suDia} ${hora}`;
}

/** «22/09/2026 20:10», leído del texto por lo mismo que horaDeDesbloqueo. */
function ultimoAcceso(iso: string | null): string {
  if (!iso) return 'Nunca';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}

function nombreDeRol(codigo: string, roles: RolElegible[] | null): string {
  const r = roles?.find((x) => x.codigo === codigo);
  if (r) return r.nombre;
  return codigo === 'admin' ? 'Administrador' : capitalizeName(codigo);
}

/** RF-28: lo que la lista necesita para mostrar y cambiar la pantalla de inicio. */
export interface InicioDeLaLista {
  /** Cómo se ve la de cada uno (lo arma UsuariosYPermisos con la matriz y sus permisos). */
  describir: (u: UsuarioFila) => {
    /** La opción «ninguna»: «Como su rol (Operaciones)». */
    textoNinguna: string;
    /** Si la suya no la puede ver: adónde entra en su lugar. */
    entraEnSuLugar: string | null;
    puedeAbrir?: (ruta: string) => boolean;
  };
  /** Filas con un cambio esperando al servidor. */
  guardando: ReadonlySet<number>;
  onCambiar: (u: UsuarioFila, ruta: string | null) => void;
}

interface Props {
  usuarios: UsuarioFila[];
  cargando: boolean;
  error: string | null;
  onReintentar: () => void;
  /** Los roles que hay. null = no se sabe (backend viejo): el rol se muestra y no se cambia. */
  roles: RolElegible[] | null;
  /** Rol admin: da de alta, edita, cambia roles, desbloquea y elimina. */
  puedeEditar: boolean;
  idActual: number | null;
  /** Filas con un cambio de rol esperando al servidor. */
  guardandoRol: ReadonlySet<number>;
  onCambiarRol: (u: UsuarioFila, rol: string) => void;
  onEditar: (u: UsuarioFila) => void;
  onEliminar: (u: UsuarioFila) => void;
  onDesbloquear: (u: UsuarioFila) => void;
  /** RF-28. null = no se muestra: el servidor (o la base) todavía no la tiene. */
  inicio: InicioDeLaLista | null;
}

export default function UsuariosTable({
  usuarios,
  cargando,
  error,
  onReintentar,
  roles,
  puedeEditar,
  idActual,
  guardandoRol,
  onCambiarRol,
  onEditar,
  onEliminar,
  onDesbloquear,
  inicio,
}: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [rolFiltro, setRolFiltro] = useState('');

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (rolFiltro && u.rol !== rolFiltro) return false;
      if (!q) return true;
      return [u.username, u.email, u.nombre, u.apellido]
        .some((x) => (x || '').toLowerCase().includes(q));
    });
  }, [usuarios, busqueda, rolFiltro]);

  // Para el filtro: los roles que hay, o (backend viejo) los que aparecen en la lista.
  const rolesDelFiltro: RolElegible[] = useMemo(() => {
    if (roles) return roles;
    const vistos = Array.from(new Set(usuarios.map((u) => u.rol)));
    return vistos.map((codigo) => ({ codigo, nombre: nombreDeRol(codigo, null) }));
  }, [roles, usuarios]);

  const reglas = (u: UsuarioFila) => {
    const esVos = idActual !== null && u.id_usuario === idActual;
    const permanente = u.admin_permanente === true;
    return {
      esVos,
      permanente,
      rolEditable: puedeEditar && !!roles && !esVos && !permanente,
      // Eliminarse a uno mismo o a un administrador permanente: el backend dice que no.
      eliminable: puedeEditar && !esVos && !permanente,
    };
  };

  // Funciones que devuelven JSX, no componentes: un componente definido adentro de otro
  // se vuelve a montar en cada render (el selector perdería el foco al guardar).
  const rolControl = (u: UsuarioFila) => {
    const r = reglas(u);
    const guardando = guardandoRol.has(u.id_usuario);
    if (r.rolEditable && roles) {
      const opciones = roles.some((x) => x.codigo === u.rol)
        ? roles
        : [...roles, { codigo: u.rol, nombre: nombreDeRol(u.rol, null) }];
      return (
        <select
          aria-label={`Rol de ${nombreDePersona(u)}`}
          value={u.rol}
          disabled={guardando}
          onChange={(e) => onCambiarRol(u, e.target.value)}
          className={`h-9 max-md:h-10 w-full sm:w-40 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 transition-opacity focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30 ${guardando ? 'opacity-60' : ''}`}
        >
          {opciones.map((x) => (
            <option key={x.codigo} value={x.codigo}>
              {x.nombre}
            </option>
          ))}
        </select>
      );
    }
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${claseDeRol(u.rol)}`}>
          {nombreDeRol(u.rol, roles)}
        </span>
        {r.permanente && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-gray-500"
            title="Administrador permanente: su rol no se puede cambiar, ni se lo puede desactivar ni eliminar."
          >
            <Lock className="h-3 w-3" />
            Permanente
          </span>
        )}
        {r.esVos && !r.permanente && (
          <span
            className="text-[11px] text-gray-500"
            title="Tu propio rol te lo cambia otro administrador."
          >
            (vos)
          </span>
        )}
      </span>
    );
  };

  const inicioControl = (u: UsuarioFila) => {
    // Una fila sin la clave (no debería pasar si la lista la trae): no se sabe.
    if (!inicio || u.pantalla_inicio === undefined) return <span className="text-sm text-gray-400">—</span>;
    const d = inicio.describir(u);
    return (
      <SelectorDePantalla
        valor={u.pantalla_inicio}
        textoNinguna={d.textoNinguna}
        puedeAbrir={d.puedeAbrir}
        entraEnSuLugar={d.entraEnSuLugar}
        editable={puedeEditar}
        guardando={inicio.guardando.has(u.id_usuario)}
        etiqueta={`Pantalla de inicio de ${nombreDePersona(u)}`}
        onCambiar={(ruta) => inicio.onCambiar(u, ruta)}
        className="w-full sm:w-56"
      />
    );
  };

  const columnas = ['Usuario', 'Nombre', 'Rol', ...(inicio ? ['Entra por'] : []), 'Estado', 'Último acceso', ''];
  // Con la columna de más, un poco menos de aire: así la tabla entra en una notebook de
  // 1366 px con el menú abierto, sin barra de desplazamiento.
  const px = inicio ? 'px-3 xl:px-4' : 'px-4 xl:px-6';

  const estadoControl = (u: UsuarioFila) => (
    <div>
      {u.activo ? (
        <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
          Activo
        </span>
      ) : (
        <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
          Inactivo
        </span>
      )}
      {/* RF-26: bloqueado por 5 contraseñas malas seguidas. Se levanta solo a esa hora;
          el botón es para no tenerlo esperando. */}
      {u.bloqueado && u.bloqueado_hasta ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center whitespace-nowrap px-2 py-1 text-xs font-medium bg-amber-100 text-amber-900 rounded-full"
            title="5 contraseñas incorrectas seguidas. Se desbloquea solo a esa hora."
          >
            <Lock className="h-3 w-3 mr-1" />
            Bloqueado hasta {horaDeDesbloqueo(u.bloqueado_hasta)}
          </span>
          {puedeEditar && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 max-md:h-9 px-2 text-xs"
              onClick={() => onDesbloquear(u)}
            >
              <LockOpen className="h-3 w-3 mr-1" />
              Desbloquear
            </Button>
          )}
        </div>
      ) : u.intentos_fallidos ? (
        <div
          className="mt-1 text-xs text-gray-500"
          title="Contraseñas incorrectas seguidas desde su último ingreso. Al llegar a 5 se bloquea 15 minutos."
        >
          {u.intentos_fallidos} {u.intentos_fallidos === 1 ? 'intento fallido' : 'intentos fallidos'}
        </div>
      ) : null}
    </div>
  );

  const acciones = (u: UsuarioFila) => {
    const r = reglas(u);
    if (!puedeEditar) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-md:h-10 max-md:w-10" aria-label={`Acciones sobre ${nombreDePersona(u)}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEditar(u)}>
            <Edit className="h-4 w-4 mr-2" />
            Editar datos
          </DropdownMenuItem>
          {u.bloqueado && (
            <DropdownMenuItem onClick={() => onDesbloquear(u)}>
              <LockOpen className="h-4 w-4 mr-2" />
              Desbloquear
            </DropdownMenuItem>
          )}
          {r.eliminable && (
            <DropdownMenuItem onClick={() => onEliminar(u)} className="text-red-600">
              <Trash2 className="h-4 w-4 mr-2" />
              Eliminar
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const vacio = (
    <div className="px-4 py-12 text-center">
      <AlertCircle className="h-10 w-10 text-gray-300 mx-auto mb-2" />
      <p className="text-gray-500 text-sm">
        {busqueda || rolFiltro ? 'No hay usuarios que coincidan' : 'No hay usuarios registrados'}
      </p>
    </div>
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="flex flex-col gap-3 px-4 sm:px-5 py-4 border-b border-gray-200 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-gray-900">Usuarios</h4>
          {!cargando && (
            <span className="text-xs text-gray-500">
              {filtrados.length} de {usuarios.length}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            aria-label="Filtrar por rol"
            value={rolFiltro}
            onChange={(e) => setRolFiltro(e.target.value)}
            className="h-9 max-md:h-10 w-full sm:w-44 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30"
          >
            <option value="">Todos los roles</option>
            {rolesDelFiltro.map((r) => (
              <option key={r.codigo} value={r.codigo}>
                {r.nombre}
              </option>
            ))}
          </select>
          <div className="relative w-full sm:w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              type="search"
              placeholder="Buscar usuario..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9 max-md:h-10"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-2.5 bg-red-50 border-b border-red-200 text-red-700 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <Button variant="outline" size="sm" onClick={onReintentar}>
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
          </Button>
        </div>
      )}

      {cargando ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#DC143C] mx-auto mb-3"></div>
            <p className="text-gray-600 text-sm">Cargando usuarios...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Computadora: tabla (con el menú al costado, recién desde lg entra cómoda). */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {columnas.map((col, i) => (
                    <th
                      key={i}
                      className={`${px} py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtrados.length === 0 ? (
                  <tr>
                    <td colSpan={columnas.length}>{vacio}</td>
                  </tr>
                ) : (
                  filtrados.map((u) => (
                    <tr key={u.id_usuario} className="hover:bg-gray-50 transition-colors">
                      <td className={`${px} py-4`}>
                        <div className="font-medium text-gray-900">{u.username}</div>
                        <div className="max-w-[16rem] truncate text-sm text-gray-500" title={u.email}>{u.email}</div>
                      </td>
                      <td className={`${px} py-4 text-gray-900`}>
                        {capitalizeName(u.nombre)} {capitalizeName(u.apellido)}
                      </td>
                      <td className={`${px} py-4`}>
                        {rolControl(u)}
                      </td>
                      {inicio && (
                        <td className={`${px} py-4`}>
                          {inicioControl(u)}
                        </td>
                      )}
                      <td className={`${px} py-4`}>
                        {estadoControl(u)}
                      </td>
                      <td className={`${px} py-4 whitespace-nowrap text-sm text-gray-500`}>
                        {ultimoAcceso(u.ultimo_login)}
                      </td>
                      <td className={`${px} py-4 text-right`}>
                        {acciones(u)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Teléfono y tableta: una tarjeta por persona. */}
          <div className="lg:hidden divide-y divide-gray-200">
            {filtrados.length === 0
              ? vacio
              : filtrados.map((u) => (
                  <div key={u.id_usuario} className="px-4 py-3.5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {capitalizeName(u.nombre)} {capitalizeName(u.apellido)}
                        </p>
                        <p className="text-xs text-gray-500 break-all">
                          {u.username} · {u.email}
                        </p>
                      </div>
                      {acciones(u)}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500 shrink-0">Rol</span>
                      <div className="min-w-0 flex justify-end flex-1">
                        {rolControl(u)}
                      </div>
                    </div>
                    {inicio && (
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-xs text-gray-500 shrink-0 pt-2.5">Entra por</span>
                        <div className="min-w-0 flex justify-end flex-1">
                          {inicioControl(u)}
                        </div>
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-xs text-gray-500 shrink-0 pt-1">Estado</span>
                      <div className="min-w-0 flex justify-end text-right">
                        {estadoControl(u)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500 shrink-0">Último acceso</span>
                      <span className="text-xs text-gray-500">{ultimoAcceso(u.ultimo_login)}</span>
                    </div>
                  </div>
                ))}
          </div>
        </>
      )}
    </div>
  );
}
