import csv
import asyncio
import socket
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.models import GenerateQuestionsRequest, LLMConnectionTestRequest
from app.api.instructor import test_instructor_llm_connection
from app.debug_export import (
    build_debug_export_payload,
    build_model_comparison_summary,
    write_llm_debug_export,
    write_model_comparison_summary,
)
from app import instructor_services


def provider_settings(**overrides):
    defaults = {
        "ollama_url": "http://localhost:11434/api/generate",
        "ollama_model": "qwen2.5:1.5b",
        "ollama_provider": "ollama-local",
        "ollama_local_base_url": "",
        "ollama_local_model": "",
        "ollama_cloud_base_url": "https://ollama.example.test",
        "ollama_cloud_model": "gpt-oss:20b-cloud",
        "ollama_cloud_api_key": "",
        "ollama_timeout_seconds": 1,
        "ollama_prompt_chars": 1800,
        "ollama_num_ctx": 1024,
        "ollama_num_predict": 280,
        "ollama_num_gpu": 0,
        "ollama_num_thread": 0,
        "enable_debug_export": True,
        "debug_export_include_full_prompt": True,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def sample_request(model: str = "tinyllama") -> dict:
    return {
        "model": model,
        "prompt": "Full prompt",
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 1,
            "num_ctx": 1024,
            "num_predict": 280,
        },
    }


def sample_raw_question(correct_answer: object = "Concept A", options: list[str] | None = None) -> str:
    return json.dumps(
        {
            "questions": [
                {
                    "type": "mcq",
                    "question_text": "Which concept matches the lecture idea?",
                    "options": options or ["Concept A", "Concept B", "Concept C", "Concept D"],
                    "correct_answer": correct_answer,
                    "explanation": "Concept A is supported.",
                    "bloom_level": "Understand",
                    "difficulty": "Medium",
                    "source_slide": 1,
                }
            ]
        }
    )


def build_export(
    *,
    model: str = "tinyllama",
    raw_response: str | None = None,
    parsed_ollama_response: dict | None = None,
    success: bool = True,
    processing_time_ms: int | None = 2310,
    request_metadata: dict | None = None,
    input_metadata: dict | None = None,
    lecture_text: str | None = "Lecture content",
    error: dict | None = None,
) -> dict:
    return build_debug_export_payload(
        timestamp=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc),
        lecture_id="upload_test",
        class_id="class_test",
        instructor_id="user_test",
        model=model,
        provider="ollama",
        system_prompt="",
        user_prompt="Full prompt",
        request_payload=sample_request(model),
        raw_response=sample_raw_question() if raw_response is None else raw_response,
        parsed_ollama_response=parsed_ollama_response
        if parsed_ollama_response is not None
        else {
            "model": model,
            "response": sample_raw_question(),
            "done": True,
            "done_reason": "stop",
            "prompt_eval_count": 123,
            "eval_count": 45,
            "load_duration": 10_000_000,
            "prompt_eval_duration": 120_000_000,
            "eval_duration": 2_310_000_000,
            "total_duration": 2_500_000_000,
        },
        generation_success=success,
        processing_time_ms=processing_time_ms,
        http_status=200 if success else None,
        request_metadata=request_metadata,
        input_metadata=input_metadata
        if input_metadata is not None
        else {
            "question_type": "mcq",
            "question_number": 1,
            "bloom_level": "Understand",
            "difficulty": "Medium",
            "output_language": "en",
            "requested_question_count": 1,
            "previous_questions": [],
        },
        lecture_text=lecture_text,
        error=error,
    )


class FakeOllamaResponse:
    status = 200

    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def ollama_payload(raw_response: str | None = None) -> dict:
    return {
        "response": raw_response if raw_response is not None else sample_raw_question(),
        "done": True,
        "done_reason": "stop",
        "prompt_eval_count": 10,
        "eval_count": 5,
        "eval_duration": 1_000_000_000,
    }


