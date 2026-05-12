"use client";

import React, { useEffect, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

/**
 * Control de zoom estilo Word/Excel reutilizable.
 *
 * Cómo funciona:
 *  - Renderiza un slider (50% → 150%, step 10) con botones -, + y un display %.
 *  - El valor se persiste en localStorage bajo `storageKey` (default 'plan_zoom').
 *  - El componente NO aplica el zoom por sí mismo: emite el valor por `onChange`
 *    (y queda guardado en localStorage). Quien lo usa decide a qué wrapper se lo
 *    aplica vía `style={{ zoom: value / 100 }}`.
 *
 * Por qué no `transform: scale(...)`:
 *  - `zoom` hace que el layout reflowee como en el navegador / Word / Excel:
 *    no genera scrollbars artificiales, las columnas se reajustan, y el contenido
 *    "achicado" sigue ocupando el espacio correcto. `transform: scale` deja el
 *    bounding box del tamaño original y descuadra todo.
 *  - Soportado en Chrome, Edge, Safari y Firefox 126+ (suficiente para el taller).
 */

interface ZoomControlProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export function ZoomControl({
  value,
  onChange,
  min = 50,
  max = 150,
  step = 10,
  className = "",
}: ZoomControlProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div
      className={`flex items-center gap-1 bg-white border border-gray-200 rounded-md px-1.5 py-1 shadow-sm ${className}`}
      title="Zoom de la vista"
    >
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        className="h-6 w-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Reducir zoom"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(parseInt(e.target.value, 10)))}
        className="w-24 sm:w-28 h-1 accent-red-600 cursor-pointer"
        aria-label="Nivel de zoom"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        className="h-6 w-6 flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Aumentar zoom"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onChange(100)}
        className="text-[11px] font-medium text-gray-700 hover:text-red-600 hover:underline w-9 text-center tabular-nums"
        title="Restablecer al 100%"
      >
        {value}%
      </button>
    </div>
  );
}

/**
 * Hook que persiste el zoom en localStorage bajo la misma key para todas las
 * vistas, así el usuario lo configura una vez y vale para Planificadas, No
 * Planificadas, Historial, Planificar y la Vista Previa.
 */
export function usePersistedZoom(
  storageKey: string = "plan_zoom",
  defaultValue: number = 100,
) {
  const [zoom, setZoom] = useState<number>(defaultValue);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const n = parseInt(stored, 10);
        if (!isNaN(n) && n >= 50 && n <= 150) setZoom(n);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(zoom));
    } catch {}
  }, [storageKey, zoom]);

  return [zoom, setZoom] as const;
}
