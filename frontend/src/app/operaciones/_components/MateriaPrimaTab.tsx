import React, { useState, useEffect } from "react";
import { API_URL } from "@/config";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Edit, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

interface Pieza {
    id: number;
    cod_pieza: string;
    descripcion: string;
    unitario?: number;
    unidad?: string;
    stockactual?: number;
    observaciones?: string;
    proveedor?: string;
    material?: string;
    formato?: string;
    estante?: string;
    letra?: string;
    nro?: string;
    id_otvieja?: number;
}

interface MetaData {
    total_count: number;
    page: number;
    size: number;
    total_pages: number;
}

const MateriaPrimaTab = () => {
    const [piezas, setPiezas] = useState<Pieza[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    // Pagination State
    const [page, setPage] = useState(1);
    const [pageSize] = useState(50);
    const [meta, setMeta] = useState<MetaData | null>(null);

    // Debounce Search
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setPage(1); // Reset to page 1 on search change
        }, 500);
        return () => clearTimeout(handler);
    }, [searchTerm]);

    useEffect(() => {
        fetchPiezas();
    }, [page, debouncedSearch]);

    const fetchPiezas = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('access_token');
            const params = new URLSearchParams({
                page: page.toString(),
                size: pageSize.toString(),
                search: debouncedSearch
            });

            const response = await fetch(`${API_URL}/piezas?${params.toString()}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });

            if (response.ok) {
                const json = await response.json();
                // Backend returns: ResponseDTO(data={data: [...], total_count: ...})
                // So json.data is the payload
                const payload = json.data;

                if (payload && Array.isArray(payload.data)) {
                    setPiezas(payload.data);
                    setMeta({
                        total_count: payload.total_count,
                        page: payload.page,
                        size: payload.size,
                        total_pages: payload.total_pages
                    });
                } else {
                    // Fallback if structure is different
                    setPiezas([]);
                }
            } else {
                console.error("Error fetching piezas:", response.status);
            }
        } catch (error) {
            console.error("Error fetching piezas:", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center gap-4">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por código o descripción..."
                        className="pl-8"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

            </div>

            <Card>
                <CardHeader className="dir-row justify-between items-center pb-2">
                    <div>
                        <CardTitle>Inventario de Materia Prima</CardTitle>
                        <CardDescription>
                            {meta ? `Mostrando ${piezas.length} de ${meta.total_count} registros` : 'Gestión de piezas'}
                        </CardDescription>
                    </div>
                    {meta && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <span>Página {meta.page} de {meta.total_pages}</span>
                            <div className="flex gap-1">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    disabled={page <= 1 || loading}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    disabled={page >= meta.total_pages || loading}
                                    onClick={() => setPage(p => p + 1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Código</TableHead>
                                    <TableHead className="w-[20%]">Descripción</TableHead>
                                    <TableHead>Material</TableHead>
                                    <TableHead>Formato</TableHead>
                                    <TableHead>Stock</TableHead>
                                    <TableHead>Unidad</TableHead>
                                    <TableHead>Ubicación</TableHead>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Precio</TableHead>
                                    <TableHead>Nº OT (id_otvieja)</TableHead>
                                    <TableHead className="max-w-[150px]">Obs</TableHead>

                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={10} className="h-24 text-center">
                                            <div className="flex justify-center items-center gap-2">
                                                <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
                                                <span>Cargando datos...</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : piezas.length > 0 ? (
                                    piezas.map((pieza) => (
                                        <TableRow key={pieza.id}>
                                            <TableCell className="font-medium text-xs">{pieza.cod_pieza}</TableCell>
                                            <TableCell className="text-xs">{pieza.descripcion}</TableCell>
                                            <TableCell className="text-xs text-gray-500">{pieza.material || '-'}</TableCell>
                                            <TableCell className="text-xs text-gray-500">{pieza.formato || '-'}</TableCell>
                                            <TableCell className="text-xs">{pieza.stockactual}</TableCell>
                                            <TableCell className="text-xs">{pieza.unidad}</TableCell>
                                            <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                                                {`${pieza.estante || ''} ${pieza.letra || ''} ${pieza.nro || ''}`.trim() || '-'}
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-500">{pieza.proveedor || '-'}</TableCell>
                                            <TableCell className="text-xs text-right">${pieza.unitario || 0}</TableCell>
                                            <TableCell className="text-xs text-gray-500">{pieza.id_otvieja ? `#${pieza.id_otvieja}` : '-'}</TableCell>
                                            <TableCell className="text-xs text-gray-500 max-w-[150px] truncate" title={pieza.observaciones || ''}>{pieza.observaciones || '-'}</TableCell>

                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                                            No se encontraron piezas
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default MateriaPrimaTab;
