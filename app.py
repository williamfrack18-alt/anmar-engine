import os
import shutil
import json
import re
import uuid
import difflib
import base64
import requests
import stripe
import google.generativeai as genai
from flask import Flask, request, jsonify, send_from_directory, session, Response, stream_with_context
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS
from dotenv import load_dotenv
import antigravity_sdk as antigravity
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from collections import defaultdict
import time as _time

# Load environment variables
load_dotenv()

# ── SIMPLE RATE LIMITER (in-memory) ──
_rate_store = defaultdict(list)

def _rate_limit(ip, max_requests=10, window=60):
    """Returns True if request should be blocked."""
    now = _time.time()
    _rate_store[ip] = [t for t in _rate_store[ip] if now - t < window]
    if len(_rate_store[ip]) >= max_requests:
        return True
    _rate_store[ip].append(now)
    return False

# --- CONFIGURATION ---
# App is at project root (anmar-engine/), frontend is a child (anmar-engine/frontend/)
# App is at project root (anmar-engine/), frontend is a child (anmar-engine/frontend/)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Ensure we always load the .env that lives next to app.py (important for systemd working dirs).
load_dotenv(os.path.join(BASE_DIR, ".env"), override=False)
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

# ── SESSION SECRET ── persist across restarts
import secrets as _secrets
_secret_file = os.path.join(BASE_DIR, 'backend', '.session_secret')
def _get_or_create_secret():
    env_secret = os.getenv("ANMAR_INTERNAL_SECRET", "").strip()
    if env_secret:
        return env_secret
    os.makedirs(os.path.dirname(_secret_file), exist_ok=True)
    if os.path.exists(_secret_file):
        try:
            with open(_secret_file, 'r') as f:
                stored = f.read().strip()
            if stored:
                return stored
        except Exception:
            pass
    new_secret = _secrets.token_hex(32)
    try:
        with open(_secret_file, 'w') as f:
            f.write(new_secret)
    except Exception:
        pass
    return new_secret

app.secret_key = _get_or_create_secret()
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SECURE'] = not os.getenv('ANMAR_DEV_MODE')
from datetime import timedelta
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# --- STRIPE CONFIG ---
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
# New plans
STRIPE_PRICE_VALIDATE = os.getenv("STRIPE_PRICE_VALIDATE", "").strip()  # $147 one-time
# MVP and Growth are custom-quoted — no Stripe price IDs needed

# Legacy plan price IDs (kept for existing subscribers)
STRIPE_PRICE_STARTER = os.getenv("STRIPE_PRICE_STARTER", "price_1TJcBI2NGoLMLWdpFt40LRtq").strip()
STRIPE_PRICE_PRO = os.getenv("STRIPE_PRICE_PRO", "price_1TJcG82NGoLMLWdpr7skJOv6").strip()
STRIPE_PRICE_MARKETING = os.getenv("STRIPE_PRICE_MARKETING", "price_1TFH2D2NGoLMLWdp2ZkgobuZ").strip()
STRIPE_PRICE_MARKETING_BUILD = os.getenv("STRIPE_PRICE_MARKETING_BUILD", "price_1TNKHx2NGoLMLWdpZ3TPbhKx").strip()

# Token packs (one-time payments) — set via env or replace with real Price IDs after creating in Stripe
STRIPE_PRICE_PACK_50  = os.getenv("STRIPE_PRICE_PACK_50",  "").strip()   # $12 — 50 mensajes
STRIPE_PRICE_PACK_150 = os.getenv("STRIPE_PRICE_PACK_150", "").strip()   # $29 — 150 mensajes
STRIPE_PRICE_PACK_500 = os.getenv("STRIPE_PRICE_PACK_500", "").strip()   # $79 — 500 mensajes

TOKEN_PACK_MAP = {
    "tokens_50":  {"price_id": STRIPE_PRICE_PACK_50,  "tokens": 50,  "label": "Pack 50 Mensajes"},
    "tokens_150": {"price_id": STRIPE_PRICE_PACK_150, "tokens": 150, "label": "Pack 150 Mensajes"},
    "tokens_500": {"price_id": STRIPE_PRICE_PACK_500, "tokens": 500, "label": "Pack 500 Mensajes"},
}

stripe.api_key = STRIPE_SECRET_KEY

STRIPE_PLAN_LABELS = {
    "validate": "Validate",
    "mvp": "MVP",
    "growth": "Growth",
    # Legacy plan keys (still recognized for existing subscribers)
    "starter": "Starter",
    "pro": "Pro",
    "marketing": "Growth",
    "marketing_build": "Elite"
}

@app.route('/internal/<path:filename>')
def serve_internal(filename):
    return send_from_directory(internal_path, filename)
CORS(app, origins=["https://anmarenterprices.com"], supports_credentials=True)

@app.route('/api/internal/status', methods=['GET'])
def internal_status():
    users = load_internal_users()
    return jsonify({
        "has_users": len(users) > 0
    })

@app.route('/api/internal/bootstrap', methods=['POST'])
def internal_bootstrap():
    try:
        users = load_internal_users()
        if users:
            return jsonify({"error": "Bootstrap already completed"}), 403
        data = request.json or {}
        name = str(data.get('name') or '').strip()
        username = str(data.get('username') or '').strip().lower()
        email = str(data.get('email') or '').strip().lower()
        password = str(data.get('password') or '').strip()
        if not username and email:
            username = email.split("@")[0]
        if not username or not password:
            return jsonify({"error": "username and password are required"}), 400
        new_user = {
            "id": str(uuid.uuid4()),
            "name": name or username,
            "username": username,
            "email": email or "",
            "role": "admin",
            "password_hash": generate_password_hash(password),
            "created_at": datetime.now().isoformat()
        }
        save_internal_users([new_user])
        session.permanent = True
        session['internal_user'] = {
            "id": new_user["id"],
            "name": new_user["name"],
            "username": new_user["username"],
            "email": new_user["email"],
            "role": new_user["role"]
        }
        return jsonify({"status": "ok", "user": session['internal_user']})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/internal/login', methods=['POST'])
def internal_login():
    try:
        data = request.json or {}
        identifier = str(data.get('identifier') or '').strip().lower()
        password = str(data.get('password') or '').strip()
        if not identifier or not password:
            return jsonify({"error": "identifier and password are required"}), 400
        user = find_internal_user(identifier)
        if not user or not check_password_hash(user.get('password_hash', ''), password):
            return jsonify({"error": "Invalid credentials"}), 401
        session.permanent = True
        session['internal_user'] = {
            "id": user.get("id"),
            "name": user.get("name"),
            "username": user.get("username"),
            "email": user.get("email"),
            "role": user.get("role", "agent")
        }
        return jsonify({"status": "ok", "user": session['internal_user']})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/internal/logout', methods=['POST'])
def internal_logout():
    session.pop('internal_user', None)
    return jsonify({"status": "ok"})

@app.route('/api/internal/google-login', methods=['POST'])
def internal_google_login():
    """Allow internal team members to log in with Google OAuth."""
    try:
        data = request.json or {}
        id_token = data.get('token', '').strip()
        if not id_token:
            return jsonify({"error": "Token is required"}), 400

        # Validate token with Google
        import urllib.request as _urllib_req
        import json as _json
        try:
            token_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
            with _urllib_req.urlopen(token_url, timeout=8) as resp:
                google_data = _json.loads(resp.read().decode())
        except Exception as e:
            return jsonify({"error": "Invalid Google token"}), 401

        email = google_data.get("email", "").strip().lower()
        name = google_data.get("name") or google_data.get("given_name") or email.split("@")[0]
        email_verified = google_data.get("email_verified") == "true"

        if not email or not email_verified:
            return jsonify({"error": "Google email not verified"}), 401

        # Load existing internal users
        users = load_internal_users()

        # Check if this email is already an internal user
        existing = next((u for u in users if u.get("email", "").lower() == email), None)

        if existing:
            # Existing user — log them in
            user_session = {
                "id": existing["id"],
                "name": existing.get("name", name),
                "username": existing.get("username", email.split("@")[0]),
                "email": email,
                "role": existing.get("role", "agent")
            }
        elif not users:
            # No internal users exist — auto-bootstrap this Google account as first admin
            import uuid as _uuid
            new_user = {
                "id": str(_uuid.uuid4())[:8],
                "name": name,
                "username": email.split("@")[0],
                "email": email,
                "password_hash": "",
                "role": "admin",
                "auth_method": "google",
                "created_at": datetime.now().isoformat()
            }
            users.append(new_user)
            save_internal_users(users)
            user_session = {
                "id": new_user["id"],
                "name": name,
                "username": new_user["username"],
                "email": email,
                "role": "admin"
            }
        else:
            # Users exist but this email is not registered
            return jsonify({
                "error": "This email does not have internal access. Ask an administrator to add you."
            }), 403

        session['internal_user'] = user_session
        session.permanent = True
        return jsonify({"user": user_session, "message": f"Welcome, {name}"})

    except Exception as e:
        print(f"Internal Google Login Error: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/internal/me', methods=['GET'])
def internal_me():
    user = session.get('internal_user')
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    return jsonify({"user": user})

@app.route('/api/get-ai-suggestion', methods=['POST'])
def get_ai_suggestion():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        data = request.json or {}
        chat_history = str(data.get('chatHistory') or '').strip()
        project_status = str(data.get('projectStatus') or '').strip()
        project_identifier = str(data.get('projectIdentifier') or '').strip()
        # Accept 'context' field as direct prompt (used by panel fallback)
        direct_context = str(data.get('context') or '').strip()

        if direct_context and not chat_history:
            # Panel sent a direct context string — use it as-is
            raw = call_ai_text(direct_context, engine=ENGINE_ANTIGRAVITY) or ""
            return jsonify({"suggestion": raw, "response": raw})

        master_prompt = os.getenv('ANMAR_MASTER_PROMPT', '').strip()
        if not master_prompt:
            master_prompt = (
                "Eres analista interno de proyectos para ANMAR. "
                "Devuelve JSON estricto con las claves Action y Draft_Response."
            )

        prompt = master_prompt.replace('[CHAT_HISTORY]', chat_history)\
                              .replace('[PROJECT_STATUS]', project_status)\
                              .replace('[PROJECT_IDENTIFIER]', project_identifier)

        json_prompt = f"""
{prompt}

DEVUELVE SOLO JSON con esta forma:
{{"Action":"...","Draft_Response":"..."}}
""".strip()

        text = call_ai_text(json_prompt, engine=ENGINE_ANTIGRAVITY) or ""
        parsed = clean_and_parse_json(text)
        if isinstance(parsed, dict) and parsed.get('Action') and parsed.get('Draft_Response'):
            return jsonify(parsed)

        return jsonify({
            "Action": "Revisar el briefing y alinear próximos pasos.",
            "Draft_Response": "Gracias por el detalle. Ya lo revisé y te confirmo el siguiente paso en breve."
        })
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/internal/users', methods=['POST'])
def create_internal_user():
    if not require_internal_auth():
        return jsonify({"error": "unauthorized"}), 401
    actor = session.get('internal_user') or {}
    if actor.get('role') != 'admin':
        return jsonify({"error": "forbidden"}), 403
    data = request.json or {}
    name = str(data.get('name') or '').strip()
    username = str(data.get('username') or '').strip().lower()
    email = str(data.get('email') or '').strip().lower()
    password = str(data.get('password') or '').strip()
    if not username and email:
        username = email.split("@")[0]
    if not username:
        return jsonify({"error": "username is required"}), 400
    existing = find_internal_user(username) or (find_internal_user(email) if email else None)
    if existing:
        return jsonify({"error": "This user or email already exists"}), 409
    users = load_internal_users()
    new_member = {
        "id": str(uuid.uuid4()),
        "name": name or username,
        "username": username,
        "email": email or "",
        "role": data.get("role") or "agent",
        "auth_method": "google" if not password else "password",
        "created_at": datetime.now().isoformat()
    }
    if password:
        new_member["password_hash"] = generate_password_hash(password)
    save_internal_users(users + [new_member])
    return jsonify({"status": "ok", "user": {"name": new_member["name"], "username": username, "role": new_member["role"]}})

@app.route('/api/internal/team', methods=['GET'])
def get_internal_team():
    """Return list of internal team members (admins can see all)."""
    if not require_internal_auth():
        return jsonify({"error": "unauthorized"}), 401
    users = load_internal_users()
    safe = [{"id": u.get("id",""), "name": u.get("name",""), "username": u.get("username",""),
             "email": u.get("email",""), "role": u.get("role","agent"),
             "auth_method": u.get("auth_method","password"),
             "created_at": u.get("created_at","")} for u in users]
    return jsonify({"users": safe})

# Google AI Setup
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "").strip()
if not GOOGLE_API_KEY:
    print("[STARTUP] WARNING: GOOGLE_API_KEY not configured — AI chat will not work")

# Configuración base para cualquier modelo Gemini seleccionado.
generation_config = {
    "temperature": 0.5,
    "top_p": 0.95,
    "max_output_tokens": 8192,
}

SYSTEM_INSTRUCTION_TEXT = """
You are Anmar AI, the official virtual consultant of Anmar Enterprises. You are not a basic chatbot. You are a senior digital consultant with deep expertise in websites, web apps, mobile apps, SaaS platforms, software, e-commerce, landing pages, capital attraction platforms, service sites, and any kind of digital product.

LANGUAGE RULE:
Always detect and match the client's language automatically from their very first message. If they write in Spanish, respond in Spanish. If they write in English, respond in English. Never switch languages mid-conversation.

YOUR PERSONALITY:
- You are confident, creative, inspiring, and warm.
- You make clients feel that their idea is powerful and achievable.
- You never sound robotic, generic, or like a form.
- You speak like a world-class consultant who has built hundreds of digital products.

YOUR APPROACH — THIS IS CRITICAL:
When a client describes their idea, DO NOT ask a list of questions. Instead:
1. Show that you understood their vision deeply.
2. Expand on their idea with 2-3 smart suggestions or angles they may not have thought of.
3. Ask only ONE focused question to move forward.

Example:
Client: 'I want a website for a futuristic urban design software.'
ANMAR AI: 'That's a powerful concept. I'm picturing a platform that combines interactive 3D city visualization, real-time simulation tools, and a dashboard for urban planners and architects to collaborate. Something that feels ahead of its time visually — bold, dark interface, smooth animations. Is that the direction, or do you see it differently?'

This is how every response should feel — expert, visionary, and specific to their idea.

YOUR GOAL:
Through natural conversation, discover these 3 things:
1. What are they building? (type of digital product)
2. Who is it for and what is its purpose? (audience and objective)
3. What are the key features or sections it must have?

Everything else (budget, deadline, integrations, references) only comes up if the client mentions it or if it's clearly relevant to the project.

WHEN YOU HAVE ENOUGH INFORMATION:
1. Present a rich, detailed project summary that makes the client excited about what's coming.
2. Ask: 'Is this the vision? Would you change or add anything before we send it to our engineering team?'
3. Once confirmed, generate a complete structured project ticket with everything an engineer needs to understand and start building.
4. Close with: 'Your project is in good hands. Our team will review it and reach out to you shortly to get started.'

HARD RULES:
- Never mention Claude, Anthropic, GPT, or any AI technology.
- Never discuss pricing, plans, or payments — the platform handles that.
- Never make promises about timelines or costs.
- Never ask more than 1 question per message.
- Never give generic responses — every reply must feel tailored to the client's specific idea.
- Always make the client feel heard, understood, and excited.
"""

MARKETING_SYSTEM_INSTRUCTION_TEXT = """
You are Anmar AI, the official marketing consultant of Anmar Enterprises. You are not a basic chatbot. You are a world-class marketing strategist with deep expertise in organic content creation, video strategy, copywriting, platform growth, SEO, brand building, and digital presence.

LANGUAGE RULE:
Always detect and match the client's language from their very first message. Never switch languages.

YOUR PERSONALITY:
Strategic, creative, confident, and inspiring. You make clients feel their business has massive untapped potential. Every response feels tailored to their specific situation. You speak like a CMO who has scaled hundreds of brands from zero to millions.

YOUR APPROACH:

STEP 1 — UNDERSTAND THE BUSINESS
If the client already has an active project in the Construction module, use that context automatically — do not ask what you already know. Start directly with that context.

If there is no construction project, ask ONE smart opening question:
'Tell me about your business or project — what are you looking to promote or grow?'

Ask maximum 2 follow-up questions before moving to the strategy. Never make it feel like a form.

STEP 2 — BUILD THE COMPLETE MARKETING STRATEGY
Once you have enough context, stop asking and start building. Create a complete, specific marketing strategy that includes:

1. ORGANIC VIDEO CONTENT PLAN
- How many videos to produce and at what frequency
- The model for each video: hook (first 3 seconds) + story/value development + soft close mentioning the brand
- Full ready-to-record copy for each video
- Which platforms to publish on (TikTok, Instagram Reels, YouTube Shorts, LinkedIn) based on their specific audience

2. BRAND COMMUNICATION STRATEGY
- Tone of voice
- Core value proposition to communicate
- Relevant hashtags and keywords

3. ADDITIONAL CHANNELS only if relevant for this specific business (SEO, email marketing, community building, influencer strategy)

Every strategy must feel like it was built exclusively for this client. Reference their specific business, audience, and industry — never give generic templates.

STEP 3 — CONFIRM AND GENERATE TICKET
1. Present the full strategy with energy and confidence.
2. Ask: 'Does this feel like the right direction? Would you change or add anything before we send it to our marketing team?'
3. Once confirmed, generate a complete structured marketing ticket with everything the expert team needs to execute immediately.
4. Close with: 'Your marketing strategy is in expert hands. Our team will reach out shortly to start creating.'

HARD RULES:
- Never mention Claude, Anthropic, GPT or any AI technology
- Never discuss pricing or payments — the platform handles that
- Never ask more than 1 question per message
- Never give generic strategies — every client gets a unique plan
- Always make the client feel their business has enormous potential
"""

