import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    ArrowLeft,
    Save,
    AlertCircle,
    CheckCircle2,
    XCircle,
    Loader2,
} from "lucide-react";
import { useAccessToken } from "../hooks/useAccessToken";
import {
    getUser,
    getDepartments,
    getMunicipalities,
    updateUserInfo,
    updateUserproducts,
    createUser,
} from "../services/api";
import type { IUser } from "../interfaces/IUser";
import type {
    IProductsFormData,
    IUserInfoFormData,
} from "../interfaces/IRegisterUserFormData";
import type { IDepartment } from "../interfaces/IDepartments";
import type { IMunicipio } from "../interfaces/IMunicipio";
import type { IUserZone } from "../services/api";
import ProductsSelector from "../components/ProductsSelector";
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    EmptyState,
} from "../components/ui";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../lib/cn";
import { isProductActive, isProductExpired } from "../utils/productStatus";

const initialFormData: IUserInfoFormData = {
    display_name: "",
    phone: "",
    email: "",
    personal_email: "",
    reference: "",
    reference2: "",
    identity_document: "",
    type_person: "",
    type_dni: "",
    role: "",
    enable: true,
};

const inputClasses = cn(
    "w-full px-3 py-2 rounded-lg text-sm bg-white",
    "border border-slate-200 text-slate-900 placeholder:text-slate-400",
    "focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20",
    "disabled:bg-slate-50 disabled:text-slate-500 transition-colors"
);

const inputErrorClasses = cn(
    "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
);

const labelClasses = "block text-xs font-semibold text-slate-700 mb-1.5";

const padDep = (value: string | number) => String(value).padStart(2, "0");
const toUiZoneCode = (codDep: string | number, codMun: string | number | null) => {
    if (codMun == null) return null;
    const raw = String(codMun).trim();
    return raw.length <= 3 ? `${padDep(codDep)}${raw.padStart(3, "0")}` : raw.padStart(5, "0");
};
const toBackendZones = (zones: IUserZone[]): IUserZone[] =>
    zones.map((zone) => ({
        cod_dep: padDep(zone.cod_dep),
        cod_mun: zone.cod_mun == null ? null : String(zone.cod_mun).slice(-3).padStart(3, "0"),
    }));
const fromBackendZones = (zones?: IUserZone[]): IUserZone[] =>
    (zones ?? []).map((zone) => ({
        ...zone,
        cod_dep: padDep(zone.cod_dep),
        cod_mun: toUiZoneCode(zone.cod_dep, zone.cod_mun),
    }));

