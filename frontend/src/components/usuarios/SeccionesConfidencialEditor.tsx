'use client';

import { Fragment, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, AlertTriangle, Lock, LockOpen, ShieldAlert } from 'lucide-react';
import { ARBOL, NIVEL_RANK, type SeccionCodigo } from '@/lib/permisos';
import {
  confidencialesDe,
  conConfidencial,
  faltaServidor,
  mensajeDeError,
  type Matriz,
} from '@/lib/permisosAdmin';
import { Button } from '@/components/ui/button';
import { NIVEL_INFO } from './area-meta';
import { pedir } from './api';

/**
 * Las secciones confidenciales (SeccionesConfidencialEditor de Don Joaquín).
 *
 * Una sección confidencial está CERRADA para todo el que no sea Administrador, aunque
 * su rol tenga la pantalla, salvo que se la abran a propósito (a un rol, en la matriz, o
 * a una persona, en los permisos puntuales). Está ordenado igual que el menú.
 *
 * Marcar es cerrar: se hace al toque. Desmarcar es ABRIR a todo rol que tenga la
 * pantalla: si eso le da acceso a alguien, el servidor avisa a quiénes (409) y acá se
 * ofrece «Sacarle la marca igual», que repite el pedido con ?forzar=true. Avisar, no
 * bloquear.
 */

interface Props {
  matriz: Matriz;
  setMatriz: Dispatch<SetStateAction<Matriz | null>>;
  puedeEditar: boolean;
}

export default function SeccionesConfidencialEditor({ matriz, setMatriz, puedeEditar }: Props) {
  const conf = confidencialesDe(matriz);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ seccion: SeccionCodigo; mensaje: string } | null>(null);
  const [guardando, setGuardando] = useState<SeccionCodigo | null>(null);

  const poner = async (seccion: SeccionCodigo, confidencial: boolean, forzar = false) => {
    const previo = !!conf[seccion];
    if (previo === confidencial) return;
    setError(null);
    setAviso(null);
    setGuardando(seccion);
    setMatriz((m) => (m ? conConfidencial(m, seccion, confidencial) : m));
    const r = await pedir(
      `/permisos/secciones/${seccion}/confidencial${forzar ? '?forzar=true' : ''}`,
      { method: 'PUT', body: { confidencial } },
    );
    setGuardando(null);
    if (r.ok) return;
    setMatriz((m) => (m ? conConfidencial(m, seccion, previo) : m));
    if (r.status === 409 && !confidencial && !forzar) {
      setAviso({ seccion, mensaje: mensajeDeError(r.cuerpo, 'Hay gente que la pasaría a ver.') });
      return;
    }
    setError(
      r.red
        ? 'No se pudo guardar: revisá la conexión.'
        : faltaServidor(r.status, r.cuerpo)
          ? 'No se pudo guardar: falta actualizar el servidor.'
          : mensajeDeError(r.cuerpo, 'No se pudo cambiar la marca de confidencial.'),
    );
  };

  /** Los roles (no admin) que la tienen abierta: para que se entienda qué cierra el candado. */
  const abiertaPara = (seccion: SeccionCodigo): string[] =>
    matriz.roles
      .filter((r) => !r.es_admin && NIVEL_RANK[r.secciones_efectivas[seccion] ?? 'none'] >= NIVEL_RANK.read)
      .map((r) => `${r.nombre} (${NIVEL_INFO[r.secciones_efectivas[seccion] ?? 'none'].label.toLowerCase()})`);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-200 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
          <h4 className="text-sm font-semibold text-gray-900">Secciones confidenciales</h4>
        </div>
        <p className="text-xs text-gray-600">
          Prendé el interruptor de una sección para hacerla <b className="text-gray-900">confidencial</b>: queda{' '}
          <b className="text-gray-900">cerrada para todos</b> salvo el Administrador, aunque el rol tenga la
          pantalla en Editar. Después se la podés abrir a un rol (arriba, en las solapas) o a una persona (abajo,
          en los permisos puntuales). Está ordenado igual que el menú.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 sm:px-5 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="p-3 sm:p-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {ARBOL.filter((p) => p.secciones.length > 0).map((pagina) => (
          <div key={pagina.area} className="self-start overflow-hidden rounded-lg border border-gray-200">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-bold uppercase tracking-wide text-gray-600">
              {pagina.nombre}
            </div>
            <div className="divide-y divide-gray-100">
              {pagina.secciones.map((hoja) => {
                const on = !!conf[hoja.seccion];
                const ocupado = guardando === hoja.seccion;
                const abierta = on ? abiertaPara(hoja.seccion) : [];
                return (
                  <Fragment key={hoja.seccion}>
                    <div className="flex items-center justify-between gap-2 py-1.5 max-md:py-2 pl-3 pr-2">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-xs text-gray-900">
                          {on ? (
                            <Lock className="h-3 w-3 shrink-0 text-amber-600" />
                          ) : (
                            <LockOpen className="h-3 w-3 shrink-0 text-gray-300" />
                          )}
                          <span className="truncate">{hoja.nombre}</span>
                        </span>
                        {on && (
                          <span className="block pl-[18px] text-[11px] text-gray-500">
                            {abierta.length
                              ? `Abierta para: ${abierta.join(', ')}`
                              : 'Sólo la ve el Administrador (y a quien se la des).'}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={`text-[10px] font-semibold w-[76px] text-right ${on ? 'text-amber-600' : 'text-gray-400'}`}>
                          {on ? 'Confidencial' : 'Según el rol'}
                        </span>
                        {/* El botón es la zona táctil (40px en el teléfono); la pastilla de
                            adentro es lo que se ve. */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${pagina.nombre} › ${hoja.nombre}: ${on ? 'confidencial' : 'según el rol'}`}
                          disabled={!puedeEditar || ocupado}
                          onClick={() => poner(hoja.seccion, !on)}
                          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-md sm:size-auto sm:p-1 disabled:cursor-not-allowed ${ocupado ? 'opacity-60' : ''} ${!puedeEditar ? 'opacity-70' : 'hover:opacity-90'}`}
                        >
                          <span className={`relative block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-amber-500' : 'bg-gray-300'}`}>
                            <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                          </span>
                        </button>
                      </span>
                    </div>
                    {aviso?.seccion === hoja.seccion && (
                      <div className="mx-3 mb-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                        <div className="flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
                          <span>{aviso.mensaje}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 max-md:h-10 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                            onClick={() => poner(hoja.seccion, false, true)}
                          >
                            Sacarle la marca igual
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 max-md:h-10" onClick={() => setAviso(null)}>
                            Dejarla confidencial
                          </Button>
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
