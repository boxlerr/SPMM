"use client";

import React from "react";
import { Eye, Download, FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import { API_URL } from "@/config";

// Component to fetch and display files for an order
export const OrderFiles = ({ orderId }: { orderId: number }) => {
    const [files, setFiles] = React.useState<any[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const fetchFiles = async () => {
            if (!orderId) return;
            try {
                // Add timestamp to prevent caching issues
                const res = await fetch(`${API_URL}/planos/orden/${orderId}?t=${Date.now()}`);
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
        };
        fetchFiles();
    }, [orderId]);

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

    if (files.length === 0) {
        return (
            <div className="mt-4 px-4 py-3 bg-gray-50/50 rounded-lg border border-dashed border-gray-200">
                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-help select-none" title="No hay archivos adjuntos">
                    <Paperclip className="w-3.5 h-3.5" />
                    Sin archivos adjuntos
                </h4>
            </div>
        );
    }

    return (
        <div className="mt-4 px-4 py-3 bg-blue-50/30 rounded-lg border border-blue-100/50 mb-4">
            <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-white shadow-sm border border-blue-100 text-blue-600">
                    <Paperclip className="w-3 h-3" />
                </div>
                Archivos Adjuntos <span className="text-gray-400 font-normal ml-0.5">({files.length})</span>
            </h4>
            <div className="flex flex-wrap gap-3">
                {files.map((file) => (
                    <div key={file.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 bg-white hover:border-blue-400 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group shadow-sm max-w-sm min-w-[200px] cursor-default">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors shadow-inner ${file.tipo_archivo?.startsWith('image')
                            ? 'bg-gradient-to-br from-blue-50 to-blue-100 text-blue-600 group-hover:from-blue-100 group-hover:to-blue-200'
                            : 'bg-gradient-to-br from-orange-50 to-orange-100 text-orange-600 group-hover:from-orange-100 group-hover:to-orange-200'
                            }`}>
                            {file.tipo_archivo?.startsWith('image') ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                        </div>
                        <div className="flex flex-col min-w-0 mr-2 flex-grow">
                            <span className="text-xs font-bold text-gray-700 truncate block" title={file.nombre}>{file.nombre}</span>
                            <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1 mt-0.5">
                                {new Date(file.fecha_subida).toLocaleDateString()}
                            </span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 scale-95 group-hover:scale-100 bg-gray-50 rounded-lg p-1 border border-gray-100">
                            <a
                                href={`${API_URL}/planos/${file.id}/archivo`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-gray-400 hover:text-blue-600 transition-all"
                                title="Ver archivo"
                            >
                                <Eye className="w-4 h-4" />
                            </a>
                            <a
                                href={`${API_URL}/planos/${file.id}/archivo?download=true`}
                                download={file.nombre}
                                className="p-1.5 hover:bg-white hover:shadow-sm rounded-md text-gray-400 hover:text-green-600 transition-all"
                                title="Descargar"
                            >
                                <Download className="w-4 h-4" />
                            </a>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
