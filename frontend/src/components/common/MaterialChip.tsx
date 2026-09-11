import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { resumirMaterial } from "@/lib/materialOT";

const ICONOS = {
    ok: CheckCircle2,
    reloj: Clock,
    alerta: AlertTriangle,
    interrogante: HelpCircle,
    nada: Minus,
} as const;

/**
 * El chip de la columna Material. Uno solo para las cinco pantallas que lo dibujan.
 *
 * Antes cada lista lo armaba con su propia cadena de ternarios y las cinco caían en el
 * mismo `else` rojo que decía «Sin Stock», también para las órdenes a las que sólo les
 * falta que alguien cargue la lista. Ver `lib/materialOT.ts`: ahí está por qué esas dos
 * cosas no son la misma.
 */
export function MaterialChip({
    estado,
    noLleva,
    className,
}: {
    estado?: string | null;
    /** La casilla «no lleva materia prima» de la orden. Gana sobre `estado`. */
    noLleva?: boolean | number | null;
    className?: string;
}) {
    const m = resumirMaterial(estado, noLleva);
    const Icono = ICONOS[m.icono];

    return (
        <Badge
            variant="outline"
            className={cn("gap-1 pl-1.5 shadow-none font-semibold cursor-help", m.clases, className)}
            title={m.titulo}
        >
            <Icono className="h-3 w-3" />
            {m.rotulo}
        </Badge>
    );
}
