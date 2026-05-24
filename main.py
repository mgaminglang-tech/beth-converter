import asyncio
import json
import math
import shutil
import tempfile
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, AsyncIterator

import aiofiles
import duckdb
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles


MAX_UPLOAD_SIZE = 10 * 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
SEARCH_UPLOAD_EXTENSIONS = (".parquet", ".zst")
FILTER_OPERATORS = {
    "equals",
    "not_equals",
    "contains",
    "starts_with",
    "greater_than",
    "less_than",
    "is_empty",
    "is_not_empty",
}

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
    if request.method == "POST" and request.url.path in {"/convert", "/preview", "/search"}:
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


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def read_parquet_source(path: Path) -> str:
    return f"read_parquet({quote_duckdb_path(path)})"


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


def normalize_json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, list):
        return [normalize_json_value(item) for item in value]
    if isinstance(value, tuple):
        return [normalize_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): normalize_json_value(item) for key, item in value.items()}
    return str(value)


def validate_search_upload(filename: str | None) -> str:
    if not filename:
        raise HTTPException(status_code=400, detail="No file was uploaded.")

    lower_name = filename.lower()
    for extension in SEARCH_UPLOAD_EXTENSIONS:
        if lower_name.endswith(extension):
            return extension

    raise HTTPException(status_code=400, detail="Please upload a .parquet or .zst file.")


def get_schema(connection: Any, input_path: Path) -> list[dict[str, str]]:
    schema_rows = connection.execute(
        f"DESCRIBE SELECT * FROM {read_parquet_source(input_path)}"
    ).fetchall()
    return [
        {"name": str(row[0]), "type": str(row[1])}
        for row in schema_rows
    ]


def preview_parquet(input_path: Path) -> dict[str, Any]:
    connection = duckdb.connect(database=":memory:")
    try:
        source = read_parquet_source(input_path)
        schema = get_schema(connection, input_path)
        columns = [column["name"] for column in schema]
        total_rows = connection.execute(f"SELECT COUNT(*) FROM {source}").fetchone()[0]
        preview_values = connection.execute(f"SELECT * FROM {source} LIMIT 100").fetchall()
        preview_rows = [
            {
                column_name: normalize_json_value(value)
                for column_name, value in zip(columns, row)
            }
            for row in preview_values
        ]

        return {
            "columns": columns,
            "column_types": {column["name"]: column["type"] for column in schema},
            "total_rows": total_rows,
            "preview_rows": preview_rows,
        }
    finally:
        connection.close()


def is_string_type(column_type: str) -> bool:
    normalized = column_type.upper()
    return any(token in normalized for token in ("CHAR", "VARCHAR", "STRING", "TEXT", "UUID"))


def typed_value_expression(value: Any, column_type: str) -> str:
    literal = sql_literal(value)
    if is_string_type(column_type):
        return literal
    return f"TRY_CAST({literal} AS {column_type})"


