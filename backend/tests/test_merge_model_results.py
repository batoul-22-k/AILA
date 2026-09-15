import csv
import json
import tempfile
import unittest
from pathlib import Path

from app.llm_evaluation.merge_model_results import merge_model_results


def attempt(
    request_id,
    *,
    attempt_number=1,
    timestamp="2026-07-19T12:00:00+00:00",
    request_kind="initial",
    is_retry=False,
    is_regeneration=False,
    parent_request_id=None,
    requested_model="tinyllama",
    response_model="tinyllama",
    http_status=200,
    raw_response='{"questions":[]}',
    done=True,
    done_reason="stop",
    valid_json=True,
    schema_valid=True,
    request_compliant=True,
    processing_time_seconds=1.0,
    prompt_tokens=10,
    completion_tokens=20,
    total_tokens=30,
    tokens_per_second=20.0,
    violations=None,
):
    return {
        "request_id": request_id,
        "attempt_number": attempt_number,
        "request_kind": request_kind,
        "is_retry": is_retry,
        "is_regeneration": is_regeneration,
        "parent_request_id": parent_request_id,
        "requested_model": requested_model,
        "response_model": response_model,
        "model_name_match": requested_model == response_model,
        "timestamp": timestamp,
        "input": {
            "question_type": "mcq",
            "question_number": 1,
            "bloom_level": "Understand",
            "difficulty": "Medium",
            "lecture_hash": "lecture-hash",
            "prompt_hash": "prompt-hash",
        },
        "prompt": {"system": "", "user": "Prompt"},
        "request_settings": {"provider": "ollama", "deployment_type": "local", "num_ctx": 2048},
        "response": {
            "raw": raw_response,
            "parsed": {"questions": []} if valid_json else None,
            "http_status": http_status,
            "generation_success": http_status == 200 and done,
            "model": response_model,
            "done": done,
            "done_reason": done_reason,
            "error": None if http_status == 200 else {"type": "http_error"},
        },
        "performance": {
            "processing_time_seconds": processing_time_seconds,
            "processing_time_ms": processing_time_seconds * 1000,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "tokens_per_second": tokens_per_second,
        },
        "evaluation": {
            "valid_json": valid_json,
            "schema_valid": schema_valid,
            "request_compliant": request_compliant,
            "instruction_compliance_score": 1.0 if request_compliant else 0.5,
            "violations": violations or [],
            "compliance_checks": {"has_questions": schema_valid},
            "question_metrics": [{"valid_answer": True}],
            "aggregate_quality_metrics": {"total_questions": 1},
            "human_review": {"reviewed": False},
        },
    }


def batch_payload(lecture_id="upload_a", batch_id="batch-a", *, model="tinyllama", provider="ollama", questions=None, created_at="2026-07-19T12:00:00+00:00"):
    return {
        "export_version": "v4",
        "lecture": {
            "lecture_id": lecture_id,
            "lecture_hash": "lecture-hash",
            "class_id": "class-a",
            "instructor_id": "user-a",
            "model": model,
            "requested_model": model,
            "response_model": model,
            "model_name_match": True,
            "provider": provider,
        },
        "batch": {"batch_id": batch_id, "created_at": created_at, "updated_at": created_at},
        "questions": questions
        if questions is not None
        else [
            {
                "question_number": 1,
                "question_type": "mcq",
                "requested_bloom_level": "Understand",
                "requested_difficulty": "Medium",
                "attempts": [attempt("request-1")],
            }
        ],
    }


