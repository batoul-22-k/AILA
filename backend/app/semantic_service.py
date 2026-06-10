import math
import re
from functools import lru_cache


SEMANTIC_CORRECT_THRESHOLD = 0.80
SEMANTIC_PARTIAL_THRESHOLD = 0.60


@lru_cache(maxsize=1)
def get_sentence_transformer():
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        return None
    return SentenceTransformer("all-MiniLM-L6-v2")


def cosine_similarity(first: list[float], second: list[float]) -> float:
    dot = sum(left * right for left, right in zip(first, second))
    first_norm = math.sqrt(sum(value * value for value in first))
    second_norm = math.sqrt(sum(value * value for value in second))
    if first_norm == 0 or second_norm == 0:
        return 0.0
    return dot / (first_norm * second_norm)


def lexical_similarity(expected_answer: str, student_answer: str) -> float:
    expected_terms = set(re.findall(r"\w+", expected_answer.lower()))
    student_terms = set(re.findall(r"\w+", student_answer.lower()))
    if not expected_terms or not student_terms:
        return 0.0
    return len(expected_terms & student_terms) / len(expected_terms | student_terms)


def semantic_label_for(score: float) -> str:
    # TODO: Make semantic evaluation thresholds configurable per class or institution.
    if score >= SEMANTIC_CORRECT_THRESHOLD:
        return "correct"
    if score >= SEMANTIC_PARTIAL_THRESHOLD:
        return "partial"
    return "incorrect"


def evaluate_short_answer(expected_answer: str, student_answer: str) -> dict:
    if not expected_answer.strip() or not student_answer.strip():
        return {"semantic_score": 0.0, "semantic_label": "incorrect", "semantic_engine": "empty"}

    model = get_sentence_transformer()
    if model:
        expected_embedding, student_embedding = model.encode([expected_answer, student_answer])
        score = cosine_similarity(expected_embedding.tolist(), student_embedding.tolist())
        engine = "sentence-transformers/all-MiniLM-L6-v2"
    else:
        score = lexical_similarity(expected_answer, student_answer)
        engine = "lexical-fallback"

    score = round(max(0.0, min(score, 1.0)), 4)
    return {
        "semantic_score": score,
        "semantic_label": semantic_label_for(score),
        "semantic_engine": engine,
    }
