'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, Clock, Lock, ShieldPlus, Trash2 } from 'lucide-react';
import { ARBOL, type AreaCodigo, type Nivel, type SeccionCodigo } from '@/lib/permisos';
import {
  ahoraSinZona,
  confidencialesDe,
  faltaServidor,
  finDeHoy,
  leerVencimiento,
  mensajeDeError,
  mismoPermiso,
  nivelesDePersona,
  nombreDePermiso,
  nombreDePersona,
  opcionesDePermisoDeMas,
  textoDeVencimiento,
  type Matriz,
  type PermisoDeMas,
} from '@/lib/permisosAdmin';
import { Button } from '@/components/ui/button';
import { capitalizeName } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { NIVEL_INFO } from './area-meta';
import { mensajeOk, pedir, type UsuarioFila } from './api';

/**
 * Permisos puntuales por persona (UsuarioPermisosOverrides de Don Joaquín).
 *
 * Un permiso de más para UNA persona, encima de su rol: una pantalla entera o una solapa
 * (incluida una confidencial), para ver o para editar, con vencimiento opcional y un
 * motivo. SOLO SUMAN: nunca le sacan nada de lo que le da el rol. El que vence deja de
 * contar solo, a esa hora (se sigue mostrando, tachado: saber que alguien tuvo algo
 * hasta ayer también sirve).
 *
 * No se le dan a un Administrador (ya puede todo) ni a uno mismo (el backend lo rechaza:
 * que te lo dé otro administrador).
 */

interface Props {
  usuarios: UsuarioFila[];
  matriz: Matriz;
  permisos: PermisoDeMas[];
  setPermisos: Dispatch<SetStateAction<PermisoDeMas[] | null>>;
  puedeEditar: boolean;
  idActual: number | null;
  nombreActual: string | null;
}

const clave = (p: Pick<PermisoDeMas, 'tipo' | 'codigo'>) => `${p.tipo}:${p.codigo}`;

