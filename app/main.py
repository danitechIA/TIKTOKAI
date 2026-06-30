"""TikTokAI - API FastAPI: orquesta upload -> transcripción -> estilo -> render."""
import time
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Body
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config, store, jobs, media

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


@app.get("/")
def index():
    return FileResponse(str(config.STATIC_DIR / "index.html"))
