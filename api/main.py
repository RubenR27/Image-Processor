from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from celery.result import AsyncResult
import shutil
import os
import uuid

from task import celery_app

app = FastAPI()

app.mount("/static", StaticFiles(directory="app"), name="static")

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

RESULT_DIR = "results"

@app.get("/")
async def read_index():
    return FileResponse('app/index.html')

@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):

    job_id = str(uuid.uuid4())
    ext = file.filename.split(".")[-1]
    input_path = os.path.join(UPLOAD_DIR, f"{job_id}_raw.{ext}")

    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    celery_app.send_task("process_image", args=[input_path, job_id])

    return {"job_id": job_id, "status": "processing"}


@app.get("/status/{job_id}")
async def get_status(job_id: str):

    res = AsyncResult(job_id, app=celery_app)
    return {"status": res.status, "result": res.result}

@app.get("/files/{filename}")
async def get_file(filename: str):
    path = os.path.join(RESULT_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path)