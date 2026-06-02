# AILA - AI-Powered Interactive Learning Analytics

A full-stack foundation for a role-based smart classroom system with React + JavaScript, Tailwind CSS, FastAPI, MongoDB, and WebSocket live updates.

## Project Structure

```text
backend/
  app/
    api/
      analytics.py
      auth.py
      classes.py
      dashboards.py
      lecture_uploads.py
      questions.py
      responses.py
      sessions.py
      users.py
    config.py
    auth.py
    database.py
    main.py
    models.py
    realtime.py
    seeds.py
    services.py
frontend/
  src/
    api/
    components/
      RoleLayout.jsx
      Sidebar.jsx
      MobileBottomNav.jsx
      DashboardCard.jsx
      ChartCard.jsx
      ResponsiveTable.jsx
    hooks/
    pages/
      admin/
      instructor/
      student/
    state/
```

## Requirements

- Python 3.11+
- Node.js 20+
- MongoDB running locally or a reachable MongoDB connection string

Optional local MongoDB:

```bash
docker compose up -d mongo
```

## Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

Default backend URL: `http://localhost:8000`

Health check: `http://localhost:8000/health`

API docs: `http://localhost:8000/docs`

## Frontend Setup

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Default frontend URL: `http://localhost:5173`

The frontend is implemented in JavaScript/JSX and includes:

- mobile-first responsive layouts
- desktop sidebar and mobile bottom navigation
- light mode by default with dark mode toggle
- reusable cards, buttons, inputs, tables, skeletons, empty states, and chart cards
- Recharts dashboards for student, instructor, and administrator views

Note: the frontend is JavaScript/JSX, not TypeScript.

## Login and Workspace Routing

The app now uses a Moodle-like login-first flow:

1. User opens `/login`.
2. Backend validates the account with a clean mock/session placeholder.
3. Backend returns the user profile, global role, class memberships, and available workspaces.
4. If there is one workspace, the frontend redirects automatically.
5. If there are multiple workspaces, `/workspace-select` lets the user choose the class context.

There is no role selector before login. A single account can have different roles in different classes, and admin access is granted through `global_role == "admin"`.

Temporary demo accounts all use password `demo-password`:

- `student@example.com` - student only
- `instructor@example.com` - instructor only
- `admin@example.com` - administrator
- `batoul@example.com` - student in one class and instructor in another

Frontend route boundaries:

- `/student/*` requires a selected student workspace
- `/instructor/*` requires a selected instructor workspace
- `/admin/*` requires a selected admin workspace

The frontend stores a placeholder session response in localStorage under `smartAuth` and the selected workspace under `currentWorkspace`. API requests send `X-Session-Token`. TODO comments mark where this should become hardened JWT or server-side session validation.

## Implemented API Routes

- `POST /api/classes` creates a class
- `POST /api/lecture-uploads` stores lecture upload metadata
- `POST /api/questions/generated` saves reviewed generated questions
- `POST /api/sessions` creates a live session
- `POST /api/sessions/join` joins a live session by code
- `POST /api/responses` submits a student answer
- `GET /api/sessions/{session_id}/stats` returns live stats
- `GET /api/instructor/dashboard?instructor_id=...` returns instructor summary data
- `GET /api/admin/dashboard` returns administrator summary data
- `GET /api/analytics/engagement-trends` returns analytics placeholder data
- `GET /api/analytics/prediction-results` returns prediction placeholder data
- `POST /api/auth/login` validates a demo account and returns available workspaces
- `GET /api/auth/me` reloads the current mock session

## Backend Authorization Model

Role-sensitive backend endpoints check permissions server-side:

- Instructor endpoints require instructor membership for the class context.
- Student answer/session join endpoints require student membership for the session's class.
- Admin dashboards and analytics require `global_role == "admin"`.
- Denied access returns `403 Forbidden`.

The current implementation is a mock-session placeholder, not production authentication. Future hardening should replace `X-Session-Token` with signed server-side sessions or JWT and password hashing.

## Instructor Workflow Implementation

The Instructor portal now has a connected first-stage workflow in one workspace:

`/instructor/classes` - Classes

Classes are built first because uploads, sessions, and summaries need a stable container. Each class record includes:

