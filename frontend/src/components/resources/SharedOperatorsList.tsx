
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Trash2, Phone } from "lucide-react";
import { Operario } from "@/app/recursos/_types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import type { ColumnaExport } from "@/lib/exportar";

const nombrePropio = (text?: string) =>
    (text ?? "").split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

/** RF-22: lo que muestra la tabla, más la jornada, que es lo que se pregunta al imprimirla. */
const COLUMNAS_EXPORT: ColumnaExport<Operario>[] = [
    { titulo: "Nombre", valor: (o) => `${nombrePropio(o.nombre)} ${nombrePropio(o.apellido)}`.trim() },
    { titulo: "Rango", valor: (o) => o.categoria ?? "" },
    { titulo: "Sector", valor: (o) => o.sector ?? "" },
    { titulo: "Teléfono", valor: (o) => (o.celular || o.telefono || "").replace(/\D/g, "") },
    { titulo: "Estado", valor: (o) => (o.disponible ? "Activo" : "Ausente") },
    { titulo: "Entrada", valor: (o) => o.hora_inicio?.slice(0, 5) ?? "" },
    { titulo: "Salida", valor: (o) => o.hora_fin?.slice(0, 5) ?? "" },
    { titulo: "Interpreta planos", tipo: "booleano", valor: (o) => o.interpreta_planos },
];

interface SharedOperatorsListProps {
    operarios: Operario[];
    isLoading: boolean;
    onView: (operario: Operario) => void;
    onDelete?: (operario: Operario) => void;
    className?: string;
}

export function SharedOperatorsList({
    operarios,
    isLoading,
    onView,
    onDelete,
    className
}: SharedOperatorsListProps) {

    const getEstadoColor = (disponible?: boolean) => {
        return disponible
            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    };

    const formatPhone = (value?: string) => {
        if (!value) return "";
        return value.replace(/\D/g, "");
    };

    const capitalizeName = (text?: string) => {
        if (!text) return "";
        return text
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(" ");
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner className="h-8 w-8" />
                <span className="ml-3 text-muted-foreground">Cargando recurso humano...</span>
            </div>
        );
    }

    if (operarios.length === 0) {
        return (
            <div className="py-12 text-center text-muted-foreground">
                <p className="text-lg">No hay recurso humano disponible</p>
            </div>
        );
    }

    return (
        <div className={cn("w-full", className)}>
            {/* RF-22: la lista entera, en el orden en que se ve. */}
            <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                    {operarios.length} {operarios.length === 1 ? "persona" : "personas"}
                </span>
                <ExportarMenu
                    titulo="Recurso humano"
                    archivo="recurso_humano"
                    filas={operarios}
                    columnas={COLUMNAS_EXPORT}
                />
            </div>
            {/* Vista Desktop - Tabla */}
            <div className="hidden md:block overflow-x-auto rounded-md border">
                <table className="w-full">
                    <thead className="border-b bg-muted/50">
                        <tr>
                            <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Nombre</th>
                            <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Rango</th>
                            <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Sector</th>
                            <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Teléfono</th>
                            <th className="px-4 py-2.5 text-left text-sm font-medium text-muted-foreground">Estado</th>
                            <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {operarios.map((operario) => (
                            <tr
                                key={operario.id}
                                className="hover:bg-muted/50 transition-colors cursor-pointer bg-white"
                                onClick={() => onView(operario)}
                            >
                                <td className="px-4 py-2 text-sm font-medium">
                                    {capitalizeName(operario.nombre)} {capitalizeName(operario.apellido)}
                                </td>
                                <td className="px-4 py-2">
                                    <Badge variant="secondary" className="text-xs">{operario.categoria}</Badge>
                                </td>
                                <td className="px-4 py-2">
                                    {operario.sector ? (
                                        <Badge variant="secondary" className="text-xs">{operario.sector}</Badge>
                                    ) : (
                                        <span className="text-muted-foreground text-xs italic">Sin sector</span>
                                    )}
                                </td>
                                <td className="px-4 py-2 text-sm">
                                    {formatPhone(operario.celular) || formatPhone(operario.telefono) || <span className="text-muted-foreground text-xs italic">Sin teléfono</span>}
                                </td>
                                <td className="px-4 py-2">
                                    <Badge className={getEstadoColor(operario.disponible)}>
                                        {operario.disponible ? "Activo" : "Ausente"}
                                    </Badge>
                                </td>
                                <td className="px-4 py-2">
                                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                        <Button variant="ghost" size="icon" onClick={() => onView(operario)} className="h-8 w-8">
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                        {onDelete && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDelete(operario);
                                                }}
                                                className="h-8 w-8 text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Vista Mobile - Tarjetas */}
            <div className="md:hidden divide-y rounded-md border bg-white">
                {operarios.map((operario) => (
                    <div
                        key={operario.id}
                        className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => onView(operario)}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                                <h3 className="font-semibold text-base mb-1">
                                    {capitalizeName(operario.nombre)} {capitalizeName(operario.apellido)}
                                </h3>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    <Badge variant="secondary" className="text-xs">{operario.categoria}</Badge>
                                    {operario.sector ? (
                                        <Badge variant="secondary" className="text-xs">{operario.sector}</Badge>
                                    ) : (
                                        <span className="text-muted-foreground text-xs italic flex items-center">Sin sector</span>
                                    )}
                                </div>
                            </div>
                            <Badge className={`${getEstadoColor(operario.disponible)} ml-2`}>
                                {operario.disponible ? "Activo" : "Ausente"}
                            </Badge>
                        </div>

                        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                            <Phone className="h-4 w-4" />
                            <span>{formatPhone(operario.celular) || formatPhone(operario.telefono) || <span className="italic">Sin teléfono</span>}</span>
                        </div>

                        <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onView(operario)}
                                className="text-xs"
                            >
                                <Eye className="h-3 w-3 mr-1" />
                                Ver
                            </Button>
                            {onDelete && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onDelete(operario)}
                                    className="text-destructive hover:bg-destructive/10 text-xs"
                                >
                                    <Trash2 className="h-3 w-3 mr-1" />
                                    Eliminar
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
