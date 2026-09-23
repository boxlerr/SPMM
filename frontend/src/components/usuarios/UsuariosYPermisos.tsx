'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, RefreshCw, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { capitalizeName } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { usePermisos } from '@/hooks/usePermisos';
import { MarcaSoloLectura } from '@/components/permisos/SinAcceso';
import { nombreDePantalla, puedeAbrirRuta } from '@/lib/permisos';
import {
  conPersonaMovida,
  faltaServidor,
  inicioDePersona,
  leerMatriz,
  leerPermisosDeMas,
  mensajeDeError,
  nombreDePersona,
  permisosDeLaPersona,
  type Matriz,
  type PermisoDeMas,
} from '@/lib/permisosAdmin';
import { datos, pedir, type RolElegible, type UsuarioFila } from './api';
import UsuariosTable, { type InicioDeLaLista } from './UsuariosTable';
import NuevoUsuarioDialog from './NuevoUsuarioDialog';
import EditarUsuarioDialog from './EditarUsuarioDialog';
import RolesPermisosMatrix from './RolesPermisosMatrix';
import SeccionesConfidencialEditor from './SeccionesConfidencialEditor';
import UsuarioPermisosOverrides from './UsuarioPermisosOverrides';
import HelpUsuariosDialog from './HelpUsuariosDialog';
import { claseDeRol } from './area-meta';

/**
 * «Usuarios y permisos», la solapa de Configuración (RF-24, RF-26). Es la página
 * usuarios/page.tsx de Don Joaquín: arriba la lista de usuarios, después la matriz de
 * roles, las secciones confidenciales y los permisos puntuales por persona. Sin el
 * bloqueo por horario, que Julián descartó.
 *
 * QUIÉN VE QUÉ
 * - La solapa entera es la sección confidencial «Usuarios y permisos» (la esconde la
 *   página de Configuración a quien no la tiene).
 * - CAMBIAR cualquier cosa es sólo del rol Administrador (el backend lo exige contra la
 *   base: quien toca permisos se da admin solo). A otro que tenga la sección abierta se le
 *   muestra todo en lectura, con la marca «Solo lectura».
 *
 * BACKEND VIEJO
 * Producción corre un backend de antes de esta pantalla hasta que Julián lo deploya a
 * mano. Ahí /permisos/* no existe (404): la lista de usuarios sigue como siempre (alta,
 * edición, baja y desbloqueo, con rol Administrador que es el único que hay) y un aviso
 * chico dice que la gestión de permisos llega al actualizar el servidor. Nada se rompe
 * ni se esconde porque falte un campo.
 *
 * CÓMO SE GUARDA
 * Todo cambio se pinta al toque y va al servidor de fondo; si falla, vuelve atrás y dice
 * por qué. No se recarga la pantalla ni se tapa la lista con un cartel de «cargando».
 *
 * PANTALLA DE INICIO (RF-28)
 * Por dónde entra cada uno después del login: por persona («Entra por», en la lista) y
 * por rol (en la matriz). La de la persona pisa la de su rol. Se muestra sólo si el
 * servidor la manda (backend y base al día); si no, la lista queda como siempre.
 */

type EstadoPermisos =
  | { tipo: 'cargando' }
  | { tipo: 'listo' }
  /** El servidor no tiene /permisos/* (backend de antes de esta pantalla). */
  | { tipo: 'viejo' }
  | { tipo: 'error'; mensaje: string };

