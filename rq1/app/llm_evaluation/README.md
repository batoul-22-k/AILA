# Ollama Deployment Evaluation for Educational Question Generation

This folder contains a separate, manual RQ1 evaluation module for comparing Ollama local and Ollama Cloud deployments for educational question generation.

The production application is not connected to this module. These scripts do not modify API endpoints, frontend code, database collections, or the current TinyLlama integration.

## Backend Facts Inspected

- Backend root: `backend/`
- Production Python package: `backend/app`
- Production import style: modules import from `app.*`, for example `from app.config import get_settings`
- Production Ollama generate endpoint default: `http://localhost:11434/api/generate`
- Production TinyLlama model default: `tinyllama`
- Production settings source: `backend/app/config.py`
- Production question prompt and schema source: `backend/app/instructor_services.py`
- Existing Ollama logic: helper functions in `backend/app/instructor_services.py` using `urllib.request`
- Reusable client decision: this offline module uses the same Ollama `/api/generate` request shape and generation options for local and cloud model tags so raw model failures and malformed outputs are not hidden.

## Goal

The Phase 1 goal is to compare:

- `tinyllama-local` -> exact Ollama tag `tinyllama`
- `gpt-oss-20b-cloud` -> exact Ollama tag `gpt-oss:20b-cloud`

for generating the same educational question set from the same normalized slide text:

- 4 multiple-choice questions
- 1 slide by default
- 3 repeated attempts per selected model

Each question must include:

- `q`: question text, 14 words or fewer
- `o`: exactly four options, each 8 words or fewer
- `a`: integer correct-answer option index from 0 to 3
- `e`: explanation, 10 words or fewer
- `b`: Bloom level
- `d`: difficulty
- `s`: source slide, or `null` if unavailable

The model must return a JSON object with exactly one root key, `questions`, whose value is an array of four compact question objects. Top-level arrays are invalid.

Allowed Bloom labels are:

- `Remember`
- `Understand`
- `Apply`
- `Analyze`
- `Evaluate`
- `Create`

Allowed difficulty labels are:

- `easy`
- `medium`
- `hard`

## Why Quality and Efficiency Are Separate

Educational quality and computational efficiency answer different research questions. A model can be fast but produce weak or hallucinated questions. Another model can be slower but produce clearer, better-grounded questions. This module therefore calculates automatic structure and speed metrics separately from instructor-rated educational quality.

Valid JSON does not imply educational correctness. JSON validity only means the model followed the output format. Instructor review is still needed to judge correctness, grounding, clarity, relevance, distractor quality, and label appropriateness.

## Install Dependencies

From the project root:

```powershell
cd D:\SmartProjectApp\rq1
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r .\app\llm_evaluation\requirements.txt
```

If you already use the backend virtual environment, you can install the evaluation requirements there instead.

## Install, Sign In, or Pull Ollama Models

In Windows PowerShell:

```powershell
ollama pull tinyllama
ollama signin
ollama pull gpt-oss:20b-cloud
ollama list
```

Optional local larger model:

```powershell
ollama pull gpt-oss:20b
$env:EVALUATION_INCLUDE_GPT_OSS_20B_LOCAL = "1"
```

The optional local `gpt-oss:20b` run is only intended for machines where the model is installed and the hardware check passes.

Confirm Ollama is running:

```powershell
ollama serve
```

In another PowerShell window:

```powershell
Invoke-RestMethod http://localhost:11434/api/tags
```

## Configure Models and Generation Settings

Defaults:

```powershell
$env:EVALUATION_MODEL_IDS = "tinyllama-local,gpt-oss-20b-cloud"
$env:OLLAMA_BASE_URL = "http://localhost:11434"
```

All selected models use the same normalized slide text, prompt, temperature, requested JSON schema, and generation options:

- `temperature = 1`
- `stream = false`
- `format = json`
- `keep_alive = 2m`
- `num_gpu = 0`
- same prompt
- same lecture passage
- same requested JSON shape in the prompt
- same maximum output tokens

