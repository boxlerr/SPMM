"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Edit2, CalendarClock } from "lucide-react";
import { WorkOrder } from "@/lib/types";

interface UnplannedWorkOrdersListProps {
    orders: WorkOrder[];
    onEdit: (order: WorkOrder) => void;
}

export function UnplannedWorkOrdersList({ orders, onEdit }: UnplannedWorkOrdersListProps) {
    const [searchTerm, setSearchTerm] = React.useState("");

    const filteredOrders = orders.filter(order => {
        const term = searchTerm.toLowerCase();

        const clienteName = typeof order.cliente === 'object' ? order.cliente?.nombre : order.cliente;
        const detalleText = order.detalle || order.observaciones || "";
        const idText = order.id.toString();

        return (
            idText.includes(term) ||
            (clienteName && clienteName.toLowerCase().includes(term)) ||
            (detalleText && detalleText.toLowerCase().includes(term))
        );
    });

    const formatDate = (dateStr: string) => {
        if (!dateStr) return "-";
        const date = new Date(dateStr);
        return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    return (
        <Card className="p-6 bg-white border-none shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <AlertCircle className="text-orange-500 w-6 h-6" />
                        Órdenes No Planificadas
                        <span className="text-sm font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full border border-gray-200">
                            {orders.length}
                        </span>
                    </h3>
                    <p className="text-gray-500 text-sm mt-1">Estas órdenes no tienen procesos asignados y requieren configuración.</p>
                </div>
                <div className="relative">
                    <input
                        type="text"
                        className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all w-full sm:w-64"
                        placeholder="Buscar orden..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <div className="absolute left-3 top-2.5 text-gray-400">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                </div>
            </div>

            {filteredOrders.length === 0 ? (
                <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                        <CalendarClock className="w-8 h-8 text-gray-300" />
                    </div>
                    <h4 className="text-lg font-medium text-gray-900">No hay órdenes sin planificar</h4>
                    <p className="text-gray-500">Todas las órdenes tienen procesos asignados.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {filteredOrders.map(order => (
                        <div key={order.id} className="group border border-gray-200 rounded-xl p-5 hover:shadow-md transition-all duration-200 bg-white hover:border-orange-200 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-orange-400  group-hover:bg-orange-500 transition-colors"></div>

                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-3">
                                        <span className="text-lg font-bold text-gray-900">OT #{order.id}</span>
                                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200 uppercase tracking-wide">
                                            {typeof order.prioridad === 'object' ? order.prioridad?.descripcion : order.prioridad || "Normal"}
                                        </span>
                                    </div>
                                    <h4 className="font-semibold text-gray-800 text-lg">
                                        {typeof order.cliente === 'object' ? order.cliente?.nombre : order.cliente || "Cliente Desconocido"}
                                    </h4>
                                    <p className="text-gray-600 text-sm line-clamp-1">{order.observaciones || order.detalle || "Sin detalles"}</p>
                                </div>

                                <div className="flex items-center gap-6 text-sm text-gray-500">
                                    <div className="hidden md:block text-right">
                                        <div className="text-xs uppercase tracking-wider font-bold text-gray-400">Fecha Prometida</div>
                                        <div className="font-semibold text-gray-700">{formatDate(order.fecha_prometida)}</div>
                                    </div>

                                    <Button
                                        onClick={() => onEdit(order)}
                                        className="bg-white text-orange-600 border-2 border-orange-100 hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 font-semibold shadow-sm"
                                    >
                                        <Edit2 className="w-4 h-4 mr-2" />
                                        Editar y Planificar
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}