export default function UsuarioPermisosOverrides({
  usuarios,
  matriz,
  permisos,
  setPermisos,
  puedeEditar,
  idActual,
  nombreActual,
}: Props) {
  const { showToast } = useToast();
  const conf = confidencialesDe(matriz);
  const opciones = useMemo(() => opcionesDePermisoDeMas(), []);
  const nombreDeRol = (codigo: string) => matriz.roles.find((r) => r.codigo === codigo)?.nombre ?? codigo;

  const elegibles = usuarios
    .filter((u) => u.activo && u.rol !== 'admin' && u.id_usuario !== idActual)
    .sort((a, b) => nombreDePersona(a).localeCompare(nombreDePersona(b), 'es'));

  const [persona, setPersona] = useState('');
  const [que, setQue] = useState('');
  const [nivel, setNivel] = useState<Nivel>('read');
  const [vence, setVence] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const elegida = opciones.find((o) => clave(o) === que) ?? null;
  const niveles = elegida ? nivelesDePersona(elegida.codigo) : (['read', 'write'] as Nivel[]);
  const nivelElegido: Nivel = niveles.includes(nivel) ? nivel : niveles[0];

  const textoError = (r: { red: boolean; status: number; cuerpo: unknown }, porDefecto: string) =>
    r.red
      ? 'No se pudo guardar: revisá la conexión.'
      : faltaServidor(r.status, r.cuerpo)
        ? 'No se pudo guardar: falta actualizar el servidor.'
        : mensajeDeError(r.cuerpo, porDefecto);

  const dar = async () => {
    setError(null);
    const idPersona = Number(persona);
    if (!idPersona || !elegida) {
      setError('Elegí a quién y qué le das.');
      return;
    }
    const venc = leerVencimiento(vence, new Date());
    if (!venc.ok) {
      setError(venc.error);
      return;
    }
    const nuevo: PermisoDeMas = {
      tipo: elegida.tipo,
      id_usuario: idPersona,
      codigo: elegida.codigo,
      nivel: nivelElegido,
      vence_en: venc.valor,
      vigente: true,
      motivo: motivo.trim() || null,
      otorgado_por: idActual,
      otorgado_por_nombre: nombreActual,
      creado_en: ahoraSinZona(new Date()),
      persona: nombreDePersona(usuarios.find((u) => u.id_usuario === idPersona) ?? {}),
    };
    const previo = permisos.find((p) => mismoPermiso(p, nuevo)) ?? null;
    // Se ve al toque; si el servidor dice que no, vuelve a como estaba.
    setPermisos((prev) => [...(prev ?? []).filter((p) => !mismoPermiso(p, nuevo)), nuevo]);
    setGuardando(true);
    const ruta = `/permisos/usuarios/${idPersona}/${elegida.tipo === 'area' ? 'areas' : 'secciones'}/${elegida.codigo}`;
    const r = await pedir(ruta, {
      method: 'PUT',
      body: { nivel: nivelElegido, vence_en: venc.valor, motivo: motivo.trim() || null },
    });
    setGuardando(false);
    if (!r.ok) {
      setPermisos((prev) => {
        const sin = (prev ?? []).filter((p) => !mismoPermiso(p, nuevo));
        return previo ? [...sin, previo] : sin;
      });
      setError(textoError(r, 'No se pudo dar el permiso.'));
      return;
    }
    showToast(mensajeOk(r, 'Permiso dado'), 'success');
    setQue('');
    setVence('');
    setMotivo('');
  };

  const quitar = async (p: PermisoDeMas) => {
    setError(null);
    setPermisos((prev) => (prev ?? []).filter((x) => !mismoPermiso(x, p)));
    const ruta = `/permisos/usuarios/${p.id_usuario}/${p.tipo === 'area' ? 'areas' : 'secciones'}/${p.codigo}`;
    const r = await pedir(ruta, { method: 'DELETE' });
    if (!r.ok) {
      setPermisos((prev) => [...(prev ?? []).filter((x) => !mismoPermiso(x, p)), p]);
      setError(textoError(r, 'No se pudo sacar el permiso.'));
    }
  };

  // Agrupados por persona, en el orden de los nombres.
  const porPersona = useMemo(() => {
    const grupos = new Map<number, PermisoDeMas[]>();
    for (const p of permisos) {
      if (!grupos.has(p.id_usuario)) grupos.set(p.id_usuario, []);
      grupos.get(p.id_usuario)!.push(p);
    }
    const orden = (p: PermisoDeMas) => {
      const i = opciones.findIndex((o) => o.tipo === p.tipo && o.codigo === p.codigo);
      return i < 0 ? 999 : i;
    };
    return Array.from(grupos.entries())
      .map(([id, filas]) => ({
        id,
        usuario: usuarios.find((u) => u.id_usuario === id) ?? null,
        nombre: filas[0].persona,
        filas: [...filas].sort((a, b) => orden(a) - orden(b)),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [permisos, usuarios, opciones]);

  const campo = 'h-9 max-md:h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30';

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-200 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldPlus className="h-4 w-4 text-[#DC143C] shrink-0" />
          <h4 className="text-sm font-semibold text-gray-900">Permisos puntuales por persona</h4>
        </div>
        <p className="text-xs text-gray-600">
          Algo de más para <b className="text-gray-900">una sola persona</b>, encima de su rol, sin cambiárselo a
          todo el grupo. <b className="text-gray-900">Siempre suma, nunca resta.</b> Con fecha de vencimiento se
          saca solo a esa hora: ideal para cubrir a alguien que está de licencia.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 sm:px-5 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {puedeEditar && (
        <div className="px-4 sm:px-5 py-4 border-b border-gray-200 bg-gray-50/60">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Dar un permiso</p>
          {elegibles.length === 0 ? (
            <p className="text-sm text-gray-600">
              No hay a quién: todos los demás usuarios son Administradores, y un Administrador ya puede todo.
              Los permisos puntuales sirven para alguien con otro rol.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.3fr)]">
                <label className="grid gap-1">
                  <span className="text-xs text-gray-600">Persona</span>
                  <select value={persona} onChange={(e) => setPersona(e.target.value)} className={campo}>
                    <option value="">Elegí…</option>
                    {elegibles.map((u) => (
                      <option key={u.id_usuario} value={u.id_usuario}>
                        {capitalizeName(nombreDePersona(u))} ({nombreDeRol(u.rol)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-gray-600">Qué</span>
                  <select value={que} onChange={(e) => setQue(e.target.value)} className={campo}>
                    <option value="">Elegí…</option>
                    {ARBOL.map((pagina) => (
                      <optgroup key={pagina.area} label={pagina.nombre}>
                        {opciones
                          .filter((o) => o.area === pagina.area)
                          .map((o) => (
                            <option key={clave(o)} value={clave(o)}>
                              {o.tipo === 'area'
                                ? `${pagina.nombre}: toda la pantalla`
                                : `${o.nombre}${conf[o.codigo as SeccionCodigo] ? ' (confidencial)' : ''}`}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-gray-600">Para</span>
                  <select value={nivelElegido} onChange={(e) => setNivel(e.target.value as Nivel)} className={campo}>
                    {niveles.map((n) => (
                      <option key={n} value={n}>
                        {NIVEL_INFO[n].label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-1">
                  <label htmlFor="pp-vence" className="flex items-center gap-1 text-xs text-gray-600">
                    <Clock className="h-3 w-3" />
                    Vence (vacío = permanente)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id="pp-vence"
                      type="datetime-local"
                      value={vence}
                      onChange={(e) => setVence(e.target.value)}
                      className={`${campo} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() => setVence(finDeHoy(new Date()))}
                      title="Sólo por hoy, hasta las 23:59"
                      className="h-9 max-md:h-10 shrink-0 rounded-md border border-gray-300 bg-white px-3 text-xs text-gray-700 hover:bg-gray-100"
                    >
                      Hoy
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={500}
                  placeholder="Motivo (opcional): «cubre a Sofía mientras está de licencia»"
                  className={`${campo} sm:flex-1`}
                />
                <Button
                  type="button"
                  onClick={dar}
                  disabled={guardando || !persona || !elegida}
                  className="bg-[#DC143C] hover:bg-[#B01030] text-white max-md:h-10"
                >
                  {guardando ? 'Dando…' : 'Dar permiso'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {porPersona.length === 0 ? (
        <div className="px-4 sm:px-5 py-8 text-center text-sm text-gray-500">
          Nadie tiene permisos puntuales: cada uno puede lo que dice su rol.
        </div>
      ) : (
        <div className="divide-y divide-gray-200">
          {porPersona.map((g) => (
            <div key={g.id} className="px-4 sm:px-5 py-3">
              <p className="text-xs font-semibold text-gray-900 mb-2">
                {capitalizeName(g.nombre)}
                {g.usuario ? (
                  <span className="ml-1 font-normal text-gray-500">({nombreDeRol(g.usuario.rol)})</span>
                ) : (
                  <span className="ml-1 font-normal text-gray-500">(ya no está en la lista)</span>
                )}
                {g.usuario?.rol === 'admin' && (
                  <span className="ml-1 font-normal text-amber-700">· es Administrador: esto no le suma nada</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {g.filas.map((p) => {
                  const esConf = p.tipo === 'seccion' && !!conf[p.codigo as SeccionCodigo];
                  return (
                    <div
                      key={clave(p)}
                      className={`flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${
                        p.vigente
                          ? 'border-sky-200 bg-sky-50 text-sky-900'
                          : 'border-dashed border-gray-300 bg-gray-50 text-gray-400 line-through decoration-gray-300'
                      }`}
                    >
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium no-underline ${NIVEL_INFO[p.nivel].clase}`}>
                        {NIVEL_INFO[p.nivel].label}
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1 font-semibold">
                        {esConf && <Lock className="h-2.5 w-2.5 shrink-0" />}
                        {nombreDePermiso(p.tipo, p.codigo as AreaCodigo | SeccionCodigo)}
                      </span>
                      <span className="font-normal text-gray-500">
                        · {p.vigente ? textoDeVencimiento(p.vence_en) : `venció (${textoDeVencimiento(p.vence_en).replace(/^hasta el /, '')})`}
                      </span>
                      {p.motivo && <span className="italic text-gray-500">«{p.motivo}»</span>}
                      {p.otorgado_por_nombre && (
                        <span className="text-gray-400">· lo dio {p.otorgado_por_nombre}</span>
                      )}
                      {puedeEditar && (
                        <button
                          type="button"
                          onClick={() => quitar(p)}
                          title="Sacar este permiso"
                          aria-label={`Sacarle a ${g.nombre} ${nombreDePermiso(p.tipo, p.codigo)}`}
                          className="ml-auto flex items-center justify-center rounded p-0.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 max-md:size-9 sm:ml-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
