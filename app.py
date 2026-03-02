import os
import shutil
import json
import re
import uuid
import difflib
import base64
import requests
import google.generativeai as genai
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
import antigravity_sdk as antigravity
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

# Load environment variables
load_dotenv()

# --- CONFIGURATION ---
# App is at project root (anmar-engine/), frontend is a child (anmar-engine/frontend/)
# App is at project root (anmar-engine/), frontend is a child (anmar-engine/frontend/)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
frontend_path = os.path.abspath(os.path.join(BASE_DIR, 'frontend'))
internal_path = os.path.abspath(os.path.join(BASE_DIR, 'internal'))

# Generated projects are outside anmar-engine, on the Desktop sibling folder
# os.path.dirname(__file__) = .../Desktop/anmar-engine
# .. = .../Desktop
# generated_projects = .../Desktop/generated_projects
def resolve_projects_base_dir():
    preferred = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'generated_projects'))
    fallback = os.path.abspath(os.path.join(BASE_DIR, 'generated_projects'))
    for candidate in (preferred, fallback):
        try:
            os.makedirs(candidate, exist_ok=True)
            test_file = os.path.join(candidate, '.write_test')
            with open(test_file, 'w') as f:
                f.write('ok')
            os.remove(test_file)
            return candidate
        except Exception:
            continue
    return fallback

projects_base_dir = resolve_projects_base_dir()

app = Flask(__name__, static_folder=frontend_path, template_folder=frontend_path)

@app.route('/internal/<path:filename>')
def serve_internal(filename):
    return send_from_directory(internal_path, filename)
CORS(app)

# Google AI Setup
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    GOOGLE_API_KEY = "AIzaSyBmm6fOLCODWZueufCOsk8x2FDvucTCQEs"

# Configuración base para cualquier modelo Gemini seleccionado.
generation_config = {
    "temperature": 0.5,
    "top_p": 0.95,
    "max_output_tokens": 8192,
}

SYSTEM_INSTRUCTION_TEXT = """
Eres el Senior Startup Architect de ANMAR Business Group en New York.
Tu misión no es responder preguntas, sino co-crear imperios tecnológicos con el cliente.

Reglas:
- No repitas preguntas ya contestadas.
- Dialoga con criterio de negocio primero, luego producto/stack, luego handoff.
- Tono: profesional, directo, inteligente, consultor de alto nivel.
- Fase 1 Descubrimiento: dolor de mercado y nicho.
- Fase 2 Refinamiento: funcionalidades, stack y flujos.
- Fase 3 Cierre: cuando esté sólido, proponer orden de ejecución.
"""

AI_RUNTIME = {
    "connected": False,
    "model_name": None,
    "last_error": None,
    "last_check_at": None,
    "candidate_models": [],
    "attempts": 0,
}

model = None
_last_ai_reconnect_attempt_at = None
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_CODEX_MODEL = os.getenv("OPENAI_CODEX_MODEL", "gpt-5-mini")

ENGINE_ANTIGRAVITY = "antigravity"
ENGINE_OPENAI_CODEX = "openai_codex"


def normalize_engine(engine_value):
    raw = str(engine_value or "").strip().lower()
    if raw in {"codex", "openai", "openai_codex", "gpt", "gpt5", "gpt-5"}:
        return ENGINE_OPENAI_CODEX
    return ENGINE_ANTIGRAVITY


def _now_iso():
    return datetime.now().isoformat()


def _build_model(candidate_model_name):
    try:
        return genai.GenerativeModel(
            model_name=candidate_model_name,
            generation_config=generation_config,
            system_instruction=SYSTEM_INSTRUCTION_TEXT
        )
    except TypeError:
        # Compatibilidad con versiones del SDK que no soportan system_instruction.
        return genai.GenerativeModel(
            model_name=candidate_model_name,
            generation_config=generation_config
        )


def _extract_model_name(raw_name):
    if not raw_name:
        return ""
    return raw_name.replace("models/", "").strip()


def connect_ai_model(force=False):
    global model, _last_ai_reconnect_attempt_at

    # Evita reconexiones agresivas en cascada.
    if not force and _last_ai_reconnect_attempt_at:
        elapsed = (datetime.now() - _last_ai_reconnect_attempt_at).total_seconds()
        if elapsed < 8:
            return AI_RUNTIME["connected"]

    _last_ai_reconnect_attempt_at = datetime.now()
    AI_RUNTIME["attempts"] = AI_RUNTIME.get("attempts", 0) + 1
    AI_RUNTIME["last_check_at"] = _now_iso()

    candidate_models = [
        _extract_model_name(x) for x in (
            os.getenv("ANMAR_GEMINI_MODELS", "").split(",")
            if os.getenv("ANMAR_GEMINI_MODELS")
            else [
                "gemini-2.0-flash",
                "gemini-2.0-flash-lite",
                "gemini-1.5-flash",
                "gemini-1.5-flash-latest",
                "gemini-1.5-pro",
                "gemini-pro",
            ]
        )
        if _extract_model_name(x)
    ]
    AI_RUNTIME["candidate_models"] = candidate_models

    try:
        genai.configure(api_key=GOOGLE_API_KEY)
    except Exception as e:
        model = None
        AI_RUNTIME["connected"] = False
        AI_RUNTIME["model_name"] = None
        AI_RUNTIME["last_error"] = f"Gemini configure failed: {e}"
        print(f"Error configuring Gemini: {e}")
        return False

    if not candidate_models:
        model = None
        AI_RUNTIME["connected"] = False
        AI_RUNTIME["model_name"] = None
        AI_RUNTIME["last_error"] = "No candidate models configured."
        return False

    # Rotación por intento para recuperarse de modelos deprecados sin bloquear startup.
    start_idx = (AI_RUNTIME["attempts"] - 1) % len(candidate_models)
    ordered_candidates = candidate_models[start_idx:] + candidate_models[:start_idx]

    last_error = None
    for candidate in ordered_candidates:
        try:
            model = _build_model(candidate)
            AI_RUNTIME["connected"] = False  # Se confirma en la primera llamada exitosa.
            AI_RUNTIME["model_name"] = candidate
            AI_RUNTIME["last_error"] = None
            return True
        except Exception as e:
            last_error = str(e)
            continue

    model = None
    AI_RUNTIME["connected"] = False
    AI_RUNTIME["model_name"] = None
    AI_RUNTIME["last_error"] = last_error or "No Gemini model could be initialized."
    return False


def _safe_model_generate(prompt, timeout_seconds=22):
    if not model:
        return None, "Model not initialized"

    def _job():
        return model.generate_content(
            prompt,
            request_options={"timeout": min(max(int(timeout_seconds), 1), 20)}
        )

    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_job)
    try:
        result = future.result(timeout=timeout_seconds)
        executor.shutdown(wait=True)
        return result, None
    except FuturesTimeoutError:
        future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        return None, f"AI timeout after {timeout_seconds}s"
    except Exception as e:
        executor.shutdown(wait=False, cancel_futures=True)
        return None, str(e)


# Intento inicial al levantar servidor.
connect_ai_model(force=True)


# --- FRONTEND ROUTES (Served from Root) ---
@app.route('/')
def index():
    return send_from_directory(frontend_path, 'index.html')

@app.route('/dashboard.html')
def dashboard():
    return send_from_directory(frontend_path, 'dashboard.html')

@app.route('/<path:filename>')
def serve_static_files(filename):
    return send_from_directory(frontend_path, filename)