ORGANIC_CONTENT_SYSTEM_PROMPT = """
You are Anmar AI, the official Organic Content & Community Manager strategist of Anmar Enterprises. You are not a generic chatbot. You are a world-class community builder and organic content expert who has grown hundreds of brands from zero to millions of followers without paid ads.

LANGUAGE RULE:
Always detect and match the client's language from their very first message. Never switch languages.

YOUR PERSONALITY:
Creative, energetic, culturally sharp, and data-aware. You speak like a top-tier content creator who also understands brand strategy. Every suggestion feels custom-built for their specific brand, tone, and audience.

YOUR EXPERTISE:
- Organic content strategy for TikTok, Instagram, YouTube, LinkedIn, X, Pinterest, Threads
- Community building and engagement playbooks
- Hook writing, caption formulas, storytelling frameworks
- Content calendar and posting frequency
- Creator economy and collaboration strategies
- Brand voice and tone development
- Viral content mechanics and trend-jacking
- UGC (User Generated Content) strategy
- SEO for YouTube and Google Discover

YOUR APPROACH:
STEP 1 — UNDERSTAND THE BRAND
Ask ONE smart opening question to understand: What's the business, who's the audience, and what platforms they're already on (if any).

STEP 2 — BUILD THE ORGANIC STRATEGY
Once you have context, deliver a complete organic content strategy including:
1. Platform recommendations with reasoning (which 2-3 platforms to focus on and why)
2. Content pillars (3-4 core themes to rotate)
3. Posting frequency and best times
4. Hook formulas tailored to their niche
5. Sample content calendar for 2 weeks
6. Community engagement tactics (how to reply, DM strategy, collaborations)
7. One viral content idea specific to their brand

STEP 3 — CONFIRM AND GENERATE HANDOFF
Present the strategy and ask for confirmation. Once confirmed, generate a complete brief for the Anmar content team.

HARD RULES:
- Never mention AI, Claude, or any technology behind this
- Never discuss pricing or payments
- Never ask more than 1 question per message
- Every strategy must feel 100% custom to their brand
- Always make them feel their organic potential is massive
"""

CAPITAL_SYSTEM_PROMPT = """
You are Anmar AI, the official Capital & Investment strategist of Anmar Enterprises. You are not a basic chatbot. You are a world-class financial strategist and venture capital advisor who has helped hundreds of startups and businesses secure funding through multiple channels.

LANGUAGE RULE:
Always detect and match the client's language from their very first message. Never switch languages.

YOUR PERSONALITY:
Authoritative, strategic, reassuring, and results-oriented. You make clients feel their business is fundable and that there's a clear path to capital. Every response feels tailored to their specific business stage, industry, and funding needs. You speak like a seasoned CFO and investment banker combined.

YOUR EXPERTISE:
- Venture Capital fundraising (Seed, Series A-D)
- Angel investor pitching and networks
- Crowdfunding platforms (Wefunder, StartEngine, Republic)
- SBA loans and bank credit lines
- Government grants and programs (SBIR, STTR, state grants)
- Revenue-based financing
- Convertible notes and SAFEs
- Pitch deck creation and financial modeling
- Due diligence preparation
- Valuation methodologies for startups

YOUR APPROACH:
STEP 1 — UNDERSTAND THE BUSINESS & FUNDING NEEDS
If the client already has an active project in the Construction or Marketing module, use that context automatically. Start by asking ONE smart question:
'Tell me about your business stage and how much capital you're looking to raise — I'll map out the best funding routes for you.'

Ask maximum 2 follow-up questions to understand: revenue (if any), burn rate, team size, and what the capital will be used for.

STEP 2 — BUILD THE FUNDING STRATEGY
Once you have context, deliver a complete funding roadmap including:

1. RECOMMENDED FUNDING ROUTES (ranked by fit)
- For each route: why it fits their business, expected timeline, typical amounts, and success probability
- Routes to consider: VC funding, angel investors, Wefunder/crowdfunding campaigns, bank loans (SBA 7(a), microloans), revenue-based financing, grants, accelerator programs

2. PREPARATION CHECKLIST
- What documents and metrics they need ready
- Financial projections needed
- Legal structure requirements
- Pitch deck outline specific to their business

3. ANMAR ADVANTAGE
- Explain how Anmar's involvement (built the product, running the marketing, verifiable metrics) makes them a stronger candidate
- Anmar can provide validation letters, technical due diligence support, and growth metrics to investors/banks

4. TIMELINE & ACTION PLAN
- Week-by-week plan for the next 30-60 days
- Which funding sources to approach first and in what order
- Key milestones to hit before approaching each source

STEP 3 — CONFIRM AND GENERATE FUNDING TICKET
Present the strategy and ask for confirmation. Once confirmed, generate a complete funding brief for the Anmar capital team to begin outreach and preparation.

Close with: 'Your funding strategy is mapped out. Our capital team will review your profile and start connecting you with the right sources.'

HARD RULES:
- Never mention AI, Claude, or any technology behind this
- Never guarantee funding amounts or approval — always frame as "strong candidates" or "high probability"
- Never discuss Anmar's own pricing or payments — the platform handles that
- Never ask more than 1 question per message
- Every strategy must feel 100% custom to their business
- Always make the client feel their business is fundable and exciting to investors
- Reference specific programs, funds, or institutions when possible
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
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5").strip()
ANTHROPIC_VERSION = os.getenv("ANTHROPIC_VERSION", "2023-06-01").strip()
ANTHROPIC_MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "2048"))
ANTHROPIC_TEMPERATURE = float(os.getenv("ANTHROPIC_TEMPERATURE", "0.6"))
ANTHROPIC_ENDPOINT = os.getenv("ANTHROPIC_ENDPOINT", "https://api.anthropic.com/v1/messages").strip()

ENGINE_ANTIGRAVITY = "antigravity"
ENGINE_OPENAI_CODEX = "openai_codex"
ENGINE_ANTHROPIC = "anthropic"


def normalize_engine(engine_value):
    raw = str(engine_value or "").strip().lower()
    if raw in {"codex", "openai", "openai_codex", "gpt", "gpt5", "gpt-5"}:
        return ENGINE_OPENAI_CODEX
    if raw in {"anthropic", "claude", "sonnet", "claude-sonnet"}:
        return ENGINE_ANTHROPIC
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
            AI_RUNTIME["provider"] = "gemini"
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
    conn.execute('''
        CREATE TABLE IF NOT EXISTS pending_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            project_name TEXT,
            history_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS processed_webhooks (
            session_id TEXT PRIMARY KEY,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    if 'stripe_customer_id' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT")
    if 'stripe_subscription_id' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT")
    if 'subscription_status' not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'inactive'")
    conn.commit()
    conn.close()

# Initialize or migrate DB on start
init_db()

import threading
import uuid
from datetime import datetime
import json
# ── RESEND EMAIL CONFIG (module-level so we verify at startup) ──
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
RESEND_FROM = "Anmar Enterprises <noreply@anmarenterprices.com>"
RESEND_ADMIN = os.environ.get("ANMAR_ADMIN_EMAIL", "anmar@anmarenterprices.com").strip()


def _resend_send_email(to_addr, subject, html_body):
    """Envía un email via Resend API usando requests. Retorna response body o lanza excepción."""
    if not RESEND_API_KEY:
        raise Exception("RESEND_API_KEY vacía — email no enviado")

    r = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "from": RESEND_FROM,
            "to": [to_addr],
            "subject": subject,
            "html": html_body
        },
        timeout=15
    )
    if r.status_code >= 400:
        raise Exception(f"Resend HTTP {r.status_code}: {r.text}")
    return r.text


@app.route('/api/test-email', methods=['GET'])
def test_email_endpoint():
    """Diagnóstico: GET /api/test-email?to=x@x.com — envía email de prueba. Requiere auth interna."""
    if not require_internal_auth():
        return jsonify({"error": "unauthorized"}), 401
    if _rate_limit(request.remote_addr, max_requests=3, window=60):
        return jsonify({"error": "Too many attempts. Wait a moment."}), 429
    to = request.args.get('to', RESEND_ADMIN)
    try:
        result = _resend_send_email(
            to_addr=to,
            subject="Test desde Anmar API",
            html_body="<div style='font-family:sans-serif;padding:20px;background:#000;color:#fff;border-radius:12px;'><h2 style='color:#10b981;'>Email de prueba</h2><p>Si ves esto, Resend funciona correctamente desde Python.</p></div>"
        )
        return jsonify({"ok": True, "to": to})
    except Exception as e:
        print(f"[TEST-EMAIL] Error: {e}")
        return jsonify({"ok": False, "error": "Error al enviar email de prueba."}), 500


def notify_new_registration(name, email):
    """Envía emails de bienvenida + alerta admin en hilo separado."""

    def background_task():

        # 1. Ticket interno
        try:
            alerts_path = os.path.join(BASE_DIR, 'backend', 'internal_alerts.json')
            os.makedirs(os.path.dirname(alerts_path), exist_ok=True)
            alerts = []
            if os.path.exists(alerts_path):
                with open(alerts_path, 'r') as f:
                    alerts = json.load(f)
            new_alert = {
                "id": str(uuid.uuid4())[:8],
                "project_name": "NUEVO CLIENTE / LEAD",
                "client": name or email,
                "summary": f"Registro completado. Email: {email}",
                "viability": 100,
                "complexity": "Bajo",
                "timestamp": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
                "status": "pending",
                "priority": "high",
                "sla_due_at": datetime.now().isoformat(),
                "events": [{"timestamp": datetime.now().isoformat(), "status": "pending", "actor": "system", "message": "User registered successfully."}]
            }
            alerts.insert(0, new_alert)
            with open(alerts_path, 'w') as f:
                json.dump(alerts, f, indent=2)
            print(f"[NOTIFY] Ticket creado OK")
        except Exception as e:
            import traceback
            print(f"[NOTIFY] Error ticket: {e}")
            print(traceback.format_exc())

        # 2. Email bienvenida
        _name = (name or "Nuevo usuario").strip()
        try:
            _resend_send_email(
                to_addr=email,
                subject="Bienvenido a Anmar Enterprises!",
                html_body=f"""<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 32px;background:#000;color:#fff;border-radius:16px;">
                    <h1 style="color:#10b981;">Bienvenido, {_name}</h1>
                    <p style="color:rgba(255,255,255,0.7);line-height:1.7;">Tu cuenta en <strong>Anmar Enterprises</strong> fue creada exitosamente.</p>
                    <a href="https://anmarenterprices.com/" style="display:inline-block;margin-top:20px;background:#10b981;color:#000;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;">Ingresar ahora</a>
                    <p style="color:rgba(255,255,255,0.3);font-size:0.75rem;margin-top:32px;">Anmar Enterprises</p>
                </div>"""
            )
        except Exception as e:
            import traceback
            print(f"[NOTIFY] ERROR bienvenida -> {email}: {e}")
            print(traceback.format_exc())

        # 3. Email alerta admin
        try:
            _resend_send_email(
                to_addr=RESEND_ADMIN,
                subject=f"Nuevo lead: {email}",
                html_body=f"""<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:40px 32px;background:#000;color:#fff;border-radius:16px;">
                    <h2 style="color:#10b981;">Nuevo lead registrado</h2>
                    <p><strong>Nombre:</strong> {_name}</p>
                    <p><strong>Email:</strong> {email}</p>
                    <p><strong>Hora:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
                </div>"""
            )
        except Exception as e:
            import traceback
            print(f"[NOTIFY] ERROR alerta admin: {e}")
            print(traceback.format_exc())

        print(f"[NOTIFY] HILO COMPLETADO para {email}")

    threading.Thread(target=background_task, daemon=True).start()
    print(f"[NOTIFY] Hilo lanzado para {email}")

# --- AUTH ROUTES ---
@app.route('/api/register', methods=['POST'])
def register():
    if _rate_limit(request.remote_addr, max_requests=5, window=60):
        return jsonify({"error": "Too many attempts. Try again in a minute."}), 429
    data = request.json or {}
    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    terms_accepted = data.get('termsAccepted')

    if not email or not password:
        return jsonify({"error": "Missing data"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    if not terms_accepted:
        return jsonify({"error": "You must accept the Terms and Conditions to register."}), 400

    hashed_pw = generate_password_hash(password)

    try:
        conn = get_db_connection()
        conn.execute('INSERT INTO users (name, email, password, tokens) VALUES (?, ?, ?, ?)',
                     (name, email, hashed_pw, 8))
        conn.commit()
        conn.close()

        # ACTIVATE NOTIFICATIONS
        notify_new_registration(name, email)

        return jsonify({"message": "Account created successfully", "user": {"name": name, "email": email, "tokens": 8}})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Email is already registered"}), 409
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/me', methods=['POST'])
def api_me():
    """Lightweight session validator — verifies the user still exists in DB and returns current tokens."""
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    if not email:
        return jsonify({"error": "Not authenticated"}), 401

    # Verify session and email match
    session_email = session.get('user_email', '').strip().lower()
    if not session_email:
        return jsonify({"error": "You have not logged in"}), 401
    if session_email != email:
        return jsonify({"error": "Unauthorized"}), 403

    conn = get_db_connection()
    user = conn.execute('SELECT name, email, tokens FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    if not user:
        return jsonify({"error": "User not found"}), 401
    tokens = int(user['tokens']) if user['tokens'] is not None else 0
    return jsonify({"user": {"name": user['name'], "email": user['email'], "tokens": tokens}})

@app.route('/api/check-email', methods=['POST'])
def check_email():
    if _rate_limit(request.remote_addr, max_requests=20, window=60):
        return jsonify({"error": "Too many attempts. Try again in a minute."}), 429
    try:
        data = request.json or {}
        email = str(data.get('email') or '').strip().lower()
        if not email:
            return jsonify({"error": "Email is required"}), 400
        conn = get_db_connection()
        user = conn.execute('SELECT 1 FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()
        return jsonify({"exists": bool(user)})
    except Exception as e:
        print(f"Check email error: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/login', methods=['POST'])
def login():
    if _rate_limit(request.remote_addr, max_requests=10, window=60):
        return jsonify({"error": "Too many attempts. Try again in a minute."}), 429
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()

    if user and check_password_hash(user['password'], password):
        tokens = int(user['tokens']) if user['tokens'] is not None else 0
        session.permanent = True
        session['user_email'] = user['email']
        return jsonify({
            "message": "Login successful",
            "user": {"name": user['name'], "email": user['email'], "tokens": tokens}
        })
    else:
        return jsonify({"error": "Credenciales inválidas"}), 401

@app.route('/api/social-login', methods=['POST'])
def social_login():
    if _rate_limit(request.remote_addr, max_requests=10, window=60):
        return jsonify({"error": "Too many attempts. Try again in a minute."}), 429
    data = request.json or {}
    provider = data.get('provider') # 'Google' or 'Apple'
    token = data.get('token')
    email = data.get('email')
    name = data.get('name')
    terms_accepted = data.get('termsAccepted')

    if provider == 'Google':
        if not token:
            return jsonify({"error": "Missing authentic Google token to validate your Gmail."}), 400

        import requests
        try:
            google_res = requests.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={token}")
            if google_res.status_code == 200:
                google_data = google_res.json()
                email = google_data.get('email')
                name = google_data.get('name')
                
                if not email:
                    return jsonify({"error": "Google account did not authorize email delivery."}), 400
            else:
                return jsonify({"error": "Invalid or expired Google token"}), 401
        except Exception as e:
            return jsonify({"error": "Error verificando token de Google"}), 500

    if not email:
        return jsonify({"error": "Missing social network data"}), 400

    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()

    if not user:
        if not terms_accepted:
            conn.close()
            return jsonify({"error": "You must accept the Terms and Conditions to create your account."}), 400
        # User doesn't exist, create automatically using social info
        import secrets
        random_password = secrets.token_urlsafe(16)  # Generate a long placeholder password
        from werkzeug.security import generate_password_hash
        hashed_pw = generate_password_hash(random_password)
        try:
            conn.execute('INSERT INTO users (name, email, password, tokens) VALUES (?, ?, ?, ?)', (name, email, hashed_pw, 8))
            conn.commit()
            user_data = {"name": name, "email": email, "tokens": 8}

            # ACTIVATE NOTIFICATIONS FOR SOCIAL SIGNUP
            notify_new_registration(name, email)

        except Exception as e:
            conn.close()
            return jsonify({"error": "Internal server error"}), 500
    else:
        # User exists, log them in
        tokens = int(user['tokens']) if user['tokens'] is not None else 0
        user_data = {"name": user['name'], "email": user['email'], "tokens": tokens}

    conn.close()

    # Set session for authenticated user
    session.permanent = True
    session['user_email'] = email

    return jsonify({
        "message": f"Authenticated with {provider} successfully",
        "user": user_data
    })

@app.route('/api/logout', methods=['POST'])
def logout():
    """Clear user session."""
    session.pop('user_email', None)
    return jsonify({"status": "ok"})


# ── BUSINESS MODEL GENERATOR ──────────────────────────────────────────────────
@app.route('/api/generate-business-model', methods=['POST'])
def generate_business_model():
    """Generate a personalized business model analysis using Gemini. Returns full JSON."""
    data = request.json or {}
    project_name    = data.get('project_name', 'tu proyecto')
    description     = data.get('description', '')
    project_type    = data.get('project_type', '')
    biz_model_type  = data.get('business_model', '')
    stage           = data.get('stage', '')

    if not model:
        return jsonify({'error': 'AI not available'}), 503

    prompt = f"""You are a world-class business analyst with access to real market data.
An entrepreneur has just described their idea. Generate a personalized, specific business analysis with real numbers.

IMPORTANT: RESPOND ENTIRELY IN ENGLISH. All fields must be in English regardless of the project language.

PROJECT DATA:
- Name: {project_name}
- Description: {description}
- Type: {project_type}
- Business model: {biz_model_type}
- Current stage: {stage}

