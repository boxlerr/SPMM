import React, { useMemo, useState } from "react"
import { OrdenEstado } from "./types"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { CalendarClock, CheckCircle2, AlertTriangle, ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react"

interface StatusOrdersModalProps {
    isOpen: boolean
    onClose: () => void
    selectedStatus: string | null
    statusOrders: OrdenEstado[]
    loading: boolean
    title?: string
}

export default function StatusOrdersModal({
    isOpen,
    onClose,
    selectedStatus,
    statusOrders,
    loading,
    title,
}: StatusOrdersModalProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [sortConfig, setSortConfig] = useState<{ key: keyof OrdenEstado | 'fecha_prometida' | 'fecha_entrada' | 'cod_articulo' | null, direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' })

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case "completadas": return "from-green-50 to-emerald-50"
            case "en_proceso":
            case "en_curso":
                return "from-blue-50 to-indigo-50"
            case "retrasadas": return "from-red-50 to-rose-50"
            case "pendientes": return "from-yellow-50 to-amber-50"
            default: return "from-gray-50 to-slate-50"
        }
    }

    const getStatusLabel = (status: string) => {
        switch (status.toLowerCase()) {
            case "completadas": return "Completadas"
            case "en_proceso":
            case "en_curso": return "En Curso"
            case "retrasadas": return "Retrasadas"
            case "pendientes": return "Pendientes"
            default: return status
        }
    }

    const formatDate = (dateStr?: string | null) => {
        if (!dateStr || dateStr.startsWith('1950') || dateStr.startsWith('3000')) return "-";
        try {
            const date = new Date(dateStr);
            // Fix timezone issue by using UTC slice if dateStr is YYYY-MM-DD
            if (dateStr.length === 10) {
                const [y, m, d] = dateStr.split('-').map(Number);
                return `${d.toString().padStart(2, '0')}/${m.toString().padStart(2, '0')}/${y}`;
            }
            return new Intl.DateTimeFormat('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).format(date);
        } catch (e) {
            return dateStr;
        }
    };

    const handleSort = (key: keyof OrdenEstado | 'fecha_prometida' | 'fecha_entrada' | 'cod_articulo') => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const filteredOrders = useMemo(() => {
        const safeOrders = statusOrders || []
        const lowerTerm = searchTerm.toLowerCase()

        let filtered = safeOrders.filter(orden =>
            orden.id.toString().includes(lowerTerm) ||
            (orden.articulo || "").toLowerCase().includes(lowerTerm) ||
            (orden.cod_articulo || "").toLowerCase().includes(lowerTerm) ||
            (orden.cliente || "").toLowerCase().includes(lowerTerm) ||
            (orden.sector || "").toLowerCase().includes(lowerTerm)
        );

        if (sortConfig.key) {
            filtered.sort((a, b) => {
                let valA: any = a[sortConfig.key as keyof OrdenEstado];
                let valB: any = b[sortConfig.key as keyof OrdenEstado];

                // Handle undefined/null
                if (valA === undefined || valA === null) valA = "";
                if (valB === undefined || valB === null) valB = "";

                // Date comparison logic if needed
                if (sortConfig.key === 'fecha_entrada' || sortConfig.key === 'fecha_entrega' || sortConfig.key === 'fecha_prometida') {
                    const dateA = new Date(valA || '1970-01-01').getTime();
                    const dateB = new Date(valB || '1970-01-01').getTime();
                    return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
                }

                // Numeric comparison
                if (typeof valA === 'number' && typeof valB === 'number') {
                    return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
                }

                // String comparison
                return sortConfig.direction === 'asc'
                    ? String(valA).localeCompare(String(valB))
                    : String(valB).localeCompare(String(valA));
            });
        }

        return filtered;
    }, [statusOrders, searchTerm, sortConfig]);

    const getRowClass = (orden: OrdenEstado) => {
        // Logic matching PlanningListTable styles (intensity 200/300)
        const statusLower = orden.estado.toLowerCase();

        if (statusLower === 'completada' || statusLower === 'finalizado' || statusLower.includes('compl')) {
            return "bg-purple-200 hover:bg-purple-300 text-purple-900";
        }
        if (statusLower.includes('curso') || statusLower.includes('proceso')) {
            return "bg-orange-200 hover:bg-orange-300 text-orange-900";
        }
        if (statusLower === 'retrasada') {
            return "bg-red-200 hover:bg-red-300 text-red-900";
        }
        if (statusLower === 'pendiente') {
            return "bg-green-100 hover:bg-green-200 text-green-900";
        }
        return "bg-white hover:bg-gray-50 text-gray-900";
    };

    const renderSortIcon = (key: string) => {
        if (sortConfig.key !== key) return <ArrowUpDown className="h-3 w-3 ml-1 text-gray-400 opacity-0 group-hover:opacity-50" />;
        return sortConfig.direction === 'asc'
            ? <ChevronUp className="h-3 w-3 ml-1 text-red-600" />
            : <ChevronDown className="h-3 w-3 ml-1 text-red-600" />;
    };

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all duration-300"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl max-w-[90vw] w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className={`px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r ${getStatusColor(selectedStatus || "")}`}>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">{title || `Órdenes ${getStatusLabel(selectedStatus || "")}`}</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            {filteredOrders.length} {filteredOrders.length === 1 ? "orden encontrada" : "órdenes encontradas"}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-lg transition-colors">
                        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Search Bar */}
                <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/50">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Buscar por ID, artículo, cliente..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                        <svg className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                </div>

                {/* Table Content */}
                <div className="flex-1 overflow-auto bg-gray-50 p-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-blue-500"></div>
                        </div>
                    ) : filteredOrders.length === 0 ? (
                        <div className="text-center py-20 bg-white rounded-lg border border-gray-200 mx-auto max-w-2xl shadow-sm">
                            <p className="text-gray-500">No hay órdenes que coincidan con la búsqueda</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                                    <tr>
                                        <th className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('id')}>
                                            <div className="flex items-center">OT {renderSortIcon('id')}</div>
                                        </th>
                                        <th className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('fecha_entrada')}>
                                            <div className="flex items-center">F. Entrada {renderSortIcon('fecha_entrada')}</div>
                                        </th>
                                        <th className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('cliente')}>
                                            <div className="flex items-center">Cliente {renderSortIcon('cliente')}</div>
                                        </th>
                                        <th className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('cod_articulo')}>
                                            <div className="flex items-center">Código {renderSortIcon('cod_articulo')}</div>
                                        </th>
                                        <th className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('articulo')}>
                                            <div className="flex items-center">Descripción {renderSortIcon('articulo')}</div>
                                        </th>
                                        <th className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('cantidad')}>
                                            <div className="flex items-center justify-center">Cant. {renderSortIcon('cantidad')}</div>
                                        </th>
                                        <th className="px-4 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('prioridad')}>
                                            <div className="flex items-center justify-center">Prioridad {renderSortIcon('prioridad')}</div>
                                        </th>

                                        <th className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('fecha_prometida')}>
                                            <div className="flex items-center">F. Prom. {renderSortIcon('fecha_prometida')}</div>
                                        </th>
                                        <th className="px-4 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 group" onClick={() => handleSort('fecha_entrega')}>
                                            <div className="flex items-center">F. Entrega {renderSortIcon('fecha_entrega')}</div>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredOrders.map((orden) => (
                                        <tr
                                            key={orden.id}
                                            className={`border-b transition-colors duration-150 ${getRowClass(orden)}`}
                                        >
                                            <td className="px-4 py-3 font-medium">{orden.id}</td>
                                            <td className="px-4 py-3">{formatDate(orden.fecha_entrada)}</td>
                                            <td className="px-4 py-3 text-gray-500 italic truncate max-w-[150px]" title={orden.cliente}>{orden.cliente}</td>
                                            <td className="px-4 py-3 font-mono text-xs">{orden.cod_articulo || "-"}</td>
                                            <td className="px-4 py-3 font-medium text-gray-900 truncate max-w-[250px]" title={orden.articulo}>{orden.articulo}</td>
                                            <td className="px-4 py-3 text-center font-bold">{orden.cantidad}</td>
                                            <td className="px-4 py-3 text-center">
                                                <Badge variant="outline" className={`bg-white/50 border-gray-400 text-gray-800 ${orden.prioridad === 'Urgente' ? 'text-red-700 bg-red-50 border-red-200' : ''}`}>
                                                    {orden.prioridad}
                                                </Badge>
                                            </td>

                                            <td className="px-4 py-3 text-xs">{formatDate(orden.fecha_prometida)}</td>
                                            <td className="px-4 py-3 text-xs font-semibold">
                                                {orden.fecha_entrega && !orden.fecha_entrega.startsWith('1950')
                                                    ? formatDate(orden.fecha_entrega)
                                                    : <span className="text-gray-400">-</span>
                                                }
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
