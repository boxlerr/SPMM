import React from "react";
import { Eye, Download, FileText, Image as ImageIcon, Paperclip, Trash2, UploadCloud, Plus, Loader2 } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// Component to fetch and display files for an order
export const OrderFiles = ({ orderId }: { orderId: number }) => {
    const [files, setFiles] = React.useState<any[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [isUploading, setIsUploading] = React.useState(false);
    const [fileToDelete, setFileToDelete] = React.useState<{ id: number, name: string } | null>(null);

    const fetchFiles = React.useCallback(async () => {
        if (!orderId) return;
        try {
            // Add timestamp to prevent caching issues
            const res = await fetch(`${API_URL}/planos/orden/${orderId}?t=${Date.now()}`, { headers: getAuthHeaders() });
            if (res.ok) {
                const json = await res.json();
                setFiles(json.data || []);
            } else {
                console.error("Failed to fetch files");
            }
        } catch (err) {
            console.error("Error loading files", err);
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    React.useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        setIsUploading(true);
        const selectedFiles = Array.from(e.target.files);

        try {
            let successCount = 0;
            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append('nombre', file.name);
                formData.append('tipo_archivo', file.type);
                formData.append('id_orden_trabajo', orderId.toString());
                formData.append('archivo', file);

                const res = await fetch(`${API_URL}/planos`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: formData
                });

                if (res.ok) successCount++;
            }

            if (successCount > 0) {
                toast.success(`${successCount} archivo(s) subido(s) correctamente`);
                await fetchFiles();
            } else {
                toast.error("Error al subir archivos");
            }
        } catch (error) {
            console.error("Upload error:", error);
            toast.error("Error al subir archivos");
        } finally {
            setIsUploading(false);
            // Reset input
            e.target.value = '';
        }
    };

    const handleDeleteFile = (fileId: number, fileName: string) => {
        setFileToDelete({ id: fileId, name: fileName });
    };

    const confirmDelete = async () => {
        if (!fileToDelete) return;

        try {
            const res = await fetch(`${API_URL}/planos/${fileToDelete.id}`, {
                method: "DELETE",
                headers: getAuthHeaders()
            });

            if (res.ok) {
                toast.success("Archivo eliminado");
                setFiles(prev => prev.filter(f => f.id !== fileToDelete.id));
            } else {
                throw new Error("Failed to delete");
            }
        } catch (error) {
            console.error("Delete error:", error);
            toast.error("Error al eliminar archivo");
        } finally {
            setFileToDelete(null);
        }
    };

    if (loading) {
        return (
            <div className="mt-3 px-1 animate-pulse">
                <div className="h-3 w-24 bg-gray-200 rounded mb-2"></div>
                <div className="flex gap-2">
                    <div className="h-10 w-40 bg-gray-50 rounded border border-gray-100"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="mt-4 px-4 py-3 bg-blue-50/30 rounded-lg border border-blue-100/50 mb-4">
            <ConfirmationDialog
                isOpen={!!fileToDelete}
                onClose={() => setFileToDelete(null)}
                onConfirm={confirmDelete}
                title="Eliminar Archivo"
                description={`¿Estás seguro de eliminar el archivo "${fileToDelete?.name}"? Esta acción no se puede deshacer.`}
                confirmText="Eliminar"
                cancelText="Cancelar"
                variant="destructive"
            />

            <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                    <div className="flex items-center justify-center w-5 h-5 rounded-full bg-white shadow-sm border border-blue-100 text-blue-600">
                        <Paperclip className="w-3 h-3" />
                    </div>
                    Archivos Adjuntos <span className="text-gray-400 font-normal ml-0.5">({files.length})</span>
                </h4>

                {/* Upload Button/Input */}
                <div className="relative">
                    <input
                        type="file"
                        multiple
                        accept="image/*,.pdf"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={handleFileUpload}
                        disabled={isUploading}
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs bg-white hover:bg-blue-50 border-blue-200 text-blue-700 px-2 gap-1"
                        disabled={isUploading}
                    >
                        {isUploading ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <Plus className="w-3 h-3" />
                        )}
                        {isUploading ? "Subiendo..." : "Adjuntar"}
                    </Button>
                </div>
            </div>

            {files.length === 0 ? (
                <div className="text-center py-4 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50/50 relative hover:border-blue-300 hover:bg-blue-50/30 transition-all group">
                    <input
                        type="file"
                        multiple
                        accept="image/*,.pdf"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={handleFileUpload}
                        disabled={isUploading}
                    />
                    <div className="flex flex-col items-center gap-1 pointer-events-none">
                        <div className="p-1.5 bg-gray-100 rounded-full text-gray-400 group-hover:text-blue-500 group-hover:bg-blue-100 transition-colors">
                            <UploadCloud className="w-4 h-4" />
                        </div>
                        <span className="text-xs text-gray-500 font-medium group-hover:text-blue-600 transition-colors">
                            Arrastra o haz clic para subir
                        </span>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap gap-3">
                    {files.map((file) => (
                        <div key={file.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 bg-white hover:border-blue-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group shadow-sm max-w-sm min-w-[200px] cursor-default relative pr-8">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors shadow-inner ${file.tipo_archivo?.startsWith('image')
                                ? 'bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600 group-hover:from-blue-100 group-hover:to-blue-200'
                                : 'bg-gradient-to-br from-orange-50 to-orange-100 text-orange-600 group-hover:from-orange-100 group-hover:to-orange-200'
                                }`}>
                                {file.tipo_archivo?.startsWith('image') ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                            </div>
                            <div className="flex flex-col min-w-0 mr-2 flex-grow">
                                <span className="text-xs font-bold text-gray-700 truncate block max-w-[120px]" title={file.nombre}>{file.nombre}</span>
                                <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1 mt-0.5">
                                    {new Date(file.fecha_subida).toLocaleDateString()}
                                </span>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 absolute right-2 top-1/2 -translate-y-1/2">
                                {/* Delete Button (Visible on Hover) */}
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        handleDeleteFile(file.id, file.nombre);
                                    }}
                                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                                    title="Eliminar archivo"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>

                                {/* View/Download Buttons */}
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all bg-gray-50 rounded-lg p-0.5 border border-gray-100 shadow-sm absolute -right-2 -top-8 z-10 pointer-events-none group-hover:pointer-events-auto">
                                    <a
                                        href={`${API_URL}/planos/${file.id}/archivo`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 hover:bg-white hover:rounded-md text-gray-500 hover:text-blue-600 transition-all"
                                        title="Ver archivo"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                    </a>
                                    <a
                                        href={`${API_URL}/planos/${file.id}/archivo?download=true`}
                                        download={file.nombre}
                                        className="p-1.5 hover:bg-white hover:rounded-md text-gray-500 hover:text-green-600 transition-all"
                                        title="Descargar"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                    </a>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Tiny Add Button at end of list */}
                    <div className="w-10 h-10 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 hover:text-blue-500 hover:border-blue-400 hover:bg-blue-50 transition-all cursor-pointer relative group" title="Agregar más archivos">
                        <input
                            type="file"
                            multiple
                            accept="image/*,.pdf"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            onChange={handleFileUpload}
                            disabled={isUploading}
                        />
                        <Plus className="w-5 h-5" />
                    </div>
                </div>
            )}
        </div>
    );
};