Respond ONLY with a valid JSON object with this exact structure (no markdown, no extra text):
{{
  "market": {{
    "size": "Global market size with a real USD figure (e.g. $4.2B)",
    "growth": "Annual growth rate CAGR (e.g. 18.3% CAGR 2024-2030)",
    "insight": "A specific, powerful observation about why now is the ideal moment to enter this market"
  }},
  "competitors": [
    {{"name": "Real competitor name", "weakness": "Their specific weakness that {project_name} can exploit"}},
    {{"name": "Real competitor name 2", "weakness": "Their specific weakness"}},
    {{"name": "Real competitor name 3", "weakness": "Their specific weakness"}}
  ],
  "advantage": {{
    "main": "The primary and specific competitive advantage of this idea",
    "moat": "What makes it difficult or nearly impossible for anyone else to replicate this exactly"
  }},
  "risk": {{
    "description": "The most concrete and real risk for this specific business",
    "mitigation": "How to mitigate it with concrete actions"
  }},
  "nextStep": "The most important and specific action to take right now to validate and move forward"
}}"""

    try:
        result, err = _safe_model_generate(prompt, timeout_seconds=28)
        if err or not result:
            return jsonify({'error': err or 'AI timeout'}), 503

        raw = result.text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        parsed = json.loads(raw)
        return jsonify({'ok': True, 'data': parsed})

    except json.JSONDecodeError:
        return jsonify({'error': 'Invalid AI response', 'raw': raw[:300]}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
            # 2.5 Extract a JSON object/array from surrounding text.
            if "{" in text and "}" in text:
                start = text.find("{")
                end = text.rfind("}")
                if end > start:
                    return json.loads(text[start:end + 1])
            if "[" in text and "]" in text:
                start = text.find("[")
                end = text.rfind("]")
                if end > start:
                    return json.loads(text[start:end + 1])
            # 3. Aggressive Fix: Escape control characters (newlines) inside strings?
            # A safer fallback for Python is using ast.literal_eval if it looks like a Python dict
            import ast
            return ast.literal_eval(text)
        except Exception as e:
            # 4. Last Resort: parsing failed
            print(f"[JSON PARSE] Failed: {str(e)[:80]}")
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

def detect_language(text):
    t = (text or "").lower()
    if not t:
        return "es"
    score_es = 0
    score_en = 0
    if re.search(r"[áéíóúñ]", t):
        score_es += 2
    for token in [" el ", " la ", " los ", " las ", " de ", " que ", " para ", " con ", " una ", " un ", " necesito ", " quiero ", "hola", "buenas"]:
        if token in f" {t} ":
            score_es += 1
    for token in [" the ", " and ", " for ", " with ", " i ", " i want ", " need ", " hello ", " my ", " a ", " an "]:
        if token in f" {t} ":
            score_en += 1
    return "en" if score_en > score_es else "es"

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
        return "Subscription"
    if any(k in lower for k in ["comisión", "commission"]):
        return "Commission"
    if any(k in lower for k in ["pago único", "one-time", "unico"]):
        return "One-time payment"
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


def call_anthropic_text(prompt, system_prompt=None, timeout_seconds=22, max_tokens_override=None):
    if not ANTHROPIC_API_KEY:
        return None
    system_payload = system_prompt if system_prompt is not None else SYSTEM_INSTRUCTION_TEXT
    tokens = max_tokens_override if max_tokens_override else max(1, int(ANTHROPIC_MAX_TOKENS))
    payload = {
        "model": ANTHROPIC_MODEL or "claude-sonnet-4-5",
        "max_tokens": tokens,
        "temperature": float(ANTHROPIC_TEMPERATURE),
        "system": system_payload,
        "messages": [
            {"role": "user", "content": str(prompt or "")}
        ],
    }
    try:
        response = requests.post(
            ANTHROPIC_ENDPOINT,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json",
            },
            json=payload,
            timeout=timeout_seconds,
        )
        if response.status_code >= 400:
            AI_RUNTIME["connected"] = False
            AI_RUNTIME["model_name"] = ANTHROPIC_MODEL
            AI_RUNTIME["last_error"] = f"Anthropic {response.status_code}: {response.text[:300]}"
            AI_RUNTIME["last_check_at"] = _now_iso()
            log_debug(f"Anthropic error {response.status_code}: {response.text[:300]}")
            return None
        data = response.json() or {}
        content_blocks = data.get("content") or []
        text = "".join(
            [block.get("text", "") for block in content_blocks if isinstance(block, dict) and block.get("type") == "text"]
        ).strip()
        if not text:
            AI_RUNTIME["connected"] = False
            AI_RUNTIME["model_name"] = ANTHROPIC_MODEL
            AI_RUNTIME["last_error"] = "Empty response from Anthropic"
            AI_RUNTIME["last_check_at"] = _now_iso()
            return None
        AI_RUNTIME["connected"] = True
        AI_RUNTIME["model_name"] = ANTHROPIC_MODEL
        AI_RUNTIME["candidate_models"] = [ANTHROPIC_MODEL]
        AI_RUNTIME["last_error"] = None
        AI_RUNTIME["last_check_at"] = _now_iso()
        AI_RUNTIME["provider"] = "anthropic"
        return text
    except Exception as e:
        AI_RUNTIME["connected"] = False
        AI_RUNTIME["model_name"] = ANTHROPIC_MODEL
        AI_RUNTIME["last_error"] = str(e)
        AI_RUNTIME["last_check_at"] = _now_iso()
        log_debug(f"Anthropic call failed: {e}")
        return None


def call_anthropic_chat(messages, system_prompt=None, timeout_seconds=30, max_tokens_override=None):
    """
    Llama a Anthropic con historial de conversación multi-turno real.
    messages: lista de dicts con 'role' ('user'/'ai'/'assistant') y 'content'.
    Convierte roles 'ai' -> 'assistant' y garantiza alternancia correcta.
    """
    if not ANTHROPIC_API_KEY:
        return None

    # Convertir roles y construir lista de mensajes válidos para Anthropic
    api_messages = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get('role') or 'user').strip().lower()
        if role == 'ai':
            role = 'assistant'
        if role not in ('user', 'assistant'):
            role = 'user'
        content = str(msg.get('content') or '').strip()
        if not content:
            continue
        # Combinar mensajes consecutivos del mismo rol (Anthropic no los acepta separados)
        if api_messages and api_messages[-1]['role'] == role:
            api_messages[-1]['content'] += '\n' + content
        else:
            api_messages.append({'role': role, 'content': content})

    # Anthropic exige que el primer mensaje sea del usuario
    while api_messages and api_messages[0]['role'] != 'user':
        api_messages.pop(0)

    if not api_messages:
        return None

    system_payload = system_prompt if system_prompt is not None else SYSTEM_INSTRUCTION_TEXT
    tokens = max_tokens_override if max_tokens_override else max(1, int(ANTHROPIC_MAX_TOKENS))
    payload = {
        "model": ANTHROPIC_MODEL or "claude-sonnet-4-5",
        "max_tokens": tokens,
        "temperature": float(ANTHROPIC_TEMPERATURE),
        "system": system_payload,
        "messages": api_messages,
    }
    try:
        response = requests.post(
            ANTHROPIC_ENDPOINT,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": ANTHROPIC_VERSION,
                "content-type": "application/json",
            },
            json=payload,
            timeout=timeout_seconds,
        )
        if response.status_code >= 400:
            AI_RUNTIME["connected"] = False
            AI_RUNTIME["model_name"] = ANTHROPIC_MODEL
            AI_RUNTIME["last_error"] = f"Anthropic chat {response.status_code}: {response.text[:300]}"
            AI_RUNTIME["last_check_at"] = _now_iso()
            log_debug(f"Anthropic chat error {response.status_code}: {response.text[:300]}")
            return None
        data = response.json() or {}
        content_blocks = data.get("content") or []
        text = "".join(
            [block.get("text", "") for block in content_blocks
             if isinstance(block, dict) and block.get("type") == "text"]
        ).strip()
        if not text:
            AI_RUNTIME["connected"] = False
            AI_RUNTIME["last_error"] = "Empty response from Anthropic chat"
            AI_RUNTIME["last_check_at"] = _now_iso()
            return None
        AI_RUNTIME["connected"] = True
        AI_RUNTIME["model_name"] = ANTHROPIC_MODEL
        AI_RUNTIME["candidate_models"] = [ANTHROPIC_MODEL]
        AI_RUNTIME["last_error"] = None
        AI_RUNTIME["last_check_at"] = _now_iso()
        AI_RUNTIME["provider"] = "anthropic"
        return text
    except Exception as e:
        AI_RUNTIME["connected"] = False
        AI_RUNTIME["model_name"] = ANTHROPIC_MODEL
        AI_RUNTIME["last_error"] = str(e)
        AI_RUNTIME["last_check_at"] = _now_iso()
        log_debug(f"Anthropic chat call failed: {e}")
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
    if normalized_engine in {ENGINE_ANTHROPIC, ENGINE_ANTIGRAVITY} and ANTHROPIC_API_KEY:
        anth_text = call_anthropic_text(prompt, system_prompt=SYSTEM_INSTRUCTION_TEXT)
        if anth_text:
            return anth_text.replace("```", "").strip()
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
    ready_words = [
        "build", "execute", "ready", "go ahead", "let's go", "start", "confirm",
        "listo", "enviar", "manda", "procede", "arranca", "construye", "dale",
        "hazlo", "confirmo", "confirmar", "adelante", "vamos", "si, ", "sí,",
        "envía", "envia", "empezar", "crear", "empieza", "comienza",
    ]
    # Also match standalone "si" / "sí" / "yes" / "ok"
    stripped = text.strip().rstrip('.!').strip()
    if stripped in ("si", "sí", "yes", "ok", "okey", "vale", "claro", "dale", "va"):
        return True
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

# --- Marketing Brief Helpers ---
MARKETING_REQUIRED_FIELDS = [
    "goal",
    "audience",
    "offer",
    "channels",
    "budget",
    "timeline",
    "brand_voice",
    "key_message",
]

def _coerce_list(value):
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return []

def normalize_marketing_brief(brief):
    if not isinstance(brief, dict):
        brief = {}
    clean = dict(brief)
    clean["channels"] = _coerce_list(clean.get("channels", []))
    for key in MARKETING_REQUIRED_FIELDS:
        if key not in clean:
            clean[key] = "" if key != "channels" else []
    return clean

def compute_marketing_missing(brief):
    missing = []
    for field in MARKETING_REQUIRED_FIELDS:
        if field == "channels":
            if not isinstance(brief.get("channels"), list) or not brief.get("channels"):
                missing.append(field)
        else:
            if not str(brief.get(field, "")).strip():
                missing.append(field)
    return missing

def compute_marketing_score(missing):
    total = len(MARKETING_REQUIRED_FIELDS)
    if total == 0:
        return 0
    return max(0, min(100, round(((total - len(missing)) / total) * 100)))

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
        return f"I detected a change in {field}. Should we confirm as final version: \"{c.get('new')}\"?"

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
            return questions.get(key, "What key information is missing to close the brief?")
    return questions.get(missing[0], "What key information is missing to close the brief?")

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
        return "Tip: define an initial niche; trying to reach everyone lowers conversion."
    if "business_model" in missing:
        return "Tip: validate simple monetization first (one model only in V1)."
    if "timeline" in missing:
        return "Tip: fija una fecha concreta; sin deadline el MVP se alarga."
    if "features" in missing:
        return "Tip: V1 with 2-3 critical features, no more."

    # When core data exists, provide a domain-specific strategic next move.
    if domain == "marketplace":
        return "Tip: in marketplace, prioritize liquidity on the harder side (supply or demand)."
    if domain == "ecommerce":
        return "Tip: optimize checkout first; it usually generates more revenue than redesigning catalog."
    if domain == "pet_shop":
        return "Tip: combine recurrence (subscription) with one-time sales to improve LTV."
    if domain == "saas":
        return "Tip: define a north star metric (activation or retention) before scaling features."
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
    # When user explicitly says "enviar"/"listo"/etc., allow it if we have at least a summary
    # Don't block on missing features — they can be inferred during ticket creation
    has_minimum_context = bool(memory.get("summary"))
    ready_to_build = explicit_ready and (ready_by_data or has_minimum_context)

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
    lang = detect_language(current_input)
    def t(es, en):
        return en if lang == "en" else es

    if is_greeting_text(current_input):
        return t(
            "¡Hola! Cuéntame tu idea y la convertimos en un brief claro para el equipo.",
            "Hi! Tell me your idea and I'll turn it into a clear brief for the team."
        )

    if analysis["ready_to_build"]:
        return t(
            "Perfecto. Orden confirmada. Activamos la ejecución con nuestro equipo.",
            "Perfect. Confirmed. We're activating execution with our team."
        )

    known = []
    if memory.get("audience"):
        known.append(f"audiencia: {memory.get('audience')}")
    if memory.get("business_model"):
        known.append(f"modelo: {memory.get('business_model')}")
    if memory.get("timeline"):
        known.append(f"plazo: {memory.get('timeline')}")
    context_block = " | ".join(known) if known else t("sin datos firmes todavía", "no confirmed data yet")

    # --- ESTRATEGIA PRIMARIA: Anthropic con historial multi-turno real ---
    # Se construye un system prompt enriquecido con el contexto de la sesión
    # y se envía el historial completo como mensajes usuario/asistente reales.
    normalized_engine = normalize_engine(engine)
    if ANTHROPIC_API_KEY and normalized_engine in {ENGINE_ANTHROPIC, ENGINE_ANTIGRAVITY}:
        lang_label = "English" if lang == "en" else "Spanish (español)"
        missing_label = ", ".join(analysis.get("missing_fields", [])) or t("ninguno", "none")
        next_q_label = analysis.get("next_question", "")
        consultant_context = f"""
=== CONTEXTO ACTUAL DE LA SESIÓN ===
- Idioma del cliente: {lang_label}
- Fase: {analysis.get("phase", "initial")}
- Resumen del proyecto: {analysis.get("summary", t("sin definir aún", "not defined yet"))}
- Datos confirmados: {context_block}
- Campos faltantes: {missing_label}
- Listo por datos: {analysis.get("ready_by_data", False)}
- Siguiente pregunta clave: {next_q_label}

