from celery import Celery
import os

CELERY_BROKER = os.getenv("CELERY_BROKER", "redis://localhost:6379/0")
CELERY_BACKEND = os.getenv("CELERY_BACKEND", "redis://localhost:6379/0")

celery_app = Celery(
    "tasks",
    broker=CELERY_BROKER,
    backend=CELERY_BACKEND
)

celery_app.conf.update(task_track_started=True)