export default function UsuariosYPermisos() {
  const { user } = useAuth();
  const { esAdmin } = usePermisos();
  const { showToast } = useToast();
  const idActual = typeof user?.id_usuario === 'number' ? user.id_usuario : null;
  const nombreActual = user ? nombreDePersona(user) : null;

  const [usuarios, setUsuarios] = useState<UsuarioFila[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [errorUsuarios, setErrorUsuarios] = useState<string | null>(null);
  const [guardandoRol, setGuardandoRol] = useState<ReadonlySet<number>>(new Set());
  const [guardandoInicio, setGuardandoInicio] = useState<ReadonlySet<number>>(new Set());

  const [matriz, setMatriz] = useState<Matriz | null>(null);
  const [permisosDeMas, setPermisosDeMas] = useState<PermisoDeMas[] | null>(null);
  const [estado, setEstado] = useState<EstadoPermisos>({ tipo: 'cargando' });

  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [editando, setEditando] = useState<UsuarioFila | null>(null);
  const [eliminando, setEliminando] = useState<UsuarioFila | null>(null);
  const [eliminandoOcupado, setEliminandoOcupado] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  // ── cargar ──

  /** `silencioso`: sin el cartel de «cargando» (después de un alta, por ejemplo). */
  const cargarUsuarios = useCallback(async (silencioso: boolean) => {
    if (!silencioso) setCargandoUsuarios(true);
    // Con los que no tienen acceso («Eliminar» desactiva): la lista los muestra aparte
    // para poder devolvérselo. Un backend viejo ignora el parámetro y manda los activos.
    const r = await pedir('/auth/usuarios?incluir_inactivos=true');
    if (!silencioso) setCargandoUsuarios(false);
    const lista = datos(r);
    if (r.ok && Array.isArray(lista)) {
      setUsuarios(lista as UsuarioFila[]);
      setErrorUsuarios(null);
      return;
    }
    // En silencio no se pisa la lista que se ve por un pedido que falló.
    if (!silencioso) {
      setErrorUsuarios(
        r.red
          ? 'No se pudo cargar la lista de usuarios: revisá la conexión.'
          : mensajeDeError(r.cuerpo, 'No se pudo cargar la lista de usuarios.'),
      );
    }
  }, []);

  const cargarPermisos = useCallback(async () => {
    setEstado({ tipo: 'cargando' });
    const [rm, ro] = await Promise.all([pedir('/permisos/matriz'), pedir('/permisos/overrides')]);
    if (!rm.ok) {
      if (faltaServidor(rm.status, rm.cuerpo)) {
        setEstado({ tipo: 'viejo' });
      } else if (rm.status === 403) {
        // Lo avisa el interceptor («No tenés permiso para esto»); acá sólo no se muestra.
        setEstado({ tipo: 'error', mensaje: 'Tu usuario no puede ver los permisos.' });
      } else {
        setEstado({
          tipo: 'error',
          mensaje: rm.red
            ? 'No se pudieron cargar los permisos: revisá la conexión.'
            : mensajeDeError(rm.cuerpo, 'No se pudieron cargar los permisos.'),
        });
      }
      return;
    }
    const m = leerMatriz(datos(rm));
    if (!m) {
      setEstado({ tipo: 'error', mensaje: 'El servidor mandó los permisos en una forma que esta pantalla no entiende.' });
      return;
    }
    setMatriz(m);
    // Los permisos puntuales son aparte: si no vienen, se muestra el resto igual.
    setPermisosDeMas(ro.ok ? leerPermisosDeMas(datos(ro)) : null);
    setEstado({ tipo: 'listo' });
  }, []);

  useEffect(() => {
    void cargarUsuarios(false);
    void cargarPermisos();
  }, [cargarUsuarios, cargarPermisos]);

  const roles: RolElegible[] | null = useMemo(
    () => (matriz ? matriz.roles.map((r) => ({ codigo: r.codigo, nombre: r.nombre })) : null),
    [matriz],
  );

  // ── cambiar el rol, desde la lista ──

  const cambiarRol = async (u: UsuarioFila, rol: string) => {
    const antes = u.rol;
    if (antes === rol) return;
    const aplicar = (valor: string, de: string) => {
      setUsuarios((prev) => prev.map((x) => (x.id_usuario === u.id_usuario ? { ...x, rol: valor } : x)));
      if (u.activo) setMatriz((m) => (m ? conPersonaMovida(m, de, valor) : m));
    };
    aplicar(rol, antes);
    setGuardandoRol((s) => new Set(s).add(u.id_usuario));
    const r = await pedir(`/permisos/usuarios/${u.id_usuario}/rol`, { method: 'PUT', body: { rol } });
    setGuardandoRol((s) => {
      const n = new Set(s);
      n.delete(u.id_usuario);
      return n;
    });
    if (!r.ok) {
      aplicar(antes, rol);
      showToast(
        r.red
          ? 'No se pudo cambiar el rol: revisá la conexión.'
          : faltaServidor(r.status, r.cuerpo)
            ? 'No se pudo cambiar el rol: falta actualizar el servidor.'
            : mensajeDeError(r.cuerpo, 'No se pudo cambiar el rol.'),
        'error',
      );
      return;
    }
    const nombreRol = roles?.find((x) => x.codigo === rol)?.nombre ?? rol;
    showToast(`${capitalizeName(nombreDePersona(u))} ahora es ${nombreRol}. Vale desde lo próximo que haga.`, 'success');
  };

  // ── la pantalla de inicio de una persona (RF-28) ──

  /**
   * Se ve al toque y, si el servidor dice que no, vuelve a como estaba. Vale desde la
   * próxima vez que esa persona entre (o abra el sistema). No da ningún permiso: si no
   * puede ver la pantalla elegida, entra al Dashboard o a la primera que pueda ver, y la
   * lista lo avisa al lado del selector.
   */
  const cambiarInicio = async (u: UsuarioFila, ruta: string | null) => {
    const antes = u.pantalla_inicio ?? null;
    if (antes === ruta) return;
    const aplicar = (valor: string | null) =>
      setUsuarios((prev) => prev.map((x) => (x.id_usuario === u.id_usuario ? { ...x, pantalla_inicio: valor } : x)));
    const marcar = (prendido: boolean) =>
      setGuardandoInicio((s) => {
        const n = new Set(s);
        if (prendido) n.add(u.id_usuario);
        else n.delete(u.id_usuario);
        return n;
      });
    aplicar(ruta);
    marcar(true);
    const r = await pedir(`/permisos/usuarios/${u.id_usuario}/pantalla-inicio`, {
      method: 'PUT',
      body: { pantalla_inicio: ruta },
    });
    marcar(false);
    if (!r.ok) {
      aplicar(antes);
      showToast(
        r.red
          ? 'No se pudo cambiar la pantalla de inicio: revisá la conexión.'
          : faltaServidor(r.status, r.cuerpo)
            ? 'No se pudo cambiar la pantalla de inicio: falta actualizar el servidor.'
            : mensajeDeError(r.cuerpo, 'No se pudo cambiar la pantalla de inicio.'),
        'error',
      );
      return;
    }
    const quien = capitalizeName(nombreDePersona(u));
    const respuesta = datos(r) as { puede_abrirla?: unknown } | undefined;
    if (ruta === null) {
      showToast(`${quien} va a entrar por la pantalla de su rol.`, 'success');
    } else if (respuesta?.puede_abrirla === false) {
      showToast(
        `Guardado, pero ${quien} no puede ver ${nombreDePantalla(ruta) ?? ruta}: va a entrar por otra hasta que le den acceso.`,
        'info',
      );
    } else {
      showToast(`${quien} va a entrar por ${nombreDePantalla(ruta) ?? ruta} la próxima vez que abra el sistema.`, 'success');
    }
  };

  // Se ofrece sólo si la lista la trae: el servidor y la base ya la tienen.
  const inicioEnLaLista = usuarios.some((u) => u.pantalla_inicio !== undefined);

  const inicio: InicioDeLaLista | null = inicioEnLaLista
    ? {
        describir: (u: UsuarioFila) => {
          // Sin la matriz o sin los permisos de más no se sabe qué puede ver cada uno:
          // se ofrece igual, sin avisos (mejor callar que avisar algo que no es).
          if (!matriz || !permisosDeMas) return { textoNinguna: 'Como su rol', entraEnSuLugar: null };
          const permisos = permisosDeLaPersona(u, matriz, permisosDeMas);
          const comoSuRol = inicioDePersona({ ...u, pantalla_inicio: null }, matriz, permisosDeMas);
          const actual = inicioDePersona(u, matriz, permisosDeMas);
          return {
            textoNinguna: `Como su rol (${nombreDePantalla(comoSuRol.ruta) ?? comoSuRol.ruta})`,
            entraEnSuLugar: actual.fijadaSinAcceso ? actual.ruta : null,
            puedeAbrir: (ruta: string) => puedeAbrirRuta(permisos, ruta),
          };
        },
        guardando: guardandoInicio,
        onCambiar: (u: UsuarioFila, ruta: string | null) => void cambiarInicio(u, ruta),
      }
    : null;

  // ── desbloquear (RF-26) ──

  /**
   * Se ve al toque —la fila deja de decir «Bloqueado» antes de que conteste el servidor—
   * y si falla vuelve a como estaba. No pide confirmación: no se pierde nada, sólo deja
   * entrar antes a alguien que igual entraría solo a los 15 minutos.
   */
  const desbloquear = async (u: UsuarioFila) => {
    const antes = { bloqueado: u.bloqueado, bloqueado_hasta: u.bloqueado_hasta, intentos_fallidos: u.intentos_fallidos };
    const aplicar = (cambios: Partial<UsuarioFila>) =>
      setUsuarios((prev) => prev.map((x) => (x.id_usuario === u.id_usuario ? { ...x, ...cambios } : x)));
    aplicar({ bloqueado: false, bloqueado_hasta: null, intentos_fallidos: 0 });
    const r = await pedir(`/auth/usuarios/${u.id_usuario}/desbloquear`, { method: 'POST' });
    if (!r.ok) {
      aplicar(antes);
      showToast(
        r.red
          ? 'Error de conexión al desbloquear'
          : faltaServidor(r.status, r.cuerpo)
            ? 'No se pudo desbloquear: falta actualizar el servidor.'
            : mensajeDeError(r.cuerpo, `No se pudo desbloquear a '${u.username}'`),
        'error',
      );
      return;
    }
    showToast(`'${u.username}' desbloqueado: ya puede entrar`, 'success');
  };

  // ── alta, edición y baja ──

  const alCrear = (creado: UsuarioFila) => {
    // RF-28: recién creado no tiene pantalla de inicio propia (entra como su rol). El alta
    // no la devuelve; si la lista la conoce, va null y no «no se sabe».
    const nuevo: UsuarioFila =
      creado.pantalla_inicio === undefined && inicioEnLaLista ? { ...creado, pantalla_inicio: null } : creado;
    setUsuarios((prev) => [nuevo, ...prev.filter((x) => x.id_usuario !== nuevo.id_usuario)]);
    if (nuevo.activo) setMatriz((m) => (m ? conPersonaMovida(m, '', nuevo.rol) : m));
    // La campanita: el backend deja una notificación del alta.
    setTimeout(() => {
      const w = window as unknown as { reloadNotifications?: () => void };
      w.reloadNotifications?.();
    }, 500);
    // Los datos completos (fecha de alta, etc.), en silencio.
    void cargarUsuarios(true);
  };

  const alEditar = (cambios: Pick<UsuarioFila, 'id_usuario'> & Partial<UsuarioFila>) => {
    setUsuarios((prev) => prev.map((x) => (x.id_usuario === cambios.id_usuario ? { ...x, ...cambios } : x)));
    showToast('Datos guardados', 'success');
  };

  const eliminar = async () => {
    const u = eliminando;
    if (!u || eliminandoOcupado) return;
    setEliminandoOcupado(true);
    setErrorEliminar(null);
    const r = await pedir(`/auth/usuarios/${u.id_usuario}`, { method: 'DELETE' });
    setEliminandoOcupado(false);
    if (!r.ok) {
      setErrorEliminar(
        r.red ? 'No se pudo eliminar: revisá la conexión.' : mensajeDeError(r.cuerpo, 'No se pudo eliminar el usuario.'),
      );
      return;
    }
    // No sale de la lista: queda entre los que no tienen acceso, por si hay que
    // devolvérselo (en la base es lo mismo: activo = false).
    setUsuarios((prev) => prev.map((x) => (x.id_usuario === u.id_usuario ? { ...x, activo: false } : x)));
    if (u.activo) setMatriz((m) => (m ? conPersonaMovida(m, u.rol, '') : m));
    setEliminando(null);
    showToast(`'${u.username}' ya no puede entrar. Si fue un error, devolvele el acceso desde «Sin acceso».`, 'success');
  };

  // ── devolverle el acceso ──

  /**
   * A alguien eliminado (o desactivado): vuelve a poder entrar, con su rol y sus datos de
   * antes. Se ve al toque y, si el servidor dice que no, vuelve a como estaba. No pide
   * confirmación: no se pierde nada y se deshace con «Eliminar».
   */
  const devolverAcceso = async (u: UsuarioFila) => {
    if (u.activo) return;
    const aplicar = (activo: boolean) =>
      setUsuarios((prev) => prev.map((x) => (x.id_usuario === u.id_usuario ? { ...x, activo } : x)));
    aplicar(true);
    setMatriz((m) => (m ? conPersonaMovida(m, '', u.rol) : m));
    const r = await pedir(`/auth/usuarios/${u.id_usuario}`, { method: 'PUT', body: { activo: true } });
    if (!r.ok) {
      aplicar(false);
      setMatriz((m) => (m ? conPersonaMovida(m, u.rol, '') : m));
      showToast(
        r.red
          ? 'No se pudo devolver el acceso: revisá la conexión.'
          : mensajeDeError(r.cuerpo, `No se pudo devolverle el acceso a '${u.username}'.`),
        'error',
      );
      return;
    }
    showToast(`'${u.username}' puede volver a entrar`, 'success');
  };

  // ── el resumen de arriba ──

  const conteo = useMemo(() => {
    const porRol = new Map<string, number>();
    for (const u of usuarios) if (u.activo) porRol.set(u.rol, (porRol.get(u.rol) ?? 0) + 1);
    const orden = roles?.map((r) => r.codigo) ?? [];
    return Array.from(porRol.entries()).sort(
      (a, b) => (orden.indexOf(a[0]) + 1 || 99) - (orden.indexOf(b[0]) + 1 || 99),
    );
  }, [usuarios, roles]);

  // Cuántas personas tiene cada rol, contando a las que no tienen acceso: un rol con gente
  // no se borra (RolesPermisosMatrix). Sale de la lista, que ya las trae.
  const personasPorRol = useMemo(() => {
    const porRol = new Map<string, number>();
    for (const u of usuarios) porRol.set(u.rol, (porRol.get(u.rol) ?? 0) + 1);
    return porRol;
  }, [usuarios]);

  const nombreDeRol = (codigo: string) =>
    roles?.find((r) => r.codigo === codigo)?.nombre ?? (codigo === 'admin' ? 'Administrador' : capitalizeName(codigo));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-gray-900 mb-1">Usuarios y permisos</h3>
          <p className="text-sm text-gray-500">Quién entra al sistema y qué puede hacer cada uno.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HelpUsuariosDialog />
          {esAdmin ? (
            <Button
              size="sm"
              onClick={() => setNuevoAbierto(true)}
              className="bg-[#DC143C] hover:bg-[#B01030] text-white max-md:h-10"
            >
              <UserPlus className="h-4 w-4" />
              Nuevo usuario
            </Button>
          ) : (
            <MarcaSoloLectura que="los usuarios y sus permisos" />
          )}
        </div>
      </div>

      {!cargandoUsuarios && conteo.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span className="font-medium text-gray-900">
            {usuarios.filter((u) => u.activo).length} usuario{usuarios.filter((u) => u.activo).length === 1 ? '' : 's'}
          </span>
          {conteo.map(([codigo, n]) => (
            <span key={codigo} className={`rounded-full px-2 py-0.5 font-medium ${claseDeRol(codigo)}`}>
              {nombreDeRol(codigo)}: {n}
            </span>
          ))}
        </div>
      )}

      {estado.tipo === 'viejo' && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-900">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
          <span>
            Los roles y permisos (Supervisor, Operario, qué ve cada uno) llegan cuando se actualice el servidor.
            Mientras tanto, la lista de usuarios funciona como siempre.
          </span>
        </div>
      )}
      {estado.tipo === 'error' && (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <span className="flex-1 min-w-0">{estado.mensaje}</span>
          <Button variant="outline" size="sm" onClick={() => void cargarPermisos()} className="bg-white">
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
          </Button>
        </div>
      )}

      <UsuariosTable
        usuarios={usuarios}
        cargando={cargandoUsuarios}
        error={errorUsuarios}
        onReintentar={() => void cargarUsuarios(false)}
        roles={roles}
        puedeEditar={esAdmin}
        idActual={idActual}
        guardandoRol={guardandoRol}
        onCambiarRol={cambiarRol}
        onEditar={setEditando}
        onEliminar={(u) => {
          setErrorEliminar(null);
          setEliminando(u);
        }}
        onDesbloquear={desbloquear}
        onDevolverAcceso={devolverAcceso}
        inicio={inicio}
      />

      {estado.tipo === 'cargando' && (
        <p className="text-xs text-gray-500">Cargando roles y permisos…</p>
      )}

      {matriz && (
        <>
          <RolesPermisosMatrix
            matriz={matriz}
            setMatriz={setMatriz}
            puedeEditar={esAdmin}
            personasPorRol={cargandoUsuarios || errorUsuarios ? null : personasPorRol}
          />
          <SeccionesConfidencialEditor matriz={matriz} setMatriz={setMatriz} puedeEditar={esAdmin} />
          {permisosDeMas ? (
            <UsuarioPermisosOverrides
              usuarios={usuarios}
              matriz={matriz}
              permisos={permisosDeMas}
              setPermisos={setPermisosDeMas}
              puedeEditar={esAdmin}
              idActual={idActual}
              nombreActual={nombreActual}
            />
          ) : (
            <p className="text-xs text-gray-500">No se pudieron cargar los permisos puntuales por persona.</p>
          )}
        </>
      )}

      <NuevoUsuarioDialog
        open={nuevoAbierto}
        onOpenChange={setNuevoAbierto}
        roles={roles}
        matriz={matriz}
        onCreado={alCrear}
      />
      <EditarUsuarioDialog
        usuario={editando}
        open={!!editando}
        onOpenChange={(v) => !v && setEditando(null)}
        onGuardado={alEditar}
      />
      <Dialog open={!!eliminando} onOpenChange={(v) => !v && !eliminandoOcupado && setEliminando(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Eliminar usuario</DialogTitle>
            <DialogDescription>
              {eliminando ? (
                <>
                  Vas a sacarle el acceso a <b className="text-gray-900">{capitalizeName(nombreDePersona(eliminando))}</b> (
                  {eliminando.username}): no va a poder entrar más. Lo que cargó queda en el sistema con su nombre, y
                  si fue un error le podés devolver el acceso desde «Sin acceso», abajo de la lista.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {errorEliminar && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorEliminar}</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEliminando(null)} disabled={eliminandoOcupado}>
              Cancelar
            </Button>
            <Button onClick={eliminar} disabled={eliminandoOcupado} className="bg-red-600 hover:bg-red-700 text-white">
              {eliminandoOcupado ? 'Eliminando…' : 'Eliminar usuario'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
