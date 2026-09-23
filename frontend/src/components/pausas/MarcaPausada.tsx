"use client";

/**
 * El cartel de «Pausada» de las listas de Operaciones (RF-03).
 *
 * Va al lado del número de la OT. Lee lo pausado del store común (lib/pausas.ts): una
 * sola llamada para toda la pantalla, y cambia en el momento cuando alguien pausa o
 * reanuda desde la ficha. Sin pausas —o con un backend de antes de RF-03— no dibuja nada.
 */
import { PauseCircle } from "lucide-react";

import { momentoCorto } from "@/lib/asistencia";
import { queSePauso, usePausasActivas } from "@/lib/pausas";
import { capitalizeName, cn } from "@/lib/utils";

export function MarcaPausada({ idOrden, className }: { idOrden: number; className?: string }) {
  const { porOt } = usePausasActivas();
  const pausas = porOt.get(idOrden);
  if (!pausas?.length) return null;

  const deLaOt = pausas.find((p) => p.alcance === "ot");
  const pasos = pausas.filter((p) => p.alcance === "paso");
  const texto = deLaOt
    ? "Pausada"
    : pasos.length === 1
      ? `Paso ${pasos[0].paso ?? ""} pausado`.replace("  ", " ")
      : `${pasos.length} pasos pausados`;
  // El detalle entero en el globito: qué, por qué, desde cuándo y quién.
  const detalle = pausas
    .map((p) => {
      const que = queSePauso(p);
      const nota = p.observacion ? ` («${p.observacion}»)` : "";
      const quien = p.usuario_pausa ? ` por ${capitalizeName(p.usuario_pausa)}` : "";
      return `${que.charAt(0).toUpperCase()}${que.slice(1)}: ${p.motivo_texto}${nota}, desde el ${momentoCorto(p.desde)}${quien}`;
    })
    .join("\n");

  return (
    <span
      title={detalle}
      aria-label={`${texto}. ${detalle}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-px",
        "text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200",
        className,
      )}
    >
      <PauseCircle className="h-3 w-3" aria-hidden />
      {texto}
    </span>
  );
}
