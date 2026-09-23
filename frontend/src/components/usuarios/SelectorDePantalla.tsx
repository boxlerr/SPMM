'use client';

import { AlertTriangle } from 'lucide-react';
import { PANTALLAS_DE_INICIO, nombreDePantalla } from '@/lib/permisos';

/**
 * El selector de la pantalla de inicio (RF-28), para una persona o para un rol.
 *
 * - La primera opción es «ninguna»: para una persona, «como su rol»; para un rol, «la de
 *   siempre». El texto dice adónde lleva eso HOY (`textoNinguna`).
 * - Fijar una pantalla no da permiso para verla. Las que no puede abrir dicen «sin
 *   acceso» en la lista, y si se elige una igual, abajo se avisa adónde va a entrar en su
 *   lugar (el Dashboard, o la primera que pueda ver). No se bloquea: no se pierde nada.
 * - Sin permiso para cambiarla (o mientras se guarda), sólo se muestra.
 */
interface Props {
  /** Lo guardado: una pantalla del menú, o null. */
  valor: string | null;
  textoNinguna: string;
  /** ¿La puede abrir? Sin la función (no se sabe), todas se muestran igual. */
  puedeAbrir?: (ruta: string) => boolean;
  /** Si la elegida no la puede abrir: adónde entra en su lugar. */
  entraEnSuLugar: string | null;
  editable: boolean;
  guardando?: boolean;
  etiqueta: string;
  onCambiar: (ruta: string | null) => void;
  className?: string;
}

export default function SelectorDePantalla({
  valor,
  textoNinguna,
  puedeAbrir,
  entraEnSuLugar,
  editable,
  guardando = false,
  etiqueta,
  onCambiar,
  className = '',
}: Props) {
  const aviso = valor !== null && entraEnSuLugar ? (
    <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-amber-700">
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
      <span>
        No la puede ver: entra a {nombreDePantalla(entraEnSuLugar) ?? entraEnSuLugar}.
      </span>
    </span>
  ) : null;

  if (!editable) {
    return (
      <span className={`inline-flex flex-col ${className}`}>
        <span className="text-sm text-gray-700">{valor ? nombreDePantalla(valor) ?? valor : textoNinguna}</span>
        {aviso}
      </span>
    );
  }

  return (
    <span className={`inline-flex flex-col ${className}`}>
      <select
        aria-label={etiqueta}
        value={valor ?? ''}
        disabled={guardando}
        onChange={(e) => onCambiar(e.target.value || null)}
        className={`h-9 max-md:h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 transition-opacity focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30 ${guardando ? 'opacity-60' : ''}`}
      >
        <option value="">{textoNinguna}</option>
        {PANTALLAS_DE_INICIO.map((p) => (
          <option key={p.ruta} value={p.ruta}>
            {puedeAbrir && !puedeAbrir(p.ruta) ? `${p.nombre} (sin acceso)` : p.nombre}
          </option>
        ))}
      </select>
      {aviso}
    </span>
  );
}
