import base64
import io
import json
import random
import re
import socket
import string
import subprocess
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, urlunsplit
from pathlib import Path

import fitz
import qrcode
from fastapi import UploadFile
from pptx import Presentation
from pptx.util import Inches, Pt

from app.config import get_settings
from app.models import InstructorQuestion, new_id


def get_ollama_base_url() -> str:
    parsed = urlsplit(get_settings().ollama_url)
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", "")).rstrip("/")


def get_ollama_tags_url() -> str:
    return f"{get_ollama_base_url()}/api/tags"


def get_installed_ollama_models() -> list[str]:
    request = urllib.request.Request(get_ollama_tags_url(), method="GET")
    with urllib.request.urlopen(request, timeout=5) as response:
        raw = json.loads(response.read().decode("utf-8"))
    return [model.get("name", "") for model in raw.get("models", []) if model.get("name")]


def get_ollama_status() -> dict:
    settings = get_settings()
    try:
        models = get_installed_ollama_models()
        requested = settings.ollama_model
        has_model = requested in models or f"{requested}:latest" in models
        return {
            "running": True,
            "base_url": get_ollama_base_url(),
            "generate_url": settings.ollama_url,
            "model": requested,
            "models": models,
            "model_available": has_model,
            "message": "Ollama is reachable." if has_model else f"Ollama is running, but model '{requested}' is not pulled.",
        }
    except Exception as exc:
        return {
            "running": False,
            "base_url": get_ollama_base_url(),
            "generate_url": settings.ollama_url,
            "model": settings.ollama_model,
            "models": [],
            "model_available": False,
            "message": f"Ollama is not reachable: {exc}",
        }


def start_ollama_server() -> dict:
    status = get_ollama_status()
    if status["running"]:
        return status

    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=creationflags,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Ollama is not installed or is not available on PATH.") from exc
    except Exception as exc:
        raise RuntimeError(f"Could not start Ollama: {exc}") from exc

    for _ in range(15):
        time.sleep(1)
        status = get_ollama_status()
        if status["running"]:
            return status

    raise RuntimeError("Started Ollama, but it did not become reachable within 15 seconds.")


def get_storage_root() -> Path:
    root = Path(get_settings().storage_dir)
    root.mkdir(parents=True, exist_ok=True)
    (root / "uploads").mkdir(exist_ok=True)
    (root / "presentations").mkdir(exist_ok=True)
    return root


async def save_upload_file(file: UploadFile, upload_id: str) -> Path:
    suffix = Path(file.filename or "lecture").suffix.lower()
    target = get_storage_root() / "uploads" / f"{upload_id}{suffix}"
    target.write_bytes(await file.read())
    return target


