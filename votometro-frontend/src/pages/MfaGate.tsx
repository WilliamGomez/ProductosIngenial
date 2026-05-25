import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Copy } from "lucide-react";
import QRCode from "qrcode";

import { Button, Card } from "../components/ui";
import { useAccessToken } from "../hooks/useAccessToken";
import { useSession } from "../context/SessionContext";
import {
  getMfaStatus,
  startMfaSetup,
  verifyMfaChallenge,
  verifyMfaSetup,
  type IMfaSetupStart,
  type IMfaStatus,
} from "../services/api";

const normalizeCode = (value: string) => value.replace(/\D/g, "").slice(0, 6);

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
};

export default function MfaGate() {
  const { getToken } = useAccessToken();
  const { sessionToken, user, completeMfaVerification, logoutAndCleanup } = useSession();

  const [status, setStatus] = useState<IMfaStatus | null>(null);
  const [setup, setSetup] = useState<IMfaSetupStart | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const nextStatus = await getMfaStatus(token, sessionToken);
      setStatus(nextStatus);
      if (nextStatus.mfa_verified && nextStatus.session_status === "Active") {
        await completeMfaVerification();
      }
    } catch (err) {
      console.error("[MfaGate] status failed", err);
      setError("No se pudo validar el estado MFA. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  }, [completeMfaVerification, getToken, sessionToken]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    let cancelled = false;
    if (!setup?.otpauth_uri) {
      setQrDataUrl("");
      return;
    }

    QRCode.toDataURL(setup.otpauth_uri, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch((err) => {
        console.error("[MfaGate] QR generation failed", err);
        if (!cancelled) {
          setQrDataUrl("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setup?.otpauth_uri]);

  const handleStartSetup = async () => {
    setWorking(true);
    setError("");
    try {
      const token = await getToken();
      setSetup(await startMfaSetup(token));
      setQrDataUrl("");
      setCopied(false);
      setCode("");
    } catch (err) {
      console.error("[MfaGate] setup failed", err);
      setError("No se pudo iniciar la configuracion MFA.");
    } finally {
      setWorking(false);
    }
  };

  const handleVerify = async () => {
    if (!sessionToken || code.length !== 6) return;
    setWorking(true);
    setError("");
    try {
      const token = await getToken();
      const nextStatus = status?.mfa_enabled
        ? await verifyMfaChallenge(token, sessionToken, code)
        : await verifyMfaSetup(token, sessionToken, code);
      setStatus(nextStatus);
      await completeMfaVerification();
    } catch (err) {
      console.error("[MfaGate] verify failed", err);
      setError("Codigo invalido o vencido. Revisa tu app autenticadora e intenta de nuevo.");
    } finally {
      setWorking(false);
    }
  };

  const handleCopySecret = async () => {
    if (!setup?.secret) return;
    setError("");
    try {
      await copyText(setup.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error("[MfaGate] copy secret failed", err);
      setError("No se pudo copiar la clave. Seleccionala manualmente.");
    }
  };

  const requiresSetup = status ? !status.mfa_enabled : true;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative hidden overflow-hidden bg-slate-900 lg:flex">
          <div
            aria-hidden
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#0891b2_100%)] opacity-90" />
          <div className="relative z-10 flex h-full w-full flex-col justify-between p-12 text-white">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Ingenial IA" className="h-10 w-10" />
              <div>
                <p className="text-base font-bold leading-none">Ingenial IA</p>
                <p className="mt-1 text-xs text-white/70">Acceso seguro</p>
              </div>
            </div>

            <div className="max-w-md">
              <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h1 className="text-4xl font-bold leading-tight">
                Verificación adicional para proteger la plataforma.
              </h1>
              <p className="mt-5 text-sm leading-6 text-white/75">
                Este paso confirma que solo el propietario de la cuenta puede acceder a los informes,
                usuarios y datos operativos del sistema.
              </p>
            </div>
          </div>
        </aside>

        <main className="flex items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
          <Card className="w-full max-w-xl border border-slate-200 bg-white/95 p-6 shadow-2xl shadow-slate-200/70 backdrop-blur sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
                  Verificación obligatoria
                </p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                  Configure y valide su identidad
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {user?.display_name || user?.email}, para continuar debe validar un código en su aplicación autenticadora (Google Authenticator o Microsoft Authenticator).
                </p>
              </div>
            </div>

            {loading ? (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Validando seguridad...
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                {requiresSetup && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                    MFA es obligatorio para todos los roles. Registra esta cuenta en Microsoft Authenticator,
                    Google Authenticator, 1Password o Bitwarden usando la clave de configuracion.
                  </div>
                )}

                {requiresSetup && !setup && (
                  <Button leftIcon={<KeyRound />} disabled={working} onClick={handleStartSetup}>
                    Generar token
                  </Button>
                )}

                {setup && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                        <div className="flex h-44 w-44 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                          {qrDataUrl ? (
                            <img
                              src={qrDataUrl}
                              alt="Codigo QR para configurar MFA"
                              className="h-full w-full"
                            />
                          ) : (
                            <span className="text-center text-xs text-slate-500">
                              Generando QR...
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">
                            Escanea este codigo con tu app autenticadora
                          </p>
                          <p className="mt-2 text-xs leading-5 text-slate-600">
                            Abre Microsoft Authenticator, Google Authenticator,
                            1Password o Bitwarden, elige agregar cuenta y escanea
                            el QR. Luego escribe el codigo de 6 digitos generado.
                          </p>
                          <p className="mt-2 text-xs leading-5 text-amber-700">
                            Si ya habias intentado configurarlo antes, elimina la entrada anterior de Votometro
                            en tu autenticador y escanea este QR nuevamente.
                          </p>
                        </div>
                      </div>
                    </div>

                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Clave manual de respaldo
                    </label>
                    <div className="flex gap-2">
                      <code className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold tracking-wider text-slate-900 break-all">
                        {setup.secret}
                      </code>
                      <Button
                        variant="secondary"
                        leftIcon={<Copy />}
                        onClick={handleCopySecret}
                      >
                        {copied ? "Copiado" : "Copiar"}
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500">
                      En la app autenticadora elige agregar cuenta manualmente, tipo basada en tiempo, issuer Votometro.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Ingrese el Codigo de 6 digitos
                  </label>
                  <input
                    value={code}
                    onChange={(event) => setCode(normalizeCode(event.target.value))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="h-12 w-full rounded-lg border border-slate-200 px-3 text-center text-lg font-semibold tracking-[0.4em] text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="000000"
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                )}

                <div className="flex flex-wrap justify-between gap-2">
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={working}
                      onClick={() => logoutAndCleanup({ invalidateOnServer: true, triggerMsalLogout: true })}
                    >
                      Cerrar sesión
                    </Button>
                    <Button disabled={working || code.length !== 6} onClick={handleVerify}>
                      {working ? "Validando..." : "Validar Código"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </main>
      </div>
    </div>
  );
}