def parse_filters(filters_json: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(filters_json or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Filters must be a valid JSON array.") from exc

    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail="Filters must be a JSON array.")

    return parsed


def build_where_clause(filters: list[dict[str, Any]], schema: list[dict[str, str]]) -> str:
    if not filters:
        return ""

    schema_by_name = {column["name"]: column["type"] for column in schema}
    clauses: list[str] = []

    for filter_index, filter_item in enumerate(filters, start=1):
        if not isinstance(filter_item, dict):
            raise HTTPException(status_code=400, detail=f"Filter {filter_index} must be an object.")

        column = filter_item.get("column")
        operator = filter_item.get("operator")
        value = filter_item.get("value", "")

        if column not in schema_by_name:
            raise HTTPException(status_code=400, detail=f"Unknown filter column: {column}")
        if operator not in FILTER_OPERATORS:
            raise HTTPException(status_code=400, detail=f"Unsupported filter operator: {operator}")

        quoted_column = quote_identifier(column)
        column_type = schema_by_name[column]
        typed_value = typed_value_expression(value, column_type)

        if operator == "equals":
            clauses.append(f"{quoted_column} = {typed_value}")
        elif operator == "not_equals":
            clauses.append(f"{quoted_column} != {typed_value}")
        elif operator == "contains":
            clauses.append(f"CAST({quoted_column} AS VARCHAR) LIKE {sql_literal(f'%{value}%')}")
        elif operator == "starts_with":
            clauses.append(f"CAST({quoted_column} AS VARCHAR) LIKE {sql_literal(f'{value}%')}")
        elif operator == "greater_than":
            clauses.append(f"{quoted_column} > {typed_value}")
        elif operator == "less_than":
            clauses.append(f"{quoted_column} < {typed_value}")
        elif operator == "is_empty":
            clauses.append(f"({quoted_column} IS NULL OR CAST({quoted_column} AS VARCHAR) = '')")
        elif operator == "is_not_empty":
            clauses.append(f"({quoted_column} IS NOT NULL AND CAST({quoted_column} AS VARCHAR) != '')")

    return "WHERE " + " AND ".join(clauses)


def search_parquet_to_csv(
    input_path: Path,
    output_path: Path,
    filters: list[dict[str, Any]],
    limit: int,
) -> None:
    connection = duckdb.connect(database=":memory:")
    try:
        source = read_parquet_source(input_path)
        schema = get_schema(connection, input_path)
        where_clause = build_where_clause(filters, schema)
        limit_clause = f" LIMIT {limit}" if limit > 0 else ""
        sql = (
            f"COPY (SELECT * FROM {source} {where_clause}{limit_clause}) "
            f"TO {quote_duckdb_path(output_path)} (HEADER, DELIMITER ',')"
        )
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


@app.post("/preview")
async def preview(file: UploadFile = File(...)):
    extension = validate_search_upload(file.filename)
    temp_dir = tempfile.mkdtemp(prefix="parquet-preview-")
    input_path = Path(temp_dir) / f"input{extension}"

    try:
        await save_upload(file, input_path)
        return await asyncio.to_thread(preview_parquet, input_path)
    except HTTPException:
        raise
    except duckdb.Error as exc:
        raise HTTPException(
            status_code=422,
            detail=f"DuckDB could not preview this file: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Preview failed. Please check the file and try again.",
        ) from exc
    finally:
        cleanup_temp_dir(temp_dir)
        await file.close()


@app.post("/search")
async def search(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    filters: str = Form("[]"),
    limit: int = Form(0),
):
    extension = validate_search_upload(file.filename)
    if limit < 0:
        raise HTTPException(status_code=400, detail="Limit must be 0 or greater.")

    parsed_filters = parse_filters(filters)
    temp_dir = tempfile.mkdtemp(prefix="parquet-search-")
    input_path = Path(temp_dir) / f"input{extension}"
    output_path = Path(temp_dir) / "filtered_results.csv"

    try:
        await save_upload(file, input_path)
        await asyncio.to_thread(search_parquet_to_csv, input_path, output_path, parsed_filters, limit)

        if not output_path.exists():
            raise HTTPException(status_code=500, detail="Filtered CSV export did not produce a file.")

        background_tasks.add_task(cleanup_temp_dir, temp_dir)
        return StreamingResponse(
            stream_csv(output_path),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=filtered_results.csv"},
            background=background_tasks,
        )
    except HTTPException:
        cleanup_temp_dir(temp_dir)
        raise
    except duckdb.Error as exc:
        cleanup_temp_dir(temp_dir)
        raise HTTPException(
            status_code=422,
            detail=f"DuckDB could not filter this file: {exc}",
        ) from exc
    except Exception as exc:
        cleanup_temp_dir(temp_dir)
        raise HTTPException(
            status_code=500,
            detail="Search failed. Please check the filters and try again.",
        ) from exc
    finally:
        await file.close()


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
