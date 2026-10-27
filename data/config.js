/* Configuración PÚBLICA (sin nombres de personas). Igual para las 3 sedes. */
window.CONFIG = {
  eventDate: "2026-10-30T16:30:00-04:00",
  eventPlace: "Sala 1",
  scale: { min: 1, max: 10 },
  sedes: [
    { id: "santacruz", name: "Santa Cruz" },
    { id: "lapaz", name: "La Paz" },
    { id: "cochabamba", name: "Cochabamba" }
  ],
  categories: [
    { id: "anio", icon: "⭐", name: "Mejor disfraz del año", prize: "Bs 700", eligible: "all" },
    { id: "creativo", icon: "💡", name: "Disfraz más creativo", prize: "Bs 300", eligible: "all" },
    { id: "grupal", icon: "👥", name: "Mejor disfraz grupal", prize: "Bs 300", note: "mín. 2 personas", eligible: "groups" },
    { id: "interpretacion", icon: "🎭", name: "Mejor interpretación", prize: "Bs 300", eligible: "all" }
  ],
  publicCategory: { id: "favorito", icon: "🎩", name: "Favorito del público", prize: "Bs 300" }
};
