import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Download, X } from "lucide-react";
import { API_URL } from "@/config";
import { Button } from "@/components/ui/button";

interface FileViewerModalProps {
    file: { id: number; nombre: string; tipo_archivo: string } | null;
    isOpen: boolean;
    onClose: () => void;
}

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export const FileViewerModal = ({ file, isOpen, onClose }: FileViewerModalProps) => {
    const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!isOpen || !file) {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                setObjectUrl(null);
            }
            setError(null);
            return;
        }

        const fetchFile = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(`${API_URL}/planos/${file.id}/archivo`, {
                    headers: getAuthHeaders(),
                });

                if (!response.ok) {
                    throw new Error("No se pudo cargar el archivo");
                }

                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                setObjectUrl(url);
            } catch (err) {
                console.error("Error fetching file:", err);
                setError("Ocurrió un error al cargar el archivo. Por favor, reintenta.");
            } finally {
                setLoading(false);
            }
        };

        fetchFile();

        return () => {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [isOpen, file]);

    const isImage = file?.tipo_archivo?.startsWith("image/");
    const isPdf = file?.tipo_archivo === "application/pdf";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl w-[90vw] h-[85vh] p-0 overflow-hidden flex flex-col bg-slate-50/95 backdrop-blur-md border-slate-200 shadow-2xl">
                <DialogHeader className="px-6 py-4 bg-white border-b border-slate-100 flex-shrink-0">
                    <div className="flex items-center justify-between pr-8">
                        <DialogTitle className="text-sm font-bold text-slate-800 truncate pr-4">
                            {file?.nombre}
                        </DialogTitle>
                        {objectUrl && (
                             <Button variant="outline" size="sm" asChild className="h-8 gap-2 border-slate-200">
                                <a href={objectUrl} download={file?.nombre}>
                                    <Download className="w-4 h-4" />
                                    Descargar
                                </a>
                            </Button>
                        )}
                    </div>
                </DialogHeader>

                <div className="flex-grow relative flex items-center justify-center p-4">
                    {loading && (
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                            <p className="text-xs font-medium text-slate-500">Cargando archivo...</p>
                        </div>
                    )}

                    {error && (
                        <div className="text-center p-8 bg-white rounded-xl border border-red-100 shadow-sm">
                            <p className="text-sm text-red-600 font-medium">{error}</p>
                        </div>
                    )}

                    {!loading && !error && objectUrl && (
                        <>
                            {isImage ? (
                                <img
                                    src={objectUrl}
                                    alt={file?.nombre}
                                    className="max-w-full max-h-full object-contain shadow-2xl rounded-sm transition-all animate-in fade-in zoom-in-95 duration-300"
                                />
                            ) : isPdf ? (
                                <iframe
                                    src={objectUrl}
                                    className="w-full h-full rounded-md border border-slate-200 shadow-inner bg-white animate-in fade-in slide-in-from-bottom-2 duration-400"
                                    title={file?.nombre}
                                />
                            ) : (
                                <div className="text-center p-12 bg-white rounded-2xl border border-slate-200 shadow-xl max-w-sm">
                                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                         <Download className="w-8 h-8 text-slate-400" />
                                    </div>
                                    <h3 className="text-slate-800 font-bold mb-2">Vista previa no disponible</h3>
                                    <p className="text-xs text-slate-500 mb-6">Este tipo de archivo no puede visualizarse directamente.</p>
                                    <Button asChild className="w-full">
                                        <a href={objectUrl} download={file?.nombre}>
                                            Descargar Archivo
                                        </a>
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
