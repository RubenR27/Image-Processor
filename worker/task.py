from celery import Celery
from PIL import Image, ImageDraw
import os

CELERY_BROKER = os.getenv("CELERY_BROKER", "redis://localhost:6379/0")
CELERY_BACKEND = os.getenv("CELERY_BACKEND", "redis://localhost:6379/0")

celery_app = Celery("tasks", broker=CELERY_BROKER, backend=CELERY_BACKEND)
celery_app.conf.update(task_track_started=True)

@celery_app.task(name="process_image")
def process_image(input_path, job_id):
    try:
        output_path = input_path.replace("_raw", "_watermarked")
        with Image.open(input_path) as img:
            draw = ImageDraw.Draw(img)
            text = "MY PROPERTY"
            width, height = img.size
            draw.text((10, height - 30), text, fill=(255, 255, 255))
            img.save(output_path)
        return {"output_path": output_path, "job_id": job_id}
    except Exception as e:
        return {"error": str(e)}