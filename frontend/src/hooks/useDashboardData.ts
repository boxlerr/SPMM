import { useState, useEffect, useCallback } from "react"
import {
    EstadisticasOrdenes,
    OrdenCritica,
    TimelineItem,
    TopCliente,
    DistribucionPrioridad,
    TiempoPromedio,
    TopArticulo,
    OrdenPrioridad,
    OrdenEstado,
} from "@/components/dashboard/types"
import { API_URL } from "@/config"
import { useAuth } from "@/contexts/AuthContext"

const getAuthHeaders = (): HeadersInit => {
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export function useDashboardData() {
    const apiUrl = API_URL
    const { notifySessionExpired } = useAuth()

    const [estadisticas, setEstadisticas] = useState<EstadisticasOrdenes | null>(null)
    const [ordenesCriticas, setOrdenesCriticas] = useState<OrdenCritica[]>([])
    const [timelineEntregas, setTimelineEntregas] = useState<TimelineItem[]>([])
    const [topClientes, setTopClientes] = useState<TopCliente[]>([])
    const [distribucionPrioridades, setDistribucionPrioridades] = useState<DistribucionPrioridad[]>([])
    const [tiempoPromedio, setTiempoPromedio] = useState<TiempoPromedio | null>(null)
    const [topArticulos, setTopArticulos] = useState<TopArticulo[]>([])

    const [loading, setLoading] = useState(true)
    const [loadingCriticas, setLoadingCriticas] = useState(true)
    const [loadingTimeline, setLoadingTimeline] = useState(true)
    const [loadingExtras, setLoadingExtras] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [selectedPriority, setSelectedPriority] = useState<string | null>(null)
    const [priorityOrders, setPriorityOrders] = useState<OrdenPrioridad[]>([])
    const [loadingPriorityOrders, setLoadingPriorityOrders] = useState(false)

    const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
    const [statusOrders, setStatusOrders] = useState<OrdenEstado[]>([])
    const [loadingStatusOrders, setLoadingStatusOrders] = useState(false)

    const fetchWithAuth = useCallback(async (endpoint: string) => {
        const response = await fetch(`${apiUrl}${endpoint}`, { headers: getAuthHeaders() })

        if (response.status === 401) {
            console.warn(`[useDashboardData] 401 Unauthorized at ${endpoint}. Notifying user...`)
            notifySessionExpired()
            // Return a dummy response to prevent crashes in calling functions
            return new Response(JSON.stringify({ data: [] }), { status: 401 })
        }

        return response
    }, [apiUrl, notifySessionExpired])

    const fetchEstadisticas = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const response = await fetchWithAuth("/api/dashboard/estadisticas")
            if (!response.ok) throw new Error("Error al cargar estadísticas")
            const data = await response.json()
            setEstadisticas(data.data || null)
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Error desconocido"
            if (msg !== "Sesión expirada") {
                setError(msg)
                console.error("Error fetching estadisticas:", err)
            }
        } finally {
            setLoading(false)
        }
    }, [fetchWithAuth])

    const fetchOrdenesCriticas = useCallback(async () => {
        try {
            setLoadingCriticas(true)
            const response = await fetchWithAuth("/api/dashboard/ordenes-criticas")
            if (!response.ok) throw new Error("Error al cargar órdenes críticas")
            const data = await response.json()
            setOrdenesCriticas(data.data || [])
        } catch (err) {
            console.error("Error fetching ordenes criticas:", err)
        } finally {
            setLoadingCriticas(false)
        }
    }, [fetchWithAuth])


    const fetchTimelineEntregas = useCallback(async () => {
        try {
            setLoadingTimeline(true)
            const response = await fetchWithAuth("/api/dashboard/timeline-entregas")
            if (!response.ok) throw new Error("Error al cargar timeline")
            const data = await response.json()
            setTimelineEntregas(data.data || [])
        } catch (err) {
            console.error("Error fetching timeline:", err)
        } finally {
            setLoadingTimeline(false)
        }
    }, [fetchWithAuth])

    const fetchTopClientes = useCallback(async () => {
        try {
            const response = await fetchWithAuth("/api/dashboard/clientes-mayor-volumen")
            if (!response.ok) throw new Error("Error al cargar top clientes")
            const data = await response.json()
            setTopClientes(data.data || [])
        } catch (err) {
            console.error("Error fetching top clientes:", err)
        }
    }, [fetchWithAuth])

    const fetchDistribucionPrioridades = useCallback(async () => {
        try {
            const response = await fetchWithAuth("/api/dashboard/distribucion-prioridades")
            if (!response.ok) throw new Error("Error al cargar prioridades")
            const data = await response.json()
            setDistribucionPrioridades(data.data || [])
        } catch (err) {
            console.error("Error fetching prioridades:", err)
        }
    }, [fetchWithAuth])

    const fetchTopArticulos = useCallback(async () => {
        try {
            const response = await fetchWithAuth("/api/dashboard/top-articulos")
            if (!response.ok) throw new Error("Error al cargar artículos")
            const data = await response.json()
            setTopArticulos(data.data || [])
        } catch (err) {
            console.error("Error fetching articulos:", err)
        }
    }, [fetchWithAuth])

    const fetchTiempoPromedio = useCallback(async () => {
        try {
            const response = await fetchWithAuth("/api/dashboard/tiempo-promedio")
            if (!response.ok) throw new Error("Error al cargar tiempo promedio")
            const data = await response.json()
            setTiempoPromedio(data.data || null)
        } catch (err) {
            console.error("Error fetching tiempo promedio:", err)
        }
    }, [fetchWithAuth])

    const fetchOrdenesPorPrioridad = useCallback(
        async (prioridad: string) => {
            try {
                console.log("Fetching orders for priority:", prioridad)
                setLoadingPriorityOrders(true)
                setSelectedPriority(prioridad)
                const endpoint = `/api/dashboard/ordenes-por-prioridad/${encodeURIComponent(prioridad)}`
                console.log("Fetch URL:", endpoint)

                const response = await fetchWithAuth(endpoint)
                if (!response.ok) throw new Error("Error al cargar órdenes por prioridad")
                const data = await response.json()
                console.log("Priority orders response:", data)
                setPriorityOrders(data.data || [])
            } catch (err) {
                console.error("Error fetching ordenes por prioridad:", err)
            } finally {
                setLoadingPriorityOrders(false)
            }
        },
        [fetchWithAuth]
    )

    const fetchOrdenesPorEstado = useCallback(
        async (estado: string) => {
            try {
                console.log("Fetching orders for status:", estado)
                setLoadingStatusOrders(true)
                setSelectedStatus(estado)
                const endpoint = `/api/dashboard/ordenes-por-estado/${encodeURIComponent(estado)}`
                console.log("Fetch URL:", endpoint)

                const response = await fetchWithAuth(endpoint)
                if (!response.ok) throw new Error("Error al cargar órdenes por estado")
                const data = await response.json()
                console.log("Status orders response:", data)
                setStatusOrders(data.data || [])
            } catch (err) {
                console.error("Error fetching ordenes por estado:", err)
            } finally {
                setLoadingStatusOrders(false)
            }
        },
        [fetchWithAuth]
    )

    useEffect(() => {
        fetchEstadisticas()
        fetchOrdenesCriticas()
        fetchTimelineEntregas()
    }, [fetchEstadisticas, fetchOrdenesCriticas, fetchTimelineEntregas])

    useEffect(() => {
        setLoadingExtras(true)
        Promise.all([
            fetchTopClientes(),
            fetchDistribucionPrioridades(),
            fetchTopArticulos(),
            fetchTiempoPromedio(),
        ]).finally(() => setLoadingExtras(false))
    }, [fetchTopClientes, fetchDistribucionPrioridades, fetchTopArticulos, fetchTiempoPromedio])

    const refreshAll = useCallback(() => {
        fetchEstadisticas()
        fetchOrdenesCriticas()
        fetchTimelineEntregas()
        fetchTopClientes()
        fetchDistribucionPrioridades()
        fetchTopArticulos()
        fetchTiempoPromedio()
    }, [
        fetchEstadisticas,
        fetchOrdenesCriticas,
        fetchTimelineEntregas,
        fetchTopClientes,
        fetchDistribucionPrioridades,
        fetchTopArticulos,
        fetchTiempoPromedio,
    ])

    return {
        estadisticas,
        ordenesCriticas,
        timelineEntregas,
        topClientes,
        distribucionPrioridades,
        tiempoPromedio,
        topArticulos,
        loading,
        loadingCriticas,
        loadingTimeline,
        loadingExtras,
        error,
        selectedPriority,
        priorityOrders,
        loadingPriorityOrders,
        setSelectedPriority,
        setPriorityOrders,
        fetchOrdenesPorPrioridad,
        selectedStatus,
        statusOrders,
        loadingStatusOrders,
        setSelectedStatus,
        setStatusOrders,
        fetchOrdenesPorEstado,
        refreshAll,
        apiUrl,
    }
}
