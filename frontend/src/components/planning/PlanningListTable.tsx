"use client";

import React from "react";
import { PlanificacionItem } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";


interface PlanningListTableProps {
    data: PlanificacionItem[];
    isLoading: boolean;
    onRowClick: (item: PlanificacionItem) => void;
}

export function PlanningListTable({ data, isLoading, onRowClick }: PlanningListTableProps) {
    // Process data to group by process or just list them? 
    // The image shows a flat list of processes.

    const formatDate = (dateStr?: string) => {
        if (!dateStr || dateStr.startsWith('1950')) return "-";
        try {
            // Adjust for timezone offset if necessary, or assume UTC/Local
            const date = new Date(dateStr);
            return new Intl.DateTimeFormat('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).format(date);
        } catch (e) {
            return dateStr;
        }
    };

    const getPriorityColor = (priorityId?: number) => {
        // Based on images:
        // Orange/Redish -> Urgente (2)
        // Red/Pink -> Critica (3)
        // Yellow -> ???
        // Blue/Light Blue -> Normal (1)

        switch (priorityId) {
            case 3: // Critica
                return "bg-red-200 hover:bg-red-300 text-red-900";
            case 2: // Urgente
                return "bg-orange-200 hover:bg-orange-300 text-orange-900";
            case 1: // Normal
                return "bg-blue-100 hover:bg-blue-200 text-blue-900";
            default:
                return "bg-white hover:bg-gray-50";
        }
    };

    const getPriorityLabel = (priorityId?: number) => {
        switch (priorityId) {
            case 3: return "Crítica";
            case 2: return "Urgente";
            case 1: return "Normal";
            default: return "Normal";
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-700"></div>
            </div>
        );
    }

    return (
        <Card className="overflow-hidden border-none shadow-xl bg-white">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                        <tr>
                            <th className="px-4 py-3 font-bold text-gray-600">OT</th>
                            <th className="px-4 py-3 font-bold text-gray-600">F. Entrada</th>
                            <th className="px-4 py-3 font-bold text-gray-600">Pedido</th>
                            <th className="px-4 py-3 font-bold text-gray-600">Cliente</th>
                            <th className="px-4 py-3 font-bold text-gray-600">Código</th>
                            <th className="px-4 py-3 font-bold text-gray-600">Producto / Proceso</th>
                            <th className="px-4 py-3 font-bold text-gray-600 text-center">Cant.</th>
                            <th className="px-4 py-3 font-bold text-gray-600 text-center">Prioridad</th>
                            <th className="px-4 py-3 font-bold text-gray-600">F. Prom.</th>
                            <th className="px-4 py-3 font-bold text-gray-600">F. Estim.</th>
                            <th className="px-4 py-3 font-bold text-gray-600">F. Real</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td colSpan={11} className="px-4 py-8 text-center text-gray-500">
                                    No hay planificaciones activas en este momento.
                                </td>
                            </tr>
                        ) : (
                            data.map((item, index) => (
                                <tr
                                    key={`${item.id}-${index}`}
                                    onClick={() => onRowClick(item)}
                                    className={cn(
                                        "border-b transition-colors duration-150 cursor-pointer hover:opacity-80",
                                        getPriorityColor(item.id_prioridad)
                                    )}
                                >
                                    <td className="px-4 py-3 font-medium">
                                        {item.orden_id}
                                    </td>
                                    <td className="px-4 py-3">
                                        {formatDate(item.fecha_entrada)}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500 italic">
                                        - {/* Pedido placeholder */}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500 italic">
                                        - {/* Cliente placeholder */}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs">
                                        {item.cod_articulo || "-"}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-gray-900">
                                                {item.descripcion_articulo || "-"}
                                            </span>
                                            <span className="text-xs text-gray-700 mt-1 uppercase font-bold tracking-wide opacity-75">
                                                {item.nombre_proceso}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center font-medium">
                                        - {/* Cantidad placeholder */}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                            {getPriorityLabel(item.id_prioridad)}
                                        </Badge>
                                    </td>
                                    <td className="px-4 py-3 font-medium">
                                        {formatDate(item.fecha_prometida)}
                                    </td>
                                    <td className="px-4 py-3 text-gray-500">
                                        {/* Fecha Estimada - could use inicio_min/fin_min calculation */}
                                        -
                                    </td>
                                    <td className="px-4 py-3 text-gray-500">
                                        {/* Fecha Real - could use estado/fecha_fin */}
                                        -
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
