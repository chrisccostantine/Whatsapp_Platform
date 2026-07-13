/** @type {import('tailwindcss').Config} */
export default { content: ["./index.html", "./src/**/*.{ts,tsx}"], theme: { extend: { colors: { ink: "#13221c", brand: { 50: "#eefbf4", 100: "#d7f5e3", 500: "#20a864", 600: "#168a50", 700: "#126f42" } }, boxShadow: { card: "0 1px 2px rgba(18,38,29,.05),0 8px 24px rgba(18,38,29,.05)" } } }, plugins: [] };

