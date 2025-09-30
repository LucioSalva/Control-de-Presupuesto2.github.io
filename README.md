# Control de Presupuesto — App sin Excel (HTML5 + Bootstrap 5 + JS)
Aplicación **100% en navegador**, sin backend y **sin Excel**. Permite **capturar** Presupuesto/Partidas, **registrar Gastos**, **agregar Reconducciones** y calcula KPIs, tabla por partida, **gasto mensual** y **gastos sin Partida**. Guarda los datos en **localStorage**.

## Archivos
- `index.html` — UI completa con formularios, tablas y gráfica.
- `styles.css` — Tema oscuro con fuentes blancas.
- `script.js` — Lógica: estado, persistencia, cálculos, render, import/export JSON.

## Funciones clave
- **Captura**: Partidas/Presupuesto, Gastos (con/sin partida), Reconducciones.
- **Cálculo**: Gastado por partida, KPIs, saldo, gráfico mensual.
- **Alertas**: Gastos sin partida (modal + exportar CSV).
- **Persistencia**: `localStorage` (botones *Exportar JSON*, *Importar JSON* y *Reiniciar*).
- **Demo**: carga datos de ejemplo.

## Uso
1. Abre `index.html` en tu navegador.
2. Agrega partidas en “Partidas / Presupuesto”.
3. Registra gastos y reconducciones.
4. Usa los filtros y exporta CSV/JSON si lo necesitas.
