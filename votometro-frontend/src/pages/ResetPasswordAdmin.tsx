import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    ArrowLeft,
    ShieldCheck,
    AlertCircle,
    CheckCircle2,
} from "lucide-react";
import { useAccessToken } from "../hooks/useAccessToken";
import { resetUserPassword } from "../services/api";
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
} from "../components/ui";
import { cn } from "../lib/cn";

/**
 * ResetPasswordAdmin — restablecimiento manual de contraseña por un Admin.
 * Solo se renderiza dentro del bloque admin del AppRouter; el backend revalida
 * el JWT y la política de complejidad antes de aplicar el cambio en Azure AD.
 */

const POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

const ResetPasswordAdmin = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { getToken } = useAccessToken();
    const [pwd, setPwd] = useState("");
    const [confirm, setConfirm] = useState("");
    const [forceChange, setForceChange] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const policyOk = POLICY.test(pwd);
    const matchOk = pwd.length > 0 && pwd === confirm;
    const canSubmit = policyOk && matchOk && !loading && !!id;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setLoading(true);
        setError(null);
        try {
            const token = await getToken();
            await resetUserPassword(token, id!, pwd, forceChange);
            setSuccess(true);
            setTimeout(() => navigate(`/users/${id}`), 1500);
        } catch (err: any) {
            setError(
                err?.response?.data?.error ??
                    "No se pudo restablecer la contraseña."
            );
        } finally {
            setLoading(false);
        }
    };

    const inputCls = cn(
        "w-full px-3 py-2 rounded-lg text-sm bg-white border border-slate-200 text-slate-900",
        "focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
    );

    return (
        <div className="space-y-5 max-w-2xl">
            <button
                type="button"
                onClick={() => navigate(`/users/${id}`)}
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-brand-600 transition-colors"
            >
                <ArrowLeft className="h-4 w-4" /> Volver al detalle
            </button>

            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                            <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle>Restablecer contraseña</CardTitle>
                            <p className="text-sm text-slate-500 mt-0.5">
                                El cambio se sincroniza con Azure AD
                                inmediatamente.
                            </p>
                        </div>
                    </div>
                </CardHeader>

                <CardBody className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Nueva contraseña
                        </label>
                        <input
                            type="password"
                            autoComplete="new-password"
                            className={inputCls}
                            value={pwd}
                            onChange={(e) => setPwd(e.target.value)}
                        />
                        <p
                            className={cn(
                                "mt-1 text-[11px]",
                                policyOk
                                    ? "text-emerald-600"
                                    : "text-slate-400"
                            )}
                        >
                            12+ caracteres con mayúscula, minúscula, dígito y
                            símbolo.
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                            Confirmar contraseña
                        </label>
                        <input
                            type="password"
                            autoComplete="new-password"
                            className={inputCls}
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                        />
                        {confirm.length > 0 && !matchOk && (
                            <p className="mt-1 text-[11px] text-rose-600">
                                Las contraseñas no coinciden.
                            </p>
                        )}
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                            type="checkbox"
                            checked={forceChange}
                            onChange={(e) =>
                                setForceChange(e.target.checked)
                            }
                        />
                        Obligar al usuario a cambiarla en el próximo inicio de
                        sesión
                    </label>

                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm">
                            <AlertCircle className="h-4 w-4 mt-0.5" /> {error}
                        </div>
                    )}
                    {success && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">
                            <CheckCircle2 className="h-4 w-4 mt-0.5" />{" "}
                            Contraseña restablecida.
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-2">
                        <Button
                            variant="secondary"
                            onClick={() => navigate(`/users/${id}`)}
                            disabled={loading}
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={!canSubmit}
                        >
                            {loading ? "Aplicando…" : "Restablecer"}
                        </Button>
                    </div>
                </CardBody>
            </Card>
        </div>
    );
};

export default ResetPasswordAdmin;
