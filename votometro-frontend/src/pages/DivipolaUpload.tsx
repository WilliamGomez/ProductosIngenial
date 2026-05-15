import { useEffect, useRef, useState } from "react";
import {
    Upload,
    FileText,
    Database,
    CheckCircle2,
    Loader2,
    Trash2,
    RefreshCw,
} from "lucide-react";
import { useAccessToken } from "../hooks/useAccessToken";
import {
    uploadDivipola,
    getDivipolaStatus,
    type IDivipolaUploadResponse,
} from "../services/api";
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    PageHeader,
    StatCard,
} from "../components/ui";
import { Spinner } from "../components/ui/Spinner";
import Swal from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import { cn } from "../lib/cn";

const SwalMessages = withReactContent(Swal);

/**
 * DivipolaUpload — vista admin para subir el catálogo geográfico DANE.
 *
 * Flujo:
 *   1. Muestra el conteo actual del catálogo (`GET /api/divipola/status`).
 *   2. Drag-and-drop o click sobre el área de upload selecciona un .csv.
 *   3. Click "Subir" → `POST /api/divipola/upload` con multipart/form-data.
 *   4. Toast de éxito con el resumen `{inserted, updated, total}`.
 *   5. Refresca el conteo.
 *
 * Modo `replace`: checkbox opcional. Cuando se activa, el backend hace
 * `TRUNCATE` del catálogo antes del INSERT. Útil cuando se quiere empezar
 * limpio (ej. catálogo corrupto, cambio mayor de divisiones territoriales).
 */