=== INSTRUCCIONES PARA ESTA RESPUESTA ===
- Responde SOLO con el texto final al cliente, sin explicaciones internas.
- Refleja su visión con profundidad y propone 2-3 sugerencias inteligentes.
- Haz SOLO 1 pregunta (la más importante).
- Si "listo por datos" es True: entrega un resumen emocionante y pide confirmación.
- NO menciones IA, precios, planes ni pagos.
- Responde en {lang_label}.
"""
        enhanced_system = SYSTEM_INSTRUCTION_TEXT + "\n" + consultant_context
        # Usar últimos 12 turnos del historial para no exceder contexto
        recent_history = history[-12:] if len(history) > 12 else history
        ai_text = call_anthropic_chat(recent_history, system_prompt=enhanced_system, timeout_seconds=30)
        if ai_text:
            return ai_text.replace("```", "").strip()

    # --- FALLBACK: Prompt único (Gemini u otro motor) ---
    prompt = f"""
    Contexto:
    - idioma: {"English" if lang == "en" else "Spanish"}
    - fase actual: {analysis.get("phase")}
    - resumen: {analysis.get("summary","")}
    - conocido: {context_block}
    - faltantes: {analysis.get("missing_fields", [])}
    - listo por datos: {analysis.get("ready_by_data")}
    - último mensaje del cliente: {current_input}

    Instrucciones:
    - Responde como Anmar AI (consultor senior).
    - Refleja la visión, propone 2-3 sugerencias inteligentes y haz SOLO 1 pregunta.
    - Si listo por datos, entrega un resumen emocionante y pregunta confirmación.
    - No menciones IA, precios, planes ni pagos.
    - Responde únicamente con el texto final al cliente.
    """
    ai_text = call_ai_text(prompt, engine=engine)
    if ai_text:
        return ai_text

    # --- FALLBACK DETERMINÍSTICO ---
    missing = analysis.get("missing_fields", [])
    summary = analysis.get("summary") or t("tu idea", "your idea")
    next_q = analysis.get("next_question") or t(
        "¿Cuál es el objetivo principal que quieres lograr con este producto?",
        "What is the main goal you want to achieve with this product?"
    )

    if analysis.get("ready_by_data"):
        return t(
            f"Perfecto. Esta es la visión que tengo: {summary}. ¿Es esta la visión correcta o cambiarías algo antes de enviarlo al equipo?",
            f"Perfect. Here's the vision I have: {summary}. Is this the right vision, or would you change anything before we send it to the team?"
        )

    return t(
        f"Entiendo la base de tu idea y veo un camino claro para un MVP sólido con alcance controlado. {next_q}",
        f"I understand the core of your idea and see a clear path to a strong MVP with focused scope. {next_q}"
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
        return "Hi! I'm Anmar's architect. Tell me your business idea in one sentence and I'll convert it into a technical plan ready for engineering."

    domain = brief.get("domain", "general")
    summary = brief.get("summary", "Ya tengo el contexto inicial.").strip()
    if not summary or is_greeting_text(summary):
        summary = "Tengo el contexto inicial de tu idea."

    missing = get_missing_brief_fields(brief)
    if not missing:
        return f"Perfect, I have enough context to generate the technical ticket for {summary}.\n\nIf you agree, reply: 'send to internal' and I'll generate it now."

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
        return False, "You have not logged in.", None
    if is_user_subscribed(email):
        return True, "subscribed", get_user_token_balance(email)
    try:
        amount = int(amount)
    except Exception:
        amount = 1
    if amount <= 0:
        return True, "ok", None

    conn = get_db_connection()
    ensure_user_exists_for_tokens(conn, email)
    # Atomic deduction: UPDATE only if sufficient tokens (prevents race condition / negative balance)
    cursor = conn.execute(
        'UPDATE users SET tokens = tokens - ? WHERE email = ? AND tokens >= ?',
        (amount, email, amount)
    )
    conn.commit()
    if cursor.rowcount == 0:
        # No rows updated = insufficient tokens
        current = conn.execute('SELECT tokens FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()
        current_balance = int(current['tokens']) if current else 0
        return False, f"Insufficient credits for {reason or 'this action'} (requires {amount}).", current_balance

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

def is_guest_email(email):
    if not email:
        return False
    lower = str(email).strip().lower()
    return lower.startswith('guest_') or lower.endswith('@guest.anmar') or lower.endswith('@guest.local')

def save_pending_ticket(email, project_name, history):
    if not email or not history:
        return
    conn = get_db_connection()
    # Remove any previous pending ticket for same email/project
    if project_name:
        conn.execute(
            "DELETE FROM pending_tickets WHERE user_email = ? AND project_name = ?",
            (email, project_name)
        )
    conn.execute(
        "INSERT INTO pending_tickets (user_email, project_name, history_json) VALUES (?, ?, ?)",
        (email, project_name, json.dumps(history))
    )
    conn.commit()
    conn.close()

def get_pending_tickets(email, project_name=None):
    if not email:
        return []
    conn = get_db_connection()
    if project_name:
        rows = conn.execute(
            "SELECT * FROM pending_tickets WHERE user_email = ? AND project_name = ? ORDER BY created_at ASC",
            (email, project_name)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM pending_tickets WHERE user_email = ? ORDER BY created_at ASC",
            (email,)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def delete_pending_ticket(ticket_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM pending_tickets WHERE id = ?", (ticket_id,))
    conn.commit()
    conn.close()

def submit_pending_tickets_for_email(email, project_name=None):
    if not email or not is_user_subscribed(email):
        return []
    pending = get_pending_tickets(email, project_name=project_name)
    results = []
    for item in pending:
        history = json.loads(item.get("history_json") or "[]")
        proj_name = item.get("project_name") or ""
        if history:
            payload = build_ticket_from_history(history, email, proj_name)
            results.append(payload)
        delete_pending_ticket(item.get("id"))
    return results

def get_stripe_plan_map():
    return {
        # New plans
        "validate": STRIPE_PRICE_VALIDATE,
        # Legacy plans (kept for existing subscribers)
        "starter": STRIPE_PRICE_STARTER,
        "pro": STRIPE_PRICE_PRO,
        "marketing": STRIPE_PRICE_MARKETING,
        "marketing_build": STRIPE_PRICE_MARKETING_BUILD
    }

# Plans that use one-time payment mode instead of subscription
ONE_TIME_PLANS = {"validate"}

def normalize_plan_label(plan_key):
    if not plan_key:
        return "none"
    return STRIPE_PLAN_LABELS.get(plan_key, plan_key)

PLAN_TOKEN_ALLOTMENT = {
    "validate":       0,  # Team service, no AI tokens
    "mvp":            0,
    "growth":         0,
    # Legacy
    "starter":        80,
    "pro":            250,
    "marketing":      800,
    "marketing_build": 2000,
}

def set_user_subscription(email, active, plan_key=None, customer_id=None, subscription_id=None, status=None):
    if not email:
        return
    conn = get_db_connection()
    ensure_user_exists_for_tokens(conn, email)
    plan_label = normalize_plan_label(plan_key) if active else 'none'
    sub_active = 1 if active else 0
    fields = ["subscription_active = ?", "subscription_plan = ?"]
    values = [sub_active, plan_label]
    if active:
        fields.append("subscription_started_at = CURRENT_TIMESTAMP")
        # ADD tokens based on plan (don't overwrite existing balance)
        tokens_to_grant = PLAN_TOKEN_ALLOTMENT.get(plan_key, 0)
        if tokens_to_grant > 0:
            fields.append("tokens = tokens + ?")
            values.append(tokens_to_grant)
    if customer_id is not None:
        fields.append("stripe_customer_id = ?")
        values.append(customer_id)
    if subscription_id is not None:
        fields.append("stripe_subscription_id = ?")
        values.append(subscription_id)
    if status is not None:
        fields.append("subscription_status = ?")
        values.append(status)
    values.append(email)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE email = ?", values)
    conn.commit()
    conn.close()

def find_user_by_stripe_customer(customer_id):
    if not customer_id:
        return None
    conn = get_db_connection()
    row = conn.execute('SELECT email FROM users WHERE stripe_customer_id = ?', (customer_id,)).fetchone()
    conn.close()
    return row['email'] if row else None

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
        return False, "You have not logged in.", None
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
        return False, "You have not logged in.", None
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
        return "Waiting for engineer assignment from Anmar network."
    if status == "accepted":
        prefix = f"{engineer} " if engineer else "An engineer "
        return f"{prefix}accepted the project. Preparing development environment."
    if status == "developing":
        prefix = f"{engineer} " if engineer else "The team "
        return f"{prefix}is building the MVP."
    if status == "blocked":
        return "Request temporarily blocked. Waiting for internal resolution."
    if status == "completed":
        return "Project completed and deployed."
    return f"Status updated: {status}"

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
    tmp_path = ALERTS_FILE + '.tmp'
    try:
        with open(tmp_path, 'w') as f:
            json.dump(alerts, f, indent=2)
        os.replace(tmp_path, ALERTS_FILE)
    except Exception as e:
        print(f"Error saving alerts: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

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
        "pending_human_review": "pending",
    }
    normalized = mapping.get(raw, raw)
    if normalized not in TICKET_PROGRESS:
        normalized = "pending"
    ticket["status"] = normalized
    ticket["priority"] = normalize_priority(ticket.get("priority"))
    if not ticket.get("sla_due_at"):
        ticket["sla_due_at"] = compute_sla_due_at(ticket["priority"])
    ticket["sla_overdue"] = is_sla_overdue(ticket)

    # ── Normalize missing fields so panel always has what it needs ──
    # created_at: some tickets use "timestamp" instead
    if not ticket.get("created_at") and ticket.get("timestamp"):
        ticket["created_at"] = ticket["timestamp"]
    if not ticket.get("created_at"):
        ticket["created_at"] = datetime.now().isoformat()

    # updated_at
    if not ticket.get("updated_at"):
        ticket["updated_at"] = ticket.get("created_at", datetime.now().isoformat())

    # user_email / client_email — unify
    email = ticket.get("user_email") or ticket.get("client_email") or ticket.get("client") or ""
    ticket["user_email"] = email
    ticket["client_email"] = email

    # channel — default to 'build'
    if not ticket.get("channel"):
        ticket["channel"] = "build"

    # id — ensure it exists
    if not ticket.get("id") and not ticket.get("ticket_id"):
        ticket["id"] = str(uuid.uuid4())[:8]

    # project_name — ensure readable
    if not ticket.get("project_name"):
        ticket["project_name"] = ticket.get("project_id") or ticket.get("id") or "sin-nombre"

    # events — ensure list
    if not isinstance(ticket.get("events"), list):
        ticket["events"] = []

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
    tmp_path = ORDER_STATUS_FILE + '.tmp'
    try:
        with open(tmp_path, 'w') as f:
            json.dump(orders, f, indent=2)
        os.replace(tmp_path, ORDER_STATUS_FILE)
    except Exception as e:
        print(f"Error saving orders: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

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
    tmp_path = DISPATCH_STATE_FILE + '.tmp'
    try:
        with open(tmp_path, 'w') as f:
            json.dump(state, f, indent=2)
        os.replace(tmp_path, DISPATCH_STATE_FILE)
    except Exception as e:
        print(f"Error saving dispatch state: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

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
    if _rate_limit(request.remote_addr, max_requests=10, window=60):
        return jsonify({"error": "Too many attempts. Try again in a minute."}), 429

    email = request.args.get('email')
    if not email: return jsonify({"error": "No email provided"}), 400

    # Verify session and email match
    session_email = session.get('user_email', '').strip().lower()
    if not session_email:
        return jsonify({"error": "You have not logged in"}), 401
    if session_email != email.strip().lower():
        return jsonify({"error": "Unauthorized"}), 403

    conn = get_db_connection()
    user = conn.execute(
        'SELECT tokens, created_at, subscription_active, subscription_plan, subscription_status FROM users WHERE email = ?',
        (email,)
    ).fetchone()
    conn.close()

    if user:
        return jsonify({
            "tokens": user['tokens'],
            "joined": user['created_at'],
            "subscription_active": int(user['subscription_active']) == 1 if 'subscription_active' in user.keys() else False,
            "subscription_plan": user['subscription_plan'] if 'subscription_plan' in user.keys() else 'none',
            "subscription_status": user['subscription_status'] if 'subscription_status' in user.keys() else 'inactive'
        })
    else:
        return jsonify({"error": "User not found"}), 404

# --- STRIPE CHECKOUT ---
@app.route('/api/stripe/create-checkout-session', methods=['POST'])
def stripe_create_checkout_session():
    if _rate_limit(request.remote_addr, max_requests=5, window=60):
        return jsonify({"error": "Too many attempts. Wait a moment."}), 429
    try:
        if not STRIPE_SECRET_KEY:
            return jsonify({"error": "Stripe is not configured"}), 500
        data = request.json or {}
        email = (data.get('email') or '').strip().lower()
        plan_key = (data.get('plan') or '').strip()
        plan_map = get_stripe_plan_map()
        price_id = plan_map.get(plan_key)

        if not email or not price_id:
            return jsonify({"error": "Invalid email or plan"}), 400

        origin = request.headers.get('Origin')
        if not origin:
            origin = request.host_url.rstrip('/')

        success_url = os.getenv("STRIPE_SUCCESS_URL", "").strip() or f"{origin}/dashboard.html?checkout=success&session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = os.getenv("STRIPE_CANCEL_URL", "").strip() or f"{origin}/dashboard.html?checkout=cancel"

        checkout_mode = "payment" if plan_key in ONE_TIME_PLANS else "subscription"
        session = stripe.checkout.Session.create(
            mode=checkout_mode,
            line_items=[{"price": price_id, "quantity": 1}],
            customer_email=email,
            client_reference_id=email,
            success_url=success_url,
            cancel_url=cancel_url,
            allow_promotion_codes=True,
            metadata={
                "plan": plan_key,
                "email": email
            }
        )

        return jsonify({"url": session.url})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/stripe/create-token-pack-session', methods=['POST'])
def stripe_create_token_pack_session():
    """One-time payment checkout for token packs (50/150/500 messages)."""
    if _rate_limit(request.remote_addr, max_requests=5, window=60):
        return jsonify({"error": "Too many attempts. Wait a moment."}), 429
    try:
        if not STRIPE_SECRET_KEY:
            return jsonify({"error": "Stripe is not configured"}), 500
        data = request.json or {}
        email = (data.get('email') or '').strip().lower()
        user_email = (data.get('user_email') or '').strip().lower()
        pack_key = (data.get('pack') or '').strip()

        # Verify requesting user's email matches - use user_email if provided, fallback to email
        auth_email = user_email or email
        if not auth_email or auth_email != email:
            return jsonify({"error": "Unauthorized: email mismatch"}), 403

        pack_info = TOKEN_PACK_MAP.get(pack_key)
        if not email or not pack_info:
            return jsonify({"error": "Invalid email or pack"}), 400
        if not pack_info.get("price_id"):
            return jsonify({"error": "This pack is not yet available. Contact us."}), 400

        origin = request.headers.get('Origin') or request.host_url.rstrip('/')
        success_url = os.getenv("STRIPE_SUCCESS_URL", "").strip() or f"{origin}/dashboard.html?checkout=success&pack={pack_key}"
        cancel_url  = os.getenv("STRIPE_CANCEL_URL",  "").strip() or f"{origin}/dashboard.html?checkout=cancel"

        checkout_session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{"price": pack_info["price_id"], "quantity": 1}],
            customer_email=email,
            client_reference_id=email,
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "type": "token_pack",
                "pack": pack_key,
                "tokens": str(pack_info["tokens"]),
                "email": email
            }
        )
        return jsonify({"url": checkout_session.url})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/stripe/webhook', methods=['POST'])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get('Stripe-Signature', '')

    if not STRIPE_WEBHOOK_SECRET:
        return jsonify({"error": "Stripe webhook secret missing"}), 500

    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=STRIPE_WEBHOOK_SECRET
        )
    except Exception as e:
        return jsonify({"error": "Invalid request"}), 400

    event_type = event.get('type')
    data_object = (event.get('data') or {}).get('object') or {}

    if event_type == 'checkout.session.completed':
        email = (data_object.get('customer_email') or '').strip().lower()
        metadata = data_object.get('metadata') or {}
        event_type_meta = (metadata.get('type') or '').strip()
        customer_id = data_object.get('customer')

        if event_type_meta == 'token_pack':
            # One-time token pack purchase — verify tokens from server-side map, NOT metadata
            pack_key = (metadata.get('pack') or '').strip()
            pack_info = TOKEN_PACK_MAP.get(pack_key)
            tokens_to_add = pack_info['tokens'] if pack_info else 0
            # Idempotency: check if this checkout session was already processed
            checkout_session_id = data_object.get('id', '')
            if email and tokens_to_add > 0:
                conn = get_db_connection()
                ensure_user_exists_for_tokens(conn, email)
                # Check idempotency — store processed session IDs
                already = conn.execute(
                    "SELECT 1 FROM processed_webhooks WHERE session_id = ?", (checkout_session_id,)
                ).fetchone() if checkout_session_id else None
                if not already:
                    conn.execute('UPDATE users SET tokens = tokens + ? WHERE email = ?', (tokens_to_add, email))
                    try:
                        conn.execute("INSERT INTO processed_webhooks (session_id, processed_at) VALUES (?, CURRENT_TIMESTAMP)", (checkout_session_id,))
                    except Exception:
                        pass  # Table may not exist yet, tokens still granted
                    conn.commit()
                    print(f"[WEBHOOK] Added {tokens_to_add} tokens to {email} (pack: {pack_key}, session: {checkout_session_id})")
                else:
                    print(f"[WEBHOOK] Duplicate webhook ignored for session {checkout_session_id}")
                conn.close()
        else:
            # Subscription plan purchase
            plan_key = (metadata.get('plan') or '').strip()
            subscription_id = data_object.get('subscription')
            if email:
                set_user_subscription(
                    email,
                    True,
                    plan_key=plan_key,
                    customer_id=customer_id,
                    subscription_id=subscription_id,
                    status="active"
                )
                try:
                    submit_pending_tickets_for_email(email)
                except Exception as e:
                    print(f"Pending ticket auto-submit failed: {e}")

    if event_type in ('customer.subscription.updated', 'customer.subscription.deleted'):
        customer_id = data_object.get('customer')
        status = (data_object.get('status') or '').strip().lower()
        plan_key = None
        items = data_object.get('items') or {}
        data_items = items.get('data') if isinstance(items, dict) else []
        if data_items:
            price_id = data_items[0].get('price', {}).get('id')
            for key, value in get_stripe_plan_map().items():
                if value and value == price_id:
                    plan_key = key
                    break
        email = find_user_by_stripe_customer(customer_id)
        if email:
            active = status in ('active', 'trialing')
            set_user_subscription(
                email,
                active,
                plan_key=plan_key,
                customer_id=customer_id,
                subscription_id=data_object.get('id'),
                status=status or ("active" if active else "inactive")
            )

    return jsonify({"received": True})

@app.route('/api/stripe/verify-session', methods=['GET'])
def stripe_verify_session():
    try:
        session_id = (request.args.get('session_id') or '').strip()
        user_email = (request.args.get('user_email') or '').strip().lower()
        if not session_id or not user_email:
            return jsonify({"error": "Missing session_id or user_email"}), 400
        if not STRIPE_SECRET_KEY:
            return jsonify({"error": "Stripe is not configured"}), 500

        session_data = stripe.checkout.Session.retrieve(session_id)
        stripe_email = (session_data.get('customer_email') or '').strip().lower()

        # Verify requesting user matches the Stripe session's email
        if stripe_email != user_email:
            return jsonify({"error": "Unauthorized: email mismatch"}), 403

        metadata = session_data.get('metadata') or {}
        plan_key = (metadata.get('plan') or '').strip()
        customer_id = session_data.get('customer')
        subscription_id = session_data.get('subscription')

        if stripe_email:
            set_user_subscription(
                stripe_email,
                True,
                plan_key=plan_key,
                customer_id=customer_id,
                subscription_id=subscription_id,
                status="active"
            )
            try:
                submit_pending_tickets_for_email(stripe_email)
            except Exception as e:
                print(f"Pending ticket auto-submit failed: {e}")
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

# ── RETENTION / CANCELLATION ROUTES ──────────────────────────────────────────

def get_user_subscription_id(email):
    """Obtiene el stripe_subscription_id del usuario desde la DB."""
    conn = get_db_connection()
    row = conn.execute('SELECT stripe_subscription_id, stripe_customer_id, subscription_plan FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    return row if row else None

@app.route('/api/stripe/cancel-subscription', methods=['POST'])
def cancel_subscription():
    """Cancela la suscripción al final del período actual (no inmediato)."""
    try:
        data = request.json or {}
        email = (data.get('email') or '').strip().lower()
        reason = (data.get('reason') or 'not_specified').strip()
        if not email:
            return jsonify({"error": "Email is required"}), 400
        if not STRIPE_SECRET_KEY:
            # Sin Stripe: solo marcar en DB
            set_user_subscription(email, False, status='canceled')
            return jsonify({"status": "canceled", "message": "Subscription canceled."})
        row = get_user_subscription_id(email)
        if not row or not row['stripe_subscription_id']:
            set_user_subscription(email, False, status='canceled')
            return jsonify({"status": "canceled", "message": "Subscription canceled."})
        sub_id = row['stripe_subscription_id']
        # Cancelar al final del período (no cortar inmediatamente)
        stripe.Subscription.modify(sub_id, cancel_at_period_end=True, metadata={"cancel_reason": reason})
        set_user_subscription(email, True, status='cancel_at_period_end')
        print(f"[CANCEL] {email} — reason: {reason}")
        return jsonify({"status": "cancel_at_period_end", "message": "Your subscription will cancel at the end of the billing period."})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/stripe/pause-subscription', methods=['POST'])
def pause_subscription():
    """Pausa la suscripción por 30 días (sin cobro)."""
    try:
        data = request.json or {}
        email = (data.get('email') or '').strip().lower()
        if not email:
            return jsonify({"error": "Email is required"}), 400
        if not STRIPE_SECRET_KEY:
            set_user_subscription(email, True, status='paused')
            return jsonify({"status": "paused"})
        row = get_user_subscription_id(email)
        if not row or not row['stripe_subscription_id']:
            return jsonify({"error": "No active subscription found"}), 404
        sub_id = row['stripe_subscription_id']
        resume_at = int((datetime.now() + timedelta(days=30)).timestamp())
        stripe.Subscription.modify(sub_id, pause_collection={"behavior": "void", "resumes_at": resume_at})
        set_user_subscription(email, True, status='paused')
        print(f"[PAUSE] {email} — resumes in 30 days")
        return jsonify({"status": "paused", "message": "Your subscription is paused for 30 days. You will not be charged and it will reactivate automatically."})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/stripe/apply-retention-discount', methods=['POST'])
def apply_retention_discount():
    """Aplica cupón del 50% en el próximo mes."""
    try:
        data = request.json or {}
        email = (data.get('email') or '').strip().lower()
        if not email:
            return jsonify({"error": "Email is required"}), 400
        if not STRIPE_SECRET_KEY:
            return jsonify({"status": "discount_applied", "message": "Discount applied (demo mode)."})
        row = get_user_subscription_id(email)
        if not row or not row['stripe_subscription_id']:
            return jsonify({"error": "No active subscription found"}), 404
        sub_id = row['stripe_subscription_id']
        # Crear o recuperar cupón de retención 50% off por 1 mes
        coupon_id = "RETENTION_50_1M"
        try:
            stripe.Coupon.retrieve(coupon_id)
        except stripe.error.InvalidRequestError:
            stripe.Coupon.create(
                id=coupon_id,
                percent_off=50,
                duration="once",
                name="Retención — 50% off 1 mes"
            )
        stripe.Subscription.modify(sub_id, coupon=coupon_id)
        print(f"[DISCOUNT] {email} — 50% aplicado")
        return jsonify({"status": "discount_applied", "message": "50% discount applied to your next month!"})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/stripe/downgrade-plan', methods=['POST'])
def downgrade_plan():
    """Baja el plan al nivel inmediatamente inferior."""
    try:
        data = request.json or {}
        email = (data.get('email') or '').strip().lower()
        target_plan = (data.get('target_plan') or '').strip()
        if not email or not target_plan:
            return jsonify({"error": "Email y plan requeridos"}), 400
        plan_map = get_stripe_plan_map()
        new_price_id = plan_map.get(target_plan)
        if not new_price_id:
            return jsonify({"error": "Invalid plan"}), 400
        if not STRIPE_SECRET_KEY:
            set_user_subscription(email, True, plan_key=target_plan, status='active')
            return jsonify({"status": "downgraded", "new_plan": target_plan})
        row = get_user_subscription_id(email)
        if not row or not row['stripe_subscription_id']:
            return jsonify({"error": "No active subscription found"}), 404
        sub_id = row['stripe_subscription_id']
        sub = stripe.Subscription.retrieve(sub_id)
        item_id = sub['items']['data'][0]['id']
        stripe.Subscription.modify(sub_id, items=[{"id": item_id, "price": new_price_id}],
                                   proration_behavior='none')
        set_user_subscription(email, True, plan_key=target_plan, status='active')
        print(f"[DOWNGRADE] {email} → {target_plan}")
        return jsonify({"status": "downgraded", "new_plan": target_plan,
                        "message": f"Plan changed to {normalize_plan_label(target_plan)} successfully."})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/tickets/submit-pending', methods=['POST'])
def submit_pending_tickets():
    try:
        data = request.json or {}
        email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        if not email:
            return jsonify({"error": "Email is required"}), 400
        if not is_user_subscribed(email):
            return jsonify({"error": "Plan is required"}), 402
        results = submit_pending_tickets_for_email(email, project_name=project_name or None)
        return jsonify({"status": "ok", "tickets": results})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/submit-ticket', methods=['POST'])
def submit_ticket():
    try:
        data = request.json or {}
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        user_request = data.get('request', '').strip()
        channel = (data.get('channel') or 'build').strip().lower()

        # Auth: verify session matches requested email
        session_email = session.get('user_email', '').strip().lower()
        if not session_email or session_email != user_email:
            return jsonify({"error": "You must be logged in"}), 401

        if not all([user_email, project_name, user_request]):
            return jsonify({"error": "Missing required fields"}), 400

        ok_tokens, token_msg, remaining = consume_user_tokens(
            user_email,
            HUMAN_SUPPORT_TOKEN_COST,
            reason="request human support"
        )
        if not ok_tokens:
            return jsonify({"error": token_msg, "remaining_tokens": remaining}), 402

        # --- CONSOLIDATION CHECK: Look for existing open ticket ---
        existing_ticket = find_existing_ticket(user_email, channel)

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

        # 3. Save to DB for Human Review or add to existing ticket
        conn = get_db_connection()
        cursor = conn.cursor()

        if existing_ticket:
            # UPDATE existing internal_alerts ticket with new message
            ticket_id = existing_ticket["id"]
            append_ticket_event(existing_ticket, existing_ticket["status"],
                              f"User request: {user_request[:200]}", actor=user_email)
            alerts = load_alerts()
            save_alerts(alerts)
            # Also log in database for tracking
            cursor.execute(
                'INSERT INTO tickets (project_name, user_email, request, status, ai_suggestion) VALUES (?, ?, ?, ?, ?)',
                (project_name, user_email, user_request, 'consolidated', ai_code)
            )
        else:
            # CREATE new ticket
            cursor.execute(
                'INSERT INTO tickets (project_name, user_email, request, status, ai_suggestion) VALUES (?, ?, ?, ?, ?)',
                (project_name, user_email, user_request, 'pending_human_review', ai_code)
            )
            ticket_id = cursor.lastrowid

        conn.commit()
        conn.close()

        return jsonify({
            "message": "Support request assigned to expert team.",
            "ticket_id": ticket_id,
            "assigned_to": "George (Design Lead)" if "design" in user_request.lower() else "Marta (Senior Dev)",
            "remaining_tokens": remaining
        })

    except Exception as e:
        print(f"Ticket Error: {e}")
        return jsonify({"error": "Internal server error"}), 500


# --- ADMIN ROUTES ---
@app.route('/api/admin/tickets', methods=['GET'])
def get_tickets():
    if not require_internal_auth():
        return jsonify({"error": "unauthorized"}), 401
    conn = get_db_connection()
    tickets = conn.execute("SELECT * FROM tickets WHERE status != 'completed' ORDER BY created_at DESC").fetchall()
    conn.close()
    return jsonify([dict(t) for t in tickets])

@app.route('/api/admin/resolve-ticket', methods=['POST'])
def resolve_ticket():
    if not require_internal_auth():
        return jsonify({"error": "unauthorized"}), 401
    try:
        data = request.json or {}
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
        
        return jsonify({"message": "Ticket resolved and code deployed."})
        
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/analyze-idea', methods=['POST'])
def analyze_idea():
    if _rate_limit(request.remote_addr, max_requests=10, window=60):
        return jsonify({"error": "Rate limit exceeded"}), 429
    try:
        data = request.json or {}
        idea = data.get('idea', '').strip()
        image_data_url = data.get('image_data_url', '')
        engine = normalize_engine(data.get('engine'))
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        # Chat con IA es libre — paywall solo al enviar a equipo humano (/api/create-ticket)
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
                "message": "Done, we reset context. Let's start fresh: tell me your new idea in one sentence.",
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
        return jsonify({"error": "Internal server error"}), 500

# --- NEW: SYNTHESIS BRAIN ---
# --- NEW: TICKET SYSTEM (Step 1: Chat -> Ticket) ---

def find_existing_ticket(client_email, channel):
    """
    Find an existing open ticket for this client+channel combination.
    Returns the ticket if found, otherwise None.
    """
    if not client_email:
        return None

    alerts = load_alerts()
    for ticket in alerts:
        if (ticket.get("client_email", "").lower() == client_email.lower() and
            ticket.get("channel", "build").lower() == channel.lower() and
            ticket.get("status") in ("pending", "accepted", "developing")):
            return ticket
    return None


def build_ticket_from_history(history, user_email, project_name, channel="build"):
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

    # 3. CREATE OR UPDATE TICKET (Consolidate by client_email + channel)
    current_alerts = load_alerts()
    existing_ticket = find_existing_ticket(user_email, channel)

    if existing_ticket:
        # UPDATE EXISTING TICKET: append event, update timestamp and summary
        existing_ticket["updated_at"] = datetime.now().isoformat()
        existing_ticket["summary"] = summary  # Update with latest summary
        existing_ticket["engineer_brief"] = engineer_brief
        existing_ticket["handoff_package"] = handoff_package
        existing_ticket["tech_stack"] = tech_stack
        existing_ticket["blueprint_md"] = blueprint_md
        existing_ticket["priority"] = priority
        existing_ticket["sla_due_at"] = sla_due_at
        append_ticket_event(existing_ticket, existing_ticket["status"],
                          f"Updated request from {user_email}. New blueprint generated.", actor="system")
        ticket_id = existing_ticket["id"]
    else:
        # CREATE NEW TICKET
        new_ticket = {
            "id": f"TKT-{int(datetime.now().timestamp())}-{uuid.uuid4().hex[:4]}",
            "project_name": project_id,
            "client_email": user_email,
            "client": user_email or "unknown@anmar.local",
            "channel": channel,
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
        current_alerts.insert(0, new_ticket)
        ticket_id = new_ticket["id"]

    save_alerts(current_alerts)

    # 4. INITIAL STATUS (Client Feedback)
    update_order_status(
        project_id,
        "pending",
        log_entry="Ticket created and sent to engineering."
    )

    # 5. INITIALIZE HUMAN CHAT with blueprint message
    try:
        chats = load_human_chats()
        if project_id not in chats:
            chats[project_id] = []
        chats[project_id].append({
            "id": str(uuid.uuid4()),
            "role": "system",
            "content": f"Blueprint generated for {project_id}. Channel: {channel}.",
            "kind": "blueprint",
            "payload": {
                "title": project_id,
                "summary": summary,
                "blueprint_md": blueprint_md[:500]
            },
            "actor": "system",
            "timestamp": datetime.now().isoformat()
        })
        save_human_chats(chats)
    except Exception as e:
        print(f"Warning: Could not init human chat: {e}")

    return {
        "message": "Request sent to engineering team.",
        "project_id": project_id,
        "status": "ticket_created"
    }


@app.route('/api/create-ticket', methods=['POST'])
def create_ticket():
    try:
        data = request.json or {}
        history = data.get('history', [])
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        channel = (data.get('channel') or 'build').strip().lower()  # build | marketing | organic
        if not history:
            return jsonify({"error": "History is required"}), 400
        if not user_email:
            return jsonify({"error": "Email is required"}), 400

        if not is_user_subscribed(user_email):
            save_pending_ticket(user_email, project_name, history)
            return jsonify({
                "requires_subscription": True,
                "status": "pending_payment",
                "message": "Your project is ready. Activate a plan to send it to our team."
            }), 402

        payload = build_ticket_from_history(history, user_email, project_name, channel=channel)
        return jsonify(payload)

    except Exception as e:
        print(f"Ticket Error: {e}")
        return jsonify({"error": "Internal server error"}), 500

# --- STEP 2: ENGINEER ACCEPTANCE (Admin Panel -> Project Folder) ---
@app.route('/api/accept-ticket', methods=['POST'])
def accept_ticket():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        data = request.json or {}
        ticket_id = data.get('ticket_id')
        engineer = data.get('engineer', 'Staff Anmar')
        if not ticket_id:
            return jsonify({"error": "ticket_id is required"}), 400
        
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
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/deliver-ticket', methods=['POST'])
def deliver_ticket():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        data = request.json or {}
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
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/admin/update-ticket', methods=['POST'])
def admin_update_ticket():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        data = request.json or {}
        ticket_id = str(data.get('ticket_id') or '').strip()
        if not ticket_id:
            return jsonify({"error": "ticket_id is required"}), 400

        status = str(data.get('status') or '').strip().lower()
        engineer = str(data.get('engineer') or '').strip()
        preview_input = data.get('preview_url')
        delivery_note = str(data.get('delivery_note') or '').strip()
        internal_notes_raw = data.get('internal_notes')
        internal_notes = None
        if internal_notes_raw is not None:
            internal_notes = str(internal_notes_raw).strip()
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
            if internal_notes is not None:
                refreshed = load_alerts()
                ticket_ref = next((t for t in refreshed if t.get('id') == ticket_id), None)
                if ticket_ref:
                    ticket_ref["internal_notes"] = internal_notes
                    ticket_ref["updated_at"] = datetime.now().isoformat()
                    save_alerts(refreshed)
                    updated = ticket_ref
        else:
            # No status transition, just update operational fields.
            ticket = normalize_ticket_status(ticket)
            if engineer:
                ticket["engineer"] = engineer
            if preview_input is not None:
                ticket["preview_url"] = normalized_preview
            if delivery_note:
                ticket["delivery_note"] = delivery_note
            if internal_notes is not None:
                ticket["internal_notes"] = internal_notes
            ticket["updated_at"] = datetime.now().isoformat()
            append_ticket_event(
                ticket,
                ticket.get("status", "pending"),
                "Internal update: preview and/or delivery notes.",
                actor=actor
            )
            save_alerts(alerts)

            update_order_status(
                project_id,
                ticket.get("status", "pending"),
                log_entry="Internal update applied to project.",
                engineer=ticket.get("engineer"),
                deployed_url=(ticket.get("preview_url") or None)
            )
            updated = ticket

        return jsonify({"success": True, "ticket": normalize_ticket_status(updated)})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

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
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        alerts = [normalize_ticket_status(a) for a in load_alerts()]
        alerts.sort(key=lambda a: a.get("updated_at", a.get("timestamp", "")), reverse=True)
        # Enrich with client plan info
        try:
            conn = get_db()
            for alert in alerts:
                client_email = alert.get('user_email') or alert.get('client_email') or ''
                if client_email:
                    row = conn.execute('SELECT subscription_plan, subscription_active FROM users WHERE email = ?', (client_email,)).fetchone()
                    if row:
                        alert['client_plan'] = row['subscription_plan'] if row['subscription_plan'] else 'none'
                        alert['client_plan_active'] = bool(row['subscription_active'])
                    else:
                        alert['client_plan'] = 'none'
                        alert['client_plan_active'] = False
        except Exception:
            pass
        return jsonify(alerts)
    except Exception:
        return jsonify([])

@app.route('/api/internal-queue', methods=['GET'])
def get_internal_queue():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
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
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/internal/order-history', methods=['GET'])
def get_internal_order_history():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
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
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/client-tickets', methods=['GET'])
def get_client_tickets():
    """
    Returns all tickets for a given client_email, grouped by project.
    Requires internal authentication.
    Query params: client_email (required)
    """
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401

        client_email = (request.args.get('client_email') or '').strip().lower()
        if not client_email:
            return jsonify({"error": "client_email parameter is required"}), 400

        alerts = [normalize_ticket_status(a) for a in load_alerts()]
        client_tickets = [
            a for a in alerts
            if str(a.get("client_email") or a.get("client") or "").strip().lower() == client_email
        ]

        # Group by project
        grouped = {}
        for ticket in client_tickets:
            project = ticket.get("project_name", "unknown")
            if project not in grouped:
                grouped[project] = []
            grouped[project].append(ticket)

        # Sort each group by updated_at
        for project in grouped:
            grouped[project].sort(key=lambda t: t.get("updated_at", t.get("timestamp", "")), reverse=True)

        return jsonify({
            "client_email": client_email,
            "tickets_by_project": grouped,
            "meta": {
                "total_tickets": len(client_tickets),
                "projects_count": len(grouped),
                "open_tickets": len([t for t in client_tickets if t.get("status") in ("pending", "accepted", "developing")])
            }
        })
    except Exception as e:
        print(f"Error in get_client_tickets: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/internal/clients', methods=['GET'])
def get_internal_clients():
    """
    Returns a consolidated list of clients (one entry per unique email).
    Merges data from the users table and alerts/tickets.
    """
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401

        conn = get_db()
        # Get all users from the users table
        users_rows = conn.execute(
            'SELECT email, name, subscription_plan, subscription_active, created_at, stripe_customer_id FROM users ORDER BY created_at DESC'
        ).fetchall()

        # Get all alerts/tickets
        alerts = [normalize_ticket_status(a) for a in load_alerts()]

        # Build a map of client email → ticket data
        ticket_map = {}
        for a in alerts:
            email = (a.get('user_email') or a.get('client_email') or '').strip().lower()
            if not email:
                continue
            if email not in ticket_map:
                ticket_map[email] = {
                    'tickets': [],
                    'channels': set(),
                    'latest_activity': None
                }
            ticket_map[email]['tickets'].append(a)
            ch = a.get('channel') or 'build'
            ticket_map[email]['channels'].add(ch)
            ts = a.get('updated_at') or a.get('created_at') or a.get('timestamp') or ''
            if ts and (not ticket_map[email]['latest_activity'] or ts > ticket_map[email]['latest_activity']):
                ticket_map[email]['latest_activity'] = ts

        # Build consolidated client list
        clients = []
        seen_emails = set()
        for row in users_rows:
            email = row['email'].strip().lower() if row['email'] else ''
            if not email or email in seen_emails:
                continue
            seen_emails.add(email)
            tdata = ticket_map.get(email, {})
            tickets = tdata.get('tickets', [])
            open_tickets = [t for t in tickets if t.get('status') in ('pending', 'pending_human_review', 'accepted', 'developing')]
            clients.append({
                'email': email,
                'name': row['name'] or email.split('@')[0],
                'plan': row['subscription_plan'] or 'none',
                'plan_active': bool(row['subscription_active']),
                'stripe_customer_id': row['stripe_customer_id'] or '',
                'created_at': row['created_at'] or '',
                'total_tickets': len(tickets),
                'open_tickets': len(open_tickets),
                'channels': list(tdata.get('channels', [])),
                'latest_activity': tdata.get('latest_activity', row['created_at'] or ''),
            })

        # Also add clients from tickets that aren't in users table
        for email, tdata in ticket_map.items():
            if email in seen_emails:
                continue
            seen_emails.add(email)
            tickets = tdata.get('tickets', [])
            open_tickets = [t for t in tickets if t.get('status') in ('pending', 'pending_human_review', 'accepted', 'developing')]
            clients.append({
                'email': email,
                'name': email.split('@')[0],
                'plan': 'none',
                'plan_active': False,
                'stripe_customer_id': '',
                'created_at': '',
                'total_tickets': len(tickets),
                'open_tickets': len(open_tickets),
                'channels': list(tdata.get('channels', [])),
                'latest_activity': tdata.get('latest_activity', ''),
            })

        # Sort: paying clients first, then by latest activity
        clients.sort(key=lambda c: (
            0 if c['plan'] != 'none' and c['plan_active'] else 1,
            c.get('latest_activity') or ''
        ), reverse=False)
        # Actually we want paying first (0 < 1), then newest activity first
        clients.sort(key=lambda c: (
            0 if c['plan'] != 'none' and c['plan_active'] else 1,
            -(len(c.get('latest_activity') or ''))  # rough sort
        ))
        # Better sort
        def client_sort_key(c):
            is_paying = 1 if (c['plan'] != 'none' and c['plan_active']) else 0
            activity = c.get('latest_activity') or '0'
            return (-is_paying, activity)
        clients.sort(key=client_sort_key, reverse=True)

        return jsonify({"clients": clients, "total": len(clients)})
    except Exception as e:
        print(f"Error in get_internal_clients: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/internal/upgrade-client', methods=['POST'])
def internal_upgrade_client():
    """
    Upgrade or change a client's plan internally.
    Admin-only. Updates subscription_plan and subscription_active in the users table.
    Optionally creates a Stripe subscription for MVP/Growth.
    """
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        # Check admin role
        internal_user = session.get('internal_user', {})
        if internal_user.get('role') != 'admin':
            return jsonify({"error": "Admin access required"}), 403

        data = request.json or {}
        client_email = (data.get('client_email') or '').strip().lower()
        new_plan = (data.get('plan') or '').strip().lower()
        custom_price = (data.get('stripe_price_id') or '').strip()

        if not client_email:
            return jsonify({"error": "client_email is required"}), 400
        if new_plan not in ('validate', 'mvp', 'growth', 'none'):
            return jsonify({"error": "Invalid plan. Must be validate, mvp, growth, or none"}), 400

        conn = get_db()
        user = conn.execute('SELECT email, stripe_customer_id FROM users WHERE email = ?', (client_email,)).fetchone()
        if not user:
            return jsonify({"error": "Client not found in database"}), 404

        # Update the plan in database
        if new_plan == 'none':
            conn.execute(
                'UPDATE users SET subscription_plan = ?, subscription_active = 0 WHERE email = ?',
                ('none', client_email)
            )
        else:
            conn.execute(
                'UPDATE users SET subscription_plan = ?, subscription_active = 1, subscription_started_at = CURRENT_TIMESTAMP WHERE email = ?',
                (new_plan, client_email)
            )
        conn.commit()

        # Optionally create Stripe subscription for MVP/Growth
        stripe_result = None
        if custom_price and new_plan in ('mvp', 'growth') and STRIPE_SECRET_KEY:
            try:
                customer_id = user['stripe_customer_id'] if user['stripe_customer_id'] else None
                if not customer_id:
                    # Create a Stripe customer
                    customer = stripe.Customer.create(email=client_email)
                    customer_id = customer.id
                    conn.execute('UPDATE users SET stripe_customer_id = ? WHERE email = ?', (customer_id, client_email))
                    conn.commit()

                # Create subscription with custom price
                subscription = stripe.Subscription.create(
                    customer=customer_id,
                    items=[{"price": custom_price}],
                    metadata={"plan": new_plan, "email": client_email, "source": "internal_upgrade"}
                )
                # Store subscription ID
                conn.execute('UPDATE users SET stripe_subscription_id = ? WHERE email = ?', (subscription.id, client_email))
                conn.commit()
                stripe_result = {"subscription_id": subscription.id, "status": subscription.status}
            except Exception as stripe_err:
                print(f"Stripe error during internal upgrade: {stripe_err}")
                stripe_result = {"error": str(stripe_err)}

        return jsonify({
            "status": "ok",
            "client_email": client_email,
            "new_plan": new_plan,
            "stripe": stripe_result
        })
    except Exception as e:
        print(f"Error in internal_upgrade_client: {e}")
        return jsonify({"error": "Internal server error"}), 500


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HUMAN_CHATS_FILE = os.path.join(BASE_DIR, 'backend', 'human_chats.json')
PROJECT_OWNERS_FILE = os.path.join(BASE_DIR, 'backend', 'project_owners.json')
PROJECT_META_FILE = os.path.join(BASE_DIR, 'backend', 'project_meta.json')
INTERNAL_USERS_FILE = os.path.join(BASE_DIR, 'backend', 'internal_users.json')

def load_project_owners():
    if not os.path.exists(PROJECT_OWNERS_FILE):
        return {}
    try:
        with open(PROJECT_OWNERS_FILE, 'r') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def save_project_owners(data):
    os.makedirs(os.path.dirname(PROJECT_OWNERS_FILE), exist_ok=True)
    tmp_path = PROJECT_OWNERS_FILE + '.tmp'
    try:
        with open(tmp_path, 'w') as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, PROJECT_OWNERS_FILE)
    except Exception as e:
        print(f"Error saving project owners: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def load_project_meta():
    if not os.path.exists(PROJECT_META_FILE):
        return {}
    try:
        with open(PROJECT_META_FILE, 'r') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def save_project_meta(data):
    os.makedirs(os.path.dirname(PROJECT_META_FILE), exist_ok=True)
    tmp_path = PROJECT_META_FILE + '.tmp'
    try:
        with open(tmp_path, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp_path, PROJECT_META_FILE)
    except Exception as e:
        print(f"Error saving project meta: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def load_internal_users():
    if not os.path.exists(INTERNAL_USERS_FILE):
        return []
    try:
        with open(INTERNAL_USERS_FILE, 'r') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []

def save_internal_users(users):
    os.makedirs(os.path.dirname(INTERNAL_USERS_FILE), exist_ok=True)
    tmp_path = INTERNAL_USERS_FILE + '.tmp'
    try:
        with open(tmp_path, 'w') as f:
            json.dump(users, f, indent=2)
        os.replace(tmp_path, INTERNAL_USERS_FILE)
    except Exception as e:
        print(f"Error saving internal users: {e}")
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def find_internal_user(identifier):
    ident = str(identifier or '').strip().lower()
    if not ident:
        return None
    for u in load_internal_users():
        if str(u.get('email', '')).lower() == ident or str(u.get('username', '')).lower() == ident:
            return u
    return None

def require_internal_auth():
    if not session.get('internal_user'):
        return False
    return True

def load_human_chats():
    if not os.path.exists(HUMAN_CHATS_FILE):
        return {}
    try:
        with open(HUMAN_CHATS_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return {}

def save_human_chats(data):
    import tempfile
    try:
        os.makedirs(os.path.dirname(HUMAN_CHATS_FILE), exist_ok=True)
        tmp_path = HUMAN_CHATS_FILE + '.tmp'
        try:
            with open(tmp_path, 'w') as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, HUMAN_CHATS_FILE)
        except Exception as e:
            print(f"Error saving human chats: {e}")
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
    except Exception as e:
        print(f"Error saving human chats: {e}")

@app.route('/api/human-chat/send', methods=['POST'])
def send_human_chat():
    try:
        data = request.json or {}
        project_name = (data.get('project_name') or '').strip().lower()
        role = data.get('role', 'human') # 'human' or 'client'
        content = (data.get('content') or data.get('message') or '').strip()
        actor = data.get('actor') or data.get('sender') or ''
        client_email = (data.get('client_email') or '').strip().lower()
        kind = (data.get('kind') or '').strip().lower()
        payload = data.get('payload')

        if role in ('human', 'internal') or kind == 'blueprint':
            if not require_internal_auth():
                return jsonify({"error": "unauthorized"}), 401
            # For internal users, override actor with verified session identity
            internal_user = session.get('internal_user', '')
            if internal_user:
                actor = internal_user
        if role == 'client':
            if not client_email:
                return jsonify({"error": "You have not logged in."}), 401
            if not is_user_subscribed(client_email):
                return jsonify({"error": "Plan is required to chat with the team.", "code": "subscription_required"}), 402
            # For clients, get verified name from DB to prevent spoofing
            try:
                conn = get_db_connection()
                user_row = conn.execute('SELECT name FROM users WHERE email = ?', (client_email,)).fetchone()
                conn.close()
                if user_row and user_row['name']:
                    actor = user_row['name']
                else:
                    actor = client_email
            except Exception:
                actor = client_email
        
        if not project_name or not content:
            return jsonify({"error": "Missing parameters"}), 400
            
        chats = load_human_chats()
        if project_name not in chats:
            chats[project_name] = []
            
        message = {
            "id": str(uuid.uuid4()),
            "role": role,
            "content": content,
            "actor": actor,
            "sender": actor,
            "timestamp": datetime.now().isoformat()
        }
        if kind:
            message["kind"] = kind
        if payload is not None:
            message["payload"] = payload
        chats[project_name].append(message)
        
        save_human_chats(chats)
        # Ensure an internal ticket exists and stays updated with unread counts.
        try:
            alerts = load_alerts()
            ticket = next((t for t in alerts if str(t.get("project_name", "")).lower() == project_name), None)
            now = datetime.now().isoformat()
            summary_text = content[:140]
            base_project = project_name[:-11] if project_name.endswith("__marketing") else project_name
            if not ticket:
                ticket = {
                    "id": str(uuid.uuid4())[:8],
                    "project_name": project_name,
                    "client_email": client_email,
                    "summary": summary_text,
                    "timestamp": now,
                    "updated_at": now,
                    "status": "pending",
                    "priority": "high",
                    "preview_url": f"/projects/{base_project}/index.html",
                    "unread_messages": 0,
                    "events": []
                }
                alerts.insert(0, ticket)
            else:
                if client_email:
                    ticket["client_email"] = client_email
                if summary_text:
                    ticket["summary"] = summary_text
                ticket["updated_at"] = now

            if role == "client":
                ticket["unread_messages"] = int(ticket.get("unread_messages") or 0) + 1
                append_ticket_event(ticket, ticket.get("status", "pending"), "Nuevo mensaje del cliente.", actor="client")
            else:
                ticket["unread_messages"] = 0
                append_ticket_event(ticket, ticket.get("status", "pending"), "Respuesta enviada al cliente.", actor=actor or "engineer")
            save_alerts(alerts)
        except Exception as e:
            print(f"Error updating internal alerts for human chat: {e}")

        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/human-chat/history', methods=['GET'])
def get_human_chat_history():
    try:
        project_name = (request.args.get('project_name') or '').strip().lower()
        mark_read = str(request.args.get('mark_read', '')).lower() in ('1', 'true', 'yes')
        if not project_name:
            return jsonify({"error": "Missing project_name"}), 400

        # Auth: allow internal users OR the client who owns the project
        client_email = (request.args.get('client_email') or request.args.get('email') or '').strip().lower()
        is_internal = require_internal_auth()
        if not is_internal:
            # Verify client owns this project by checking alerts/tickets
            if not client_email:
                return jsonify({"error": "Authentication required"}), 401
            alerts = load_alerts()
            project_owner = next(
                (t.get('client_email', '') for t in alerts if str(t.get('project_name', '')).lower() == project_name),
                None
            )
            # Allow if project doesn't exist in alerts (new chat) or email matches
            if project_owner and project_owner.lower() != client_email:
                return jsonify({"error": "You do not have access to this project"}), 403

        chats = load_human_chats()
        history = chats.get(project_name, [])
        if mark_read:
            try:
                alerts = load_alerts()
                ticket = next((t for t in alerts if str(t.get("project_name", "")).lower() == project_name), None)
                if ticket:
                    ticket["unread_messages"] = 0
                    ticket["updated_at"] = datetime.now().isoformat()
                    save_alerts(alerts)
            except Exception as e:
                print(f"Error marking chat read: {e}")
        return jsonify({"history": history})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/human-chat/accept-blueprint', methods=['POST'])
def accept_blueprint():
    try:
        data = request.json or {}
        project_name = (data.get('project_name') or '').strip().lower()
        blueprint_id = str(data.get('blueprint_id') or '').strip()
        actor = str(data.get('actor') or 'Client').strip()
        client_email = (data.get('client_email') or '').strip().lower()
        if not project_name or not blueprint_id:
            return jsonify({"error": "Missing parameters"}), 400

        # Auth: require client email and verify they own the project
        if not client_email:
            return jsonify({"error": "Authentication required"}), 401
        alerts = load_alerts()
        project_ticket = next(
            (t for t in alerts if str(t.get('project_name', '')).lower() == project_name),
            None
        )
        if project_ticket and project_ticket.get('client_email', '').lower() != client_email:
            return jsonify({"error": "You do not have permission to approve this blueprint"}), 403

        chats = load_human_chats()
        if project_name not in chats:
            return jsonify({"error": "Project not found"}), 404

        target = None
        for msg in chats[project_name]:
            if str(msg.get("id")) == blueprint_id:
                target = msg
                break

        if not target or target.get("kind") != "blueprint":
            return jsonify({"error": "Blueprint not found"}), 404

        target["accepted"] = True
        target["accepted_at"] = datetime.now().isoformat()
        if client_email:
            target["accepted_by"] = client_email

        # Add confirmation message from client.
        chats[project_name].append({
            "id": str(uuid.uuid4()),
            "role": "client",
            "content": "✅ Blueprint approved. Ready to start.",
            "actor": actor,
            "timestamp": datetime.now().isoformat(),
            "kind": "blueprint_accept"
        })
        save_human_chats(chats)

        # Update internal ticket status to developing (if exists) and mark unread.
        try:
            alerts = load_alerts()
            ticket = next((t for t in alerts if str(t.get("project_name", "")).lower() == project_name), None)
            if ticket:
                set_ticket_status(ticket.get("id"), "developing", actor="client", engineer=ticket.get("engineer"))
                refreshed = load_alerts()
                ticket_ref = next((t for t in refreshed if str(t.get("project_name", "")).lower() == project_name), None)
                if ticket_ref:
                    ticket_ref["unread_messages"] = int(ticket_ref.get("unread_messages") or 0) + 1
                    ticket_ref["updated_at"] = datetime.now().isoformat()
                    append_ticket_event(ticket_ref, ticket_ref.get("status", "developing"), "Blueprint approved by client.", actor=actor)
                    save_alerts(refreshed)
        except Exception as e:
            print(f"Error updating ticket after blueprint accept: {e}")

        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/internal/ai-reply', methods=['POST'])
def internal_ai_reply():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        data = request.json or {}
        project_name = (data.get('project_name') or '').strip().lower()
        client_email = (data.get('client_email') or '').strip().lower()
        status = (data.get('status') or '').strip().lower()
        messages = data.get('messages') or []

        # Build short conversation context (last 8 messages).
        convo_lines = []
        for msg in messages[-8:]:
            if not isinstance(msg, dict):
                continue
            role = (msg.get('role') or '').strip().lower()
            label = "Cliente" if role == "client" else "Ingeniero"
            content = str(msg.get('content') or '').strip()
            if content:
                convo_lines.append(f"{label}: {content}")
        convo = "\n".join(convo_lines) if convo_lines else "Cliente: (sin mensajes previos)"

        prompt = f"""