const UserEdit = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { getToken } = useAccessToken();

    const isCreateMode = !id || id === "new";

    // Página state
    const [pageLoading, setPageLoading] = useState(!isCreateMode);
    const [pageError, setPageError] = useState<string | null>(null);
    const [selectedUser, setSelectedUser] = useState<IUser | null>(null);

    // Form state: Solo "personal" y "products"
    const [activeTab, setActiveTab] = useState<"personal" | "products">("personal");
    
    const [errors, setErrors] = useState<Partial<IUserInfoFormData> & { password?: string; confirmPassword?: string; }>({});
    const [productsErrors, setProductsErrors] = useState<{ [key: string]: string; }>({});
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [failed, setFailed] = useState(false);
    const [formData, setFormData] = useState<IUserInfoFormData>(initialFormData);

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    // Catálogos geo
    const [departamentos, setDepartamentos] = useState<IDepartment[]>([]);
    const [municipios, setMunicipios] = useState<IMunicipio[]>([]);

    // Estados simplificados para usar con el nuevo ZonesSelector
    const [votometroZones, setVotometroZones] = useState<IUserZone[]>([]);
    const [audivotoZones, setAudivotoZones] = useState<IUserZone[]>([]);
    const [votometroEnabled, setVotometroEnabled] = useState<boolean>(false);
    const [audivotoEnabled, setAudivotoEnabled] = useState<boolean>(false);

    const [productsFormData, setProductsFormData] = useState<IProductsFormData>({
        tiempoContratacionVotometro: "",
        tiempoContratacionAudivoto: "",
        initialProducts: [],
        newProducts: [],
    });

    useEffect(() => {
        if (!isCreateMode) loadUser();
        loadCatalogs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const loadUser = async () => {
        if (!id) {
            setPageError("ID de usuario inválido");
            setPageLoading(false);
            return;
        }
        setPageLoading(true);
        setPageError(null);
        try {
            const token = await getToken();
            const data = await getUser(token, id);
            setSelectedUser(data);
        } catch (err) {
            console.error("Error al cargar usuario:", err);
            setPageError("No se pudo cargar el usuario. Es posible que no exista o no tengas permisos.");
        } finally {
            setPageLoading(false);
        }
    };

    const loadCatalogs = async () => {
        try {
            const token = await getToken();
            const [d, m] = await Promise.all([
                getDepartments(token),
                getMunicipalities(token),
            ]);
            setDepartamentos(d ?? []);
            setMunicipios(m ?? []);
        } catch (err) {
            console.error("Error al cargar catálogos:", err);
        }
    };

    const hydrateFromUser = (u: IUser) => {
        setFormData({
            display_name: u.display_name || "",
            email: u.email || "",
            personal_email: u.personal_email || "",
            phone: u.phone || "",
            reference: u.reference || "",
            reference2: u.reference2 || "",
            identity_document: u.identity_document || "0",
            type_person: u.type_person || "",
            type_dni: u.type_dni || "",
            role: u.role || "",
            enable: u.enable || false,
        });

        const products = (u.products ?? []).map((product) => ({
            ...product,
            enable: isProductActive(product),
        }));
        const votometro = products.find((p) => p.name === "Votometro");
        const audivoto = products.find((p) => p.name === "Audivoto");
        const activeVotometro = votometro && isProductActive(votometro) ? votometro : undefined;
        const activeAudivoto = audivoto && isProductActive(audivoto) ? audivoto : undefined;

        setVotometroEnabled(!!activeVotometro);
        setAudivotoEnabled(!!activeAudivoto);

        setProductsFormData({
            tiempoContratacionVotometro: activeVotometro && activeVotometro.contract_duration != null
                ? String(activeVotometro.contract_duration) + " " + (activeVotometro.duration_unit === "months" ? "meses" : activeVotometro.duration_unit === "years" ? "años" : "días")
                : "",
            tiempoContratacionAudivoto: activeAudivoto && activeAudivoto.contract_duration != null
                ? String(activeAudivoto.contract_duration) + " " + (activeAudivoto.duration_unit === "months" ? "meses" : activeAudivoto.duration_unit === "years" ? "años" : "días")
                : "",
            initialProducts: products,
            newProducts: products,
        });

        // Parseador maestro para hidratar Zonas desde el formato anterior si es necesario
        const parseZones = (stateStr?: string, cityStr?: string): IUserZone[] => {
            if (!stateStr) return [];
            const states = stateStr.split(",").map(s => s.trim().toUpperCase());
            const cities = cityStr ? cityStr.split(",").map(c => c.trim().toUpperCase()) : [];
            const zones: IUserZone[] = [];

            states.forEach(stateName => {
                const dep = departamentos.find(d => d.name.toUpperCase() === stateName);
                if (!dep) return;
                const depCodeStr = String(dep.code).padStart(2, '0');
                
                const munsInDep = municipios.filter(m => m.dpto === dep.code);
                const assignedMuns = munsInDep.filter(m => cities.includes(m.name.toUpperCase()));

                if (assignedMuns.length === 0 || assignedMuns.length === munsInDep.length) {
                    zones.push({ cod_dep: depCodeStr, cod_mun: null });
                } else {
                    assignedMuns.forEach(m => {
                        zones.push({ cod_dep: depCodeStr, cod_mun: toUiZoneCode(depCodeStr, m.code) });
                    });
                }
            });
            return zones;
        };

        const catalogsReady = departamentos.length > 0 && municipios.length > 0;
        const hydrateProductZones = (product?: typeof products[number]) => {
            if (!product) return [];
            if (Array.isArray(product.zones) && product.zones.length > 0) {
                return fromBackendZones(product.zones);
            }
            return catalogsReady ? parseZones(product.state, product.city) : [];
        };

        setVotometroZones(hydrateProductZones(activeVotometro));
        setAudivotoZones(hydrateProductZones(activeAudivoto));
    };

    useEffect(() => {
        if (selectedUser) {
            hydrateFromUser(selectedUser);
        }
    }, [departamentos, municipios, selectedUser]);

    const validateForm = () => {
        const next: Partial<IUserInfoFormData> & { password?: string; confirmPassword?: string; } = {};

        if (!formData.display_name.trim()) next.display_name = "El nombre completo es requerido.";
        if (!formData.email.trim()) {
            next.email = "El email es requerido.";
        } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
            next.email = "El email no es válido.";
        }
        if (!formData.phone.trim()) {
            next.phone = "El teléfono es requerido.";
        } else if (!/^\+?\d{7,15}$/.test(formData.phone)) {
            next.phone = "Formato de teléfono inválido.";
        }
        if (!formData.identity_document.trim()) {
            next.identity_document = "El número de documento es requerido.";
        } else if (Number(formData.identity_document) < 10000000) {
            next.identity_document = "El número debe ser mayor a 10 millones";
        } else {
            const numeroStr = formData.identity_document.toString();
            if (formData.type_person === "Persona Natural") {
                if (numeroStr.length < 6 || numeroStr.length > 10) next.identity_document = "La cédula debe tener entre 6 y 10 dígitos.";
            } else if (formData.type_person === "Persona Jurídica") {
                if (numeroStr.length < 9 || numeroStr.length > 10) next.identity_document = "El NIT debe tener entre 9 y 10 dígitos.";
            } else {
                if (numeroStr.length < 5 || numeroStr.length > 10) next.identity_document = "Formato de número de documento inválido.";
            }
        }

        if (!formData.reference.trim()) next.reference = "La referencia es requerida.";
        if (!formData.type_person.trim()) next.type_person = "Debe seleccionar un tipo de persona.";
        if (!formData.role.trim()) next.role = "Debe seleccionar un tipo de usuario.";
        if (!formData.type_dni.trim()) next.type_dni = "Debe seleccionar un tipo de DNI.";

        if (isCreateMode) {
            if (!password.trim()) {
                next.password = "La contraseña es requerida.";
            } else if (password.length < 8) {
                next.password = "La contraseña debe tener al menos 8 caracteres.";
            }
            if (password !== confirmPassword) {
                next.confirmPassword = "Las contraseñas no coinciden.";
            }
        }
        return next;
    };

    const validateProducts = (): boolean => {
        const e: { [key: string]: string } = {};
        const hasAtLeastOne = votometroEnabled || audivotoEnabled;
        
        if (!hasAtLeastOne) {
            setProductsErrors({ general: "Debe habilitar al menos un producto: Votómetro o Audivoto." });
            return false;
        }

        if (votometroEnabled) {
            if (!productsFormData.tiempoContratacionVotometro) e.tiempoContratacionVotometro = "El tiempo de contratación es requerido.";
            if (votometroZones.length === 0) e.zonasVotometro = "Debe asignar al menos una zona geográfica.";
        }

        if (audivotoEnabled) {
            if (!productsFormData.tiempoContratacionAudivoto) e.tiempoContratacionAudivoto = "El tiempo de contratación es requerido.";
            if (audivotoZones.length === 0) e.zonasAudivoto = "Debe asignar al menos una zona geográfica.";
        }

        setProductsErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        let value = e.target.value;
        if (e.target.name === "phone") value = value.replace(/[^0-9]/g, "");
        if (e.target.name === "enable") {
            setFormData({ ...formData, enable: value === "1" });
        } else {
            setFormData({ ...formData, [e.target.name]: value });
        }
    };

    const handleSubmitPersonal = async () => {
        const currentErrors = validateForm();
        if (Object.keys(currentErrors).length > 0) {
            setErrors(currentErrors);
            return;
        }
        setErrors({});
        setLoading(true);

        try {
            const token = await getToken();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Tiempo de espera agotado")), 30000)
            );

            if (isCreateMode) {
                const body = {
                    display_name: formData.display_name,
                    phone: formData.phone,
                    email: formData.email,
                    personal_email: formData.personal_email,
                    reference: formData.reference,
                    reference2: formData.reference2,
                    identity_document: formData.identity_document,
                    type_person: formData.type_person,
                    type_dni: formData.type_dni,
                    role: formData.role,
                    enable: formData.enable,
                    password,
                    products: [],
                };
                await Promise.race([createUser(token, body), timeoutPromise]);
                setSuccess(true);
                setTimeout(() => {
                    setSuccess(false);
                    navigate("/users");
                }, 1400);
            } else {
                if (!selectedUser) return;
                const body = {
                    display_name: formData.display_name,
                    phone: formData.phone,
                    email: formData.email,
                    personal_email: formData.personal_email,
                    reference: formData.reference,
                    reference2: formData.reference2,
                    identity_document: formData.identity_document,
                    type_person: formData.type_person,
                    type_dni: formData.type_dni,
                    role: formData.role,
                    enable: formData.enable,
                };
                await Promise.race([
                    updateUserInfo(token, selectedUser.id, body),
                    timeoutPromise,
                ]);
                setSuccess(true);
                setTimeout(() => {
                    setSuccess(false);
                    navigate(`/users/${selectedUser.id}`);
                }, 1400);
            }
        } catch (err) {
            console.error("Error al guardar usuario:", err);
            setFailed(true);
            setTimeout(() => setFailed(false), 3000);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitProducts = async () => {
        if (!selectedUser) return;
        if (!validateProducts()) return;
        setLoading(true);

        const updatedProducts: any[] = [];
        const existingProducts = selectedUser.products ?? [];

        if (votometroEnabled && votometroZones.length > 0) {
            const unit = productsFormData.tiempoContratacionVotometro.split(" ")[1];
            const existingVotometro = existingProducts.find((p) => p.name === "Votometro" && !isProductExpired(p));
            
            updatedProducts.push({
                name: "Votometro",
                id: existingVotometro?.id || null,
                contract_duration: parseInt(productsFormData.tiempoContratacionVotometro.split(" ")[0]),
                duration_unit: unit?.includes("mes") ? "months" : unit?.includes("año") ? "years" : "days",
                amount_cop: 150000.0,
                enable: true,
                zones: toBackendZones(votometroZones)
            });
        }

        if (audivotoEnabled && audivotoZones.length > 0) {
            const unit = productsFormData.tiempoContratacionAudivoto.split(" ")[1];
            const existingAudivoto = existingProducts.find((p) => p.name === "Audivoto" && !isProductExpired(p));
            
            updatedProducts.push({
                name: "Audivoto",
                id: existingAudivoto?.id || null,
                contract_duration: parseInt(productsFormData.tiempoContratacionAudivoto.split(" ")[0]),
                duration_unit: unit?.includes("mes") ? "months" : unit?.includes("año") ? "years" : "days",
                amount_cop: 150000.0,
                enable: true,
                zones: toBackendZones(audivotoZones)
            });
        }

        try {
            const token = await getToken();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Tiempo de espera agotado")), 30000)
            );
            await Promise.race([
                updateUserproducts(token, selectedUser.id, updatedProducts),
                timeoutPromise,
            ]);
            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                navigate(`/users/${selectedUser.id}`);
            }, 1400);
        } catch (err) {
            console.error("Error al actualizar productos:", err);
            setFailed(true);
            setTimeout(() => setFailed(false), 3000);
        } finally {
            setLoading(false);
        }
    };

    if (pageLoading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner />
            </div>
        );
    }

    if (!isCreateMode && (pageError || !selectedUser)) {
        return (
            <Card>
                <EmptyState
                    icon={<AlertCircle />}
                    title="Usuario no encontrado"
                    description={pageError ?? "No pudimos encontrar este usuario."}
                    action={
                        <Button
                            variant="secondary"
                            leftIcon={<ArrowLeft />}
                            onClick={() => navigate("/users")}
                        >
                            Volver a usuarios
                        </Button>
                    }
                />
            </Card>
        );
    }

    const cancelTarget = isCreateMode ? "/users" : `/users/${selectedUser?.id ?? ""}`;
    const onSubmit = activeTab === "personal" ? handleSubmitPersonal : handleSubmitProducts;
    const editingLabel = selectedUser?.display_name?.trim() || (selectedUser?.email ? selectedUser.email.split("@")[0] : "—");

    return (
        <div className="space-y-5 pb-24">
            {loading && (
                <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-slate-900/30 backdrop-blur-sm">
                    <Loader2 className="h-10 w-10 text-brand-200 animate-spin" />
                    <p className="mt-3 text-sm font-semibold text-white">
                        {isCreateMode ? "Creando…" : "Guardando…"}
                    </p>
                </div>
            )}
            {success && (
                <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-white/85 backdrop-blur-sm">
                    <CheckCircle2 className="h-14 w-14 text-emerald-500" />
                    <p className="mt-3 text-base font-semibold text-emerald-600">
                        {isCreateMode
                            ? "¡Usuario creado con éxito!"
                            : "¡Usuario actualizado con éxito!"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                        {isCreateMode
                            ? "Volviendo al listado…"
                            : "Volviendo al detalle del usuario…"}
                    </p>
                </div>
            )}
            {failed && (
                <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-white/85 backdrop-blur-sm">
                    <XCircle className="h-14 w-14 text-rose-500" />
                    <p className="mt-3 text-base font-semibold text-rose-600">
                        {isCreateMode
                            ? "No se pudo crear el usuario"
                            : "No se pudo actualizar la información"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                        Verifica los datos o intenta nuevamente.
                    </p>
                </div>
            )}

            <div className="flex items-center justify-between gap-4">
                <button
                    type="button"
                    onClick={() => navigate(cancelTarget)}
                    className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-brand-600 transition-colors"
                >
                    <ArrowLeft className="h-4 w-4" />
                    {isCreateMode ? "Volver al listado" : "Volver al detalle"}
                </button>
                <span className="text-xs text-slate-400 truncate max-w-[50%]">
                    {isCreateMode ? "Nuevo registro" : `Editando · ${editingLabel}`}
                </span>
            </div>

            <Card>
                <CardHeader>
                    <div>
                        <CardTitle>
                            {isCreateMode ? "Crear usuario" : "Editar usuario"}
                        </CardTitle>
                        <p className="text-sm text-slate-500 mt-0.5">
                            {isCreateMode
                                ? "Registra los datos del nuevo usuario. Los productos se asignan después desde la edición."
                                : "Modifica la información personal o los productos asignados."}
                        </p>
                    </div>
                </CardHeader>

                <div className="px-6 border-b border-slate-100 flex gap-1">
                    <TabButton
                        active={activeTab === "personal"}
                        onClick={() => setActiveTab("personal")}
                    >
                        Información personal
                    </TabButton>
                    {!isCreateMode && (
                        <TabButton
                            active={activeTab === "products"}
                            onClick={() => setActiveTab("products")}
                        >
                            Productos y Zonas
                        </TabButton>
                    )}
                </div>

                <CardBody>
                    {activeTab === "personal" ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
                            <div className="md:col-span-2">
                                <label className={labelClasses}>
                                    Email institucional
                                </label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    disabled={!isCreateMode}
                                    placeholder={
                                        isCreateMode ? "usuario@ingenial-ia.com" : ""
                                    }
                                    className={cn(
                                        inputClasses,
                                        errors.email && inputErrorClasses
                                    )}
                                />
                                <p className="mt-1 text-[11px] text-slate-400">
                                    {isCreateMode
                                        ? "Este email se usará como identificador en Azure AD."
                                        : "Este campo se hereda de Azure AD y no es editable."}
                                </p>
                                {errors.email && (
                                    <p className="mt-1 text-xs font-medium text-rose-600">
                                        {errors.email as string}
                                    </p>
                                )}
                            </div>

                            <Field
                                label="Nombre completo"
                                error={errors.display_name as string}
                            >
                                <input
                                    type="text"
                                    name="display_name"
                                    value={formData.display_name}
                                    onChange={handleChange}
                                    placeholder="Ingrese el nombre completo"
                                    className={cn(
                                        inputClasses,
                                        errors.display_name && inputErrorClasses
                                    )}
                                />
                            </Field>

                            <Field
                                label="Tipo de usuario"
                                error={errors.role as string}
                            >
                                <select
                                    name="role"
                                    value={formData.role}
                                    onChange={handleChange}
                                    className={cn(
                                        inputClasses,
                                        errors.role && inputErrorClasses
                                    )}
                                >
                                    <option value="" disabled>
                                        Seleccione un tipo
                                    </option>
                                    <option value="User">Cliente</option>
                                    <option value="Admin">Administrador</option>
                                </select>
                            </Field>

                            <Field
                                label="Referencia 1"
                                error={errors.reference as string}
                            >
                                <input
                                    type="text"
                                    name="reference"
                                    value={formData.reference}
                                    onChange={handleChange}
                                    placeholder="Ingrese la referencia"
                                    className={cn(
                                        inputClasses,
                                        errors.reference && inputErrorClasses
                                    )}
                                />
                            </Field>

                            <Field
                                label="Referencia 2"
                                error={errors.reference2 as string}
                                hint="Opcional"
                            >
                                <input
                                    type="text"
                                    name="reference2"
                                    value={formData.reference2}
                                    onChange={handleChange}
                                    placeholder="Ingrese la segunda referencia"
                                    className={cn(
                                        inputClasses,
                                        errors.reference2 && inputErrorClasses
                                    )}
                                />
                            </Field>

                            <Field
                                label="Correo personal"
                                error={errors.personal_email as string}
                            >
                                <input
                                    type="email"
                                    name="personal_email"
                                    value={formData.personal_email}
                                    onChange={handleChange}
                                    placeholder="correo@ejemplo.com"
                                    className={cn(
                                        inputClasses,
                                        errors.personal_email && inputErrorClasses
                                    )}
                                />
                            </Field>

                            <Field
                                label="Teléfono"
                                error={errors.phone as string}
                            >
                                <input
                                    type="tel"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    placeholder="+57 3214567890"
                                    className={cn(
                                        inputClasses,
                                        errors.phone && inputErrorClasses
                                    )}
                                />
                            </Field>

                            <Field
                                label="Tipo de persona"
                                error={errors.type_person as string}
                            >
                                <select
                                    name="type_person"
                                    value={formData.type_person}
                                    onChange={handleChange}
                                    className={cn(
                                        inputClasses,
                                        errors.type_person && inputErrorClasses
                                    )}
                                >
                                    <option value="" disabled>
                                        Seleccione un tipo
                                    </option>
                                    <option value="Persona Natural">
                                        Persona Natural
                                    </option>
                                    <option value="Persona Jurídica">
                                        Persona Jurídica
                                    </option>
                                </select>
                            </Field>

                            <Field
                                label="Tipo de DNI"
                                error={errors.type_dni as string}
                            >
                                <select
                                    name="type_dni"
                                    value={formData.type_dni}
                                    onChange={handleChange}
                                    className={cn(
                                        inputClasses,
                                        errors.type_dni && inputErrorClasses
                                    )}
                                >
                                    <option value="" disabled>
                                        Seleccione un tipo
                                    </option>
                                    <option value="Cédula de Ciudadanía">
                                        Cédula de Ciudadanía
                                    </option>
                                    <option value="NIT">NIT</option>
                                </select>
                            </Field>

                            <Field
                                label="DNI"
                                error={errors.identity_document as string}
                            >
                                <input
                                    type="tel"
                                    name="identity_document"
                                    value={formData.identity_document}
                                    onChange={handleChange}
                                    placeholder="000 000 000"
                                    className={cn(
                                        inputClasses,
                                        errors.identity_document && inputErrorClasses
                                    )}
                                />
                            </Field>

                            <Field label="Estado">
                                <select
                                    name="enable"
                                    value={formData.enable ? "1" : "0"}
                                    onChange={handleChange}
                                    className={cn(inputClasses)}
                                >
                                    <option value="1">Activo</option>
                                    <option value="0">Inactivo</option>
                                </select>
                            </Field>

                            {isCreateMode && (
                                <>
                                    <div className="md:col-span-2 mt-2">
                                        <div className="border-t border-slate-100 pt-4">
                                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                                Credenciales
                                            </p>
                                        </div>
                                    </div>
                                    <Field
                                        label="Contraseña"
                                        error={errors.password as string}
                                    >
                                        <input
                                            type="password"
                                            name="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Mínimo 8 caracteres"
                                            autoComplete="new-password"
                                            className={cn(
                                                inputClasses,
                                                errors.password && inputErrorClasses
                                            )}
                                        />
                                    </Field>
                                    <Field
                                        label="Confirmar contraseña"
                                        error={errors.confirmPassword as string}
                                    >
                                        <input
                                            type="password"
                                            name="confirmPassword"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="Repite la contraseña"
                                            autoComplete="new-password"
                                            className={cn(
                                                inputClasses,
                                                errors.confirmPassword && inputErrorClasses
                                            )}
                                        />
                                    </Field>
                                </>
                            )}
                        </div>
                    ) : (
                        <div>
                            <ProductsSelector
                                votometroZones={votometroZones}
                                setVotometroZones={setVotometroZones}
                                audivotoZones={audivotoZones}
                                setAudivotoZones={setAudivotoZones}
                                votometroEnabled={votometroEnabled}
                                setVotometroEnabled={setVotometroEnabled}
                                audivotoEnabled={audivotoEnabled}
                                setAudivotoEnabled={setAudivotoEnabled}
                                formData={productsFormData}
                                setFormData={setProductsFormData}
                                errors={productsErrors}
                                setErrors={setProductsErrors}
                                departamentos={departamentos}
                                municipios={municipios}
                            />
                        </div>
                    )}
                </CardBody>
            </Card>

            <div className="fixed bottom-0 inset-x-0 z-40 bg-white/90 backdrop-blur border-t border-slate-200 shadow-[0_-4px_12px_-4px_rgba(15,23,42,0.08)]">
                <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-end gap-3">
                    <Button
                        variant="secondary"
                        onClick={() => navigate(cancelTarget)}
                        disabled={loading}
                    >
                        Cancelar
                    </Button>
                    <Button
                        leftIcon={<Save />}
                        onClick={onSubmit}
                        disabled={loading}
                    >
                        {isCreateMode
                            ? "Crear usuario"
                            : activeTab === "personal"
                            ? "Guardar información"
                            : "Guardar productos"}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default UserEdit;

const TabButton = ({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            "px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors",
            active
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
        )}
    >
        {children}
    </button>
);

const Field = ({
    label,
    error,
    hint,
    children,
}: {
    label: string;
    error?: string;
    hint?: string;
    children: React.ReactNode;
}) => (
    <div>
        <label className={labelClasses}>
            {label}
            {hint && (
                <span className="ml-1 font-normal text-slate-400">
                    · {hint}
                </span>
            )}
        </label>
        {children}
        {error && (
            <p className="mt-1 text-xs font-medium text-rose-600">{error}</p>
        )}
    </div>
);