class MergeModelResultsTests(unittest.TestCase):
    def write_json(self, root: Path, name: str, payload) -> Path:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def merge(self, root: Path, *, strict=False):
        return merge_model_results(
            input_dir=root,
            model_id="tinyllama-local",
            output_path=root / "merged" / "tinyllama_all_results.json",
            provider="ollama",
            deployment_type="local",
            model_name="tinyllama",
            strict=strict,
        )

    def test_batch_files_merged_and_csv_generated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_json(root, "evaluation_upload_a_batch-a.json", batch_payload())

            result = self.merge(root)

            self.assertEqual(result["summary"]["source_file_count"], 1)
            self.assertEqual(result["summary"]["lecture_count"], 1)
            self.assertEqual(result["summary"]["request_count"], 1)
            self.assertEqual(result["requests"][0]["request_id"], "request-1")
            self.assertTrue((root / "merged" / "tinyllama_all_results.csv").exists())

    def test_index_files_ignored_as_primary_but_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_json(root, "evaluation_upload_a_batch-a.json", batch_payload())
            self.write_json(root, "evaluation_upload_a_index.json", {"lecture_id": "upload_a", "batches": [{"file": "missing.json"}]})

            result = self.merge(root)

            self.assertEqual(result["summary"]["request_count"], 1)
            self.assertTrue(any(warning["type"] == "index_missing_batch_file" for warning in result["merge_warnings"]))

    def test_duplicate_requests_skipped_and_warning_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            questions = [
                {"question_number": 1, "question_type": "mcq", "requested_bloom_level": "Understand", "requested_difficulty": "Medium", "attempts": [attempt("dup"), attempt("dup", attempt_number=2)]}
            ]
            self.write_json(root, "evaluation_upload_a_batch-a.json", batch_payload(questions=questions))

            result = self.merge(root)

            self.assertEqual(result["summary"]["request_count"], 1)
            self.assertTrue(any(warning["type"] == "duplicate_request_id" for warning in result["merge_warnings"]))

    def test_retries_and_failed_requests_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            questions = [
                {
                    "question_number": 1,
                    "question_type": "mcq",
                    "requested_bloom_level": "Understand",
                    "requested_difficulty": "Medium",
                    "attempts": [
                        attempt("failed", http_status=500, raw_response=None, done=False, valid_json=False, schema_valid=False, request_compliant=False),
                        attempt("retry", attempt_number=2, request_kind="automatic_retry", is_retry=True, parent_request_id="failed"),
                    ],
                }
            ]
            self.write_json(root, "evaluation_upload_a_batch-a.json", batch_payload(questions=questions))

            result = self.merge(root)

            self.assertEqual(result["summary"]["request_count"], 2)
            self.assertEqual(result["summary"]["retry_count"], 1)
            self.assertFalse(result["requests"][0]["usable_output"])
            self.assertEqual(result["requests"][1]["parent_request_id"], "failed")

    def test_stable_sorting_by_lecture_batch_question_attempt_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            late = batch_payload(
                lecture_id="upload_b",
                batch_id="batch-b",
                created_at="2026-07-20T12:00:00+00:00",
                questions=[{"question_number": 1, "question_type": "mcq", "requested_bloom_level": "Understand", "requested_difficulty": "Medium", "attempts": [attempt("b")]}],
            )
            early = batch_payload(
                lecture_id="upload_a",
                batch_id="batch-a",
                created_at="2026-07-19T12:00:00+00:00",
                questions=[
                    {"question_number": 2, "question_type": "mcq", "requested_bloom_level": "Understand", "requested_difficulty": "Medium", "attempts": [attempt("q2")]},
                    {"question_number": 1, "question_type": "mcq", "requested_bloom_level": "Understand", "requested_difficulty": "Medium", "attempts": [attempt("q1", attempt_number=2), attempt("q1-a1", attempt_number=1)]},
                ],
            )
            self.write_json(root, "nested/evaluation_upload_b_batch-b.json", late)
            self.write_json(root, "evaluation_upload_a_batch-a.json", early)

            result = self.merge(root)

            self.assertEqual([record["request_id"] for record in result["requests"]], ["q1-a1", "q1", "q2", "b"])

    def test_summary_calculations_and_usable_output_classification(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            questions = [
                {
                    "question_number": 1,
                    "question_type": "mcq",
                    "requested_bloom_level": "Understand",
                    "requested_difficulty": "Medium",
                    "attempts": [
                        attempt("ok", processing_time_seconds=1.0, prompt_tokens=10, completion_tokens=20, total_tokens=30),
                        attempt("length", attempt_number=2, done=True, done_reason="length", valid_json=True, schema_valid=True, request_compliant=True, processing_time_seconds=3.0, prompt_tokens=5, completion_tokens=10, total_tokens=15),
                    ],
                }
            ]
            self.write_json(root, "evaluation_upload_a_batch-a.json", batch_payload(questions=questions))

            result = self.merge(root)
            summary = result["summary"]

            self.assertEqual(summary["request_count"], 2)
            self.assertEqual(summary["transport_success_count"], 2)
            self.assertEqual(summary["completed_count"], 1)
            self.assertEqual(summary["usable_output_count"], 1)
            self.assertEqual(summary["length_termination_count"], 1)
            self.assertEqual(summary["mean_processing_time_seconds"], 2.0)
            self.assertEqual(summary["median_processing_time_seconds"], 2.0)
            self.assertEqual(summary["total_tokens"], 45)
            self.assertEqual(summary["usable_output_rate"], 0.5)

    def test_csv_contains_one_research_row_per_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_json(root, "evaluation_upload_a_batch-a.json", batch_payload())

            self.merge(root)

            with (root / "merged" / "tinyllama_all_results.csv").open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["model_id"], "tinyllama-local")
            self.assertEqual(rows[0]["usable_output"], "True")

    def test_malformed_file_warns_and_strict_mode_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bad.json").write_text("{not json", encoding="utf-8")

            result = self.merge(root)
            self.assertTrue(any(warning["type"] == "unreadable_json" for warning in result["merge_warnings"]))

            with self.assertRaises(ValueError):
                self.merge(root, strict=True)

    def test_mixed_model_warning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_json(root, "evaluation_upload_a_batch-a.json", batch_payload(model="tinyllama"))
            self.write_json(root, "evaluation_upload_b_batch-b.json", batch_payload(lecture_id="upload_b", batch_id="batch-b", model="gpt-oss:20b-cloud"))

            result = self.merge(root)

            self.assertTrue(any(warning["type"] == "mixed_model_names" for warning in result["merge_warnings"]))


if __name__ == "__main__":
    unittest.main()