class DebugExportTest(unittest.TestCase):
    def test_local_provider_configuration_uses_legacy_default_model(self):
        with patch("app.instructor_services.get_settings", return_value=provider_settings()):
            config = instructor_services.resolve_ollama_provider()
        self.assertEqual(config.provider, "ollama-local")
        self.assertEqual(config.deployment_type, "local")
        self.assertEqual(config.base_url, "http://localhost:11434")
        self.assertEqual(config.model, "qwen2.5:1.5b")

    def test_cloud_provider_configuration_uses_configured_model(self):
        settings = provider_settings(ollama_provider="ollama-cloud", ollama_cloud_api_key="secret-token")
        with patch("app.instructor_services.get_settings", return_value=settings):
            config = instructor_services.resolve_ollama_provider()
        self.assertEqual(config.provider, "ollama-cloud")
        self.assertEqual(config.deployment_type, "cloud")
        self.assertEqual(config.base_url, "https://ollama.example.test")
        self.assertEqual(config.model, "gpt-oss:20b-cloud")
        self.assertEqual(config.api_key, "secret-token")

    def test_invalid_provider_and_model_are_rejected(self):
        with patch("app.instructor_services.get_settings", return_value=provider_settings()):
            with self.assertRaises(ValueError):
                instructor_services.resolve_ollama_provider("not-real")
            with self.assertRaises(ValueError):
                instructor_services.resolve_ollama_provider("ollama-local", "arbitrary-model")

    def test_bearer_token_header_is_sent_only_to_transport(self):
        captured = []

        def fake_urlopen(request, timeout):
            captured.append(request)
            return FakeOllamaResponse(ollama_payload())

        with patch("app.instructor_services.urllib.request.urlopen", side_effect=fake_urlopen):
            result = instructor_services.perform_ollama_generate_request(
                provider="ollama-cloud",
                base_url="https://ollama.example.test",
                model="gpt-oss:20b-cloud",
                api_key="secret-token",
                prompt="prompt",
                options={"temperature": 0, "num_ctx": 16, "num_predict": 8},
                timeout=1,
            )
        self.assertEqual(captured[0].get_header("Authorization"), "Bearer secret-token")
        self.assertNotIn("Authorization", json.dumps(result["safe_payload"]))
        self.assertNotIn("secret-token", json.dumps(result["safe_payload"]))

    def test_secret_redaction_removes_cloud_token(self):
        settings = provider_settings(ollama_cloud_api_key="secret-token")
        with patch("app.instructor_services.get_settings", return_value=settings):
            redacted = instructor_services.redact_secret_text("Authorization: Bearer secret-token")
        self.assertNotIn("secret-token", redacted)
        self.assertIn("[REDACTED]", redacted)

    def test_debug_export_records_provider_metadata_without_secrets(self):
        export = build_debug_export_payload(
            timestamp=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc),
            lecture_id="upload_test",
            class_id="class_test",
            instructor_id="user_test",
            model="gpt-oss:20b-cloud",
            provider="ollama-cloud",
            system_prompt="",
            user_prompt="Full prompt",
            request_payload=sample_request("gpt-oss:20b-cloud") | {
                "provider": "ollama-cloud",
                "deployment_type": "cloud",
                "endpoint_label": "ollama-cloud:ollama.example.test",
            },
            raw_response=sample_raw_question(),
            parsed_ollama_response={
                "model": "gpt-oss:20b-cloud",
                "response": sample_raw_question(),
                "done": True,
                "done_reason": "stop",
                "prompt_eval_count": 10,
                "eval_count": 5,
            },
            generation_success=True,
            processing_time_ms=100,
            http_status=200,
            request_metadata={"deployment_type": "cloud", "endpoint_label": "ollama-cloud:ollama.example.test"},
            input_metadata={"question_type": "mcq", "question_number": 1, "requested_question_count": 1},
            lecture_text="Lecture",
        )
        serialized = json.dumps(export)
        self.assertEqual(export["metadata"]["provider"], "ollama-cloud")
        self.assertEqual(export["metadata"]["deployment_type"], "cloud")
        self.assertEqual(export["metadata"]["endpoint_label"], "ollama-cloud:ollama.example.test")
        self.assertEqual(export["metadata"]["prompt_tokens"], 10)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("secret-token", serialized)

    def test_connection_test_endpoint_returns_safe_information(self):
        expected = {
            "provider": "ollama-local",
            "configured_model": "tinyllama",
            "reachable": True,
            "http_status": 200,
            "elapsed_seconds": 0.1,
            "response_model": "tinyllama",
            "error_category": None,
        }
        with (
            patch("app.api.instructor.require_instructor_account_with_any_class", new=AsyncMock(return_value=["class_1"])),
            patch("app.api.instructor.test_ollama_connection", return_value=expected),
        ):
            result = asyncio.run(test_instructor_llm_connection(LLMConnectionTestRequest(provider="ollama-local"), db=object(), user={"user_id": "u"}))
        self.assertEqual(result, expected)

    def test_provider_failure_does_not_fallback_to_local_questions(self):
        settings = provider_settings(ollama_local_model="tinyllama")

        def failed_request(**_kwargs):
            return {
                "safe_payload": {"model": "tinyllama", "provider": "ollama-local", "deployment_type": "local", "endpoint_label": "ollama-local:localhost"},
                "parsed_response": None,
                "raw_response_text": None,
                "http_status": None,
                "elapsed_ms": 1,
                "error": "offline",
                "error_category": "local_ollama_not_running",
            }

        with (
            patch("app.instructor_services.get_settings", return_value=settings),
            patch("app.instructor_services.perform_ollama_generate_request", side_effect=failed_request),
            patch("app.instructor_services.write_llm_debug_export"),
            patch("app.instructor_services.time.sleep"),
            patch("app.instructor_services.fallback_questions_from_lecture") as fallback,
        ):
            with self.assertRaises(RuntimeError):
                instructor_services.call_ollama_for_questions("Lecture text", question_type="mcq")
        fallback.assert_not_called()

    def test_truncated_generation_uses_compact_retry(self):
        settings = provider_settings(ollama_local_model="tinyllama")
        calls = []
        compact_response = {
            "questions": [
                {
                    "type": "mcq",
                    "question_text": "Which rule prevents loops?",
                    "options": ["Feasible successor", "Hop count", "Static route", "Split horizon"],
                    "correct_answer": "Feasible successor",
                    "explanation": "It provides a backup.",
                    "bloom_level": "Understand",
                    "difficulty": "Medium",
                    "source_slide": 1,
                }
            ]
        }

        def request_with_truncation_then_success(**kwargs):
            calls.append(kwargs["prompt"])
            if len(calls) == 1:
                return {
                    "safe_payload": {"model": "tinyllama", "provider": "ollama-local", "deployment_type": "local", "endpoint_label": "ollama-local:localhost"},
                    "parsed_response": {"response": '{"questions":[{"type":"mcq"', "done": True, "done_reason": "length", "eval_count": 1200},
                    "raw_response_text": "",
                    "http_status": 200,
                    "elapsed_ms": 1,
                    "error": None,
                    "error_category": None,
                }
            return {
                "safe_payload": {"model": "tinyllama", "provider": "ollama-local", "deployment_type": "local", "endpoint_label": "ollama-local:localhost"},
                "parsed_response": {"response": json.dumps(compact_response), "done": True, "done_reason": "stop", "eval_count": 60, "model": "tinyllama"},
                "raw_response_text": "",
                "http_status": 200,
                "elapsed_ms": 1,
                "error": None,
                "error_category": None,
            }

        with (
            patch("app.instructor_services.get_settings", return_value=settings),
            patch("app.instructor_services.perform_ollama_generate_request", side_effect=request_with_truncation_then_success),
            patch("app.instructor_services.write_llm_debug_export"),
        ):
            questions = instructor_services.call_ollama_for_questions("Lecture text about EIGRP feasible successors.", question_type="mcq")
        self.assertEqual(len(calls), 2)
        self.assertIn("total response under 90 words", calls[1])
        self.assertEqual(questions[0].question_text, "Which rule prevents loops?")

    def test_local_and_cloud_use_same_prompt_and_validation_pipeline(self):
        prompts: dict[str, str] = {}

        def successful_request(**kwargs):
            prompts[kwargs["provider"]] = kwargs["prompt"]
            deployment_type = "cloud" if kwargs["provider"] == "ollama-cloud" else "local"
            payload = ollama_payload()
            payload["model"] = kwargs["model"]
            return {
                "safe_payload": {
                    "model": kwargs["model"],
                    "provider": kwargs["provider"],
                    "deployment_type": deployment_type,
                    "endpoint_label": kwargs["endpoint_label"],
                },
                "parsed_response": payload,
                "raw_response_text": json.dumps(payload),
                "http_status": 200,
                "elapsed_ms": 1,
                "error": None,
                "error_category": None,
            }

        with (
            patch("app.instructor_services.perform_ollama_generate_request", side_effect=successful_request),
            patch("app.instructor_services.write_llm_debug_export"),
            patch("app.instructor_services.get_settings", return_value=provider_settings(ollama_local_model="tinyllama")),
        ):
            instructor_services.call_ollama_for_questions("Lecture content", question_type="mcq", llm_provider="ollama-local")
        with (
            patch("app.instructor_services.perform_ollama_generate_request", side_effect=successful_request),
            patch("app.instructor_services.write_llm_debug_export"),
            patch("app.instructor_services.get_settings", return_value=provider_settings()),
        ):
            instructor_services.call_ollama_for_questions("Lecture content", question_type="mcq", llm_provider="ollama-cloud")
        self.assertEqual(prompts["ollama-local"], prompts["ollama-cloud"])

    def test_successful_export_writes_v4_aggregate_without_duplicate_prompt_or_raw(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch("app.debug_export.get_debug_export_root", return_value=root),
                patch("app.debug_export.get_settings", return_value=SimpleNamespace(enable_debug_export=True, debug_export_include_full_prompt=True)),
            ):
                write_llm_debug_export(
                    timestamp=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc),
                    lecture_id="upload_test",
                    class_id="class_test",
                    instructor_id="user_test",
                    model="tinyllama",
                    system_prompt="",
                    user_prompt="Full prompt",
                    request_payload=sample_request(),
                    raw_response=sample_raw_question(),
                    parsed_ollama_response={"model": "tinyllama", "response": sample_raw_question(), "done": True, "eval_count": 1},
                    generation_success=True,
                    processing_time_ms=100,
                    http_status=200,
                    request_metadata={"request_id": "request-1", "batch_id": "batch-1", "question_number": 1, "question_type": "mcq"},
                    input_metadata={"question_type": "mcq", "question_number": 1, "bloom_level": "Understand", "difficulty": "Medium", "output_language": "en", "requested_question_count": 1, "previous_questions": []},
                    lecture_text="Lecture content",
                    error=None,
                )

            files = list((root / "tinyllama").glob("evaluation_upload_test_batch-1.json"))
            self.assertEqual(len(files), 1)
            exported = json.loads(files[0].read_text(encoding="utf-8"))
            attempt = exported["questions"][0]["attempts"][0]
            self.assertEqual(exported["export_version"], "v4")
            self.assertEqual(exported["lecture"]["lecture_id"], "upload_test")
            self.assertEqual(attempt["requested_model"], "tinyllama")
            self.assertEqual(attempt["request_payload_model"], "tinyllama")
            self.assertEqual(attempt["response_model"], "tinyllama")
            self.assertTrue(attempt["model_name_match"])
            self.assertEqual(attempt["prompt"]["user"], "Full prompt")
            self.assertNotIn("request", exported)
            self.assertNotIn("request_payload", attempt)
            self.assertNotIn("parsed_ollama_response", attempt["response"])
            self.assertNotIn("response", attempt["response"]["parsed"])
            self.assertIn("prompt_hash", attempt["input"])
            self.assertIn("lecture_hash", attempt["input"])
            self.assertEqual(json.dumps(exported).count("Full prompt"), 1)

    def test_prompt_can_be_omitted_but_hashes_remain(self):
        with patch("app.debug_export.get_settings", return_value=SimpleNamespace(debug_export_include_full_prompt=False)):
            export = build_export()

        self.assertIsNone(export["prompt"]["user"])
        self.assertIsNotNone(export["input"]["prompt_hash"])
        self.assertIsNotNone(export["input"]["lecture_hash"])

    def test_failed_generation_export_includes_error_and_elapsed_time(self):
        export = build_export(
            raw_response=None,
            parsed_ollama_response={},
            success=False,
            processing_time_ms=5000,
            error={"type": "TimeoutError", "message": "timed out", "traceback": "trace"},
        )

        self.assertFalse(export["response"]["generation_success"])
        self.assertEqual(export["response"]["error"]["type"], "TimeoutError")
        self.assertEqual(export["performance"]["processing_time_seconds"], 5.0)
        self.assertIsNone(export["response"]["http_status"])
        self.assertIsNone(export["metadata"]["response_model"])
        self.assertIsNone(export["metadata"]["model_name_match"])

    def test_export_records_requested_and_actual_ollama_model(self):
        export = build_export(
            model="tinyllama",
            parsed_ollama_response={
                "model": "tinyllama",
                "response": sample_raw_question(),
                "done": True,
            },
        )

        self.assertEqual(export["metadata"]["requested_model"], "tinyllama")
        self.assertEqual(export["metadata"]["request_payload_model"], "tinyllama")
        self.assertEqual(export["metadata"]["response_model"], "tinyllama")
        self.assertTrue(export["metadata"]["model_name_match"])
        self.assertEqual(export["response"]["model"], "tinyllama")

    def test_latest_model_alias_counts_as_matching_response_model(self):
        export = build_export(
            model="tinyllama",
            parsed_ollama_response={
                "model": "tinyllama:latest",
                "response": sample_raw_question(),
                "done": True,
            },
        )

        self.assertTrue(export["metadata"]["model_name_match"])

    def test_mismatched_response_model_is_flagged(self):
        export = build_export(
            model="tinyllama",
            parsed_ollama_response={
                "model": "llama3.1:8b",
                "response": sample_raw_question(),
                "done": True,
            },
        )

        self.assertFalse(export["metadata"]["model_name_match"])

    def test_missing_token_metrics_are_null(self):
        export = build_export(parsed_ollama_response={"response": sample_raw_question(), "done": True})

        self.assertIsNone(export["performance"]["prompt_tokens"])
        self.assertIsNone(export["performance"]["completion_tokens"])
        self.assertIsNone(export["performance"]["total_tokens"])
        self.assertIsNone(export["performance"]["tokens_per_second"])

    def test_zero_completion_tokens_avoids_division_by_zero(self):
        export = build_export(
            parsed_ollama_response={
                "response": sample_raw_question(),
                "prompt_eval_count": 10,
                "eval_count": 0,
                "eval_duration": 1_000_000_000,
            }
        )

        self.assertEqual(export["performance"]["completion_tokens"], 0)
        self.assertEqual(export["performance"]["total_tokens"], 10)
        self.assertIsNone(export["performance"]["milliseconds_per_token"])
        self.assertEqual(export["performance"]["tokens_per_second"], 0.0)

    def test_ollama_duration_conversion(self):
        export = build_export()

        self.assertEqual(export["performance"]["load_duration_ms"], 10.0)
        self.assertEqual(export["performance"]["prompt_evaluation_duration_ms"], 120.0)
        self.assertEqual(export["performance"]["generation_duration_ms"], 2310.0)
        self.assertEqual(export["performance"]["tokens_per_second"], round(45 / 2.31, 6))

    def test_valid_json_detection(self):
        export = build_export()

        self.assertTrue(export["evaluation"]["valid_json"])
        self.assertTrue(export["evaluation"]["schema_valid"])
        self.assertTrue(export["evaluation"]["request_compliant"])
        self.assertEqual(export["evaluation"]["actual_question_count"], 1)

    def test_malformed_json_detection(self):
        export = build_export(raw_response="{not valid")

        self.assertFalse(export["evaluation"]["valid_json"])
        self.assertFalse(export["evaluation"]["request_compliant"])
        self.assertIsNone(export["response"]["parsed"])

    def test_valid_json_wrong_question_count_is_not_request_compliant(self):
        raw = json.dumps({"questions": [
            json.loads(sample_raw_question())["questions"][0],
            json.loads(sample_raw_question())["questions"][0],
        ]})
        export = build_export(raw_response=raw)

        self.assertTrue(export["evaluation"]["valid_json"])
        self.assertFalse(export["evaluation"]["request_compliant"])
        self.assertIn("wrong_question_count", export["evaluation"]["violations"])

    def test_misspelled_explanation_field_fails_schema_validation(self):
        question = json.loads(sample_raw_question())["questions"][0]
        question["explanaition"] = question.pop("explanation")
        export = build_export(raw_response=json.dumps({"questions": [question]}))

        self.assertFalse(export["evaluation"]["schema_valid"])
        self.assertIn("required_field_names_not_exact", export["evaluation"]["violations"])

    def test_mcq_with_fewer_than_four_options_fails_compliance(self):
        export = build_export(raw_response=sample_raw_question(options=["A", "B", "C"]))

        self.assertFalse(export["evaluation"]["request_compliant"])
        self.assertIn("q1_mcq_option_count", export["evaluation"]["violations"])

    def test_short_answer_with_non_empty_options_fails_compliance(self):
        raw = json.dumps({"questions": [{
            "type": "short_answer",
            "question_text": "Why does the design matter?",
            "options": ["Because it does"],
            "correct_answer": "It improves clarity",
            "explanation": "The answer is concise.",
            "bloom_level": "Understand",
            "difficulty": "Medium",
            "source_slide": 1,
        }]})
        export = build_export(
            raw_response=raw,
            input_metadata={
                "question_type": "short_answer",
                "question_number": 1,
                "bloom_level": "Understand",
                "difficulty": "Medium",
                "output_language": "en",
                "requested_question_count": 1,
                "previous_questions": [],
            },
        )

        self.assertFalse(export["evaluation"]["request_compliant"])
        self.assertIn("q1_short_answer_options_not_empty", export["evaluation"]["violations"])

    def test_exact_duplicate_previous_question_fails_compliance(self):
        export = build_export(
            input_metadata={
                "question_type": "mcq",
                "question_number": 1,
                "bloom_level": "Understand",
                "difficulty": "Medium",
                "output_language": "en",
                "requested_question_count": 1,
                "previous_questions": ["Which concept matches the lecture idea?"],
            },
        )

        self.assertFalse(export["evaluation"]["request_compliant"])
        self.assertIn("repeats_previous_question", export["evaluation"]["violations"])

    def test_duplicate_options_are_detected(self):
        export = build_export(raw_response=sample_raw_question(options=["Same!", "same", "Other", "Another"]))
        question = export["evaluation"]["question_metrics"][0]

        self.assertTrue(question["exact_duplicate_options"])
        self.assertEqual(question["duplicate_option_pairs"], [[0, 1]])
        self.assertEqual(export["evaluation"]["aggregate_quality_metrics"]["unique_options_rate"], 0.0)

    def test_near_duplicate_options_are_detected(self):
        export = build_export(
            raw_response=sample_raw_question(
                options=[
                    "Use a relation schema to organize data",
                    "Use relation schema to organize data",
                    "Store only images",
                    "Ignore attributes",
                ]
            )
        )
        question = export["evaluation"]["question_metrics"][0]

        self.assertTrue(question["near_duplicate_options"])
        self.assertEqual(question["near_duplicate_option_pairs"], [[0, 1]])
        self.assertEqual(question["near_duplicate_jaccard_threshold"], 0.8)

    def test_invalid_answer_index_is_detected(self):
        export = build_export(raw_response=sample_raw_question(correct_answer=9))

        self.assertFalse(export["evaluation"]["question_metrics"][0]["correct_answer_present_in_options"])
        self.assertIn("correct_answer_not_found_in_options", export["evaluation"]["question_metrics"][0]["quality_warnings"])

    def test_answer_text_matching_option_is_valid(self):
        export = build_export(raw_response=sample_raw_question(correct_answer="concept a"))

        self.assertTrue(export["evaluation"]["question_metrics"][0]["correct_answer_present_in_options"])
        self.assertEqual(export["evaluation"]["question_metrics"][0]["correct_answer_index"], 0)

    def test_export_disabled_writes_no_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch("app.debug_export.get_debug_export_root", return_value=root),
                patch("app.debug_export.get_settings", return_value=SimpleNamespace(enable_debug_export=False)),
            ):
                write_llm_debug_export(
                    timestamp=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc),
                    lecture_id="upload_test",
                    class_id="class_test",
                    instructor_id="user_test",
                    model="tinyllama",
                    system_prompt="",
                    user_prompt="Full prompt",
                    request_payload=sample_request(),
                    raw_response=sample_raw_question(),
                    parsed_ollama_response={},
                    generation_success=True,
                    processing_time_ms=100,
                    http_status=200,
                    error=None,
                )

            self.assertEqual(list(root.glob("*.json")), [])

    def test_initial_and_retry_attempts_are_stored_in_one_aggregate_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch("app.debug_export.get_debug_export_root", return_value=root),
                patch("app.debug_export.get_settings", return_value=SimpleNamespace(enable_debug_export=True, debug_export_include_full_prompt=True)),
            ):
                for request_id, attempt_number, kind, parent in [
                    ("request-1", 1, "initial", None),
                    ("request-2", 2, "quality_retry", "request-1"),
                ]:
                    write_llm_debug_export(
                        timestamp=datetime(2026, 7, 19, 12, attempt_number, tzinfo=timezone.utc),
                        lecture_id="upload_test",
                        class_id="class_test",
                        instructor_id="user_test",
                        model="tinyllama",
                        system_prompt="",
                        user_prompt="Full prompt",
                        request_payload=sample_request(),
                        raw_response=sample_raw_question(),
                        parsed_ollama_response={"response": sample_raw_question(), "done": True, "done_reason": "stop"},
                        generation_success=True,
                        processing_time_ms=100,
                        http_status=200,
                        request_metadata={
                            "request_id": request_id,
                            "batch_id": "batch-same",
                            "question_number": 1,
                            "question_type": "mcq",
                            "attempt_number": attempt_number,
                            "request_kind": kind,
                            "is_retry": attempt_number > 1,
                            "is_regeneration": False,
                            "parent_request_id": parent,
                        },
                        input_metadata={"question_type": "mcq", "question_number": 1, "bloom_level": "Understand", "difficulty": "Medium", "requested_question_count": 1},
                        lecture_text="Lecture",
                        error=None,
                    )

            files = list((root / "tinyllama").glob("evaluation_upload_test_batch-sa.json"))
            self.assertEqual(len(files), 1)
            aggregate = json.loads(files[0].read_text(encoding="utf-8"))
            self.assertEqual(len(aggregate["questions"]), 1)
            self.assertEqual([attempt["request_id"] for attempt in aggregate["questions"][0]["attempts"]], ["request-1", "request-2"])

    def test_old_attempts_are_not_overwritten_and_duplicate_request_id_is_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = SimpleNamespace(enable_debug_export=True, debug_export_include_full_prompt=True)
            with patch("app.debug_export.get_debug_export_root", return_value=root), patch("app.debug_export.get_settings", return_value=settings):
                base_kwargs = {
                    "timestamp": datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc),
                    "lecture_id": "upload_test",
                    "class_id": "class_test",
                    "instructor_id": "user_test",
                    "model": "tinyllama",
                    "system_prompt": "",
                    "user_prompt": "Full prompt",
                    "request_payload": sample_request(),
                    "raw_response": sample_raw_question(),
                    "parsed_ollama_response": {"response": sample_raw_question(), "done": True, "done_reason": "stop"},
                    "generation_success": True,
                    "processing_time_ms": 100,
                    "http_status": 200,
                    "input_metadata": {"question_type": "mcq", "question_number": 1, "requested_question_count": 1},
                    "lecture_text": "Lecture",
                    "error": None,
                }
                write_llm_debug_export(**base_kwargs, request_metadata={"request_id": "request-1", "batch_id": "batch-dupe", "question_number": 1, "question_type": "mcq"})
                write_llm_debug_export(**base_kwargs, request_metadata={"request_id": "request-2", "batch_id": "batch-dupe", "question_number": 1, "question_type": "mcq", "attempt_number": 2, "request_kind": "quality_retry", "is_retry": True})
                write_llm_debug_export(**base_kwargs, request_metadata={"request_id": "request-2", "batch_id": "batch-dupe", "question_number": 1, "question_type": "mcq", "attempt_number": 2, "request_kind": "quality_retry", "is_retry": True})

            aggregate = json.loads(next((root / "tinyllama").glob("evaluation_upload_test_batch-du.json")).read_text(encoding="utf-8"))
            attempts = aggregate["questions"][0]["attempts"]
            self.assertEqual([attempt["request_id"] for attempt in attempts], ["request-1", "request-2"])

    def test_manual_regeneration_appends_to_question_with_monotonic_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = SimpleNamespace(enable_debug_export=True, debug_export_include_full_prompt=True)
            with patch("app.debug_export.get_debug_export_root", return_value=root), patch("app.debug_export.get_settings", return_value=settings):
                for request_id, kind, is_regeneration in [
                    ("request-1", "initial", False),
                    ("request-2", "quality_retry", False),
                    ("request-3", "manual_regeneration", True),
                ]:
                    write_llm_debug_export(
                        timestamp=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc),
                        lecture_id="upload_test",
                        class_id="class_test",
                        instructor_id="user_test",
                        model="tinyllama",
                        system_prompt="",
                        user_prompt="Full prompt",
                        request_payload=sample_request(),
                        raw_response=sample_raw_question(),
                        parsed_ollama_response={"response": sample_raw_question(), "done": True, "done_reason": "stop"},
                        generation_success=True,
                        processing_time_ms=100,
                        http_status=200,
                        request_metadata={
                            "request_id": request_id,
                            "batch_id": "batch-manual",
                            "question_number": 1,
                            "question_type": "mcq",
                            "attempt_number": 1 if is_regeneration else (2 if kind == "quality_retry" else 1),
                            "request_kind": kind,
                            "is_retry": kind == "quality_retry",
                            "is_regeneration": is_regeneration,
                            "parent_request_id": None,
                        },
                        input_metadata={"question_type": "mcq", "question_number": 1, "requested_question_count": 1},
                        lecture_text="Lecture",
                        error=None,
                    )

            attempts = json.loads(next((root / "tinyllama").glob("evaluation_upload_test_batch-ma.json")).read_text(encoding="utf-8"))["questions"][0]["attempts"]
            self.assertEqual([attempt["attempt_number"] for attempt in attempts], [1, 2, 3])
            self.assertEqual(attempts[2]["parent_request_id"], "request-2")

    def test_different_batch_ids_create_separate_files_and_valid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = SimpleNamespace(enable_debug_export=True, debug_export_include_full_prompt=True)
            with patch("app.debug_export.get_debug_export_root", return_value=root), patch("app.debug_export.get_settings", return_value=settings):
                for batch_id in ["batch-one", "batch-two"]:
                    write_llm_debug_export(
                        timestamp=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc),
                        lecture_id="upload_test",
                        class_id="class_test",
                        instructor_id="user_test",
                        model="tinyllama",
                        system_prompt="",
                        user_prompt="Full prompt",
                        request_payload=sample_request(),
                        raw_response=sample_raw_question(),
                        parsed_ollama_response={"response": sample_raw_question(), "done": True, "done_reason": "stop"},
                        generation_success=True,
                        processing_time_ms=100,
                        http_status=200,
                        request_metadata={"request_id": f"request-{batch_id}", "batch_id": batch_id, "question_number": 1, "question_type": "mcq"},
                        input_metadata={"question_type": "mcq", "question_number": 1, "requested_question_count": 1},
                        lecture_text="Lecture",
                        error=None,
                    )

            files = sorted((root / "tinyllama").glob("evaluation_upload_test_batch-*.json"))
            self.assertEqual(len(files), 2)
            for path in files:
                self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["export_version"], "v4")

    def test_same_batch_id_across_models_creates_separate_debug_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = SimpleNamespace(enable_debug_export=True, debug_export_include_full_prompt=True)
            with patch("app.debug_export.get_debug_export_root", return_value=root), patch("app.debug_export.get_settings", return_value=settings):
                for model in ["tinyllama", "llama3.1:8b"]:
                    write_llm_debug_export(
                        timestamp=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc),
                        lecture_id="upload_test",
                        class_id="class_test",
                        instructor_id="user_test",
                        model=model,
                        system_prompt="",
                        user_prompt="Full prompt",
                        request_payload=sample_request(model),
                        raw_response=sample_raw_question(),
                        parsed_ollama_response={"response": sample_raw_question(), "done": True, "done_reason": "stop"},
                        generation_success=True,
                        processing_time_ms=100,
                        http_status=200,
                        request_metadata={"request_id": f"request-{model}", "batch_id": "batch-shared", "question_number": 1, "question_type": "mcq"},
                        input_metadata={"question_type": "mcq", "question_number": 1, "requested_question_count": 1},
                        lecture_text="Lecture",
                        error=None,
                    )

            files = sorted(path.relative_to(root).as_posix() for path in root.rglob("evaluation_upload_test_batch-sh.json"))
            self.assertEqual(files, [
                "llama3.1_8b/evaluation_upload_test_batch-sh.json",
                "tinyllama/evaluation_upload_test_batch-sh.json",
            ])
            models = {
                json.loads((root / file_name).read_text(encoding="utf-8"))["lecture"]["model"]
                for file_name in files
            }
            self.assertEqual(models, {"tinyllama", "llama3.1:8b"})
            tinyllama_index = json.loads((root / "tinyllama" / "evaluation_upload_test_index.json").read_text(encoding="utf-8"))
            llama_index = json.loads((root / "llama3.1_8b" / "evaluation_upload_test_index.json").read_text(encoding="utf-8"))
            self.assertEqual(
                [(item["batch_id"], item["model"], item["file"]) for item in llama_index["batches"]],
                [
                    ("batch-shared", "llama3.1:8b", "evaluation_upload_test_batch-sh.json"),
                ],
            )
            self.assertEqual(
                [(item["batch_id"], item["model"], item["file"]) for item in tinyllama_index["batches"]],
                [
                    ("batch-shared", "tinyllama", "evaluation_upload_test_batch-sh.json"),
                ],
            )

    def test_each_ollama_call_has_unique_request_id(self):
        captured = []

        def capture_export(**kwargs):
            captured.append(kwargs["request_metadata"])

        with patch("app.instructor_services.write_llm_debug_export", side_effect=capture_export), patch(
            "app.instructor_services.urllib.request.urlopen",
            return_value=FakeOllamaResponse(ollama_payload()),
        ):
            instructor_services.call_ollama_for_questions(
                "Lecture content with enough words for a question.",
                question_type="mcq",
                debug_batch_id="batch-one",
                debug_question_number=1,
                debug_question_type="mcq",
            )
            instructor_services.call_ollama_for_questions(
                "Lecture content with enough words for another question.",
                question_type="mcq",
                debug_batch_id="batch-one",
                debug_question_number=2,
                debug_question_type="mcq",
            )

        request_ids = [metadata["request_id"] for metadata in captured]
        self.assertEqual(len(request_ids), 2)
        self.assertEqual(len(set(request_ids)), 2)
        self.assertEqual({metadata["batch_id"] for metadata in captured}, {"batch-one"})

    def test_normal_retry_increments_attempt_and_points_to_parent(self):
        captured = []
        calls = iter([
            socket.timeout("slow"),
            FakeOllamaResponse(ollama_payload()),
        ])

        def fake_urlopen(*_args, **_kwargs):
            result = next(calls)
            if isinstance(result, BaseException):
                raise result
            return result

        with patch("app.instructor_services.write_llm_debug_export", side_effect=lambda **kwargs: captured.append(kwargs["request_metadata"])), patch(
            "app.instructor_services.urllib.request.urlopen",
            side_effect=fake_urlopen,
        ), patch("app.instructor_services.time.sleep"):
            instructor_services.call_ollama_for_questions(
                "Lecture content with retry.",
                question_type="mcq",
                debug_batch_id="batch-retry",
                debug_question_number=1,
                debug_question_type="mcq",
            )

        self.assertEqual(captured[0]["attempt_number"], 1)
        self.assertEqual(captured[0]["request_kind"], "initial")
        self.assertEqual(captured[1]["attempt_number"], 2)
        self.assertEqual(captured[1]["request_kind"], "automatic_retry")
        self.assertTrue(captured[1]["is_retry"])
        self.assertEqual(captured[1]["parent_request_id"], captured[0]["request_id"])

    def test_strict_quality_retry_is_classified(self):
        captured = []

        def quality_result(questions, *_args, **_kwargs):
            return questions, len(captured) < 2

        with patch("app.instructor_services.write_llm_debug_export", side_effect=lambda **kwargs: captured.append(kwargs["request_metadata"])), patch(
            "app.instructor_services.urllib.request.urlopen",
            return_value=FakeOllamaResponse(ollama_payload()),
        ), patch("app.instructor_services.repair_and_validate_question_dicts", side_effect=quality_result):
            instructor_services.call_ollama_for_questions(
                "Lecture content with strict retry.",
                question_type="mcq",
                debug_batch_id="batch-quality",
                debug_question_number=1,
                debug_question_type="mcq",
            )

        self.assertEqual(captured[0]["request_kind"], "initial")
        self.assertEqual(captured[1]["request_kind"], "quality_retry")
        self.assertTrue(captured[1]["is_retry"])
        self.assertEqual(captured[1]["attempt_number"], 2)
        self.assertEqual(captured[1]["parent_request_id"], captured[0]["request_id"])

    def test_manual_regeneration_is_classified_separately(self):
        captured = []

        with patch("app.instructor_services.write_llm_debug_export", side_effect=lambda **kwargs: captured.append(kwargs["request_metadata"])), patch(
            "app.instructor_services.urllib.request.urlopen",
            return_value=FakeOllamaResponse(ollama_payload()),
        ):
            instructor_services.call_ollama_for_questions(
                "Lecture content with manual regeneration.",
                question_type="mcq",
                debug_batch_id="batch-manual",
                debug_question_number=2,
                debug_question_type="mcq",
                debug_request_kind="manual_regeneration",
                debug_parent_request_id="previous-request",
            )

        self.assertEqual(captured[0]["request_kind"], "manual_regeneration")
        self.assertFalse(captured[0]["is_retry"])
        self.assertTrue(captured[0]["is_regeneration"])
        self.assertEqual(captured[0]["parent_request_id"], "previous-request")

    def test_older_api_payload_defaults_still_work(self):
        payload = GenerateQuestionsRequest(upload_id="upload_old", extracted_text="Text")

        self.assertIsNone(payload.batch_id)
        self.assertIsNone(payload.question_number)
        self.assertIsNone(payload.question_type)
        self.assertEqual(payload.request_kind, "initial")
        self.assertIsNone(payload.parent_request_id)

    def test_approve_route_has_no_llm_or_export_call(self):
        source = Path("app/api/instructor.py").read_text(encoding="utf-8")
        approve_block = source.split('@router.post("/questions/{question_id}/approve"')[1].split('@router.post("/questions/regenerate"')[0]

        self.assertNotIn("call_ollama_for_questions", approve_block)
        self.assertNotIn("write_llm_debug_export", approve_block)