Eres operador interno de ANMAR. Genera 3 posibles respuestas cortas para enviar al cliente.
Reglas: español neutro, tono humano, máximo 2 frases por respuesta. Si falta información, incluye solo 1 pregunta.
No prometas tiempos exactos ni menciones que eres IA.

Proyecto: {project_name or 'N/D'}
Estado: {status or 'pending'}
Cliente: {client_email or 'N/D'}
Conversación reciente:
{convo}

Devuelve 3 opciones, una por línea, sin numeración.
""".strip()

        text = call_ai_text(prompt, engine=ENGINE_ANTIGRAVITY) or ""
        lines = [l.strip().lstrip("-•").strip() for l in text.splitlines() if l.strip()]
        suggestions = lines[:3]
        if not suggestions:
            suggestions = [
                "Gracias por el detalle. Ya lo revisé y te confirmo el siguiente paso en breve.",
                "Perfecto, con eso avanzamos. ¿Hay algún ejemplo o referencia que quieras que tomemos en cuenta?",
                "Entendido. Voy a preparar la primera propuesta y te la comparto para revisión."
            ]

        return jsonify({"suggestions": suggestions})
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

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
        return jsonify({"error": "Internal server error"}), 500

# --- ENGINEER TOOLS (The "Antigravity" for Maria) ---

@app.route('/api/engineer/file', methods=['GET', 'POST'])
def manage_project_file():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401

        json_data = request.json or {} if request.is_json else {}
        project_id = request.args.get('project_id') or json_data.get('project_id') or request.args.get('project_name') or json_data.get('project_name')
        filename = request.args.get('filename') or json_data.get('filename')

        if not project_id:
            return jsonify({"error": "Missing project_id"}), 400
        if not filename:
            return jsonify({"error": "Missing filename"}), 400

        # Validate project_id has no path traversal
        if '..' in project_id or '/' in project_id or '\\' in project_id:
            return jsonify({"error": "Invalid project ID"}), 400

        # Validate filename has no path traversal
        if '..' in filename or '/' in filename or '\\' in filename:
            return jsonify({"error": "Invalid filename"}), 400

        # Security: only allow safe filenames
        safe_name = os.path.basename(filename)
        project_dir = os.path.join(projects_base_dir, project_id)
        file_path = os.path.join(project_dir, safe_name)

        # Security check: ensure path is within project dir
        if not os.path.abspath(file_path).startswith(os.path.abspath(project_dir) + os.sep):
            return jsonify({"error": "Invalid path"}), 403

        if request.method == 'GET':
            if not os.path.exists(file_path):
                return jsonify({"content": "", "exists": False}), 200
            with open(file_path, 'r') as f:
                return jsonify({"content": f.read(), "exists": True})

        if request.method == 'POST':
            content = json_data.get('content', '')
            os.makedirs(project_dir, exist_ok=True)
            with open(file_path, 'w') as f:
                f.write(content)
            return jsonify({"success": True})

    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/engineer/ai-assist', methods=['POST'])
def engineer_ai_assist():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        data = request.json or {}
        # Accept both field-name conventions (panel sends project_name/context/prompt/history)
        project_id = data.get('project_id') or data.get('project_name') or ''
        instruction = data.get('instruction') or data.get('prompt') or ''
        target_file = data.get('target_file') or ''
        current_content = data.get('file_content', '')
        extra_context = data.get('context', '')
        history = data.get('history') or []

        if not instruction:
            return jsonify({"error": "instruction/prompt is required"}), 400

        # ----- Mode A: Code editing (target_file provided) -----
        if target_file and project_id:
            context_files = ""
            project_dir = os.path.join(projects_base_dir, project_id)
            if target_file.endswith('.html'):
                css_path = os.path.join(project_dir, 'style.css')
                if os.path.exists(css_path):
                    with open(css_path, 'r') as f: context_files += f"\n/* style.css context */\n{f.read()[:1000]}"
            if target_file.endswith('.js'):
                html_path = os.path.join(project_dir, 'index.html')
                if os.path.exists(html_path):
                    with open(html_path, 'r') as f: context_files += f"\n<!-- index.html context -->\n{f.read()[:1000]}"

            prompt = f"""