def extract_readable_content(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
      return extract_pdf_text(path)
    if suffix == ".pptx":
      return extract_pptx_text(path)
    raise ValueError("Only PPTX and PDF files are supported.")


def extract_pdf_text(path: Path) -> str:
    lines: list[str] = []
    with fitz.open(path) as document:
        for page_index, page in enumerate(document, start=1):
            text = page.get_text("text").strip()
            if text:
                lines.append(f"[Page {page_index}]\n{text}")
    return "\n\n".join(lines)


def extract_pptx_text(path: Path) -> str:
    presentation = Presentation(path)
    lines: list[str] = []
    for slide_index, slide in enumerate(presentation.slides, start=1):
        slide_lines: list[str] = []
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text.strip():
                slide_lines.append(shape.text.strip())
        if slide_lines:
            lines.append(f"[Slide {slide_index}]\n" + "\n".join(slide_lines))
    return "\n\n".join(lines)


def clean_extracted_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def build_question_prompt(
    text: str,
    regenerate_question: InstructorQuestion | None = None,
    question_type: str | None = None,
    bloom_level: str | None = None,
    difficulty: str | None = None,
    output_language: str | None = None,
    question_index: int | None = None,
    avoid_questions: list[str] | None = None,
) -> str:
    settings = get_settings()
    base = text[: settings.ollama_prompt_chars]
    regenerate = ""
    if regenerate_question:
        regenerate = (
            "\nRegenerate only this question while preserving the same lecture topic and improving quality:\n"
            f"{regenerate_question.model_dump_json()}\n"
        )
    avoid = "\n".join(f"- {question}" for question in (avoid_questions or []) if question)
    avoid_block = f"\nDo not repeat or closely paraphrase these previous questions:\n{avoid}\n" if avoid else ""

    if question_type:
        options_instruction = (
            'Use exactly 4 non-empty answer options. Example options: ["Concept A", "Concept B", "Concept C", "Concept D"].'
            if question_type == "mcq"
            else "Use an empty options array: []."
        )
        example_options = '["Definition", "Example", "Process", "Outcome"]' if question_type == "mcq" else "[]"
        example_answer = "Definition" if question_type == "mcq" else "A concise expected answer based on the lecture."
        answer_rule = "correct_answer must match one option" if question_type == "mcq" else "correct_answer must be a concise expected short answer"
        return f"""
You are generating one instructor-reviewed classroom engagement question.
Return only valid JSON. Do not include markdown fences, commentary, or extra text.
Return exactly one question object inside the questions array.
Do not create a second question.
Do not leave any field empty.
Do not copy the example wording from the JSON shape.
Choose a different lecture concept than any previous question.
Keep wording concise and use the lecture content.
Rule: {answer_rule}.
{options_instruction}

Lecture content:
{base}
{regenerate}
{avoid_block}

Create exactly 1 {question_type} question.
Question number in this set: {question_index or 1}
Bloom level: {bloom_level or "Understand"}
Difficulty: {difficulty or "Medium"}
Output language: {output_language or "en"}

JSON shape:
{{
  "questions": [
    {{
      "type": "{question_type}",
      "question_text": "A complete question based on the lecture content?",
      "options": {example_options},
      "correct_answer": "{example_answer}",
      "explanation": "One short reason why the answer is correct.",
      "bloom_level": "{bloom_level or "Understand"}",
      "difficulty": "{difficulty or "Medium"}",
      "source_slide": null
    }}
  ]
}}
""".strip()

    return f"""
You are generating instructor-reviewed classroom engagement questions.
Return only valid JSON. Do not include markdown fences.
Keep wording concise.

Lecture content:
{base}
{regenerate}

Create exactly:
- 3 multiple choice questions
- 1 short answer question

JSON shape:
{{
  "questions": [
    {{
      "type": "mcq",
      "question_text": "",
      "options": ["", "", "", ""],
      "correct_answer": "",
      "explanation": "",
      "bloom_level": "",
      "difficulty": "",
      "source_slide": null
    }},
    {{
      "type": "short_answer",
      "question_text": "",
      "options": [],
      "correct_answer": "",
      "explanation": "",
      "bloom_level": "",
      "difficulty": "",
      "source_slide": null
    }}
  ]
}}
""".strip()


def extract_first_balanced_json_object(text: str, start_index: int = 0) -> dict | None:
    start = text.find("{", start_index)
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    parsed = json.loads(text[start : index + 1])
                except json.JSONDecodeError:
                    return None
                return parsed if isinstance(parsed, dict) else None
    return None


def parse_ollama_question_payload(model_response: str | dict | list) -> dict | list:
    if not isinstance(model_response, str):
        return model_response

    cleaned = model_response.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.DOTALL).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        questions_match = re.search(r'"questions"\s*:\s*\[', cleaned)
        if questions_match:
            first_question = extract_first_balanced_json_object(cleaned, questions_match.end())
            if first_question:
                return {"questions": [first_question]}

        first_object = extract_first_balanced_json_object(cleaned)
        if first_object and "questions" not in first_object:
            return {"questions": [first_object]}

        preview = cleaned[:300].replace("\n", " ")
        raise RuntimeError(f"Ollama returned invalid JSON for questions. Preview: {preview}") from exc


