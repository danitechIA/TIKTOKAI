"""TikTokAI - API FastAPI: orquesta upload -> transcripción -> estilo -> render."""
import time
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Body
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config, store, jobs, media, captions

app = FastAPI(title="TikTokAI")

ALLOWED_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}


@app.on_event("startup")
def _startup():
    jobs.start_worker()


# ---------- Auth sencilla por token (la app está expuesta en el VPS) ----------
@app.middleware("http")
async def auth_mw(request: Request, call_next):
    path = request.url.path
    public = (
        path == "/"
        or path == "/api/health"
        or path == "/api/config"
        or path == "/api/login"
        or path.startswith("/static")
        or path.startswith("/assets")
    )
    if config.APP_PASSWORD and not public and path.startswith("/api"):
        token = request.headers.get("authorization", "")
        token = token.replace("Bearer ", "").strip()
        # Fallback por query (necesario para <video src> y descargas directas)
        if not token:
            token = request.query_params.get("token", "")
        if token != config.APP_PASSWORD:
            return JSONResponse({"detail": "No autorizado"}, status_code=401)
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "tiktokai"}


@app.get("/api/config")
def app_config():
    """Indica al front si hace falta contraseña."""
    return {"auth_required": bool(config.APP_PASSWORD)}


@app.post("/api/login")
async def login(payload: dict = Body(...)):
    if payload.get("password") == config.APP_PASSWORD:
        return {"ok": True, "token": config.APP_PASSWORD}
    raise HTTPException(status_code=401, detail="Contraseña incorrecta")


# ---------- Proyectos ----------
@app.get("/api/projects")
def get_projects():
    return [_public(p) for p in store.list_projects()]


@app.post("/api/projects")
async def create_project(file: UploadFile = File(...), name: str = Form("")):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Formato no soportado: {ext}")

    proj = store.create_project(name or Path(file.filename).stem)
    pdir = store.project_dir(proj["id"])
    dest = pdir / f"source{ext}"

    with open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)

    try:
        info = media.probe_video(dest)
    except Exception as e:
        store.delete_project(proj["id"])
        raise HTTPException(status_code=400, detail=f"Vídeo inválido: {e}")

    source = {"filename": file.filename, "path": str(dest), **info}
    proj = store.update_project(proj["id"], source=source)
    return _public(proj)


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    proj = store.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="No existe")
    # Añadir el % de render en curso (memoria, sin tocar disco)
    prog = jobs.RENDER_PROGRESS.get(pid)
    if prog is not None:
        proj.setdefault("steps", {}).setdefault("render", {})["progress"] = prog
    return _public(proj)


@app.delete("/api/projects/{pid}")
def del_project(pid: str):
    if not store.delete_project(pid):
        raise HTTPException(status_code=404, detail="No existe")
    return {"ok": True}


@app.post("/api/projects/{pid}/transcribe")
def do_transcribe(pid: str, payload: dict = Body(default={})):
    proj = store.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="No existe")
    lang = payload.get("language") or config.DEFAULT_LANGUAGE
    # Guardar idioma elegido
    tr = proj.get("transcript") or {}
    tr["language"] = lang
    store.update_project(pid, transcript=tr if proj.get("transcript") else {"language": lang, "words": [], "raw_text": ""})
    jobs.enqueue("transcribe", pid)
    return {"ok": True, "queued": True}


@app.put("/api/projects/{pid}/transcript")
def update_transcript(pid: str, payload: dict = Body(...)):
    proj = store.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="No existe")
    tr = proj.get("transcript") or {"language": config.DEFAULT_LANGUAGE, "words": [], "raw_text": ""}
    words = payload.get("words")
    if words is not None:
        clean = []
        for i, w in enumerate(words):
            clean.append({
                "i": i,
                "word": str(w.get("word", "")),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
                "enabled": bool(w.get("enabled", True)),
            })
        tr["words"] = clean
    store.update_project(pid, transcript=tr)
    return {"ok": True}


@app.get("/api/sfx")
def list_sfx():
    """Lista dinámica de efectos de sonido: cualquier .mp3 en la carpeta sfx/."""
    return {"sfx": sorted(f.stem for f in config.SFX_DIR.glob("*.mp3"))}


