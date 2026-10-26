# Concurso de Disfraces Halloween · Grupo Lucky (3 sedes)

HTML + CSS + JS sin frameworks. Responsivo (celular, tablet, laptop). Cada sede es un concurso independiente.

## Probar la demostración
1. Pon `seed.js` (te lo entregan aparte) dentro de `data/private/`. Ese archivo tiene nombres y huellas de códigos: **no se sube a git**.
2. Abre `index.html` (votantes y jurados: eligen sede y escriben su código) o `admin.html` (organizadores).
3. Los códigos están en los CSV privados (`codigos_santacruz.csv`, `codigos_organizadores.csv`). **Nunca los subas.**

## Quién puede qué
| Rol | Acceso |
|---|---|
| Administrador (Luis) | Todo: personas, equipos, reinicio, candado, pruebas, códigos de organizadores. Siempre activo. |
| Organizador principal (Alexis) | Las 3 sedes: jurados, favorito con reloj, personas, equipos, resultados y ceremonia. |
| Respaldo (Michele, Roselva) | Entran en **modo espera** (no ven nada) hasta que el administrador o quien tiene el control pulse **Pasar el control**. |
| Jurado | Califica 1–10 las 4 categorías; puede anular y recalificar mientras esté abierto. Vota también el favorito. |
| Votante | Un solo voto en el favorito, con confirmación Sí/No, sin cambios. |

## Reglas
- **Mejor disfraz del año (Bs 700, voto de todos):** un voto por persona y por ronda (se puede votar por uno mismo, gasta el único voto). Gana quien tenga más votos. Alexis fija los minutos (1–15) y pulsa Iniciar; se cierra solo. Empate en el 1.er lugar → desempate solo entre los empatados.
- **Jurados (Favorito del público, creativo, grupal e interpretación, Bs 300 c/u):** promedio de las notas; desempate por más notas 10. "Mejor disfraz grupal" solo dúos y grupos.
- **Premios:** iguales en las 3 sedes, un ganador por sede y categoría.
- **Resultados:** solo los ve quien tiene el control. La ceremonia muestra un solo ganador por categoría.
- **Candado del evento (por sede):** activado, nadie edita personas/equipos ni reinicia votos. Solo el administrador lo desactiva.
- **Reiniciar votos / todo:** solo administrador; pide escribir REINICIAR y descarga un respaldo CSV antes.
- **Ingreso:** solo con código (`NOMBRE-XXXXXX`, 6 caracteres). Se liga al primer dispositivo; 5 intentos fallidos bloquean.

## Archivos
```
index.html / admin.html
css/  base · tema-halloween · animaciones · responsive · admin
js/   util · efectos · decor · db (reglas y almacenamiento) · app · admin
data/ config.js (público: categorías, sedes, fecha)   data/private/seed.js (NO se sube)
img/  logo.png · icon.png
```

## Estado: DEMO
Los votos se guardan en el navegador de cada dispositivo (localStorage). **No usar para el concurso real hasta conectar Firebase**:
- Auth + Firestore + reglas del servidor (un voto por persona, hora del servidor, solo el organizador activo lee resultados).
- Se reemplaza `js/db.js` manteniendo la misma API. Los nombres salen del código y viven solo en Firebase.

## Pendiente
- Conectar Firebase y probar con varios celulares (5–6 personas, unos días antes).
- Jurado 4 (agregarlo desde Personas → rol Jurado), Lizbeth, Dña. Roxana, Diego (Guardia), Alex de Colgate.
- Cargar La Paz y Cochabamba desde el panel (Personas y Equipos).
- Fotos o nombre del disfraz por equipo (campo "disfraz" en Equipos).
