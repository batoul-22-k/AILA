import csv
import json
import tempfile
import unittest
from pathlib import Path

from app.llm_evaluation.balance_comparison_results import refine_comparison_results


def request(
    request_id,
    *,
    lecture_id="upload_a",
    lecture_hash="hash-a",
    batch_id="batch-a",
    question_number=1,
    attempt_number=1,
    valid_json=True,
    schema_valid=True,
    request_compliant=True,
    usable_output=True,
    done=True,
    done_reason="stop",
    http_status=200,
    raw_response="{}",
    is_retry=False,
):
    return {
        "lecture_id": lecture_id,
        "lecture_hash": lecture_hash,
        "batch_id": batch_id,
        "question_number": question_number,
        "attempt_number": attempt_number,
        "request_kind": "quality_retry" if is_retry else "initial",
        "is_retry": is_retry,
        "timestamp": f"2026-07-19T12:0{question_number}:00+00:00",
        "processing_time_seconds": float(question_number),
        "valid_json": valid_json,
        "schema_valid": schema_valid,
        "request_compliant": request_compliant,
        "usable_output": usable_output,
        "done": done,
        "done_reason": done_reason,
        "http_status": http_status,
        "raw_response": raw_response,
        "request_id": request_id,
    }


def lecture(lecture_id="upload_a", lecture_hash="hash-a", batch_id="batch-a", *, created_at="2026-07-19T12:00:00+00:00", question_count=4):
    return {
        "lecture_id": lecture_id,
        "lecture_hash": lecture_hash,
        "class_id": "class-a",
        "instructor_id": "user-a",
        "batch_id": batch_id,
        "created_at": created_at,
        "updated_at": created_at,
        "question_count": question_count,
        "request_count": question_count,
    }


def complete_requests(lecture_id="upload_a", lecture_hash="hash-a", batch_id="batch-a", *, failed_question=None):
    rows = []
    for question_number in range(1, 5):
        failed = failed_question == question_number
        rows.append(
            request(
                f"{batch_id}-q{question_number}",
                lecture_id=lecture_id,
                lecture_hash=lecture_hash,
                batch_id=batch_id,
                question_number=question_number,
                valid_json=not failed,
                schema_valid=not failed,
                request_compliant=not failed,
                usable_output=not failed,
                done=not failed,
                done_reason="length" if failed else "stop",
            )
        )
    return rows


def merged_payload(model_id, *, model_name=None, lectures=None, requests=None):
    return {
        "merge_version": "v1",
        "model_id": model_id,
        "model_name": model_name or model_id,
        "provider": "ollama",
        "deployment_type": "local",
        "summary": {},
        "lectures": lectures or [],
        "requests": requests or [],
    }