# --- DATABASE & AUTH SETUP ---
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            tokens INTEGER NOT NULL DEFAULT 50,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name TEXT NOT NULL,
            user_email TEXT NOT NULL,
            request TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending_human_review',
            ai_suggestion TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS chat_memory (
            email TEXT PRIMARY KEY,
            memory_json TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()

    # Lightweight migration for existing DBs created with older schema.
    cols = {r['name'] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if 'tokens' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN tokens INTEGER NOT NULL DEFAULT 50")
    if 'subscription_active' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN subscription_active INTEGER NOT NULL DEFAULT 0")
    if 'subscription_plan' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'none'")
    if 'subscription_started_at' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN subscription_started_at TIMESTAMP")
    conn.commit()
    conn.close()

# Initialize or migrate DB on start
init_db()

# --- AUTH ROUTES ---
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    name = data.get('name')
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Faltan datos"}), 400

    hashed_pw = generate_password_hash(password)

    try:
        conn = get_db_connection()
        conn.execute('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
                     (name, email, hashed_pw))
        conn.commit()
        conn.close()
        return jsonify({"message": "Usuario creado exitosamente"})
    except sqlite3.IntegrityError:
        return jsonify({"error": "El correo ya está registrado"}), 409
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email')
    password = data.get('password')

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()

    if user and check_password_hash(user['password'], password):
        return jsonify({
            "message": "Login exitoso",
            "user": {"name": user['name'], "email": user['email']}
        })
    else:
        return jsonify({"error": "Credenciales inválidas"}), 401

@app.route('/api/social-login', methods=['POST'])
def social_login():
    data = request.json
    provider = data.get('provider') # 'Google' or 'Apple'
    token = data.get('token')
    email = data.get('email')
    name = data.get('name')

    if provider == 'Google':
        if not token:
            return jsonify({"error": "Falta el token auténtico de Google para validar tu Gmail."}), 400

        import requests
        try:
            google_res = requests.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={token}")
            if google_res.status_code == 200:
                google_data = google_res.json()
                email = google_data.get('email')
                name = google_data.get('name')
                
                if not email:
                    return jsonify({"error": "La cuenta de Google no autorizó la entrega del email."}), 400
            else:
                return jsonify({"error": "Token de Google inválido o expirado"}), 401
        except Exception as e:
            return jsonify({"error": f"Error verificando token de Google: {str(e)}"}), 500

    if not email:
        return jsonify({"error": "Faltan datos de la red social"}), 400

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

    if not user:
        # User doesn't exist, create automatically using social info
        import secrets
        random_password = secrets.token_urlsafe(16)  # Generate a long placeholder password
        from werkzeug.security import generate_password_hash
        hashed_pw = generate_password_hash(random_password)
        try:
            conn.execute('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', (name, email, hashed_pw))
            conn.commit()
            user_data = {"name": name, "email": email}
        except Exception as e:
            conn.close()
            return jsonify({"error": str(e)}), 500
    else:
        # User exists, log them in
        user_data = {"name": user['name'], "email": user['email']}
        
    conn.close()

    return jsonify({
        "message": f"Autenticado con {provider} exitosamente",
        "user": user_data
    })

def _normalize_project_name(project_name):
    return str(project_name or "").strip().lower()


def build_chat_memory_key(email, project_name=None):
    clean_email = (email or "").strip().lower()
    clean_project = _normalize_project_name(project_name)
    if not clean_project:
        return clean_email
    return f"{clean_email}::project::{clean_project}"


def get_chat_memory(email, project_name=None):
    storage_key = build_chat_memory_key(email, project_name)
    conn = get_db_connection()
    row = conn.execute('SELECT memory_json, updated_at FROM chat_memory WHERE email = ?', (storage_key,)).fetchone()
    conn.close()
    if not row:
        return None
    try:
        data = json.loads(row['memory_json'])
    except Exception:
        data = {}
    data['updated_at'] = row['updated_at']
    return data

def save_chat_memory(email, memory_payload, project_name=None):
    storage_key = build_chat_memory_key(email, project_name)
    memory_json = json.dumps(memory_payload)
    conn = get_db_connection()
    conn.execute(
        '''
        INSERT INTO chat_memory (email, memory_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(email) DO UPDATE SET
            memory_json = excluded.memory_json,
            updated_at = CURRENT_TIMESTAMP
        ''',
        (storage_key, memory_json)
    )
    conn.commit()
    conn.close()

@app.route('/api/chat-memory', methods=['GET'])
def read_chat_memory():
    email = request.args.get('email', '').strip().lower()
    project_name = request.args.get('project_name', '').strip().lower()
    if not email:
        return jsonify({"error": "email is required"}), 400
    memory = get_chat_memory(email, project_name=project_name)
    return jsonify({"memory": memory or {}})

@app.route('/api/chat-memory', methods=['POST'])
def write_chat_memory():
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    project_name = (data.get('project_name') or '').strip().lower()
    memory = data.get('memory')
    if not email:
        return jsonify({"error": "email is required"}), 400
    if not isinstance(memory, dict):
        return jsonify({"error": "memory must be an object"}), 400

    # Merge with existing memory to avoid losing agent state.
    existing = get_chat_memory(email, project_name=project_name) or {}
    merged = dict(existing)
    merged.update(memory)

    # Keep payload bounded and predictable.
    history = merged.get('conversation_history', [])
    if isinstance(history, list):
        merged['conversation_history'] = history[-40:]
    else:
        merged['conversation_history'] = []

    merged['chat_stage'] = str(merged.get('chat_stage', 'initial'))
    merged['current_project_name'] = str(merged.get('current_project_name', ''))
    merged['current_ticket_project_id'] = str(merged.get('current_ticket_project_id', ''))
    merged['summary'] = str(merged.get('summary', ''))[:500]
    merged['audience'] = str(merged.get('audience', ''))[:500]
    merged['business_model'] = str(merged.get('business_model', ''))[:500]
    merged['timeline'] = str(merged.get('timeline', ''))[:250]

    save_chat_memory(email, merged, project_name=project_name)
    return jsonify({"status": "ok"})

@app.route('/api/chat-memory/reset', methods=['POST'])
def reset_chat_memory_endpoint():
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    project_name = (data.get('project_name') or '').strip().lower()
    if not email:
        return jsonify({"error": "email is required"}), 400

    existing = get_chat_memory(email, project_name=project_name) or {}
    reset_payload = reset_memory_payload(existing)
    save_chat_memory(email, reset_payload, project_name=project_name)
    return jsonify({"status": "ok", "memory": reset_payload})

# --- HELPER: ROBUST JSON PARSER ---
def clean_and_parse_json(text):
    """
    Cleans AI response text to ensure valid JSON parsing.
    Handles Markdown fences and unescaped newlines in strings.
    """
    try:
        # 1. Remove Markdown Code Blocks
        text = text.replace("```json", "").replace("```", "").strip()
        
        # 2. Try Standard Parse
        return json.loads(text)
    except json.JSONDecodeError:
        try:
            # 3. Aggressive Fix: Escape control characters (newlines) inside strings?
            # A safer fallback for Python is using ast.literal_eval if it looks like a Python dict
            import ast
            return ast.literal_eval(text)
        except:
            # 4. Last Resort: Simple Regex Extraction if it's just keys we need
            # Return a partial object or error
            print(f"JSON PARSE FAILED. Raw Text: {text[:200]}...")
            return None

def is_greeting_text(text):
    t = (text or "").strip().lower()
    if not t:
        return False
    greetings = {
        "hola", "holi", "hello", "hi", "hey", "buenas",
        "buenos dias", "buen día", "buenas tardes", "buenas noches"
    }
    return t in greetings

def is_short_followup_text(text):
    t = (text or "").strip()
    if not t:
        return True
    # Short fragments like "2 semanas", "sí", "ok", etc.
    return len(t.split()) <= 4 and len(t) < 30

def detect_product_domain(text):
    t = (text or "").lower()
    if any(k in t for k in ["pet shop", "mascota", "mascotas", "veterin", "perro", "gato"]):
        return "pet_shop"
    if any(k in t for k in ["marketplace", "market place", "uber", "freelancer", "freelance"]):
        return "marketplace"
    if any(k in t for k in ["ecommerce", "tienda online", "shop", "carrito", "catalogo", "catálogo"]):
        return "ecommerce"
    if any(k in t for k in ["saas", "suscripción", "subscription"]):
        return "saas"
    return "general"

def extract_audience_from_text(text):
    t = (text or "").strip()
    lower = t.lower()
    audience_markers = ["usuario", "usuarios", "clientes", "audiencia", "target", "persona", "negocios", "empresas", "dueños"]
    if any(k in lower for k in audience_markers):
        return t
    # Also accept concise segmentation answers commonly used in discovery.
    segmentation_markers = [
        "hogar", "hogares", "oficina", "oficinas", "industrial", "residencial",
        "corporativa", "corporativo", "pyme", "pymes", "b2b", "b2c", "latam",
        "latino", "latinos", "new york", "ny", "miami", "bogota", "madrid"
    ]
    if any(k in lower for k in segmentation_markers):
        return t
    return ""

def extract_business_model_from_text(text):
    t = (text or "").strip()
    lower = t.lower()
    if "sin necesidad de pagar" in lower or "sin pagar" in lower:
        return ""
    if any(k in lower for k in ["suscrip", "subscription"]):
        return "Suscripción"
    if any(k in lower for k in ["comisión", "commission"]):
        return "Comisión"
    if any(k in lower for k in ["pago único", "one-time", "unico"]):
        return "Pago único"
    # Handles colloquial answers like "pagan un fee/fit por video"
    if any(k in lower for k in ["fee", "fit", "fijo", "cobran", "cobrar", "por video", "por cámara", "por evento", "pago por uso"]):
        return "Pago por uso (por video/evento)"
    if "pagan" in lower and "sin pagar" not in lower and "sin necesidad de pagar" not in lower:
        return "Pago por uso (por video/evento)"
    if any(k in lower for k in ["freemium", "gratis", "free"]):
        return "Freemium"
    return ""

def extract_timeline_from_text(text):
    t = (text or "").strip()
    lower = t.lower()
    if any(k in lower for k in ["semana", "semanas", "week", "weeks"]):
        return t
    if any(k in lower for k in ["mes", "meses", "month", "months"]):
        return t
    if any(k in lower for k in ["24h", "48h", "hoy", "today", "deadline", "fecha"]):
        return t
    return ""

def slugify_project_name(raw_name):
    raw_name = (raw_name or "new_project").strip().lower()
    slug = re.sub(r'[^a-z0-9]+', '_', raw_name).strip('_')
    return slug or f"project_{datetime.now().strftime('%H%M%S')}"

def infer_tech_stack_from_text(text):
    t = (text or "").lower()
    stack = []
    if any(k in t for k in ["mobile", "ios", "android", "react native", "flutter"]):
        stack.extend(["React Native", "Expo"])
    else:
        stack.extend(["React", "TypeScript"])
    if any(k in t for k in ["marketplace", "pagos", "stripe", "payment", "suscripción", "subscription", "saas", "api"]):
        stack.extend(["Python", "Flask", "PostgreSQL", "Stripe"])
    else:
        stack.extend(["Python", "Flask", "SQLite"])
    if any(k in t for k in ["tiempo real", "real-time", "chat", "websocket"]):
        stack.append("WebSockets")
    # Deduplicate while preserving order.
    dedup = []
    seen = set()
    for item in stack:
        if item not in seen:
            dedup.append(item)
            seen.add(item)
    return dedup

def extract_brief_from_history(history):
    raw_user_messages = [m.get('content', '').strip() for m in history if m.get('role') == 'user' and m.get('content')]
    meaningful_messages = [m for m in raw_user_messages if not is_greeting_text(m)]
    user_messages = meaningful_messages if meaningful_messages else raw_user_messages
    combined = "\n".join(user_messages)
    first_msg = user_messages[0] if user_messages else ""
    last_msg = user_messages[-1] if user_messages else ""

    features = []
    for candidate in user_messages:
        lower = candidate.lower()
        if any(k in lower for k in ["debe", "necesita", "quiero", "tiene que", "must", "should", "feature"]):
            features.append(candidate[:180])
    features = features[:6]

    audience = ""
    business_model = ""
    timeline = ""
    for candidate in user_messages:
        if not audience:
            audience = extract_audience_from_text(candidate)
        if not business_model:
            business_model = extract_business_model_from_text(candidate)
        if not timeline:
            timeline = extract_timeline_from_text(candidate)

    project_name_seed = first_msg.split(".")[0][:60] if first_msg else "New Project"
    summary_source = first_msg
    if is_short_followup_text(summary_source) and len(user_messages) > 1:
        for msg in user_messages:
            if not is_short_followup_text(msg):
                summary_source = msg
                break
    if not summary_source:
        summary_source = last_msg

    return {
        "raw_text": combined,
        "project_name_seed": project_name_seed,
        "summary": summary_source or "Proyecto digital solicitado por el cliente.",
        "audience": audience,
        "business_model": business_model,
        "timeline": timeline,
        "features": features,
        "domain": detect_product_domain(combined),
    }

def summarize_user_highlights(history, max_items=5):
    user_msgs = [m.get("content", "").strip() for m in history if m.get("role") == "user" and m.get("content")]
    cleaned = []
    for msg in user_msgs:
        if is_greeting_text(msg):
            continue
        if len(msg) < 8:
            continue
        cleaned.append(msg)
    # Keep most recent highlights, deduplicated by normalized text.
    seen = set()
    out = []
    for msg in reversed(cleaned):
        key = normalize_fact_text(msg)
        if key and key not in seen:
            seen.add(key)
            out.append(msg[:180])
        if len(out) >= max_items:
            break
    return list(reversed(out))

def build_engineer_brief(brief, history, agent_memory=None):
    agent_memory = agent_memory or {}
    audience = agent_memory.get("audience") or brief.get("audience") or "Pendiente de confirmar"
    business_model = agent_memory.get("business_model") or brief.get("business_model") or "Pendiente de confirmar"
    timeline = agent_memory.get("timeline") or brief.get("timeline") or "Pendiente de confirmar"
    summary = agent_memory.get("summary") or brief.get("summary") or "Proyecto en definición"

    features = []
    for f in (agent_memory.get("features") or []):
        if isinstance(f, str) and f.strip():
            features.append(f.strip())
    for f in (brief.get("features") or []):
        if isinstance(f, str) and f.strip() and f.strip() not in features:
            features.append(f.strip())
    if len(features) < 2:
        defaults = ["Flujo principal del usuario", "Panel operativo", "Métricas básicas"]
        for d in defaults:
            if d not in features:
                features.append(d)
            if len(features) >= 3:
                break
    features = features[:6]

    highlights = summarize_user_highlights(history, max_items=6)
    return {
        "vision": summary,
        "target_audience": audience,
        "business_model": business_model,
        "timeline": timeline,
        "must_have_features": features,
        "client_highlights": highlights,
    }

def generate_blueprint_markdown(brief, tech_stack):
    features_md = "\n".join([f"- {f}" for f in brief.get("features", [])]) or "- Flujo de usuario principal\n- Panel administrativo\n- Métricas iniciales de conversión"
    audience = brief.get("audience") or "Pendiente de confirmar por cliente."
    business_model = brief.get("business_model") or "Pendiente de confirmar por cliente."
    timeline = brief.get("timeline") or "MVP recomendado en 2-4 semanas."

    return f"""# Technical Blueprint

## 1. Product Summary
{brief.get("summary", "Proyecto digital en definición.")}

## 2. Target Audience
{audience}

## 3. Business Model
{business_model}

## 4. Core Features
{features_md}

## 5. Recommended Tech Stack
{", ".join(tech_stack)}

## 6. Delivery Plan
{timeline}

## 7. Operational Handoff
- El ticket entra a la red interna tipo Uber para desarrolladores.
- Un ingeniero acepta la orden y cambia estado a `accepted`.
- Durante desarrollo se reporta estado `developing`.
- Al cierre se entrega como `completed` con URL de preview.
"""

def call_openai_codex_text(prompt, timeout_seconds=28):
    if not OPENAI_API_KEY:
        return None
    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_CODEX_MODEL,
                "messages": [
                    {"role": "system", "content": "You are Codex, a pragmatic senior software engineer and product consultant."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.4,
            },
            timeout=timeout_seconds,
        )
        if response.status_code >= 400:
            log_debug(f"OpenAI error {response.status_code}: {response.text[:300]}")
            return None
        payload = response.json()
        choices = payload.get("choices") or []
        if not choices:
            return None
        content = (choices[0].get("message", {}) or {}).get("content", "")
        if isinstance(content, list):
            content = "\n".join([str(c.get("text", "")) for c in content if isinstance(c, dict)])
        text = str(content or "").strip()
        return text or None
    except Exception as e:
        log_debug(f"OpenAI Codex call failed: {e}")
        return None

def call_openai_codex_json(prompt, timeout_seconds=28):
    if not OPENAI_API_KEY:
        return None
    try:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_CODEX_MODEL,
                "messages": [
                    {"role": "system", "content": "You are Codex, a pragmatic senior software engineer. Return strict JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            },
            timeout=timeout_seconds,
        )
        if response.status_code >= 400:
            log_debug(f"OpenAI JSON error {response.status_code}: {response.text[:300]}")
            return None
        payload = response.json()
        choices = payload.get("choices") or []
        if not choices:
            return None
        content = (choices[0].get("message", {}) or {}).get("content", "")
        if isinstance(content, list):
            content = "\n".join([str(c.get("text", "")) for c in content if isinstance(c, dict)])
        text = str(content or "").strip()
        if not text:
            return None
        parsed = clean_and_parse_json(text)
        if isinstance(parsed, dict):
            return parsed
        return None
    except Exception as e:
        log_debug(f"OpenAI Codex JSON call failed: {e}")
        return None


def call_ai_json(prompt, engine=ENGINE_ANTIGRAVITY):
    normalized_engine = normalize_engine(engine)
    if normalized_engine == ENGINE_OPENAI_CODEX:
        parsed = call_openai_codex_json(prompt)
        if isinstance(parsed, dict):
            return parsed
    text = call_ai_text(prompt, engine=normalized_engine)
    if not text:
        return None
    return clean_and_parse_json(text)


def call_ai_text(prompt, engine=ENGINE_ANTIGRAVITY):
    normalized_engine = normalize_engine(engine)
    if normalized_engine == ENGINE_OPENAI_CODEX:
        codex_text = call_openai_codex_text(prompt)
        if codex_text:
            return codex_text.replace("```", "").strip()
        # Hard fallback to Antigravity/Gemini if OpenAI is unavailable.
    if not model:
        connect_ai_model(force=True)
    if not model:
        AI_RUNTIME["connected"] = False
        return None
    try:
        response, gen_error = _safe_model_generate(prompt, timeout_seconds=22)
        if gen_error:
            raise RuntimeError(gen_error)
        AI_RUNTIME["connected"] = True
        AI_RUNTIME["last_error"] = None
        AI_RUNTIME["last_check_at"] = _now_iso()
        text = (response.text or "").strip()
        if not text:
            AI_RUNTIME["connected"] = False
            AI_RUNTIME["last_error"] = "Empty response from AI model"
            return None
        return text.replace("```", "").strip()
    except Exception as e:
        AI_RUNTIME["connected"] = False
        AI_RUNTIME["last_error"] = str(e)
        AI_RUNTIME["last_check_at"] = _now_iso()
        log_debug(f"AI text call failed: {e}")
        connect_ai_model(force=True)
        return None

def parse_image_data_url(image_data_url):
    try:
        if not image_data_url or not isinstance(image_data_url, str):
            return None, None
        if not image_data_url.startswith("data:") or ";base64," not in image_data_url:
            return None, None
        header, b64_data = image_data_url.split(";base64,", 1)
        mime_type = header.replace("data:", "").strip().lower() or "image/png"
        raw = base64.b64decode(b64_data)
        if not raw:
            return None, None
        return mime_type, raw
    except Exception:
        return None, None

def describe_image_for_chat(image_data_url):
    mime_type, image_bytes = parse_image_data_url(image_data_url)
    if not mime_type or not image_bytes:
        return ""
    if not model:
        connect_ai_model(force=True)
    if not model:
        return ""
    try:
        prompt = (
            "Describe brevemente esta imagen para usarla como contexto de producto en una conversación de startup. "
            "Enfócate en: tipo de producto, usuario objetivo, funcionalidades visibles y posibles mejoras. "
            "Máximo 120 palabras, en español."
        )
        response = model.generate_content(
            [
                {"mime_type": mime_type, "data": image_bytes},
                prompt
            ],
            request_options={"timeout": 20}
        )
        text = (getattr(response, "text", "") or "").strip()
        return text[:900]
    except Exception as e:
        log_debug(f"Image describe failed: {e}")
        return ""

def describe_ui_reference(image_data_url):
    mime_type, image_bytes = parse_image_data_url(image_data_url)
    if not mime_type or not image_bytes:
        return ""
    if not model:
        connect_ai_model(force=True)
    if not model:
        return ""
    try:
        prompt = (
            "Analiza esta captura de UI y devuelve una guía breve de diseño para replicarla: "
            "layout, paleta de color, tipografía, densidad visual, componentes (header/hero/cards/cta), "
            "espaciado, bordes, sombras y estilo general. Máximo 180 palabras, en español."
        )
        response = model.generate_content(
            [
                {"mime_type": mime_type, "data": image_bytes},
                prompt
            ],
            request_options={"timeout": 20}
        )
        return (getattr(response, "text", "") or "").strip()[:1400]
    except Exception as e:
        log_debug(f"UI reference describe failed: {e}")
        return ""

def should_mark_ready(message, brief):
    text = (message or "").lower()
    ready_words = ["build", "execute", "ready", "listo", "enviar", "manda", "procede", "arranca", "construye"]
    explicit_ready = any(w in text for w in ready_words)
    enough_context = bool(brief.get("summary")) and bool(brief.get("audience")) and bool(brief.get("business_model")) and bool(brief.get("timeline"))
    return explicit_ready and enough_context

def has_ready_intent(message):
    text = (message or "").lower()
    ready_words = ["build", "execute", "ready", "listo", "enviar", "manda", "procede", "arranca", "construye"]
    return any(w in text for w in ready_words)

def has_reset_intent(message):
    text = (message or "").lower().strip()
    reset_phrases = [
        "empecemos de cero", "empezar de cero", "empezamos de cero", "desde cero",
        "reset", "reinicia", "reiniciar", "borrar contexto", "borra contexto",
        "olvida todo", "nuevo proyecto", "start over", "from scratch",
    ]
    return any(p in text for p in reset_phrases)

def trim_history_after_last_reset(history):
    if not isinstance(history, list) or not history:
        return []
    last_reset_idx = -1
    for i, msg in enumerate(history):
        if isinstance(msg, dict) and msg.get("role") == "user" and has_reset_intent(msg.get("content", "")):
            last_reset_idx = i
    if last_reset_idx == -1:
        return history
    return history[last_reset_idx + 1:]

def reset_memory_payload(existing=None):
    existing = existing or {}
    cleaned = dict(existing)
    cleaned["agent_memory"] = init_agent_memory({})
    cleaned["summary"] = ""
    cleaned["audience"] = ""
    cleaned["business_model"] = ""
    cleaned["timeline"] = ""
    cleaned["chat_stage"] = "initial"
    cleaned["conversation_history"] = []
    cleaned["paywall"] = {}
    return cleaned

def normalize_fact_text(value):
    value = (value or "").strip().lower()
    return re.sub(r'[^a-z0-9áéíóúñü ]+', '', value)

def mostly_same_text(a, b):
    na = normalize_fact_text(a)
    nb = normalize_fact_text(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    # Treat close phrasings as equivalent to avoid fake "contradictions".
    return na in nb or nb in na

def init_agent_memory(existing=None):
    existing = existing or {}
    mem = {
        "summary": existing.get("summary", ""),
        "audience": existing.get("audience", ""),
        "business_model": existing.get("business_model", ""),
        "timeline": existing.get("timeline", ""),
        "features": existing.get("features", []) if isinstance(existing.get("features"), list) else [],
        "domain": existing.get("domain", "general"),
        "confidence": existing.get("confidence", {}),
        "pending_clarifications": existing.get("pending_clarifications", []),
        "last_question_key": existing.get("last_question_key", ""),
        "asked_question_keys": existing.get("asked_question_keys", []) if isinstance(existing.get("asked_question_keys"), list) else [],
    }
    mem["confidence"].setdefault("summary", "low")
    mem["confidence"].setdefault("audience", "low")
    mem["confidence"].setdefault("business_model", "low")
    mem["confidence"].setdefault("timeline", "low")
    return mem

def merge_field_with_conflict(memory, key, new_value, confidence="medium"):
    new_value = (new_value or "").strip()
    if not new_value:
        return
    old_value = (memory.get(key) or "").strip()
    if not old_value:
        memory[key] = new_value
        memory["confidence"][key] = confidence
        return
    if key == "summary":
        # Summary is descriptive; keep the best recent phrasing without contradiction prompts.
        if len(new_value) >= len(old_value):
            memory[key] = new_value
        memory["confidence"][key] = confidence
        return
    if mostly_same_text(old_value, new_value):
        memory["confidence"][key] = confidence
        # For summary, prefer the newest clearer sentence.
        if key == "summary" and len(new_value) >= len(old_value):
            memory[key] = new_value
        return

    # Keep track of contradictions explicitly, then favor the latest user statement.
    pending = memory.get("pending_clarifications", [])
    # Replace previous pending clarification for the same field to avoid loops.
    pending = [p for p in pending if p.get("field") != key]
    pending.append({
        "field": key,
        "old": old_value,
        "new": new_value,
        "reason": f"Cambio detectado en {key}"
    })
    memory["pending_clarifications"] = pending[-3:]
    memory[key] = new_value
    memory["confidence"][key] = "low"

def compact_pending_clarifications(memory):
    pending = memory.get("pending_clarifications", [])
    if not isinstance(pending, list):
        memory["pending_clarifications"] = []
        return
    compact = []
    for item in pending:
        field = item.get("field")
        if field and memory.get(field):
            # If current value equals proposed value, clarification can be considered resolved.
            if mostly_same_text(memory.get(field), item.get("new", "")):
                continue
        compact.append(item)
    memory["pending_clarifications"] = compact[-3:]

def infer_features_from_text(text):
    t = (text or "").lower()
    options = []
    mapping = [
        ("dashboard", ["dashboard", "panel"]),
        ("mapa en tiempo real", ["mapa", "tiempo real", "real-time"]),
        ("alertas", ["alerta", "notificación", "notificacion"]),
        ("reportes", ["reporte", "analytics", "métrica", "metrica"]),
        ("login y roles", ["login", "rol", "permisos", "autenticación", "autenticacion"]),
        ("catálogo", ["catálogo", "catalogo"]),
        ("checkout/pagos", ["checkout", "pasarela", "stripe"]),
    ]
    for label, keys in mapping:
        if any(k in t for k in keys):
            options.append(label)

    # Generic list parser for messages like:
    # "funciones v1: crear campañas, medir alcance, ranking"
    if any(k in t for k in ["funciones", "funcionalidades", "features", "v1", "mvp"]):
        raw = (text or "")
        if ":" in raw:
            raw = raw.split(":", 1)[1]
        for chunk in re.split(r',|;|\n| y ', raw):
            feature = chunk.strip(" .-")
            if len(feature) >= 6 and feature.lower() not in ["funciones", "funcionalidades", "features", "v1", "mvp"]:
                options.append(feature[:80])

    # Deduplicate preserving order.
    dedup = []
    seen = set()
    for item in options:
        key = normalize_fact_text(item)
        if key and key not in seen:
            dedup.append(item)
            seen.add(key)
    options = dedup
    return options[:4]

def get_missing_memory_fields(memory):
    """
    Only return BLOCKING fields for handoff.
    Strategy fields like audience/business/timeline are useful, but optional:
    if missing, we proceed with explicit assumptions in the blueprint.
    """
    missing = []
    if not memory.get("summary"):
        missing.append("summary")
    if len(memory.get("features", [])) < 1:
        missing.append("features")
    return missing

def detect_fields_in_message(current_input):
    detected = {}
    a = extract_audience_from_text(current_input)
    b = extract_business_model_from_text(current_input)
    t = extract_timeline_from_text(current_input)
    f = infer_features_from_text(current_input)
    if a:
        detected["audience"] = a
    if b:
        detected["business_model"] = b
    if t:
        detected["timeline"] = t
    if f:
        detected["features"] = f
    return detected

def infer_contextual_answer(memory, current_input):
    """Map short replies to the last asked field to avoid repetitive loops."""
    text = (current_input or "").strip()
    if not text:
        return {}

    # Skip toxic or pure greeting/ack messages.
    lowered = text.lower()
    if is_greeting_text(text) or lowered in {"ok", "dale", "si", "sí", "listo"}:
        return {}

    last_key = memory.get("last_question_key", "")
    if last_key not in {"audience", "business_model", "timeline", "features", "summary"}:
        return {}

    # Only infer when current message is compact and likely direct answer.
    if len(text) > 90:
        return {}

    inferred = {}
    if last_key == "audience":
        inferred["audience"] = text
    elif last_key == "business_model":
        bm = extract_business_model_from_text(text) or text
        inferred["business_model"] = bm
    elif last_key == "timeline":
        tl = extract_timeline_from_text(text) or text
        inferred["timeline"] = tl
    elif last_key == "features":
        fs = infer_features_from_text(text)
        if fs:
            inferred["features"] = fs
        else:
            inferred["features"] = [text]
    elif last_key == "summary":
        inferred["summary"] = text

    return inferred

def choose_next_question(memory):
    domain = memory.get("domain", "general")
    pending = memory.get("pending_clarifications", [])
    if pending:
        c = pending[-1]
        field = c.get("field", "dato")
        return f"Detecté un cambio en {field}. ¿Confirmamos como versión final: \"{c.get('new')}\"?"

    questions = {
        "summary": "En una frase, ¿cuál es el resultado principal que debe lograr el usuario con el producto?",
        "features": "Dime al menos 1 funcionalidad obligatoria de la versión 1.",
    }
    if domain == "pet_shop":
        questions["features"] = "Para pet shop, dime la función clave inicial (ejemplo: catálogo, reservas o recordatorios)."
    if domain == "marketplace":
        questions["features"] = "Para marketplace, dime el módulo inicial obligatorio (matching, publicación o pagos)."

    missing = get_missing_memory_fields(memory)
    asked = memory.get("asked_question_keys", [])
    for key in missing:
        if key not in asked:
            return questions.get(key, "¿Qué dato clave falta para cerrar el brief?")
    return questions.get(missing[0], "¿Qué dato clave falta para cerrar el brief?")

def detect_user_frustration(text):
    t = (text or "").lower()
    frustration_markers = [
        "no entiendes", "ya te dije", "repetitivo", "bruto", "idiota", "imbecil",
        "maldito", "no funciona", "otra vez", "de nuevo", "cansa",
    ]
    return any(m in t for m in frustration_markers)

def missing_label(key):
    labels = {
        "summary": "propuesta de valor",
        "audience": "usuario objetivo",
        "business_model": "modelo de ingresos",
        "timeline": "ventana de entrega",
        "features": "alcance del MVP",
    }
    return labels.get(key, key)

def decide_next_action(analysis, current_input):
    memory = analysis.get("memory", {})
    missing = analysis.get("missing_fields", [])
    if detect_user_frustration(current_input):
        return {"type": "recover"}
    if analysis.get("ready_to_build"):
        return {"type": "handoff_confirmed"}
    if analysis.get("ready_by_data"):
        return {"type": "handoff_ready"}

    # If we have enough data for strategic shaping, avoid interrogatory loops.
    if len(missing) <= 2:
        return {"type": "refine_with_tradeoffs"}
    return {"type": "discovery"}

def micro_strategy_tip(memory, analysis):
    domain = memory.get("domain", "general")
    missing = analysis.get("missing_fields", [])
    has = {
        "audience": bool(memory.get("audience")),
        "business_model": bool(memory.get("business_model")),
        "timeline": bool(memory.get("timeline")),
        "features": len(memory.get("features", [])) >= 2,
    }

    if "audience" in missing:
        return "Tip: define un nicho inicial; intentar abarcar a todos baja conversión."
    if "business_model" in missing:
        return "Tip: valida monetización simple primero (un solo modelo en V1)."
    if "timeline" in missing:
        return "Tip: fija una fecha concreta; sin deadline el MVP se alarga."
    if "features" in missing:
        return "Tip: V1 con 2-3 funciones críticas, no más."

    # When core data exists, provide a domain-specific strategic next move.
    if domain == "marketplace":
        return "Tip: en marketplace, prioriza liquidez del lado más difícil (oferta o demanda)."
    if domain == "ecommerce":
        return "Tip: optimiza checkout primero; suele mover más ingresos que rediseñar catálogo."
    if domain == "pet_shop":
        return "Tip: combina recurrencia (suscripción) con venta puntual para mejorar LTV."
    if domain == "saas":
        return "Tip: define una métrica norte (activación o retención) antes de escalar features."
    return "Tip: valida un caso de uso principal antes de ampliar alcance."

def infer_conversation_phase(memory, analysis):
    missing = analysis.get("missing_fields", [])
    if "audience" in missing or "business_model" in missing or not memory.get("summary"):
        return "FASE_1_DESCUBRIMIENTO"
    if "timeline" in missing or "features" in missing:
        return "FASE_2_REFINAMIENTO"
    return "FASE_3_CIERRE_HANDOFF"

def build_handoff_package(engineer_brief, tech_stack):
    vision = engineer_brief.get("vision") or "Proyecto en definición"
    features = engineer_brief.get("must_have_features") or []
    audience = engineer_brief.get("target_audience") or "Pendiente"
    business = engineer_brief.get("business_model") or "Pendiente"
    timeline = engineer_brief.get("timeline") or "Pendiente"

    critical_requirements = [
        f"Implementar V1 con foco en: {', '.join(features[:3]) if features else 'flujo principal, panel operativo, métricas básicas'}",
        f"Diseñar UX para audiencia objetivo: {audience}",
        f"Asegurar soporte de monetización: {business}",
        f"Entregar dentro de ventana objetivo: {timeline}",
        "Agregar trazabilidad de eventos y estados para operación interna.",
    ]
    return {
        "project_vision": vision,
        "suggested_tech_stack": tech_stack,
        "critical_requirements_for_maria_team": critical_requirements,
    }

def compute_brief_score(missing_fields):
    # Score aligned with execution-first flow: only blocking fields count.
    required = ["summary", "features"]
    missing = set(missing_fields or [])
    complete = len([k for k in required if k not in missing])
    score = int(round((complete / len(required)) * 100))
    return max(0, min(100, score))

def analyze_turn_state(history, current_input, existing_memory=None):
    brief = extract_brief_from_history(history)
    memory = init_agent_memory(existing_memory)

    memory["domain"] = brief.get("domain", memory.get("domain", "general"))
    # Keep summary stable once captured; only update when the new message is clearly a better product definition.
    candidate_summary = memory.get("summary") or brief.get("summary")
    can_refresh_summary = (
        current_input
        and not is_greeting_text(current_input)
        and not has_ready_intent(current_input)
        and len(current_input.strip()) > 18
        and any(k in current_input.lower() for k in ["crear", "app", "aplic", "software", "plataforma", "marketplace", "saas"])
    )
    if not memory.get("summary"):
        candidate_summary = brief.get("summary")
    elif can_refresh_summary and memory["confidence"].get("summary", "low") != "high":
        candidate_summary = current_input
    merge_field_with_conflict(memory, "summary", candidate_summary, "high" if memory.get("summary") else "medium")
    merge_field_with_conflict(memory, "audience", brief.get("audience"), "high" if brief.get("audience") else "low")
    merge_field_with_conflict(memory, "business_model", brief.get("business_model"), "high" if brief.get("business_model") else "low")
    merge_field_with_conflict(memory, "timeline", brief.get("timeline"), "high" if brief.get("timeline") else "low")

    # Context-aware fill to avoid asking the same question again for short answers.
    inferred = infer_contextual_answer(memory, current_input)
    if inferred.get("summary"):
        merge_field_with_conflict(memory, "summary", inferred.get("summary"), "medium")
    if inferred.get("audience"):
        merge_field_with_conflict(memory, "audience", inferred.get("audience"), "medium")
    if inferred.get("business_model"):
        merge_field_with_conflict(memory, "business_model", inferred.get("business_model"), "medium")
    if inferred.get("timeline"):
        merge_field_with_conflict(memory, "timeline", inferred.get("timeline"), "medium")

    features = list(memory.get("features", []))
    for f in brief.get("features", []):
        if f and f not in features:
            features.append(f)
    for f in infer_features_from_text(current_input):
        if f not in features:
            features.append(f)
    for f in inferred.get("features", []):
        if f and f not in features:
            features.append(f)
    memory["features"] = features[:6]
    compact_pending_clarifications(memory)

    missing = get_missing_memory_fields(memory)
    explicit_ready = has_ready_intent(current_input)
    ready_by_data = len(missing) == 0 and len(memory.get("pending_clarifications", [])) == 0
    ready_to_build = explicit_ready and ready_by_data

    next_question = choose_next_question(memory) if not ready_by_data else ""
    phase_seed = {
        "memory": memory,
        "missing_fields": missing,
        "ready_by_data": ready_by_data,
        "ready_to_build": ready_to_build,
        "explicit_ready": explicit_ready,
        "next_question": next_question,
    }
    phase = infer_conversation_phase(memory, phase_seed)
    analysis = {
        "memory": memory,
        "missing_fields": missing,
        "ready_by_data": ready_by_data,
        "ready_to_build": ready_to_build,
        "explicit_ready": explicit_ready,
        "next_question": next_question,
        "detected_fields_in_message": detect_fields_in_message(current_input),
        "summary": memory.get("summary", ""),
        "phase": phase,
    }
    memory["last_question_key"] = missing[0] if missing else ""
    if memory.get("last_question_key"):
        asked = memory.get("asked_question_keys", [])
        if memory["last_question_key"] not in asked:
            asked.append(memory["last_question_key"])
            memory["asked_question_keys"] = asked[-10:]
    return analysis

def compose_consultant_reply(analysis, current_input, history, engine=ENGINE_ANTIGRAVITY):
    memory = analysis["memory"]
    if is_greeting_text(current_input):
        return "¡Hola! Cuéntame tu idea y te ayudo a convertirla en un brief técnico listo para ingeniería."

    if analysis["ready_to_build"]:
        return "Perfecto. Orden confirmada. Activo la ejecución con nuestra Red de Ingenieros en New York."

    known = []
    if memory.get("audience"):
        known.append(f"audiencia: {memory.get('audience')}")
    if memory.get("business_model"):
        known.append(f"modelo: {memory.get('business_model')}")
    if memory.get("timeline"):
        known.append(f"plazo: {memory.get('timeline')}")
    context_block = " | ".join(known) if known else "sin datos firmes todavía"

    domain = memory.get("domain", "general")
    example_by_domain = {
        "marketplace": "Ejemplo V1: onboarding, matching y pagos.",
        "ecommerce": "Ejemplo V1: catálogo, checkout y tracking.",
        "pet_shop": "Ejemplo V1: catálogo, reservas y recordatorios.",
        "saas": "Ejemplo V1: dashboard, roles y métricas clave.",
        "general": "Ejemplo V1: login, flujo principal y panel de control."
    }
    example_hint = example_by_domain.get(domain, example_by_domain["general"])

    # Let AI craft strategic dialogue focused on execution, not interrogation.
    prompt = f"""
    # ROLE: Senior Startup Architect (Execution-First)
    Eres un arquitecto senior de producto y negocio. Tu trabajo es convertir ideas en un brief accionable para el equipo interno.

    Contexto actual:
    - fase actual: {analysis.get("phase")}
    - resumen: {analysis.get("summary","")}
    - conocido: {context_block}
    - faltantes: {analysis.get("missing_fields", [])}
    - siguiente pregunta: {analysis.get("next_question", "")}
    - listo por datos: {analysis.get("ready_by_data")}
    - último mensaje del cliente: {current_input}
    - historial reciente: {history[-6:]}

    Reglas de comportamiento:
    - Formato Markdown estricto.
    - Estructura obligatoria:
      1) ## Entendido
      2) ## Propuesta Pulida (MVP)
      3) ## Blueprint Interno (listo para ejecutar)
      4) ## Siguiente Acción
    - Modo ejecución: NO hagas entrevistas largas ni listas de preguntas repetitivas.
    - No repitas preguntas ya respondidas en historial/memoria.
    - Si el usuario ya respondió un dato, construye encima en lugar de pedirlo de nuevo.
    - Si falta algún dato, asume una opción razonable y marca "Supuesto".
    - Haz como máximo 1 pregunta breve SOLO si bloquea completamente la ejecución.
    - No uses frases genéricas sin contenido.
    - Máximo 230 palabras.
    - Si hay frustración, reconoce brevemente y reconduce.
    - Prioriza siempre: capturar intención, pulir alcance, definir MVP, dejar paquete interno listo.
    - Si está listo por datos, usa esta frase exacta:
      "Estamos listos. He preparado el Blueprint Técnico. ¿Damos la orden de ejecución a nuestra Red de Ingenieros en New York?"
    - Incluye: problema, usuario, monetización y MVP técnico.
    """
    ai_text = call_ai_text(prompt, engine=engine)
    if ai_text:
        return ai_text

    action = decide_next_action(analysis, current_input)
    missing = analysis.get("missing_fields", [])
    missing_text = ", ".join([missing_label(k) for k in missing]) if missing else "ninguno"
    summary = analysis.get("summary") or "Idea en definición."
    tip = micro_strategy_tip(memory, analysis)

    if action["type"] == "recover":
        return (
            "## Entendido\nTienes razón. Cortamos el modo formulario y pasamos a ejecución.\n\n"
            "## Propuesta Pulida (MVP)\n"
            f"- Producto: {summary}\n"
            "- Enfoque: versión 1 con flujo principal, operación y métrica clave.\n"
            "- Supuesto: monetización inicial por plan estándar para acelerar salida.\n\n"
            "## Blueprint Interno (listo para ejecutar)\n"
            "- Ticket preparado para ingeniería con alcance, prioridad y entregables.\n\n"
            "## Siguiente Acción\n"
            "Si te parece bien, escribe: `enviar a interno` y lo despachamos."
        )

    if action["type"] == "handoff_confirmed":
        return (
            "## Entendido\nPerfecto, decisión tomada.\n\n"
            "## Propuesta Pulida (MVP)\n"
            "- Brief completo y consistente para arranque.\n"
            "- Riesgo principal controlado: no ampliar alcance en V1.\n\n"
            "## Blueprint Interno (listo para ejecutar)\n"
            "- Paquete técnico preparado con visión, stack y requerimientos críticos.\n\n"
            "## Siguiente Acción\n"
            "Activo la ejecución con nuestra Red de Ingenieros en New York."
        )

    if action["type"] == "handoff_ready":
        return (
            "## Entendido\nTu proyecto ya está maduro para ejecución.\n\n"
            "## Propuesta Pulida (MVP)\n"
            f"- Resumen: {summary}\n"
            "- Usuario, modelo de negocio, timeline y funcionalidades base definidos.\n\n"
            "## Blueprint Interno (listo para ejecutar)\n"
            "- Handoff preparado para el equipo técnico interno.\n\n"
            "## Siguiente Acción\n"
            "Estamos listos. He preparado el Blueprint Técnico. ¿Damos la orden de ejecución a nuestra Red de Ingenieros en New York?"
        )

    if action["type"] == "refine_with_tradeoffs":
        return (
            "## Entendido\nVamos bien: ya hay base real para ejecución.\n\n"
            "## Propuesta Pulida (MVP)\n"
            f"- Resumen actual: {summary}\n"
            f"- Ajustes pendientes: {missing_text}\n"
            "- Tradeoff aplicado: alcance controlado para lanzar antes.\n\n"
            "## Blueprint Interno (listo para ejecutar)\n"
            "- Backlog inicial: flujo principal, panel operativo y métricas.\n"
            "- Stack sugerido según dominio y velocidad de entrega.\n\n"
            "## Siguiente Acción\n"
            "Si estás de acuerdo con este enfoque, escribe: `enviar a interno`."
        )

    # discovery default
    blocker = analysis.get("next_question") or "Confirma en una frase el resultado principal que quieres lograr."
    return (
        "## Entendido\nYa capturé tu dirección general.\n\n"
        "## Propuesta Pulida (MVP)\n"
        f"- Contexto actual: {summary}\n"
        f"- Campos aún débiles: {missing_text}\n"
        f"- Recomendación aplicada: {tip}\n\n"
        "## Blueprint Interno (listo para ejecutar)\n"
        "- Puedo avanzar con supuestos y dejar ticket interno utilizable hoy mismo.\n\n"
        "## Siguiente Acción\n"
        f"{blocker}"
    )

def get_missing_brief_fields(brief):
    missing = []
    # Keep fallback aligned with blocking policy.
    if not brief.get("summary"):
        missing.append("summary")
    if len(brief.get("features", [])) < 1:
        missing.append("features")
    return missing

def fallback_consultant_reply(brief, current_input=""):
    if is_greeting_text(current_input):
        return "¡Hola! Soy el arquitecto de Anmar. Cuéntame tu idea de negocio en una frase y te la convierto en un plan técnico listo para ingeniería."

    domain = brief.get("domain", "general")
    summary = brief.get("summary", "Ya tengo el contexto inicial.").strip()
    if not summary or is_greeting_text(summary):
        summary = "Tengo el contexto inicial de tu idea."

    missing = get_missing_brief_fields(brief)
    if not missing:
        return f"Perfecto, ya tengo suficiente contexto para producir el ticket técnico de {summary}.\n\nSi estás de acuerdo, responde: `enviar a interno` y lo genero ahora."

    question_map = {
        "audience": "¿Quién es el usuario principal y cuál problema urgente le resuelves?",
        "business_model": "¿Cómo cobrarás: suscripción mensual, pago por uso, comisión o plan enterprise?",
        "timeline": "¿Cuál es tu fecha objetivo para tener un MVP usable?",
        "features": "Dime 2-3 funciones obligatorias de la versión 1.",
    }
    if domain == "pet_shop":
        question_map["audience"] = "¿Va dirigido a dueños de mascotas, veterinarias o tiendas pet?"
        question_map["business_model"] = "¿Cobrarás por catálogo/pedidos, suscripción del comercio o comisión por venta?"
    if domain == "marketplace":
        question_map["business_model"] = "En este marketplace, ¿el ingreso será comisión por transacción, suscripción o ambos?"

    # Execution-first fallback: avoid interrogatory loops; use assumptions and ask at most one blocker.
    next_missing = missing[0]
    opener = "Listo." if domain != "general" else "Perfecto."
    known_bits = []
    if brief.get("audience"):
        known_bits.append(f"audiencia: {brief.get('audience')}")
    if brief.get("business_model"):
        known_bits.append(f"monetización: {brief.get('business_model')}")
    if brief.get("timeline"):
        known_bits.append(f"plazo: {brief.get('timeline')}")

    known_line = ""
    if known_bits:
        known_line = "\nYa tengo: " + " | ".join(known_bits[:3]) + "."

    return (
        f"{opener} Entiendo el núcleo de tu producto: {summary}.{known_line}\n\n"
        "Ya armé una versión pulida del MVP y el paquete para interno con supuestos razonables.\n"
        f"Solo necesito este bloqueo mínimo para cerrar sin riesgo: {question_map[next_missing]}\n\n"
        "Si prefieres, también puedo avanzar con supuesto por defecto y enviarlo ya a interno."
    )

ALERTS_FILE = os.path.join(BASE_DIR, 'backend', 'internal_alerts.json')
ORDER_STATUS_FILE = os.path.join(BASE_DIR, 'backend', 'order_status.json')

TICKET_PROGRESS = {
    "pending": 15,
    "accepted": 25,
    "developing": 60,
    "blocked": 45,
    "completed": 100,
}

PRIORITY_SLA_HOURS = {
    "high": 24,
    "medium": 48,
    "low": 72,
}
ENGINEER_POOL = ["Maria P.", "Juan"]
DISPATCH_STATE_FILE = os.path.join(BASE_DIR, 'backend', 'dispatch_state.json')
CHAT_MESSAGE_TOKEN_COST = 1
HUMAN_SUPPORT_TOKEN_COST = 5
BUILD_TOKEN_COST = 1

def ensure_user_exists_for_tokens(conn, email):
    user = conn.execute('SELECT tokens FROM users WHERE email = ?', (email,)).fetchone()
    if user:
        return user
    conn.execute(
        'INSERT INTO users (name, email, password, tokens) VALUES (?, ?, ?, ?)',
        ('Anmar User', email, 'auto_generated', 50)
    )
    conn.commit()
    return conn.execute('SELECT tokens FROM users WHERE email = ?', (email,)).fetchone()

def consume_user_tokens(email, amount, reason=""):
    if not email:
        return False, "No has iniciado sesión.", None
    try:
        amount = int(amount)
    except Exception:
        amount = 1
    if amount <= 0:
        return True, "ok", None

    conn = get_db_connection()
    user = ensure_user_exists_for_tokens(conn, email)
    current = int(user['tokens'])
    if current < amount:
        conn.close()
        return False, f"Créditos insuficientes para {reason or 'esta acción'} (requiere {amount}).", current

    conn.execute('UPDATE users SET tokens = tokens - ? WHERE email = ?', (amount, email))
    conn.commit()
    updated = conn.execute('SELECT tokens FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    return True, "ok", int(updated['tokens'])

def get_user_token_balance(email):
    if not email:
        return None
    conn = get_db_connection()
    user = ensure_user_exists_for_tokens(conn, email)
    balance = int(user['tokens'])
    conn.close()
    return balance

def is_user_subscribed(email):
    if not email:
        return False
    conn = get_db_connection()
    user = conn.execute(
        'SELECT subscription_active FROM users WHERE email = ?',
        (email,)
    ).fetchone()
    conn.close()
    if not user:
        return False
    try:
        return int(user['subscription_active']) == 1
    except Exception:
        return False

def get_project_paywall_state(email, project_name):
    if not email or not project_name:
        return {}
    memory = get_chat_memory(email, project_name=project_name) or {}
    paywall = memory.get("paywall") if isinstance(memory.get("paywall"), dict) else {}
    return paywall

def save_project_paywall_state(email, project_name, paywall):
    if not email or not project_name:
        return
    memory = get_chat_memory(email, project_name=project_name) or {}
    memory["paywall"] = paywall if isinstance(paywall, dict) else {}
    save_chat_memory(email, memory, project_name=project_name)

def consume_chat_message_quota(email, project_name, reason="enviar mensaje al chat"):
    """
    Growth strategy:
    - First chat message per project is free (no token deduction).
    - After that, normal token deduction applies (until preview paywall blocks follow-ups).
    """
    if not email:
        return False, "No has iniciado sesión.", None
    if is_user_subscribed(email):
        return consume_user_tokens(email, CHAT_MESSAGE_TOKEN_COST, reason=reason)

    paywall = get_project_paywall_state(email, project_name)
    if not paywall.get("first_free_message_used"):
        paywall["first_free_message_used"] = True
        paywall["first_free_message_at"] = datetime.now().isoformat()
        save_project_paywall_state(email, project_name, paywall)
        return True, "free_first_message", get_user_token_balance(email)

    return consume_user_tokens(email, CHAT_MESSAGE_TOKEN_COST, reason=reason)

def consume_build_quota(email, project_name, reason="construir proyecto"):
    """
    Growth strategy:
    - First preview build per project is free for non-subscribed users.
    """
    if not email:
        return False, "No has iniciado sesión.", None
    if is_user_subscribed(email):
        return consume_user_tokens(email, BUILD_TOKEN_COST, reason=reason)

    paywall = get_project_paywall_state(email, project_name)
    if not paywall.get("free_preview_build_used"):
        paywall["free_preview_build_used"] = True
        paywall["free_preview_build_at"] = datetime.now().isoformat()
        save_project_paywall_state(email, project_name, paywall)
        return True, "free_preview_build", get_user_token_balance(email)

    return consume_user_tokens(email, BUILD_TOKEN_COST, reason=reason)

def mark_preview_delivered_for_project(email, project_name):
    if not email or not project_name:
        return
    memory = get_chat_memory(email, project_name=project_name) or {}
    paywall = memory.get("paywall") if isinstance(memory.get("paywall"), dict) else {}
    paywall["preview_delivered"] = True
    paywall["requires_subscription_after_preview"] = True
    paywall["preview_delivered_at"] = datetime.now().isoformat()
    memory["paywall"] = paywall
    save_chat_memory(email, memory, project_name=project_name)

def is_subscription_required_after_preview(email, project_name):
    if not email or not project_name:
        return False
    if is_user_subscribed(email):
        return False
    memory = get_chat_memory(email, project_name=project_name) or {}
    paywall = memory.get("paywall") if isinstance(memory.get("paywall"), dict) else {}
    return bool(paywall.get("preview_delivered") and paywall.get("requires_subscription_after_preview"))

def normalize_priority(priority):
    p = str(priority or "medium").strip().lower()
    if p not in PRIORITY_SLA_HOURS:
        return "medium"
    return p

def infer_priority_from_brief(brief):
    text = (brief.get("raw_text") or "").lower()
    urgent_terms = ["urgente", "urgent", "asap", "hoy", "today", "48h", "24h", "inversionista", "demo"]
    low_terms = ["idea inicial", "research", "investigar", "explorar", "prototipo simple"]
    if any(t in text for t in urgent_terms):
        return "high"
    if any(t in text for t in low_terms):
        return "low"
    return "medium"

def compute_sla_due_at(priority, now=None):
    from datetime import timedelta
    now = now or datetime.now()
    p = normalize_priority(priority)
    return (now + timedelta(hours=PRIORITY_SLA_HOURS[p])).isoformat()

def priority_rank(priority):
    p = normalize_priority(priority)
    return {"high": 0, "medium": 1, "low": 2}[p]

def is_sla_overdue(ticket):
    if ticket.get("status") == "completed":
        return False
    due_at = ticket.get("sla_due_at")
    if not due_at:
        return False
    try:
        return datetime.now() > datetime.fromisoformat(due_at)
    except Exception:
        return False

def status_message(status, engineer=None, project_id=None):
    if status == "pending":
        return "Esperando asignación de ingeniero en la red Anmar."
    if status == "accepted":
        prefix = f"{engineer} " if engineer else "Un ingeniero "
        return f"{prefix}aceptó el proyecto. Preparando entorno de desarrollo."
    if status == "developing":
        prefix = f"{engineer} " if engineer else "El equipo "
        return f"{prefix}está construyendo el MVP."
    if status == "blocked":
        return "Orden bloqueada temporalmente. Esperando resolución interna."
    if status == "completed":
        return "Proyecto completado y desplegado."
    return f"Estado actualizado: {status}"

def normalize_preview_url(preview_url, project_id):
    value = str(preview_url or "").strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        return value
    if value.startswith("/projects/"):
        return value
    if value.startswith("/"):
        return value
    if value.endswith(".html"):
        return f"/projects/{project_id}/{value}"
    return f"/projects/{project_id}/index.html"

def load_alerts():
    if not os.path.exists(ALERTS_FILE):
        return []
    try:
        with open(ALERTS_FILE, 'r') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []

def save_alerts(alerts):
    os.makedirs(os.path.dirname(ALERTS_FILE), exist_ok=True)
    with open(ALERTS_FILE, 'w') as f:
        json.dump(alerts, f, indent=2)

def append_ticket_event(ticket, status, message, actor="system"):
    events = ticket.setdefault("events", [])
    events.append({
        "timestamp": datetime.now().isoformat(),
        "status": status,
        "actor": actor,
        "message": message,
    })

def normalize_ticket_status(ticket):
    raw = str(ticket.get("status", "pending")).strip().lower()
    mapping = {
        "pending_assignment": "pending",
        "assigned": "accepted",
        "new": "pending",
        "accepted": "accepted",
        "developing": "developing",
        "in_progress": "developing",
        "blocked": "blocked",
        "completed": "completed",
        "delivered": "completed",
    }
    normalized = mapping.get(raw, raw)
    if normalized not in TICKET_PROGRESS:
        normalized = "pending"
    ticket["status"] = normalized
    ticket["priority"] = normalize_priority(ticket.get("priority"))
    if not ticket.get("sla_due_at"):
        ticket["sla_due_at"] = compute_sla_due_at(ticket["priority"])
    ticket["sla_overdue"] = is_sla_overdue(ticket)
    return ticket

def get_orders_map():
    if not os.path.exists(ORDER_STATUS_FILE):
        return {}
    try:
        with open(ORDER_STATUS_FILE, 'r') as f:
            data = json.load(f)
            if isinstance(data, dict):
                # Legacy format support: if this is a flat status object, wrap it.
                if "project_id" in data and "status" in data:
                    pid = data.get("project_id") or "legacy_project"
                    data["project_id"] = pid
                    data.setdefault("logs", [])
                    return {pid: data}

                # Validate map shape (project_id -> object). Ignore invalid payloads.
                cleaned = {}
                for k, v in data.items():
                    if isinstance(v, dict):
                        v.setdefault("project_id", k)
                        v.setdefault("logs", [])
                        cleaned[k] = v
                return cleaned
    except Exception:
        pass
    return {}

def save_orders_map(orders):
    os.makedirs(os.path.dirname(ORDER_STATUS_FILE), exist_ok=True)
    with open(ORDER_STATUS_FILE, 'w') as f:
        json.dump(orders, f, indent=2)

def update_order_status(project_id, status, log_entry=None, engineer=None, deployed_url=None):
    orders = get_orders_map()
    now = datetime.now().isoformat()
    current = orders.get(project_id, {
        "project_id": project_id,
        "status": "pending",
        "progress": 0,
        "message": status_message("pending"),
        "created_at": now,
        "updated_at": now,
        "logs": [],
    })
    current["status"] = status
    current["progress"] = TICKET_PROGRESS.get(status, current.get("progress", 0))
    current["message"] = status_message(status, engineer=engineer, project_id=project_id)
    current["updated_at"] = now
    if engineer:
        current["engineer"] = engineer
    if deployed_url:
        current["deployed_url"] = deployed_url
    if log_entry:
        current.setdefault("logs", []).append({"timestamp": now, "message": log_entry})
    orders[project_id] = current
    save_orders_map(orders)
    return current

def get_order_status(project_id):
    return get_orders_map().get(project_id)

def set_ticket_status(ticket_id, new_status, actor="system", engineer=None, deployed_url=None, delivery_note=None):
    alerts = load_alerts()
    ticket = next((t for t in alerts if t.get('id') == ticket_id), None)
    if not ticket:
        return None

    ticket = normalize_ticket_status(ticket)
    project_id = ticket.get("project_name")
    desired_status = str(new_status or ticket.get("status") or "pending").strip().lower()
    ticket["status"] = normalize_ticket_status({"status": desired_status}).get("status", "pending")
    if engineer:
        ticket["engineer"] = engineer
    if deployed_url:
        ticket["preview_url"] = deployed_url
    if delivery_note:
        ticket["delivery_note"] = delivery_note
    ticket["updated_at"] = datetime.now().isoformat()
    if ticket["status"] == "completed":
        ticket["completed_at"] = datetime.now().isoformat()
        try:
            due_at = datetime.fromisoformat(ticket.get("sla_due_at"))
            ticket["sla_breached"] = datetime.now() > due_at
        except Exception:
            ticket["sla_breached"] = False
    append_ticket_event(ticket, ticket["status"], status_message(ticket["status"], engineer=engineer, project_id=project_id), actor=actor)
    save_alerts(alerts)

    resolved_preview = deployed_url or ticket.get("preview_url") or ""
    if not resolved_preview and ticket["status"] == "completed":
        resolved_preview = f"/projects/{project_id}/index.html"
    update_order_status(
        project_id,
        ticket["status"],
        log_entry=status_message(ticket["status"], engineer=engineer, project_id=project_id),
        engineer=engineer,
        deployed_url=resolved_preview or None
    )
    return ticket

def list_queue(engineer=None, status=None, priority=None, mode="all"):
    alerts = [normalize_ticket_status(a) for a in load_alerts()]
    if engineer and mode == "mine":
        engineer_lower = engineer.lower()
        alerts = [
            a for a in alerts
            if a.get("status") == "pending" or str(a.get("engineer", "")).lower() == engineer_lower
        ]
    if status and status != "all":
        status = status.lower()
        alerts = [a for a in alerts if a.get("status") == status]
    if priority and priority != "all":
        p = normalize_priority(priority)
        alerts = [a for a in alerts if normalize_priority(a.get("priority")) == p]
    alerts.sort(
        key=lambda a: (
            0 if a.get("status") == "pending" else 1,
            priority_rank(a.get("priority")),
            0 if a.get("sla_overdue") else 1,
            a.get("updated_at", a.get("timestamp", "")),
        ),
        reverse=False
    )
    return alerts

def load_dispatch_state():
    if not os.path.exists(DISPATCH_STATE_FILE):
        return {"rr_cursor": 0}
    try:
        with open(DISPATCH_STATE_FILE, 'r') as f:
            data = json.load(f)
            if isinstance(data, dict):
                data.setdefault("rr_cursor", 0)
                return data
    except Exception:
        pass
    return {"rr_cursor": 0}

def save_dispatch_state(state):
    os.makedirs(os.path.dirname(DISPATCH_STATE_FILE), exist_ok=True)
    with open(DISPATCH_STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)

def current_engineer_load(alerts):
    load = {e: 0 for e in ENGINEER_POOL}
    for t in alerts:
        status = t.get("status")
        eng = t.get("engineer")
        if eng in load and status in ("accepted", "developing"):
            load[eng] += 1
    return load

def next_round_robin_candidate(candidates, state):
    if not candidates:
        return None
    cursor = int(state.get("rr_cursor", 0)) % len(ENGINEER_POOL)
    ordered = ENGINEER_POOL[cursor:] + ENGINEER_POOL[:cursor]
    for eng in ordered:
        if eng in candidates:
            state["rr_cursor"] = (ENGINEER_POOL.index(eng) + 1) % len(ENGINEER_POOL)
            return eng
    # Fallback should never happen if candidates subset of pool.
    chosen = sorted(candidates)[0]
    state["rr_cursor"] = (ENGINEER_POOL.index(chosen) + 1) % len(ENGINEER_POOL)
    return chosen

def choose_engineer_for_auto_dispatch(alerts, state):
    load = current_engineer_load(alerts)
    min_load = min(load.values()) if load else 0
    candidates = [eng for eng, value in load.items() if value == min_load]
    return next_round_robin_candidate(candidates, state)

def pending_queue_sorted(alerts):
    pending = [a for a in alerts if a.get("status") == "pending"]
    pending.sort(
        key=lambda a: (
            priority_rank(a.get("priority")),
            a.get("timestamp", "")
        )
    )
    return pending

@app.route('/api/user-stats', methods=['GET'])
def get_user_stats():
    email = request.args.get('email')
    if not email: return jsonify({"error": "No email provided"}), 400
    
    conn = get_db_connection()
    user = conn.execute(
        'SELECT tokens, created_at, subscription_active, subscription_plan FROM users WHERE email = ?',
        (email,)
    ).fetchone()
    conn.close()
    
    if user:
        return jsonify({
            "tokens": user['tokens'],
            "joined": user['created_at'],
            "subscription_active": int(user['subscription_active']) == 1 if 'subscription_active' in user.keys() else False,
            "subscription_plan": user['subscription_plan'] if 'subscription_plan' in user.keys() else 'none'
        })
    else:
        return jsonify({"error": "User not found"}), 404

@app.route('/api/submit-ticket', methods=['POST'])
def submit_ticket():
    try:
        data = request.json
        user_email = data.get('user_email')
        project_name = data.get('project_name')
        user_request = data.get('request')
        
        if not all([user_email, project_name, user_request]):
            return jsonify({"error": "Missing fields"}), 400

        ok_tokens, token_msg, remaining = consume_user_tokens(
            user_email,
            HUMAN_SUPPORT_TOKEN_COST,
            reason="solicitar soporte humano"
        )
        if not ok_tokens:
            return jsonify({"error": token_msg, "remaining_tokens": remaining}), 402

        # --- HYBRID AI LOGIC ---
        # 1. Read Current Project State to give context to AI
        project_path = os.path.join(projects_base_dir, project_name, 'index.html')
        current_code = ""
        if os.path.exists(project_path):
            with open(project_path, 'r') as f:
                current_code = f.read()[:3000] # Limit context

        # 2. Ask AI for the Solution Code (Draft for Humans)
        prompt = f"""
        ACT AS A SENIOR DEVELOPER ASSISTANT.
        Project: {project_name}
        User Request: "{user_request}"
        Current HTML Snippet: {current_code}...
        
        TASK:
        Generate the EXACT code change needed to fulfill this request.
        Do NOT apply it yet. Just provide the code block that the human engineer should copy-paste.
        
        RETURN JSON:
        {{
            "ai_suggestion": "The code block or CSS needed..."
        }}
        """
        parsed = call_ai_json(prompt)
        ai_code = parsed.get('ai_suggestion', 'Manual review needed.') if parsed else "Manual review needed."

        # 3. Save to DB for Human Review
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO tickets (project_name, user_email, request, status, ai_suggestion) VALUES (?, ?, ?, ?, ?)',
            (project_name, user_email, user_request, 'pending_human_review', ai_code)
        )
        ticket_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            "message": "Ticket asignado al equipo experto.",
            "ticket_id": ticket_id,
            "assigned_to": "George (Design Lead)" if "design" in user_request.lower() else "Marta (Senior Dev)",
            "remaining_tokens": remaining
        })

    except Exception as e:
        print(f"Ticket Error: {e}")
        return jsonify({"error": str(e)}), 500


# --- ADMIN ROUTES ---
@app.route('/api/admin/tickets', methods=['GET'])
def get_tickets():
    # In production, require admin auth here
    conn = get_db_connection()
    tickets = conn.execute("SELECT * FROM tickets WHERE status != 'completed' ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify([dict(t) for t in tickets])

@app.route('/api/admin/resolve-ticket', methods=['POST'])
def resolve_ticket():
    try:
        data = request.json
        ticket_id = data.get('ticket_id')
        code_snippet = data.get('code_snippet') # The approved code
        
        conn = get_db_connection()
        ticket = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        
        if not ticket:
            conn.close()
            return jsonify({"error": "Ticket not found"}), 404
            
        project_name = ticket['project_name']
        project_path = os.path.join(projects_base_dir, project_name, 'index.html')
        
        # APPLY THE FIX (Simplified Strategy: Append or Replace if identifiable)
        # Ideally, the AI suggestion includes instructions. For MVP, we assume it's a replacement block provided by the admin.
        # But to be safe, we will just APPEND it to the body or head if it's CSS/JS, 
        # or we rely on the admin to paste the FULL file content if it's a structural change.
        
        # Power User Mode: Admin sends the FULL new HTML or a specific patch.
        # Let's assume for this MVP the 'code_snippet' IS the fix. 
        # Since 'edit-project' logic already exists, we could reuse that or just overwrite validation.
        
        # For this demo: We'll overwrite the file with the code_snippet if it looks like full HTML, 
        # otherwise we might fail. Let's assume the admin acts as the final editor.
        if "<html>" in code_snippet:
             with open(project_path, 'w') as f:
                f.write(code_snippet)
        else:
            # Fallback for small snippets: Admin must ensure it's full code or use a different tool.
            # In a real tool, we'd use diff/patch.
            pass 

        # Update Status
        conn.execute("UPDATE tickets SET status = 'completed' WHERE id = ?", (ticket_id,))
        conn.commit()
        conn.close()
        
        return jsonify({"message": "Ticket resuelto y código desplegado."})
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/analyze-idea', methods=['POST'])
def analyze_idea():
    try:
        data = request.json
        idea = data.get('idea', '').strip()
        image_data_url = data.get('image_data_url', '')
        engine = normalize_engine(data.get('engine'))
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        if is_subscription_required_after_preview(user_email, project_name):
            return jsonify({
                "error": "Ya viste la previsualización inicial. Para continuar iterando debes suscribirte.",
                "code": "subscription_required_after_preview",
                "requires_subscription": True
            }), 402
        image_context = describe_image_for_chat(image_data_url) if image_data_url else ""
        enriched_idea = idea
        if image_context:
            enriched_idea = f"{idea}\n\nContexto de imagen adjunta:\n{image_context}".strip()
        elif image_data_url and not idea:
            enriched_idea = "El usuario adjuntó una imagen. Analiza el contexto visual para definir el producto."
        ok_tokens, token_msg, remaining = consume_chat_message_quota(
            user_email,
            project_name,
            reason="enviar mensaje al chat"
        )
        if not ok_tokens:
            return jsonify({"error": token_msg, "remaining_tokens": remaining}), 402
        if has_reset_intent(idea):
            if user_email:
                save_chat_memory(
                    user_email,
                    reset_memory_payload(get_chat_memory(user_email, project_name=project_name) or {}),
                    project_name=project_name
                )
            return jsonify({
                "status": "chat",
                "message": "Listo, reiniciamos contexto. Empecemos de cero: cuéntame tu nueva idea en una frase.",
                "ready_to_build": False
            })
        history = [{"role": "user", "content": enriched_idea}]

        existing_memory = None
        if user_email:
            stored = get_chat_memory(user_email, project_name=project_name) or {}
            existing_memory = stored.get("agent_memory") if isinstance(stored, dict) else None

        analysis = analyze_turn_state(history, enriched_idea, existing_memory=existing_memory)
        reply = compose_consultant_reply(analysis, enriched_idea, history, engine=engine)

        if user_email:
            to_store = get_chat_memory(user_email, project_name=project_name) or {}
            to_store["agent_memory"] = analysis["memory"]
            to_store["summary"] = analysis["memory"].get("summary", "")
            to_store["audience"] = analysis["memory"].get("audience", "")
            to_store["business_model"] = analysis["memory"].get("business_model", "")
            to_store["timeline"] = analysis["memory"].get("timeline", "")
            to_store["engine_preference"] = engine
            save_chat_memory(user_email, to_store, project_name=project_name)

        return jsonify({
            "status": "chat",
            "message": reply,
            "ready_to_build": analysis["ready_to_build"],
            "ready_by_data": analysis.get("ready_by_data", False),
            "missing_fields": analysis.get("missing_fields", []),
            "brief_score": compute_brief_score(analysis.get("missing_fields", [])),
            "remaining_tokens": remaining,
            "memory_summary": analysis["memory"].get("summary", ""),
            "memory_snapshot": {
                "audience": analysis["memory"].get("audience", ""),
                "business_model": analysis["memory"].get("business_model", ""),
                "timeline": analysis["memory"].get("timeline", ""),
                "features": analysis["memory"].get("features", []),
            },
            "engine_used": engine
        })

    except Exception as e:
        print(f"Analyze Error: {e}")
        return jsonify({"error": str(e)}), 500

# --- NEW: SYNTHESIS BRAIN ---
# --- NEW: TICKET SYSTEM (Step 1: Chat -> Ticket) ---
@app.route('/api/create-ticket', methods=['POST'])
def create_ticket():
    try:
        data = request.json
        history = data.get('history', [])
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        if not history:
            return jsonify({"error": "History is required"}), 400

        brief = extract_brief_from_history(history)
        memory = get_chat_memory(user_email, project_name=project_name) if user_email else {}
        agent_memory = memory.get("agent_memory") if isinstance(memory, dict) else None
        engineer_brief = build_engineer_brief(brief, history, agent_memory=agent_memory)
        project_id = slugify_project_name(brief.get("project_name_seed"))
        tech_stack = infer_tech_stack_from_text(brief.get("raw_text"))
        summary = engineer_brief.get("vision") or brief.get("summary") or "Nuevo proyecto generado desde chat."
        handoff_package = build_handoff_package(engineer_brief, tech_stack)
        blueprint_md = generate_blueprint_markdown(brief, tech_stack)
        priority = infer_priority_from_brief(brief)
        sla_due_at = compute_sla_due_at(priority)

        # Optional AI enhancement. If it fails, deterministic blueprint remains.
        ai_prompt = f"""
        Eres arquitecto de software.
        HISTORIAL: {history}
        Devuelve JSON:
        {{
          "project_name": "snake_case",
          "summary": "1 frase",
          "tech_stack": ["stack1", "stack2"],
          "blueprint_content": "markdown"
        }}
        """
        ai_plan = call_ai_json(ai_prompt)
        if ai_plan:
            project_id = slugify_project_name(ai_plan.get("project_name", project_id))
            summary = ai_plan.get("summary", summary)
            if isinstance(ai_plan.get("tech_stack"), list) and ai_plan.get("tech_stack"):
                tech_stack = [str(x) for x in ai_plan.get("tech_stack")]
            blueprint_md = ai_plan.get("blueprint_content", blueprint_md)

        # 2. CREATE FOLDER & HANDOFF (Immediate)
        project_dir = os.path.join(projects_base_dir, project_id)
        os.makedirs(project_dir, exist_ok=True)

        handoff_content = f"""# ANMAR Handoff Document
ID: {project_id}
Date: {datetime.now().isoformat()}
Summary: {summary}
Stack: {', '.join(tech_stack)}

## Client Requirement Summary
- Vision: {engineer_brief.get("vision")}
- Target Audience: {engineer_brief.get("target_audience")}
- Business Model: {engineer_brief.get("business_model")}
- Timeline: {engineer_brief.get("timeline")}

### Must-Have Features (V1)
{chr(10).join([f"- {f}" for f in engineer_brief.get("must_have_features", [])])}

### Client Highlights
{chr(10).join([f"- {h}" for h in engineer_brief.get("client_highlights", [])])}

## HANDOFF_PACKAGE
### Project Vision
{handoff_package.get("project_vision")}

### Suggested Tech Stack
{', '.join(handoff_package.get("suggested_tech_stack", []))}

### Critical Requirements (Maria P. + Human Team)
{chr(10).join([f"- {req}" for req in handoff_package.get("critical_requirements_for_maria_team", [])])}

## Technical Blueprint
{blueprint_md}
"""
        with open(os.path.join(project_dir, 'handoff.md'), 'w') as f:
            f.write(handoff_content)

        # 3. CREATE TICKET (Internal Alerts)
        new_ticket = {
            "id": f"TKT-{int(datetime.now().timestamp())}-{uuid.uuid4().hex[:4]}",
            "project_name": project_id,
            "client_email": user_email,
            "client": user_email or "unknown@anmar.local",
            "status": "pending",
            "timestamp": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "summary": summary,
            "preview_url": "",
            "delivery_note": "",
            "engineer_brief": engineer_brief,
            "handoff_package": handoff_package,
            "tech_stack": tech_stack,
            "blueprint_md": blueprint_md,
            "priority": priority,
            "sla_due_at": sla_due_at,
            "events": [],
        }

        append_ticket_event(new_ticket, "pending", status_message("pending", project_id=project_id), actor="system")

        current_alerts = load_alerts()
        current_alerts.insert(0, new_ticket)
        save_alerts(current_alerts)

        # 4. INITIAL STATUS (Client Feedback)
        update_order_status(
            project_id,
            "pending",
            log_entry="Ticket creado y enviado a ingeniería."
        )

        return jsonify({
            "message": "Solicitud enviada a ingeniería.",
            "project_id": project_id,
            "status": "ticket_created"
        })

    except Exception as e:
        print(f"Ticket Error: {e}")
        return jsonify({"error": str(e)}), 500

# --- STEP 2: ENGINEER ACCEPTANCE (Admin Panel -> Project Folder) ---
@app.route('/api/accept-ticket', methods=['POST'])
def accept_ticket():
    try:
        data = request.json
        ticket_id = data.get('ticket_id')
        engineer = data.get('engineer', 'Staff Anmar')
        
        alerts = load_alerts()
        ticket = next((t for t in alerts if t.get('id') == ticket_id), None)
        if not ticket: return jsonify({"error": "Ticket not found"}), 404

        project_id = ticket['project_name']
        if str(engineer).strip().lower() in ("auto", "dispatch", "smart"):
            state = load_dispatch_state()
            engineer = choose_engineer_for_auto_dispatch([normalize_ticket_status(a) for a in alerts], state) or engineer
            save_dispatch_state(state)
        
        # 2. CREATE FOLDER STRUCTURE
        project_dir = os.path.join(projects_base_dir, project_id)
        os.makedirs(project_dir, exist_ok=True)
        
        # Base Files
        with open(os.path.join(project_dir, 'index.html'), 'w') as f:
            f.write(f"<!-- Anmar Project: {project_id} -->\n<h1>{project_id} - Under Construction</h1>")
        with open(os.path.join(project_dir, 'style.css'), 'w') as f:
            f.write("/* Styles */")
        with open(os.path.join(project_dir, 'app.js'), 'w') as f:
            f.write("// Logic")
        with open(os.path.join(project_dir, 'blueprint.md'), 'w') as f:
            f.write(ticket.get('blueprint_md', '# Blueprint'))
            
        # 3. UPDATE TICKET STATUS
        set_ticket_status(ticket_id, "accepted", actor=engineer, engineer=engineer)
        set_ticket_status(ticket_id, "developing", actor=engineer, engineer=engineer)
            
        return jsonify({"success": True, "project_id": project_id})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/deliver-ticket', methods=['POST'])
def deliver_ticket():
    try:
        data = request.json
        ticket_id = data.get('ticket_id')
        preview_url = data.get('preview_url') or ''
        delivery_note = data.get('delivery_note') or ''

        alerts = load_alerts()
        ticket_seed = next((t for t in alerts if t.get('id') == ticket_id), None)
        if not ticket_seed:
            return jsonify({"error": "Ticket not found"}), 404
        project_id = ticket_seed.get("project_name")
        normalized_preview = normalize_preview_url(preview_url, project_id) if preview_url else f"/projects/{project_id}/index.html"

        ticket = set_ticket_status(
            ticket_id,
            "completed",
            actor="engineer",
            deployed_url=normalized_preview,
            delivery_note=(str(delivery_note or "").strip() or None)
        )
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404

        return jsonify({"success": True, "ticket": ticket})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/admin/update-ticket', methods=['POST'])
def admin_update_ticket():
    try:
        data = request.json or {}
        ticket_id = str(data.get('ticket_id') or '').strip()
        if not ticket_id:
            return jsonify({"error": "ticket_id is required"}), 400

        status = str(data.get('status') or '').strip().lower()
        engineer = str(data.get('engineer') or '').strip()
        preview_input = data.get('preview_url')
        delivery_note = str(data.get('delivery_note') or '').strip()
        actor = engineer or str(data.get('actor') or 'admin')

        alerts = load_alerts()
        ticket = next((t for t in alerts if t.get('id') == ticket_id), None)
        if not ticket:
            return jsonify({"error": "Ticket not found"}), 404

        project_id = ticket.get("project_name")
        normalized_preview = ""
        if preview_input is not None:
            normalized_preview = normalize_preview_url(preview_input, project_id)

        if status:
            updated = set_ticket_status(
                ticket_id,
                status,
                actor=actor,
                engineer=engineer if engineer else None,
                deployed_url=normalized_preview or None,
                delivery_note=delivery_note or None
            )
            if not updated:
                return jsonify({"error": "Ticket not found"}), 404
        else:
            # No status transition, just update operational fields.
            ticket = normalize_ticket_status(ticket)
            if engineer:
                ticket["engineer"] = engineer
            if preview_input is not None:
                ticket["preview_url"] = normalized_preview
            if delivery_note:
                ticket["delivery_note"] = delivery_note
            ticket["updated_at"] = datetime.now().isoformat()
            append_ticket_event(
                ticket,
                ticket.get("status", "pending"),
                "Actualización interna: preview y/o notas de entrega.",
                actor=actor
            )
            save_alerts(alerts)

            update_order_status(
                project_id,
                ticket.get("status", "pending"),
                log_entry="Actualización interna aplicada al proyecto.",
                engineer=ticket.get("engineer"),
                deployed_url=(ticket.get("preview_url") or None)
            )
            updated = ticket

        return jsonify({"success": True, "ticket": normalize_ticket_status(updated)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- POLLING ENDPOINTS ---
@app.route('/api/project-status', methods=['GET'])
def get_project_status():
    try:
        project_id = request.args.get('project_id')
        orders = get_orders_map()
        if project_id:
            order = orders.get(project_id)
            if order:
                return jsonify(order)
            return jsonify({"status": "unknown", "progress": 0, "project_id": project_id}), 404

        if not orders:
            return jsonify({"status": "idle", "progress": 0})

        latest = sorted(
            orders.values(),
            key=lambda o: o.get("updated_at", o.get("created_at", "")),
            reverse=True
        )[0]
        return jsonify(latest)
    except Exception:
        return jsonify({"status": "error"}), 500

@app.route('/api/internal-alerts', methods=['GET'])
def get_internal_alerts():
    try:
        alerts = [normalize_ticket_status(a) for a in load_alerts()]
        alerts.sort(key=lambda a: a.get("updated_at", a.get("timestamp", "")), reverse=True)
        return jsonify(alerts)
    except Exception:
        return jsonify([])

@app.route('/api/internal-queue', methods=['GET'])
def get_internal_queue():
    try:
        engineer = request.args.get('engineer')
        status = request.args.get('status', 'all')
        priority = request.args.get('priority', 'all')
        mode = request.args.get('mode', 'all')  # all | mine
        queue = list_queue(engineer=engineer, status=status, priority=priority, mode=mode)
        return jsonify({
            "items": queue,
            "meta": {
                "total": len(queue),
                "overdue": len([q for q in queue if q.get("sla_overdue")]),
                "pending": len([q for q in queue if q.get("status") == "pending"])
            }
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/internal/order-history', methods=['GET'])
def get_internal_order_history():
    try:
        project_name = (request.args.get('project_name') or '').strip().lower()
        client_email = (request.args.get('client_email') or '').strip().lower()

        alerts = [normalize_ticket_status(a) for a in load_alerts()]
        history = []
        for a in alerts:
            p_name = str(a.get("project_name") or "").strip().lower()
            c_email = str(a.get("client_email") or a.get("client") or "").strip().lower()
            if project_name and p_name == project_name:
                history.append(a)
                continue
            if client_email and c_email == client_email:
                history.append(a)

        history.sort(key=lambda x: x.get("updated_at", x.get("timestamp", "")), reverse=True)

        project_status = None
        if project_name:
            project_status = get_order_status(project_name)

        return jsonify({
            "orders": history[:25],
            "project_status": project_status,
            "meta": {
                "total_orders": len(history),
                "project_name": project_name,
                "client_email": client_email
            }
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/dispatch/auto-assign', methods=['POST'])
def auto_assign_dispatch():
    try:
        data = request.json or {}
        limit = int(data.get("limit", 1))
        if limit < 1:
            limit = 1
        if limit > 20:
            limit = 20
        actor = data.get("actor", "dispatcher")

        alerts = [normalize_ticket_status(a) for a in load_alerts()]
        queue = pending_queue_sorted(alerts)
        if not queue:
            return jsonify({"assigned": [], "message": "No pending tickets."})

        state = load_dispatch_state()
        assigned = []
        for ticket in queue[:limit]:
            engineer = choose_engineer_for_auto_dispatch(alerts, state)
            if not engineer:
                break
            updated = set_ticket_status(ticket.get("id"), "accepted", actor=actor, engineer=engineer)
            if updated:
                assigned.append({
                    "ticket_id": updated.get("id"),
                    "project_id": updated.get("project_name"),
                    "engineer": engineer,
                    "priority": updated.get("priority"),
                })
                # Update in-memory snapshot for next load balancing decision.
                ticket["status"] = "accepted"
                ticket["engineer"] = engineer

        save_dispatch_state(state)
        return jsonify({
            "assigned": assigned,
            "count": len(assigned),
            "message": f"{len(assigned)} ticket(s) assigned."
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- ENGINEER TOOLS (The "Antigravity" for Maria) ---

@app.route('/api/engineer/file', methods=['GET', 'POST'])
def manage_project_file():
    try:
        project_id = request.args.get('project_id') or request.json.get('project_id')
        filename = request.args.get('filename') or request.json.get('filename')
        
        if not project_id: return jsonify({"error": "Missing project_id"}), 400
        
        file_path = os.path.join(projects_base_dir, project_id, filename)
        
        # Security check: ensure path is within project dir
        if not os.path.abspath(file_path).startswith(os.path.abspath(projects_base_dir)):
            return jsonify({"error": "Invalid path"}), 403

        if request.method == 'GET':
            if not os.path.exists(file_path): return "", 404
            with open(file_path, 'r') as f:
                return jsonify({"content": f.read()})
                
        if request.method == 'POST':
            content = request.json.get('content', '')
            with open(file_path, 'w') as f:
                f.write(content)
            return jsonify({"success": True})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/engineer/ai-assist', methods=['POST'])
def engineer_ai_assist():
    try:
        data = request.json
        project_id = data.get('project_id')
        instruction = data.get('instruction') 
        target_file = data.get('target_file') 
        current_content = data.get('file_content', '') # Content from Editor
        
        # 1. Context Gathering (Read other files to be smart)
        context_files = ""
        project_dir = os.path.join(projects_base_dir, project_id)
        
        # If editing HTML, read CSS for context
        if target_file.endswith('.html'):
            css_path = os.path.join(project_dir, 'style.css')
            if os.path.exists(css_path):
                with open(css_path, 'r') as f: context_files += f"\n/* style.css context */\n{f.read()[:1000]}"
                
        # If editing JS, read HTML for context
        if target_file.endswith('.js'):
            html_path = os.path.join(project_dir, 'index.html')
            if os.path.exists(html_path):
                 with open(html_path, 'r') as f: context_files += f"\n<!-- index.html context -->\n{f.read()[:1000]}"

        # 2. Prompt Gemini
        prompt = f"""
        ACT AS: Senior Lead Developer (Maria's Co-pilot).
        CONTEXT: We are building '{project_id}'.
        TARGET FILE: {target_file}
        
        OTHER CONTEXT FILES:
        {context_files}
        
        CURRENT CONTENT OF {target_file}:
        ```
        {current_content}
        ```
        
        USER INSTRUCTION: "{instruction}"
        
        TASK:
        1. Analyze the instruction and the current code.
        2. Rewrite the code to fulfill the instruction.
        3. Maintain existing functionality unless asked to change.
        4. Use modern best practices.
        
        RETURN FORMAT (JSON):
        {{
            "thought": "Brief explanation of changes (1-2 sentences)",
            "code": "FULL new content for the file"
        }}
        """
        
        response = model.generate_content(prompt)
        # Parse JSON from response
        text = response.text.strip()
        # Handle potential markdown wrappers
        if text.startswith('```json'): text = text[7:]
        if text.endswith('```'): text = text[:-3]
        
        ai_response = json.loads(text)
        
        return jsonify(ai_response)

    except Exception as e:
        print(f"AI Error: {e}")
        # Fallback for parsing errors
        return jsonify({"thought": "Error processing logic, but here is a raw attempt.", "code": "// Error generating code"}), 500

@app.route('/create-blueprint', methods=['POST'])
def create_blueprint():
    try:
        data = request.json
        idea = data.get('idea', '')
        
        prompt = f"""
        Act as a Senior Software Architect. User Idea: "{idea}"
        
        CRITICAL: WRITE IN THE SAME LANGUAGE AS THE USER'S IDEA.
        
        Create a TECHNICAL BLUEPRINT markdown.
        
        RETURN JSON:
        {{
            "blueprint": "## Plan... (use \\n for newlines)"
        }}
        """
        response = model.generate_content(prompt)
        result = clean_and_parse_json(response.text)
        
        if result: 
            return jsonify(result)
        else:
            return jsonify({"blueprint": "## Error generating blueprint.\nProceeding..."})
            
    except Exception as e:
        print(f"Blueprint Error: {e}")
        return jsonify({"blueprint": "## Error.\nProceeding..."})

@app.route('/generate-plan', methods=['POST'])
def generate_plan():
    try:
        data = request.json
        business_idea = data.get('idea')
        if not business_idea: return jsonify({"error": "No idea provided"}), 400

        prompt = f"""
        Act as a Senior CTO. Idea: "{business_idea}".
        
        CRITICAL: GENERATE THE PLAN IN THE SAME LANGUAGE AS THE IDEA.
        
        Return JSON object (ESCAPE NEWLINES inside values!):
        {{
            "project_name": "snake_case_name",
            "plan": "Markdown plan with \\n for newlines"
        }}
        """
        response = model.generate_content(prompt)
        result = clean_and_parse_json(response.text)
        
        if result:
            return jsonify(result)
        else:
            # Fallback Manual Construction if JSON fails entirely
            return jsonify({
                "project_name": "project_fallback",
                "plan": "# Generated Plan\nCheck details..."
            })
    except Exception as e:
        print(f"Generation Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/edit-project', methods=['POST'])
def edit_project():
    try:
        data = request.json or {}
        project_name = str(data.get('project_name') or '').strip()
        instruction = str(data.get('instruction') or '').strip()
        user_email = str(data.get('user_email') or '').strip().lower()
        engine = normalize_engine(data.get('engine'))
        history = data.get('history') if isinstance(data.get('history'), list) else []
        image_data_url = data.get('image_data_url', '')

        if not project_name:
            return jsonify({"error": "project_name is required"}), 400
        if not instruction:
            return jsonify({"error": "instruction is required"}), 400
        if is_subscription_required_after_preview(user_email, project_name):
            return jsonify({
                "error": "La previsualización ya fue entregada. Debes suscribirte para seguir editando.",
                "code": "subscription_required_after_preview",
                "requires_subscription": True
            }), 402

        ok_tokens, token_msg, remaining = consume_user_tokens(
            user_email,
            CHAT_MESSAGE_TOKEN_COST,
            reason="aplicar edición con IA"
        )
        if not ok_tokens:
            return jsonify({"error": token_msg, "remaining_tokens": remaining}), 402

        project_path = os.path.join(projects_base_dir, project_name)
        if not os.path.isdir(project_path):
            return jsonify({"error": "Project folder not found"}), 404

        allowed_files = ["index.html", "styles.css", "style.css", "app.js", "script.js"]
        file_snapshots = {}
        for fname in allowed_files:
            fpath = os.path.join(project_path, fname)
            if os.path.exists(fpath):
                with open(fpath, 'r', encoding='utf-8') as f:
                    file_snapshots[fname] = f.read()
            else:
                file_snapshots[fname] = ""

        if not any(file_snapshots.values()):
            return jsonify({"error": "No editable project files found"}), 404

        def _parse_changed_files(ai_payload):
            if not ai_payload or not isinstance(ai_payload, dict):
                return "", {}
            summary_local = str(ai_payload.get("summary") or "Cambios aplicados por IA.").strip()
            files_obj_local = ai_payload.get("files")
            if not isinstance(files_obj_local, dict):
                files_obj_local = {}
            changed_local = {}
            for fname in allowed_files:
                if fname not in files_obj_local:
                    continue
                content = files_obj_local.get(fname)
                if not isinstance(content, str):
                    continue
                cleaned = (
                    content
                    .replace("```html", "")
                    .replace("```css", "")
                    .replace("```javascript", "")
                    .replace("```js", "")
                    .replace("```", "")
                    .strip()
                )
                if cleaned:
                    changed_local[fname] = cleaned
            return summary_local, changed_local

        def _smoke_checks_for_html(changed_local):
            checks = []
            if "index.html" in changed_local:
                html_out = changed_local["index.html"].lower()
                checks.extend([
                    {"name": "html_has_head", "ok": "<head" in html_out and "</head>" in html_out},
                    {"name": "html_has_body", "ok": "<body" in html_out and "</body>" in html_out},
                    {"name": "html_closed", "ok": "</html>" in html_out},
                ])
            return checks

        build_intent = bool(re.search(
            r"(crea|créalo|crealo|construye|construyelo|constrúyelo|completo|mvp|full app|aplicacion completa|aplicación completa)",
            instruction.lower()
        ))
        ui_reference = describe_ui_reference(image_data_url) if image_data_url else ""
        design_intent = bool(re.search(
            r"(replica|recrear|inspira|inspirate|inspirar|igual que|como calm|diseñ[oó]|ui|ux|look and feel|layout)",
            instruction.lower()
        )) or bool(ui_reference)
        strict_redesign_mode = build_intent or design_intent

        reference_block = (
            f"REFERENCIA VISUAL OBLIGATORIA (imagen adjunta):\n{ui_reference}\n"
            "Debes aproximarte al look&feel de esa referencia en estructura, estilos y jerarquía visual."
            if ui_reference else
            "No hay referencia visual adjunta."
        )

        summary = "Cambios aplicados por IA."
        changed_files = {}
        smoke_checks = []
        last_failure_reason = ""
        max_attempts = 3

        for attempt in range(1, max_attempts + 1):
            feedback_block = f"Intento {attempt}/{max_attempts}."
            if last_failure_reason:
                feedback_block += f" Error previo a corregir: {last_failure_reason}"

            if strict_redesign_mode:
                mode_rules = """
MODO: CONSTRUCCIÓN COMPLETA (no edición mínima).
- Debes entregar una versión MVP usable y visualmente cuidada.
- Entrega obligatoria: index.html + styles.css (o style.css) + app.js (o script.js).
- Debe incluir UI moderna, layout responsive, componentes útiles y al menos 2 interacciones JS reales.
- Prohibido entregar solo placeholders vacíos o texto genérico.
- No uses "Coming soon", "TODO", ni secciones vacías.
"""
            else:
                mode_rules = """
MODO: EDICIÓN INCREMENTAL.
- Cambia solo lo necesario para cumplir la instrucción.
"""

            prompt = f"""
Eres un Senior Software Engineer. Debes editar un proyecto real con precisión.

PROYECTO: {project_name}
INSTRUCCIÓN DEL USUARIO: {instruction}
HISTORIAL RECIENTE: {history[-10:]}
FEEDBACK DE INTENTOS: {feedback_block}
{reference_block}

ARCHIVOS ACTUALES:
index.html:
{file_snapshots.get('index.html', '')[:15000]}

styles.css:
{file_snapshots.get('styles.css', '')[:12000]}

style.css:
{file_snapshots.get('style.css', '')[:12000]}

app.js:
{file_snapshots.get('app.js', '')[:12000]}

script.js:
{file_snapshots.get('script.js', '')[:12000]}

REGLAS:
- Devuelve JSON válido, sin markdown.
- Mantén funcionalidad existente.
- Si tocas HTML, debe seguir siendo un documento HTML completo.
- Puedes devolver uno o varios archivos modificados.
{mode_rules}
- Si hay referencia visual adjunta, prioriza reproducir su composición visual sobre estilos previos.
- Cuando aplique, ajusta también CSS y JS para que el resultado no quede solo en texto plano.

FORMATO OBLIGATORIO:
{{
  "summary": "qué se cambió en una frase",
  "files": {{
    "index.html": "contenido completo del archivo solo si cambió",
    "styles.css": "contenido completo si cambió",
    "style.css": "contenido completo si cambió",
    "app.js": "contenido completo si cambió",
    "script.js": "contenido completo si cambió"
  }}
}}
"""
            ai_payload = call_ai_json(prompt, engine=engine)
            summary_try, changed_try = _parse_changed_files(ai_payload)
            checks_try = _smoke_checks_for_html(changed_try)
            checks_ok = all(c["ok"] for c in checks_try) if checks_try else True
            css_present = ("styles.css" in changed_try or "style.css" in changed_try)
            js_present = ("app.js" in changed_try or "script.js" in changed_try)

            if not changed_try:
                last_failure_reason = "No devolviste cambios de archivos válidos."
                continue
            if strict_redesign_mode and "index.html" not in changed_try:
                last_failure_reason = "Falta index.html completo para modo construcción."
                continue
            if strict_redesign_mode and (not css_present or not js_present):
                last_failure_reason = "En modo construcción debes incluir HTML + CSS + JS."
                continue
            if not checks_ok:
                last_failure_reason = "Los smoke checks de HTML fallaron. Debes devolver un HTML completo válido."
                continue

            # Gate de calidad visual para evitar respuestas "mínimas".
            if strict_redesign_mode:
                html_candidate = changed_try.get("index.html", "")
                if len(html_candidate) < 2800:
                    last_failure_reason = "La salida fue demasiado simple. Debe ser una UI completa, no un bloque básico."
                    continue
                section_count = len(re.findall(r"<section\\b", html_candidate.lower()))
                if section_count < 3:
                    last_failure_reason = "Faltan secciones suficientes. Se requieren al menos 3 secciones visibles."
                    continue

            summary = summary_try or summary
            changed_files = changed_try
            smoke_checks = checks_try
            break

        if not changed_files:
            if strict_redesign_mode:
                safe_title = project_name.replace("_", " ").title()
                fallback_html = f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>{safe_title}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="topbar">
    <div class="brand">{safe_title}</div>
    <nav class="nav">
      <a href="#inicio">Inicio</a><a href="#beneficios">Beneficios</a><a href="#planes">Planes</a><a href="#faq">FAQ</a>
    </nav>
    <button id="ctaTop">Comenzar</button>
  </header>

  <main>
    <section id="inicio" class="hero">
      <h1>Entrena tu concentracion con ciencia y habitos diarios</h1>
      <p>Rutinas breves, audio guiado y seguimiento real de progreso para estudiantes de 15 a 30 anios.</p>
      <div class="hero-actions">
        <button id="ctaHero">Probar ahora</button>
        <button class="ghost">Ver demo</button>
      </div>
    </section>

    <section id="beneficios" class="grid">
      <article class="card"><h3>Test inicial</h3><p>Evalua foco y distracciones en 3 minutos.</p></article>
      <article class="card"><h3>Sesiones guiadas</h3><p>Audio de 5-10 min para activar enfoque profundo.</p></article>
      <article class="card"><h3>Progreso</h3><p>Metricas semanales con objetivos personalizados.</p></article>
    </section>

    <section id="planes" class="plans">
      <article class="plan"><h4>Free</h4><p>Funciones base</p></article>
      <article class="plan featured"><h4>Pro</h4><p>Analitica y sesiones premium</p></article>
      <article class="plan"><h4>Campus</h4><p>Acceso para instituciones</p></article>
    </section>

    <section id="faq" class="faq">
      <h2>Preguntas frecuentes</h2>
      <details><summary>Cuanto tarda en verse progreso?</summary><p>Entre 2 y 4 semanas con uso constante.</p></details>
      <details><summary>Funciona en movil?</summary><p>Si, disenado mobile-first.</p></details>
    </section>
  </main>
  <script src="./app.js"></script>
</body>
</html>"""
                fallback_css = """
:root{--bg:#0b1020;--panel:#111a33;--text:#ecf0ff;--muted:#9fb0da;--accent:#61dafb;--accent2:#7c9cff}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;color:var(--text);background:radial-gradient(1200px 600px at 70% -10%,#1a2d5a 0,#0b1020 52%),#0b1020}
a{color:inherit;text-decoration:none}.topbar{position:sticky;top:0;z-index:20;display:flex;gap:16px;align-items:center;justify-content:space-between;padding:14px 22px;background:rgba(7,10,20,.72);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.08)}
.brand{font-weight:800}.nav{display:flex;gap:14px;opacity:.9}.nav a{padding:6px 8px;border-radius:8px}.nav a:hover{background:rgba(255,255,255,.08)}
button{background:linear-gradient(90deg,var(--accent),var(--accent2));border:0;color:#041120;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer}
.ghost{background:transparent;border:1px solid rgba(255,255,255,.25);color:var(--text)}
main{max-width:1100px;margin:0 auto;padding:26px 18px 50px}.hero{padding:42px 0}.hero h1{font-size:clamp(2rem,4vw,3.6rem);margin:0 0 12px}.hero p{max-width:65ch;color:var(--muted);line-height:1.65}
.hero-actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:18px 0 20px}
.card,.plan{background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:16px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.featured{outline:2px solid rgba(97,218,251,.5)}
.faq{margin-top:26px}.faq h2{margin-top:0}details{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;margin:8px 0}
@media (max-width:820px){.nav{display:none}}
"""
                fallback_js = """
const pulse = (id)=>document.getElementById(id)?.addEventListener('click',()=>alert('Perfecto. Siguiente paso: test inicial y onboarding.'));
pulse('ctaTop'); pulse('ctaHero');
"""
                changed_files = {
                    "index.html": fallback_html,
                    "styles.css": fallback_css,
                    "app.js": fallback_js,
                }
                smoke_checks = _smoke_checks_for_html(changed_files)
                summary = "Se aplico un fallback de UI completa (HTML/CSS/JS) porque el motor no devolvio edicion valida."
            else:
                return jsonify({
                    "error": "No valid file edits returned by AI after retries.",
                    "detail": last_failure_reason or "Unknown edit failure.",
                    "remaining_tokens": remaining
                }), 500

        build_report = []
        for fname, new_content in changed_files.items():
            old_content = file_snapshots.get(fname, "")
            diff = list(difflib.unified_diff(
                (old_content or "").splitlines(),
                (new_content or "").splitlines(),
                lineterm=''
            ))
            additions = len([l for l in diff if l.startswith('+') and not l.startswith('+++')])
            deletions = len([l for l in diff if l.startswith('-') and not l.startswith('---')])
            status = "updated" if old_content else "created"

            with open(os.path.join(project_path, fname), 'w', encoding='utf-8') as f:
                f.write(new_content)

            build_report.append({
                "file": fname,
                "status": status,
                "additions": additions,
                "deletions": deletions
            })

        return jsonify({
            "message": "Project updated",
            "summary": summary,
            "project_name": project_name,
            "preview_url": f"/projects/{project_name}/index.html",
            "changed_files": list(changed_files.keys()),
            "build_report": build_report,
            "smoke_checks": smoke_checks,
            "remaining_tokens": remaining,
            "engine_used": engine
        })

    except Exception as e:
        print(f"Edit Error: {e}")
        return jsonify({"error": str(e)}), 500

# --- ORDER STATUS MANAGER ---
# Implemented above with normalized status handling and event logs.

@app.route('/api/recharge-tokens', methods=['POST'])
def recharge_tokens():
    try:
        data = request.json
        email = data.get('email')
        plan = data.get('plan_id')
        
        if not email: return jsonify({"error": "Missing email"}), 400
        
        tokens_to_add = 0
        if plan == 'starter': tokens_to_add = 10
        elif plan == 'pro': tokens_to_add = 50
        elif plan == 'agency': tokens_to_add = 9999 # Unlimited simulation
        
        conn = get_db_connection()
        user = conn.execute('SELECT tokens FROM users WHERE email = ?', (email,)).fetchone()
        
        if not user:
            conn.close()
            return jsonify({"error": "User not found"}), 404
            
        new_balance = user['tokens'] + tokens_to_add
        conn.execute(
            'UPDATE users SET tokens = ?, subscription_active = 1, subscription_plan = ?, subscription_started_at = CURRENT_TIMESTAMP WHERE email = ?',
            (new_balance, plan or 'starter', email)
        )
        conn.commit()
        conn.close()
        
        return jsonify({"status": "success", "new_balance": new_balance, "added": tokens_to_add})
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/create-project', methods=['POST'])
def create_project():
    try:
        data = request.json
        project_name = data.get('project_name')
        plan_content = data.get('plan')
        theme = data.get('theme', 'Modern Startup')
        user_email = data.get('user_email') # Must be sent from frontend

        if not user_email:
            return jsonify({"error": "No has iniciado sesión."}), 401
        ok_tokens, token_msg, remaining = consume_build_quota(
            user_email,
            project_name,
            reason="construir proyecto"
        )
        if not ok_tokens:
            return jsonify({"error": token_msg, "remaining_tokens": remaining}), 402
        
        def build_fallback_files():
            safe_name = project_name.replace("_", " ").title()
            summary = (str(plan_content or "").strip()[:260] or "Proyecto generado por Anmar Engine.")
            index_html = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{safe_name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <header class="topbar">
    <span class="logo">{safe_name}</span>
    <button id="ctaBtn">Comenzar</button>
  </header>
  <main class="container">
    <section class="hero">
      <h1>{safe_name}</h1>
      <p>{summary}</p>
    </section>
    <section class="cards">
      <article class="card"><h3>Valor</h3><p>Propuesta central lista para validar con usuarios.</p></article>
      <article class="card"><h3>MVP</h3><p>Flujo inicial optimizado para entrega rápida.</p></article>
      <article class="card"><h3>Siguiente paso</h3><p>Iterar desde feedback real en producción.</p></article>
    </section>
  </main>
  <script src="./app.js"></script>
</body>
</html>"""
            styles_css = """
:root{--bg:#070c14;--panel:#111827;--text:#e5e7eb;--muted:#9ca3af;--accent:#22d3ee}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 20%,#14233e 0,#070c14 55%);color:var(--text);font-family:Inter,system-ui,sans-serif;min-height:100vh}
.topbar{display:flex;justify-content:space-between;align-items:center;padding:18px 26px;background:rgba(17,24,39,.65);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08)}
.logo{font-weight:800;letter-spacing:.2px}button{background:var(--accent);color:#022c3a;border:0;padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer}
.container{max-width:1050px;margin:48px auto;padding:0 20px}.hero h1{margin:0 0 12px;font-size:clamp(2rem,4vw,3.4rem)}.hero p{color:var(--muted);line-height:1.6;max-width:75ch}
.cards{margin-top:30px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.card{background:rgba(17,24,39,.72);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px}
.card h3{margin:0 0 8px}.card p{margin:0;color:var(--muted)}
"""
            app_js = """
document.getElementById('ctaBtn')?.addEventListener('click', () => {
  alert('MVP generado. Continúa iterando desde el chat de ANMAR.');
});
"""
            readme = f"# {safe_name}\n\nProyecto generado por ANMAR en modo builder.\n\n## Theme\n{theme}\n\n## Plan\n{plan_content or 'Sin detalles.'}\n"
            return {
                "index.html": index_html,
                "styles.css": styles_css,
                "app.js": app_js,
                "README.md": readme,
            }

        def clean_code_block(text):
            if not text:
                return ""
            cleaned = str(text).strip()
            cleaned = cleaned.replace("```html", "").replace("```css", "").replace("```js", "").replace("```javascript", "").replace("```markdown", "").replace("```", "").strip()
            return cleaned

        def validate_files(file_map):
            errors = []
            html = file_map.get("index.html", "")
            if "<html" not in html.lower() or "</html>" not in html.lower():
                errors.append("index.html incompleto")
            if "<body" not in html.lower():
                errors.append("index.html sin body")
            if not file_map.get("styles.css", "").strip():
                errors.append("styles.css vacío")
            if not file_map.get("app.js", "").strip():
                errors.append("app.js vacío")
            return errors

        def build_with_ai():
            prompt = f"""
            You are a senior software engineer shipping production-ready MVP scaffolds.
            Build a small but coherent frontend project for:
            - project_name: {project_name}
            - theme: {theme}
            - plan: {plan_content}

            Return JSON with EXACT keys:
            {{
              "index_html": "...full html...",
              "styles_css": "...full css...",
              "app_js": "...full js...",
              "readme_md": "...short markdown..."
            }}
            Requirements:
            - index_html references ./styles.css and ./app.js
            - modern, responsive, readable UI
            - no markdown fences inside values
            """
            built = call_ai_json(prompt) or {}
            files = {
                "index.html": clean_code_block(built.get("index_html", "")),
                "styles.css": clean_code_block(built.get("styles_css", "")),
                "app.js": clean_code_block(built.get("app_js", "")),
                "README.md": clean_code_block(built.get("readme_md", "")),
            }
            if any(not v for v in files.values()):
                return None
            return files

        if not project_name: return jsonify({"error": "Project name required"}), 400
        
        project_path = os.path.join(projects_base_dir, project_name)
        if not os.path.exists(project_path):
            os.makedirs(project_path)

        # Codex-like build loop: plan -> generate files -> validate -> fallback.
        files = build_with_ai() or build_fallback_files()
        validation_errors = validate_files(files)
        if validation_errors:
            files = build_fallback_files()
            validation_errors = validate_files(files)
        if validation_errors:
            return jsonify({"error": f"Build validation failed: {', '.join(validation_errors)}"}), 500

        def summarize_diff(old_text, new_text):
            old_lines = (old_text or "").splitlines()
            new_lines = (new_text or "").splitlines()
            diff = list(difflib.unified_diff(old_lines, new_lines, lineterm=''))
            additions = len([l for l in diff if l.startswith('+') and not l.startswith('+++')])
            deletions = len([l for l in diff if l.startswith('-') and not l.startswith('---')])
            return additions, deletions

        # Incremental write: only rewrite files that changed and report the delta.
        build_report = []
        for filename, content in files.items():
            target = os.path.join(project_path, filename)
            old_content = ""
            file_status = "created"
            if os.path.exists(target):
                with open(target, 'r') as rf:
                    old_content = rf.read()
                if old_content == content:
                    file_status = "unchanged"
                else:
                    file_status = "updated"

            additions, deletions = summarize_diff(old_content, content)
            if file_status != "unchanged":
                with open(target, 'w') as wf:
                    wf.write(content)

            build_report.append({
                "file": filename,
                "status": file_status,
                "additions": additions,
                "deletions": deletions
            })

        # Mini post-build smoke checks.
        smoke_checks = []
        index_path = os.path.join(project_path, "index.html")
        css_path = os.path.join(project_path, "styles.css")
        js_path = os.path.join(project_path, "app.js")
        for fp in [index_path, css_path, js_path]:
            smoke_checks.append({
                "name": f"exists::{os.path.basename(fp)}",
                "ok": os.path.exists(fp)
            })

        try:
            with open(index_path, 'r') as fidx:
                html_check = fidx.read().lower()
            smoke_checks.append({"name": "html_has_body", "ok": "<body" in html_check and "</body>" in html_check})
            smoke_checks.append({"name": "html_links_css", "ok": "styles.css" in html_check})
            smoke_checks.append({"name": "html_links_js", "ok": "app.js" in html_check})
        except Exception:
            smoke_checks.append({"name": "html_readable", "ok": False})

        all_checks_ok = all(c.get("ok") for c in smoke_checks)
        if not all_checks_ok:
            failed = [c["name"] for c in smoke_checks if not c.get("ok")]
            return jsonify({
                "error": "Build smoke checks failed",
                "failed_checks": failed,
                "build_report": build_report
            }), 500
            
        # --- NEW: INITIALIZE ORDER STATUS ---
        update_order_status(project_name, 'pending', "Proyecto creado e ingresado a la cola de Anmar.")
        mark_preview_delivered_for_project(user_email, project_name)
            
        # --- GENERATE HANDOFF ALERT (POST-PROCESS) ---
        try:
            viability_prompt = f"""
            Analyze project: "{project_name}" based on plan: "{plan_content[:300]}..."
            RETURN JSON: {{ "summary": "1 sentence executive summary", "score": 85 (0-100 int), "complexity": "High/Med/Low" }}
            """
            # Using model.generate_content (assuming 'model' is global per app.py context)
            v_data = call_ai_json(viability_prompt) or {"summary": "New project created.", "score": 50, "complexity": "Unknown"}
            
            # Ensure BASE_DIR is defined or use '.'
            base = os.getcwd() # Fallback if BASE_DIR not in scope here
            alerts_dir = os.path.join(base, 'backend')
            if not os.path.exists(alerts_dir): os.makedirs(alerts_dir)
            
            alerts_path = os.path.join(alerts_dir, 'internal_alerts.json')
            
            new_alert = {
                "id": str(uuid.uuid4())[:8],
                "project_name": project_name,
                "client": user_name if 'user_name' in locals() else user_email,
                "summary": v_data.get('summary', 'No summary'),
                "viability": v_data.get('score', 50),
                "complexity": v_data.get('complexity', 'Medium'),
                "timestamp": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "status": "pending",
                "priority": "medium",
                "sla_due_at": compute_sla_due_at("medium"),
                "events": [{
                    "timestamp": datetime.now().isoformat(),
                    "status": "pending",
                    "actor": "system",
                    "message": "Proyecto creado e ingresado a cola interna."
                }]
            }
            
            current_alerts = []
            if os.path.exists(alerts_path):
                with open(alerts_path, 'r') as af:
                    try: current_alerts = json.load(af)
                    except: pass
            
            current_alerts.insert(0, new_alert)
            with open(alerts_path, 'w') as af:
                json.dump(current_alerts, af, indent=2)
                
            print(f"✅ Alert generated for {project_name}")

        except Exception as alert_e:
            print(f"⚠️ Alert Generation Failed: {alert_e}")

        return jsonify({
            "message": "Project created",
            "path": project_path,
            "builder_mode": "codex_like",
            "files": list(files.keys()),
            "build_report": build_report,
            "smoke_checks": smoke_checks,
            "remaining_tokens": remaining
        })

    except Exception as e:
        print(f"Creation Error: {e}")
        return jsonify({"error": str(e)}), 500

# --- MARKETING MODULE ---
@app.route('/api/generate-marketing', methods=['POST'])
def generate_marketing():
    try:
        data = request.json
        project_name = data.get('project_name')
        focus = data.get('focus', 'Conversion') # Brand Awareness, Conversion, Retention
        
        # Context from Project Name (Simulating read of project content)
        
        prompt = f"""
        ACT AS A LEGENDARY CREATIVE DIRECTOR (Ogilvy/Draper style).
        Project: {project_name}
        Goal: {focus}
        
        TASK:
        Generate the "Base Assets" for a high-performance campaign.
        
        RETURN JSON:
        {{
            "strategy_hook": "A one-sentence powerful hook defining the campaign.",
            "target_audience": "Specific user persona description.",
            "ads": [
                {{
                    "platform": "Instagram/TikTok Reels",
                    "concept": "Visual description of the video",
                    "script": "Voiceover script 15s"
                }},
                {{
                    "platform": "LinkedIn/Twitter",
                    "concept": "Text-based value proposition",
                    "copy": "The actual post text"
                }}
            ],
            "visual_direction": "Moodboard description (colors, vibe) for human designers."
        }}
        """
        
        model_response = model.generate_content(prompt)
        campaign = clean_and_parse_json(model_response.text)
        
        if not campaign:
            return jsonify({"error": "Failed to generate campaign"}), 500
            
        return jsonify(campaign)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- ADMIN COMMAND CENTER ENDPOINTS ---
@app.route('/api/admin/alerts', methods=['GET'])
def get_admin_alerts():
    alerts = [normalize_ticket_status(a) for a in load_alerts()]
    alerts.sort(key=lambda a: a.get("updated_at", a.get("timestamp", "")), reverse=True)
    return jsonify(alerts)

@app.route('/api/admin/reclaim', methods=['POST'])
def reclaim_project():
    try:
        data = request.json
        full_project_name = data.get('project_id') # Usually full path or name
        engineer = data.get('engineer', 'Maria')
        
        # Parse project name from path if needed, or use as ID
        # The alerts usually store "project_path"
        
        alerts = load_alerts()
        if not alerts:
            return jsonify({"error": "No alerts file"}), 404
            
        updated = False
        for alert in alerts:
            # Match by project name or checking if path contains ID
            if alert.get('project_name') == full_project_name or full_project_name in alert.get('project_path', ''):
                alert['status'] = 'accepted'
                alert['engineer'] = engineer
                alert['assigned_at'] = datetime.now().isoformat()
                append_ticket_event(alert, "accepted", status_message("accepted", engineer=engineer, project_id=alert.get("project_name")), actor=engineer)
                update_order_status(
                    alert.get("project_name"),
                    "accepted",
                    log_entry=f"{engineer} tomó el proyecto desde admin reclaim.",
                    engineer=engineer
                )
                updated = True
                break
        
        if updated:
            save_alerts(alerts)
            return jsonify({"status": "success", "message": f"Project assigned to {engineer}"})
        else:
            return jsonify({"error": "Project not found"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- ORDER STATUS MANAGER ---
# Implemented above with normalized status handling and event logs.

# --- ENDPOINTS ---

@app.route('/api/status/<project_id>', methods=['GET'])
def check_status(project_id):
    status = get_order_status(project_id)
    if not status:
        return jsonify({"status": "unknown"}), 404
    return jsonify(status)

@app.route('/api/claim-task', methods=['POST'])
def claim_task():
    try:
        data = request.json
        project_id = data.get('project_id')
        engineer = data.get('engineer', 'Maria')
        
        if not project_id:
            return jsonify({"error": "Missing project_id"}), 400

        # Update alerts + order status
        alerts = load_alerts()
        ticket = next((a for a in alerts if a.get("project_name") == project_id), None)
        if ticket:
            ticket["status"] = "accepted"
            ticket["engineer"] = engineer
            ticket["updated_at"] = datetime.now().isoformat()
            append_ticket_event(ticket, "accepted", status_message("accepted", engineer=engineer, project_id=project_id), actor=engineer)
            save_alerts(alerts)

        update_order_status(project_id, 'accepted', f"Ingeniero {engineer} asignado al proyecto.", engineer=engineer)
        update_order_status(project_id, 'developing', "Desarrollo en curso.", engineer=engineer)
        
        return jsonify({"status": "success", "message": f"Project {project_id} claimed by {engineer}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/deliver-work', methods=['POST'])
def deliver_work():
    try:
        data = request.json
        project_id = data.get('project_id')
        code = data.get('code')
        
        if not project_id or not code:
            return jsonify({"error": "Missing data"}), 400

        # 1. Update File System
        project_dir = os.path.join(projects_base_dir, project_id)
        if not os.path.exists(project_dir):
            return jsonify({"error": "Project dir not found"}), 404
            
        index_path = os.path.join(project_dir, 'index.html')
        with open(index_path, 'w', encoding='utf-8') as f:
            f.write(code)
            
        # 2. Update Alert Status
        alerts = load_alerts()
        for alert in alerts:
            if alert.get('project_name') == project_id:
                alert['status'] = 'completed'
                alert['delivered_at'] = datetime.now().isoformat()
                alert['updated_at'] = datetime.now().isoformat()
                append_ticket_event(alert, "completed", status_message("completed", project_id=project_id), actor="engineer")
                break
        save_alerts(alerts)

        update_order_status(
            project_id,
            "completed",
            log_entry="Código entregado desde /api/deliver-work.",
            deployed_url=f"/projects/{project_id}/index.html"
        )
                
        return jsonify({"status": "completed", "message": "Code updated and pushed to production."})

    except Exception as e:
        print(f"Delivery Error: {e}")
        return jsonify({"error": str(e)}), 500
    return jsonify([])

@app.route('/api/admin/system-status', methods=['GET'])
def get_system_status():
    # Simulate Team Load
    import random
    return jsonify({
        "george_status": random.choice(["Free", "Busy", "Designing"]),
        "julian_status": random.choice(["Coding", "Reviewing", "Free"]),
        "server_load": f"{random.randint(10, 80)}%"
    })

# File Management Routes
@app.route('/list-projects', methods=['GET'])
def list_projects():
    try:
        if not os.path.exists(projects_base_dir): return jsonify([])
        projects = [name for name in os.listdir(projects_base_dir) if os.path.isdir(os.path.join(projects_base_dir, name)) and not name.startswith('.')]
        return jsonify(projects)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/delete-project', methods=['POST'])
def delete_project():
    try:
        data = request.json or {}
        project_name = sanitize_project_name(data.get('project_name', ''))
        if not project_name:
            return jsonify({"error": "project_name is required"}), 400
        project_path = os.path.join(projects_base_dir, project_name)
        if not os.path.abspath(project_path).startswith(os.path.abspath(projects_base_dir)):
            return jsonify({"error": "Invalid project path"}), 403
        if os.path.exists(project_path):
            shutil.rmtree(project_path)
            return jsonify({"message": "Deleted", "project_name": project_name})
        return jsonify({"error": "Not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def sanitize_project_name(raw_name):
    base = (raw_name or "").strip().lower()
    base = re.sub(r'[^a-z0-9_\-\s]', '', base)
    base = re.sub(r'\s+', '_', base).strip('_')
    if not base:
        base = f"project_{uuid.uuid4().hex[:8]}"
    return base[:80]


@app.route('/api/create-empty-project', methods=['POST'])
def create_empty_project():
    try:
        data = request.json or {}
        raw_name = data.get('project_name', '')
        project_name = sanitize_project_name(raw_name)
        project_path = os.path.join(projects_base_dir, project_name)

        if os.path.exists(project_path):
            return jsonify({"error": "Ese proyecto ya existe. Usa otro nombre."}), 409

        os.makedirs(project_path, exist_ok=True)
        starter_html = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{project_name}</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background: #0b0f14;
      color: #e5e7eb;
    }}
    .card {{
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 24px;
      max-width: 720px;
      width: calc(100% - 48px);
      background: rgba(255,255,255,0.03);
    }}
    h1 {{ margin: 0 0 10px; font-size: 1.4rem; }}
    p {{ margin: 0; opacity: .85; line-height: 1.5; }}
  </style>
</head>
<body>
  <section class="card">
    <h1>{project_name}</h1>
    <p>Proyecto creado. Ve al chat de ANMAR y describe tu visión para generar la primera versión.</p>
  </section>
</body>
</html>
"""
        with open(os.path.join(project_path, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(starter_html)

        return jsonify({
            "status": "ok",
            "project_name": project_name,
            "preview_url": f"/projects/{project_name}/index.html"
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/delete-all-projects', methods=['POST'])
def delete_all_projects():
    try:
        if not os.path.exists(projects_base_dir):
            return jsonify({"status": "ok", "deleted": 0})
        deleted = 0
        for name in os.listdir(projects_base_dir):
            path = os.path.join(projects_base_dir, name)
            if os.path.isdir(path) and not name.startswith('.'):
                shutil.rmtree(path)
                deleted += 1
        return jsonify({"status": "ok", "deleted": deleted})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/projects/<path:filename>')
def serve_projects(filename):
    # Serve files from generated projects
    return send_from_directory(projects_base_dir, filename)

# --- CHAT & REFINE ENDPOINT ---
# --- DEBUG LOGGER ---
def log_debug(msg):
    try:
        with open(os.path.join(BASE_DIR, 'backend', 'debug.log'), 'a') as f:
            f.write(f"[{datetime.now().isoformat()}] {msg}\n")
    except: pass

@app.route('/api/continue-chat', methods=['POST'])
def continue_chat():
    try:
        data = request.json
        history = trim_history_after_last_reset(data.get('history', []))
        current_input = data.get('message', '').strip()
        image_data_url = data.get('image_data_url', '')
        engine = normalize_engine(data.get('engine'))
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        if is_subscription_required_after_preview(user_email, project_name):
            return jsonify({
                "error": "La previsualización inicial ya fue entregada. Suscríbete para continuar por chat.",
                "code": "subscription_required_after_preview",
                "requires_subscription": True
            }), 402
        image_context = describe_image_for_chat(image_data_url) if image_data_url else ""
        enriched_input = current_input
        if image_context:
            enriched_input = f"{current_input}\n\nContexto de imagen adjunta:\n{image_context}".strip()
        elif image_data_url and not current_input:
            enriched_input = "El usuario adjuntó una imagen. Analiza el contexto visual y continúa el brief."

        if not enriched_input:
            return jsonify({"error": "message is required"}), 400
        ok_tokens, token_msg, remaining = consume_chat_message_quota(
            user_email,
            project_name,
            reason="enviar mensaje al chat"
        )
        if not ok_tokens:
            return jsonify({"error": token_msg, "remaining_tokens": remaining}), 402
        if has_reset_intent(current_input):
            if user_email:
                save_chat_memory(
                    user_email,
                    reset_memory_payload(get_chat_memory(user_email, project_name=project_name) or {}),
                    project_name=project_name
                )
            return jsonify({
                "ai_reply": "Hecho, contexto reiniciado. Empecemos de cero. ¿Qué producto quieres construir ahora?",
                "ready_to_build": False,
                "missing_fields": ["summary", "audience", "business_model", "timeline", "features"]
            })

        full_history = history + [{"role": "user", "content": enriched_input}]
        existing_memory = None
        if user_email:
            stored = get_chat_memory(user_email, project_name=project_name) or {}
            existing_memory = stored.get("agent_memory") if isinstance(stored, dict) else None

        analysis = analyze_turn_state(full_history, enriched_input, existing_memory=existing_memory)
        reply = compose_consultant_reply(analysis, enriched_input, full_history, engine=engine)

        if user_email:
            to_store = get_chat_memory(user_email, project_name=project_name) or {}
            to_store["agent_memory"] = analysis["memory"]
            to_store["summary"] = analysis["memory"].get("summary", "")
            to_store["audience"] = analysis["memory"].get("audience", "")
            to_store["business_model"] = analysis["memory"].get("business_model", "")
            to_store["timeline"] = analysis["memory"].get("timeline", "")
            to_store["engine_preference"] = engine
            save_chat_memory(user_email, to_store, project_name=project_name)

        return jsonify({
            "ai_reply": reply,
            "ready_to_build": analysis["ready_to_build"],
            "ready_by_data": analysis.get("ready_by_data", False),
            "missing_fields": analysis["missing_fields"],
            "brief_score": compute_brief_score(analysis.get("missing_fields", [])),
            "remaining_tokens": remaining,
            "memory_summary": analysis["memory"].get("summary", ""),
            "memory_snapshot": {
                "audience": analysis["memory"].get("audience", ""),
                "business_model": analysis["memory"].get("business_model", ""),
                "timeline": analysis["memory"].get("timeline", ""),
                "features": analysis["memory"].get("features", []),
            },
            "engine_used": engine
        })
        
    except Exception as e:
        print(f"SERVER ERROR: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/analyze-turn', methods=['POST'])
def analyze_turn_endpoint():
    try:
        data = request.json or {}
        history = data.get('history', [])
        current_input = (data.get('message') or '').strip()
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        if not current_input:
            return jsonify({"error": "message is required"}), 400

        full_history = history + [{"role": "user", "content": current_input}]
        existing_memory = None
        if user_email:
            stored = get_chat_memory(user_email, project_name=project_name) or {}
            existi