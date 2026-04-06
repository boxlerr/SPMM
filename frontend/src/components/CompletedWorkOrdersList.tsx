import React, { useState } from "react";
import { 
    Search, 
    Calendar, 
    User, 
    Package, 
    CheckCircle2, 
    FileText, 
    Eye,
    ChevronLeft,
    ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { WorkOrder } from "@/lib/types";
import { OrderFiles } from "./common/OrderFiles";

interface CompletedWorkOrdersListProps {
    orders: WorkOrder[];
    onEdit: (order: WorkOrder) => void;
}

export function CompletedWorkOrdersList({ orders, onEdit }: CompletedWorkOrdersListProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 8;

    const filteredOrders = orders.filter(order => {
        const searchLower = searchTerm.toLowerCase();
        const otId = order.id.toString();
        const oldOtId = order.id_otvieja?.toString() || "";
        const clientRaw = order.cliente;
        const clientName = (typeof clientRaw === 'object' && clientRaw !== null ? (clientRaw as any).nombre : (clientRaw || "")).toString().toLowerCase();
        
        const artRaw = order.articulo;
        const article = (typeof artRaw === 'object' && artRaw !== null ? (artRaw as any).descripcion : (artRaw || "")).toString().toLowerCase();
        const codArticle = (typeof artRaw === 'object' && artRaw !== null ? (artRaw as any).cod_articulo : "").toString().toLowerCase();
        
        return otId.includes(searchLower) || 
               oldOtId.includes(searchLower) || 
               clientName.includes(searchLower) ||
               article.includes(searchLower) ||
               codArticle.includes(searchLower);
    }).sort((a, b) => {
        // Sort by completion date (desc) if available, otherwise by ID
        const dateA = a.fecha_entrega ? new Date(a.fecha_entrega).getTime() : 0;
        const dateB = b.fecha_entrega ? new Date(b.fecha_entrega).getTime() : 0;
        return dateB - dateA || b.id - a.id;
    });

    const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
    const paginatedOrders = filteredOrders.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return "N/A";
        try {
            return new Date(dateStr).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        } catch (e) {
            return dateStr;
        }
    };

    return (
        <div className="space-y-4">
            {/* Header & Search */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-green-50 rounded-lg text-green-600">
                        <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900">Historial de Órdenes</h3>
                        <p className="text-xs text-gray-500">Visualiza todas las órdenes finalizadas y entregadas.</p>
                    </div>
                </div>
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                        placeholder="Buscar por OT, Cliente o Producto..."
                        value={searchTerm}
                        onChange={(e) => {
                            setSearchTerm(e.target.value);
                            setCurrentPage(1);
                        }}
                        className="pl-10 h-10 bg-gray-50/50 border-gray-200 focus:bg-white transition-all rounded-lg"
                    />
                </div>
            </div>

            {filteredOrders.length === 0 ? (
                <div className="py-20 text-center bg-gray-50/30 rounded-2xl border-2 border-dashed border-gray-100">
                    <CheckCircle2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                    <h4 className="text-lg font-medium text-gray-900 font-bold">No se encontraron órdenes completadas</h4>
                    <p className="text-gray-500 max-w-xs mx-auto text-sm">
                        Las órdenes terminadas aparecerán aquí una vez que se marquen como "Finalizado Total".
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-3">
                        {paginatedOrders.map(order => (
                            <div key={order.id} className="group border border-gray-200 rounded-xl p-5 hover:shadow-md transition-all duration-200 bg-white hover:border-green-200 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1.5 h-full bg-green-400 group-hover:bg-green-500 transition-colors"></div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                                    {/* OT & Status */}
                                    <div className="md:col-span-3 space-y-2">
                                        <div className="flex items-center gap-3">
                                            <span className="text-base font-bold text-gray-900 font-mono tracking-tight">OT #{order.id_otvieja || order.id}</span>
                                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-green-100 text-green-700 border border-green-200 uppercase tracking-widest">
                                                FINALIZADA
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                                            <span className="font-black uppercase tracking-wider">Cliente:</span>
                                            <span className="font-bold text-gray-700">
                                                {typeof order.cliente === 'object' ? order.cliente?.nombre : order.cliente || "Sin Cliente"}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Article & Details */}
                                    <div className="md:col-span-4 space-y-2">
                                        <div className="flex items-start gap-2 text-sm font-bold text-gray-800 leading-tight">
                                            <Package className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                                            <span>
                                                {typeof order.articulo === 'object' ? `${order.articulo?.cod_articulo} - ${order.articulo?.descripcion}` : "Sin Artículo"}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-500 italic pl-6 leading-relaxed">
                                            {order.observaciones || order.detalle || "Sin observaciones adicionales"}
                                        </p>
                                    </div>

                                    {/* Quantities & Files */}
                                    <div className="md:col-span-3 flex flex-col gap-4">
                                        <div className="flex items-start gap-6">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">Entregado</span>
                                                <span className="text-base font-black text-green-700 leading-none">{order.cantidad_entregada || 0} / {order.unidades || 0}</span>
                                            </div>
                                            <div className="flex flex-col gap-1 border-l border-gray-100 pl-6">
                                                <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">F. Entrega</span>
                                                <div className="flex items-center gap-1.5 text-gray-800 font-bold text-sm leading-none">
                                                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                                    {formatDate(order.fecha_entrega)}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <OrderFiles orderId={order.id} />
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="md:col-span-2 flex items-center justify-end h-full self-center">
                                        <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            className="h-10 px-4 text-gray-500 hover:text-blue-600 hover:bg-blue-50 gap-2 border border-gray-100 hover:border-blue-100 rounded-xl group/btn transition-all shadow-sm"
                                            onClick={() => onEdit(order)}
                                        >
                                            <Eye className="w-4 h-4 transition-transform group-hover/btn:scale-110" />
                                            <span className="text-xs font-black uppercase tracking-wider">Ver Detalles</span>
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-4 py-2 border-t border-gray-50">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-xs font-bold bg-gray-100 px-3 py-1.5 rounded-lg text-gray-600">
                                Página {currentPage} de {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                            >
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