class DebugExportSummaryTest(unittest.TestCase):
    def write_export(self, root: Path, name: str, export: dict) -> None:
        (root / name).write_text(json.dumps(export, indent=2), encoding="utf-8")

    def test_multiple_models_in_comparison_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_export(root, "generation_a.json", build_export(model="tinyllama"))
            self.write_export(root, "generation_b.json", build_export(model="llama3.1"))

            summary = build_model_comparison_summary(root)

        self.assertEqual([row["model"] for row in summary], ["llama3.1", "tinyllama"])
        self.assertEqual({row["total_generations"] for row in summary}, {1})

    def test_failed_requests_are_excluded_from_quality_denominators(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_export(root, "generation_success.json", build_export())
            self.write_export(
                root,
                "generation_failed.json",
                build_export(raw_response="", parsed_ollama_response=None, success=False, error={"type": "URLError", "message": "down", "traceback": "trace"}),
            )

            summary = build_model_comparison_summary(root)[0]

        self.assertEqual(summary["total_generations"], 2)
        self.assertEqual(summary["successful_generations"], 1)
        self.assertEqual(summary["total_questions"], 1)
        self.assertEqual(summary["valid_answer_rate"], 1.0)

    def test_missing_values_are_excluded_from_averages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_export(root, "generation_a.json", build_export(processing_time_ms=1000))
            missing = build_export(processing_time_ms=None, parsed_ollama_response={"response": sample_raw_question()})
            self.write_export(root, "generation_b.json", missing)

            summary = build_model_comparison_summary(root)[0]

        self.assertEqual(summary["mean_processing_time_seconds"], 1.0)
        self.assertEqual(summary["mean_prompt_tokens"], 123.0)

    def test_human_review_denominators_use_reviewed_questions_only(self):
        reviewed = build_export()
        reviewed["evaluation"]["question_metrics"][0]["human_review"] = {
            "reviewed": True,
            "question_relevant": True,
            "answer_correct": False,
            "only_one_correct_answer": True,
            "question_clear": None,
            "options_plausible": None,
            "explanation_correct": None,
            "reviewer_notes": None,
        }
        unreviewed = build_export()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_export(root, "generation_reviewed.json", reviewed)
            self.write_export(root, "generation_unreviewed.json", unreviewed)

            summary = build_model_comparison_summary(root)[0]

        self.assertEqual(summary["reviewed_question_count"], 1)
        self.assertEqual(summary["human_answer_accuracy"], 0.0)
        self.assertEqual(summary["human_relevance_rate"], 1.0)
        self.assertEqual(summary["single_correct_answer_rate"], 1.0)

    def test_done_reason_length_counts_as_truncated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_export(
                root,
                "generation_length.json",
                build_export(parsed_ollama_response={
                    "response": sample_raw_question(),
                    "done": True,
                    "done_reason": "length",
                    "prompt_eval_count": 1,
                    "eval_count": 1,
                }),
            )
            self.write_export(root, "generation_stop.json", build_export())

            summary = build_model_comparison_summary(root)[0]

        self.assertEqual(summary["finish_reason_distribution"], {"length": 1, "stop": 1})
        self.assertEqual(summary["truncated_response_rate"], 0.5)

    def test_comparison_reads_v2_v3_and_v4_exports(self):
        v2 = {
            "metadata": {"export_version": "v2", "model": "tinyllama", "request_id": "old", "batch_id": "batch-old", "question_number": 1},
            "response": {"generation_success": True, "done_reason": "stop"},
            "performance_metrics": {"processing_time_seconds": 1.0, "total_tokens": 10},
            "structure_metrics": {"valid_json": True, "structure_score": 1.0},
            "question_metrics": [],
            "aggregate_quality_metrics": {"total_questions": 0},
        }
        v4 = {
            "export_version": "v4",
            "lecture": {"lecture_id": "upload_v4", "class_id": "class", "instructor_id": "user", "model": "tinyllama", "provider": "ollama"},
            "batch": {"batch_id": "batch-v4", "created_at": "2026-07-19T12:00:00+00:00", "updated_at": "2026-07-19T12:00:00+00:00"},
            "questions": [
                {
                    "question_number": 1,
                    "question_type": "mcq",
                    "requested_bloom_level": "Understand",
                    "requested_difficulty": "Medium",
                    "attempts": [
                        {
                            "request_id": "request-v4",
                            "attempt_number": 1,
                            "request_kind": "initial",
                            "is_retry": False,
                            "is_regeneration": False,
                            "parent_request_id": None,
                            "timestamp": "2026-07-19T12:00:00+00:00",
                            "input": {"question_type": "mcq", "question_number": 1, "requested_question_count": 1},
                            "prompt": {},
                            "request_settings": {},
                            "response": {"generation_success": True, "done_reason": "stop"},
                            "performance": {"processing_time_seconds": 1.0, "total_tokens": 5},
                            "evaluation": {"valid_json": True, "schema_valid": True, "request_compliant": True, "instruction_compliance_score": 1.0, "aggregate_quality_metrics": {"total_questions": 0}, "question_metrics": []},
                        }
                    ],
                }
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_export(root, "generation_v2.json", v2)
            self.write_export(root, "generation_v3.json", build_export())
            self.write_export(root, "evaluation_upload_v4_batch-v4.json", v4)

            summary = build_model_comparison_summary(root)[0]

        self.assertEqual(summary["total_requests"], 3)
        self.assertEqual(summary["valid_json_rate"], 1.0)

    def test_csv_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_export(root, "generation_a.json", build_export())

            json_path, csv_path = write_model_comparison_summary(root)
            with csv_path.open(encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))

            self.assertTrue(json_path.exists())
            self.assertTrue(csv_path.exists())
            self.assertEqual(rows[0]["model"], "tinyllama")
            self.assertIn("generation_success_rate", rows[0])

    def test_comparison_groups_by_batch_and_question_number(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_export(
                root,
                "generation_initial.json",
                build_export(request_metadata={
                    "request_id": "request-1",
                    "batch_id": "batch-a",
                    "question_number": 1,
                    "question_type": "mcq",
                    "attempt_number": 1,
                    "request_kind": "initial",
                    "is_retry": False,
                    "is_regeneration": False,
                    "parent_request_id": None,
                }),
            )
            self.write_export(
                root,
                "generation_retry.json",
                build_export(request_metadata={
                    "request_id": "request-2",
                    "batch_id": "batch-a",
                    "question_number": 1,
                    "question_type": "mcq",
                    "attempt_number": 2,
                    "request_kind": "automatic_retry",
                    "is_retry": True,
                    "is_regeneration": False,
                    "parent_request_id": "request-1",
                }),
            )

            summary = build_model_comparison_summary(root)[0]

        self.assertEqual(summary["total_llm_requests"], 2)
        self.assertEqual(summary["total_requested_questions"], 1)
        self.assertEqual(summary["mean_attempts_per_question"], 2.0)
        self.assertEqual(summary["questions_requiring_retries"], 1)
        self.assertEqual(summary["automatic_retries"], 1)

    def test_multiple_questions_from_one_batch_are_not_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for question_number in (1, 2):
                self.write_export(
                    root,
                    f"generation_{question_number}.json",
                    build_export(request_metadata={
                        "request_id": f"request-{question_number}",
                        "batch_id": "batch-a",
                        "question_number": question_number,
                        "question_type": "mcq",
                        "attempt_number": 1,
                        "request_kind": "initial",
                        "is_retry": False,
                        "is_regeneration": False,
                        "parent_request_id": None,
                    }),
                )

            summary = build_model_comparison_summary(root)[0]

        self.assertEqual(summary["total_llm_requests"], 2)
        self.assertEqual(summary["total_requested_questions"], 2)
        self.assertEqual(summary["mean_attempts_per_question"], 1.0)


if __name__ == "__main__":
    unittest.main()
