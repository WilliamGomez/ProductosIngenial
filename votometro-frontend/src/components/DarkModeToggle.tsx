import { useEffect, useState } from "react";

export default function DarkModeToggle() {
  const [isDark, setIsDark] = useState(false);

  // Cargar preferencia guardada en localStorage al montar el componente
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    } else {
      setIsDark(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // Actualizar DOM y guardar en localStorage cuando cambia
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  return (
    <div className='flex justify-center p-4'>
      <label className='label cursor-pointer'>
        <span className='label-text mr-2'>Modo oscuro</span>
        <input type='checkbox' className='toggle toggle-primary' checked={isDark} onChange={() => setIsDark(!isDark)} />
      </label>
    </div>
  );
}