ACT AS: Senior Lead Developer (Co-pilot).
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
{{"thought": "Brief explanation of changes (1-2 sentences)", "code": "FULL new content for the file"}}
"""
            response = model.generate_content(prompt)
            text = response.text.strip()
            if text.startswith('```json'): text = text[7:]
            if text.startswith('```'): text = text[3:]
            if text.endswith('```'): text = text[:-3]
            try:
                ai_response = json.loads(text.strip())
            except Exception:
                ai_response = {"thought": "Respuesta generada.", "code": text.strip()}
            return jsonify(ai_response)

        # ----- Mode B: Conversational AI assistant (panel chat) -----
        history_text = ""
        if history:
            for msg in history[-10:]:
                role = msg.get('role', 'user')
                content = msg.get('content', '')
                history_text += f"\n{role}: {content}"

        prompt = f"""
Eres un asistente técnico senior de ANMAR Enterprises. Ayuda al ingeniero con el proyecto '{project_id}'.

{extra_context}

Historial de conversación:
{history_text}

Solicitud actual del ingeniero: "{instruction}"

Responde de forma clara, concisa y útil en español. Si te piden código, entrégalo listo para producción.
"""
        raw = call_ai_text(prompt, engine=ENGINE_ANTIGRAVITY) or "No pude generar una respuesta."
        return jsonify({"response": raw, "suggestion": raw})

    except Exception as e:
        print(f"AI Assist Error: {e}")
        return jsonify({"response": "Error interno procesando solicitud.", "thought": "Error processing.", "code": "// Error"}), 500

@app.route('/api/engineer/ai-generate', methods=['POST'])
def engineer_ai_generate():
    try:
        if not require_internal_auth():
            return jsonify({"error": "unauthorized"}), 401
        data = request.json or {}
        project_id = data.get('project_id') or data.get('project_name') or ''
        instruction = data.get('instruction') or data.get('context') or ''
        engine = data.get('engine', ENGINE_ANTIGRAVITY)
        filename = data.get('filename', 'index.html')

        if not project_id or not instruction:
            return jsonify({"error": "project_id and instruction are required"}), 400

        # Determine file type for the prompt
        is_css = filename.endswith('.css')
        is_js = filename.endswith('.js')
        is_html = filename.endswith('.html')

        if is_css:
            prompt = f"""Eres un ingeniero senior de ANMAR. Genera CSS profesional y moderno.