class BalanceComparisonResultsTests(unittest.TestCase):
    def write_model(self, root: Path, filename: str, payload: dict) -> Path:
        path = root / filename
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def refine(self, root: Path, files: list[Path], *, batch_selection="earliest"):
        return refine_comparison_results(
            input_files=files,
            output_dir=root / "balanced",
            expected_questions=4,
            batch_selection=batch_selection,
        )

    def test_matches_common_lectures_by_hash_not_upload_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            local = merged_payload(
                "tinyllama-local",
                lectures=[lecture("upload_a", "same-hash", "batch-local")],
                requests=complete_requests("upload_a", "same-hash", "batch-local"),
            )
            cloud = merged_payload(
                "gpt-oss-20b-cloud",
                lectures=[lecture("different_upload", "same-hash", "batch-cloud")],
                requests=complete_requests("different_upload", "same-hash", "batch-cloud"),
            )
            files = [
                self.write_model(root, "tinyllama_all_results.json", local),
                self.write_model(root, "cloud_all_results.json", cloud),
            ]

            result = self.refine(root, files)

            summary = result["balanced_summary"]
            self.assertEqual(summary["common_lecture_count"], 1)
            self.assertEqual(summary["selected_lecture_hashes"], ["same-hash"])
            for model in result["balanced_results"]["models"]:
                self.assertEqual({row["lecture_hash"] for row in model["requests"]}, {"same-hash"})

    def test_incomplete_batch_removed_but_failures_inside_selected_batch_remain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tiny = merged_payload(
                "tinyllama-local",
                lectures=[
                    lecture("upload_incomplete", "hash-a", "batch-incomplete", question_count=1),
                    lecture("upload_complete", "hash-a", "batch-complete", created_at="2026-07-19T13:00:00+00:00"),
                ],
                requests=[
                    request("incomplete-q1", lecture_id="upload_incomplete", lecture_hash="hash-a", batch_id="batch-incomplete", question_number=1),
                    *complete_requests("upload_complete", "hash-a", "batch-complete", failed_question=2),
                ],
            )
            qwen = merged_payload(
                "qwen2.5-1.5b-local",
                lectures=[lecture("upload_q", "hash-a", "batch-q")],
                requests=complete_requests("upload_q", "hash-a", "batch-q"),
            )
            files = [
                self.write_model(root, "tinyllama_all_results.json", tiny),
                self.write_model(root, "qwen_all_results.json", qwen),
            ]

            result = self.refine(root, files)
            tiny_model = next(model for model in result["balanced_results"]["models"] if model["model_id"] == "tinyllama-local")

            self.assertEqual({row["batch_id"] for row in tiny_model["requests"]}, {"batch-complete"})
            self.assertTrue(any(row["done_reason"] == "length" for row in tiny_model["requests"]))
            self.assertTrue(any(item["reason"] == "incomplete_batch" for item in result["balanced_summary"]["exclusions"]))
            self.assertEqual(result["balanced_summary"]["incomplete_batches_removed"], 1)

    def test_duplicate_complete_batches_keep_earliest_or_latest_without_performance_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tiny = merged_payload(
                "tinyllama-local",
                lectures=[
                    lecture("upload_old", "hash-a", "batch-old", created_at="2026-07-19T12:00:00+00:00"),
                    lecture("upload_new", "hash-a", "batch-new", created_at="2026-07-19T13:00:00+00:00"),
                ],
                requests=[
                    *complete_requests("upload_old", "hash-a", "batch-old"),
                    *complete_requests("upload_new", "hash-a", "batch-new"),
                ],
            )
            cloud = merged_payload(
                "cloud",
                lectures=[lecture("upload_cloud", "hash-a", "batch-cloud")],
                requests=complete_requests("upload_cloud", "hash-a", "batch-cloud"),
            )
            files = [self.write_model(root, "tiny.json", tiny), self.write_model(root, "cloud.json", cloud)]

            earliest = self.refine(root, files)
            latest = self.refine(root, files, batch_selection="latest")

            self.assertEqual(earliest["balanced_summary"]["selected_batches_by_model"]["tinyllama-local"]["hash-a"], "batch-old")
            self.assertEqual(latest["balanced_summary"]["selected_batches_by_model"]["tinyllama-local"]["hash-a"], "batch-new")
            self.assertEqual(earliest["balanced_summary"]["duplicate_batches_removed"], 1)
            self.assertEqual(earliest["balanced_summary"]["duplicate_uploads_removed"], 1)

    def test_missing_common_lectures_excluded_and_full_results_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tiny = merged_payload(
                "tinyllama-local",
                lectures=[lecture("upload_a", "hash-a", "batch-a"), lecture("upload_b", "hash-b", "batch-b")],
                requests=[*complete_requests("upload_a", "hash-a", "batch-a"), *complete_requests("upload_b", "hash-b", "batch-b")],
            )
            cloud = merged_payload(
                "cloud",
                lectures=[lecture("upload_a2", "hash-a", "batch-a2")],
                requests=complete_requests("upload_a2", "hash-a", "batch-a2"),
            )
            files = [self.write_model(root, "tiny.json", tiny), self.write_model(root, "cloud.json", cloud)]

            result = self.refine(root, files)

            self.assertEqual(result["balanced_summary"]["selected_lecture_hashes"], ["hash-a"])
            self.assertTrue(any("missing_common_lecture" in item["reasons"] for item in result["balanced_summary"]["exclusions"]))
            self.assertEqual(len(result["full_results"]["models"][0]["lectures"]), 2)
            self.assertTrue((root / "balanced" / "full_results.json").exists())

    def test_balanced_csv_has_one_row_per_selected_request(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tiny = merged_payload("tiny", lectures=[lecture("upload_a", "hash-a", "batch-a")], requests=complete_requests("upload_a", "hash-a", "batch-a"))
            cloud = merged_payload("cloud", lectures=[lecture("upload_b", "hash-a", "batch-b")], requests=complete_requests("upload_b", "hash-a", "batch-b"))
            files = [self.write_model(root, "tiny.json", tiny), self.write_model(root, "cloud.json", cloud)]

            self.refine(root, files)

            with (root / "balanced" / "balanced_comparison.csv").open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 8)
            self.assertEqual(rows[0]["lecture_hash"], "hash-a")
            self.assertIn(rows[0]["completion_status"], {"completed", "length", "transport_failed", "incomplete", "unknown"})


if __name__ == "__main__":
    unittest.main()
