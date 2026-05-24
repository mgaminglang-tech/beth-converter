# Parquet to CSV Converter

A full-stack web app for converting large `.parquet` files to `.csv` from a browser. The backend uses FastAPI and DuckDB, writes files to temporary disk storage, and streams the CSV download instead of loading the full output into memory.

## Tech Stack

- Frontend: React, Vite, Tailwind CSS
- Backend: Python, FastAPI
- Conversion engine: DuckDB
- File handling: python-multipart, aiofiles, StreamingResponse
- Deployment: Railway.app

## Project Structure

```text
parquet-to-csv/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── vite.config.js
├── railway.toml
└── README.md
```

## Run Locally

### 1. Start the Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

On Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Confirm the backend is running:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"healthy"}
```

### 2. Start the Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Visit the local frontend URL shown by Vite, usually:

```text
http://localhost:5173
```

The frontend defaults to:

```text
http://localhost:8000
```

for API requests. To use another backend URL locally, create `frontend/.env`:

```text
VITE_API_URL=https://your-backend-url
```

## Deploy to Railway

### 1. Push to GitHub

Create a GitHub repository and push this project:

```bash
git init
git add .
git commit -m "Initial Parquet to CSV converter"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/parquet-to-csv.git
git push -u origin main
```

### 2. Create the Backend Service

1. Open Railway.app.
2. Create a new project.
3. Choose "Deploy from GitHub repo".
4. Select this repository.
5. Create a service for the `backend` directory.
6. Railway will use `backend/Dockerfile`.
7. Generate or copy the public backend domain from the Railway service settings.

The backend health endpoint will be:

```text
https://YOUR-BACKEND-DOMAIN/health
```

### 3. Create the Frontend Service

1. In the same Railway project, add another service from the same GitHub repo.
2. Set the service root/source directory to `frontend`.
3. Set the build command to:

```bash
npm install && npm run build
```

4. Set the start command to:

```bash
npm run preview -- --host 0.0.0.0 --port $PORT
```

5. Add this environment variable to the frontend service:

```text
VITE_API_URL=https://YOUR-BACKEND-DOMAIN
```

6. Redeploy the frontend service after setting the variable.
7. Generate or copy the public frontend domain from the Railway service settings.

### 4. Share the App

Send the Railway frontend URL to the remote user:

```text
https://YOUR-FRONTEND-DOMAIN
```

They can open the URL in a browser, upload a `.parquet` file, and download the converted CSV without installing anything.

## Notes for Large Files

- The app enforces a 10GB upload limit.
- Files over 5GB show a warning in the browser.
- DuckDB performs the conversion; pandas is not used.
- Uploads and converted CSV files are stored in a temporary directory and cleaned up after streaming.
- CORS is fully open so the frontend can call the backend from a separate Railway domain.

## API

### `GET /`

Returns:

```json
{"status":"ok"}
```

### `GET /health`

Returns:

```json
{"status":"healthy"}
```

### `POST /convert`

Accepts multipart form data with a `.parquet` file field named `file`.

Returns a streamed CSV response with:

```text
Content-Disposition: attachment; filename=output.csv
```
