import {
    Boxes,
    CalendarX,
    ClipboardList,
    Cog,
    FileBarChart2,
    Gauge,
    History,
    ListChecks,
    PackageMinus,
    PauseCircle,
    ShieldAlert,
    Users,
    type LucideIcon,
} from "lucide-react";

/**
 * El ícono de cada fuente del armador de reportes (RF-23). El catálogo del servidor manda
 * el nombre (ReportesCatalogo.Fuente.icono); una fuente nueva sin ícono acá sale con el de
 * reporte genérico, no rompe.
 */
const ICONOS: Record<string, LucideIcon> = {
    "clipboard-list": ClipboardList,
    "list-checks": ListChecks,
    users: Users,
    "calendar-x": CalendarX,
    cog: Cog,
    "package-minus": PackageMinus,
    boxes: Boxes,
    "shield-alert": ShieldAlert,
    "pause-circle": PauseCircle,
    gauge: Gauge,
    history: History,
};

export function iconoDeFuente(nombre: string | null | undefined): LucideIcon {
    return (nombre && ICONOS[nombre]) || FileBarChart2;
}
