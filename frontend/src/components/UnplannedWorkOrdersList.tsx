"use client";

import React, { useState } from "react";
import { 
    Search, 
    AlertCircle, 
    Edit2, 
    Trash2,
    Clock,
    ChevronDown,
    ChevronRight,
    Calendar,
    Package,
    CheckCircle2,
    AlertTriangle,
    FileText,
    Settings,
    MessageSquare,
    PlusCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WorkOrder } from "@/lib/types";
import { OrderFiles } from "./common/OrderFiles";
import { cn, getWorkOrderRowColor } from "@/lib/utils";
import { WorkOrderFilters, WorkOrderFilterState, initialFilterState, applyWorkOrderFilters } from "./common/WorkOrderFilters";
import { AddProcessRow } from "./planning/AddProcessRow";

interface UnplannedWorkOrdersListProps {
    orders: WorkOrder[];
    onEdit: (order: WorkOrder) => void;
    onDelete: (id: number) => void;
    onDataChange?: () => void;
    /** Zoom (%) aplicado SOLO a la tabla, no al header ni a los filtros. */
    tableZoom?: number;
}

export function UnplannedWorkOrdersList({ orders, onEdit, onDelete, onDataChange, tableZoom = 100 }: UnplannedWorkOrdersListProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [expandedOrderIds, setExpandedOrderIds] = useState<number[]>([]);
    const [filters, setFilters] = useState<WorkOrderFilterState>(initialFilterState);

    // Mismo patrón que PlanningListTable: el degradado del borde derecho se oculta
    // dinámicamente cuando el usuario llegó al final del scroll horizontal.
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [showRightFade, setShowRightFade] = useState(true);
    const [sortConfig, setSortConfig] = useState<{
        key: 'id' | 'id_otvieja' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion' | 'unidades' | 'prioridad' | 'material' | 'proceso' | 'plano' | 'entrega' | 'fecha_prometida' | null;
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

    const getEditableProductDescription = (order: WorkOrder) => {
        if ((order.articulo?.cod_articulo === 'NO-DEF' || order.articulo?.descripcion?.toLowerCase().includes('heredado')) && order.observaciones) {
            return order.observaciones;
        }
        return order.articulo?.descripcion;
    };

    const SortIcon = ({ column }: { column: typeof sortConfig.key }) => {
        if (sortConfig.key !== column || !sortConfig.direction) return <span className="ml-1 text-gray-300 opacity-0 group-hover:opacity-50">↕</span>;
        return <span className="ml-1 text-orange-600 font-bold">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
    };

    // Observa el scroll horizontal y actualiza `showRightFade` (true cuando hay
    // más columnas a la derecha, false cuando se llegó al final). Margen de 2px
    // para evitar parpadeo por subpixel rendering.
    React.useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const updateFade = () => {
            const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
            setShowRightFade(remaining > 2);
        };
        updateFade();
        el.addEventListener('scroll', updateFade, { passive: true });
        const ro = new ResizeObserver(updateFade);
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', updateFade);
            ro.disconnect();
        };
    }, [orders.length, tableZoom]);

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
        if (!sortConfig.key || !sortConfig.direction) return filteredOrders;
        return [...filteredOrders].sort((a, b) => {
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
                case 'prioridad':
                    return sortConfig.direction === 'asc' ? (a.id_prioridad || 0) - (b.id_prioridad || 0) : (b.id_prioridad || 0) - (a.id_prioridad || 0);
                case 'material': {
                    // Rango: OK (mejor) → Pedido → Sin Stock (peor). `undefined` se trata como Sin Stock.
                    const rank = (estado?: string) => (estado === 'ok' ? 2 : estado === 'pedido' ? 1 : 0);
                    const diff = rank(a.estado_material) - rank(b.estado_material);
                    return sortConfig.direction === 'asc' ? diff : -diff;
                }
                case 'proceso': {
                    const has = (o: WorkOrder) => (o.procesos && o.procesos.length > 0 ? 1 : 0);
                    const diff = has(a) - has(b);
                    return sortConfig.direction === 'asc' ? diff : -diff;
                }
                case 'plano': {
                    const has = (o: WorkOrder) => (Number(o.tiene_plano) === 1 ? 1 : 0);
                    const diff = has(a) - has(b);
                    return sortConfig.direction === 'asc' ? diff : -diff;
                }
                case 'entrega': {
                    // Ordena por proporción entregada (cantidad_entregada / unidades).
                    const ratio = (o: WorkOrder) => (o.cantidad_entregada || 0) / (o.unidades || 1);
                    const diff = ratio(a) - ratio(b);
                    return sortConfig.direction === 'asc' ? diff : -diff;
                }
                case 'fecha_prometida':
                    return sortConfig.direction === 'asc'
                        ? new Date(a.fecha_prometida || 0).getTime() - new Date(b.fecha_prometida || 0).getTime()
                        : new Date(b.fecha_prometida || 0).getTime() - new Date(a.fecha_prometida || 0).getTime();
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

    const getPriorityLabel = (priorityId?: number, descripcion?: string) => {
        if (descripcion) return descripcion;
        switch (priorityId) {
            case 3: return "Crítica";
            case 2: return "Urgente";
            case 1: return "Normal";
            default: return "Normal";
        }
    };

    return (
        <div className="space-y-4">
            {/* Header & Search */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
                        <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900">Órdenes No Planificadas</h3>
                        <p className="text-xs text-gray-500">Estas órdenes requieren configuración de procesos y fechas.</p>
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
                    <Clock className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                    <h4 className="text-lg font-medium text-gray-900 font-bold">No hay órdenes pendientes</h4>
                    <p className="text-gray-500 max-w-xs mx-auto text-sm">
                        Todas las órdenes de trabajo actuales ya han sido planificadas en el sistema.
                    </p>
                </div>
            ) : (
                <>
                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-3">
                        {sortedOrders.map((order) => (
                            <Card key={order.id} className={cn("overflow-hidden border border-gray-200 shadow-sm", getWorkOrderRowColor(order))}>
                                <div className="p-4" onClick={() => toggleRow(order.id)}>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-lg text-gray-800">#{order.id_otvieja || order.id}</span>
                                            <Badge className="bg-orange-50 text-orange-700 border-orange-100 text-[9px]">PENDIENTE</Badge>
                                        </div>
                                        <button className="text-gray-400">
                                            {expandedOrderIds.includes(order.id) ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                        </button>
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="font-semibold text-gray-900 line-clamp-1">{order.cliente?.nombre || "-"}</span>
                                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{order.articulo?.cod_articulo}</span>
                                        </div>
                                        <div className="text-gray-600 line-clamp-2 text-xs">{(order.articulo?.cod_articulo === 'NO-DEF' || order.articulo?.descripcion?.toLowerCase().includes('heredado')) && order.observaciones ? order.observaciones : order.articulo?.descripcion}</div>
                                        <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-gray-100/50 mt-2">
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">Cant.</span>
                                                <span className="font-medium">{order.unidades}</span>
                                            </div>
                                            <div>
                                                <span className="text-gray-500 block text-[10px] uppercase">Prioridad</span>
                                                <Badge variant="outline" className="bg-white/50 text-[10px] h-5 px-1.5">
                                                    {getPriorityLabel(order.id_prioridad, order.prioridad?.descripcion)}
                                                </Badge>
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
                                                    <div key={`${order.id}-${proc.proceso.id}`} className="grid grid-cols-[40px_3fr_110px_70px] gap-3 px-3 py-3 border-t hover:bg-gray-50 items-center bg-white text-sm">
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
                                        <div className="flex gap-2 justify-end pt-2">
                                            <Button variant="ghost" size="sm" className="h-8 text-orange-600 hover:bg-orange-50 gap-1.5" onClick={() => onEdit(order)}>
                                                <Edit2 className="w-3.5 h-3.5" /> Editar
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600 hover:bg-red-50" onClick={() => onDelete(order.id)}>
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        ))}
                    </div>

                    {/* Desktop Table View. El `zoom` aplica SOLO acá (no al header ni a los filtros). */}
                    <Card className="hidden md:block overflow-hidden border-none shadow-xl bg-white w-full relative" style={{ zoom: tableZoom / 100 }}>
                        <div ref={scrollContainerRef} className="w-full overflow-x-auto scrollbar-horizontal-visible scrollbar-top">
                            <table className="w-full min-w-[1600px] text-sm text-left">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                                    <tr>
                                        <th className="w-10 px-3 py-3"></th>
                                        <th className="w-12 px-3 py-3 font-bold text-gray-500 text-center" title="Número de fila">#</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('id_otvieja')}>
                                            <div className="flex items-center">OT<SortIcon column="id_otvieja" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('fecha_entrada')}>
                                            <div className="flex items-center">F. Entrada<SortIcon column="fecha_entrada" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group min-w-[200px]" onClick={() => handleSort('cliente')}>
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
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('prioridad')}>
                                            <div className="flex items-center justify-center">Prioridad<SortIcon column="prioridad" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('material')}>
                                            <div className="flex items-center justify-center">Material<SortIcon column="material" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" title="¿La OT tiene procesos cargados?" onClick={() => handleSort('proceso')}>
                                            <div className="flex items-center justify-center">Proceso<SortIcon column="proceso" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" title="¿La OT tiene plano cargado?" onClick={() => handleSort('plano')}>
                                            <div className="flex items-center justify-center">Plano<SortIcon column="plano" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('entrega')}>
                                            <div className="flex items-center justify-center">Entrega<SortIcon column="entrega" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group" onClick={() => handleSort('fecha_prometida')}>
                                            <div className="flex items-center">F. Prometida<SortIcon column="fecha_prometida" /></div>
                                        </th>
                                        <th className="px-3 py-3 font-bold text-gray-600">Aprobado x</th>
                                        <th className="px-3 py-3 font-bold text-gray-600">Pedido x</th>
                                        <th className="px-3 py-3 font-bold text-gray-600 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                {/* `[&_td]:align-middle` centra verticalmente las celdas de cada fila
                                    para que cuando el nombre del cliente o el producto haga wrap a
                                    varias líneas, el resto de las celdas (#, OT, fecha, código) no
                                    queden ancladas al top. */}
                                <tbody className="[&_td]:align-middle">
                                    {sortedOrders.length === 0 ? (
                                        <tr className="bg-gray-50 border-b">
                                            <td colSpan={19} className="px-4 py-8 text-center text-gray-500">
                                                {searchTerm ? "No se encontraron resultados para la búsqueda." : "No hay órdenes pendientes."}
                                            </td>
                                        </tr>
                                    ) : (
                                        sortedOrders.map((order, index) => (
                                            <React.Fragment key={order.id}>
                                                {/* Doble click en cualquier parte de la fila abre el modal de edición. */}
                                                <tr className={cn("border-b transition-colors duration-150 cursor-pointer", getWorkOrderRowColor(order))} onDoubleClick={() => onEdit(order)}>
                                                    <td className="px-3 py-3">
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
                                                    <td className="px-3 py-3 text-center text-gray-500 font-mono text-xs select-none">{index + 1}</td>
                                                    <td className="px-3 py-3 font-medium">{order.id_otvieja || order.id}</td>
                                                    <td className="px-3 py-3 font-medium">
                                                        {formatDate(order.fecha_entrada)}
                                                    </td>
                                                    <td className="px-3 py-3 text-gray-500 italic">{typeof order.cliente === 'object' ? order.cliente?.nombre : order.cliente || "-"}</td>
                                                    <td className="px-3 py-3 font-mono text-xs">{order.articulo?.cod_articulo || "-"}</td>
                                                    <td className="px-3 py-3 font-medium text-gray-900 min-w-[300px] max-w-[450px]">
                                                        <span className="line-clamp-2" title={getEditableProductDescription(order)}>
                                                            {getEditableProductDescription(order) || "-"}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 text-xs text-gray-600">
                                                        {order.n_pedido || order.n_ped_l || "-"}
                                                    </td>
                                                    <td className="px-3 py-3 text-center font-medium">
                                                        {order.unidades ?? "-"}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                            {getPriorityLabel(order.id_prioridad, order.prioridad?.descripcion)}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        {order.estado_material === 'sin_stock' ? (
                                                            <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200 gap-1 pl-1.5 shadow-none font-semibold">
                                                                <AlertTriangle className="h-3 w-3" /> Sin Stock
                                                            </Badge>
                                                        ) : order.estado_material === 'pedido' ? (
                                                            <Badge variant="outline" className="bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200 gap-1 pl-1.5 shadow-none font-semibold">
                                                                Pedido
                                                            </Badge>
                                                        ) : order.estado_material === 'ok' ? (
                                                            <Badge variant="outline" className="bg-green-50 text-green-700 hover:bg-green-100 border-green-200 gap-1 pl-1.5 shadow-none font-semibold">
                                                                <CheckCircle2 className="h-3 w-3" /> OK
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200 gap-1 pl-1.5 shadow-none font-semibold">
                                                                <AlertTriangle className="h-3 w-3" /> Sin Stock
                                                            </Badge>
                                                        )}
                                                    </td>
                                                    {/* Proceso: Sí (verde) si tiene al menos un proceso cargado, No (gris) si no. */}
                                                    <td className="px-3 py-3 text-center">
                                                        {(order.procesos && order.procesos.length > 0) ? (
                                                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-semibold">Sí</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 font-semibold">No</Badge>
                                                        )}
                                                    </td>
                                                    {/* Plano: Sí (verde) si tiene_plano==1, No (gris) si no. */}
                                                    <td className="px-3 py-3 text-center">
                                                        {Number(order.tiene_plano) === 1 ? (
                                                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-semibold">Sí</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 font-semibold">No</Badge>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className={cn(
                                                            "text-xs font-bold",
                                                            (order.cantidad_entregada || 0) >= (order.unidades || 1) ? "text-green-700" : "text-orange-600"
                                                        )}>
                                                            {order.cantidad_entregada || 0} / {order.unidades || 0}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 font-medium">
                                                        {formatDate(order.fecha_prometida)}
                                                    </td>
                                                    <td className="px-3 py-3 text-xs text-gray-600" title={order.aprobado_por || "-"}>
                                                        {order.aprobado_por || "-"}
                                                    </td>
                                                    <td className="px-3 py-3 text-xs text-gray-600" title={order.requerido_por || "-"}>
                                                        {order.requerido_por || "-"}
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                onClick={(e) => { e.stopPropagation(); onDelete(order.id); }}
                                                                title="Eliminar Orden"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {expandedOrderIds.includes(order.id) && (
                                                    <tr className="bg-gray-50/20 border-b">
                                                        <td colSpan={19} className="px-3 py-3 md:px-6 md:py-4">
                                                            <div className="flex flex-col gap-4 w-full max-w-[1200px]">
                                                                {/* Grid layout for meta info - More compact columns */}
                                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                                    {/* Observaciones Panel - Smaller min-height, compact header */}
                                                                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col md:col-span-1 lg:col-span-2">
                                                                        <div className="px-3 py-1.5 bg-gray-50/50 border-b border-gray-100 flex items-center gap-2">
                                                                            <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
                                                                            <span className="text-[10px] font-bold uppercase tracking-tight text-gray-500">Observaciones</span>
                                                                        </div>
                                                                        <div className="p-3 text-xs text-gray-600 leading-relaxed min-h-[50px]">
                                                                            {order.observaciones || order.detalle ? (
                                                                                <div className="whitespace-pre-wrap">{order.observaciones || order.detalle}</div>
                                                                            ) : (
                                                                                <span className="text-gray-400 italic">Sin observaciones.</span>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* Archivos Panel - Compact layout */}
                                                                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                                                                        <div className="px-3 py-1.5 bg-gray-50/50 border-b border-gray-100 flex items-center gap-2">
                                                                            <FileText className="w-3.5 h-3.5 text-gray-400" />
                                                                            <span className="text-[10px] font-bold uppercase tracking-tight text-gray-500">Archivos</span>
                                                                        </div>
                                                                        <div className="p-2">
                                                                            <OrderFiles orderId={order.id} />
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Proceso Panel - Tighter headers and rows */}
                                                                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                                                                    <div className="px-3 py-1.5 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            <Settings className="w-3.5 h-3.5 text-gray-400" />
                                                                            <span className="text-[10px] font-bold uppercase tracking-tight text-gray-500">Producción</span>
                                                                        </div>
                                                                        {order.procesos && order.procesos.length > 0 && (
                                                                            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                                                                {order.procesos.length} PASOS
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    
                                                                    <div className="flex flex-col">
                                                                        {order.procesos && order.procesos.length > 0 ? (
                                                                            <>
                                                                                <div className="bg-gray-50/30 text-[9px] uppercase text-gray-400 grid grid-cols-[30px_3fr_100px_80px_80px_2fr] gap-3 px-4 py-1.5 font-bold border-b border-gray-100">
                                                                                    <div>#</div>
                                                                                    <div>Proceso</div>
                                                                                    <div>Estado</div>
                                                                                    <div className="text-center">Min. Est.</div>
                                                                                    <div className="text-center">Min. Real</div>
                                                                                    <div>Operario</div>
                                                                                </div>
                                                                                {[...order.procesos].sort((a, b) => a.orden - b.orden).map((proc, pIdx) => (
                                                                                    <div key={`${order.id}-${proc.proceso.id}`} className={cn(
                                                                                        "grid grid-cols-[30px_3fr_100px_80px_80px_2fr] gap-3 px-4 py-2.5 border-b hover:bg-gray-50/80 items-center bg-white transition-colors",
                                                                                        pIdx === order.procesos!.length - 1 && "border-b-0"
                                                                                    )}>
                                                                                        <div className="text-gray-300 font-mono text-[10px]">{pIdx + 1}</div>
                                                                                        <div className="font-semibold text-xs text-gray-800 truncate" title={proc.proceso?.nombre || "-"}>{proc.proceso?.nombre || "-"}</div>
                                                                                        <div>
                                                                                            <Badge className={cn(
                                                                                                "text-[9px] px-1.5 py-0 shadow-none font-bold uppercase leading-tight",
                                                                                                proc.estado_proceso?.id === 3 ? "bg-green-100 text-green-700 border-green-200" :
                                                                                                proc.estado_proceso?.id === 2 ? "bg-blue-100 text-blue-700 border-blue-200" :
                                                                                                "bg-gray-100 text-gray-500 border-gray-200"
                                                                                            )}>
                                                                                                {proc.estado_proceso?.id === 3 ? "OK" : proc.estado_proceso?.id === 2 ? "Producc." : "Pend."}
                                                                                            </Badge>
                                                                                        </div>
                                                                                        <div className="text-center text-gray-500 tabular-nums text-[10px]">{proc.tiempo_proceso || "-"}</div>
                                                                                        <div className="text-center font-bold text-blue-600 tabular-nums text-[10px]">
                                                                                            {proc.inicio_real && proc.fin_real
                                                                                                ? `${Math.round((new Date(proc.fin_real).getTime() - new Date(proc.inicio_real).getTime()) / 60000)}`
                                                                                                : proc.inicio_real ? "..." : "-"
                                                                                            }
                                                                                        </div>
                                                                                        <div className="text-gray-500 text-[10px] font-medium truncate flex items-center gap-1.5 border-l border-gray-100 pl-2 h-4">
                                                                                            {proc.operario_nombre ? proc.operario_nombre.toLowerCase().split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : "Sin Asignar"}
                                                                                        </div>
                                                                                    </div>
                                                                                ))}
                                                                                <div className="bg-gray-50/50 border-t border-gray-100">
                                                                                    <AddProcessRow 
                                                                                        orderId={order.id} 
                                                                                        onProcessAdded={() => onDataChange && onDataChange()} 
                                                                                    />
                                                                                </div>
                                                                            </>
                                                                        ) : (
                                                                            <div className="p-4 flex items-center justify-between bg-white">
                                                                                <div className="flex items-center gap-3">
                                                                                    <div className="bg-blue-50 p-2 rounded-full">
                                                                                        <PlusCircle className="w-4 h-4 text-blue-500" />
                                                                                    </div>
                                                                                    <div className="flex flex-col">
                                                                                        <span className="text-xs font-bold text-gray-700">Sin procesos configurados</span>
                                                                                        <span className="text-[10px] text-gray-400">Agregue los pasos para iniciar la producción.</span>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="w-auto">
                                                                                    <AddProcessRow 
                                                                                        orderId={order.id} 
                                                                                        onProcessAdded={() => onDataChange && onDataChange()} 
                                                                                        isCentered={false}
                                                                                        label="Configurar ahora"
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
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
                        {/* Gradient fade derecho — solo visible cuando hay más columnas a la
                            derecha del scroll. Desaparece con transición cuando el usuario
                            llega al final, igual que en PlanningListTable. */}
                        <div
                            className={`pointer-events-none absolute top-0 right-0 h-full w-12 bg-gradient-to-l from-white via-white/80 to-transparent transition-opacity duration-200 ${showRightFade ? 'opacity-100' : 'opacity-0'}`}
                        />
                    </Card>
                </>
            )}
        </div>
    );
}
