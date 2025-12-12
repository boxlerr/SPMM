"use client";

import React from "react";
import { WorkOrder } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, ChevronRight } from "lucide-react";

interface PlanningListTableProps {
    data: WorkOrder[];
    isLoading: boolean;
    onRowClick: (item: WorkOrder) => void;
}

export function PlanningListTable({ data, isLoading, onRowClick }: PlanningListTableProps) {
    const [sortConfig, setSortConfig] = React.useState<{ key: 'unidades' | 'prioridad' | null; direction: 'asc' | 'desc' | null }>({
        key: null,
        direction: null,
    });
    const [searchTerm, setSearchTerm] = React.useState("");
    const [expandedOrderId, setExpandedOrderId] = React.useState<number | null>(null);

    const toggleRow = (orderId: number) => {
        setExpandedOrderId(prev => prev === orderId ? null : orderId);
    };

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

    const getPriorityLabel = (priorityId?: number, descripcion?: string) => {
        if (descripcion) return descripcion;
        switch (priorityId) {
            case 3: return "Crítica";
            case 2: return "Urgente";
            case 1: return "Normal";
            default: return "Normal";
        }
    };

    const handleSort = (key: 'unidades' | 'prioridad') => {
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
            item.id.toString().includes(lowerTerm) ||
            String(item.observaciones || "").toLowerCase().includes(lowerTerm) ||
            String(item.sector?.nombre || "").toLowerCase().includes(lowerTerm) ||
            String(item.articulo?.cod_articulo || "").toLowerCase().includes(lowerTerm) ||
            String(item.articulo?.descripcion || "").toLowerCase().includes(lowerTerm)
        );
    }, [data, searchTerm]);

    const sortedData = React.useMemo(() => {
        if (!sortConfig.key || !sortConfig.direction) return filteredData;

        return [...filteredData].sort((a, b) => {
            if (sortConfig.key === 'unidades') {
                const valA = a.unidades || 0;
                const valB = b.unidades || 0;
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

    const SortIcon = ({ column }: { column: 'unidades' | 'prioridad' }) => {
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
                    placeholder="Buscar por OT, pedido, cliente, código o producto..."
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
                                <th className="w-10 px-4 py-3"></th> {/* Espacio para el chevron */}
                                <th className="px-4 py-3 font-bold text-gray-600">OT</th>
                                <th className="px-4 py-3 font-bold text-gray-600">F. Entrada</th>
                                <th className="px-4 py-3 font-bold text-gray-600">Sector</th>
                                <th className="px-4 py-3 font-bold text-gray-600">Código</th>
                                <th className="px-4 py-3 font-bold text-gray-600">Descripción</th>
                                <th
                                    className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('unidades')}
                                    title="Ordenar por cantidad (Click para alternar: Asc -> Desc -> Original)"
                                >
                                    <div className="flex items-center justify-center">
                                        Cant.
                                        <SortIcon column="unidades" />
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
                                <th className="px-4 py-3 font-bold text-gray-600">F. Entrega</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                                        {searchTerm ? "No se encontraron resultados para la búsqueda." : "No hay órdenes activas en este momento."}
                                    </td>
                                </tr>
                            ) : (
                                sortedData.map((item) => (
                                    <React.Fragment key={item.id}>
                                        <tr
                                            onClick={() => onRowClick(item)}
                                            className={cn(
                                                "border-b transition-colors duration-150 cursor-pointer hover:opacity-80",
                                                getPriorityColor(item.id_prioridad)
                                            )}
                                        >
                                            <td className="px-4 py-3">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleRow(item.id);
                                                    }}
                                                    className="p-1 hover:bg-black/10 rounded transition-colors"
                                                >
                                                    {expandedOrderId === item.id ? (
                                                        <ChevronDown className="h-4 w-4 text-gray-600" />
                                                    ) : (
                                                        <ChevronRight className="h-4 w-4 text-gray-400" />
                                                    )}
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                                {item.id}
                                            </td>
                                            <td className="px-4 py-3">
                                                {formatDate(item.fecha_entrada)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-500 italic">
                                                {item.sector?.nombre || "-"}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs">
                                                {item.articulo?.cod_articulo || "-"}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-gray-900">
                                                {item.articulo?.descripcion || "-"}
                                            </td>
                                            <td className="px-4 py-3 text-center font-medium">
                                                {item.unidades ?? "-"}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                    {getPriorityLabel(item.id_prioridad, item.prioridad?.descripcion)}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                                {formatDate(item.fecha_prometida)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-500">
                                                {formatDate(item.fecha_entrega)}
                                            </td>
                                        </tr>
                                        {expandedOrderId === item.id && (
                                            <tr className="bg-gray-50 border-b">
                                                <td colSpan={10} className="px-4 py-4">
                                                    <div className="ml-8 border rounded-md overflow-hidden bg-white shadow-inner">
                                                        <table className="w-full text-sm">
                                                            <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                                                                <tr>
                                                                    <th className="px-4 py-2 text-left">Orden</th>
                                                                    <th className="px-4 py-2 text-left">Proceso</th>
                                                                    <th className="px-4 py-2 text-left">Estado</th>
                                                                    <th className="px-4 py-2 text-center">Tiempo (min)</th>
                                                                    <th className="px-4 py-2 text-left">Operario</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {item.procesos && item.procesos.length > 0 ? (
                                                                    item.procesos.map((proc, idx) => (
                                                                        <tr key={idx} className="border-t hover:bg-gray-50">
                                                                            <td className="px-4 py-2 font-mono text-gray-500">{proc.orden}</td>
                                                                            <td className="px-4 py-2 font-medium">{proc.proceso?.nombre || "-"}</td>
                                                                            <td className="px-4 py-2">
                                                                                <Badge variant="secondary" className={
                                                                                    proc.estado_proceso?.id === 3 ? "bg-green-100 text-green-800 hover:bg-green-200" :
                                                                                        proc.estado_proceso?.id === 2 ? "bg-blue-100 text-blue-800 hover:bg-blue-200" :
                                                                                            "bg-gray-100 text-gray-800"
                                                                                }>
                                                                                    {proc.estado_proceso?.descripcion || "Pendiente"}
                                                                                </Badge>
                                                                            </td>
                                                                            <td className="px-4 py-2 text-center text-gray-600">{proc.tiempo_proceso || "-"}</td>
                                                                            <td className="px-4 py-2 text-gray-700 text-xs font-medium">{proc.operario_nombre || "Sin Asignar"}</td>
                                                                        </tr>
                                                                    ))
                                                                ) : (
                                                                    <tr>
                                                                        <td colSpan={5} className="px-4 py-4 text-center text-gray-400 italic">
                                                                            Sin procesos asignados
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
