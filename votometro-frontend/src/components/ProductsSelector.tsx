import { useState, useEffect } from "react";
import { X, CheckCircle2, Circle, AlertCircle, Package, MapPin } from "lucide-react";
import type { IProductsFormData } from "../interfaces/IRegisterUserFormData";
import type { IDepartment } from "../interfaces/IDepartments";
import type { IMunicipio } from "../interfaces/IMunicipio";
import type { IUserZone } from "../services/api";
import ZonesSelector from "./ZonesSelector";

interface ProductsSelectorProps {
  votometroZones: IUserZone[];
  setVotometroZones: React.Dispatch<React.SetStateAction<IUserZone[]>>;
  audivotoZones: IUserZone[];
  setAudivotoZones: React.Dispatch<React.SetStateAction<IUserZone[]>>;
  votometroEnabled: boolean;
  setVotometroEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  audivotoEnabled: boolean;
  setAudivotoEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  formData: IProductsFormData;
  setFormData: React.Dispatch<React.SetStateAction<IProductsFormData>>;
  departamentos: IDepartment[];
  municipios: IMunicipio[];
  errors: { [key: string]: string };
  setErrors: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>;
}

const ProductsSelector = ({
  votometroZones, setVotometroZones,
  audivotoZones, setAudivotoZones,
  votometroEnabled, setVotometroEnabled,
  audivotoEnabled, setAudivotoEnabled,
  formData, setFormData, departamentos, municipios, errors, setErrors
}: ProductsSelectorProps) => {

  const [activeTab, setActiveTab] = useState<"votometro" | "audivoto">("votometro");

  useEffect(() => {
    if (votometroEnabled && !audivotoEnabled) {
      setActiveTab("votometro");
    } else if (audivotoEnabled && !votometroEnabled) {
      setActiveTab("audivoto");
    }
  }, [votometroEnabled, audivotoEnabled]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors((prev) => ({ ...prev, [e.target.name]: "" }));
  };

  const formatString = (text: string) => {
    if (!text) return '';
    return text.trim().toLowerCase().split(' ').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const padDep = (value: string | number) => String(value).padStart(2, "0");
  const toUiZoneCode = (codDep: string | number, codMun: string | number | null) => {
    if (codMun == null) return null;
    const raw = String(codMun).trim();
    return raw.length <= 3 ? `${padDep(codDep)}${raw.padStart(3, "0")}` : raw.padStart(5, "0");
  };

  // --- Funciones para agrupar las zonas en el Recibo (Lado Derecho) ---
  const getGroupedZones = (zones: IUserZone[]) => {
    const grouped: Record<string, { depCode: string, muns: { name: string, code: string | null }[] }> = {};
    zones.forEach(z => {
      const dep = departamentos.find(d => String(d.code).padStart(2, '0') === String(z.cod_dep));
      if (!dep) return;
      if (!grouped[dep.name]) grouped[dep.name] = { depCode: z.cod_dep, muns: [] };

      if (z.cod_mun === null) {
        grouped[dep.name].muns.push({ name: 'all', code: null });
      } else {
        const uiCode = toUiZoneCode(z.cod_dep, z.cod_mun);
        const mun = municipios.find(m => toUiZoneCode(m.dpto, m.code) === uiCode);
        if (mun) grouped[dep.name].muns.push({ name: mun.name, code: uiCode });
      }
    });
    return grouped;
  };

  const groupedVotometro = getGroupedZones(votometroZones);
  const groupedAudivoto = getGroupedZones(audivotoZones);

  // --- Funciones para eliminar ítems desde el Recibo (Lado Derecho) ---
  const removeZone = (setter: React.Dispatch<React.SetStateAction<IUserZone[]>>, depCode: string, munCode?: string | null) => {
    if (munCode === undefined || munCode === null) {
      // Eliminar todo el departamento
      setter(prev => prev.filter(z => z.cod_dep !== depCode));
    } else {
      // Eliminar un municipio específico
      setter(prev => prev.filter(z => !(z.cod_dep === depCode && toUiZoneCode(z.cod_dep, z.cod_mun) === munCode)));
    }
  };

  const inputClass = "w-full text-sm appearance-none px-3 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-colors";
  const labelClass = "block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5";

  return (
    <div className="w-full relative">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Lado Izquierdo: Formulario y Selectores */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <div className="flex p-1 space-x-1 bg-slate-100/80 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab("votometro")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                activeTab === "votometro" ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-900/5" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
              }`}
            >
              <Package className="w-4 h-4" /> Votómetro
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("audivoto")}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                activeTab === "audivoto" ? "bg-white text-brand-700 shadow-sm ring-1 ring-slate-900/5" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
              }`}
            >
              <Package className="w-4 h-4" /> Audivoto
            </button>
          </div>

          {errors.general && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2 border border-red-100">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>{errors.general}</p>
            </div>
          )}

          {/* Tab Content: Votometro */}
          {activeTab === "votometro" && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Estado del producto</p>
                  <p className="text-xs text-slate-500">Activa Votómetro para este usuario</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={votometroEnabled} onChange={(e) => setVotometroEnabled(e.target.checked)} />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
                </label>
              </div>

              <div className={!votometroEnabled ? "opacity-50 pointer-events-none" : ""}>
                <div className="mb-6">
                  <label className={labelClass}>Tiempo de contratación</label>
                  <select name="tiempoContratacionVotometro" value={formData.tiempoContratacionVotometro} onChange={handleChange} className={inputClass}>
                    <option value="">Seleccione un tiempo</option>
                    <option value="1 mes">1 mes</option>
                    <option value="3 meses">3 meses</option>
                    <option value="4 meses">4 meses</option>
                    <option value="6 meses">6 meses</option>
                    <option value="1 año">1 año</option>
                  </select>
                  {errors.tiempoContratacionVotometro && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3"/>{errors.tiempoContratacionVotometro}</p>}
                </div>
                
                <label className={labelClass}>Asignación Geográfica</label>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <ZonesSelector 
                      departments={departamentos} 
                      municipalities={municipios} 
                      value={votometroZones} 
                      onChange={setVotometroZones} 
                      disabled={!votometroEnabled} 
                    />
                </div>
                {errors.zonasVotometro && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3"/>{errors.zonasVotometro}</p>}
              </div>
            </div>
          )}

          {/* Tab Content: Audivoto */}
          {activeTab === "audivoto" && (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Estado del producto</p>
                  <p className="text-xs text-slate-500">Activa Audivoto para este usuario</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={audivotoEnabled} onChange={(e) => setAudivotoEnabled(e.target.checked)} />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
                </label>
              </div>

              <div className={!audivotoEnabled ? "opacity-50 pointer-events-none" : ""}>
                <div className="mb-6">
                  <label className={labelClass}>Tiempo de contratación</label>
                  <select name="tiempoContratacionAudivoto" value={formData.tiempoContratacionAudivoto} onChange={handleChange} className={inputClass}>
                    <option value="">Seleccione un tiempo</option>
                    <option value="1 mes">1 mes</option>
                    <option value="3 meses">3 meses</option>
                    <option value="6 meses">6 meses</option>
                    <option value="1 año">1 año</option>
                  </select>
                  {errors.tiempoContratacionAudivoto && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3"/>{errors.tiempoContratacionAudivoto}</p>}
                </div>

                <label className={labelClass}>Asignación Geográfica</label>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <ZonesSelector 
                      departments={departamentos} 
                      municipalities={municipios} 
                      value={audivotoZones} 
                      onChange={setAudivotoZones} 
                      disabled={!audivotoEnabled} 
                    />
                </div>
                {errors.zonasAudivoto && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3"/>{errors.zonasAudivoto}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Lado Derecho: Resumen de Asignación (El Recibo) */}
        <div className="lg:col-span-5">
          <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden sticky top-6">
            <div className="px-5 py-4 bg-slate-100 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800 text-sm tracking-wide">RESUMEN DE ASIGNACIÓN</h3>
            </div>
            
            <div className="max-h-[32rem] space-y-6 overflow-y-auto p-5 pr-3">
              
              {/* Recibo Votometro */}
              <div className={`${!votometroEnabled ? 'opacity-50 grayscale' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {votometroEnabled ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4 text-slate-300" />}
                    <h4 className="font-semibold text-slate-800 text-sm">Votómetro</h4>
                  </div>
                  {!votometroEnabled && <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Inactivo</span>}
                </div>
                
                {votometroEnabled && (
                  <div className="space-y-3">
                    {Object.keys(groupedVotometro).length > 0 ? (
                      Object.entries(groupedVotometro).map(([depName, data]) => (
                        <div key={depName} className="bg-white border border-slate-200 rounded-lg p-3 text-sm shadow-sm">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium text-slate-800 flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-brand-500" />
                              {formatString(depName)}
                            </span>
                            <button type="button" onClick={() => removeZone(setVotometroZones, data.depCode)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="pl-5 border-l-2 border-slate-100 mt-2 space-y-1.5">
                            {data.muns.map((mun, idx) => (
                              <div key={idx} className="flex justify-between items-center text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded">
                                <span>{mun.name === 'all' ? 'Todos los Municipios' : formatString(mun.name)}</span>
                                <button type="button" onClick={() => removeZone(setVotometroZones, data.depCode, mun.code)} className="text-slate-400 hover:text-red-500">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500 italic bg-white border border-dashed border-slate-200 p-3 rounded-lg text-center">Sin zonas asignadas</p>
                    )}
                  </div>
                )}
              </div>

              {/* Recibo Audivoto */}
              <div className={`${!audivotoEnabled ? 'opacity-50 grayscale' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {audivotoEnabled ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Circle className="w-4 h-4 text-slate-300" />}
                    <h4 className="font-semibold text-slate-800 text-sm">Audivoto</h4>
                  </div>
                  {!audivotoEnabled && <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Inactivo</span>}
                </div>
                
                {audivotoEnabled && (
                  <div className="space-y-3">
                    {Object.keys(groupedAudivoto).length > 0 ? (
                      Object.entries(groupedAudivoto).map(([depName, data]) => (
                        <div key={depName} className="bg-white border border-slate-200 rounded-lg p-3 text-sm shadow-sm">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium text-slate-800 flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-brand-500" />
                              {formatString(depName)}
                            </span>
                            <button type="button" onClick={() => removeZone(setAudivotoZones, data.depCode)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="pl-5 border-l-2 border-slate-100 mt-2 space-y-1.5">
                            {data.muns.map((mun, idx) => (
                              <div key={idx} className="flex justify-between items-center text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded">
                                <span>{mun.name === 'all' ? 'Todos los Municipios' : formatString(mun.name)}</span>
                                <button type="button" onClick={() => removeZone(setAudivotoZones, data.depCode, mun.code)} className="text-slate-400 hover:text-red-500">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-slate-500 italic bg-white border border-dashed border-slate-200 p-3 rounded-lg text-center">Sin zonas asignadas</p>
                    )}
                  </div>
                )}
              </div>
              
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductsSelector;
