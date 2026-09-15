"""Prompt and output schema for offline question-generation evaluation."""

from __future__ import annotations

import json


ALLOWED_BLOOM_LABELS = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"}
ALLOWED_DIFFICULTY_LABELS = {"easy", "medium", "hard"}
QUESTION_EXAMPLE = {
    "questions": [
        {"q": "", "o": ["", "", "", ""], "a": 0, "e": "", "b": "", "d": "", "s": None},
        {"q": "", "o": ["", "", "", ""], "a": 0, "e": "", "b": "", "d": "", "s": None},
        {"q": "", "o": ["", "", "", ""], "a": 0, "e": "", "b": "", "d": "", "s": None},
        {"q": "", "o": ["", "", "", ""], "a": 0, "e": "", "b": "", "d": "", "s": None},
    ]
}
ONE_QUESTION_EXAMPLE = {
    "question": {"q": "", "o": ["", "", "", ""], "a": 0, "e": "", "b": "Understand", "d": "medium", "s": None}
}
COMPACT_QUESTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["q", "o", "a", "e", "b", "d", "s"],
    "properties": {
        "q": {"type": "string"},
        "o": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": {"type": "string"},
        },
        "a": {"type": "integer", "minimum": 0, "maximum": 3},
        "e": {"type": "string"},
        "b": {"type": "string", "enum": ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]},
        "d": {"type": "string", "enum": ["easy", "medium", "hard"]},
        "s": {"anyOf": [{"type": "integer"}, {"type": "string"}, {"type": "null"}]},
    },
}
OLLAMA_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["questions"],
    "properties": {
        "questions": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": COMPACT_QUESTION_SCHEMA,
        }
    },
}
ONE_QUESTION_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["question"],
    "properties": {
        "question": COMPACT_QUESTION_SCHEMA,
    },
}


def build_prompt_context(text: str, limit: int) -> str:
    cleaned = " ".join(str(text or "").replace("\x00", " ").split())
    return cleaned[:limit]


def build_evaluation_prompt(lecture_content: str, prompt_chars: int) -> str:
    """Build the same all-at-once question task used by production, tightened for RQ1 labels."""

    base = build_prompt_context(lecture_content, prompt_chars)
    schema_text = json.dumps(QUESTION_EXAMPLE, separators=(",", ":"))
    bloom_labels = ", ".join(["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"])
    difficulty_labels = ", ".join(["easy", "medium", "hard"])

    return f"""
You are generating instructor-reviewed classroom engagement questions.
Return only valid JSON. Do not include preamble, commentary, markdown, or fences.
The root JSON value must be an object.
The root object must contain exactly one key named "questions".
"questions" must contain exactly 4 objects.
Never return a top-level array.
Generate classroom engagement questions, not exam-style copy questions.
Use the lecture content as source, but rewrite in instructor-friendly wording.
Keep wording concise and use simple academic language.
Use only concrete facts from the provided slide excerpts.
Never ask "What is the lecture content?", "What is this lecture about?", or any broad summary question.
Ask about a specific decision, consequence, comparison, problem, solution, tradeoff, or scenario from a slide.
Avoid simple definition questions.
Avoid questions based only on slide titles; use the slide details and relationships between ideas.
Prefer understanding and application questions over recall-only questions.
Create exactly 4 multiple choice questions.
Question text q must be 14 words or fewer.
Each question must contain exactly 4 answer options in o.
Each option must be 8 words or fewer.
Options must be short balanced statements, not paragraphs.
Do not paste full slide sentences into options.
Make distractors plausible, related to the same concept, and not random excerpts from other slides.
Avoid obvious wrong answers.
Question text q should be direct, such as "Which statement correctly describes a relation schema?"
Do not use generic wording like "Which option best explains the impact of this slide's idea?"
Every explanation e must be 10 words or fewer.
Every question must include only these keys: q, o, a, e, b, d, s.
Use q for question text, o for options, a for correct answer index, e for explanation, b for Bloom level, d for difficulty, and s for source slide.
a must be an integer index from 0 to 3 pointing to the correct option in o.
Allowed b labels: {bloom_labels}.
Allowed d labels: {difficulty_labels}.
Use lowercase difficulty labels exactly.
Include s when a slide number is available; use null if unavailable.

Lecture content:
{base}

JSON shape:
{schema_text}
""".strip()


def build_one_question_prompt(lecture_content: str, prompt_chars: int, question_sequence_number: int) -> str:
    """Build the compact one-question task used when TinyLlama cannot finish four MCQs."""

    base = build_prompt_context(lecture_content, prompt_chars)
    schema_text = json.dumps(ONE_QUESTION_EXAMPLE, separators=(",", ":"))
    bloom_labels = ", ".join(["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"])
    difficulty_labels = ", ".join(["easy", "medium", "hard"])

    return f"""
You are generating one instructor-reviewed classroom engagement question.
Return only valid JSON. Do not include preamble, commentary, markdown, or fences.
The root JSON value must be an object.
The root object must contain exactly one key named "question".
"question" must contain exactly one multiple choice question object.
Never return a top-level array.
Generate a classroom engagement question, not an exam-style copy question.
Use the lecture content as source, but rewrite in instructor-friendly wording.
Keep wording concise and use simple academic language.
Use only concrete facts from the provided slide excerpts.
Never ask "What is the lecture content?", "What is this lecture about?", or any broad summary question.
Ask about a specific decision, consequence, comparison, problem, solution, tradeoff, or scenario from a slide.
Avoid simple definition questions.
Avoid questions based only on slide titles; use the slide details and relationships between ideas.
Prefer understanding and application questions over recall-only questions.
Generate exactly 1 multiple choice question.
This is question sequence {question_sequence_number} of 4; choose a distinct lecture concept when possible.
Question text q must be 14 words or fewer.
The question must contain exactly 4 answer options in o.
Each option must be 8 words or fewer.
Options must be short balanced statements, not paragraphs.
Do not paste full slide sentences into options.
Make distractors plausible, related to the same concept, and not random excerpts from other slides.
Avoid obvious wrong answers.
Question text q should be direct, such as "Which statement correctly describes a relation schema?"
Do not use generic wording like "Which option best explains the impact of this slide's idea?"
The explanation e must be 10 words or fewer.
The question must include only these keys: q, o, a, e, b, d, s.
Use q for question text, o for options, a for correct answer index, e for explanation, b for Bloom level, d for difficulty, and s for source slide.
a must be an integer index from 0 to 3 pointing to the correct option in o.
Allowed b labels: {bloom_labels}.
Allowed d labels: {difficulty_labels}.
Use lowercase difficulty labels exactly.
Include s when a slide number is available; use null if unavailable.

Lecture content:
{base}

JSON shape:
{schema_text}
""".strip()
