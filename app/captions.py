"""Generación de copy + hashtags para TikTok con Groq (nicho dev / IA)."""
import json
import httpx

from . import config

SYSTEM = (
    "Eres redactor de copy para TikTok. Escribes la descripción de un vídeo "
    "basándote ÚNICAMENTE en lo que realmente se dice en su transcripción.\n"
    "REGLAS ESTRICTAS:\n"
    "1. NO inventes funciones, datos, cifras, promesas ni afirmaciones que no "
    "aparezcan en la transcripción (nada de 'en minutos', 'descubre cómo', "
    "'el secreto', etc. si no se dice en el vídeo).\n"
    "2. El copy debe reflejar EL CONTENIDO CONCRETO del vídeo, no un nicho genérico.\n"
    "3. Si la transcripción es corta o vaga, escribe un copy breve y fiel; mejor "
    "poco y cierto que mucho e inventado.\n"
    "4. El canal trata de desarrollo de apps multiplataforma e IA: úsalo solo como "
    "contexto suave para los hashtags, nunca para inventar el contenido.\n"
    "5. Español, tono cercano y directo, sin relleno ni clickbait falso."
)


def generate_caption(transcript_text: str, hint: str = "") -> dict:
    if not config.GROQ_API_KEY:
        raise RuntimeError("Falta GROQ_API_KEY en el .env")

    text = (transcript_text or "").strip()
    if not text:
        text = "(sin transcripción disponible)"

    url = f"{config.GROQ_BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.GROQ_API_KEY}",
        "Content-Type": "application/json",
    }

    user = (
        "Transcripción LITERAL del vídeo (es lo único que sabes que ocurre en él):\n"
        f'"""\n{text[:3000]}\n"""\n\n'
    )
    if hint:
        user += f"Indicación adicional del usuario (respétala): {hint}\n\n"
    user += (
        "Escribe el copy de TikTok ciñéndote SOLO a esa transcripción:\n"
        "- 'caption': un gancho fiel al contenido real (máx 200 caracteres). "
        "Si el vídeo apenas dice nada concreto, haz una descripción breve y honesta, "
        "sin prometer ni afirmar cosas que no se ven.\n"
        "- 'hashtags': EXACTAMENTE 5 hashtags (ni más ni menos), relevantes al tema "
        "REAL del vídeo, con 1-2 de alcance amplio.\n\n"
        "Responde SOLO con JSON válido: "
        '{"caption": "...", "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]}'
    )

    body = {
        "model": config.CAPTION_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user},
        ],
        "temperature": 0.55,
        "max_tokens": 400,
        "response_format": {"type": "json_object"},
    }

    with httpx.Client(timeout=90) as client:
        resp = client.post(url, headers=headers, json=body)

    if resp.status_code != 200:
        raise RuntimeError(f"Groq caption {resp.status_code}: {resp.text[:400]}")

    content = resp.json()["choices"][0]["message"]["content"]
    try:
        data = json.loads(content)
    except Exception:
        data = {"caption": content.strip(), "hashtags": []}

    caption = (data.get("caption") or "").strip()
    hashtags = data.get("hashtags") or []
    if isinstance(hashtags, str):
        hashtags = [h.strip() for h in hashtags.split() if h.strip()]
    hashtags = [h if h.startswith("#") else f"#{h}" for h in hashtags]
    # Garantizar exactamente 5 hashtags (recorta si el modelo devuelve de más)
    hashtags = hashtags[:5]
    return {"caption": caption, "hashtags": hashtags}