Additional optional settings:

```powershell
$env:EVALUATION_NUM_PREDICT = "280"
$env:EVALUATION_NUM_CTX = "1024"
$env:EVALUATION_PROMPT_CHARS = "1800"
$env:EVALUATION_OLLAMA_TIMEOUT_SECONDS = "600"
$env:EVALUATION_ATTEMPTS_PER_MODEL = "3"
$env:EVALUATION_MAX_SLIDES = "1"
$env:EVALUATION_USE_JSON_SCHEMA = "0"
```

`EVALUATION_NUM_PREDICT=280`, `EVALUATION_NUM_CTX=1024`, and `EVALUATION_PROMPT_CHARS=1800` mirror the current defaults in `backend/app/config.py`.

The RQ1 defaults intentionally mirror the production Ollama request more closely for TinyLlama stability: `format=json`, `temperature=1`, `keep_alive=2m`, no fixed seed unless `EVALUATION_SEED` is set, and no unload after every single attempt unless `EVALUATION_UNLOAD_AFTER_REQUEST=1`.

Model configuration is explicit. Deployment type is read from model configuration, not inferred from provider name. You can override or add model configs with `EVALUATION_MODELS_JSON`, and select model IDs with `EVALUATION_MODEL_IDS`.

Cloud records store:

```json
{
  "pricing_type": "free_tier_or_subscription",
  "direct_request_cost_usd": null,
  "usage_limit_applies": true
}
```

When Ollama does not report a reliable per-request monetary cost, summaries display:

```text
Direct request cost: Not reported
Plan: Ollama Free or configured subscription
Usage limits: Apply
```

## Add Lecture Passages or PPTX Course Decks

Edit:

```text
app/llm_evaluation/evaluation_inputs.json
```

The file structure is:

```json
[
  {
    "id": "lecture_001",
    "topic": "Example topic",
    "content": "Lecture passage used for question generation."
  }
]
```

The included three passages are clearly marked samples. Replace or extend them with 30-50 representative lecture passages before collecting research results.

You can also point the comparison directly at a directory of PowerPoint course decks. For example, this dataset contains 8 `.pptx` files:

```text
D:\Courses\Mydataset
```

Each `.pptx` file is loaded as one course passage. Slide text is extracted with `[Slide N]` labels and saved with `source_file` metadata in each result record.

## Run Selected Models

Run commands from `D:\SmartProjectApp\rq1` so `python -m app...` resolves to this isolated evaluation package:

```powershell
cd D:\SmartProjectApp\rq1
.\.venv\Scripts\Activate.ps1
python -m app.llm_evaluation.run_comparison
```

Run all 8 course decks from your dataset:

```powershell
python -m app.llm_evaluation.run_comparison --input "D:\Courses\Mydataset" --all-passages
```

Run a smaller smoke test from the same dataset:

```powershell
python -m app.llm_evaluation.run_comparison --input "D:\Courses\Mydataset" --max-passages 1
```

Before the experiment starts, the script checks that local models are installed, validates local hardware requirements for optional larger local models, confirms cloud model availability, and verifies Ollama Cloud authentication. If cloud authentication is missing, it returns a setup error asking you to run `ollama signin`.

This saves a timestamped file:

```text
app/llm_evaluation/results/<experiment-id>_comparison.json
```

Result files are never overwritten.

## Calculate Automatic Metrics

```powershell
python -m app.llm_evaluation.validate_outputs --input .\app\llm_evaluation\results\<experiment-id>_comparison.json
```

This saves:

```text
app/llm_evaluation/results/<experiment-id>_automatic_metrics.csv
app/llm_evaluation/results/<experiment-id>_automatic_metrics.json
```