Instrucción: \"\"\"{instruction}\"\"\"
Entrega SOLO el CSS, sin markdown ni backticks."""
        elif is_js:
            prompt = f"""Eres un ingeniero senior de ANMAR. Genera JavaScript profesional y moderno.
Instrucción: \"\"\"{instruction}\"\"\"
Entrega SOLO el JavaScript, sin markdown ni backticks."""
        else:
            prompt = f"""Eres un ingeniero senior de ANMAR. Genera un sitio web completo en un solo archivo HTML (con CSS y JS inline si aplica).
Debe ser una primera versión presentable para mostrar al cliente como preview.
Usa diseño moderno, tipografía limpia y secciones claras.
Instrucción del cliente:
\"\"\"{instruction}\"\"\"
Entrega SOLO el HTML completo, sin markdown ni backticks."""

        code = call_ai_text(prompt, engine=engine) or ""
        # Strip markdown code fences if present
        code = code.strip()
        if code.startswith('```'):
            first_nl = code.find('\n')
            if first_nl != -1:
                code = code[first_nl+1:]
            if code.endswith('```'):
                code = code[:-3]
            code = code.strip()

        if is_html and not code.strip().lower().startswith('<!doctype'):
            code = f"<!DOCTYPE html>\n{code}"

        safe_name = os.path.basename(filename)
        project_dir = os.path.join(projects_base_dir, project_id)
        os.makedirs(project_dir, exist_ok=True)
        file_path = os.path.join(project_dir, safe_name)
        with open(file_path, 'w') as f:
            f.write(code)

        return jsonify({
            "status": "ok",
            "code": code,
            "content": code,
            "preview_url": f"/projects/{project_id}/index.html"
        })
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/create-blueprint', methods=['POST'])
def create_blueprint():
    try:
        data = request.json or {}
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
        data = request.json or {}
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
        return jsonify({"error": "Internal server error"}), 500

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
        # Edición libre — paywall solo al enviar a equipo humano
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
        return jsonify({"error": "Internal server error"}), 500

# --- ORDER STATUS MANAGER ---
# Implemented above with normalized status handling and event logs.

@app.route('/api/recharge-tokens', methods=['POST'])
def recharge_tokens():
    if _rate_limit(request.remote_addr, max_requests=5, window=60):
        return jsonify({"error": "Too many attempts. Try again in a minute."}), 429

    if not require_internal_auth():
        return jsonify({"error": "Unauthorized"}), 401

    try:
        data = request.json or {}
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
        return jsonify({"error": "Internal server error"}), 500

@app.route('/create-project', methods=['POST'])
def create_project():
    try:
        data = request.json or {}
        project_name = data.get('project_name')
        plan_content = data.get('plan')
        theme = data.get('theme', 'Modern Startup')
        user_email = data.get('user_email') # Must be sent from frontend

        # Auth: verify session matches requested email
        session_email = session.get('user_email', '').strip().lower()
        user_email_clean = (user_email or '').strip().lower()
        if not session_email or session_email != user_email_clean:
            return jsonify({"error": "You must be logged in"}), 401

        if not user_email:
            return jsonify({"error": "You must be logged in"}), 401
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
                    except Exception: pass
            
            current_alerts.insert(0, new_alert)
            tmp_alerts_path = alerts_path + '.tmp'
            try:
                with open(tmp_alerts_path, 'w') as af:
                    json.dump(current_alerts, af, indent=2)
                os.replace(tmp_alerts_path, alerts_path)
            except Exception:
                if os.path.exists(tmp_alerts_path):
                    os.remove(tmp_alerts_path)
                raise
                
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
        return jsonify({"error": "Internal server error"}), 500

# --- MARKETING MODULE ---
@app.route('/api/generate-marketing', methods=['POST'])
def generate_marketing():
    try:
        data = request.json or {}
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
        return jsonify({"error": "Internal server error"}), 500

# --- ADMIN COMMAND CENTER ENDPOINTS ---
@app.route('/api/admin/alerts', methods=['GET'])
def get_admin_alerts():
    if not require_internal_auth():
        return jsonify({"error": "unauthorized"}), 401
    alerts = [normalize_ticket_status(a) for a in load_alerts()]
    alerts.sort(key=lambda a: a.get("updated_at", a.get("timestamp", "")), reverse=True)
    return jsonify(alerts)

@app.route('/api/admin/reclaim', methods=['POST'])
def reclaim_project():
    if not require_internal_auth():
        return jsonify({"error": "unauthorized"}), 401
    try:
        data = request.json or {}
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
                    log_entry=f"{engineer} took the project from admin reclaim.",
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
        return jsonify({"error": "Internal server error"}), 500

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
        data = request.json or {}
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
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/deliver-work', methods=['POST'])
def deliver_work():
    try:
        data = request.json or {}
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
            log_entry="Code delivered from /api/deliver-work.",
            deployed_url=f"/projects/{project_id}/index.html"
        )
                
        return jsonify({"status": "completed", "message": "Code updated and pushed to production."})

    except Exception as e:
        print(f"Delivery Error: {e}")
        return jsonify({"error": "Internal server error"}), 500
    return jsonify([])

@app.route('/api/admin/system-status', methods=['GET'])
def get_system_status():
    if not require_internal_auth():
        return jsonify({"error": "unauthorized"}), 401
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
        if not os.path.exists(projects_base_dir):
            return jsonify([])
        projects = [
            name for name in os.listdir(projects_base_dir)
            if os.path.isdir(os.path.join(projects_base_dir, name)) and not name.startswith('.')
        ]
        email = str(request.args.get('email') or '').strip().lower()
        if email:
            owners = load_project_owners()
            meta = load_project_meta()
            # Legacy fallback: if there is exactly one project and no owners yet, assign it.
            if not owners and len(projects) == 1:
                owners[projects[0]] = email
                save_project_owners(owners)
            filtered = []
            for p in projects:
                owner = owners.get(p) or (meta.get(p, {}).get('owner') if isinstance(meta, dict) else None)
                if owner == email:
                    filtered.append(p)
            return jsonify(filtered)
        return jsonify(projects)
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/projects-meta', methods=['GET'])
def projects_meta():
    try:
        email = str(request.args.get('email') or '').strip().lower()
        meta = load_project_meta()
        if not email:
            return jsonify(meta)
        owners = load_project_owners()
        filtered = {}
        for project, owner in owners.items():
            if owner == email and project in meta:
                filtered[project] = meta.get(project)
        return jsonify(filtered)
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/delete-project', methods=['POST'])
def delete_project():
    try:
        data = request.json or {}
        project_name = sanitize_project_name(data.get('project_name', ''))
        user_email = str(data.get('user_email') or '').strip().lower()
        if not project_name:
            return jsonify({"error": "project_name is required"}), 400
        if user_email:
            owners = load_project_owners()
            owner = owners.get(project_name)
            if owner and owner != user_email:
                return jsonify({"error": "You do not have permission to delete this project."}), 403
        project_path = os.path.join(projects_base_dir, project_name)
        if not os.path.abspath(project_path).startswith(os.path.abspath(projects_base_dir)):
            return jsonify({"error": "Invalid project path"}), 403
        if os.path.exists(project_path):
            shutil.rmtree(project_path)
            if user_email:
                owners = load_project_owners()
                if owners.get(project_name) == user_email:
                    owners.pop(project_name, None)
                    save_project_owners(owners)
            meta = load_project_meta()
            if project_name in meta:
                meta.pop(project_name, None)
                save_project_meta(meta)
            return jsonify({"message": "Deleted", "project_name": project_name})
        return jsonify({"error": "Not found"}), 404
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500


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
        user_email = str(data.get('user_email') or '').strip().lower()
        phone = str(data.get('phone') or '').strip()
        if not user_email:
            return jsonify({"error": "login_required"}), 401
        project_name = sanitize_project_name(raw_name)
        project_path = os.path.join(projects_base_dir, project_name)

        if os.path.exists(project_path):
            # Si el proyecto ya existe y le pertenece al mismo usuario, retornarlo como éxito
            owners = load_project_owners()
            existing_owner = owners.get(project_name, '')
            if existing_owner == user_email:
                return jsonify({"project_name": project_name, "project_id": project_name, "resumed": True}), 200
            return jsonify({"error": "That project name is already taken. Please choose a different name."}), 409

        os.makedirs(project_path, exist_ok=True)

        # Save owner mapping
        if user_email:
            owners = load_project_owners()
            owners[project_name] = user_email
            save_project_owners(owners)

        # Save metadata (phone, owner, description, wizard fields)
        description = str(data.get('description') or '').strip()[:500]
        project_type = str(data.get('project_type') or '').strip()[:100]
        business_model = str(data.get('business_model') or '').strip()[:100]
        stage = str(data.get('stage') or '').strip()[:100]
        meta = load_project_meta()
        meta[project_name] = {
            "phone": phone,
            "owner": user_email,
            "description": description,
            "project_type": project_type,
            "business_model": business_model,
            "stage": stage,
            "created_at": datetime.utcnow().isoformat()
        }
        save_project_meta(meta)

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
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/delete-all-projects', methods=['POST'])
def delete_all_projects():
    if _rate_limit(request.remote_addr, max_requests=2, window=60):
        return jsonify({"error": "Too many attempts."}), 429
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
        return jsonify({"error": "Internal server error"}), 500

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
    except Exception: pass

# --- INTERACTIVE OPTIONS GENERATOR ---
def generate_contextual_options(missing_fields, phase, lang, memory=None):
    """Genera 2-4 opciones clicables contextuales para el chat interactivo."""
    memory = memory or {}
    is_en = lang == "en"

    # Si ya está listo para construir
    if phase == "confirming":
        return (
            ["Yes, let's build it!", "I need to change something", "Tell me the full summary"]
            if is_en else
            ["Sí, construyamos", "Quiero cambiar algo", "Dame el resumen completo"]
        )

    # Opciones según el campo más urgente que falta
    first_missing = missing_fields[0] if missing_fields else None

    if first_missing == "summary":
        return (
            ["I want to build a web app", "A mobile app", "A marketplace / platform", "An AI tool"]
            if is_en else
            ["Quiero una app web", "Una app móvil", "Un marketplace o plataforma", "Una herramienta con IA"]
        )

    if first_missing == "audience":
        return (
            ["B2B (companies)", "B2C (end users)", "Both B2B and B2C", "Internal / enterprise tool"]
            if is_en else
            ["B2B (empresas)", "B2C (usuarios finales)", "Ambos B2B y B2C", "Herramienta interna"]
        )

    if first_missing == "business_model":
        return (
            ["Monthly subscription (SaaS)", "One-time purchase", "Freemium", "Commission per transaction"]
            if is_en else
            ["Suscripción mensual (SaaS)", "Pago único", "Freemium", "Comisión por transacción"]
        )

    if first_missing == "timeline":
        return (
            ["1-2 weeks (MVP)", "1 month", "2-3 months", "Flexible / no deadline"]
            if is_en else
            ["1-2 semanas (MVP)", "1 mes", "2-3 meses", "Flexible / sin fecha límite"]
        )

    if first_missing == "features":
        return (
            ["User login & profiles", "Payment processing", "Admin dashboard", "Notifications & messaging"]
            if is_en else
            ["Login y perfiles de usuario", "Pagos en línea", "Panel de administración", "Notificaciones y mensajes"]
        )

    # Fase exploratoria general
    if phase in ("initial", "exploring"):
        return (
            ["Tell me more about this", "What do I need to start?", "Show me an example", "How long will it take?"]
            if is_en else
            ["Cuéntame más sobre esto", "¿Qué necesito para empezar?", "Muéstrame un ejemplo", "¿Cuánto tiempo toma?"]
        )

    # Fase de refinamiento
    if phase == "refining":
        return (
            ["That sounds good, continue", "I want to add more features", "What's the cost?", "I'm ready to build"]
            if is_en else
            ["Suena bien, continúa", "Quiero agregar más funciones", "Sí, estoy listo para construir", "Necesito ajustar algo"]
        )

    return []

@app.route('/api/continue-chat', methods=['POST'])
def continue_chat():
    try:
        data = request.json or {}
        history = trim_history_after_last_reset(data.get('history', []))
        current_input = data.get('message', '').strip()
        image_data_url = data.get('image_data_url', '')
        engine = normalize_engine(data.get('engine'))
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()

        # Auth: verify session matches requested email
        session_email = session.get('user_email', '').strip().lower()
        if not session_email or session_email != user_email:
            return jsonify({"error": "You must be logged in"}), 401

        if not user_email:
            return jsonify({"error": "login_required"}), 401
        if not project_name:
            return jsonify({"error": "project_required"}), 400
        image_context = describe_image_for_chat(image_data_url) if image_data_url else ""
        enriched_input = current_input
        if image_context:
            enriched_input = f"{current_input}\n\nAttached image context:\n{image_context}".strip()
        elif image_data_url and not current_input:
            enriched_input = "The user attached an image. Analyze the visual context and continue the brief."

        if not enriched_input:
            return jsonify({"error": "message is required"}), 400
        remaining = get_user_token_balance(user_email) if user_email else None
        if has_reset_intent(current_input):
            if user_email:
                save_chat_memory(
                    user_email,
                    reset_memory_payload(get_chat_memory(user_email, project_name=project_name) or {}),
                    project_name=project_name
                )
            return jsonify({
                "ai_reply": "Done. Context reset. Let's start fresh. What product would you like to build now?",
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

        lang = detect_language(current_input)
        options = generate_contextual_options(
            analysis["missing_fields"],
            analysis.get("phase", "initial"),
            lang,
            analysis["memory"]
        )

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
            "engine_used": engine,
            "options": options
        })
        
    except Exception as e:
        print(f"SERVER ERROR: {e}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/continue-marketing', methods=['POST'])
def continue_marketing():
    try:
        data = request.json or {}
        history = trim_history_after_last_reset(data.get('history', []))
        current_input = str(data.get('message', '') or '').strip()
        image_data_url = data.get('image_data_url', '')
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()
        construction_context = str(data.get('construction_context') or '').strip()
        bootstrap = bool(data.get('bootstrap'))
        channel = str(data.get('channel') or 'marketing').strip().lower()
        if not user_email:
            return jsonify({"error": "login_required"}), 401
        if not project_name:
            return jsonify({"error": "project_required"}), 400
        if not current_input and not image_data_url and not construction_context:
            return jsonify({"error": "message is required"}), 400

        image_context = describe_image_for_chat(image_data_url) if image_data_url else ""
        enriched_input = current_input
        if image_context:
            enriched_input = f"{current_input}\n\nContexto de imagen adjunta:\n{image_context}".strip()
        elif image_data_url and not current_input:
            enriched_input = "El usuario adjunto una imagen. Describe su contexto y sugiere activos de marketing."
        if not enriched_input and construction_context:
            enriched_input = "Inicia la estrategia de marketing con el contexto de construcción."

        if has_reset_intent(current_input):
            if user_email:
                save_chat_memory(
                    user_email,
                    reset_memory_payload(get_chat_memory(user_email, project_name=project_name) or {}),
                    project_name=project_name
                )
            return jsonify({
                "ai_reply": "Contexto de marketing reiniciado. Definamos objetivo, audiencia y oferta.",
                "missing_fields": MARKETING_REQUIRED_FIELDS,
                "brief_score": 0,
                "ready_for_handoff": False,
                "marketing_brief": {}
            })

        history_text = "\n".join(
            [f"{m.get('role', 'user')}: {m.get('content', '')}" for m in history[-12:] if isinstance(m, dict)]
        )

        context_block = f"Contexto de construcción:\n{construction_context}\n" if construction_context else ""
        bootstrap_block = "INSTRUCCION: Comienza con propuesta directa. Primera linea debe mencionar que ya se esta construyendo el proyecto y que ahora toca marketing. No hagas preguntas en la primera respuesta.\n" if bootstrap else ""

        # Channel-specific system instructions
        channel_instructions = {
            'organic': "CANAL: Contenido Orgánico. Enfócate en estrategia de contenido NO PAGO: posts, reels, stories, blogs, SEO, community management. NO incluir pauta pagada, CPC o presupuesto de ads. Los campos clave son: goal, audience, platforms, content_pillars, posting_frequency, brand_voice, key_topics.",
            'capital': "CANAL: Inversión y Capital. Enfócate en preparar pitch deck, modelo de negocio, métricas de tracción, estrategia de levantamiento de capital, valuación. Los campos clave son: funding_stage, amount_needed, business_model, revenue, traction, use_of_funds, timeline.",
            'marketing': ""
        }
        channel_block = channel_instructions.get(channel, '') + "\n" if channel_instructions.get(channel) else ""

        prompt = f"""
