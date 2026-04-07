"use client";

import React, { useState } from "react";
import { 
    Search, 
    Calendar, 
    Package, 
    CheckCircle2, 
    Eye,
    ChevronDown,
    ChevronRight,
    AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WorkOrder } from "@/lib/types";
import { OrderFiles } from "./common/OrderFiles";
import { cn } from "@/lib/utils";
import { WorkOrderFilters, WorkOrderFilterState, initialFilterState, applyWorkOrderFilters } from "./common/WorkOrderFilters";

interface CompletedWorkOrdersListProps {
    orders: WorkOrder[];
    onEdit: (order: WorkOrder) => void;
}

export function CompletedWorkOrdersList({ orders, onEdit }: CompletedWorkOrdersListProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [expandedOrderIds, setExpandedOrderIds] = useState<number[]>([]);
    const [filters, setFilters] = useState<WorkOrderFilterState>(initialFilterState);
    const [sortConfig, setSortConfig] = useState<{
        key: 'id' | 'id_otvieja' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'fecha_entrega' | null;
        direction: 'asc' | 'desc' | null;
    }>({ key: null, direction: null });

    const toggleRow = (orderId: number) => {
        setExpandedOrderIds(prev =>
            prev.includes(orderId)
                ? prev.filter(id => id !== orderId)
                : [...prev, orderId]
        );
    };

    const handleSort = (key: typeof sortConfig.key) => {
        let direction: 'asc' | 'desc' | null = 'asc';
        if (sortConfig.key === key) {
            if (sortConfig.direction === 'asc') direction = 'desc';
            else if (sortConfig.direction === 'desc') direction = null;
        }
        setSortConfig({ key: direction ? key : null, direction });
    };

    const SortIcon = ({ column }: { column: typeof sortConfig.key }) => {
        if (sortConfig.key !== column || !sortConfig.direction) return <span className="ml-1 text-gray-300 opacity-0 group-hover:opacity-50">↕</span>;
        return <span className="ml-1 text-green-600 font-bold">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
    };

    const filteredOrders = applyWorkOrderFilters(orders, filters).filter(order => {
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
    });

    const sortedOrders = React.useMemo(() => {
        const sorted = [...filteredOrders];
        if (!sortConfig.key || !sortConfig.direction) {
            // Default: sort by completion date desc then by ID desc
            return sorted.sort((a, b) => {
                const dateA = a.fecha_entrega ? new Date(a.fecha_entrega).getTime() : 0;
                const dateB = b.fecha_entrega ? new Date(b.fecha_entrega).getTime() : 0;
                return dateB - dateA || b.id - a.id;
            });
        }
        return sorted.sort((a, b) => {
            switch (sortConfig.key) {
                case 'id':
                    return sortConfig.direction === 'asc' ? a.id - b.id : b.id - a.id;
                case 'id_otvieja':
                    return sortConfig.direction === 'asc' ? (a.id_otvieja || 0) - (b.id_otvieja || 0) : (b.id_otvieja || 0) - (a.id_otvieja || 0);
                case 'fecha_entrada':
                    return sortConfig.direction === 'asc'
                        ? new Date(a.fecha_entrada || 0).getTime() - new Date(b.fecha_entrada || 0).getTime()
                        : new Date(b.fecha_entrada || 0).getTime() - new Date(a.fecha_entrada || 0).getTime();
                case 'cliente':
                    return sortConfig.direction === 'asc'
                        ? (a.cliente?.nombre || "").localeCompare(b.cliente?.nombre || "")
                        : (b.cliente?.nombre || "").localeCompare(a.cliente?.nombre || "");
                case 'codigo':
                    return sortConfig.direction === 'asc'
                        ? (a.articulo?.cod_articulo || "").localeCompare(b.articulo?.cod_articulo || "")
                        : (b.articulo?.cod_articulo || "").localeCompare(a.articulo?.cod_articulo || "");
                case 'descripcion':
                    return sortConfig.direction === 'asc'
                        ? (a.articulo?.descripcion || "").localeCompare(b.articulo?.descripcion || "")
                        : (b.articulo?.descripcion || "").localeCompare(a.articulo?.descripcion || "");
                case 'unidades':
                    return sortConfig.direction === 'asc' ? (a.unidades || 0) - (b.unidades || 0) : (b.unidades || 0) - (a.unidades || 0);
                case 'fecha_entrega':
                    return sortConfig.direction === 'asc'
                        ? new Date(a.fecha_entrega || '2100-01-01').getTime() - new Date(b.fecha_entrega || '2100-01-01').getTime()
                        : new Date(b.fecha_entrega || '1970-01-01').getTime() - new Date(a.fecha_entrega || '1970-01-01').getTime();
                default:
                    return 0;
            }
        });
    }, [filteredOrders, sortConfig]);

    const formatDate = (dateStr?: string) => {
        if (!dateStr || dateStr.startsWith('1950')) return "-";
        try {
            const date = new Date(dateStr);
            if (date.getFullYear() === 1950) return "-";
            return date.toLocaleDateString('es-AR', {
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
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 h-10 bg-gray-50/50 border-gray-200 focus:bg-white transition-all rounded-lg"
                    />
                </div>
            </div>

            <WorkOrderFilters filters={filters} setFilters={setFilters} orders={orders} />

            {filteredOrders.length === 0 ? (
                <div className="py-20 text-center bg-gray-50/30 rounded-2xl border-2 border-dashed border-gray-100">
                    <CheckCircle2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                    <h4 className="text-lg font-medium text-gray-900 font-bold">No se encontraron órdenes completadas</h4>
                    <p className="text-gray-500 max-w-xs mx-auto text-sm">
                        Las órdenes terminadas aparecerán aquí una vez que se marquen como "Finalizado Total".
                    </p>
                </div>
            ) : (
                <>
                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-3">
                        {sortedOrders.map((order) => (
                            <Card key={order.id} className="overflow-hidden border border-gray-200 shadow-sm bg-white">
                                <div className="p-4" onClick={() => toggleRow(order.id)}>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-lg text-gray-800">#{order.id_otvieja || order.id}</span>
                                            <Badge className="bg-green-100 text-green-700 border-green-200 text-[9px]">FINALIZADA</Badge>
                                        </div>
                                        <button className="text-gray-400">
                                            {expandedOrderIds.includes(order.id) ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                        </button>
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="font-semibold text-gray-900 line-clamp-1">
                                                {typeof order.cliente === 'object' ? order.cliente?.nombre : order.cliente || "-"}
                                            </span>
                                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{order.articulo?.cod_articulo}</span>
                                        </div>
                                        <div className="text-gray-600 line-clamp-2 text-xs">{(order.articulo?.cod_articulo === 'NO-DEF' || order.articulo?.descripcion?.toLowerCase().includes('heredado')) && order.observaciones ? order.observaciones : order.articulo?.descripcion}</div>
                                        <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-gray-100/50 mt-2">
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">Entregado</span>
                                                <span className="font-medium text-green-700">{order.cantidad_entregada || 0} / {order.unidades || 0}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">F. Entrega</span>
                                                <span className="font-medium">{formatDate(order.fecha_entrega)}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">N° Pedido</span>
                                                <span className="font-medium text-gray-700">{order.n_pedido || order.n_ped_l || "-"}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">Aprobado Por</span>
                                                <span className="font-medium text-gray-700">{order.aprobado_por || "-"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {expandedOrderIds.includes(order.id) && (
                                    <div className="bg-gray-50 border-t p-3 space-y-2">
                                        <div className="text-xs text-gray-600">
                                            <span className="font-bold text-gray-800">Observaciones: </span>
                                            {order.observaciones || order.detalle || "Sin observaciones adicionales"}
                                        </div>
                                        <OrderFiles orderId={order.id} />
                                        {/* Process Sub-Table */}
                                        {order.procesos && order.procesos.length > 0 ? (
                                            <div className="w-full border rounded-md overflow-hidden bg-white shadow-inner">
                                                <div className="bg-gray-100 text-[11px] uppercase text-gray-600 grid grid-cols-[40px_3fr_110px_70px] gap-3 px-4 py-2 font-bold border-b border-gray-200">
                                                    <div>#</div>
                                                    <div>Proceso</div>
                                                    <div>Estado</div>
                                                    <div className="text-center">Min. Est.</div>
                                                </div>
                                                {[...order.procesos].sort((a, b) => a.orden - b.orden).map((proc) => (
                                                    <div key={`${order.id}-${proc.proceso.id}`} className="grid grid-cols-[40px_3fr_110px_70px] gap-3 px-4 py-3 border-t hover:bg-gray-50 items-center bg-white text-sm">
                                                        <div className="text-gray-500 font-mono">{proc.orden}</div>
                                                        <div className="font-medium text-xs truncate">{proc.proceso?.nombre || "-"}</div>
                                                        <div>
                                                            <Badge className={cn(
                                                                "text-[10px] shadow-none",
                                                                proc.estado_proceso?.id === 3 ? "bg-green-100 text-green-800 border-green-200" :
                                                                proc.estado_proceso?.id === 2 ? "bg-blue-100 text-blue-800 border-blue-200" :
                                                                "bg-gray-100 text-gray-800 border-gray-200"
                                                            )}>
                                                                {proc.estado_proceso?.id === 3 ? "Finalizado" : proc.estado_proceso?.id === 2 ? "En Proceso" : "Pendiente"}
                                                            </Badge>
                                                        </div>
                                                        <div className="text-center text-gray-600 text-xs">{proc.tiempo_proceso || "-"}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-gray-400 italic py-2">Sin procesos cargados</div>
                                        )}
                                        <div className="flex justify-end pt-2">
                                            <Button variant="ghost" size="sm" className="h-8 text-blue-600 hover:bg-blue-50 gap-1.5" onClick={() => onEdit(order)}>
                                                <Eye className="w-3.5 h-3.5" /> Ver Detalles
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        ))}
                    </div>

                    {/* Desktop Table View */}
                    <Card className="hidden md:block overflow-hidden border-none shadow-xl bg-white w-full">
                        <div className="w-full overflow-x-auto">
                            <table className="w-full min-w-[1000px] text-sm text-left">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                                    <tr>
                                        <th className="w-10 px-3 py-3"></th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('id_otvieja')}>
                                            <div className="flex items-center">OT<SortIcon column="id_otvieja" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('fecha_entrada')}>
                                            <div className="flex items-center">F. Entrada<SortIcon column="fecha_entrada" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('cliente')}>
                                            <div className="flex items-center">Cliente<SortIcon column="cliente" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('codigo')}>
                                            <div className="flex items-center">Código<SortIcon column="codigo" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group min-w-[400px]" onClick={() => handleSort('descripcion')}>
                                            <div className="flex items-center">Producto<SortIcon column="descripcion" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600">N° Pedido</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('unidades')}>
                                            <div className="flex items-center justify-center">Cant.<SortIcon column="unidades" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center">Entregado</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('fecha_entrega')}>
                                            <div className="flex items-center">F. Entrega<SortIcon column="fecha_entrega" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600">Aprobado x</th>
                                        <th className="px-3 py-3 font-bold text-gray-600">Pedido x</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center">Estado</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedOrders.length === 0 ? (
                                        <tr className="bg-gray-50 border-b">
                                            <td colSpan={15} className="px-4 py-8 text-center text-gray-500">
                                                {searchTerm ? "No se encontraron resultados para la búsqueda." : "No hay órdenes completadas."}
                                            </td>
                                        </tr>
                                    ) : (
                                        sortedOrders.map((order) => (
                                            <React.Fragment key={order.id}>
                                                <tr className="border-b transition-colors duration-150 hover:bg-green-50/50 bg-white cursor-pointer">
                                                    <td className="px-4 py-3">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); toggleRow(order.id); }}
                                                            className="p-1 hover:bg-black/10 rounded transition-colors"
                                                        >
                                                            {expandedOrderIds.includes(order.id) ? (
                                                                <ChevronDown className="h-4 w-4 text-gray-600" />
                                                            ) : (
                                                                <ChevronRight className="h-4 w-4 text-gray-400" />
                                                            )}
                                                        </button>
                                                    </td>
                                                    <td className="px-3 py-3 font-medium">{order.id_otvieja || order.id}</td>
                                                    <td className="px-3 py-3">{formatDate(order.fecha_entrada)}</td>
                                                    <td className="px-3 py-3 text-gray-500 italic">{typeof order.cliente === 'object' ? order.cliente?.nombre : order.cliente || "-"}</td>
                                                    <td className="px-3 py-3 font-mono text-xs">{order.articulo?.cod_articulo || "-"}</td>
                                                    <td className="px-3 py-3 font-medium text-gray-900 min-w-[400px]" title={(order.articulo?.cod_articulo === 'NO-DEF' || order.articulo?.descripcion?.toLowerCase().includes('heredado')) && order.observaciones ? order.observaciones : (order.articulo?.descripcion || "-")}>{(order.articulo?.cod_articulo === 'NO-DEF' || order.articulo?.descripcion?.toLowerCase().includes('heredado')) && order.observaciones ? order.observaciones : (order.articulo?.descripcion || "-")}</td>
                                                    <td className="px-3 py-3 text-xs text-gray-600">{order.n_pedido || order.n_ped_l || "-"}</td>
                                                    <td className="px-3 py-3 text-center font-medium">{order.unidades ?? "-"}</td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className="text-xs font-bold text-green-700">
                                                            {order.cantidad_entregada || 0} / {order.unidades || 0}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 font-medium">{formatDate(order.fecha_entrega)}</td>
                                                    <td className="px-3 py-3 text-xs text-gray-600" title={order.aprobado_por || "-"}>{order.aprobado_por || "-"}</td>
                                                    <td className="px-3 py-3 text-xs text-gray-600" title={order.requerido_por || "-"}>{order.requerido_por || "-"}</td>
                                                    <td className="px-3 py-3 text-center">
                                                        <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-green-200 shadow-none">
                                                            Finalizada
                                                        </Badge>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center justify-center">
                                                            <Button 
                                                                variant="ghost" 
                                                                size="sm" 
                                                                className="h-7 px-2.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1 text-xs font-bold"
                                                                onClick={(e) => { e.stopPropagation(); onEdit(order); }}
                                                            >
                                                                <Eye className="w-3 h-3" /> Ver
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {expandedOrderIds.includes(order.id) && (
                                                    <tr className="bg-gray-50 border-b">
                                                        <td colSpan={15} className="px-4 py-4">
                                                            <div className="space-y-3">
                                                                <div className="text-xs text-gray-600">
                                                                    <span className="font-bold text-gray-800">Observaciones: </span>
                                                                    {order.observaciones || order.detalle || "Sin observaciones adicionales"}
                                                                </div>
                                                                <OrderFiles orderId={order.id} />
                                                                {/* Process Sub-Table */}
                                                                {order.procesos && order.procesos.length > 0 ? (
                                                                    <div className="w-full border rounded-md overflow-hidden bg-white shadow-inner">
                                                                        <div className="bg-gray-100 text-[11px] uppercase text-gray-600 grid grid-cols-[40px_3fr_110px_70px_70px_2fr] gap-3 px-4 py-2 font-bold border-b border-gray-200">
                                                                            <div>#</div>
                                                                            <div>Proceso</div>
                                                                            <div>Estado</div>
                                                                            <div className="text-center">Min. Est.</div>
                                                                            <div className="text-center text-blue-700">Min. Real</div>
                                                                            <div>Operario</div>
                                                                        </div>
                                                                        {[...order.procesos].sort((a, b) => a.orden - b.orden).map((proc) => (
                                                                            <div key={`${order.id}-${proc.proceso.id}`} className="grid grid-cols-[40px_3fr_110px_70px_70px_2fr] gap-3 px-4 py-3 border-t hover:bg-gray-50 items-center bg-white text-sm">
                                                                                <div className="text-gray-500 font-mono">{proc.orden}</div>
                                                                                <div className="font-medium text-xs md:text-sm truncate" title={proc.proceso?.nombre || "-"}>{proc.proceso?.nombre || "-"}</div>
                                                                                <div>
                                                                                    <Badge className={cn(
                                                                                        "text-[10px] shadow-none font-medium",
                                                                                        proc.estado_proceso?.id === 3 ? "bg-green-100 text-green-800 border-green-200" :
                                                                                        proc.estado_proceso?.id === 2 ? "bg-blue-100 text-blue-800 border-blue-200" :
                                                                                        "bg-gray-100 text-gray-800 border-gray-200"
                                                                                    )}>
                                                                                        {proc.estado_proceso?.id === 3 ? "Finalizado" : proc.estado_proceso?.id === 2 ? "En Proceso" : "Pendiente"}
                                                                                    </Badge>
                                                                                </div>
                                                                                <div className="text-center text-gray-600 text-xs">{proc.tiempo_proceso || "-"}</div>
                                                                                <div className="text-center font-bold text-blue-700 text-xs">
                                                                                    {proc.inicio_real && proc.fin_real
                                                                                        ? `${Math.round((new Date(proc.fin_real).getTime() - new Date(proc.inicio_real).getTime()) / 60000)} min`
                                                                                        : proc.inicio_real ? "En curso..." : "-"
                                                                                    }
                                                                                </div>
                                                                                <div className="text-gray-700 text-xs font-medium truncate">
                                                                                    {proc.operario_nombre ? proc.operario_nombre.toLowerCase().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : "Sin Asignar"}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-xs text-gray-400 italic py-2">Sin procesos cargados</div>
                                                                )}
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
                </>
            )}
        </div>
    );
}
