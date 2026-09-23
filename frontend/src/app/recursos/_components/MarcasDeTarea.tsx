"use client";

/**
 * Las dos marquitas que un paso puede llevar en las solapas Tiempos (RF-06) y
 * Rendimiento (RF-07), iguales en las dos:
 *
 *  · «reabierto»: se terminó, se reabrió y se volvió a terminar (o se le pisó el fin). El
 *    tiempo en que estuvo terminado no cuenta: sale del historial de pasos de la OT.
 *  · «¿quedó abierto?»: en proceso hace más de N jornadas y del doble de lo estimado. Sus
 *    horas no entran en el total, que no puede sumar una jornada por cada día hábil de un
 *    paso que nadie cerró.
 */
import { fmtMinutos } from "@/lib/asistencia";

export function MarcasDeTarea({ reabierto, cerradoMin, abiertoDeMas, topeJornadas }: {
  reabierto?: boolean;
  cerradoMin?: number | null;
  abiertoDeMas?: boolean;
  topeJornadas?: number;
}) {
  return (
    <>
      {reabierto && (
        <span
          className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap bg-violet-50 text-violet-700 ring-1 ring-violet-200"
          title={`Se terminó, se reabrió y se volvió a terminar: el tiempo en que estuvo terminado${cerradoMin ? ` (${fmtMinutos(cerradoMin)})` : ""} no cuenta como trabajo.`}
        >
          reabierto
        </span>
      )}
      {abiertoDeMas && (
        <span
          className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap bg-amber-50 text-amber-800 ring-1 ring-amber-200"
          title={`Sigue en proceso hace más de ${topeJornadas ?? 5} jornadas y más del doble de lo estimado. ¿Quedó abierto sin querer? Sus horas no entran en el total hasta que alguien lo cierre.`}
        >
          ¿quedó abierto?
        </span>
      )}
    </>
  );
}