Proyecto: {project_name}
{channel_block}{context_block}{bootstrap_block}
Conversacion previa:
{history_text}

Mensaje actual:
{enriched_input}

Devuelve SOLO JSON valido con esta estructura:
{{
  "reply": "Respuesta corta y directa en espanol, con la siguiente pregunta o confirmacion.",
  "brief": {{
    "goal": "Objetivo de campana",
    "audience": "Audiencia ideal",
    "offer": "Oferta o propuesta de valor",
    "channels": ["Instagram", "TikTok", "YouTube", "Facebook", "Google Ads", "LinkedIn", "X", "Pinterest"],
    "budget": "Presupuesto o rango",
    "timeline": "Timeline o fecha",
    "brand_voice": "Tono de marca",
    "key_message": "Mensaje principal"
  }},
  "preview_assets": [
    {{
      "platform": "Instagram",
      "format": "Reel",
      "hook": "Hook de 1 linea",
      "caption": "Copy de 1-2 lineas",
      "cta": "CTA",
      "hashtags": ["#hashtag"],
      "metrics": {{"views": 12000, "ctr": 1.8, "cpc": 0.6}}
    }},
    {{
      "platform": "TikTok",
      "format": "Short",
      "hook": "...",
      "caption": "...",
      "cta": "...",
      "hashtags": ["#hashtag"],
      "metrics": {{"views": 18000, "ctr": 2.1, "cpc": 0.5}}
    }},
    {{
      "platform": "YouTube",
      "format": "Shorts",
      "hook": "...",
      "caption": "...",
      "cta": "...",
      "hashtags": ["#hashtag"],
      "metrics": {{"views": 14000, "ctr": 1.6, "cpc": 0.7}}
    }},
    {{
      "platform": "Facebook",
      "format": "Ad",
      "hook": "...",
      "caption": "...",
      "cta": "...",
      "hashtags": ["#hashtag"],
      "metrics": {{"views": 11000, "ctr": 1.4, "cpc": 0.8}}
    }},
    {{
      "platform": "Google Ads",
      "format": "Search",
      "hook": "...",
      "caption": "...",
      "cta": "...",
      "hashtags": ["#hashtag"],
      "metrics": {{"views": 9000, "ctr": 2.3, "cpc": 1.1}}
    }},
    {{
      "platform": "LinkedIn",
      "format": "Sponsored",
      "hook": "...",
      "caption": "...",
      "cta": "...",
      "hashtags": ["#hashtag"],
      "metrics": {{"views": 7000, "ctr": 1.2, "cpc": 1.4}}
    }},
    {{
      "platform": "X",
      "format": "Thread",
      "hook": "...",
      "caption": "...",
      "cta": "...",
      "hashtags": ["#hashtag"],
      "metrics": {{"views": 8000, "ctr": 1.1, "cpc": 0.9}}
    }},
    {{
      "platform": "Pinterest",
      "format": "Pin",
      "hook": "...",
      "caption": "...",
      "cta": "...",
      "hashtags": ["#hashtag"],
      "metrics": {{"views": 6000, "ctr": 1.0, "cpc": 0.7}}
    }}
  ],
  "ready_for_handoff": false,
  "next_step": "Proxima accion sugerida"
}}
"""

        def _marketing_ai_payload():
            text = None
            parsed_local = None
            # Marketing JSON es grande: usar max_tokens elevado y timeout mayor
            MARKETING_MAX_TOKENS = 4096
            if ANTHROPIC_API_KEY:
                text = call_anthropic_text(
                    prompt,
                    system_prompt=MARKETING_SYSTEM_INSTRUCTION_TEXT,
                    timeout_seconds=45,
                    max_tokens_override=MARKETING_MAX_TOKENS,
                )
                if text:
                    parsed_local = clean_and_parse_json(text)
            else:
                text = call_ai_text(prompt) or ""
                parsed_local = clean_and_parse_json(text) if text else None
            return parsed_local, text

        try:
            parsed, raw_text = _marketing_ai_payload()
        except Exception as e:
            return jsonify({"error": "ai_runtime_error", "detail": "Error en el motor de IA"}), 502
        if not isinstance(parsed, dict):
            # Fallback to raw text if JSON parse fails.
            reply = str(raw_text or "").strip()
            if not reply:
                reply = "Estoy listo para ayudarte con tu estrategia de marketing. ¿Cuál es tu objetivo principal con esta campaña?"
            return jsonify({
                "ai_reply": reply[:1400],
                "missing_fields": MARKETING_REQUIRED_FIELDS,
                "brief_score": 0,
                "ready_for_handoff": False,
                "marketing_brief": {},
                "preview_assets": []
            })
        reply = str(parsed.get("reply") or parsed.get("next_step") or "").strip()
        if not reply:
            return jsonify({"error": "ai_empty_reply"}), 502
        brief = normalize_marketing_brief(parsed.get("brief", {}))
        preview_assets = parsed.get("preview_assets") if isinstance(parsed.get("preview_assets"), list) else []
        missing_fields = compute_marketing_missing(brief)
        brief_score = compute_marketing_score(missing_fields)
        ready_for_handoff = bool(parsed.get("ready_for_handoff")) or (len(missing_fields) == 0)
        confirm_intent = any(k in (current_input or "").lower() for k in ["si", "sí", "yes", "ok", "listo", "confirmo", "confirmar", "de acuerdo", "dale", "envia", "envía"])
        auto_handoff = bool(confirm_intent and ready_for_handoff)

        if user_email:
            stored = get_chat_memory(user_email, project_name=project_name) or {}
            stored["marketing_brief"] = brief
            stored["marketing_ready"] = ready_for_handoff
            if preview_assets:
                stored["marketing_preview_assets"] = preview_assets[:12]
            stored["summary"] = brief.get("key_message") or brief.get("offer") or stored.get("summary", "")
            save_chat_memory(user_email, stored, project_name=project_name)

        return jsonify({
            "ai_reply": reply,
            "missing_fields": missing_fields,
            "brief_score": brief_score,
            "ready_for_handoff": ready_for_handoff,
            "auto_handoff": auto_handoff,
            "marketing_brief": brief,
            "preview_assets": preview_assets
        })
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/continue-organic', methods=['POST'])
def continue_organic():
    """
    Endpoint para el canal de Contenido Organico / Community Manager.
    Usa historial multi-turno real con Anthropic y el system prompt de organico.
    """
    try:
        data = request.json or {}
        history = data.get('history', [])
        current_input = str(data.get('message') or '').strip()
        image_data_url = data.get('image_data_url', '')
        user_email = str(data.get('user_email') or '').strip().lower()
        project_name = str(data.get('project_name') or '').strip().lower()

        if not user_email:
            return jsonify({"error": "login_required"}), 401
        if not project_name:
            return jsonify({"error": "project_required"}), 400
        if not current_input and not image_data_url:
            return jsonify({"error": "message is required"}), 400

        image_context = describe_image_for_chat(image_data_url) if image_data_url else ""
        enriched_input = current_input
        if image_context:
            enriched_input = f"{current_input}\n\nContexto de imagen adjunta:\n{image_context}".strip()
        elif image_data_url and not current_input:
            enriched_input = "El usuario adjunto una imagen. Analiza su contexto para la estrategia de contenido organico."

        if has_reset_intent(current_input):
            if user_email:
                save_chat_memory(
                    user_email,
                    reset_memory_payload(get_chat_memory(user_email, project_name=project_name) or {}),
                    project_name=project_name
                )
            return jsonify({
                "ai_reply": "Listo, empezamos de cero. Cuentame sobre tu marca o negocio: que vendes, a quien le hablas y en que redes estas activo ahora mismo.",
                "ready_for_handoff": False,
            })

        # Construir historial completo para Anthropic
        full_history = list(history) + [{"role": "user", "content": enriched_input}]

        # Llamar a Anthropic con historial real y system prompt organico
        ai_reply = None
        if ANTHROPIC_API_KEY:
            recent = full_history[-14:] if len(full_history) > 14 else full_history
            ai_reply = call_anthropic_chat(
                recent,
                system_prompt=ORGANIC_CONTENT_SYSTEM_PROMPT,
                timeout_seconds=35,
            )

        # Fallback a Gemini si Anthropic falla
        if not ai_reply:
            lang = detect_language(current_input)
            fallback_prompt = f"""
Eres Anmar AI, experto en contenido organico y community management.
Historial: {full_history[-6:]}
Mensaje actual: {enriched_input}
Responde como consultor senior de contenido organico. Un solo mensaje al cliente, sin lista de preguntas. Maximo 1 pregunta al final.
Idioma: {"English" if lang == "en" else "Spanish"}
"""
            ai_reply = call_ai_text(fallback_prompt)

        if not ai_reply:
            ai_reply = "Entiendo tu marca y veo un potencial organico enorme. Cuentame: cual es el mayor reto que tienes hoy para crear contenido de forma consistente?"

        ai_reply = ai_reply.replace("```", "").strip()

        # Guardar memoria
        if user_email:
            stored = get_chat_memory(user_email, project_name=project_name) or {}
            stored["organic_last_message"] = enriched_input
            stored["organic_last_reply"] = ai_reply[:500]
            save_chat_memory(user_email, stored, project_name=project_name)

        return jsonify({
            "ai_reply": ai_reply,
            "ready_for_handoff": False,
            "channel": "organic"
        })

    except Exception as e:
        log_debug(f"continue_organic error: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route('/api/continue-capital', methods=['POST'])
def continue_capital():
    try:
        data = request.json or {}
        history = data.get('history', [])
        current_input = (data.get('message') or '').strip()
        image_data_url = data.get('image_data_url', '')
        user_email = (data.get('user_email') or '').strip().lower()
        project_name = (data.get('project_name') or '').strip().lower()

        if not current_input:
            return jsonify({"error": "message is required"}), 400

        image_context = describe_image_for_chat(image_data_url) if image_data_url else ""
        enriched_input = current_input
        if image_context:
            enriched_input = f"{current_input}\n\nContexto de imagen adjunta:\n{image_context}".strip()
        elif image_data_url and not current_input:
            enriched_input = "El usuario adjuntó una imagen. Analiza su contexto para la estrategia de capital e inversión."

        if has_reset_intent(current_input):
            if user_email:
                save_chat_memory(
                    user_email,
                    reset_memory_payload(get_chat_memory(user_email, project_name=project_name) or {}),
                    project_name=project_name
                )
            return jsonify({
                "ai_reply": "Perfecto, empezamos de cero. Cuéntame sobre tu negocio: ¿qué etapa estás, cuánto capital necesitas y para qué lo usarías?",
                "ready_for_handoff": False,
            })

        # Construir historial completo para Anthropic
        full_history = list(history) + [{"role": "user", "content": enriched_input}]

        # Llamar a Anthropic con historial real y system prompt de capital
        ai_reply = None
        if ANTHROPIC_API_KEY:
            recent = full_history[-14:] if len(full_history) > 14 else full_history
            ai_reply = call_anthropic_chat(
                recent,
                system_prompt=CAPITAL_SYSTEM_PROMPT,
                timeout_seconds=35,
            )

        # Fallback a Gemini si Anthropic falla
        if not ai_reply:
            lang = detect_language(current_input)
            fallback_prompt = f"""
Eres Anmar AI, experto en capital, inversión y financiación para startups y negocios.
Historial: {full_history[-6:]}
Mensaje actual: {enriched_input}
Responde como un CFO y asesor de inversión senior. Un solo mensaje al cliente, sin lista de preguntas. Máximo 1 pregunta al final.
Idioma: {"English" if lang == "en" else "Spanish"}
"""
            ai_reply = call_ai_text(fallback_prompt)

        if not ai_reply:
            ai_reply = "Entiendo tu situación y veo varias rutas de financiación posibles. Cuéntame: ¿cuánto capital necesitas y en qué etapa está tu negocio?"

        ai_reply = ai_reply.replace("```", "").strip()

        # Guardar memoria
        if user_email:
            stored = get_chat_memory(user_email, project_name=project_name) or {}
            stored["capital_last_message"] = enriched_input
            stored["capital_last_reply"] = ai_reply[:500]
            save_chat_memory(user_email, stored, project_name=project_name)

        return jsonify({
            "ai_reply": ai_reply,
            "ready_for_handoff": False,
            "channel": "capital"
        })

    except Exception as e:
        log_debug(f"continue_capital error: {e}")
        return jsonify({"error": "Internal server error"}), 500


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
            existing_memory = stored.get("agent_memory") if isinstance(stored, dict) else None

        analysis = analyze_turn_state(full_history, current_input, existing_memory=existing_memory)
        # Safe payload for debug/inspection.
        return jsonify({
            "summary": analysis.get("summary"),
            "missing_fields": analysis.get("missing_fields"),
            "ready_by_data": analysis.get("ready_by_data"),
            "ready_to_build": analysis.get("ready_to_build"),
            "brief_score": compute_brief_score(analysis.get("missing_fields", [])),
            "next_question": analysis.get("next_question"),
            "memory": analysis.get("memory"),
        })
    except Exception as e:
        return jsonify({"error": "Internal server error"}), 500

@app.route('/api/ai-health', methods=['GET'])
def ai_health():
    # Optional ping via query param: /api/ai-health?ping=1
    do_ping = str(request.args.get("ping", "")).lower() in ("1", "true", "yes")
    if do_ping:
        probe = call_ai_text("Responde solo con: ok")
        if not probe:
            return jsonify({
                "connected": False,
                "model_name": AI_RUNTIME.get("model_name"),
                "last_error": AI_RUNTIME.get("last_error"),
                "last_check_at": AI_RUNTIME.get("last_check_at"),
            }), 503

    return jsonify({
        "connected": bool(AI_RUNTIME.get("connected")),
        "provider": AI_RUNTIME.get("provider"),
        "model_name": AI_RUNTIME.get("model_name"),
        "candidate_models": AI_RUNTIME.get("candidate_models", []),
        "last_error": AI_RUNTIME.get("last_error"),
        "last_check_at": AI_RUNTIME.get("last_check_at"),
        "attempts": AI_RUNTIME.get("attempts", 0),
    })


@app.errorhandler(404)
def page_not_found(e):
    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>404 | Anmar Enterprises</title><link rel="icon" type="image/svg+xml" href="/frontend/favicon.svg">
<style>*{{margin:0;padding:0;box-sizing:border-box}}body{{background:#0a0a14;color:#fff;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}}
.c{{max-width:480px;padding:40px}}h1{{font-size:6rem;font-weight:800;color:#10b981;line-height:1}}p{{color:rgba(255,255,255,0.6);margin:16px 0 32px;font-size:1.1rem}}
a{{display:inline-block;background:#10b981;color:#000;font-weight:700;padding:12px 28px;border-radius:10px;text-decoration:none;transition:opacity 0.2s}}a:hover{{opacity:0.85}}</style></head>
<body><div class="c"><h1>404</h1><p>La pagina que buscas no existe o fue movida.</p><a href="/">Volver al inicio</a></div></body></html>""", 404


if __name__ == '__main__':
    print(f"Server starting at http://localhost:5001")
    print(f"Serving Frontend from: {frontend_path}")
    print(f"📦 Projects Directory: {projects_base_dir}")
    print(f"🔑 API Key Active: {'configured' if GOOGLE_API_KEY else 'MISSING'}")
    print(f"🤖 AI Connected: {AI_RUNTIME.get('connected')} | Model: {AI_RUNTIME.get('model_name')}")
    # Create alerts dir if not exists
    os.makedirs(os.path.join(BASE_DIR, 'backend'), exist_ok=True)
    app.run(debug=False, port=5001)