```json
{
  "class_id": "",
  "name": "",
  "description": "",
  "semester": "",
  "created_by": ""
}
```

The Classes workspace supports:

- Create Class
- Manage Classes
- Class Settings
- Opening Content Studio for the selected class

`/instructor/content-studio` - Content Generation Studio

The studio combines:

- Explicit class selection
- Upload a `.pptx` or `.pdf`
- Preview extracted lecture text from MongoDB `lecture_uploads`
- Generate questions with Ollama at `OLLAMA_URL` using `OLLAMA_MODEL`
- Review, edit, regenerate, delete, and approve generated questions
- Choose either an updated PPTX download or a live session output

Compatibility redirects remain for older workflow URLs:

- `/instructor/upload`
- `/instructor/generate`
- `/instructor/questions`
- `/instructor/review`
- `/instructor/reconstruct`

Session management remains available at `/instructor/sessions`:

   - Creates a live session from approved questions
   - Generates a session code, join link, and QR image
   - Stores the session in MongoDB `sessions`

Live classroom monitoring remains available at `/instructor/live/:sessionId`:

   - Shows session code, QR, active question IDs, joined students, submitted answers, and a placeholder panel ready for WebSocket visualization

New Instructor API routes:

- `POST /api/instructor/uploads`
- `GET /api/instructor/uploads/{upload_id}`
- `POST /api/instructor/questions/generate`
- `POST /api/instructor/questions/save`
- `GET /api/instructor/questions`
- `PUT /api/instructor/questions/{question_id}`
- `DELETE /api/instructor/questions/{question_id}`
- `POST /api/instructor/questions/{question_id}/approve`
- `POST /api/instructor/questions/regenerate`
- `POST /api/instructor/presentations/reconstruct`
- `GET /api/instructor/presentations/{file_id}/download`
- `POST /api/instructor/sessions`
- `GET /api/instructor/sessions`
- `GET /api/instructor/sessions/{session_id}`

Ollama setup:

```bash
ollama pull tinyllama
ollama serve
```

Optional backend environment variables:

```text
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=tinyllama
OLLAMA_PROMPT_CHARS=3000
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_PREDICT=700
STORAGE_DIR=storage
```

AI service controls:

- `GET /api/ai/status` checks whether Ollama is reachable and whether the configured model is available.
- `POST /api/ai/start` tries to start `ollama serve` from the backend host for local/dev use.

The frontend Content Studio shows an AI status panel and can ask the backend to start Ollama if the `ollama` CLI is installed on the same machine. Browsers cannot start Ollama directly; React talks to FastAPI, and FastAPI manages/checks Ollama.

## WebSocket

Live session updates are available at:

```text
ws://localhost:8000/ws/sessions/{session_id}
```

When a student submits an answer, the backend broadcasts:

- participation count
- answer distribution
- unanswered count placeholder

## Quick Demo Flow

1. Open `/login` and sign in as `instructor@example.com` / `demo-password`.
2. Open `Classes`, create or select a class.
3. Open `Content Studio`.
4. Upload a PPTX/PDF, inspect extracted text, generate questions, and approve questions.
5. Choose either `Download Updated PPTX` or `Create Live Session`.
6. Copy the generated session code or QR from the live/session view.
7. Open a second browser tab, sign in as `student@example.com`, and join with the code.
8. Submit an answer.
9. Return to the instructor `Live Class` page to see live stats update.

Current development order:

1. Classes
2. Content Studio
3. Session Creation
4. Live Dashboard
5. Session Summary
6. Analytics
7. Student Portal
8. Admin Portal

Analytics, prediction, semantic evaluation, and risk detection should wait until the instructor operational workflow works end to end.

## MongoDB Collections

The backend is wired for:

- `users`
- `classes`
- `class_memberships`
- `lecture_files`
- `lecture_uploads`
- `generated_questions`
- `approved_questions`
- `sessions`
- `responses`
- `participation_records`
- `analytics_results`
- `prediction_results`

## Placeholder Roadmap

The code includes TODO comments for:

- real authentication and role claims
- Ollama/LLaMA question generation
- lecture file storage and text extraction
- semantic answer evaluation
- analytics aggregation
- ML prediction results
