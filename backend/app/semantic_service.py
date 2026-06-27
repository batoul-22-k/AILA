import math
import re
from functools import lru_cache

SEMANTIC_CORRECT_THRESHOLD = 0.7
SEMANTIC_PARTIAL_THRESHOLD = 0.50

SEMANTIC_WEIGHT = 0.70
CONCEPT_WEIGHT = 0.30


@lru_cache(maxsize=1)
def get_sentence_transformer():
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        return None

    return SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")


def cosine_similarity(first, second) -> float:
    dot = sum(a * b for a, b in zip(first, second))
    first_norm = math.sqrt(sum(a * a for a in first))
    second_norm = math.sqrt(sum(b * b for b in second))

    if first_norm == 0 or second_norm == 0:
        return 0.0

    return dot / (first_norm * second_norm)


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def normalize_terms(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.lower()))


def normalized_exact_match(expected_answer: str, student_answer: str) -> bool:
    return normalize_terms(expected_answer) == normalize_terms(student_answer)


def concept_coverage_score(key_concepts: list[str], student_answer: str) -> float:
    if not key_concepts:
        return 0.0

    answer = normalize_text(student_answer)
    matched = 0

    for concept in key_concepts:
        concept = normalize_text(concept)
        if concept and concept in answer:
            matched += 1

    return matched / len(key_concepts)


def lexical_similarity(expected_answer: str, student_answer: str) -> float:
    expected_terms = set(re.findall(r"\w+", expected_answer.lower()))
    student_terms = set(re.findall(r"\w+", student_answer.lower()))

    if not expected_terms or not student_terms:
        return 0.0

    return len(expected_terms & student_terms) / len(expected_terms | student_terms)


def semantic_label_for(score: float) -> str:
    if score >= SEMANTIC_CORRECT_THRESHOLD:
        return "correct"
    if score >= SEMANTIC_PARTIAL_THRESHOLD:
        return "partial"
    return "incorrect"


def evaluate_short_answer(
    expected_answer: str,
    student_answer: str,
    key_concepts: list[str] | None = None,
) -> dict:
    key_concepts = key_concepts or []

    if not expected_answer.strip() or not student_answer.strip():
        return {
            "semantic_similarity": 0.0,
            "concept_coverage": 0.0,
            "final_score": 0.0,
            "semantic_label": "incorrect",
            "semantic_engine": "empty",
        }

    if normalized_exact_match(expected_answer, student_answer):
        return {
            "semantic_similarity": 1.0,
            "concept_coverage": 1.0 if key_concepts else 0.0,
            "final_score": 1.0,
            "semantic_label": "correct",
            "semantic_engine": "exact-match",
            "weights": {
                "semantic_similarity": 1.0,
                "concept_coverage": 0.0,
            },
        }

    model = get_sentence_transformer()

    if model:
        expected_embedding, student_embedding = model.encode(
            [expected_answer, student_answer]
        )
        semantic_score = cosine_similarity(
            expected_embedding.tolist(),
            student_embedding.tolist(),
        )
        engine = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    else:
        semantic_score = lexical_similarity(expected_answer, student_answer)
        engine = "lexical-fallback"

    has_concepts = bool(key_concepts)
    concept_score = (
        concept_coverage_score(key_concepts, student_answer)
        if has_concepts
        else lexical_similarity(expected_answer, student_answer)
    )
    semantic_weight = SEMANTIC_WEIGHT
    concept_weight = CONCEPT_WEIGHT

    final_score = (semantic_weight * semantic_score) + (concept_weight * concept_score)

    final_score = round(max(0.0, min(final_score, 1.0)), 4)
    semantic_score = round(max(0.0, min(semantic_score, 1.0)), 4)
    concept_score = round(max(0.0, min(concept_score, 1.0)), 4)

    return {
        "semantic_similarity": semantic_score,
        "concept_coverage": concept_score,
        "final_score": final_score,
        "semantic_label": semantic_label_for(final_score),
        "semantic_engine": engine,
        "weights": {
            "semantic_similarity": semantic_weight,
            "concept_coverage": concept_weight,
        },
    }
