# 🎬 TikTokAI — Orquestador de edición y subtítulos

Sistema para subir vídeos verticales (iPhone), generar **subtítulos karaoke estilo TikTok**
(palabra a palabra) y descargar el vídeo final listo para subir a mano. Nicho: desarrollo
de apps multiplataforma / IA.

> Vive en el mismo VPS que TradingAI pero **totalmente aislado**: directorio propio
> (`/root/TIKTOKAI`), puerto propio (8080), worker de baja prioridad (`nice`) para no
> competir por la CPU con el sistema de trading (puerto 8000).

## Flujo

1. **Subir** vídeo vertical (MP4/MOV…).
2. **Transcribir** con Groq Whisper (timestamps por palabra).
3. **Editar** palabras (corregir texto, desactivar) y el **estilo** (fuente, tamaño,
   colores, posición, palabras por bloque, "pop" de la activa…).
4. **Renderizar**: ffmpeg quema los subtítulos sobre el vídeo (1080 de ancho).
5. **Copy**: genera descripción + hashtags con Groq.
6. **Descargar** y subir a TikTok manualmente.

Cada paso es **orquestable y modificable** desde la interfaz; se puede re-ejecutar.

## Arquitectura

```
static/ (UI: HTML+CSS+JS, sin build)  ──►  FastAPI (app/main.py)
                                              ├── jobs.py    cola 1-worker (serializa CPU)
                                              ├── media.py   ffprobe + extracción audio
                                              ├── transcribe.py  Groq Whisper (word-level)
                                              ├── subtitles.py   genera .ass karaoke + auto-wrap
                                              ├── render.py      ffmpeg burn (nice/ionice)
                                              └── captions.py    Groq chat (copy+hashtags)
data/projects/<id>/   project.json + source.* + audio.mp3 + subs.ass + output.mp4
```

## Configuración (`.env`)

- `GROQ_API_KEY` — reutiliza la de TradingAI.
- `TRANSCRIBE_MODEL` = whisper-large-v3
- `CAPTION_MODEL` = llama-3.3-70b-versatile
- `APP_PASSWORD` — contraseña de acceso a la UI.
- `PORT` = 8080

## Arrancar

```bash
cd /root/TIKTOKAI && ./run.sh
# o:  .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Acceso: `http://<IP>:8080` (requiere abrir el puerto 8080 en UFW).

## Dependencias del sistema

- ffmpeg (con libass) — instalado.
- Fuentes Montserrat (Black/ExtraBold/Bold) en `fonts/`.
- Python 3.10 + venv en `.venv/`.

## Notas de recursos (VPS 4 vCPU / 8 GB, sin GPU)

- Transcripción **vía Groq** → no usa CPU local.
- Render por CPU con `nice -n 15 ionice -c2 -n7`: prioridad por debajo de TradingAI.
- Cola de **1 trabajo a la vez**: nunca hay dos ffmpeg simultáneos.
- Los vídeos de origen se pueden borrar tras descargar (limpieza manual desde la UI).
