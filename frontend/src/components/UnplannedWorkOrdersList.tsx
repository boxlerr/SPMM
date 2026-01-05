"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Edit2, CalendarClock, Trash2 } from "lucide-react";
import { WorkOrder } from "@/lib/types";
import { OrderFiles } from "@/components/common/OrderFiles";

interface UnplannedWorkOrdersListProps {
    orders: WorkOrder[];
    onEdit: (order: WorkOrder) => void;
    onDelete: (id: number) => void;
}

export function UnplannedWorkOrdersList({ orders, onEdit, onDelete }: UnplannedWorkOrdersListProps) {
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

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return "-";
        const date = new Date(dateStr);
        return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };


    const ITEMS_PER_PAGE = 30;
    const [currentPage, setCurrentPage] = React.useState(1);

    // Reset page when search changes
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    const totalPages = Math.ceil(filteredOrders.length / ITEMS_PER_PAGE);
    const paginatedOrders = filteredOrders.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const handlePrevious = () => {
        if (currentPage > 1) setCurrentPage(p => p - 1);
    };

    const handleNext = () => {
        if (currentPage < totalPages) setCurrentPage(p => p + 1);
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
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-4">
                        {paginatedOrders.map(order => (
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
                                        <OrderFiles orderId={order.id} />
                                    </div>

                                    <div className="flex items-center gap-6 text-sm text-gray-500">
                                        <div className="hidden md:block text-right">
                                            <div className="text-xs uppercase tracking-wider font-bold text-gray-400">Fecha Prometida</div>
                                            <div className="font-semibold text-gray-700">{formatDate(order.fecha_prometida)}</div>
                                        </div>

                                        <Button
                                            onClick={() => onDelete(order.id)}
                                            variant="destructive"
                                            size="icon"
                                            className="h-10 w-10 shadow-sm"
                                            title="Eliminar Orden"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>

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

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-4 mt-6">
                            <Button
                                onClick={handlePrevious}
                                disabled={currentPage === 1}
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 rounded-full border-gray-300 hover:text-orange-600 hover:border-orange-300 disabled:opacity-50"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="m15 18-6-6 6-6" /></svg>
                            </Button>
                            <span className="text-sm font-medium text-gray-600">
                                Página {currentPage} de {totalPages}
                            </span>
                            <Button
                                onClick={handleNext}
                                disabled={currentPage === totalPages}
                                variant="outline"
                                size="icon"
                                className="h-10 w-10 rounded-full border-gray-300 hover:text-orange-600 hover:border-orange-300 disabled:opacity-50"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="m9 18 6-6-6-6" /></svg>
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}