@app.post("/api/projects/{pid}/hook")
def gen_hook(pid: str):
    """Genera un hook viral corto con IA a partir de la transcripción."""
    proj = store.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="No existe")
    text = (proj.get("transcript") or {}).get("raw_text", "")
    if not text:
        words = (proj.get("transcript") or {}).get("words", [])
        text = " ".join(w.get("word", "") for w in words)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Transcribe primero")
    try:
        hook = captions.generate_hook(text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"IA no disponible: {e}")
    if not hook:
        raise HTTPException(status_code=502, detail="La IA no devolvió hook")
    return {"hook": hook}


@app.put("/api/projects/{pid}/elements")
def update_elements(pid: str, payload: dict = Body(...)):
    """Guarda los elementos con tiempo de la línea de tiempo: títulos y sonidos."""
    proj = store.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="No existe")
    changes = {}
    if "titles" in payload:
        clean = []
        for t in (payload.get("titles") or [])[:20]:
            start = max(0.0, float(t.get("start", 0) or 0))
            end = float(t.get("end", start + 2.5) or (start + 2.5))
            clean.append({
                "id": str(t.get("id") or "")[:16] or "t",
                "text": str(t.get("text") or "")[:120],
                "start": round(start, 3),
                "end": round(max(start + 0.2, end), 3),
                "color": str(t.get("color") or "#FFFFFF")[:9],
                "size": max(40, min(200, int(t.get("size") or 120))),
                "pos": max(5.0, min(95.0, float(t.get("pos") or 24))),
                "sound": str(t.get("sound") or "")[:24],
            })
        changes["titles"] = clean
    if "sounds" in payload:
        clean = []
        for s in (payload.get("sounds") or [])[:40]:
            clean.append({
                "id": str(s.get("id") or "")[:16] or "s",
                "sfx": str(s.get("sfx") or "whoosh")[:24],
                "t": round(max(0.0, float(s.get("t", 0) or 0)), 3),
            })
        changes["sounds"] = clean
    store.update_project(pid, **changes)
    return {"ok": True}


@app.put("/api/projects/{pid}/style")
def update_style(pid: str, payload: dict = Body(...)):
    proj = store.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="No existe")
    style = {**(proj.get("style") or config.DEFAULT_STYLE), **payload}
    store.update_project(pid, style=style)
    return {"ok": True, "style": style}


@app.post("/api/projects/{pid}/render")
def do_render(pid: str):
    proj = store.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="No existe")
    if not proj.get("transcript") or not (proj["transcript"].get("words")):
        raise HTTPException(status_code=400, detail="Transcribe primero")
    jobs.enqueue("render", pid)
    return {"ok": True, "queued": True}


@app.post("/api/projects/{pid}/caption")
def do_caption(pid: str, payload: dict = Body(default={})):
    proj = store.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="No existe")
    jobs.enqueue("caption", pid, hint=payload.get("hint", ""))
    return {"ok": True, "queued": True}


# ---------- Servir vídeos ----------
@app.get("/api/projects/{pid}/source")
def get_source(pid: str):
    proj = store.load_project(pid)
    if not proj or not proj.get("source"):
        raise HTTPException(status_code=404, detail="Sin vídeo")
    return FileResponse(proj["source"]["path"])


@app.get("/api/projects/{pid}/output")
def get_output(pid: str):
    proj = store.load_project(pid)
    if not proj or not proj.get("output"):
        raise HTTPException(status_code=404, detail="Sin render")
    return FileResponse(proj["output"]["path"])


@app.get("/api/projects/{pid}/download")
def download(pid: str):
    proj = store.load_project(pid)
    if not proj or not proj.get("output"):
        raise HTTPException(status_code=404, detail="Sin render")
    name = f"{proj['name']}-tiktok.mp4".replace(" ", "_")
    return FileResponse(proj["output"]["path"], filename=name, media_type="video/mp4")


def _public(proj: dict) -> dict:
    """Versión segura para el front (sin rutas absolutas innecesarias)."""
    p = dict(proj)
    return p


# ---------- Frontend ----------
app.mount("/static", StaticFiles(directory=str(config.STATIC_DIR)), name="static")
# Fuentes locales (las mismas que usa el render) para que el preview coincida
app.mount("/fonts", StaticFiles(directory=str(config.FONTS_DIR)), name="fonts")
# Efectos de sonido (para previsualizar en el navegador y mezclar en el render)
app.mount("/sfx", StaticFiles(directory=str(config.SFX_DIR)), name="sfx")


@app.get("/")
def index():
    # Sin caché para que el HTML (y las versiones de JS/CSS) siempre lleguen frescos
    return FileResponse(
        str(config.STATIC_DIR / "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