const DivipolaUpload = () => {
    const { getToken } = useAccessToken();

    const [file, setFile] = useState<File | null>(null);
    const [replaceMode, setReplaceMode] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [statusLoading, setStatusLoading] = useState(true);
    const [rowCount, setRowCount] = useState<number | null>(null);
    const [lastResult, setLastResult] =
        useState<IDivipolaUploadResponse | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // ---- carga inicial del status ----------------------------------------
    useEffect(() => {
        void loadStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadStatus = async () => {
        setStatusLoading(true);
        try {
            const token = await getToken();
            const s = await getDivipolaStatus(token);
            setRowCount(s.rows);
        } catch (err) {
            console.error("[DivipolaUpload] status failed:", err);
            setRowCount(null);
        } finally {
            setStatusLoading(false);
        }
    };

    // ---- selección de archivo --------------------------------------------
    const handleSelect = (f: File | null) => {
        if (!f) {
            setFile(null);
            return;
        }
        if (!f.name.toLowerCase().endsWith(".csv")) {
            void SwalMessages.fire({
                title: "Archivo inválido",
                text: "Solo se aceptan archivos con extensión .csv",
                icon: "warning",
                confirmButtonColor: "#1d4ed8",
            });
            return;
        }
        // Tope blando: 50 MiB
        if (f.size > 50 * 1024 * 1024) {
            void SwalMessages.fire({
                title: "Archivo demasiado grande",
                text: "El catálogo DIVIPOLA no debería pesar más de 50 MB.",
                icon: "warning",
                confirmButtonColor: "#1d4ed8",
            });
            return;
        }
        setFile(f);
        setLastResult(null);
    };

    const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0] ?? null;
        handleSelect(f);
    };

    // ---- submit ----------------------------------------------------------
    const handleSubmit = async () => {
        if (!file) return;

        if (replaceMode) {
            const confirm = await SwalMessages.fire({
                title: "¿Reemplazar el catálogo completo?",
                text:
                    "Esto borrará TODAS las filas existentes en `dbo.Divipola` antes de insertar las del CSV. Las asignaciones de usuarios (User_Zones) no se ven afectadas, pero pueden quedar apuntando a códigos inexistentes.",
                icon: "warning",
                showCancelButton: true,
                confirmButtonColor: "#dc2626",
                cancelButtonColor: "#64748b",
                confirmButtonText: "Sí, reemplazar todo",
                cancelButtonText: "Cancelar",
            });
            if (!confirm.isConfirmed) return;
        }

        setUploading(true);
        setLastResult(null);
        try {
            const token = await getToken();
            const result = await uploadDivipola(
                token,
                file,
                replaceMode ? "replace" : undefined
            );
            setLastResult(result);
            await loadStatus();

            await SwalMessages.fire({
                title: "Catálogo actualizado",
                html:
                    `<div class="text-left text-sm">` +
                    `<p><b>Insertados:</b> ${result.inserted}</p>` +
                    `<p><b>Actualizados:</b> ${result.updated}</p>` +
                    `<p><b>Total procesado:</b> ${result.total}</p>` +
                    (result.rows_in_csv !== undefined
                        ? `<p><b>Filas en el CSV:</b> ${result.rows_in_csv}</p>`
                        : "") +
                    `</div>`,
                icon: "success",
                confirmButtonColor: "#1d4ed8",
            });

            setFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        } catch (err: any) {
            const msg =
                err?.response?.data?.error ??
                err?.message ??
                "No se pudo subir el catálogo.";
            await SwalMessages.fire({
                title: "Error al subir",
                text: String(msg),
                icon: "error",
                confirmButtonColor: "#1d4ed8",
            });
        } finally {
            setUploading(false);
        }
    };

    const fmtBytes = (b: number) => {
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
        return `${(b / 1024 / 1024).toFixed(2)} MB`;
    };

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Administración"
                title="Catálogo DIVIPOLA"
                description="Sube el catálogo geográfico oficial del DANE para poblar departamentos y municipios."
                actions={
                    <Button
                        variant="secondary"
                        leftIcon={<RefreshCw />}
                        onClick={loadStatus}
                        disabled={statusLoading}
                    >
                        Refrescar
                    </Button>
                }
            />

            {/* Estado actual del catálogo */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                    icon={<Database />}
                    label="Filas en el catálogo"
                    value={
                        statusLoading
                            ? "…"
                            : rowCount === null
                            ? "—"
                            : rowCount.toLocaleString("es-CO")
                    }
                    tone="brand"
                />
                <StatCard
                    icon={<FileText />}
                    label="Última subida (insertados)"
                    value={lastResult ? lastResult.inserted : "—"}
                    tone="success"
                />
                <StatCard
                    icon={<RefreshCw />}
                    label="Última subida (actualizados)"
                    value={lastResult ? lastResult.updated : "—"}
                    tone="info"
                />
            </div>

            {/* Zona de upload */}
            <Card>
                <CardHeader>
                    <CardTitle>Subir archivo CSV</CardTitle>
                    <p className="text-sm text-slate-500 mt-0.5">
                        El archivo debe seguir el formato del DANE
                        (cod_eleccion, dep, nom_dep, mun, nom_mun, ...). Con o
                        sin línea de encabezados — el backend detecta ambos
                        casos.
                    </p>
                </CardHeader>
                <CardBody className="space-y-5">
                    {/* Drop zone */}
                    <div
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                            "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
                            dragOver
                                ? "border-brand-500 bg-brand-50"
                                : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
                        )}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            onChange={(e) =>
                                handleSelect(e.target.files?.[0] ?? null)
                            }
                        />
                        <Upload className="h-12 w-12 mx-auto text-slate-400" />
                        <p className="mt-3 text-sm font-medium text-slate-700">
                            {file
                                ? "Cambiar archivo"
                                : "Arrastra el CSV aquí o haz clic para seleccionar"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                            Solo .csv · máx. 50 MB
                        </p>
                    </div>

                    {/* Archivo seleccionado */}
                    {file && (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                                <FileText className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">
                                    {file.name}
                                </p>
                                <p className="text-xs text-slate-500">
                                    {fmtBytes(file.size)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setFile(null);
                                    if (fileInputRef.current)
                                        fileInputRef.current.value = "";
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                aria-label="Quitar archivo"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    )}

                    {/* Modo replace */}
                    <label className="flex items-start gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={replaceMode}
                            onChange={(e) =>
                                setReplaceMode(e.target.checked)
                            }
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500/20"
                        />
                        <div>
                            <p className="text-sm font-medium text-slate-900">
                                Modo reemplazar (destructivo)
                            </p>
                            <p className="text-xs text-slate-500">
                                Trunca el catálogo antes de insertar. Útil para
                                catálogos corruptos. Sin esto se hace MERGE
                                (UPSERT) preservando filas existentes.
                            </p>
                        </div>
                    </label>

                    {/* Botón submit */}
                    <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                        <Button
                            onClick={handleSubmit}
                            disabled={!file || uploading}
                            leftIcon={
                                uploading ? (
                                    <Loader2 className="animate-spin" />
                                ) : (
                                    <Upload />
                                )
                            }
                        >
                            {uploading
                                ? "Subiendo y procesando…"
                                : replaceMode
                                ? "Reemplazar catálogo"
                                : "Subir y hacer UPSERT"}
                        </Button>
                    </div>

                    {/* Feedback inline del último resultado */}
                    {lastResult && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">
                            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <div>
                                <p className="font-medium">
                                    Última operación exitosa
                                </p>
                                <p className="text-xs mt-0.5">
                                    {lastResult.inserted} insertados ·{" "}
                                    {lastResult.updated} actualizados · total{" "}
                                    {lastResult.total}
                                    {lastResult.rows_in_csv !== undefined
                                        ? ` · ${lastResult.rows_in_csv} filas leídas del CSV`
                                        : ""}
                                </p>
                            </div>
                        </div>
                    )}
                </CardBody>
            </Card>

            {statusLoading && rowCount === null && (
                <div className="flex justify-center py-10">
                    <Spinner />
                </div>
            )}
        </div>
    );
};

export default DivipolaUpload;