def fallback_question_from_lecture(
    text: str,
    question_type: str | None,
    bloom_level: str | None,
    difficulty: str | None,
    question_index: int | None = None,
    avoid_questions: list[str] | None = None,
) -> dict:
    words = re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", text)
    avoid_text = " ".join(avoid_questions or []).lower()
    stop_words = {"this", "that", "with", "from", "were", "have", "will", "lecture", "content", "question"}
    candidates = []
    for word in words:
        normalized = word.lower()
        if normalized in stop_words or normalized in avoid_text:
            continue
        if normalized not in [candidate.lower() for candidate in candidates]:
            candidates.append(word)
    if not candidates:
        candidates = [word for word in words if word.lower() not in stop_words] or ["the lecture topic"]
    offset = max((question_index or 1) - 1, 0)
    topic = candidates[offset % len(candidates)]
    normalized_type = question_type or "mcq"
    if normalized_type == "short_answer":
        return {
            "type": "short_answer",
            "question_text": f"Explain the main idea related to {topic} from the lecture.",
            "options": [],
            "correct_answer": f"A concise explanation of {topic} using the lecture content.",
            "explanation": "This answer should connect the key concept to the lecture material.",
            "bloom_level": bloom_level or "Understand",
            "difficulty": difficulty or "Medium",
            "source_slide": None,
        }

    options = [topic, "A distractor concept", "An unrelated detail", "A partial example"]
    return {
        "type": "mcq",
        "question_text": f"Which option best matches the key concept highlighted in the lecture about {topic}?",
        "options": options,
        "correct_answer": options[0],
        "explanation": f"{topic} is the lecture concept used to build this question.",
        "bloom_level": bloom_level or "Understand",
        "difficulty": difficulty or "Medium",
        "source_slide": None,
    }


def repair_question_dict(
    raw: dict,
    text: str,
    question_type: str | None,
    bloom_level: str | None,
    difficulty: str | None,
    question_index: int | None = None,
    avoid_questions: list[str] | None = None,
) -> dict:
    fallback = fallback_question_from_lecture(text, question_type or raw.get("type"), bloom_level, difficulty, question_index, avoid_questions)
    repaired = {**fallback, **raw}

    placeholder_question = str(repaired.get("question_text") or "").strip().lower()
    if not repaired.get("question_text") or placeholder_question.startswith("a complete question based on the lecture content"):
        repaired["question_text"] = fallback["question_text"]
    if not repaired.get("correct_answer") or repaired.get("correct_answer") == "Definition":
        repaired["correct_answer"] = fallback["correct_answer"]
    if not repaired.get("explanation") and raw.get("explanaition"):
        repaired["explanation"] = raw.get("explanaition")
    if not repaired.get("explanation"):
        repaired["explanation"] = fallback["explanation"]

    if (question_type or repaired.get("type")) == "mcq":
        options = [option for option in repaired.get("options", []) if str(option).strip()]
        if options == ["Definition", "Example", "Process", "Outcome"]:
            options = []
        fallback_options = fallback["options"]
        repaired["options"] = (options + fallback_options)[:4]
        if repaired["correct_answer"] not in repaired["options"]:
            repaired["correct_answer"] = repaired["options"][0]
    else:
        repaired["options"] = []

    return repaired


