"use client";

import React from "react";
import { PlanificacionItem } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface PlanningListTableProps {
    data: PlanificacionItem[];
    isLoading: boolean;
    onRowClick: (item: PlanificacionItem) => void;
}

export function PlanningListTable({ data, isLoading, onRowClick }: PlanningListTableProps) {
    const [sortConfig, setSortConfig] = React.useState<{ key: 'cantidad' | 'prioridad' | null; direction: 'asc' | 'desc' | null }>({
        key: null,
        direction: null,
    });
    const [searchTerm, setSearchTerm] = React.useState("");

    const formatDate = (dateStr?: string) => {
        if (!dateStr || dateStr.startsWith('1950')) return "-";
        try {
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

    const handleSort = (key: 'cantidad' | 'prioridad') => {
        let direction: 'asc' | 'desc' | null = 'asc'; // 1st click: asc (default)

        if (sortConfig.key === key) {
            if (sortConfig.direction === 'asc') {
                direction = 'desc'; // 2nd click: desc
            } else if (sortConfig.direction === 'desc') {
                direction = null; // 3rd click: default (null)
            }
        }

        setSortConfig({ key: direction ? key : null, direction });
    };

    const filteredData = React.useMemo(() => {
        if (!searchTerm) return data;
        const lowerTerm = searchTerm.toLowerCase();
        return data.filter(item =>
            item.orden_id.toString().includes(lowerTerm) ||
            String(item.pedido_externo || "").toLowerCase().includes(lowerTerm) ||
            String(item.sector || "").toLowerCase().includes(lowerTerm) ||
            String(item.cod_articulo || "").toLowerCase().includes(lowerTerm) ||
            String(item.descripcion_articulo || "").toLowerCase().includes(lowerTerm) ||
            String(item.nombre_proceso || "").toLowerCase().includes(lowerTerm)
        );
    }, [data, searchTerm]);

    const sortedData = React.useMemo(() => {
        if (!sortConfig.key || !sortConfig.direction) return filteredData;

        return [...filteredData].sort((a, b) => {
            if (sortConfig.key === 'cantidad') {
                const valA = a.cantidad || 0;
                const valB = b.cantidad || 0;
                return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
            }
            if (sortConfig.key === 'prioridad') {
                // Priority ID: 3 (Critical) > 2 (Urgent) > 1 (Normal)
                const valA = a.id_prioridad || 0;
                const valB = b.id_prioridad || 0;
                return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
            }
            return 0;
        });
    }, [filteredData, sortConfig]);

    const SortIcon = ({ column }: { column: 'cantidad' | 'prioridad' }) => {
        if (sortConfig.key !== column || !sortConfig.direction) return <span className="ml-1 text-gray-300 opacity-0 group-hover:opacity-50">↕</span>;
        return (
            <span className="ml-1 text-red-600 font-bold">
                {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </span>
        );
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-700"></div>
            </div>
        );
    }

    return (
        <div className="space-y-4 mt-6">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                    placeholder="Buscar por OT, pedido, cliente, código, producto o proceso..."
                    className="pl-10 border-gray-300 focus:border-red-500 focus:ring-red-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

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
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('cantidad')}
                                    title="Ordenar por cantidad (Click para alternar: Asc -> Desc -> Original)"
                                >
                                    <div className="flex items-center justify-center">
                                        Cant.
                                        <SortIcon column="cantidad" />
                                    </div>
                                </th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('prioridad')}
                                    title="Ordenar por prioridad (Click para alternar: Asc -> Desc -> Original)"
                                >
                                    <div className="flex items-center justify-center">
                                        Prioridad
                                        <SortIcon column="prioridad" />
                                    </div>
                                </th>
                                <th className="px-4 py-3 font-bold text-gray-600">F. Prom.</th>
                                <th className="px-4 py-3 font-bold text-gray-600">F. Real</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                                        {searchTerm ? "No se encontraron resultados para la búsqueda." : "No hay planificaciones activas en este momento."}
                                    </td>
                                </tr>
                            ) : (
                                sortedData.map((item, index) => (
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
                                            {item.pedido_externo || item.orden_id}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 italic">
                                            {item.sector || "-"}
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
                                            {item.cantidad || "-"}
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
                                            -
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
