"use client";

/**
 * El estado operativo de una máquina (RF-08): el cartelito de color y el que además
 * deja cambiarlo ahí mismo.
 *
 * Se cambia desde la fila y no sólo desde el formulario porque es el dato de la máquina
 * que más se mueve: pasa a mantenimiento un martes y vuelve el jueves. Abrir el modal
 * de edición para eso es de más.
 */
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ESTADOS_OPERATIVOS, infoEstado, type EstadoOperativo } from "../_maquinaOpciones";

const BASE =
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function EstadoBadge({ valor, className = "" }: { valor?: string | null; className?: string }) {
  const e = infoEstado(valor);
  return (
    <span className={`${BASE} ${e.clase} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${e.punto}`} aria-hidden />
      {e.etiqueta}
    </span>
  );
}

interface SelectorProps {
  valor?: string | null;
  nombre: string;
  onCambiar: (nuevo: EstadoOperativo) => void;
}

export function EstadoMaquinaSelector({ valor, nombre, onCambiar }: SelectorProps) {
  const e = infoEstado(valor);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Estado de ${nombre}: ${e.etiqueta}. Tocá para cambiarlo.`}
          title="Tocá para cambiar el estado"
          className={`${BASE} ${e.clase} hover:opacity-80 transition-opacity`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${e.punto}`} aria-hidden />
          {e.etiqueta}
          <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Estado de <span className="font-medium text-foreground">{nombre}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ESTADOS_OPERATIVOS.map((op) => (
          <DropdownMenuItem
            key={op.valor}
            className="gap-2"
            onSelect={() => {
              if (op.valor !== e.valor) onCambiar(op.valor);
            }}
          >
            <span className={`h-2 w-2 rounded-full ${op.punto}`} aria-hidden />
            <span className="flex-1">{op.etiqueta}</span>
            {op.valor === e.valor && <Check className="h-3.5 w-3.5" aria-hidden />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* Dicho acá porque es donde se cambia: sin esto, marcarla «fuera de servicio»
            se lee como «ya no la planifiquen», y el planificador todavía no lo mira. */}
        <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Por ahora es un registro: el planificador la sigue teniendo en cuenta.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