def call_ollama_for_questions(
    text: str,
    regenerate_question: InstructorQuestion | None = None,
    question_type: str | None = None,
    bloom_level: str | None = None,
    difficulty: str | None = None,
    output_language: str | None = None,
    question_index: int | None = None,
    avoid_questions: list[str] | None = None,
) -> list[InstructorQuestion]:
    settings = get_settings()
    payload = {
        "model": settings.ollama_model,
        "prompt": build_question_prompt(
            text,
            regenerate_question,
            question_type,
            bloom_level,
            difficulty,
            output_language,
            question_index,
            avoid_questions,
        ),
        "stream": False,
        "format": "json",
        "keep_alive": "10m",
        "options": {
            "temperature": 0.2,
            "num_ctx": settings.ollama_num_ctx,
            "num_predict": settings.ollama_num_predict,
        },
    }
    request = urllib.request.Request(
        settings.ollama_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=settings.ollama_timeout_seconds) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except TimeoutError as exc:
        raise RuntimeError(
            f"Ollama timed out after {settings.ollama_timeout_seconds}s while generating questions. "
            "The model may still be loading or running slowly on CPU. Try again once it is warm, "
            f"or use a smaller model / increase OLLAMA_TIMEOUT_SECONDS."
        ) from exc
    except socket.timeout as exc:
        raise RuntimeError(
            f"Ollama timed out after {settings.ollama_timeout_seconds}s while generating questions. "
            "The model may still be loading or running slowly on CPU. Try again once it is warm, "
            f"or use a smaller model / increase OLLAMA_TIMEOUT_SECONDS."
        ) from exc
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"Ollama returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama is not reachable at {settings.ollama_url}. Start Ollama and pull {settings.ollama_model}.") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("Ollama returned a non-JSON response.") from exc

    model_response = raw.get("response", raw)
    try:
        parsed = parse_ollama_question_payload(model_response)
    except RuntimeError:
        parsed = {"questions": [fallback_question_from_lecture(text, question_type, bloom_level, difficulty, question_index, avoid_questions)]}

    questions = parsed.get("questions", parsed if isinstance(parsed, list) else [])
    if not isinstance(questions, list) or not questions:
        raise ValueError("Ollama did not return a valid questions array.")

    questions = [
        repair_question_dict(question, text, question_type, bloom_level, difficulty, question_index, avoid_questions)
        for question in questions
        if isinstance(question, dict)
    ]
    if not questions:
        questions = [fallback_question_from_lecture(text, question_type, bloom_level, difficulty, question_index, avoid_questions)]
    normalized = [normalize_question(question) for question in questions]
    if question_type:
        normalized = normalized[:1]
        for question in normalized:
            question.type = question_type
            question.bloom_level = bloom_level or question.bloom_level
            question.difficulty = difficulty or question.difficulty
            if question_type == "short_answer":
                question.options = []
    return normalized


def normalize_question(raw: dict) -> InstructorQuestion:
    question_type = raw.get("type", "mcq")
    if question_type not in {"mcq", "short_answer"}:
        question_type = "short_answer" if "short" in question_type else "mcq"

    options = raw.get("options") or []
    if question_type == "short_answer":
        options = []

    return InstructorQuestion(
        question_id=raw.get("question_id") or new_id("question"),
        upload_id=raw.get("upload_id"),
        type=question_type,
        question_text=raw.get("question_text") or raw.get("prompt") or "Untitled question",
        options=options,
        correct_answer=raw.get("correct_answer") or "",
        explanation=raw.get("explanation") or raw.get("explanaition") or "",
        bloom_level=raw.get("bloom_level") or raw.get("bloom_taxonomy") or "Understanding",
        difficulty=raw.get("difficulty") or "Medium",
        source_slide=raw.get("source_slide"),
        status=raw.get("status") or "generated",
    )


def make_session_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def make_join_link(session_code: str) -> str:
    frontend_origin = get_settings().frontend_origin.rstrip("/")
    return f"{frontend_origin}/student/join/{session_code}"


def make_qr_base64(data: str) -> str:
    image = qrcode.make(data)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def reconstruct_presentation(questions: list[InstructorQuestion], upload_id: str) -> tuple[str, Path]:
    presentation = Presentation()
    title_layout = presentation.slide_layouts[0]
    title_slide = presentation.slides.add_slide(title_layout)
    title_slide.shapes.title.text = "Engagement Questions"
    title_slide.placeholders[1].text = "Generated by AILA"

    for index, question in enumerate(questions, start=1):
        slide = presentation.slides.add_slide(presentation.slide_layouts[5])
        slide.shapes.title.text = f"Engagement Question {index}"
        box = slide.shapes.add_textbox(Inches(0.8), Inches(1.35), Inches(8.6), Inches(4.7))
        frame = box.text_frame
        frame.word_wrap = True
        frame.paragraphs[0].text = question.question_text
        frame.paragraphs[0].font.size = Pt(24)
        frame.paragraphs[0].font.bold = True

        for option in question.options:
            paragraph = frame.add_paragraph()
            paragraph.text = f"- {option}"
            paragraph.font.size = Pt(18)

        notes = frame.add_paragraph()
        notes.text = f"Bloom: {question.bloom_level} | Difficulty: {question.difficulty}"
        notes.font.size = Pt(14)

    file_id = new_id("pptx")
    filename = f"smartclass_engagement_{upload_id}.pptx"
    path = get_storage_root() / "presentations" / f"{file_id}.pptx"
    presentation.save(path)
    return filename, path