Automatic metrics include request success, valid JSON, complete question-set rate, exact question/type counts, MCQ option counts, valid answer indexes, explanation presence, valid Bloom/difficulty labels, compact field word-limit compliance, average generation time, generated token count, and tokens per second. Result records include exact model tag, deployment type, Internet requirement, whether data leaves the institution, raw output, parsed output, format validation, input hash, prompt hash, prompt-size diagnostics, attempt number, request ID, local resource metrics only for local inference, and cloud usage information when Ollama supplies it. Account-plan or usage-limit errors are recorded as failed attempts.

Non-streaming responses are rejected unless Ollama returns `done: true`, non-empty output, and no disallowed ASCII control characters. Repeated `\u001c` output is classified as `invalid_control_characters`; `done: false` is classified as `incomplete_response`.

## Export Blinded Instructor Review Sheet

```powershell
python -m app.llm_evaluation.export_human_review --input .\app\llm_evaluation\results\<experiment-id>_comparison.json
```

This saves:

```text
app/llm_evaluation/results/<experiment-id>_human_review_blinded.csv
app/llm_evaluation/results/<experiment-id>_model_mapping.json
```

## How Model Blinding Works

The review CSV does not show real model names. The script randomly maps the two real models to:

- `Model A`
- `Model B`

The private mapping is saved separately in `<experiment-id>_model_mapping.json`. Keep that mapping away from reviewers until scoring is complete.

The review row order is randomized to reduce evaluator bias.

## Instructor Rating Instructions

The instructor should complete these columns:

- `answer_correct`: `1` correct, `0` incorrect
- `grounded_in_lecture`: `1` supported by the lecture passage, `0` unsupported or hallucinated
- `relevance_score`: `1` to `5`
- `clarity_score`: `1` to `5`
- `distractor_quality_score`: `1` to `5` for each compact MCQ
- `bloom_label_correct`: `1` correct, `0` incorrect
- `difficulty_label_correct`: `1` correct, `0` incorrect
- `reviewer_notes`: optional comments

If two reviewers score the same rows, add a `reviewer_id` column. The final calculation script will calculate Cohen's kappa for binary fields and weighted Cohen's kappa for 1-5 ratings when at least two reviewers scored matching `review_id` values.

## Calculate Final Results

After instructor ratings are completed:

```powershell
python -m app.llm_evaluation.calculate_results `
  --reviews .\app\llm_evaluation\results\<experiment-id>_human_review_blinded.csv `
  --mapping .\app\llm_evaluation\results\<experiment-id>_model_mapping.json
```

This saves:

```text
app/llm_evaluation/results/<experiment-id>_final_results.csv
app/llm_evaluation/results/<experiment-id>_final_results.json
```

The terminal also prints a comparison table.

Final metrics include:

- answer accuracy percentage
- groundedness percentage
- average relevance score
- average clarity score
- average distractor-quality score
- Bloom-label accuracy percentage
- difficulty-label accuracy percentage
- number of reviewed questions

The JSON output also includes an optional combined educational-quality score. The formula is an equal-weight average of normalized answer accuracy, groundedness, relevance, clarity, Bloom-label accuracy, difficulty-label accuracy, and distractor quality when available. Treat this score as secondary; the individual metrics are the primary research results.

## Interpreting Results

Use automatic metrics to identify whether a model followed the required structure and how efficiently it generated output. Use human-review metrics to judge whether the generated questions are correct, grounded in the lecture passage, clear, relevant, and pedagogically useful.

Do not claim one model is better based only on valid JSON rate. A structurally valid response may still contain wrong answers, weak distractors, hallucinations, or inappropriate Bloom/difficulty labels.

## Production Isolation

All evaluation files live under:

```text
rq1/app/llm_evaluation/
```

The module:

- does not import or modify production API routes
- does not write to MongoDB
- does not call production question-generation endpoints
- does not alter frontend code
- does not modify `backend/app/config.py`
- does not modify the current TinyLlama integration
- runs only when manually invoked from the command line
