import asyncio
import shutil
import tempfile
from pathlib import Path
from typing import AsyncIterator

import aiofiles
import duckdb
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles


MAX_UPLOAD_SIZE = 10 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024

app = FastAPI(title="ParquetConvert", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_upload_size(request: Request, call_next):
    if request.method == "POST" and request.url.path == "/convert":
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_UPLOAD_SIZE:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "File is too large. Maximum upload size is 10GB."},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Invalid Content-Length header."},
                )
    return await call_next(request)


@app.get("/health")
async def health():
    return {"status": "healthy"}


def quote_duckdb_path(path: Path) -> str:
    normalized = path.resolve().as_posix()
    return "'" + normalized.replace("'", "''") + "'"


def convert_with_duckdb(input_path: Path, output_path: Path) -> None:
    sql = (
        f"COPY (SELECT * FROM {quote_duckdb_path(input_path)}) "
        f"TO {quote_duckdb_path(output_path)} (HEADER, DELIMITER ',')"
    )
    connection = duckdb.connect(database=":memory:")
    try:
        connection.execute(sql)
    finally:
        connection.close()


async def save_upload(upload: UploadFile, destination: Path) -> None:
    bytes_written = 0
    async with aiofiles.open(destination, "wb") as output_file:
        while True:
            chunk = await upload.read(CHUNK_SIZE)
            if not chunk:
                break

            bytes_written += len(chunk)
            if bytes_written > MAX_UPLOAD_SIZE:
                raise HTTPException(
                    status_code=413,
                    detail="File is too large. Maximum upload size is 10GB.",
                )

            await output_file.write(chunk)

    if bytes_written == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")


async def stream_csv(path: Path) -> AsyncIterator[bytes]:
    async with aiofiles.open(path, "rb") as csv_file:
        while True:
            chunk = await csv_file.read(CHUNK_SIZE)
            if not chunk:
                break
            yield chunk


def cleanup_temp_dir(temp_dir: str) -> None:
    shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/convert")
async def convert(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file was uploaded.")

    if not file.filename.lower().endswith(".parquet"):
        raise HTTPException(status_code=400, detail="Please upload a .parquet file.")

    temp_dir = tempfile.mkdtemp(prefix="parquetconvert-")
    input_path = Path(temp_dir) / "input.parquet"
    output_path = Path(temp_dir) / "output.csv"

    try:
        await save_upload(file, input_path)
        await asyncio.to_thread(convert_with_duckdb, input_path, output_path)

        if not output_path.exists():
            raise HTTPException(status_code=500, detail="CSV conversion did not produce a file.")

        background_tasks.add_task(cleanup_temp_dir, temp_dir)
        return StreamingResponse(
            stream_csv(output_path),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=output.csv"},
            background=background_tasks,
        )
    except HTTPException:
        cleanup_temp_dir(temp_dir)
        raise
    except duckdb.Error as exc:
        cleanup_temp_dir(temp_dir)
        raise HTTPException(
            status_code=422,
            detail=f"DuckDB could not convert this Parquet file: {exc}",
        ) from exc
    except Exception as exc:
        cleanup_temp_dir(temp_dir)
        raise HTTPException(
            status_code=500,
            detail="Conversion failed. Please check the file and try again.",
        ) from exc
    finally:
        await file.close()


app.mount("/", StaticFiles(directory="static", html=True), name="static")
