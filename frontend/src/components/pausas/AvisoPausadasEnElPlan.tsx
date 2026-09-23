"use client";

/**
 * «Desde que se calculó este plan se pausó…» (RF-03), en la vista previa del planificador.
 *
 * El planificador ya deja afuera lo pausado al CALCULAR. Pero una vista previa abierta o
 * un borrador retomado se calcularon antes: si mientras tanto alguien pausó una de sus
 * OT, el plan en pantalla la sigue teniendo adentro. Al confirmar, el backend la saca y
 * lo avisa; esto lo dice ANTES, al mirar el plan, con la opción de recalcular para que el
 * resto se reacomode en el hueco.
 *
 * Lee lo pausado del store común (lib/pausas.ts): no suma consultas. Con un backend de
 * antes de RF-03 no dibuja nada.
 */
import { useMemo } from "react";
import { PauseCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { momentoCorto } from "@/lib/asistencia";
import { type Pausa, usePausasActivas } from "@/lib/pausas";

interface FilaDelPlan {
  orden_id: number;
  id_orden_trabajo_proceso?: number | null;
}

export function AvisoPausadasEnElPlan({ filas, onRecalcular, recalculando }: {
  filas: FilaDelPlan[];
  onRecalcular?: () => void;
  recalculando?: boolean;
}) {
  const { estado, porOt } = usePausasActivas();

  const afectadas = useMemo(() => {
    if (estado !== "si" || !filas.length) return [] as Pausa[];
    const ots = new Set(filas.map((f) => f.orden_id));
    const pasos = new Set(filas.map((f) => f.id_orden_trabajo_proceso).filter((x): x is number => x != null));
    const salida: Pausa[] = [];
    porOt.forEach((pausas, idOt) => {
      if (!ots.has(idOt)) return;
      for (const p of pausas) {
        if (p.alcance === "ot" || (p.id_otp != null && pasos.has(p.id_otp))) salida.push(p);
      }
    });
    return salida;
  }, [estado, porOt, filas]);

  if (!afectadas.length) return null;

  const texto = (p: Pausa) =>
    `${p.alcance === "ot" ? `OT ${p.numero_ot}` : `Paso ${p.paso ?? ""} de la OT ${p.numero_ot}`} (${p.motivo_texto.toLowerCase()}, desde el ${momentoCorto(p.desde)})`;

  return (
    <div className="m-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-start" role="status">
      <PauseCircle className="h-4 w-4 shrink-0 text-amber-600 sm:mt-0.5" aria-hidden />
      <div className="flex-1 text-xs leading-relaxed text-amber-900">
        <strong>Se pausó después de calcular este plan:</strong>{" "}
        {afectadas.map(texto).join(" · ")}.{" "}
        Al confirmar, eso no se guarda (ni los pasos que van después de un paso pausado).
        {onRecalcular ? " Recalculá para que el resto se reacomode en el hueco." : ""}
      </div>
      {onRecalcular && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 self-start border-amber-300 bg-white px-2.5 text-xs text-amber-900 hover:bg-amber-100"
          disabled={recalculando}
          onClick={onRecalcular}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Recalcular
        </Button>
      )}
    </div>
  );
}
